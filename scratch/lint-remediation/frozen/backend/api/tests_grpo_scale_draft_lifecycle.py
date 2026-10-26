from decimal import Decimal
from unittest.mock import patch, MagicMock
from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from api.models import PurchaseGRPODraft, UserProfile
from scale.models import ScaleDraft, ScaleDevice


class GRPOScaleDraftLifecycleTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username="grpo_scale_user", password="password123")
        UserProfile.objects.update_or_create(
            user=self.user,
            defaults={"role": "admin", "warehouse": "WH-01"},
        )
        self.client.force_login(self.user)

        self.device = ScaleDevice.objects.create(
            device_id="SCALE-TEST-01",
            device_name="Test Scale",
            ip_address="127.0.0.1",
            port=5000,
            is_active=True,
        )

        self.scale_draft = ScaleDraft.objects.create(
            draft_number="TEST-SCALE-001",
            scale_device=self.device,
            status=ScaleDraft.STATUS_COMPLETED,
            is_closed=True,
            product_weight=Decimal("15000.00"),
            weight_loaded=Decimal("25000.00"),
            weight_empty=Decimal("10000.00"),
            vendor_card_code="V-21120404",
            vendor_name="Test Supplier Co",
            item_code="ITEM-2710200001",
            item_name="Raw Green Beans",
            direct_vehicle_number="TRUCK-365",
            created_by=self.user,
            closed_by=self.user,
        )

    @patch("api.services.purchase_grpo_service.PurchaseGRPODraftService.resolve_item_uom")
    def test_create_and_reopen_scale_draft_grpo_idempotency(self, mock_resolve_uom):
        mock_resolve_uom.return_value = ("KG", "Kilogram")

        # 1. First POST: creates new draft
        res1 = self.client.post(f"/api/grpo/scale-drafts/{self.scale_draft.id}/grpo-draft/")
        self.assertEqual(res1.status_code, 201)
        data1 = res1.json()
        self.assertTrue(data1["success"])
        self.assertTrue(data1["created"])
        draft_id = data1["data"]["id"]
        self.assertEqual(data1["data"]["status"], "DRAFT")
        self.assertEqual(data1["data"]["scale_draft_id"], self.scale_draft.id)
        self.assertEqual(PurchaseGRPODraft.objects.filter(scale_draft=self.scale_draft).count(), 1)

        # 2. Re-open / Retry POST: must NOT duplicate, returns existing draft (200 OK, created=False)
        res2 = self.client.post(f"/api/grpo/scale-drafts/{self.scale_draft.id}/grpo-draft/")
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()
        self.assertTrue(data2["success"])
        self.assertFalse(data2["created"])
        self.assertEqual(data2["data"]["id"], draft_id)
        self.assertEqual(PurchaseGRPODraft.objects.filter(scale_draft=self.scale_draft).count(), 1)

        # 3. GET read-only endpoint: returns existing draft without mutating
        res_get = self.client.get(f"/api/grpo/scale-drafts/{self.scale_draft.id}/grpo-draft/")
        self.assertEqual(res_get.status_code, 200)
        data_get = res_get.json()
        self.assertTrue(data_get["success"])
        self.assertEqual(data_get["data"]["draft"]["id"], draft_id)

    @patch("api.services.purchase_grpo_service.PurchaseGRPODraftService.resolve_item_uom")
    def test_pending_shipments_shows_scale_draft_with_active_draft_badge(self, mock_resolve_uom):
        mock_resolve_uom.return_value = ("KG", "Kilogram")

        # Before draft creation: ScaleDraft is listed with has_active_draft=False
        res_before = self.client.get("/api/grpo/pending-shipments/")
        self.assertEqual(res_before.status_code, 200)
        shipments_before = res_before.json()["data"]["shipments"]
        target_before = next((s for s in shipments_before if s["scale_draft_id"] == self.scale_draft.id), None)
        self.assertIsNotNone(target_before)
        self.assertFalse(target_before["has_active_draft"])
        self.assertIsNone(target_before["grpo_draft_id"])

        # Create active draft
        res_create = self.client.post(f"/api/grpo/scale-drafts/{self.scale_draft.id}/grpo-draft/")
        draft_id = res_create.json()["data"]["id"]

        # After draft creation: ScaleDraft MUST REMAIN in pending shipments with has_active_draft=True
        res_after = self.client.get("/api/grpo/pending-shipments/")
        self.assertEqual(res_after.status_code, 200)
        shipments_after = res_after.json()["data"]["shipments"]
        target_after = next((s for s in shipments_after if s["scale_draft_id"] == self.scale_draft.id), None)
        self.assertIsNotNone(target_after, "Scale draft disappeared from pending shipments after draft creation!")
        self.assertTrue(target_after["has_active_draft"])
        self.assertEqual(target_after["grpo_draft_id"], draft_id)
        self.assertEqual(target_after["grpo_draft_status"], "DRAFT")

    @patch("api.services.purchase_grpo_service.PurchaseGRPODraftService.resolve_item_uom")
    def test_review_screen_visibility_rules(self, mock_resolve_uom):
        mock_resolve_uom.return_value = ("KG", "Kilogram")

        # Create active draft (status = DRAFT)
        res_create = self.client.post(f"/api/grpo/scale-drafts/{self.scale_draft.id}/grpo-draft/")
        draft_id = res_create.json()["data"]["id"]

        # Review screen must strictly exclude in-progress DRAFTs
        res_rev_draft = self.client.get("/api/grpo/review/")
        self.assertEqual(res_rev_draft.status_code, 200)
        records_draft = res_rev_draft.json()["data"]["records"]
        self.assertFalse(any(r["id"] == draft_id for r in records_draft))

        # Once posted to SAP (status = POSTED)
        draft = PurchaseGRPODraft.objects.get(id=draft_id)
        draft.status = PurchaseGRPODraft.POSTED
        draft.sap_doc_num = "987654"
        draft.sap_doc_entry = 54321
        draft.posted_by = self.user
        draft.save()

        # Review screen must now include the completed record
        res_rev_posted = self.client.get("/api/grpo/review/")
        self.assertEqual(res_rev_posted.status_code, 200)
        records_posted = res_rev_posted.json()["data"]["records"]
        posted_rec = next((r for r in records_posted if r["id"] == draft_id), None)
        self.assertIsNotNone(posted_rec, "Posted GRPO draft not found in review screen!")
        self.assertEqual(posted_rec["sap_doc_num"], "987654")
        self.assertEqual(posted_rec["source_type"], "scale")
        self.assertEqual(posted_rec["scale_draft_id"], self.scale_draft.id)

        # And it must now disappear from pending shipments
        res_pending_after_post = self.client.get("/api/grpo/pending-shipments/")
        shipments_post = res_pending_after_post.json()["data"]["shipments"]
        self.assertFalse(any(s["scale_draft_id"] == self.scale_draft.id for s in shipments_post))

    @patch("scale.views._fetch_all_sap_pages")
    def test_scale_item_groups_view_resilience_and_caching(self, mock_fetch):
        mock_fetch.return_value = [
            {"Number": 166, "GroupName": "27101-بطاطس خام"},
            {"Number": 167, "GroupName": "27102-فاصوليا خام"},
        ]

        # First call fetches and caches
        res1 = self.client.get("/api/scale/master-data/item-groups/")
        self.assertEqual(res1.status_code, 200)
        data1 = res1.json()
        self.assertTrue(data1["success"])
        self.assertEqual(len(data1["item_groups"]), 2)

        # Subsequent call uses cache even if SAP fetch fails
        mock_fetch.side_effect = Exception("SAP connection lost")
        res2 = self.client.get("/api/scale/master-data/item-groups/")
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()
        self.assertTrue(data2["success"])
        self.assertEqual(len(data2["item_groups"]), 2)
