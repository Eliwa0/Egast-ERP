from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from api.models import UserProfile
from api.models_cold_storage import ColdStorageBinLayout, ColdStoragePalletPosition


class ColdStorageMutationAuthorizationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.transfer_user = User.objects.create_user(
            username="cold_storage_transfer_user", password="password123"
        )
        self.transfer_admin = User.objects.create_user(
            username="cold_storage_transfer_admin", password="password123"
        )
        UserProfile.objects.filter(user=self.transfer_user).update(role="transfer_user")
        UserProfile.objects.filter(user=self.transfer_admin).update(role="transfer_admin")
        self.layout = ColdStorageBinLayout.objects.create(
            warehouse_code="20201",
            bin_code="20201-F01-R01-C01-RA",
            sap_bin_abs_entry=142,
            sap_bin_classification=ColdStorageBinLayout.CLASS_PHYSICAL_CHANNEL,
            allocation_type=ColdStorageBinLayout.ALLOC_ALLOCATABLE,
            capacity=5,
        )
        self.positions = list(self.layout.positions.order_by("position_index"))

    def mutation_requests(self):
        return [
            (f"/api/cold-storage/positions/{self.positions[0].id}/reserve/", {"reference": "AUTH"}),
            (f"/api/cold-storage/positions/{self.positions[1].id}/release/", {}),
            (f"/api/cold-storage/positions/{self.positions[2].id}/occupy/", {"batch_number": "AUTH-BATCH"}),
            (f"/api/cold-storage/positions/{self.positions[3].id}/vacate/", {}),
            (f"/api/cold-storage/bin/{self.layout.sap_bin_abs_entry}/configure/", {"notes": "authorized"}),
        ]

    def test_all_mutations_reject_anonymous_users(self):
        for url, payload in self.mutation_requests():
            with self.subTest(url=url):
                response = self.client.post(url, payload, format="json")
                self.assertEqual(response.status_code, 401)

    def test_all_mutations_reject_ordinary_transfer_users(self):
        self.client.force_login(self.transfer_user)
        for url, payload in self.mutation_requests():
            with self.subTest(url=url):
                response = self.client.post(url, payload, format="json")
                self.assertEqual(response.status_code, 403)

    def test_transfer_admin_can_execute_all_existing_mutations(self):
        ColdStoragePalletPosition.reserve_position(self.positions[1].id, user=self.transfer_admin)
        ColdStoragePalletPosition.reserve_position(self.positions[2].id, user=self.transfer_admin)
        ColdStoragePalletPosition.occupy_position(
            self.positions[3].id,
            user=self.transfer_admin,
            batch_number="VACATE-BATCH",
        )
        self.client.force_login(self.transfer_admin)

        for url, payload in self.mutation_requests():
            with self.subTest(url=url):
                response = self.client.post(url, payload, format="json")
                self.assertEqual(response.status_code, 200, response.content)


class ColdStorageGenericStateRuleTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.transfer_admin = User.objects.create_user(
            username="cold_storage_state_admin", password="password123"
        )
        UserProfile.objects.filter(user=self.transfer_admin).update(role="transfer_admin")
        self.client.force_login(self.transfer_admin)
        self.layout = ColdStorageBinLayout.objects.create(
            warehouse_code="20201",
            bin_code="20201-F01-R01-C01-RB",
            sap_bin_abs_entry=143,
            sap_bin_classification=ColdStorageBinLayout.CLASS_PHYSICAL_CHANNEL,
            allocation_type=ColdStorageBinLayout.ALLOC_ALLOCATABLE,
            capacity=5,
        )
        self.positions = list(self.layout.positions.order_by("position_index"))

    def test_generic_occupy_rejects_reserved_outbound(self):
        position = self.positions[0]
        ColdStoragePalletPosition.occupy_position(
            position.id, user=self.transfer_admin, batch_number="OUTBOUND-BATCH"
        )
        ColdStoragePalletPosition.reserve_position_for_outbound(
            position.id, user=self.transfer_admin, reference="OUTBOUND: PTR-1"
        )

        response = self.client.post(
            f"/api/cold-storage/positions/{position.id}/occupy/",
            {"batch_number": "BYPASS"},
            format="json",
        )

        self.assertEqual(response.status_code, 409)
        position.refresh_from_db()
        self.assertEqual(position.status, ColdStoragePalletPosition.RESERVED_OUTBOUND)
        self.assertEqual(position.current_batch_number, "OUTBOUND-BATCH")

    def test_generic_occupy_preserves_reserved_to_occupied(self):
        position = self.positions[1]
        ColdStoragePalletPosition.reserve_position(position.id, user=self.transfer_admin)

        response = self.client.post(
            f"/api/cold-storage/positions/{position.id}/occupy/",
            {"batch_number": "INBOUND-BATCH"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        position.refresh_from_db()
        self.assertEqual(position.status, ColdStoragePalletPosition.OCCUPIED)
        self.assertEqual(position.current_batch_number, "INBOUND-BATCH")

    def test_generic_release_rejects_reserved_outbound(self):
        position = self.positions[2]
        ColdStoragePalletPosition.occupy_position(
            position.id, user=self.transfer_admin, batch_number="OUTBOUND-BATCH"
        )
        ColdStoragePalletPosition.reserve_position_for_outbound(
            position.id, user=self.transfer_admin, reference="OUTBOUND: PTR-2"
        )

        response = self.client.post(
            f"/api/cold-storage/positions/{position.id}/release/", {}, format="json"
        )

        self.assertEqual(response.status_code, 400)
        position.refresh_from_db()
        self.assertEqual(position.status, ColdStoragePalletPosition.RESERVED_OUTBOUND)
        self.assertEqual(position.current_batch_number, "OUTBOUND-BATCH")

    def test_generic_release_preserves_reserved_to_available(self):
        position = self.positions[3]
        ColdStoragePalletPosition.reserve_position(position.id, user=self.transfer_admin)

        response = self.client.post(
            f"/api/cold-storage/positions/{position.id}/release/", {}, format="json"
        )

        self.assertEqual(response.status_code, 200)
        position.refresh_from_db()
        self.assertEqual(position.status, ColdStoragePalletPosition.AVAILABLE)

    def test_generic_release_rejects_maintenance(self):
        position = self.positions[4]
        ColdStoragePalletPosition.set_maintenance(position.id, notes="Inspection")

        response = self.client.post(
            f"/api/cold-storage/positions/{position.id}/release/", {}, format="json"
        )

        self.assertEqual(response.status_code, 400)
        position.refresh_from_db()
        self.assertEqual(position.status, ColdStoragePalletPosition.MAINTENANCE)
