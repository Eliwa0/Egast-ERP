"""
Phase 6 Step 8: End-to-End Outbound Integration & Hardening Verification Suite.

Comprehensive end-to-end integration tests verifying:
1. Full Outbound Lifecycle: OCCUPIED -> RESERVED_OUTBOUND -> SAP SUCCESS -> AVAILABLE
2. Metadata Cleanliness: All position reservation/batch fields cleared upon SAP success
3. Snapshot Persistence: PendingTransferRequest maintains complete historical snapshot
4. SAP Failure Path: OCCUPIED -> RESERVED_OUTBOUND -> SAP FAILURE -> remains RESERVED_OUTBOUND
5. Cancellation / Reversal Path: OCCUPIED -> RESERVED_OUTBOUND -> CANCELLED -> OCCUPIED (with batch intact)
6. Concurrency / Conflict: Multi-client race condition handling (HTTP 409 Conflict)
7. SAP Payload Sanitization: Strict audit ensuring NO physical position fields or UDFs leak to SAP
8. Inbound Regression: STAGE_1 and STAGE_2 workflows remain 100% operational
9. Historical Data Compatibility: Legacy transfer records with NULL positions render cleanly
10. Admin Vacate Isolation: Admin override remains independent and intact
"""
import os
from unittest.mock import patch, MagicMock
from api.tests_cold_storage_outbound_api import outbound_destination_metadata
from django.test import TestCase
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from rest_framework import status

