import os
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from django.contrib.auth.models import User
from django.db import close_old_connections
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from api.models import (
    PendingTransferBatchGuard,
    PendingTransferRequest,
    TransferWarehouseRule,
)
from api.models_cold_storage import ColdStorageBinLayout, ColdStoragePalletPosition


class PendingTransferCreationConcurrencyTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        self.env = patch.dict(
            os.environ,
            {
                "TRANSFER_INTERMEDIATE_WAREHOUSES": "90214",
                "TRANSFER_FRIDGE_WAREHOUSES": "20201",
            },
        )
        self.env.start()
        self.addCleanup(self.env.stop)

        self.user = User.objects.create_user(username="concurrent_transfer", password="password123")
        self.user.userprofile.role = "transfer"
        self.user.userprofile.save(update_fields=["role"])
        self.admin = User.objects.create_user(username="concurrent_admin", password="password123")
        self.admin.userprofile.role = "transfer_admin"
        self.admin.userprofile.save(update_fields=["role"])
        for warehouse in ("90214", "20201", "20203"):
            TransferWarehouseRule.objects.create(
                user=self.user,
                warehouse_code=warehouse,
                warehouse_name=warehouse,
                direction=TransferWarehouseRule.DIRECTION_BOTH,
                stage=TransferWarehouseRule.STAGE_BOTH,
                is_active=True,
            )

        self.layout = ColdStorageBinLayout.objects.create(
            warehouse_code="20201",
            bin_code="20201-F01-R01-C01-RA",
            sap_bin_abs_entry=142,
            allocation_type=ColdStorageBinLayout.ALLOC_ALLOCATABLE,
            sap_bin_classification=ColdStorageBinLayout.CLASS_PHYSICAL_CHANNEL,
            capacity=2,
        )
        self.positions = list(self.layout.positions.order_by("id"))

    def _stage2_payload(self, batch_number, position_id):
        return {
            "transfer_stage": "STAGE_2_TO_FRIDGE",
            "from_warehouse": "90214",
            "to_warehouse": "20201",
            "destination_type": "fridge",
            "to_bin": self.layout.bin_code,
            "pallet_position_id": position_id,
            "lines": [{
                "item_code": "ITEM-001",
                "batch_number": batch_number,
                "quantity": 10,
            }],
        }

    def _post_in_thread(self, payload):
        close_old_connections()
        try:
            client = APIClient()
            client.force_authenticate(user=self.user)
            response = client.post("/api/transfer/move/", payload, format="json")
            return response.status_code
        finally:
            close_old_connections()

    def _approve_in_thread(self, transfer_id, result):
        close_old_connections()
        try:
            client = APIClient()
            client.force_login(self.admin)
            result["response"] = client.post(
                f"/api/admin/pending-transfers/{transfer_id}/post/"
            )
        finally:
            close_old_connections()

    @patch("api.views.transfer_service.move_inventory")
    def test_overlapping_same_batch_creates_one_transfer_and_one_reservation(self, mock_sap):
        barrier = threading.Barrier(2)

        def overlapping_lookup(batch_number, from_warehouse=None, from_bin=None):
            barrier.wait(timeout=10)
            return {
                "item_code": "ITEM-001",
                "item_name": "Concurrent Item",
                "batch_number": batch_number,
                "available_quantity": 20.0,
                "can_post_to_sap": True,
                "source_type": "SAP",
            }

        payloads = [
            self._stage2_payload("BATCH-RACE-001", self.positions[0].id),
            self._stage2_payload(" batch-race-001 ", self.positions[1].id),
        ]
        with patch("api.views._lookup_transfer_batch_source", side_effect=overlapping_lookup):
            with ThreadPoolExecutor(max_workers=2) as executor:
                statuses = list(executor.map(self._post_in_thread, payloads))

        self.assertEqual(sorted(statuses), [200, 409])
        self.assertEqual(PendingTransferRequest.objects.count(), 1)
        self.assertEqual(PendingTransferRequest.objects.filter(status="PENDING").count(), 1)
        self.assertEqual(PendingTransferBatchGuard.objects.count(), 1)
        self.assertEqual(
            ColdStoragePalletPosition.objects.filter(status=ColdStoragePalletPosition.RESERVED).count(),
            1,
        )
        mock_sap.assert_not_called()

    def test_different_batches_can_overlap_and_both_succeed(self):
        barrier = threading.Barrier(2)

        def overlapping_lookup(batch_number, from_warehouse=None, from_bin=None):
            barrier.wait(timeout=10)
            return {
                "item_code": "ITEM-001",
                "item_name": "Concurrent Item",
                "batch_number": batch_number,
                "available_quantity": 20.0,
                "can_post_to_sap": True,
                "source_type": "SAP",
            }

        payloads = [
            self._stage2_payload("BATCH-A", self.positions[0].id),
            self._stage2_payload("BATCH-B", self.positions[1].id),
        ]
        with patch("api.views._lookup_transfer_batch_source", side_effect=overlapping_lookup):
            with ThreadPoolExecutor(max_workers=2) as executor:
                statuses = list(executor.map(self._post_in_thread, payloads))

        self.assertEqual(statuses.count(200), 2)
        self.assertEqual(PendingTransferRequest.objects.filter(status="PENDING").count(), 2)
        self.assertEqual(PendingTransferBatchGuard.objects.count(), 2)

    def test_sequential_duplicate_behavior_remains_unchanged(self):
        lookup_result = {
            "item_code": "ITEM-001",
            "item_name": "Sequential Item",
            "batch_number": "BATCH-SEQUENTIAL",
            "available_quantity": 20.0,
            "can_post_to_sap": True,
            "source_type": "SAP",
        }
        with patch("api.views._lookup_transfer_batch_source", return_value=lookup_result):
            first = self._post_in_thread(
                self._stage2_payload("BATCH-SEQUENTIAL", self.positions[0].id)
            )
            second = self._post_in_thread(
                self._stage2_payload("BATCH-SEQUENTIAL", self.positions[1].id)
            )
        self.assertEqual(first, 200)
        self.assertEqual(second, 400)
        self.assertEqual(PendingTransferRequest.objects.count(), 1)

    def test_direct_legacy_failed_posted_and_deleted_transfers_remain_compatible(self):
        payload = self._stage2_payload("BATCH-LIFECYCLE", self.positions[0].id)
        transfer = PendingTransferRequest.objects.create(
            transfer_stage=payload["transfer_stage"],
            from_warehouse=payload["from_warehouse"],
            to_warehouse=payload["to_warehouse"],
            to_bin=payload["to_bin"],
            batch_number="BATCH-LIFECYCLE",
            lines=payload["lines"],
            raw_payload_json=payload,
            status=PendingTransferRequest.FAILED,
            created_by=self.user,
        )
        self.assertEqual(transfer.active_batch_guards.count(), 0)
        transfer.status = PendingTransferRequest.POSTED
        transfer.save(update_fields=["status"])
        self.assertEqual(transfer.active_batch_guards.count(), 0)
        transfer.delete()
        self.assertEqual(PendingTransferBatchGuard.objects.count(), 0)

    @patch("api.views._assert_transfer_payload_sap_available", return_value=True)
    @patch("api.views.transfer_service.move_inventory")
    def test_same_batch_cannot_be_created_while_original_is_posting(self, mock_move, _mock_assert):
        payload_a = self._stage2_payload(" BATCH-IN-FLIGHT ", self.positions[0].id)
        payload_b = self._stage2_payload("batch-in-flight", self.positions[1].id)
        lookup = {
            "item_code": "ITEM-001",
            "item_name": "In-flight Item",
            "batch_number": "BATCH-IN-FLIGHT",
            "available_quantity": 20.0,
            "can_post_to_sap": True,
            "source_type": "SAP",
        }
        with patch("api.views._lookup_transfer_batch_source", return_value=lookup):
            self.assertEqual(self._post_in_thread(payload_a), 200)
        transfer = PendingTransferRequest.objects.get()
        sap_entered = threading.Event()
        release_sap = threading.Event()

        def blocked_sap(_payload):
            sap_entered.set()
            self.assertTrue(release_sap.wait(10))
            return {"sap_doc_entry": "901", "sap_doc_num": "902"}

        mock_move.side_effect = blocked_sap
        result = {}
        thread = threading.Thread(target=self._approve_in_thread, args=(transfer.id, result))
        thread.start()
        self.assertTrue(sap_entered.wait(10))
        transfer.refresh_from_db()
        self.assertEqual(transfer.status, PendingTransferRequest.POSTING)
        self.assertEqual(transfer.active_batch_guards.count(), 1)

        with patch("api.views._lookup_transfer_batch_source", return_value=lookup):
            duplicate_status = self._post_in_thread(payload_b)
        self.assertIn(duplicate_status, (400, 409))
        self.assertEqual(PendingTransferRequest.objects.count(), 1)

        release_sap.set()
        thread.join(10)
        self.assertFalse(thread.is_alive())
        self.assertEqual(result["response"].status_code, 200)
        transfer.refresh_from_db()
        self.assertEqual(transfer.status, PendingTransferRequest.POSTED)
        self.assertEqual(transfer.active_batch_guards.count(), 0)
        mock_move.assert_called_once()

    @patch("api.views._assert_transfer_payload_sap_available", return_value=True)
    @patch("api.views.transfer_service.move_inventory", side_effect=TimeoutError("SAP timeout"))
    def test_sap_failure_keeps_guard_until_cancelled(self, mock_move, _mock_assert):
        payload = self._stage2_payload("BATCH-FAILED-GUARD", self.positions[0].id)
        lookup = {
            "item_code": "ITEM-001",
            "item_name": "Failed Item",
            "batch_number": "BATCH-FAILED-GUARD",
            "available_quantity": 20.0,
            "can_post_to_sap": True,
            "source_type": "SAP",
        }
        with patch("api.views._lookup_transfer_batch_source", return_value=lookup):
            self.assertEqual(self._post_in_thread(payload), 200)
        transfer = PendingTransferRequest.objects.get()
        client = APIClient()
        client.force_login(self.admin)
        failed = client.post(f"/api/admin/pending-transfers/{transfer.id}/post/")
        self.assertEqual(failed.status_code, 400)
        transfer.refresh_from_db()
        self.assertEqual(transfer.status, PendingTransferRequest.FAILED)
        self.assertEqual(transfer.active_batch_guards.count(), 1)

        with patch("api.views._lookup_transfer_batch_source", return_value=lookup):
            self.assertIn(
                self._post_in_thread(self._stage2_payload(" batch-failed-guard ", self.positions[1].id)),
                (400, 409),
            )
        self.assertEqual(PendingTransferRequest.objects.count(), 1)

        deleted = client.delete(f"/api/admin/pending-transfers/{transfer.id}/")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(PendingTransferBatchGuard.objects.count(), 0)
        with patch("api.views._lookup_transfer_batch_source", return_value=lookup):
            self.assertEqual(self._post_in_thread(payload), 200)
        self.assertEqual(PendingTransferRequest.objects.count(), 1)
        mock_move.assert_called_once()
