import threading
from unittest.mock import patch

from django.contrib.auth.models import User
from django.db import close_old_connections
from django.test import TransactionTestCase, skipUnlessDBFeature
from rest_framework.test import APIClient

from api.models import PendingTransferRequest, UserProfile


class PendingTransferPostingConcurrencyTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        self.admin = User.objects.create_user(username="posting-admin", password="test")
        UserProfile.objects.update_or_create(
            user=self.admin,
            defaults={"role": "transfer_admin"},
        )

    def _transfer(self, *, batch_number="BATCH-1", status=PendingTransferRequest.PENDING):
        payload = {
            "transfer_stage": "STAGE_1_TO_INTERMEDIATE",
            "from_warehouse": "20203",
            "to_warehouse": "90214",
            "lines": [
                {
                    "item_code": "FG-1",
                    "batch_number": batch_number,
                    "quantity": 1,
                }
            ],
        }
        return PendingTransferRequest.objects.create(
            transfer_stage=payload["transfer_stage"],
            from_warehouse=payload["from_warehouse"],
            to_warehouse=payload["to_warehouse"],
            item_code="FG-1",
            batch_number=batch_number,
            quantity=1,
            lines=payload["lines"],
            raw_payload_json=payload,
            status=status,
            created_by=self.admin,
        )

    def _post_in_thread(self, transfer_id, results, key):
        close_old_connections()
        try:
            client = APIClient()
            client.force_login(self.admin)
            results[key] = client.post(f"/api/admin/pending-transfers/{transfer_id}/post/")
        finally:
            close_old_connections()

    @patch("api.views._assert_transfer_payload_sap_available", return_value=True)
    @patch("api.views.transfer_service.move_inventory")
    @skipUnlessDBFeature('has_select_for_update')
    def test_concurrent_single_posts_call_sap_once(self, mock_move, _mock_assert):
        pending = self._transfer()
        sap_entered = threading.Event()
        release_sap = threading.Event()

        def blocked_sap_call(_payload):
            sap_entered.set()
            self.assertTrue(release_sap.wait(5), "test did not release mocked SAP call")
            return {"sap_doc_entry": "100", "sap_doc_num": "200"}

        mock_move.side_effect = blocked_sap_call
        results = {}
        first = threading.Thread(
            target=self._post_in_thread, args=(pending.id, results, "first")
        )
        second = threading.Thread(
            target=self._post_in_thread, args=(pending.id, results, "second")
        )

        first.start()
        self.assertTrue(sap_entered.wait(5), "first request did not reach mocked SAP")
        second.start()
        second.join(5)
        self.assertFalse(second.is_alive(), "second request waited for the SAP call")
        release_sap.set()
        first.join(5)

        self.assertEqual(mock_move.call_count, 1)
        self.assertEqual(results["first"].status_code, 200)
        self.assertEqual(results["second"].status_code, 409)
        pending.refresh_from_db()
        self.assertEqual(pending.status, PendingTransferRequest.POSTED)
        self.assertEqual(pending.sap_doc_num, "200")

    @patch("api.views._assert_transfer_payload_sap_available", return_value=True)
    @patch("api.views.transfer_service.move_inventory")
    def test_sap_failure_becomes_failed_and_retry_succeeds(self, mock_move, _mock_assert):
        pending = self._transfer()
        mock_move.side_effect = [TimeoutError("SAP timeout"), {"sap_doc_entry": "101", "sap_doc_num": "201"}]
        client = APIClient()
        client.force_login(self.admin)

        failed = client.post(f"/api/admin/pending-transfers/{pending.id}/post/")
        self.assertEqual(failed.status_code, 400)
        pending.refresh_from_db()
        self.assertEqual(pending.status, PendingTransferRequest.FAILED)

        retried = client.post(f"/api/admin/pending-transfers/{pending.id}/post/")
        self.assertEqual(retried.status_code, 200)
        pending.refresh_from_db()
        self.assertEqual(pending.status, PendingTransferRequest.POSTED)
        self.assertEqual(mock_move.call_count, 2)

    @patch("api.views._assert_transfer_payload_sap_available", return_value=True)
    @patch("api.views.transfer_service.move_inventory")
    def test_posted_transfer_cannot_call_sap(self, mock_move, _mock_assert):
        pending = self._transfer(status=PendingTransferRequest.POSTED)
        client = APIClient()
        client.force_login(self.admin)

        response = client.post(f"/api/admin/pending-transfers/{pending.id}/post/")

        self.assertEqual(response.status_code, 400)
        mock_move.assert_not_called()

    @patch("api.views._assert_transfer_payload_sap_available", return_value=True)
    @patch("api.views.transfer_service.move_inventory")
    @skipUnlessDBFeature('has_select_for_update')
    def test_different_transfers_can_reach_sap_concurrently(self, mock_move, _mock_assert):
        first_pending = self._transfer(batch_number="BATCH-A")
        second_pending = self._transfer(batch_number="BATCH-B")
        both_in_sap = threading.Barrier(2)

        def concurrent_sap_call(payload):
            both_in_sap.wait(timeout=5)
            batch = payload["lines"][0]["batch_number"]
            return {"sap_doc_entry": batch, "sap_doc_num": batch}

        mock_move.side_effect = concurrent_sap_call
        results = {}
        threads = [
            threading.Thread(
                target=self._post_in_thread,
                args=(first_pending.id, results, "first"),
            ),
            threading.Thread(
                target=self._post_in_thread,
                args=(second_pending.id, results, "second"),
            ),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(7)

        self.assertTrue(all(not thread.is_alive() for thread in threads))
        self.assertEqual(mock_move.call_count, 2)
        self.assertEqual({response.status_code for response in results.values()}, {200})
        self.assertEqual(
            set(PendingTransferRequest.objects.values_list("status", flat=True)),
            {PendingTransferRequest.POSTED},
        )

    @patch("api.views._assert_transfer_payload_sap_available", return_value=True)
    @patch("api.views.transfer_service.move_inventory")
    @skipUnlessDBFeature('has_select_for_update')
    def test_bulk_post_skips_transfer_claimed_by_single_post(self, mock_move, _mock_assert):
        pending = self._transfer()
        sap_entered = threading.Event()
        release_sap = threading.Event()

        def blocked_sap_call(_payload):
            sap_entered.set()
            self.assertTrue(release_sap.wait(5))
            return {"sap_doc_entry": "102", "sap_doc_num": "202"}

        mock_move.side_effect = blocked_sap_call
        results = {}
        first = threading.Thread(
            target=self._post_in_thread, args=(pending.id, results, "single")
        )
        first.start()
        self.assertTrue(sap_entered.wait(5))

        client = APIClient()
        client.force_login(self.admin)
        bulk = client.post(
            "/api/admin/pending-transfers/post-selected/",
            {"transfer_ids": [pending.id]},
            format="json",
        )
        release_sap.set()
        first.join(5)

        self.assertEqual(bulk.status_code, 400)
        self.assertEqual(mock_move.call_count, 1)
        pending.refresh_from_db()
        self.assertEqual(pending.status, PendingTransferRequest.POSTED)
