"""
Tests for Phase 6 Step 1: Cold Storage Pallet Position <-> Transfer Integration.

Verifies:
1. Existing Transfer can have NULL pallet_position.
2. Transfer can be associated with an AVAILABLE position.
3. Reservation changes AVAILABLE -> RESERVED.
4. pallet_position is stored on PendingTransferRequest.
5. pallet_position_code is stored correctly as a snapshot.
6. transfer_reference (PTR-<id>) is stored in reservation metadata.
7. Attempting to reserve an already RESERVED position fails (concurrency/conflict).
8. Attempting to reserve OCCUPIED position fails.
9. Attempting to reserve MAINTENANCE position fails.
10. Cancellation/deletion releases RESERVED -> AVAILABLE.
11. Cancellation does NOT release an OCCUPIED position.
12. Existing Transfer records continue to load correctly.
13. Atomic rollback on reservation conflict in _create_pending_transfer_request.
14. Non-allocatable or unconfigured bin position cannot be reserved.
"""
from unittest.mock import patch
from django.test import TestCase
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from rest_framework import status

from api.models import PendingTransferRequest, UserProfile
from api.models_cold_storage import ColdStorageBinLayout, ColdStoragePalletPosition
from api.services.transfer_service import (
    TransferInventoryService,
    TransferValidationError,
    reserve_pallet_position_for_transfer,
    release_pallet_position_for_transfer,
    occupy_pallet_position_for_transfer,
)
from api.views import (
    _pending_transfer_to_dict,
    _create_pending_transfer_request,
    _post_pending_transfer_record,
    _mark_pending_transfer_failed,
)


class ColdStorageTransferIntegrationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.transfer_service = TransferInventoryService(use_mock=True)

        # Users
        self.operator = User.objects.create_user(username='operator_transfer', password='password123')
        self.admin = User.objects.create_user(username='admin_transfer', password='password123')
        UserProfile.objects.filter(user=self.operator).update(role='transfer')
        UserProfile.objects.filter(user=self.admin).update(role='admin')

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

    def _create_test_transfer(self, **kwargs):
        stage = kwargs.get("transfer_stage", "STAGE_2_TO_FRIDGE")
        from_whs = kwargs.get("from_warehouse", "90214")
        to_whs = kwargs.get("to_warehouse", "20201")
        to_bin = kwargs.get("to_bin", self.layout.bin_code if stage == "STAGE_2_TO_FRIDGE" else "")
        batch = kwargs.get("batch_number", "BATCH-001")
        qty = kwargs.get("quantity", 10.0)
        item_code = kwargs.get("item_code", "ITEM-001")
        lines = kwargs.get("lines", [
            {
                "item_code": item_code,
                "batch_number": batch,
                "quantity": qty,
            }
        ])
        raw_payload = kwargs.get("raw_payload_json", {
            "transfer_stage": stage,
            "from_warehouse": from_whs,
            "from_bin": kwargs.get("from_bin", ""),
            "to_warehouse": to_whs,
            "to_bin": to_bin,
            "lines": lines,
        })
        fields = {
            "transfer_stage": stage,
            "from_warehouse": from_whs,
            "from_bin": kwargs.get("from_bin", ""),
            "to_warehouse": to_whs,
            "to_bin": to_bin,
            "item_code": item_code,
            "item_name": kwargs.get("item_name", "Test Item"),
            "batch_number": batch,
            "quantity": qty,
            "lines": lines,
            "raw_payload_json": raw_payload,
            "status": kwargs.get("status", PendingTransferRequest.PENDING),
            "created_by": kwargs.get("created_by", self.operator),
        }
        for k, v in kwargs.items():
            fields[k] = v
        if "raw_payload_json" not in kwargs:
            fields["raw_payload_json"] = raw_payload
        return PendingTransferRequest.objects.create(**fields)

    # 1. Existing Transfer can have NULL pallet_position
    def test_01_existing_transfer_can_have_null_pallet_position(self):
        pending = PendingTransferRequest.objects.create(
            transfer_stage='STAGE_1_TO_INTERMEDIATE',
            from_warehouse='20203',
            to_warehouse='90214',
            item_code='ITEM-001',
            item_name='Test Item',
            batch_number='BATCH-001',
            quantity=10.0,
            status=PendingTransferRequest.PENDING,
            created_by=self.operator,
        )
        self.assertIsNone(pending.pallet_position)
        self.assertEqual(pending.pallet_position_code, '')

        serialized = _pending_transfer_to_dict(pending)
        self.assertIsNone(serialized.get('pallet_position_id'))
        self.assertEqual(serialized.get('pallet_position_code'), '')

    # 2. Transfer can be associated with an AVAILABLE position
    # 3. Reservation changes AVAILABLE -> RESERVED
    # 4. pallet_position is stored on PendingTransferRequest
    # 5. pallet_position_code is stored correctly
    # 6. transfer_reference is stored in reservation metadata
    def test_02_to_06_reserve_available_position_for_transfer(self):
        pos = self.positions[0]
        self.assertEqual(pos.status, ColdStoragePalletPosition.AVAILABLE)

        pending = PendingTransferRequest.objects.create(
            transfer_stage='STAGE_2_TO_FRIDGE',
            from_warehouse='90214',
            to_warehouse='20201',
            to_bin='20201-F01-R01-C01-RA',
            item_code='ITEM-001',
            item_name='Test Item',
            batch_number='BATCH-001',
            quantity=10.0,
            status=PendingTransferRequest.PENDING,
            created_by=self.operator,
        )

        # Reserve
        self.transfer_service.reserve_pallet_position_for_transfer(pending, pos.id, user=self.operator)

        # Refresh from database
        pending.refresh_from_db()
        pos.refresh_from_db()

        # Invariant verifications:
        # 3. AVAILABLE -> RESERVED
        self.assertEqual(pos.status, ColdStoragePalletPosition.RESERVED)
        # 4. pallet_position stored on PendingTransferRequest
        self.assertEqual(pending.pallet_position_id, pos.id)
        # 5. pallet_position_code stored correctly
        self.assertEqual(pending.pallet_position_code, pos.position_code)
        self.assertEqual(pending.pallet_position_code, '01')
        # 6. transfer_reference stored in reservation metadata
        self.assertEqual(pos.transfer_reference, f"PTR-{pending.id}")
        self.assertEqual(pos.reservation_reference, f"PTR-{pending.id}")
        self.assertEqual(pos.reserved_by, self.operator)
        self.assertIsNotNone(pos.reserved_at)

        # Serialization includes position
        serialized = _pending_transfer_to_dict(pending)
        self.assertEqual(serialized.get('pallet_position_id'), pos.id)
        self.assertEqual(serialized.get('pallet_position_code'), '01')

    # 7. Attempting to reserve an already RESERVED position fails
    def test_07_attempting_to_reserve_already_reserved_position_fails(self):
        pos = self.positions[0]
        pending_1 = PendingTransferRequest.objects.create(
            transfer_stage='STAGE_2_TO_FRIDGE',
            from_warehouse='90214',
            to_warehouse='20201',
            to_bin=self.layout.bin_code,
            batch_number='BATCH-001',
            status=PendingTransferRequest.PENDING,
            created_by=self.operator,
        )
        self.transfer_service.reserve_pallet_position_for_transfer(pending_1, pos.id, user=self.operator)

        # Second transfer attempts to reserve same position
        pending_2 = PendingTransferRequest.objects.create(
            transfer_stage='STAGE_2_TO_FRIDGE',
            from_warehouse='90214',
            to_warehouse='20201',
            to_bin=self.layout.bin_code,
            batch_number='BATCH-002',
            status=PendingTransferRequest.PENDING,
            created_by=self.operator,
        )

        with self.assertRaises(ValueError):
            self.transfer_service.reserve_pallet_position_for_transfer(pending_2, pos.id, user=self.operator)

        # Verify pending_2 was not assigned
        pending_2.refresh_from_db()
        self.assertIsNone(pending_2.pallet_position)
        self.assertEqual(pending_2.pallet_position_code, '')

        # Verify pos ownership unchanged
        pos.refresh_from_db()
        self.assertEqual(pos.status, ColdStoragePalletPosition.RESERVED)
        self.assertEqual(pos.transfer_reference, f"PTR-{pending_1.id}")

    # 8. Attempting to reserve OCCUPIED position fails
    def test_08_attempting_to_reserve_occupied_position_fails(self):
        pos = self.positions[1]
        ColdStoragePalletPosition.occupy_position(
            position_id=pos.id,
            user=self.operator,
            batch_number='EXISTING-BATCH',
            reference='STOCK-001',
        )
        pos.refresh_from_db()
        self.assertEqual(pos.status, ColdStoragePalletPosition.OCCUPIED)

        pending = PendingTransferRequest.objects.create(
            transfer_stage='STAGE_2_TO_FRIDGE',
            from_warehouse='90214',
            to_warehouse='20201',
            to_bin=self.layout.bin_code,
            batch_number='NEW-BATCH',
            status=PendingTransferRequest.PENDING,
            created_by=self.operator,
        )

        with self.assertRaises(ValueError):
            self.transfer_service.reserve_pallet_position_for_transfer(pending, pos.id, user=self.operator)

        pending.refresh_from_db()
        self.assertIsNone(pending.pallet_position)

    # 9. Attempting to reserve MAINTENANCE position fails
    def test_09_attempting_to_reserve_maintenance_position_fails(self):
        pos = self.positions[2]
        ColdStoragePalletPosition.set_maintenance(position_id=pos.id, user=self.operator, notes='Broken rail')
        pos.refresh_from_db()
        self.assertEqual(pos.status, ColdStoragePalletPosition.MAINTENANCE)

        pending = PendingTransferRequest.objects.create(
            transfer_stage='STAGE_2_TO_FRIDGE',
            from_warehouse='90214',
            to_warehouse='20201',
            to_bin=self.layout.bin_code,
            batch_number='BATCH-003',
            status=PendingTransferRequest.PENDING,
            created_by=self.operator,
        )

        with self.assertRaises(ValueError):
            self.transfer_service.reserve_pallet_position_for_transfer(pending, pos.id, user=self.operator)

        pending.refresh_from_db()
        self.assertIsNone(pending.pallet_position)

    # 10. Cancellation/deletion releases RESERVED -> AVAILABLE
    def test_10_cancellation_deletion_releases_reserved_to_available(self):
        pos = self.positions[0]
        pending = PendingTransferRequest.objects.create(
            transfer_stage='STAGE_2_TO_FRIDGE',
            from_warehouse='90214',
            to_warehouse='20201',
            to_bin=self.layout.bin_code,
            batch_number='BATCH-CANCEL',
            status=PendingTransferRequest.PENDING,
            created_by=self.operator,
        )
        self.transfer_service.reserve_pallet_position_for_transfer(pending, pos.id, user=self.operator)

        pos.refresh_from_db()
        self.assertEqual(pos.status, ColdStoragePalletPosition.RESERVED)

        # Service release
        released = self.transfer_service.release_pallet_position_for_transfer(pending, user=self.operator)
        self.assertIsNotNone(released)

        pos.refresh_from_db()
        self.assertEqual(pos.status, ColdStoragePalletPosition.AVAILABLE)
        self.assertIsNone(pos.reserved_by)
        self.assertEqual(pos.transfer_reference, '')
        self.assertEqual(pos.reservation_reference, '')

        pending.refresh_from_db()
        self.assertIsNone(pending.pallet_position)
        self.assertEqual(pending.pallet_position_code, '')

    # 10b. Deletion via DELETE API endpoint releases position
    def test_10b_api_delete_pending_transfer_releases_reservation(self):
        pos = self.positions[3]
        pending = PendingTransferRequest.objects.create(
            transfer_stage='STAGE_2_TO_FRIDGE',
            from_warehouse='90214',
            to_warehouse='20201',
            to_bin=self.layout.bin_code,
            batch_number='BATCH-API-DEL',
            status=PendingTransferRequest.PENDING,
            created_by=self.operator,
        )
        self.transfer_service.reserve_pallet_position_for_transfer(pending, pos.id, user=self.operator)

        pos.refresh_from_db()
        self.assertEqual(pos.status, ColdStoragePalletPosition.RESERVED)

        # Perform DELETE via API
        self.client.force_login(self.admin)
        response = self.client.delete(f"/api/admin/pending-transfers/{pending.id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Transfer is deleted
        self.assertFalse(PendingTransferRequest.objects.filter(id=pending.id).exists())

        # Position is restored to AVAILABLE
        pos.refresh_from_db()
        self.assertEqual(pos.status, ColdStoragePalletPosition.AVAILABLE)
        self.assertIsNone(pos.reserved_by)
        self.assertEqual(pos.transfer_reference, '')

    # 11. Cancellation does NOT release an OCCUPIED position
    def test_11_cancellation_does_not_release_occupied_position(self):
        pos = self.positions[4]
        # Put position directly to OCCUPIED
        ColdStoragePalletPosition.occupy_position(
            position_id=pos.id,
            user=self.operator,
            batch_number='OCC-BATCH',
            reference='INIT',
        )
        pos.refresh_from_db()
        self.assertEqual(pos.status, ColdStoragePalletPosition.OCCUPIED)

        # Manually link to pending transfer to simulate anomaly
        pending = PendingTransferRequest.objects.create(
            transfer_stage='STAGE_2_TO_FRIDGE',
            from_warehouse='90214',
            to_warehouse='20201',
            batch_number='OCC-BATCH',
            pallet_position=pos,
            pallet_position_code=pos.position_code,
            status=PendingTransferRequest.PENDING,
            created_by=self.operator,
        )

        with self.assertRaises(ValueError):
            self.transfer_service.release_pallet_position_for_transfer(pending, user=self.operator)

        # Verify position remains OCCUPIED
        pos.refresh_from_db()
        self.assertEqual(pos.status, ColdStoragePalletPosition.OCCUPIED)

    # 12. Existing Transfer records continue to load correctly
    def test_12_existing_transfer_records_continue_to_load_correctly(self):
        records = PendingTransferRequest.objects.all()
        for ptr in records:
            d = _pending_transfer_to_dict(ptr)
            self.assertIn('pallet_position_id', d)
            self.assertIn('pallet_position_code', d)
            self.assertIn('id', d)
            self.assertIn('transfer_stage', d)

    # 13. Atomic rollback on reservation conflict in _create_pending_transfer_request
    def test_13_atomic_rollback_on_reservation_conflict(self):
        pos = self.positions[0]
        # Reserve pos first
        ColdStoragePalletPosition.reserve_position(pos.id, user=self.operator, reference='BLOCKER')

        initial_count = PendingTransferRequest.objects.count()

        payload = {
            'transfer_stage': 'STAGE_2_TO_FRIDGE',
            'from_warehouse': '90214',
            'to_warehouse': '20201',
            'to_bin': self.layout.bin_code,
            'pallet_position_id': pos.id,
            'lines': [
                {
                    'item_code': 'ITEM-001',
                    'item_name': 'Test Item',
                    'batch_number': 'BATCH-ROLLEDBACK',
                    'quantity': 5.0,
                }
            ],
        }

        with self.assertRaises(ValueError):
            _create_pending_transfer_request(self.operator, payload)

        # PendingTransferRequest count must NOT have increased (atomic rollback)
        self.assertEqual(PendingTransferRequest.objects.count(), initial_count)

    # 14. Non-allocatable or unconfigured bin cannot be reserved
    def test_14_non_allocatable_or_unconfigured_bin_cannot_be_reserved(self):
        non_alloc_layout = ColdStorageBinLayout.objects.create(
            warehouse_code='20201',
            bin_code='20201-SYSTEM-BIN',
            sap_bin_abs_entry=9999,
            allocation_type=ColdStorageBinLayout.ALLOC_NON_ALLOCATABLE,
            capacity=1,
        )
        pos = non_alloc_layout.positions.first()

        pending = PendingTransferRequest.objects.create(
            transfer_stage='STAGE_2_TO_FRIDGE',
            from_warehouse='90214',
            to_warehouse='20201',
            to_bin=non_alloc_layout.bin_code,
            batch_number='BATCH-NON-ALLOC',
            status=PendingTransferRequest.PENDING,
            created_by=self.operator,
        )

        with self.assertRaises(ValueError):
            self.transfer_service.reserve_pallet_position_for_transfer(pending, pos.id, user=self.operator)

        pending.refresh_from_db()
        self.assertIsNone(pending.pallet_position)

    # ── Phase 6 Step 2 Tests: SAP Success -> OCCUPIED ──────────────────────────

    # 15. Successful SAP posting changes: RESERVED -> OCCUPIED
    # 16. Occupied position contains correct batch_number and transfer_reference
    @patch("api.views._assert_transfer_payload_sap_available")
    @patch("api.views.transfer_service.move_inventory")
    def test_15_16_sap_success_occupies_reserved_position(self, mock_move, mock_assert):
        mock_assert.return_value = True
        mock_move.return_value = {"sap_doc_entry": "8881", "sap_doc_num": "DOC-8881"}

        pos = self.positions[0]
        pending = self._create_test_transfer(
            batch_number="BATCH-SUCC-01",
        )
        self.transfer_service.reserve_pallet_position_for_transfer(pending, pos.id, user=self.operator)

        pos.refresh_from_db()
        self.assertEqual(pos.status, ColdStoragePalletPosition.RESERVED)

        # Confirm SAP posting
        _post_pending_transfer_record(pending, self.admin)

        pending.refresh_from_db()
        pos.refresh_from_db()

        # Invariant 1: Transfer is POSTED with SAP doc number
        self.assertEqual(pending.status, PendingTransferRequest.POSTED)
        self.assertEqual(pending.sap_doc_num, "DOC-8881")
        self.assertEqual(pending.sap_doc_entry, "8881")

        # Invariant 2: Position is OCCUPIED
        self.assertEqual(pos.status, ColdStoragePalletPosition.OCCUPIED)
        # Invariant 3: current_batch_number matches transfer batch
        self.assertEqual(pos.current_batch_number, "BATCH-SUCC-01")
        # Invariant 4: transfer_reference matches PTR-<id>
        self.assertEqual(pos.transfer_reference, f"PTR-{pending.id}")
        self.assertEqual(pos.reserved_by, self.admin)

    # 17. SAP failure leaves position in RESERVED state
    @patch("api.views._assert_transfer_payload_sap_available")
    @patch("api.views.transfer_service.move_inventory")
    def test_17_sap_failure_leaves_position_reserved(self, mock_move, mock_assert):
        mock_assert.return_value = True
        mock_move.side_effect = Exception("SAP Service Layer rejection: Insufficient inventory")

        pos = self.positions[1]
        pending = self._create_test_transfer(
            batch_number="BATCH-FAIL-01",
        )
        self.transfer_service.reserve_pallet_position_for_transfer(pending, pos.id, user=self.operator)

        pos.refresh_from_db()
        self.assertEqual(pos.status, ColdStoragePalletPosition.RESERVED)

        # Attempt posting which fails
        with self.assertRaises(Exception):
            _post_pending_transfer_record(pending, self.admin)

        # Mark failed as views.py does in the error handler
        _mark_pending_transfer_failed(pending, self.admin, "SAP rejection")

        pending.refresh_from_db()
        pos.refresh_from_db()

        # Invariant: Pending transfer is FAILED
        self.assertEqual(pending.status, PendingTransferRequest.FAILED)
        # Invariant: Position MUST REMAIN RESERVED, never OCCUPIED
        self.assertEqual(pos.status, ColdStoragePalletPosition.RESERVED)
        self.assertNotEqual(pos.status, ColdStoragePalletPosition.OCCUPIED)
        self.assertEqual(pos.transfer_reference, f"PTR-{pending.id}")

    # 18. SAP timeout / failed posting endpoint does not create OCCUPIED state
    @patch("api.views._assert_transfer_payload_sap_available")
    @patch("api.views.transfer_service.move_inventory")
    def test_18_sap_timeout_endpoint_leaves_position_reserved(self, mock_move, mock_assert):
        mock_assert.return_value = True
        mock_move.side_effect = TimeoutError("Connection to SAP HANA timed out after 30 seconds")

        pos = self.positions[2]
        pending = self._create_test_transfer(
            batch_number="BATCH-TIMEOUT",
        )
        self.transfer_service.reserve_pallet_position_for_transfer(pending, pos.id, user=self.operator)

        self.client.force_login(self.admin)
        response = self.client.post(f"/api/admin/pending-transfers/{pending.id}/post/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        pos.refresh_from_db()
        pending.refresh_from_db()

        self.assertEqual(pending.status, PendingTransferRequest.FAILED)
        self.assertEqual(pos.status, ColdStoragePalletPosition.RESERVED)
        self.assertNotEqual(pos.status, ColdStoragePalletPosition.OCCUPIED)

    # 19. Already OCCUPIED for the same Transfer reference is idempotent
    def test_19_already_occupied_for_same_transfer_is_idempotent(self):
        pos = self.positions[3]
        pending = PendingTransferRequest.objects.create(
            transfer_stage="STAGE_2_TO_FRIDGE",
            from_warehouse="90214",
            to_warehouse="20201",
            to_bin=self.layout.bin_code,
            batch_number="BATCH-IDEMPOTENT",
            status=PendingTransferRequest.POSTED,
            created_by=self.operator,
        )
        # Directly setup position as OCCUPIED for this transfer
        ColdStoragePalletPosition.objects.filter(id=pos.id).update(
            status=ColdStoragePalletPosition.OCCUPIED,
            transfer_reference=f"PTR-{pending.id}",
            current_batch_number="BATCH-IDEMPOTENT",
            reserved_by=self.operator,
        )
        pending.pallet_position = pos
        pending.pallet_position_code = pos.position_code
        pending.save()

        # Call occupy_pallet_position_for_transfer again (retry scenario)
        result = occupy_pallet_position_for_transfer(pending, user=self.admin)
        self.assertIsNotNone(result)

        pos.refresh_from_db()
        self.assertEqual(pos.status, ColdStoragePalletPosition.OCCUPIED)
        self.assertEqual(pos.transfer_reference, f"PTR-{pending.id}")
        self.assertEqual(pos.current_batch_number, "BATCH-IDEMPOTENT")

    # 20. Already POSTED Transfer retry endpoint returns 400 without state corruption
    def test_20_already_posted_transfer_retry_blocked(self):
        pos = self.positions[4]
        pending = PendingTransferRequest.objects.create(
            transfer_stage="STAGE_2_TO_FRIDGE",
            from_warehouse="90214",
            to_warehouse="20201",
            to_bin=self.layout.bin_code,
            batch_number="BATCH-ALREADY-POSTED",
            status=PendingTransferRequest.POSTED,
            sap_doc_num="122000999",
            created_by=self.operator,
            pallet_position=pos,
            pallet_position_code=pos.position_code,
        )
        ColdStoragePalletPosition.objects.filter(id=pos.id).update(
            status=ColdStoragePalletPosition.OCCUPIED,
            transfer_reference=f"PTR-{pending.id}",
            current_batch_number="BATCH-ALREADY-POSTED",
        )

        self.client.force_login(self.admin)
        response = self.client.post(f"/api/admin/pending-transfers/{pending.id}/post/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("already been posted", response.data.get("error", ""))

        pos.refresh_from_db()
        self.assertEqual(pos.status, ColdStoragePalletPosition.OCCUPIED)
        self.assertEqual(pos.transfer_reference, f"PTR-{pending.id}")

    # 21. Transfer without pallet_position continues to post normally
    @patch("api.views._assert_transfer_payload_sap_available")
    @patch("api.views.transfer_service.move_inventory")
    def test_21_transfer_without_pallet_position_posts_normally(self, mock_move, mock_assert):
        mock_assert.return_value = True
        mock_move.return_value = {"sap_doc_entry": "5555", "sap_doc_num": "DOC-5555"}

        pending = self._create_test_transfer(
            transfer_stage="STAGE_1_TO_INTERMEDIATE",
            from_warehouse="20203",
            to_warehouse="90214",
            to_bin="",
            batch_number="BATCH-NORM",
            quantity=25.0,
        )
        self.assertIsNone(pending.pallet_position)

        _post_pending_transfer_record(pending, self.admin)

        pending.refresh_from_db()
        self.assertEqual(pending.status, PendingTransferRequest.POSTED)
        self.assertEqual(pending.sap_doc_num, "DOC-5555")
        self.assertIsNone(pending.pallet_position)

    # 22. Proof Cases A through E
    @patch("api.views._assert_transfer_payload_sap_available")
    @patch("api.views.transfer_service.move_inventory")
    def test_22_proof_cases_a_through_e(self, mock_move, mock_assert):
        mock_assert.return_value = True
        # CASE A: AVAILABLE -> reserve -> RESERVED -> SAP SUCCESS -> OCCUPIED
        pos_a = self.positions[0]
        self.assertEqual(pos_a.status, ColdStoragePalletPosition.AVAILABLE)

        pending_a = self._create_test_transfer(
            batch_number="BATCH-CASE-A",
        )
        self.transfer_service.reserve_pallet_position_for_transfer(pending_a, pos_a.id, user=self.operator)
        pos_a.refresh_from_db()
        self.assertEqual(pos_a.status, ColdStoragePalletPosition.RESERVED)

        mock_move.return_value = {"sap_doc_entry": "1001", "sap_doc_num": "DOC-1001"}
        _post_pending_transfer_record(pending_a, self.admin)
        pos_a.refresh_from_db()
        self.assertEqual(pos_a.status, ColdStoragePalletPosition.OCCUPIED)
        self.assertEqual(pos_a.current_batch_number, "BATCH-CASE-A")

        # CASE B: AVAILABLE -> reserve -> RESERVED -> SAP FAILURE -> RESERVED
        pos_b = self.positions[1]
        pending_b = self._create_test_transfer(
            batch_number="BATCH-CASE-B",
        )
        self.transfer_service.reserve_pallet_position_for_transfer(pending_b, pos_b.id, user=self.operator)
        pos_b.refresh_from_db()
        self.assertEqual(pos_b.status, ColdStoragePalletPosition.RESERVED)

        mock_move.side_effect = RuntimeError("HANA Database connection lost")
        with self.assertRaises(RuntimeError):
            _post_pending_transfer_record(pending_b, self.admin)
        _mark_pending_transfer_failed(pending_b, self.admin, "HANA connection lost")

        pos_b.refresh_from_db()
        self.assertEqual(pos_b.status, ColdStoragePalletPosition.RESERVED)

        # CASE C: RESERVED -> cancel before SAP -> AVAILABLE
        pos_c = self.positions[2]
        pending_c = self._create_test_transfer(
            batch_number="BATCH-CASE-C",
        )
        self.transfer_service.reserve_pallet_position_for_transfer(pending_c, pos_c.id, user=self.operator)
        pos_c.refresh_from_db()
        self.assertEqual(pos_c.status, ColdStoragePalletPosition.RESERVED)

        self.transfer_service.release_pallet_position_for_transfer(pending_c, user=self.operator)
        pos_c.refresh_from_db()
        self.assertEqual(pos_c.status, ColdStoragePalletPosition.AVAILABLE)

        # CASE D: OCCUPIED -> delete/cancel attempt -> Position remains OCCUPIED
        with self.assertRaises(ValueError):
            self.transfer_service.release_pallet_position_for_transfer(pending_a, user=self.operator)
        pos_a.refresh_from_db()
        self.assertEqual(pos_a.status, ColdStoragePalletPosition.OCCUPIED)

        # CASE E: POSTED + OCCUPIED -> retry -> No duplicate state transition, no corruption
        retry_result = occupy_pallet_position_for_transfer(pending_a, user=self.admin)
        self.assertIsNotNone(retry_result)
        pos_a.refresh_from_db()
        self.assertEqual(pos_a.status, ColdStoragePalletPosition.OCCUPIED)
        self.assertEqual(pos_a.transfer_reference, f"PTR-{pending_a.id}")