from api.models import PendingTransferRequest, UserProfile, TransferWarehouseRule
from api.models_cold_storage import ColdStorageBinLayout, ColdStoragePalletPosition
from api.services.transfer_service import (
    TransferInventoryService,
    TransferValidationError,
    STAGE_1_TO_INTERMEDIATE,
    STAGE_2_TO_FRIDGE,
    STAGE_3_FROM_FRIDGE,
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


class ColdStorageOutboundEndToEndTests(TestCase):
    def setUp(self):
        metadata = patch('api.views.sap.get_warehouse_details', side_effect=outbound_destination_metadata)
        metadata.start()
        self.addCleanup(metadata.stop)
        self.client = APIClient()
        self.transfer_service = TransferInventoryService(use_mock=True)

        # Users
        self.operator = User.objects.create_user(username='operator_e2e', password='password123')
        self.admin = User.objects.create_user(username='admin_e2e', password='password123')
        UserProfile.objects.filter(user=self.operator).update(role='transfer')
        UserProfile.objects.filter(user=self.admin).update(role='admin')

        # Environment configuration
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
        
        # Prepare an OCCUPIED position for testing outbound flow
        self.occ_pos = self.positions[0]
        self.occ_pos.status = ColdStoragePalletPosition.OCCUPIED
        self.occ_pos.current_batch_number = "BATCH-MEDJOOL-2026"
        self.occ_pos.transfer_reference = "PTR-HISTORIC-999"
        self.occ_pos.save()

    # -------------------------------------------------------------------------
    # 1. Complete Outbound Success Flow & Hardening Checks
    # -------------------------------------------------------------------------
    @patch("api.views._lookup_transfer_batch_source")
    @patch("api.views._assert_transfer_payload_sap_available")
    @patch("api.views.transfer_service.move_inventory")
    def test_01_complete_outbound_success_lifecycle(self, mock_move, mock_assert, mock_lookup):
        """
        Verify:
        TRANSFER -> Stage 3 Outbound -> Select OCCUPIED position
        -> PendingTransfer created -> OCCUPIED -> RESERVED_OUTBOUND
        -> SAP StockTransfer posted successfully
        -> PendingTransferRequest -> POSTED
        -> ColdStoragePalletPosition -> AVAILABLE
        -> metadata wiped on position, preserved on request snapshot
        """
        mock_assert.return_value = True
        mock_lookup.return_value = {
            "item_code": "FG-MEDJOOL",
            "item_name": "Medjool Dates",
            "batch_number": "BATCH-MEDJOOL-2026",
            "available_quantity": 100.0,
            "can_post_to_sap": True,
            "source_type": "SAP",
        }
        mock_move.return_value = {
            "success": True,
            "sap_doc_entry": 98765,
            "sap_doc_num": 12345,
            "mock": False,
        }

        self.client.force_login(self.operator)
        payload = {
            "transfer_stage": STAGE_3_FROM_FRIDGE,
            "from_warehouse": "20201",
            "from_bin": self.layout.bin_code,
            "to_warehouse": "90214",
            "to_bin": "",
            "source_pallet_position_id": self.occ_pos.id,
            "lines": [
                {
                    "item_code": "FG-MEDJOOL",
                    "batch_number": "BATCH-MEDJOOL-2026",
                    "quantity": 50.0,
                }
            ],
            "comments": "Outbound shipment for packaging",
        }

        # Step A: Create transfer request via /api/transfer/move/
        create_resp = self.client.post("/api/transfer/move/", payload, format="json")
        self.assertEqual(create_resp.status_code, status.HTTP_200_OK)
        req_data = create_resp.data
        self.assertTrue(req_data.get("success"))
        self.assertTrue(req_data.get("pending"))
        pending_id = req_data.get("pending_transfer_id")
        self.assertIsNotNone(pending_id)

        # Verify step A state: position is RESERVED_OUTBOUND
        self.occ_pos.refresh_from_db()
        self.assertEqual(self.occ_pos.status, ColdStoragePalletPosition.RESERVED_OUTBOUND)
        self.assertEqual(self.occ_pos.current_batch_number, "BATCH-MEDJOOL-2026")
        self.assertEqual(self.occ_pos.reservation_reference, f"OUTBOUND: PTR-{pending_id}")
        self.assertEqual(self.occ_pos.reserved_by, self.operator)
        self.assertIsNotNone(self.occ_pos.reserved_at)

        # Step B: Approve and Post to SAP
        self.client.force_login(self.admin)
        post_resp = self.client.post(f"/api/admin/pending-transfers/{pending_id}/post/")
        self.assertEqual(post_resp.status_code, status.HTTP_200_OK)

        # Step C: Verify end state
        pending = PendingTransferRequest.objects.get(id=pending_id)
        self.occ_pos.refresh_from_db()

        # 1. PendingTransferRequest status & snapshot
        self.assertEqual(pending.status, PendingTransferRequest.POSTED)
        self.assertEqual(pending.sap_doc_entry, "98765")
        self.assertEqual(pending.sap_doc_num, "12345")
        self.assertEqual(pending.source_pallet_position_id, self.occ_pos.id)
        self.assertEqual(pending.source_pallet_position_code, self.occ_pos.position_code)

        # 2. ColdStoragePalletPosition state & cleaned metadata
        self.assertEqual(self.occ_pos.status, ColdStoragePalletPosition.AVAILABLE)
        self.assertEqual(self.occ_pos.current_batch_number, "")
        self.assertEqual(self.occ_pos.reservation_reference, "")
        self.assertEqual(self.occ_pos.transfer_reference, "")
        self.assertIsNone(self.occ_pos.reserved_by)
        self.assertIsNone(self.occ_pos.reserved_at)

    # -------------------------------------------------------------------------
    # 2. SAP Failure Path
    # -------------------------------------------------------------------------
    @patch("api.views._assert_transfer_payload_sap_available")
    @patch("api.views.transfer_service.move_inventory")
    def test_02_sap_failure_retains_reserved_outbound(self, mock_move, mock_assert):
        """
        Verify:
        SAP posting failure -> PendingTransferRequest becomes FAILED
        -> ColdStoragePalletPosition remains strictly RESERVED_OUTBOUND
        -> Does NOT prematurely vacate to AVAILABLE
        -> Does NOT leave broken database state
        """
        mock_assert.return_value = True
        mock_move.side_effect = Exception("SAP Service Layer timeout (Error 504)")

        pending = PendingTransferRequest.objects.create(
            transfer_stage=STAGE_3_FROM_FRIDGE,
            from_warehouse="20201",
            from_bin=self.layout.bin_code,
            to_warehouse="90214",
            item_code="FG-MEDJOOL",
            batch_number="BATCH-MEDJOOL-2026",
            quantity=50.0,
            status=PendingTransferRequest.PENDING,
            created_by=self.operator,
            source_pallet_position=self.occ_pos,
            source_pallet_position_code=self.occ_pos.position_code,
        )
        pending.raw_payload_json = {
            'transfer_stage': STAGE_3_FROM_FRIDGE, 'from_warehouse': '20201',
            'from_bin': self.layout.bin_code, 'to_warehouse': '90214',
            'source_pallet_position_id': self.occ_pos.pk,
            'lines': [{'item_code':'FG-MEDJOOL','batch_number':'BATCH-MEDJOOL-2026','quantity':50.0}],
        }
        pending.save(update_fields=['raw_payload_json'])
        reserve_source_pallet_position_for_transfer(pending, self.occ_pos.id, user=self.operator)
        self.occ_pos.refresh_from_db()
        self.assertEqual(self.occ_pos.status, ColdStoragePalletPosition.RESERVED_OUTBOUND)

        self.client.force_login(self.admin)
        post_resp = self.client.post(f"/api/admin/pending-transfers/{pending.id}/post/")
        self.assertEqual(post_resp.status_code, status.HTTP_400_BAD_REQUEST)

        pending.refresh_from_db()
        self.occ_pos.refresh_from_db()

        self.assertEqual(pending.status, PendingTransferRequest.FAILED)
        self.assertIn("504", pending.error_message)
        # Position must remain RESERVED_OUTBOUND
        self.assertEqual(self.occ_pos.status, ColdStoragePalletPosition.RESERVED_OUTBOUND)
        self.assertEqual(self.occ_pos.current_batch_number, "BATCH-MEDJOOL-2026")
        self.assertEqual(self.occ_pos.reservation_reference, f"OUTBOUND: PTR-{pending.id}")

    # -------------------------------------------------------------------------
    # 3. Cancellation / Reversal Path
    # -------------------------------------------------------------------------
    def test_03_outbound_cancellation_reverts_to_occupied_with_batch(self):
        """
        Verify:
        Cancellation/deletion of pending outbound transfer
        -> Position returns to OCCUPIED
        -> Original current_batch_number preserved
        -> reservation_reference cleared
        -> reserved_by / reserved_at cleared
        """
        pending = PendingTransferRequest.objects.create(
            transfer_stage=STAGE_3_FROM_FRIDGE,
            from_warehouse="20201",
            from_bin=self.layout.bin_code,
            to_warehouse="90214",
            item_code="FG-MEDJOOL",
            batch_number="BATCH-MEDJOOL-2026",
            quantity=50.0,
            status=PendingTransferRequest.PENDING,
            created_by=self.operator,
            source_pallet_position=self.occ_pos,
            source_pallet_position_code=self.occ_pos.position_code,
        )
        reserve_source_pallet_position_for_transfer(pending, self.occ_pos.id, user=self.operator)

        self.client.force_login(self.admin)
        del_resp = self.client.delete(f"/api/admin/pending-transfers/{pending.id}/")
        self.assertEqual(del_resp.status_code, status.HTTP_200_OK)

        self.occ_pos.refresh_from_db()
        self.assertEqual(self.occ_pos.status, ColdStoragePalletPosition.OCCUPIED)
        self.assertEqual(self.occ_pos.current_batch_number, "BATCH-MEDJOOL-2026")
        self.assertEqual(self.occ_pos.reservation_reference, "")
        self.assertIsNone(self.occ_pos.reserved_by)
        self.assertIsNone(self.occ_pos.reserved_at)
        self.assertFalse(PendingTransferRequest.objects.filter(id=pending.id).exists())

    # -------------------------------------------------------------------------
    # 4. Concurrency & Conflict Protection
    # -------------------------------------------------------------------------
    @patch("api.views._lookup_transfer_batch_source")
    @patch("api.views._assert_transfer_payload_sap_available")
    def test_04_concurrency_conflict_returns_409(self, mock_assert, mock_lookup):
        """
        Verify:
        When position is already RESERVED_OUTBOUND (e.g. by another session),
        a second transfer request for the same position is rejected with 409 Conflict.
        """
        mock_assert.return_value = True
        mock_lookup.return_value = {
            "item_code": "FG-MEDJOOL",
            "item_name": "Medjool Dates",
            "batch_number": "BATCH-MEDJOOL-2026",
            "available_quantity": 100.0,
            "can_post_to_sap": True,
            "source_type": "SAP",
        }

        # User 1 reserves the position
        pending1 = PendingTransferRequest.objects.create(
            transfer_stage=STAGE_3_FROM_FRIDGE,
            from_warehouse="20201",
            from_bin=self.layout.bin_code,
            to_warehouse="90214",
            item_code="FG-MEDJOOL",
            batch_number="BATCH-MEDJOOL-2026",
            quantity=50.0,
            status=PendingTransferRequest.PENDING,
            created_by=self.operator,
            source_pallet_position=self.occ_pos,
            source_pallet_position_code=self.occ_pos.position_code,
        )
        reserve_source_pallet_position_for_transfer(pending1, self.occ_pos.id, user=self.operator)

        # User 2 attempts to create a transfer using the same position
        self.client.force_login(self.operator)
        conflict_payload = {
            "transfer_stage": STAGE_3_FROM_FRIDGE,
            "from_warehouse": "20201",
            "from_bin": self.layout.bin_code,
            "to_warehouse": "90214",
            "to_bin": "",
            "source_pallet_position_id": self.occ_pos.id,
            "lines": [
                {
                    "item_code": "FG-MEDJOOL",
                    "batch_number": "BATCH-MEDJOOL-2026",
                    "quantity": 50.0,
                }
            ],
        }

        resp = self.client.post("/api/transfer/move/", conflict_payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("RESERVED_OUTBOUND", resp.data.get("error", ""))

    # -------------------------------------------------------------------------
    # 5. Non-Allocatable Bin Layout Rejection
    # -------------------------------------------------------------------------
    def test_05_non_allocatable_bin_position_rejected(self):
        """
        Verify:
        Position in a bin marked NON_ALLOCATABLE or UNCONFIGURED cannot be reserved for outbound.
        """
        staging_layout = ColdStorageBinLayout.objects.create(
            warehouse_code='20201',
            bin_code='20201-STAGE-01',
            sap_bin_abs_entry=999,
            allocation_type=ColdStorageBinLayout.ALLOC_NON_ALLOCATABLE,
            capacity=1,
        )
        staging_pos = staging_layout.positions.first()
        staging_pos.status = ColdStoragePalletPosition.OCCUPIED
        staging_pos.current_batch_number = "BATCH-STAGE"
        staging_pos.save()

        pending = PendingTransferRequest.objects.create(
            transfer_stage=STAGE_3_FROM_FRIDGE,
            from_warehouse="20201",
            from_bin=staging_layout.bin_code,
            to_warehouse="90214",
            item_code="FG-STAGE",
            batch_number="BATCH-STAGE",
            quantity=10.0,
            status=PendingTransferRequest.PENDING,
            created_by=self.operator,
        )

        with self.assertRaises(TransferValidationError) as ctx:
            reserve_source_pallet_position_for_transfer(pending, staging_pos.id, user=self.operator)
        self.assertIn("non_allocatable", str(ctx.exception).lower())

    # -------------------------------------------------------------------------
    # 6. SAP Payload Sanitization (Strict Physical Position Leak Check)
    # -------------------------------------------------------------------------
    def test_06_sap_payload_inspection_no_physical_position_leak(self):
        """
        Verify:
        StockTransfer payload generated for SAP:
        - Contains correct FromWarehouse, ToWarehouse
        - Contains correct BinAbsEntry and batFromWarehouse allocation
        - Strictly contains NO physical position fields, IDs, or custom UDFs
        """
        payload = {
            "transfer_stage": STAGE_3_FROM_FRIDGE,
            "from_warehouse": "20201",
            "from_bin": self.layout.bin_code,
            "to_warehouse": "90214",
            "to_bin": "",
            "source_pallet_position_id": self.occ_pos.id,
            "lines": [
                {
                    "item_code": "FG-MEDJOOL",
                    "batch_number": "BATCH-MEDJOOL-2026",
                    "quantity": 100.0,
                }
            ],
            "comments": "Audited outbound SAP transfer",
        }

        captured_sap_payloads = []

        def mock_sap_transfer(sap_pl):
            captured_sap_payloads.append(sap_pl)
            return {"DocEntry": 777123, "DocNum": 777456}

        mock_client = MagicMock()
        mock_client.get_warehouse_details.side_effect = outbound_destination_metadata
        mock_client.create_stock_transfer.side_effect = mock_sap_transfer
        self.transfer_service.sap_client = mock_client
        self.transfer_service.use_mock = False

        with patch.object(self.transfer_service, "_get_bin_abs_entry", return_value=142):
            result = self.transfer_service.move_inventory(payload)
            self.assertTrue(result.get("success"))

        self.assertEqual(len(captured_sap_payloads), 1)
        sap_payload = captured_sap_payloads[0]

        # Validations on SAP schema
        self.assertEqual(sap_payload["FromWarehouse"], "20201")
        self.assertEqual(sap_payload["ToWarehouse"], "90214")

        lines = sap_payload.get("StockTransferLines", [])
        self.assertEqual(len(lines), 1)
        line = lines[0]
        self.assertEqual(line["ItemCode"], "FG-MEDJOOL")
        self.assertEqual(line["Quantity"], 100.0)

        # Bin allocations
        allocs = line.get("StockTransferLinesBinAllocations", [])
        self.assertEqual(len(allocs), 1)
        self.assertEqual(allocs[0]["BinAbsEntry"], 142)
        self.assertEqual(allocs[0]["BinActionType"], "batFromWarehouse")
        self.assertEqual(allocs[0]["Quantity"], 100.0)

        # Batch numbers
        batches = line.get("BatchNumbers", [])
        self.assertEqual(len(batches), 1)
        self.assertEqual(batches[0]["BatchNumber"], "BATCH-MEDJOOL-2026")
        self.assertEqual(batches[0]["Quantity"], 100.0)

        # STRICT NEGATIVE CHECKS: No physical position identifiers or UDFs anywhere
        serialized_payload = str(sap_payload)
        forbidden_keywords = [
            "pallet_position",
            "source_pallet_position",
            "pallet_position_id",
            "pallet_position_code",
            "position_id",
            "position_code",
            "U_PalletPos",
            "U_PosCode",
            "U_PhysicalBin",
        ]
        for kw in forbidden_keywords:
            self.assertNotIn(kw, serialized_payload, f"Forbidden keyword '{kw}' found in SAP payload!")

    # -------------------------------------------------------------------------
    # 7. Inbound Flow Regression Protection
    # -------------------------------------------------------------------------
    @patch("api.views._assert_transfer_payload_sap_available")
    @patch("api.views.transfer_service.move_inventory")
    def test_07_inbound_flow_remains_operational(self, mock_move, mock_assert):
        """
        Verify:
        STAGE_1_TO_INTERMEDIATE unaffected (no pallet positions needed)
        STAGE_2_TO_FRIDGE works as expected:
        AVAILABLE -> RESERVED -> SAP SUCCESS -> OCCUPIED
        """
        mock_assert.return_value = True
        mock_move.return_value = {
            "success": True,
            "sap_doc_entry": 555001,
            "sap_doc_num": 555002,
            "mock": True,
        }

        # Inbound position
        inbound_pos = self.positions[2]
        self.assertEqual(inbound_pos.status, ColdStoragePalletPosition.AVAILABLE)

        # Create inbound Stage 2 transfer
        pending = PendingTransferRequest.objects.create(
            transfer_stage=STAGE_2_TO_FRIDGE,
            from_warehouse="90214",
            to_warehouse="20201",
            to_bin=self.layout.bin_code,
            item_code="FG-INBOUND-01",
            batch_number="BATCH-IN-99",
            quantity=20.0,
            status=PendingTransferRequest.PENDING,
            created_by=self.operator,
            pallet_position=inbound_pos,
            pallet_position_code=inbound_pos.position_code,
        )
        reserve_pallet_position_for_transfer(pending, inbound_pos.id, user=self.operator)
        inbound_pos.refresh_from_db()
        self.assertEqual(inbound_pos.status, ColdStoragePalletPosition.RESERVED)

        # Post to SAP
        self.client.force_login(self.admin)
        resp = self.client.post(f"/api/admin/pending-transfers/{pending.id}/post/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        pending.refresh_from_db()
        inbound_pos.refresh_from_db()

        self.assertEqual(pending.status, PendingTransferRequest.POSTED)
        self.assertEqual(inbound_pos.status, ColdStoragePalletPosition.OCCUPIED)
        self.assertEqual(inbound_pos.current_batch_number, "BATCH-IN-99")

    # -------------------------------------------------------------------------
    # 8. Historical Data Compatibility
    # -------------------------------------------------------------------------
    def test_08_historical_transfer_null_position_compatibility(self):
        """
        Verify:
        Historical PendingTransferRequest rows with:
        source_pallet_position = NULL
        source_pallet_position_code = ""
        pallet_position = NULL
        pallet_position_code = ""
        are viewed, listed, and serialized without any 500 error or crash.
        """
        historical = PendingTransferRequest.objects.create(
            transfer_stage=STAGE_1_TO_INTERMEDIATE,
            from_warehouse="WH-OLD",
            to_warehouse="90214",
            item_code="FG-OLD",
            batch_number="BATCH-OLD",
            quantity=100.0,
            status=PendingTransferRequest.POSTED,
            created_by=self.operator,
            pallet_position=None,
            pallet_position_code="",
            source_pallet_position=None,
            source_pallet_position_code="",
        )

        self.client.force_login(self.admin)
        # List endpoint
        list_resp = self.client.get("/api/admin/pending-transfers/")
        self.assertEqual(list_resp.status_code, status.HTTP_200_OK)

        # Detail serialization helper
        data = _pending_transfer_to_dict(historical)
        self.assertIsNone(data["source_pallet_position_id"])
        self.assertEqual(data["source_pallet_position_code"], "")
        self.assertIsNone(data["pallet_position_id"])
        self.assertEqual(data["pallet_position_code"], "")

    # -------------------------------------------------------------------------
    # 9. Admin Vacate Endpoint Isolation
    # -------------------------------------------------------------------------
    def test_09_admin_vacate_endpoint_isolation(self):
        """
        Verify:
        The administrative vacate endpoint directly resets the position to AVAILABLE
        without requiring or posting to SAP, functioning purely as an operational override.
        """
        self.client.force_login(self.admin)
        resp = self.client.post(f"/api/cold-storage/positions/{self.occ_pos.id}/vacate/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        self.occ_pos.refresh_from_db()
        self.assertEqual(self.occ_pos.status, ColdStoragePalletPosition.AVAILABLE)
        self.assertEqual(self.occ_pos.current_batch_number, "")
        self.assertEqual(self.occ_pos.reservation_reference, "")
        self.assertEqual(self.occ_pos.transfer_reference, "")
