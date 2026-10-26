import os
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from api.models import PendingTransferRequest, TransferWarehouseRule, UserProfile
from api.models_cold_storage import ColdStorageBinLayout, ColdStoragePalletPosition


class Stage2DestinationPositionIntegrityTests(TestCase):
    def setUp(self):
        self.env = patch.dict(
            os.environ,
            {
                "TRANSFER_INTERMEDIATE_WAREHOUSES": "90214",
                "TRANSFER_FRIDGE_WAREHOUSES": "20201,20202",
            },
        )
        self.env.start()
        self.addCleanup(self.env.stop)

        self.lookup = patch("api.views._lookup_transfer_batch_source")
        self.mock_lookup = self.lookup.start()
        self.addCleanup(self.lookup.stop)
        self.mock_lookup.return_value = {
            "item_code": "ITEM-001",
            "item_name": "Test Item",
            "batch_number": "BATCH-001",
            "available_quantity": 20.0,
            "can_post_to_sap": True,
            "source_type": "SAP",
        }

        self.user = User.objects.create_user(username="stage2_operator", password="password123")
        UserProfile.objects.filter(user=self.user).update(role="transfer")
        self.admin = User.objects.create_user(username="stage2_admin", password="password123")
        UserProfile.objects.filter(user=self.admin).update(role="transfer_admin")
        for warehouse in ("90214", "20201", "20202", "90215"):
            TransferWarehouseRule.objects.create(
                user=self.user,
                warehouse_code=warehouse,
                warehouse_name=warehouse,
                direction=TransferWarehouseRule.DIRECTION_BOTH,
                stage=TransferWarehouseRule.STAGE_BOTH,
                is_active=True,
            )
        self.client = APIClient()
        self.client.force_login(self.user)

        self.layout = self._layout("20201", "20201-F01-R01-C01-RA", 142)
        self.other_bin_layout = self._layout("20201", "20201-F01-R01-C02-RA", 143)
        self.other_warehouse_layout = self._layout("20202", "20202-F01-R01-C01-RA", 242)
        self.position = self.layout.positions.first()
        self.other_bin_position = self.other_bin_layout.positions.first()
        self.other_warehouse_position = self.other_warehouse_layout.positions.first()

    def _layout(self, warehouse, bin_code, abs_entry):
        return ColdStorageBinLayout.objects.create(
            warehouse_code=warehouse,
            bin_code=bin_code,
            sap_bin_abs_entry=abs_entry,
            allocation_type=ColdStorageBinLayout.ALLOC_ALLOCATABLE,
            sap_bin_classification=ColdStorageBinLayout.CLASS_PHYSICAL_CHANNEL,
            capacity=2,
        )

    def _payload(self, **overrides):
        payload = {
            "transfer_stage": "STAGE_2_TO_FRIDGE",
            "from_warehouse": "90214",
            "to_warehouse": "20201",
            "destination_type": "fridge",
            "to_bin": self.layout.bin_code,
            "pallet_position_id": self.position.id,
            "lines": [{"item_code": "ITEM-001", "batch_number": "BATCH-001", "quantity": 10}],
        }
        payload.update(overrides)
        return payload

    def _post_move(self, **overrides):
        return self.client.post("/api/transfer/move/", self._payload(**overrides), format="json")

    def test_valid_destination_position_succeeds(self):
        response = self._post_move()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        pending = PendingTransferRequest.objects.get(id=response.data["pending_transfer_id"])
        self.position.refresh_from_db()
        self.assertEqual(pending.pallet_position_id, self.position.id)
        self.assertEqual(self.position.status, ColdStoragePalletPosition.RESERVED)

    def test_wrong_warehouse_returns_409_without_pending_or_mutation(self):
        response = self._post_move(pallet_position_id=self.other_warehouse_position.id)
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("belongs to warehouse", response.data["error"])
        self.assertEqual(PendingTransferRequest.objects.count(), 0)
        self.other_warehouse_position.refresh_from_db()
        self.assertEqual(self.other_warehouse_position.status, ColdStoragePalletPosition.AVAILABLE)

    def test_wrong_bin_returns_409_without_pending_or_mutation(self):
        response = self._post_move(pallet_position_id=self.other_bin_position.id)
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("belongs to SAP Bin", response.data["error"])
        self.assertEqual(PendingTransferRequest.objects.count(), 0)
        self.other_bin_position.refresh_from_db()
        self.assertEqual(self.other_bin_position.status, ColdStoragePalletPosition.AVAILABLE)

    def test_nonexistent_position_returns_clear_409(self):
        response = self._post_move(pallet_position_id=999999)
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("does not exist", response.data["error"])
        self.assertEqual(PendingTransferRequest.objects.count(), 0)

    def test_required_cold_storage_destination_without_position_is_rejected(self):
        response = self._post_move(pallet_position_id=None)
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("requires a physical pallet position", response.data["error"])
        self.assertEqual(PendingTransferRequest.objects.count(), 0)

    def test_non_cold_storage_destination_without_position_still_works(self):
        response = self._post_move(
            to_warehouse="90215",
            destination_type="intermediate",
            to_bin="",
            pallet_position_id=None,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        pending = PendingTransferRequest.objects.get(id=response.data["pending_transfer_id"])
        self.assertIsNone(pending.pallet_position_id)

    @patch("api.views.transfer_service.move_inventory")
    def test_posting_revalidates_before_sap_and_position_mutation(self, mock_move):
        create_response = self._post_move()
        pending = PendingTransferRequest.objects.get(id=create_response.data["pending_transfer_id"])
        pending.to_bin = self.other_bin_layout.bin_code
        pending.save(update_fields=["to_bin"])

        self.client.force_login(self.admin)
        response = self.client.post(f"/api/admin/pending-transfers/{pending.id}/post/")
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        mock_move.assert_not_called()
        pending.refresh_from_db()
        self.position.refresh_from_db()
        self.assertEqual(pending.status, PendingTransferRequest.PENDING)
        self.assertEqual(self.position.status, ColdStoragePalletPosition.RESERVED)
