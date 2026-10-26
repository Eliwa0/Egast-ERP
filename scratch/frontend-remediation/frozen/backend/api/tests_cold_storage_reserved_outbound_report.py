from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import UserProfile
from api.models_cold_storage import ColdStorageBinLayout, ColdStoragePalletPosition


class ReservedOutboundPositionReportTests(TestCase):
    endpoint = "/api/admin/reports/reserved-outbound-positions/"

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="report_admin", password="password123")
        self.operator = User.objects.create_user(username="report_operator", password="password123")
        UserProfile.objects.filter(user=self.admin).update(role="admin")
        UserProfile.objects.filter(user=self.operator).update(role="transfer")
        self.layout = ColdStorageBinLayout.objects.create(
            warehouse_code="20201",
            bin_code="20201-F01-R01-C01-RA",
            sap_bin_abs_entry=142,
            allocation_type=ColdStorageBinLayout.ALLOC_ALLOCATABLE,
            sap_bin_classification=ColdStorageBinLayout.CLASS_PHYSICAL_CHANNEL,
            capacity=3,
        )
        self.positions = list(self.layout.positions.order_by("position_index"))

    def reserve_outbound(self, position, *, reserved_at, reference, batch):
        ColdStoragePalletPosition.objects.filter(id=position.id).update(
            status=ColdStoragePalletPosition.RESERVED_OUTBOUND,
            reservation_reference=reference,
            reserved_by=self.admin,
            reserved_at=reserved_at,
            current_batch_number=batch,
            transfer_reference="PTR-INBOUND-1",
        )

    def test_admin_get_returns_only_reserved_outbound_oldest_first(self):
        now = timezone.now()
        self.reserve_outbound(
            self.positions[0], reserved_at=now - timedelta(minutes=10),
            reference="OUTBOUND: PTR-2", batch="BATCH-NEW",
        )
        self.reserve_outbound(
            self.positions[1], reserved_at=now - timedelta(hours=2),
            reference="OUTBOUND: PTR-1", batch="BATCH-OLD",
        )

        self.client.force_login(self.admin)
        response = self.client.get(self.endpoint)

        self.assertEqual(response.status_code, 200)
        payload = response.data["data"]
        self.assertEqual(payload["count"], 2)
        self.assertEqual([row["id"] for row in payload["positions"]], [self.positions[1].id, self.positions[0].id])
        oldest = payload["positions"][0]
        self.assertEqual(oldest["status"], ColdStoragePalletPosition.RESERVED_OUTBOUND)
        self.assertEqual(oldest["reservation_reference"], "OUTBOUND: PTR-1")
        self.assertEqual(oldest["reserved_by"], self.admin.username)
        self.assertEqual(oldest["source_sap_bin"], self.layout.bin_code)
        self.assertEqual(oldest["source_sap_bin_abs_entry"], self.layout.sap_bin_abs_entry)
        self.assertEqual(oldest["source_warehouse"], self.layout.warehouse_code)
        self.assertEqual(oldest["batch_number"], "BATCH-OLD")
        self.assertEqual(oldest["transfer_reference"], "PTR-INBOUND-1")

    def test_report_is_read_only_and_does_not_change_position(self):
        reserved_at = timezone.now() - timedelta(days=1)
        self.reserve_outbound(
            self.positions[0], reserved_at=reserved_at,
            reference="OUTBOUND: PTR-9", batch="BATCH-9",
        )
        self.client.force_login(self.admin)

        response = self.client.get(self.endpoint)

        self.assertEqual(response.status_code, 200)
        self.positions[0].refresh_from_db()
        self.assertEqual(self.positions[0].status, ColdStoragePalletPosition.RESERVED_OUTBOUND)
        self.assertEqual(self.positions[0].reservation_reference, "OUTBOUND: PTR-9")
        self.assertEqual(self.positions[0].reserved_at, reserved_at)
        self.assertEqual(self.positions[0].current_batch_number, "BATCH-9")

    def test_report_requires_transfer_admin_access(self):
        self.assertEqual(self.client.get(self.endpoint).status_code, 401)
        self.client.force_login(self.operator)
        self.assertEqual(self.client.get(self.endpoint).status_code, 403)

    def test_non_get_methods_are_rejected(self):
        self.client.force_login(self.admin)
        self.assertEqual(self.client.post(self.endpoint, {}).status_code, 405)
