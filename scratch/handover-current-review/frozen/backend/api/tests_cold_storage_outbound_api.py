"""
Tests for Phase 6 Step 6: Outbound Cold Storage Transfer Backend API + SAP Posting.

Verifies:
1. Outbound transfer request creation reserves OCCUPIED position -> RESERVED_OUTBOUND.
2. Transfer API (/api/transfer/move/) creates pending transfer and reserves position.
3. Attempting to reserve an already RESERVED_OUTBOUND position fails (conflict).
4. Attempting to reserve an AVAILABLE position for outbound fails.
5. Attempting to reserve a MAINTENANCE position for outbound fails.
6. Missing source_pallet_position_id fails validation.
7. Non-existent source_pallet_position_id fails validation.
8. Bin mismatch between position and from_bin fails validation.
9. Warehouse mismatch fails validation.
10. Non-allocatable bin layout fails validation.
11. SAP posting success vacates position (RESERVED_OUTBOUND -> AVAILABLE) and clears metadata.
12. Explicit SAP rejection restores OCCUPIED without clearing batch metadata.
13. SAP timeout retains RESERVED_OUTBOUND.
14. Retry of failed outbound transfer succeeds and vacates position.
15. Deletion of pending transfer releases RESERVED_OUTBOUND -> OCCUPIED and preserves batch.
16. Deletion of failed transfer releases RESERVED_OUTBOUND -> OCCUPIED and preserves batch.
17. Idempotent vacate returns cleanly without error when already AVAILABLE.
18. Admin vacate endpoint remains functional as administrative override.
19. SAP payload contains batFromWarehouse bin allocations and zero physical position data.
20. Inbound transfers (STAGE_2_TO_FRIDGE) continue to work normally (regression-free).
"""
import os
from unittest.mock import MagicMock, patch
from django.test import TestCase
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from rest_framework import status

from api.models import PendingTransferRequest, UserProfile, TransferWarehouseRule
from api.models_cold_storage import ColdStorageBinLayout, ColdStoragePalletPosition
from api.services.transfer_service import (
    TransferInventoryService,
    TransferValidationError,
    DefinitiveSAPPostingFailure,
    STAGE_3_FROM_FRIDGE,
    STAGE_2_TO_FRIDGE,
    reserve_source_pallet_position_for_transfer,
    release_source_pallet_position_for_transfer,
    vacate_source_pallet_position_for_transfer,
    reserve_pallet_position_for_transfer,
    occupy_pallet_position_for_transfer,
)
from api.views import (
    _pending_transfer_to_dict,
    _create_pending_transfer_request,
    _post_pending_transfer_record,
    _mark_pending_transfer_failed,
)


def outbound_destination_metadata(code):
    """Only the exact non-binned destination used by these outbound fixtures."""
    if code != '90214':
        raise AssertionError(f'Unexpected destination metadata request: {code}')
    return {'WarehouseCode': '90214', 'Inactive': 'tNO', 'EnableBinLocations': 'tNO'}


