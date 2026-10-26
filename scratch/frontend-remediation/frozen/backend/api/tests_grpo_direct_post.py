from decimal import Decimal
from unittest.mock import patch
from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from .models import PendingQualityInspection, PurchaseGRPODraft, UserProfile
from .services.purchase_grpo_posting_service import (
    PurchaseGRPOPostingPreparationService,
    PurchaseGRPOPostingService,
)
from .services.purchase_grpo_service import PurchaseGRPODraftService


class PurchaseGRPODirectPostingWorkflowTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="grpo_direct_user", password="password123")
        UserProfile.objects.update_or_create(
            user=self.user,
            defaults={"role": "quality_admin", "warehouse": "WH-01"},
        )
        self.client.force_login(self.user)

    def _create_valid_draft(self, **overrides):
        inspection = PendingQualityInspection.objects.create(
            batch_number=overrides.get("batch_number", "B-DP-001"),
            item_code="RAW-001",
            item_name="Navel Orange",
            quantity=100.0,
            vendor_card_code="V-999",
            vendor_name="Fruit Farms Inc",
            warehouse_code="WH-01",
            bin_abs_entry="123",
            bin_code="BIN-A1",
            manufacturing_date="2026-09-01",
            admission_date="2026-09-02",
            expiry_date="2027-09-01",
            posting_date="2026-09-02",
            document_date="2026-09-02",
            due_date="2026-09-09",
            unit_price=overrides.get("unit_price", 15.5),
            tax_code=overrides.get("tax_code", "V1"),
            inspector_name="MANUAL",
        )
        draft = PurchaseGRPODraft.objects.create(
            inspection=inspection,
            status=overrides.get("status", PurchaseGRPODraft.DRAFT),
            vendor_card_code=inspection.vendor_card_code,
            vendor_name=inspection.vendor_name,
            item_code=inspection.item_code,
            item_name=inspection.item_name,
            quantity=inspection.quantity,
            warehouse_code=inspection.warehouse_code,
            bin_abs_entry=inspection.bin_abs_entry,
            bin_code=inspection.bin_code,
            batch_number=inspection.batch_number,
            posting_date=inspection.posting_date,
            document_date=inspection.document_date,
            due_date=inspection.due_date,
            unit_price=overrides.get("unit_price", 15.5),
            tax_code=overrides.get("tax_code", "V1"),
            uom_code="KG",
            uom_name="KG",
            manufacturing_date=inspection.manufacturing_date,
            admission_date=inspection.admission_date,
            expiry_date=inspection.expiry_date,
        )
        return draft

    @patch("api.services.sap_service.SAPServiceLayer.create_purchase_delivery_note")
    def test_direct_post_from_draft_status_to_sap_without_approval_gate(self, mock_sap):
        draft = self._create_valid_draft(unit_price=20.0, tax_code="V1")
        self.assertEqual(draft.status, PurchaseGRPODraft.DRAFT)

        mock_sap.return_value = {"DocNum": 99881, "DocEntry": 55441}

        res = self.client.post(f"/api/quality/grpo-drafts/{draft.id}/post-to-sap/")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["data"]["sap_doc_num"], "99881")
        self.assertEqual(data["data"]["sap_doc_entry"], "55441")

        draft.refresh_from_db()
        self.assertEqual(draft.status, PurchaseGRPODraft.POSTED)
        self.assertEqual(draft.sap_doc_num, "99881")
        self.assertEqual(draft.sap_doc_entry, "55441")

    @patch("api.services.sap_service.SAPServiceLayer.create_purchase_delivery_note")
    def test_direct_post_fails_when_sap_returns_error_and_draft_marked_failed(self, mock_sap):
        draft = self._create_valid_draft(unit_price=20.0, tax_code="V1")
        self.assertEqual(draft.status, PurchaseGRPODraft.DRAFT)

        mock_sap.return_value = {"error": "SAP Service Layer failure: inventory locked"}

        res = self.client.post(f"/api/quality/grpo-drafts/{draft.id}/post-to-sap/")
        self.assertEqual(res.status_code, 400)
        data = res.json()
        self.assertFalse(data["success"])
        self.assertIn("SAP Service Layer failure", data["error"])

        draft.refresh_from_db()
        self.assertEqual(draft.status, PurchaseGRPODraft.POSTING_FAILED)
        self.assertIn("inventory locked", draft.sap_error_message)

    def test_direct_post_validates_draft_before_posting_to_sap(self):
        draft = self._create_valid_draft(unit_price=20.0, tax_code="V1")
        draft.quantity = 0.0
        draft.save()

        res = self.client.post(f"/api/quality/grpo-drafts/{draft.id}/post-to-sap/")
        self.assertEqual(res.status_code, 400)
        data = res.json()
        self.assertFalse(data["success"])
        self.assertIn("quantity", data["errors"])

    @patch("api.services.sap_service.SAPServiceLayer.create_purchase_delivery_note")
    def test_posting_failed_draft_can_be_directly_retried_and_posted(self, mock_sap):
        draft = self._create_valid_draft(
            status=PurchaseGRPODraft.POSTING_FAILED,
            unit_price=20.0,
            tax_code="V1",
        )
        mock_sap.return_value = {"DocNum": 99882, "DocEntry": 55442}

        res = self.client.post(f"/api/quality/grpo-drafts/{draft.id}/post-to-sap/")
        self.assertEqual(res.status_code, 200)
        draft.refresh_from_db()
        self.assertEqual(draft.status, PurchaseGRPODraft.POSTED)
        self.assertEqual(draft.sap_doc_num, "99882")

    @patch("api.services.sap_service.SAPServiceLayer.create_purchase_delivery_note")
    def test_previously_approved_draft_also_posts_successfully_backward_compat(self, mock_sap):
        draft = self._create_valid_draft(
            status=PurchaseGRPODraft.APPROVED_FOR_POSTING,
            unit_price=20.0,
            tax_code="V1",
        )
        mock_sap.return_value = {"DocNum": 99883, "DocEntry": 55443}

        res = self.client.post(f"/api/quality/grpo-drafts/{draft.id}/post-to-sap/")
        self.assertEqual(res.status_code, 200)
        draft.refresh_from_db()
        self.assertEqual(draft.status, PurchaseGRPODraft.POSTED)
        self.assertEqual(draft.sap_doc_num, "99883")
