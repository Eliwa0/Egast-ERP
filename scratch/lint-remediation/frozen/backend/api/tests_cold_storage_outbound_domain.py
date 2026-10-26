"""
Tests for Phase 6 Step 5: Cold Storage Outbound Business Rules & Data Model.

Verifies:
1. Existing Transfer can still have: source_pallet_position = NULL.
2. OCCUPIED position can become: RESERVED_OUTBOUND.
3. AVAILABLE position cannot become: RESERVED_OUTBOUND.
4. RESERVED position cannot become: RESERVED_OUTBOUND.
5. MAINTENANCE cannot become: RESERVED_OUTBOUND.
6. UNCONFIGURED cannot become: RESERVED_OUTBOUND.
7. RESERVED_OUTBOUND can return to: OCCUPIED.
8. Batch number remains unchanged during outbound reservation and release.
9. Transfer reference remains unchanged during outbound reservation.
10. Source position and source position code can be stored on Transfer.
11. Concurrent outbound reservation attempts: only one succeeds.
12. Existing inbound reservation behavior remains unchanged.
13. Existing inbound: RESERVED -> OCCUPIED still works exactly as before.
14. Historical transfers remain readable and serialize cleanly.
"""
from django.test import TestCase
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from api.models import PendingTransferRequest, UserProfile
from api.models_cold_storage import ColdStorageBinLayout, ColdStoragePalletPosition
from api.services.cold_storage_layout_service import get_cold_storage_layout_service
from api.services.transfer_service import (
    TransferInventoryService,
    TransferValidationError,
    STAGE_1_TO_INTERMEDIATE,
    STAGE_2_TO_FRIDGE,
    STAGE_3_FROM_FRIDGE,
    reserve_pallet_position_for_transfer,
    occupy_pallet_position_for_transfer,
    reserve_source_pallet_position_for_transfer,
    release_source_pallet_position_for_transfer,
)
from api.views import _pending_transfer_to_dict


class ColdStorageOutboundDomainTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.transfer_service = TransferInventoryService(use_mock=True)
        self.layout_service = get_cold_storage_layout_service()

        self.operator = User.objects.create_user(username='operator_outbound', password='password123')
        UserProfile.objects.filter(user=self.operator).update(role='transfer')

        # Standard allocatable Cold Storage layout & positions
        self.layout = ColdStorageBinLayout.objects.create(
            warehouse_code='20201',
            bin_code='20201-F01-R01-C01-RA',
            sap_bin_abs_entry=142,
            sublevel1='F01',
            sublevel2='R01',
            sublevel3='C01',
            sublevel4='RA',
            allocation_type=ColdStorageBinLayout.ALLOC_ALLOCATABLE,
            capacity=17,
        )
        self.pos1 = self.layout.positions.get(position_index=1)
        self.pos2 = self.layout.positions.get(position_index=2)
        self.pos3 = self.layout.positions.get(position_index=3)

    def test_01_existing_transfer_can_have_null_source_pallet_position(self):
        """Historical or standard transfers have source_pallet_position = None without error."""
        transfer = PendingTransferRequest.objects.create(
            transfer_stage=STAGE_1_TO_INTERMEDIATE,
            from_warehouse="WH-PROD",
            to_warehouse="20200",
            item_code="ITEM-TEST",
            batch_number="BATCH-HISTORICAL",
            quantity=10,
            created_by=self.operator,
        )
        self.assertIsNone(transfer.source_pallet_position)
        self.assertEqual(transfer.source_pallet_position_code, "")

        loaded = PendingTransferRequest.objects.get(id=transfer.id)
        self.assertIsNone(loaded.source_pallet_position)
        self.assertEqual(loaded.source_pallet_position_code, "")

    def test_02_occupied_position_can_become_reserved_outbound(self):
        """OCCUPIED position can transition to RESERVED_OUTBOUND."""
        # Setup position as OCCUPIED
        ColdStoragePalletPosition.occupy_position(
            position_id=self.pos1.id,
            user=self.operator,
            batch_number="BATCH-OCCUPIED-01",
            reference="INBOUND: PTR-10",
            transfer_reference="PTR-10",
        )
        self.pos1.refresh_from_db()
        self.assertEqual(self.pos1.status, ColdStoragePalletPosition.OCCUPIED)

        # Transition to RESERVED_OUTBOUND via model classmethod
        reserved = ColdStoragePalletPosition.reserve_position_for_outbound(
            position_id=self.pos1.id,
            user=self.operator,
            reference="OUTBOUND: PTR-50",
        )
        self.assertEqual(reserved.status, ColdStoragePalletPosition.RESERVED_OUTBOUND)
        self.assertEqual(reserved.reservation_reference, "OUTBOUND: PTR-50")
        self.pos1.refresh_from_db()
        self.assertEqual(self.pos1.status, ColdStoragePalletPosition.RESERVED_OUTBOUND)

        # Also test service layer wrapper on pos2
        ColdStoragePalletPosition.occupy_position(
            position_id=self.pos2.id,
            user=self.operator,
            batch_number="BATCH-OCCUPIED-02",
        )
        data = self.layout_service.reserve_position_for_outbound(
            position_id=self.pos2.id,
            user=self.operator,
            reference="OUTBOUND: PTR-51",
        )
        self.assertEqual(data["status"], ColdStoragePalletPosition.RESERVED_OUTBOUND)
        self.pos2.refresh_from_db()
        self.assertEqual(self.pos2.status, ColdStoragePalletPosition.RESERVED_OUTBOUND)

    def test_03_available_position_cannot_become_reserved_outbound(self):
        """AVAILABLE position cannot be reserved for outbound transfer."""
        self.assertEqual(self.pos1.status, ColdStoragePalletPosition.AVAILABLE)
        with self.assertRaises(ValueError) as ctx:
            ColdStoragePalletPosition.reserve_position_for_outbound(
                position_id=self.pos1.id,
                user=self.operator,
                reference="OUTBOUND: INVALID",
            )
        self.assertIn("expected OCCUPIED", str(ctx.exception))
        self.pos1.refresh_from_db()
        self.assertEqual(self.pos1.status, ColdStoragePalletPosition.AVAILABLE)

    def test_04_reserved_position_cannot_become_reserved_outbound(self):
        """Inbound RESERVED position cannot be reserved for outbound transfer."""
        ColdStoragePalletPosition.reserve_position(
            position_id=self.pos1.id,
            user=self.operator,
            reference="INBOUND RESERVATION",
        )
        self.pos1.refresh_from_db()
        self.assertEqual(self.pos1.status, ColdStoragePalletPosition.RESERVED)

        with self.assertRaises(ValueError) as ctx:
            ColdStoragePalletPosition.reserve_position_for_outbound(
                position_id=self.pos1.id,
                user=self.operator,
            )
        self.assertIn("expected OCCUPIED", str(ctx.exception))
        self.pos1.refresh_from_db()
        self.assertEqual(self.pos1.status, ColdStoragePalletPosition.RESERVED)

    def test_05_maintenance_cannot_become_reserved_outbound(self):
        """MAINTENANCE position cannot be reserved for outbound transfer."""
        ColdStoragePalletPosition.set_maintenance(
            position_id=self.pos1.id,
            user=self.operator,
            notes="Under inspection",
        )
        self.pos1.refresh_from_db()
        self.assertEqual(self.pos1.status, ColdStoragePalletPosition.MAINTENANCE)

        with self.assertRaises(ValueError) as ctx:
            ColdStoragePalletPosition.reserve_position_for_outbound(
                position_id=self.pos1.id,
                user=self.operator,
            )
        self.assertIn("expected OCCUPIED", str(ctx.exception))
        self.pos1.refresh_from_db()
        self.assertEqual(self.pos1.status, ColdStoragePalletPosition.MAINTENANCE)

    def test_06_unconfigured_bin_position_cannot_become_reserved_outbound(self):
        """Position in an UNCONFIGURED bin cannot be reserved for outbound transfer."""
        unconf_layout = ColdStorageBinLayout.objects.create(
            warehouse_code='20201',
            bin_code='20201-F01-R04-BULK',
            sap_bin_abs_entry=999,
            allocation_type=ColdStorageBinLayout.ALLOC_UNCONFIGURED,
            capacity=1,
        )
        unconf_pos = unconf_layout.positions.first()
        # Force status to OCCUPIED for the test
        ColdStoragePalletPosition.objects.filter(id=unconf_pos.id).update(
            status=ColdStoragePalletPosition.OCCUPIED,
            current_batch_number="BATCH-UNCONF",
        )

        with self.assertRaises(ValueError) as ctx:
            ColdStoragePalletPosition.reserve_position_for_outbound(
                position_id=unconf_pos.id,
                user=self.operator,
            )
        self.assertIn("cannot be reserved for outbound transfer", str(ctx.exception))

    def test_07_reserved_outbound_can_return_to_occupied(self):
        """RESERVED_OUTBOUND position returns to OCCUPIED upon release."""
        ColdStoragePalletPosition.occupy_position(
            position_id=self.pos1.id,
            user=self.operator,
            batch_number="BATCH-TEST-07",
        )
        ColdStoragePalletPosition.reserve_position_for_outbound(
            position_id=self.pos1.id,
            user=self.operator,
        )
        self.pos1.refresh_from_db()
        self.assertEqual(self.pos1.status, ColdStoragePalletPosition.RESERVED_OUTBOUND)

        # Release back to OCCUPIED
        released = ColdStoragePalletPosition.release_outbound_reservation(
            position_id=self.pos1.id,
            user=self.operator,
        )
        self.assertEqual(released.status, ColdStoragePalletPosition.OCCUPIED)
        self.pos1.refresh_from_db()
        self.assertEqual(self.pos1.status, ColdStoragePalletPosition.OCCUPIED)

        # Attempting to release a position that is NOT RESERVED_OUTBOUND raises ValueError
        with self.assertRaises(ValueError) as ctx:
            ColdStoragePalletPosition.release_outbound_reservation(
                position_id=self.pos1.id,
                user=self.operator,
            )
        self.assertIn("expected RESERVED_OUTBOUND", str(ctx.exception))

    def test_08_batch_number_remains_unchanged_during_outbound_reservation_and_release(self):
        """Batch number is strictly preserved through outbound reservation and release."""
        batch = "BATCH-PRESERVE-2026"
        ColdStoragePalletPosition.occupy_position(
            position_id=self.pos1.id,
            user=self.operator,
            batch_number=batch,
        )
        self.pos1.refresh_from_db()
        self.assertEqual(self.pos1.current_batch_number, batch)

        # Reserve outbound
        ColdStoragePalletPosition.reserve_position_for_outbound(
            position_id=self.pos1.id,
            user=self.operator,
            reference="OUTBOUND: PTR-101",
        )
        self.pos1.refresh_from_db()
        self.assertEqual(self.pos1.current_batch_number, batch)

        # Release outbound
        ColdStoragePalletPosition.release_outbound_reservation(
            position_id=self.pos1.id,
            user=self.operator,
        )
        self.pos1.refresh_from_db()
        self.assertEqual(self.pos1.current_batch_number, batch)

    def test_09_transfer_reference_remains_unchanged_during_outbound_reservation(self):
        """Inbound transfer reference remains unchanged when outbound reservation occurs."""
        original_ref = "PTR-ORIGINAL-88"
        ColdStoragePalletPosition.occupy_position(
            position_id=self.pos1.id,
            user=self.operator,
            batch_number="BATCH-TEST-09",
            transfer_reference=original_ref,
        )
        self.pos1.refresh_from_db()
        self.assertEqual(self.pos1.transfer_reference, original_ref)

        # Outbound reservation preserves existing transfer_reference
        ColdStoragePalletPosition.reserve_position_for_outbound(
            position_id=self.pos1.id,
            user=self.operator,
            reference="OUTBOUND REQUEST",
        )
        self.pos1.refresh_from_db()
        self.assertEqual(self.pos1.transfer_reference, original_ref)

    def test_10_source_position_and_code_stored_on_transfer(self):
        """Transfer service properly links and releases source pallet position on PendingTransferRequest."""
        # Set pos1 to OCCUPIED
        ColdStoragePalletPosition.occupy_position(
            position_id=self.pos1.id,
            user=self.operator,
            batch_number="BATCH-FOR-OUTBOUND",
            transfer_reference="PTR-ORIGINAL",
        )

        transfer = PendingTransferRequest.objects.create(
            transfer_stage=STAGE_3_FROM_FRIDGE,
            from_warehouse="20201",
            from_bin="20201-F01-R01-C01-RA",
            to_warehouse="20200",
            batch_number="BATCH-FOR-OUTBOUND",
            quantity=1,
            created_by=self.operator,
        )

        # Reserve source position for transfer
        reserve_source_pallet_position_for_transfer(transfer, self.pos1.id, user=self.operator)
        transfer.refresh_from_db()
        self.assertEqual(transfer.source_pallet_position_id, self.pos1.id)
        self.assertEqual(transfer.source_pallet_position_code, self.pos1.position_code)

        self.pos1.refresh_from_db()
        self.assertEqual(self.pos1.status, ColdStoragePalletPosition.RESERVED_OUTBOUND)

        # Release source position (e.g. cancellation)
        release_source_pallet_position_for_transfer(transfer, user=self.operator)
        transfer.refresh_from_db()
        self.assertIsNone(transfer.source_pallet_position)
        self.assertEqual(transfer.source_pallet_position_code, "")

        self.pos1.refresh_from_db()
        self.assertEqual(self.pos1.status, ColdStoragePalletPosition.OCCUPIED)
        self.assertEqual(self.pos1.current_batch_number, "BATCH-FOR-OUTBOUND")

    def test_11_concurrent_outbound_reservation_only_one_succeeds(self):
        """Attempting to reserve an already RESERVED_OUTBOUND position fails with conflict."""
        ColdStoragePalletPosition.occupy_position(
            position_id=self.pos1.id,
            user=self.operator,
            batch_number="BATCH-CONCURRENT",
        )

        # First reservation succeeds
        ColdStoragePalletPosition.reserve_position_for_outbound(
            position_id=self.pos1.id,
            user=self.operator,
            reference="FIRST",
        )

        # Second reservation must fail
        with self.assertRaises(ValueError) as ctx:
            ColdStoragePalletPosition.reserve_position_for_outbound(
                position_id=self.pos1.id,
                user=self.operator,
                reference="SECOND",
            )
        self.assertIn("expected OCCUPIED", str(ctx.exception))

    def test_12_existing_inbound_reservation_behavior_unchanged(self):
        """Inbound reservation of AVAILABLE position works as before."""
        self.assertEqual(self.pos1.status, ColdStoragePalletPosition.AVAILABLE)
        reserved = ColdStoragePalletPosition.reserve_position(
            position_id=self.pos1.id,
            user=self.operator,
            reference="INBOUND RESERVATION",
        )
        self.assertEqual(reserved.status, ColdStoragePalletPosition.RESERVED)
        released = ColdStoragePalletPosition.release_position(position_id=self.pos1.id)
        self.assertEqual(released.status, ColdStoragePalletPosition.AVAILABLE)

    def test_13_existing_inbound_reserved_to_occupied_still_works(self):
        """Inbound RESERVED -> OCCUPIED via transfer service works as before."""
        inbound_transfer = PendingTransferRequest.objects.create(
            transfer_stage=STAGE_2_TO_FRIDGE,
            from_warehouse="20200",
            to_warehouse="20201",
            to_bin="20201-F01-R01-C01-RA",
            batch_number="BATCH-INBOUND-TEST",
            quantity=1,
            created_by=self.operator,
        )
        reserve_pallet_position_for_transfer(inbound_transfer, self.pos1.id, user=self.operator)
        self.pos1.refresh_from_db()
        self.assertEqual(self.pos1.status, ColdStoragePalletPosition.RESERVED)

        # Occupy position after SAP
        occupy_pallet_position_for_transfer(inbound_transfer, user=self.operator)
        self.pos1.refresh_from_db()
        self.assertEqual(self.pos1.status, ColdStoragePalletPosition.OCCUPIED)
        self.assertEqual(self.pos1.current_batch_number, "BATCH-INBOUND-TEST")

    def test_14_historical_transfers_remain_readable(self):
        """Historical transfers serialize cleanly with both destination and source position fields."""
        historical = PendingTransferRequest.objects.create(
            transfer_stage=STAGE_1_TO_INTERMEDIATE,
            from_warehouse="WH-PROD",
            to_warehouse="20200",
            item_code="ITEM-OLD",
            batch_number="BATCH-OLD-99",
            quantity=5,
            created_by=self.operator,
        )
        serialized = _pending_transfer_to_dict(historical)
        self.assertIsNone(serialized["pallet_position_id"])
        self.assertEqual(serialized["pallet_position_code"], "")
        self.assertIsNone(serialized["source_pallet_position_id"])
        self.assertEqual(serialized["source_pallet_position_code"], "")