class ColdStorageOutboundAPITests(TestCase):
    def setUp(self):
        metadata = patch('api.views.sap.get_warehouse_details', side_effect=outbound_destination_metadata)
        metadata.start()
        self.addCleanup(metadata.stop)
        self.client = APIClient()
        self.transfer_service = TransferInventoryService(use_mock=True)

        # Users
        self.operator = User.objects.create_user(username='operator_outbound', password='password123')
        self.admin = User.objects.create_user(username='admin_outbound', password='password123')
        UserProfile.objects.filter(user=self.operator).update(role='transfer')
        UserProfile.objects.filter(user=self.admin).update(role='admin')

        # Environment configuration for fridge and intermediate warehouses
        os.environ["TRANSFER_FRIDGE_WAREHOUSES"] = "20201"
        os.environ["TRANSFER_INTERMEDIATE_WAREHOUSES"] = "90214"

        # Transfer warehouse access rules for operator
        TransferWarehouseRule.objects.create(
            user=self.operator,
            warehouse_code="20201",
            warehouse_name="Cold Storage 20201",
            direction=TransferWarehouseRule.DIRECTION_BOTH,
            stage=TransferWarehouseRule.STAGE_BOTH,
            is_active=True,
        )
        TransferWarehouseRule.objects.create(
            user=self.operator,
            warehouse_code="90214",
            warehouse_name="Intermediate 90214",
            direction=TransferWarehouseRule.DIRECTION_BOTH,
            stage=TransferWarehouseRule.STAGE_BOTH,
            is_active=True,
        )
        for warehouse_code in ("20201", "90214"):
            TransferWarehouseRule.objects.create(
                user=self.operator,
                warehouse_code=warehouse_code,
                direction=TransferWarehouseRule.DIRECTION_BOTH,
                stage=TransferWarehouseRule.STAGE_3_FROM_FRIDGE,
                is_active=True,
            )

        # Create standard Cold Storage Bin Layout & Positions
        self.layout = ColdStorageBinLayout.objects.create(
            warehouse_code='20201',
            bin_code='20201-F01-R01-C01-RA',
            sap_bin_abs_entry=142,
            sublevel1='F01',
            sublevel2='R01',
            sublevel3='C01',
            sublevel4='RA',
            allocation_type=ColdStorageBinLayout.ALLOC_ALLOCATABLE,
            sap_bin_classification=ColdStorageBinLayout.CLASS_PHYSICAL_CHANNEL,
            capacity=5,
        )
        self.positions = list(self.layout.positions.all().order_by('position_index'))

        # Prepare position 0 as OCCUPIED
        self.occ_pos = self.positions[0]
        ColdStoragePalletPosition.objects.filter(id=self.occ_pos.id).update(
            status=ColdStoragePalletPosition.OCCUPIED,
            current_batch_number='BATCH-OUT-100',
            transfer_reference='PTR-INBOUND-ORIGINAL',
            reservation_reference='INBOUND-RECEIPT',
            reserved_by=self.operator,
        )
        self.occ_pos.refresh_from_db()

    def _create_outbound_test_transfer(self, **kwargs):
        pos_id = kwargs.get("source_pallet_position_id", self.occ_pos.id)
        from_bin = kwargs.get("from_bin", self.layout.bin_code)
        from_whs = kwargs.get("from_warehouse", "20201")
        to_whs = kwargs.get("to_warehouse", "90214")
        batch = kwargs.get("batch_number", "BATCH-OUT-100")
        qty = kwargs.get("quantity", 25.0)
        item_code = kwargs.get("item_code", "FG-20201")
        lines = kwargs.get("lines", [
            {
                "item_code": item_code,
                "batch_number": batch,
                "quantity": qty,
            }
        ])
        raw_payload = kwargs.get("raw_payload_json", {
            "transfer_stage": STAGE_3_FROM_FRIDGE,
            "from_warehouse": from_whs,
            "from_bin": from_bin,
            "to_warehouse": to_whs,
            "to_bin": kwargs.get("to_bin", ""),
            "source_pallet_position_id": pos_id,
            "lines": lines,
        })
        fields = {
            "transfer_stage": STAGE_3_FROM_FRIDGE,
            "from_warehouse": from_whs,
            "from_bin": from_bin,
            "to_warehouse": to_whs,
            "to_bin": kwargs.get("to_bin", ""),
            "item_code": item_code,
            "item_name": kwargs.get("item_name", "Finished Good Item"),
            "batch_number": batch,
            "quantity": qty,
            "lines": lines,
            "raw_payload_json": raw_payload,
            "status": kwargs.get("status", PendingTransferRequest.PENDING),
            "created_by": kwargs.get("created_by", self.operator),
        }
        for k, v in kwargs.items():
            if k not in ["source_pallet_position_id"]:
                fields[k] = v
        pending = PendingTransferRequest.objects.create(**fields)
        if pos_id:
            self.transfer_service.reserve_source_pallet_position_for_transfer(
                pending, pos_id, user=fields["created_by"]
            )
        return pending

    # 1. Outbound transfer request creation reserves OCCUPIED position -> RESERVED_OUTBOUND
    def test_01_create_pending_outbound_transfer_reserves_occupied_position(self):
        pending = self._create_outbound_test_transfer()
        self.occ_pos.refresh_from_db()
        pending.refresh_from_db()

        self.assertEqual(pending.status, PendingTransferRequest.PENDING)
        self.assertEqual(pending.source_pallet_position_id, self.occ_pos.id)
        self.assertEqual(pending.source_pallet_position_code, self.occ_pos.position_code)
        self.assertEqual(self.occ_pos.status, ColdStoragePalletPosition.RESERVED_OUTBOUND)
        self.assertEqual(self.occ_pos.current_batch_number, 'BATCH-OUT-100')
        self.assertIn(f"PTR-{pending.id}", self.occ_pos.reservation_reference)

        serialized = _pending_transfer_to_dict(pending)
        self.assertEqual(serialized.get('source_pallet_position_id'), self.occ_pos.id)
        self.assertEqual(serialized.get('source_pallet_position_code'), self.occ_pos.position_code)

    # 2. Transfer API (/api/transfer/move/) creates pending transfer and reserves position
    @patch("api.views._lookup_transfer_batch_source")
    @patch("api.views._assert_transfer_payload_sap_available")
    def test_02_transfer_move_api_creates_pending_and_reserves_position(self, mock_assert, mock_lookup):
        mock_assert.return_value = True
        mock_lookup.return_value = {
            "item_code": "FG-20201",
            "item_name": "Finished Good Item",
            "batch_number": "BATCH-OUT-100",
            "available_quantity": 50.0,
            "can_post_to_sap": True,
            "source_type": "SAP",
        }
        self.client.force_login(self.operator)

        payload = {
            "transfer_stage": STAGE_3_FROM_FRIDGE,
            "from_warehouse": "20201",
            "from_bin": self.layout.bin_code,
            "to_warehouse": "90214",
            "source_pallet_position_id": self.occ_pos.id,
            "lines": [
                {
                    "item_code": "FG-20201",
                    "batch_number": "BATCH-OUT-100",
                    "quantity": 25.0,
                }
            ],
        }

        response = self.client.post("/api/transfer/move/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertTrue(data.get("success"))
        self.assertTrue(data.get("pending"))
        pending_id = data.get("pending_transfer_id")

        pending = PendingTransferRequest.objects.get(id=pending_id)
        self.occ_pos.refresh_from_db()

        self.assertEqual(pending.source_pallet_position_id, self.occ_pos.id)
        self.assertEqual(pending.source_pallet_position_code, self.occ_pos.position_code)
        self.assertEqual(self.occ_pos.status, ColdStoragePalletPosition.RESERVED_OUTBOUND)
        self.assertEqual(self.occ_pos.current_batch_number, "BATCH-OUT-100")

    # 3. Attempting to reserve an already RESERVED_OUTBOUND position fails (conflict)
    def test_03_attempt_reserve_already_reserved_outbound_position_fails(self):
        # First reservation succeeds
        pending1 = self._create_outbound_test_transfer()
        self.occ_pos.refresh_from_db()
        self.assertEqual(self.occ_pos.status, ColdStoragePalletPosition.RESERVED_OUTBOUND)

        # Second attempt for another transfer must fail
        pending2 = PendingTransferRequest.objects.create(
            transfer_stage=STAGE_3_FROM_FRIDGE,
            from_warehouse="20201",
            from_bin=self.layout.bin_code,
            to_warehouse="90214",
            item_code="FG-20201",
            batch_number="BATCH-OUT-100",
            quantity=25.0,
            status=PendingTransferRequest.PENDING,
            created_by=self.operator,
        )

        with self.assertRaises(TransferValidationError) as ctx:
            self.transfer_service.reserve_source_pallet_position_for_transfer(
                pending2, self.occ_pos.id, user=self.operator
            )
        self.assertIn("cannot be reserved for outbound transfer", str(ctx.exception))

    # 4. Attempting to reserve an AVAILABLE position for outbound fails
    def test_04_attempt_reserve_available_position_for_outbound_fails(self):
        avail_pos = self.positions[1]
        self.assertEqual(avail_pos.status, ColdStoragePalletPosition.AVAILABLE)

        pending = PendingTransferRequest.objects.create(
            transfer_stage=STAGE_3_FROM_FRIDGE,
            from_warehouse="20201",
            from_bin=self.layout.bin_code,
            to_warehouse="90214",
            item_code="FG-20201",
            batch_number="BATCH-EMPTY",
            quantity=10.0,
            status=PendingTransferRequest.PENDING,
            created_by=self.operator,
        )

        with self.assertRaises(TransferValidationError) as ctx:
            self.transfer_service.reserve_source_pallet_position_for_transfer(
                pending, avail_pos.id, user=self.operator
            )
        self.assertIn("expected OCCUPIED", str(ctx.exception))

    # 5. Attempting to reserve a MAINTENANCE position for outbound fails
    def test_05_attempt_reserve_maintenance_position_fails(self):
        maint_pos = self.positions[2]
        ColdStoragePalletPosition.objects.filter(id=maint_pos.id).update(
            status=ColdStoragePalletPosition.MAINTENANCE
        )

        pending = PendingTransferRequest.objects.create(
            transfer_stage=STAGE_3_FROM_FRIDGE,
            from_warehouse="20201",
            from_bin=self.layout.bin_code,
            to_warehouse="90214",
            item_code="FG-20201",
            batch_number="BATCH-MAINT",
            quantity=10.0,
            status=PendingTransferRequest.PENDING,
            created_by=self.operator,
        )

        with self.assertRaises(TransferValidationError) as ctx:
            self.transfer_service.reserve_source_pallet_position_for_transfer(
                pending, maint_pos.id, user=self.operator
            )
        self.assertIn("cannot be reserved for outbound transfer", str(ctx.exception))

    # 6. Missing source_pallet_position_id fails validation
    def test_06_missing_source_pallet_position_id_fails_validation(self):
        payload = {
            "transfer_stage": STAGE_3_FROM_FRIDGE,
            "from_warehouse": "20201",
            "from_bin": self.layout.bin_code,
            "to_warehouse": "90214",
            "lines": [
                {
                    "item_code": "FG-20201",
                    "batch_number": "BATCH-OUT-100",
                    "quantity": 25.0,
                }
            ],
        }
        with self.assertRaises(TransferValidationError) as ctx:
            self.transfer_service._validate_move_payload(payload)
        self.assertIn("source_pallet_position_id", str(ctx.exception))

    # 7. Non-existent source_pallet_position_id fails validation
    def test_07_non_existent_source_pallet_position_id_fails(self):
        payload = {
            "transfer_stage": STAGE_3_FROM_FRIDGE,
            "from_warehouse": "20201",
            "from_bin": self.layout.bin_code,
            "to_warehouse": "90214",
            "source_pallet_position_id": 999999,
            "lines": [
                {
                    "item_code": "FG-20201",
                    "batch_number": "BATCH-OUT-100",
                    "quantity": 25.0,
                }
            ],
        }
        with self.assertRaises(TransferValidationError) as ctx:
            self.transfer_service._validate_move_payload(payload)
        self.assertIn("does not exist", str(ctx.exception))

    # 8. Bin mismatch between position and from_bin fails validation
    def test_08_bin_mismatch_fails_validation(self):
        # Create another bin
        other_layout = ColdStorageBinLayout.objects.create(
            warehouse_code='20201',
            bin_code='20201-F01-R01-C02-RA',
            sap_bin_abs_entry=143,
            allocation_type=ColdStorageBinLayout.ALLOC_ALLOCATABLE,
            capacity=1,
        )
        payload = {
            "transfer_stage": STAGE_3_FROM_FRIDGE,
            "from_warehouse": "20201",
            "from_bin": other_layout.bin_code,  # Bin C02
            "to_warehouse": "90214",
            "source_pallet_position_id": self.occ_pos.id,  # Position belongs to Bin C01
            "lines": [
                {
                    "item_code": "FG-20201",
                    "batch_number": "BATCH-OUT-100",
                    "quantity": 25.0,
                }
            ],
        }
        with self.assertRaises(TransferValidationError) as ctx:
            self.transfer_service._validate_move_payload(payload)
        self.assertIn("belongs to SAP Bin", str(ctx.exception))

    # 9. Warehouse mismatch fails validation
    def test_09_warehouse_mismatch_fails_validation(self):
        payload = {
            "transfer_stage": STAGE_3_FROM_FRIDGE,
            "from_warehouse": "90214",  # Not a fridge warehouse
            "from_bin": self.layout.bin_code,
            "to_warehouse": "20201",
            "source_pallet_position_id": self.occ_pos.id,
            "lines": [
                {
                    "item_code": "FG-20201",
                    "batch_number": "BATCH-OUT-100",
                    "quantity": 25.0,
                }
            ],
        }
        with self.assertRaises(TransferValidationError) as ctx:
            self.transfer_service._validate_move_payload(payload)
        self.assertIn("source warehouse must be a fridge warehouse", str(ctx.exception))

    # 10. Non-allocatable bin layout fails validation
    def test_10_non_allocatable_bin_fails_validation(self):
        ColdStorageBinLayout.objects.filter(id=self.layout.id).update(
            allocation_type=ColdStorageBinLayout.ALLOC_NON_ALLOCATABLE
        )
        payload = {
            "transfer_stage": STAGE_3_FROM_FRIDGE,
            "from_warehouse": "20201",
            "from_bin": self.layout.bin_code,
            "to_warehouse": "90214",
            "source_pallet_position_id": self.occ_pos.id,
            "lines": [
                {
                    "item_code": "FG-20201",
                    "batch_number": "BATCH-OUT-100",
                    "quantity": 25.0,
                }
            ],
        }
        with self.assertRaises(TransferValidationError) as ctx:
            self.transfer_service._validate_move_payload(payload)
        self.assertIn("NON_ALLOCATABLE", str(ctx.exception))

    # 11. SAP posting success vacates position (RESERVED_OUTBOUND -> AVAILABLE) and clears metadata
    @patch("api.views._assert_transfer_payload_sap_available")
    @patch("api.views.transfer_service.move_inventory")
    def test_11_sap_posting_success_vacates_position(self, mock_move, mock_assert):
        mock_assert.return_value = True
        mock_move.return_value = {
            "success": True,
            "sap_doc_entry": 120555,
            "sap_doc_num": 450555,
            "mock": True,
        }

        pending = self._create_outbound_test_transfer()
        self.client.force_login(self.admin)

        response = self.client.post(f"/api/admin/pending-transfers/{pending.id}/post/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        pending.refresh_from_db()
        self.occ_pos.refresh_from_db()

        self.assertEqual(pending.status, PendingTransferRequest.POSTED)
        self.assertEqual(pending.sap_doc_num, "450555")
        self.assertEqual(pending.sap_doc_entry, "120555")
        # Position must be AVAILABLE
        self.assertEqual(self.occ_pos.status, ColdStoragePalletPosition.AVAILABLE)
        # Live occupancy metadata must be cleared
        self.assertEqual(self.occ_pos.current_batch_number, "")
        self.assertEqual(self.occ_pos.reservation_reference, "")
        self.assertEqual(self.occ_pos.transfer_reference, "")
        self.assertIsNone(self.occ_pos.reserved_by)
        self.assertIsNone(self.occ_pos.reserved_at)
        # Historical snapshot on pending transfer must be preserved
        self.assertEqual(pending.source_pallet_position_id, self.occ_pos.id)
        self.assertEqual(pending.source_pallet_position_code, self.occ_pos.position_code)

    # 12. Explicit SAP rejection releases the outbound reservation.
    def test_structured_sap_error_is_classified_as_definitive(self):
        client = MagicMock()
        client.get_warehouse_details.side_effect = outbound_destination_metadata
        client.create_stock_transfer.return_value = {
            "error": {"code": -1004, "message": "Invalid batch allocation"},
        }
        service = TransferInventoryService(use_mock=False, sap_client=client)
        payload = {
            "transfer_stage": "STAGE_1_TO_INTERMEDIATE",
            "from_warehouse": "20201",
            "to_warehouse": "90214",
            "lines": [{"item_code": "FG-20201", "batch_number": "BATCH-OUT-100", "quantity": 1}],
        }
        with self.assertRaises(DefinitiveSAPPostingFailure):
            service._sap_move_inventory(payload)

        client.create_stock_transfer.return_value = {"error": "Connection timed out"}
        with self.assertRaises(Exception) as caught:
            service._sap_move_inventory(payload)
        self.assertNotIsInstance(caught.exception, DefinitiveSAPPostingFailure)

    @patch("api.views._assert_transfer_payload_sap_available")
    @patch("api.views.transfer_service.move_inventory")
    def test_12_definitive_sap_failure_restores_occupied(self, mock_move, mock_assert):
        mock_assert.return_value = True
        mock_move.side_effect = DefinitiveSAPPostingFailure("SAP Service Layer error: -1004 Invalid batch allocation")

        pending = self._create_outbound_test_transfer()
        self.client.force_login(self.admin)

        response = self.client.post(f"/api/admin/pending-transfers/{pending.id}/post/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        pending.refresh_from_db()
        self.occ_pos.refresh_from_db()

        self.assertEqual(pending.status, PendingTransferRequest.FAILED)
        self.assertIn("Invalid batch allocation", pending.error_message)
        self.assertEqual(self.occ_pos.status, ColdStoragePalletPosition.OCCUPIED)
        self.assertEqual(self.occ_pos.current_batch_number, "BATCH-OUT-100")
        self.assertEqual(self.occ_pos.transfer_reference, "PTR-INBOUND-ORIGINAL")
        self.assertEqual(self.occ_pos.reservation_reference, "")
        self.assertEqual(pending.source_pallet_position_id, self.occ_pos.id)

        # A duplicate failure update must not release another reservation or
        # lose the source snapshot needed for a subsequent retry.
        _mark_pending_transfer_failed(pending, self.admin, "Repeated rejection", definitive=True)
        self.occ_pos.refresh_from_db()
        self.assertEqual(self.occ_pos.status, ColdStoragePalletPosition.OCCUPIED)
        self.assertEqual(self.occ_pos.current_batch_number, "BATCH-OUT-100")

    @patch("api.views._assert_transfer_payload_sap_available")
    @patch("api.views.transfer_service.move_inventory")
    def test_definitive_failure_retry_reserves_then_posts(self, mock_move, mock_assert):
        mock_assert.return_value = True
        mock_move.side_effect = [
            DefinitiveSAPPostingFailure("SAP rejected batch"),
            {"success": True, "sap_doc_entry": 120557, "sap_doc_num": 450557},
        ]
        pending = self._create_outbound_test_transfer()
        self.client.force_login(self.admin)
        post_url = f"/api/admin/pending-transfers/{pending.id}/post/"

        self.assertEqual(self.client.post(post_url).status_code, status.HTTP_400_BAD_REQUEST)
        self.occ_pos.refresh_from_db()
        self.assertEqual(self.occ_pos.status, ColdStoragePalletPosition.OCCUPIED)
        self.assertEqual(self.client.post(post_url).status_code, status.HTTP_200_OK)
        pending.refresh_from_db()
        self.occ_pos.refresh_from_db()
        self.assertEqual(pending.status, PendingTransferRequest.POSTED)
        self.assertEqual(self.occ_pos.status, ColdStoragePalletPosition.AVAILABLE)
        self.assertEqual(mock_move.call_count, 2)

    # 13. SAP timeout retains RESERVED_OUTBOUND
    @patch("api.views._assert_transfer_payload_sap_available")
    @patch("api.views.transfer_service.move_inventory")
    def test_13_sap_timeout_retains_reserved_outbound(self, mock_move, mock_assert):
        mock_assert.return_value = True
        mock_move.side_effect = TimeoutError("Connection to SAP timed out")

        pending = self._create_outbound_test_transfer()
        self.client.force_login(self.admin)

        response = self.client.post(f"/api/admin/pending-transfers/{pending.id}/post/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        pending.refresh_from_db()
        self.occ_pos.refresh_from_db()

        self.assertEqual(pending.status, PendingTransferRequest.FAILED)
        self.assertEqual(self.occ_pos.status, ColdStoragePalletPosition.RESERVED_OUTBOUND)
        self.assertEqual(self.occ_pos.current_batch_number, "BATCH-OUT-100")

    # 14. Retry of failed outbound transfer succeeds and vacates position
    @patch("api.views._assert_transfer_payload_sap_available")
    @patch("api.views.transfer_service.move_inventory")
    def test_14_retry_failed_outbound_transfer_succeeds(self, mock_move, mock_assert):
        mock_assert.return_value = True
        pending = self._create_outbound_test_transfer()

        # Mark transfer as failed
        _mark_pending_transfer_failed(pending, self.admin, "Initial timeout error")
        self.assertEqual(pending.status, PendingTransferRequest.FAILED)
        self.occ_pos.refresh_from_db()
        self.assertEqual(self.occ_pos.status, ColdStoragePalletPosition.RESERVED_OUTBOUND)

        # Retry posting with success
        mock_move.return_value = {
            "success": True,
            "sap_doc_entry": 120556,
            "sap_doc_num": 450556,
            "mock": True,
        }
        self.client.force_login(self.admin)
        response = self.client.post(f"/api/admin/pending-transfers/{pending.id}/post/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        pending.refresh_from_db()
        self.occ_pos.refresh_from_db()

        self.assertEqual(pending.status, PendingTransferRequest.POSTED)
        self.assertEqual(self.occ_pos.status, ColdStoragePalletPosition.AVAILABLE)
        self.assertEqual(self.occ_pos.current_batch_number, "")

    # 15. Deletion of pending transfer releases RESERVED_OUTBOUND -> OCCUPIED and preserves batch
    def test_15_delete_pending_transfer_releases_to_occupied(self):
        pending = self._create_outbound_test_transfer()
        self.occ_pos.refresh_from_db()
        self.assertEqual(self.occ_pos.status, ColdStoragePalletPosition.RESERVED_OUTBOUND)

        self.client.force_login(self.admin)
        response = self.client.delete(f"/api/admin/pending-transfers/{pending.id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.occ_pos.refresh_from_db()
        # Released back to OCCUPIED
        self.assertEqual(self.occ_pos.status, ColdStoragePalletPosition.OCCUPIED)
        # Current batch number preserved
        self.assertEqual(self.occ_pos.current_batch_number, "BATCH-OUT-100")
        # Transfer record deleted
        self.assertFalse(PendingTransferRequest.objects.filter(id=pending.id).exists())

    # 16. Deletion of failed transfer releases RESERVED_OUTBOUND -> OCCUPIED and preserves batch
    def test_16_delete_failed_transfer_releases_to_occupied(self):
        pending = self._create_outbound_test_transfer()
        _mark_pending_transfer_failed(pending, self.admin, "Posting failed")

        self.client.force_login(self.admin)
        response = self.client.delete(f"/api/admin/pending-transfers/{pending.id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.occ_pos.refresh_from_db()
        self.assertEqual(self.occ_pos.status, ColdStoragePalletPosition.OCCUPIED)
        self.assertEqual(self.occ_pos.current_batch_number, "BATCH-OUT-100")

    # 17. Idempotent vacate returns cleanly without error when already AVAILABLE
    def test_17_idempotent_vacate_returns_cleanly(self):
        pending = self._create_outbound_test_transfer()
        # Directly set position to AVAILABLE
        ColdStoragePalletPosition.objects.filter(id=self.occ_pos.id).update(
            status=ColdStoragePalletPosition.AVAILABLE
        )
        self.occ_pos.refresh_from_db()

        # Calling vacate helper should not raise an error
        result = vacate_source_pallet_position_for_transfer(pending, user=self.admin)
        self.assertIsNotNone(result)
        self.assertEqual(result.status, ColdStoragePalletPosition.AVAILABLE)

    # 18. Admin vacate endpoint remains functional as administrative override
    def test_18_admin_vacate_endpoint_remains_functional(self):
        self.client.force_login(self.admin)
        response = self.client.post(f"/api/cold-storage/positions/{self.occ_pos.id}/vacate/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.occ_pos.refresh_from_db()
        self.assertEqual(self.occ_pos.status, ColdStoragePalletPosition.AVAILABLE)
        self.assertEqual(self.occ_pos.current_batch_number, "")

    # 19. SAP payload contains batFromWarehouse bin allocations and zero physical position data
    def test_19_sap_payload_contains_source_bin_allocations_and_no_physical_pos(self):
        payload = {
            "transfer_stage": STAGE_3_FROM_FRIDGE,
            "from_warehouse": "20201",
            "from_bin": self.layout.bin_code,
            "to_warehouse": "90214",
            "to_bin": "",
            "source_pallet_position_id": self.occ_pos.id,
            "lines": [
                {
                    "item_code": "FG-20201",
                    "batch_number": "BATCH-OUT-100",
                    "quantity": 25.0,
                }
            ],
        }

        # Mock _get_bin_abs_entry and sap_client.create_stock_transfer to capture payload
        from unittest.mock import MagicMock
        captured_payloads = []

        def fake_create_stock_transfer(sap_pl):
            captured_payloads.append(sap_pl)
            return {"DocEntry": 120999, "DocNum": 450999}

        mock_client = MagicMock()
        mock_client.get_warehouse_details.side_effect = outbound_destination_metadata
        mock_client.create_stock_transfer.side_effect = fake_create_stock_transfer
        self.transfer_service.sap_client = mock_client
        self.transfer_service.use_mock = False

        with patch.object(self.transfer_service, "_get_bin_abs_entry", return_value=142):
            result = self.transfer_service.move_inventory(payload)
            self.assertTrue(result.get("success"))

        self.assertEqual(len(captured_payloads), 1)
        sap_payload = captured_payloads[0]

        # Verify SAP structure
        self.assertEqual(sap_payload["FromWarehouse"], "20201")
        self.assertEqual(sap_payload["ToWarehouse"], "90214")
        self.assertEqual(len(sap_payload["StockTransferLines"]), 1)
        line = sap_payload["StockTransferLines"][0]
        self.assertEqual(line["ItemCode"], "FG-20201")
        self.assertEqual(line["Quantity"], 25.0)

        allocs = line["StockTransferLinesBinAllocations"]
        self.assertEqual(len(allocs), 1)
        self.assertEqual(allocs[0]["BinAbsEntry"], 142)
        self.assertEqual(allocs[0]["BinActionType"], "batFromWarehouse")
        self.assertEqual(allocs[0]["Quantity"], 25.0)

        # Confirm ZERO physical position identifiers leaked to SAP
        payload_str = str(sap_payload)
        self.assertNotIn("pallet_position", payload_str)
        self.assertNotIn("source_pallet_position", payload_str)
        self.assertNotIn("position_id", payload_str)
        self.assertNotIn("position_code", payload_str)

    # 20. Inbound transfers (STAGE_2_TO_FRIDGE) continue to work normally (regression-free)
    @patch("api.views._assert_transfer_payload_sap_available")
    @patch("api.views.transfer_service.move_inventory")
    def test_20_inbound_transfers_regression_free(self, mock_move, mock_assert):
        mock_assert.return_value = True
        mock_move.return_value = {
            "success": True,
            "sap_doc_entry": 120888,
            "sap_doc_num": 450888,
            "mock": True,
        }

        inbound_pos = self.positions[3]
        self.assertEqual(inbound_pos.status, ColdStoragePalletPosition.AVAILABLE)

        pending = PendingTransferRequest.objects.create(
            transfer_stage=STAGE_2_TO_FRIDGE,
            from_warehouse="90214",
            to_warehouse="20201",
            to_bin=self.layout.bin_code,
            item_code="FG-IN-001",
            batch_number="BATCH-IN-001",
            quantity=15.0,
            status=PendingTransferRequest.PENDING,
            created_by=self.operator,
            pallet_position=inbound_pos,
            pallet_position_code=inbound_pos.position_code,
        )
        self.transfer_service.reserve_pallet_position_for_transfer(
            pending, inbound_pos.id, user=self.operator
        )
        inbound_pos.refresh_from_db()
        self.assertEqual(inbound_pos.status, ColdStoragePalletPosition.RESERVED)

        self.client.force_login(self.admin)
        response = self.client.post(f"/api/admin/pending-transfers/{pending.id}/post/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        pending.refresh_from_db()
        inbound_pos.refresh_from_db()

        self.assertEqual(pending.status, PendingTransferRequest.POSTED)
        self.assertEqual(inbound_pos.status, ColdStoragePalletPosition.OCCUPIED)
        self.assertEqual(inbound_pos.current_batch_number, "BATCH-IN-001")

    @patch("api.views.transfer_service.move_inventory")
    @patch("api.views._lookup_transfer_batch_source")
    def test_21_batch_mismatch_is_conflict_before_reservation(self, mock_lookup, mock_move):
        self.client.force_login(self.operator)
        pending_count = PendingTransferRequest.objects.count()
        payload = {
            "transfer_stage": STAGE_3_FROM_FRIDGE,
            "from_warehouse": "20201",
            "from_bin": self.layout.bin_code,
            "to_warehouse": "90214",
            "source_pallet_position_id": self.occ_pos.id,
            "lines": [{"item_code": "FG-20201", "batch_number": "BATCH-B", "quantity": 1}],
        }

        response = self.client.post("/api/transfer/move/", payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("contains batch BATCH-OUT-100", response.json()["error"])
        self.assertEqual(PendingTransferRequest.objects.count(), pending_count)
        self.occ_pos.refresh_from_db()
        self.assertEqual(self.occ_pos.status, ColdStoragePalletPosition.OCCUPIED)
        self.assertEqual(self.occ_pos.current_batch_number, "BATCH-OUT-100")
        self.assertEqual(self.occ_pos.reservation_reference, "INBOUND-RECEIPT")
        mock_lookup.assert_not_called()
        mock_move.assert_not_called()

    def test_22_missing_position_batch_is_conflict(self):
        ColdStoragePalletPosition.objects.filter(id=self.occ_pos.id).update(
            current_batch_number=""
        )
        payload = {
            "transfer_stage": STAGE_3_FROM_FRIDGE,
            "from_warehouse": "20201",
            "from_bin": self.layout.bin_code,
            "to_warehouse": "90214",
            "source_pallet_position_id": self.occ_pos.id,
            "lines": [{"item_code": "FG-20201", "batch_number": "BATCH-A", "quantity": 1}],
        }

        with self.assertRaises(TransferValidationError) as ctx:
            self.transfer_service._validate_move_payload(payload)

        self.assertIn("has no recorded current batch", str(ctx.exception))

    def test_23_multiple_batches_for_one_position_are_rejected(self):
        payload = {
            "transfer_stage": STAGE_3_FROM_FRIDGE,
            "from_warehouse": "20201",
            "from_bin": self.layout.bin_code,
            "to_warehouse": "90214",
            "source_pallet_position_id": self.occ_pos.id,
            "lines": [
                {"item_code": "FG-20201", "batch_number": "BATCH-OUT-100", "quantity": 1},
                {"item_code": "FG-20201", "batch_number": "BATCH-B", "quantity": 1},
            ],
        }

        with self.assertRaises(TransferValidationError) as ctx:
            self.transfer_service._validate_move_payload(payload)

        self.assertIn("contains multiple batch numbers", str(ctx.exception))


class TransferBatchBinQuantityTests(TestCase):
    def setUp(self):
        self.sap_client = MagicMock()
        self.sap_client.ensure_sql_query.return_value = {"success": True}
        self.service = TransferInventoryService(use_mock=False, sap_client=self.sap_client)

    def test_source_bin_with_zero_batch_quantity_is_rejected(self):
        self.sap_client.execute_sql_query.return_value = {"value": []}

        with self.assertRaises(Exception) as ctx:
            self.service.get_batch_details("BATCH-A", "20201", "BIN-A")

        self.assertIn("not found", str(ctx.exception))
        sql_code, _name, sql_text = self.sap_client.ensure_sql_query.call_args.args
        self.assertEqual(sql_code, "CODX_TRANS_BATCH_BIN_V1")
        self.assertIn('INNER JOIN "OBBQ"', sql_text)
        self.assertIn('INNER JOIN "OBIN"', sql_text)
        self.assertIn('T3."BinCode" = \'BIN-A\'', sql_text)
        self.assertIn('T1."OnHandQty" > 0', sql_text)

    def test_source_bin_with_batch_quantity_is_allowed(self):
        self.sap_client.execute_sql_query.return_value = {
            "value": [{
                "BatchAbsEntry": 10,
                "BatchNumber": "BATCH-A",
                "ItemCode": "FG-A",
                "ItemName": "Item A",
                "FromWarehouse": "20201",
                "FromBin": "BIN-A",
                "AvailableQuantity": 7,
                "UOM": "CTN",
                "ExpiryDate": None,
            }]
        }

        result = self.service.get_batch_details("BATCH-A", "20201", "BIN-A")

        self.assertEqual(result["available_quantity"], 7.0)
        self.assertEqual(result["from_bin"], "BIN-A")
        self.sap_client.execute_sql_query.assert_called_once_with("CODX_TRANS_BATCH_BIN_V1")

    def test_empty_from_bin_keeps_warehouse_level_query(self):
        self.sap_client.execute_sql_query.return_value = {"value": []}

        self.service._query_batch_bin_quantity("BATCH-A", "90214", "")

        sql_code, _name, sql_text = self.sap_client.ensure_sql_query.call_args.args
        self.assertEqual(sql_code, "CODX_TRANS_BATCH_WHS_V1")
        self.assertIn('INNER JOIN "OBTQ"', sql_text)
        self.assertNotIn('INNER JOIN "OBBQ"', sql_text)
