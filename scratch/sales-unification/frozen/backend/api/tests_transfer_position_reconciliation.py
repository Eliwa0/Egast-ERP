from unittest.mock import patch

from django.contrib.auth.models import User
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from api.models import AuditLog, PendingTransferRequest, TransferPositionReconciliation, UserProfile
from api.models_cold_storage import ColdStorageBinLayout, ColdStoragePalletPosition
from api.services.transfer_service import reserve_source_pallet_position_for_transfer


class TransferPositionReconciliationTests(TestCase):
    def setUp(self):
        warehouse_metadata = patch('api.views.transfer_service.sap_client.get_warehouse_details',
                                   return_value={'WarehouseCode': '90214', 'EnableBinLocations': 'tNO'})
        warehouse_metadata.start()
        self.addCleanup(warehouse_metadata.stop)
        self.admin = User.objects.create_user(username="reconciliation-admin", password="test")
        UserProfile.objects.filter(user=self.admin).update(role="transfer_admin")
        self.client = APIClient()
        self.client.force_login(self.admin)
        self.layout = ColdStorageBinLayout.objects.create(
            warehouse_code="20201",
            bin_code="20201-F01-R01-C01-RA",
            sap_bin_abs_entry=142,
            sublevel1="F01",
            sublevel2="R01",
            sublevel3="C01",
            sublevel4="RA",
            allocation_type=ColdStorageBinLayout.ALLOC_ALLOCATABLE,
            sap_bin_classification=ColdStorageBinLayout.CLASS_PHYSICAL_CHANNEL,
            capacity=1,
        )
        self.position = self.layout.positions.get(position_index=1)
        self.position.status = ColdStoragePalletPosition.OCCUPIED
        self.position.current_batch_number = "BATCH-RECONCILE"
        self.position.save()

    def _pending(self):
        payload = {
            "transfer_stage": "STAGE_3_FROM_FRIDGE",
            "from_warehouse": "20201",
            "from_bin": self.layout.bin_code,
            "to_warehouse": "90214",
            "lines": [{"item_code": "FG-1", "batch_number": "BATCH-RECONCILE", "quantity": 1}],
        }
        pending = PendingTransferRequest.objects.create(
            transfer_stage="STAGE_3_FROM_FRIDGE",
            from_warehouse="20201",
            from_bin=self.layout.bin_code,
            to_warehouse="90214",
            item_code="FG-1",
            batch_number="BATCH-RECONCILE",
            quantity=1,
            lines=payload["lines"],
            raw_payload_json=payload,
            created_by=self.admin,
            source_pallet_position=self.position,
            source_pallet_position_code=self.position.position_code,
        )
        reserve_source_pallet_position_for_transfer(pending, self.position.id, user=self.admin)
        return pending

    @patch("api.views._assert_transfer_payload_sap_available", return_value=True)
    @patch("api.views.transfer_service.move_inventory", return_value={"sap_doc_entry": 501, "sap_doc_num": 601})
    def test_failed_local_finalization_is_durable_and_retry_is_idempotent(self, mock_move, _mock_assert):
        pending = self._pending()
        with patch(
            "api.views.transfer_service.vacate_source_pallet_position_for_transfer",
            side_effect=RuntimeError("deterministic local failure"),
        ):
            response = self.client.post(f"/api/admin/pending-transfers/{pending.id}/post/")

        self.assertEqual(response.status_code, 200, response.data)
        pending.refresh_from_db()
        self.position.refresh_from_db()
        reconciliation = pending.position_reconciliation
        self.assertEqual(pending.status, PendingTransferRequest.POSTED)
        self.assertEqual(pending.sap_doc_entry, "501")
        self.assertEqual(pending.sap_doc_num, "601")
        self.assertEqual(self.position.status, ColdStoragePalletPosition.RESERVED_OUTBOUND)
        self.assertEqual(self.position.current_batch_number, "BATCH-RECONCILE")
        self.assertEqual(self.position.reservation_reference, f"OUTBOUND: PTR-{pending.id}")
        self.assertEqual(self.position.reserved_by, self.admin)
        self.assertIsNotNone(self.position.reserved_at)
        self.assertEqual(reconciliation.status, TransferPositionReconciliation.PENDING)
        self.assertFalse(reconciliation.source_completed)
        self.assertEqual(reconciliation.expected_source_state, ColdStoragePalletPosition.AVAILABLE)
        self.assertIn("deterministic local failure", reconciliation.failure_reason)
        self.assertEqual(reconciliation.attempt_count, 1)

        retried = self.client.post(f"/api/admin/pending-transfers/{pending.id}/reconcile-positions/")
        self.assertEqual(retried.status_code, 200)
        self.position.refresh_from_db()
        reconciliation.refresh_from_db()
        self.assertEqual(self.position.status, ColdStoragePalletPosition.AVAILABLE)
        self.assertEqual(self.position.current_batch_number, "")
        self.assertEqual(reconciliation.status, TransferPositionReconciliation.COMPLETED)
        self.assertTrue(reconciliation.source_completed)
        self.assertEqual(reconciliation.attempt_count, 2)
        mock_move.assert_called_once()

        audit = AuditLog.objects.get(
            entity_type="TransferPositionReconciliation",
            entity_id=str(pending.id),
        )
        self.assertEqual(audit.module, "TRANSFER")
        self.assertEqual(audit.action, "RECONCILE")
        self.assertEqual(audit.status, AuditLog.STATUS_SUCCESS)
        self.assertEqual(audit.details["reconciliation_status"], TransferPositionReconciliation.COMPLETED)
        self.assertTrue(audit.details["source_completed"])
        self.assertEqual(audit.details["sap_doc_num"], "601")

        repeated = self.client.post(f"/api/admin/pending-transfers/{pending.id}/reconcile-positions/")
        self.assertEqual(repeated.status_code, 200)
        reconciliation.refresh_from_db()
        self.assertEqual(reconciliation.attempt_count, 2)
        mock_move.assert_called_once()

    def test_pending_transfer_list_eager_loads_reconciliation_positions(self):
        def create_posted_transfer(index):
            transfer = PendingTransferRequest.objects.create(
                transfer_stage="STAGE_3_FROM_FRIDGE",
                from_warehouse="20201",
                from_bin=self.layout.bin_code,
                to_warehouse="90214",
                item_code=f"FG-{index}",
                batch_number=f"BATCH-LIST-{index}",
                quantity=1,
                lines=[],
                raw_payload_json={},
                status=PendingTransferRequest.POSTED,
                created_by=self.admin,
                posted_by=self.admin,
                sap_doc_entry=str(1000 + index),
                sap_doc_num=str(2000 + index),
            )
            TransferPositionReconciliation.objects.create(
                transfer=transfer,
                sap_doc_entry=transfer.sap_doc_entry,
                sap_doc_num=transfer.sap_doc_num,
                source_position=self.position,
                source_position_code=self.position.position_code,
                destination_position=self.position,
                destination_position_code=self.position.position_code,
                expected_source_state=ColdStoragePalletPosition.AVAILABLE,
                expected_destination_state=ColdStoragePalletPosition.OCCUPIED,
            )

        create_posted_transfer(1)
        with CaptureQueriesContext(connection) as one_row_queries:
            response = self.client.get(
                "/api/admin/pending-transfers/?status=POSTED&refresh_sources=false"
            )
            self.assertEqual(response.status_code, 200)

        for index in range(2, 6):
            create_posted_transfer(index)
        with CaptureQueriesContext(connection) as five_row_queries:
            response = self.client.get(
                "/api/admin/pending-transfers/?status=POSTED&refresh_sources=false"
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data["data"]["count"], 5)

        self.assertEqual(len(five_row_queries), len(one_row_queries))

    @patch("api.views._assert_transfer_payload_sap_available", return_value=True)
    @patch("api.views.transfer_service.move_inventory", side_effect=TimeoutError("SAP timeout"))
    def test_sap_failure_remains_failed_without_reconciliation(self, mock_move, _mock_assert):
        pending = self._pending()
        response = self.client.post(f"/api/admin/pending-transfers/{pending.id}/post/")
        self.assertEqual(response.status_code, 400)
        pending.refresh_from_db()
        self.position.refresh_from_db()
        self.assertEqual(pending.status, PendingTransferRequest.FAILED)
        self.assertEqual(self.position.status, ColdStoragePalletPosition.RESERVED_OUTBOUND)
        self.assertFalse(TransferPositionReconciliation.objects.filter(transfer=pending).exists())
        mock_move.assert_called_once()

    @patch("api.views._assert_transfer_payload_sap_available", return_value=True)
    @patch("api.views.transfer_service.move_inventory", return_value={"sap_doc_entry": 701, "sap_doc_num": 801})
    def test_database_error_during_local_finalization_cannot_downgrade_sap_success(self, mock_move, _mock_assert):
        pending = self._pending()

        def genuine_integrity_error(*_args, **_kwargs):
            # The reconciliation row already exists. This is a real database
            # constraint failure, not a synthetic RuntimeError.
            TransferPositionReconciliation.objects.create(transfer=pending)

        with patch(
            "api.views.transfer_service.vacate_source_pallet_position_for_transfer",
            side_effect=genuine_integrity_error,
        ):
            response = self.client.post(f"/api/admin/pending-transfers/{pending.id}/post/")

        self.assertEqual(response.status_code, 200, response.data)
        pending.refresh_from_db()
        self.position.refresh_from_db()
        reconciliation = pending.position_reconciliation
        self.assertEqual(pending.status, PendingTransferRequest.POSTED)
        self.assertEqual(pending.sap_doc_entry, "701")
        self.assertEqual(pending.sap_doc_num, "801")
        self.assertEqual(self.position.status, ColdStoragePalletPosition.RESERVED_OUTBOUND)
        self.assertEqual(reconciliation.status, TransferPositionReconciliation.PENDING)
        self.assertIn("unique", reconciliation.failure_reason.lower())
        mock_move.assert_called_once()

        retry = self.client.post(f"/api/admin/pending-transfers/{pending.id}/reconcile-positions/")
        self.assertEqual(retry.status_code, 200, retry.data)
        pending.refresh_from_db()
        reconciliation.refresh_from_db()
        self.position.refresh_from_db()
        self.assertEqual(pending.status, PendingTransferRequest.POSTED)
        self.assertEqual(reconciliation.status, TransferPositionReconciliation.COMPLETED)
        self.assertEqual(self.position.status, ColdStoragePalletPosition.AVAILABLE)
        mock_move.assert_called_once()
