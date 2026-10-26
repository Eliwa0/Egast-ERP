"""
Unit and integration tests for Issue for Production backend workflow.
Covers:
- Database models and status lifecycle
- Draft creation by Production User / Admin without calling SAP InventoryGenExits
- Business validations (Released order, line existence, remaining quantity, allocation totals)
- Role and permission enforcement (401 unauthenticated, 403 regular user on approve/reject, 200 admin)
- Admin review list and detail scoping (regular user sees own, admin sees all)
- Rejection workflow (requires reason, sets REJECTED status, logs audit)
- SAP payload construction (BaseType 202, BaseEntry, BaseLine, BatchNumbers, BinAllocations)
- SAP approval and posting workflow (POSTED terminal state, FAILED retryable state)
- Concurrency and duplicate posting protection (atomic claim lock, 409 conflict, single SAP call)
- Audit log tracking for CREATE, REJECT, and POST
"""
import datetime
import threading
from unittest.mock import patch, MagicMock

from django.contrib.auth.models import User
from django.db import close_old_connections
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from api.models import (
    AuditLog,
    PendingIssue,
    PendingIssueLine,
    UserProfile,
    UserModulePermission,
)
from api.role_permissions import (
    MODULE_PRODUCTION,
    MODULE_TRANSFER,
    LEVEL_ADMIN,
    LEVEL_USER,
    ROLE_PRODUCTION_USER,
    ROLE_PRODUCTION_ADMIN,
)
from api.services.audit_service import (
    MODULE_PRODUCTION_ISSUE,
    ACTION_CREATE,
    ACTION_POST,
    ACTION_REJECT,
)
from api.services.production_issue_payload_builder import ProductionIssuePayloadBuilder


def make_mock_sap_order(
    doc_entry=1234,
    doc_num="5678",
    status="boposReleased",
    item_code="FERT-001",
    item_name="Finished Good Product 1",
    lines=None,
):
    if lines is None:
        lines = [
            {
                "LineNumber": 0,
                "ItemNo": "RAW-001",
                "ItemDescription": "Raw Material 1",
                "PlannedQuantity": 50.0,
                "IssuedQuantity": 10.0,
                "Warehouse": "01",
                "UoMCode": "KG",
                "ProductionOrderIssueType": "boposManual",
            },
            {
                "LineNumber": 1,
                "ItemNo": "RAW-002",
                "ItemDescription": "Raw Material 2",
                "PlannedQuantity": 20.0,
                "IssuedQuantity": 5.0,
                "Warehouse": "01",
                "UoMCode": "PCS",
                "ProductionOrderIssueType": "boposManual",
            },
        ]

    return {
        "AbsoluteEntry": doc_entry,
        "DocumentNumber": doc_num,
        "ItemNo": item_code,
        "ProductDescription": item_name,
        "ProductionOrderStatus": status,
        "PlannedQuantity": 100.0,
        "CompletedQuantity": 20.0,
        "DueDate": "2026-10-15",
        "ProductionOrderLines": lines,
    }


class ProductionIssueTestCaseBase:
    """Helper setup for Production Issue tests."""

    def install_unmanaged_item_fixture(self):
        # These generic lifecycle fixtures are unmanaged items. Batch/bin-specific
        # tests below declare managed items and their live inventory separately.
        def tracking(item_code):
            if item_code not in {'RAW-001', 'RAW-002'}:
                raise AssertionError(f"Undeclared production item fixture: {item_code}")
            return {'manage_batches': False, 'manage_serials': False}
        fixture = patch('api.issue_views.sap.get_item_tracking_flags', side_effect=tracking)
        fixture.start()
        self.addCleanup(fixture.stop)

    def create_user_with_role(self, username, role=ROLE_PRODUCTION_USER, module_level=LEVEL_USER):
        user = User.objects.create_user(username=username, password="password123")
        profile, _ = UserProfile.objects.get_or_create(user=user)
        profile.role = role
        profile.save(update_fields=["role"])
        UserModulePermission.objects.update_or_create(
            user=user,
            module=MODULE_PRODUCTION,
            defaults={"level": module_level},
        )
        return user


class ProductionIssueModelAndValidationTests(ProductionIssueTestCaseBase, TestCase):
    """Tests for model creation, status lifecycle, draft creation, and business validations."""

    def setUp(self):
        self.install_unmanaged_item_fixture()
        self.prod_user = self.create_user_with_role("prod_user", ROLE_PRODUCTION_USER, LEVEL_USER)
        self.prod_user_b = self.create_user_with_role("prod_user_b", ROLE_PRODUCTION_USER, LEVEL_USER)
        self.prod_admin = self.create_user_with_role("prod_admin", ROLE_PRODUCTION_ADMIN, LEVEL_ADMIN)
        self.client_user = APIClient()
        self.client_user.force_login(self.prod_user)
        self.client_admin = APIClient()
        self.client_admin.force_login(self.prod_admin)

    def test_model_defaults_and_relationships(self):
        """Verify PendingIssue and PendingIssueLine creation and defaults."""
        issue = PendingIssue.objects.create(
            production_order_doc_entry=1234,
            production_order_doc_num="5678",
            production_order_item_code="FERT-001",
            production_order_item_name="Finished Good",
            posting_date=datetime.date.today(),
            total_components_count=1,
            total_quantity=15.0,
            created_by=self.prod_user,
        )
        self.assertEqual(issue.status, PendingIssue.PENDING_REVIEW)
        self.assertIn("PendingIssue #", str(issue))

        line = PendingIssueLine.objects.create(
            pending_issue=issue,
            line_number=0,
            item_code="RAW-001",
            warehouse_code="01",
            planned_quantity=50.0,
            issued_quantity_at_submit=10.0,
            remaining_quantity_at_submit=40.0,
            issue_quantity=15.0,
        )
        self.assertEqual(issue.lines.count(), 1)
        self.assertEqual(line.pending_issue, issue)
        self.assertIn("Line 0: RAW-001", str(line))

    @patch("api.issue_views.sap.create_issue_for_production")
    @patch("api.issue_views.sap.get_production_order")
    def test_create_pending_issue_success_does_not_call_sap_inventory_gen_exits(
        self, mock_get_order, mock_create_issue
    ):
        """
        Submitting draft issue saves PendingIssue in local DB and logs audit.
        CRITICAL: It must NOT call SAP create_issue_for_production.
        """
        mock_get_order.return_value = make_mock_sap_order()

        payload = {
            "production_order_doc_entry": 1234,
            "posting_date": "2026-09-30",
            "document_date": "2026-09-30",
            "comments": "Issue test note",
            "journal_memo": "Memo note",
            "lines": [
                {
                    "line_number": 0,
                    "item_code": "RAW-001",
                    "issue_quantity": 15.0,
                    "warehouse_code": "01",
                    "allocations": [
                        {"batch_number": "B001", "quantity": 10.0, "bin_abs_entry": 12},
                        {"batch_number": "B002", "quantity": 5.0, "bin_abs_entry": 14},
                    ],
                },
                {
                    "line_number": 1,
                    "item_code": "RAW-002",
                    "issue_quantity": 5.0,
                    "warehouse_code": "01",
                },
            ],
        }

        resp = self.client_user.post("/api/pending-issues/", data=payload, format="json")
        self.assertEqual(resp.status_code, 201)
        resp_data = resp.json()
        self.assertTrue(resp_data["success"])
        issue_id = resp_data["data"]["pending_issue_id"]
        self.assertEqual(resp_data["data"]["status"], PendingIssue.PENDING_REVIEW)
        self.assertEqual(resp_data["data"]["total_components"], 2)
        self.assertEqual(resp_data["data"]["total_quantity"], 20.0)

        # SAP create_issue_for_production must NOT be called during draft creation
        mock_create_issue.assert_not_called()

        # Database verification
        issue = PendingIssue.objects.get(id=issue_id)
        self.assertEqual(issue.status, PendingIssue.PENDING_REVIEW)
        self.assertEqual(issue.production_order_doc_entry, 1234)
        self.assertEqual(issue.production_order_doc_num, "5678")
        self.assertEqual(issue.created_by, self.prod_user)
        self.assertEqual(issue.lines.count(), 2)

        line0 = issue.lines.get(line_number=0)
        self.assertEqual(line0.issue_quantity, 15.0)
        self.assertEqual(line0.remaining_quantity_at_submit, 40.0)
        self.assertEqual(len(line0.allocations_json), 2)

        # Audit log verification
        audit = AuditLog.objects.filter(
            module=MODULE_PRODUCTION_ISSUE,
            action=ACTION_CREATE,
            entity_id=str(issue_id),
        ).first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.user, self.prod_user)

    @patch("api.issue_views.sap.get_production_order")
    def test_create_pending_issue_validations(self, mock_get_order):
        """Verify strict validations during draft submission."""
        # 1. Production order not in Released status
        mock_get_order.return_value = make_mock_sap_order(status="boposPlanned")
        resp = self.client_user.post(
            "/api/pending-issues/",
            data={
                "production_order_doc_entry": 1234,
                "lines": [{"line_number": 0, "issue_quantity": 5.0}],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Released status", resp.json()["error"])

        # 2. Production order not found in SAP
        mock_get_order.return_value = {"error": "Order not found"}
        resp = self.client_user.post(
            "/api/pending-issues/",
            data={
                "production_order_doc_entry": 9999,
                "lines": [{"line_number": 0, "issue_quantity": 5.0}],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 404)

        # Reset order to Released for remaining tests
        mock_get_order.return_value = make_mock_sap_order()

        # 3. Missing lines
        resp = self.client_user.post(
            "/api/pending-issues/",
            data={"production_order_doc_entry": 1234, "lines": []},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

        # 4. Non-existent line number in SAP order
        resp = self.client_user.post(
            "/api/pending-issues/",
            data={
                "production_order_doc_entry": 1234,
                "lines": [{"line_number": 99, "issue_quantity": 5.0}],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("does not belong to Production Order", resp.json()["error"])

        # 5. ItemCode mismatch with SAP line
        resp = self.client_user.post(
            "/api/pending-issues/",
            data={
                "production_order_doc_entry": 1234,
                "lines": [{"line_number": 0, "item_code": "WRONG-ITEM", "issue_quantity": 5.0}],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("does not match SAP line item", resp.json()["error"])

        # 6. Issue quantity <= 0
        resp = self.client_user.post(
            "/api/pending-issues/",
            data={
                "production_order_doc_entry": 1234,
                "lines": [{"line_number": 0, "issue_quantity": 0.0}],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("greater than zero", resp.json()["error"])

        # 7. Issue quantity exceeds remaining quantity (planned 50, issued 10 -> remaining 40)
        resp = self.client_user.post(
            "/api/pending-issues/",
            data={
                "production_order_doc_entry": 1234,
                "lines": [{"line_number": 0, "issue_quantity": 45.0}],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("exceeds remaining quantity", resp.json()["error"])

        # 8. Allocation quantity sum does not match issue quantity
        resp = self.client_user.post(
            "/api/pending-issues/",
            data={
                "production_order_doc_entry": 1234,
                "lines": [
                    {
                        "line_number": 0,
                        "issue_quantity": 10.0,
                        "allocations": [
                            {"batch_number": "B1", "quantity": 6.0},
                            {"batch_number": "B2", "quantity": 3.0},  # total 9 != 10
                        ],
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Total allocated quantity", resp.json()["error"])

        # 9. Duplicate line numbers in request
        resp = self.client_user.post(
            "/api/pending-issues/",
            data={
                "production_order_doc_entry": 1234,
                "lines": [
                    {"line_number": 0, "issue_quantity": 5.0},
                    {"line_number": 0, "issue_quantity": 5.0},
                ],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Duplicate line_number", resp.json()["error"])


class ProductionIssuePermissionsAndScopingTests(ProductionIssueTestCaseBase, TestCase):
    """Tests for authentication, authorization, role permissions, and visibility scoping."""

    def setUp(self):
        self.prod_user_1 = self.create_user_with_role("user1", ROLE_PRODUCTION_USER, LEVEL_USER)
        self.prod_user_2 = self.create_user_with_role("user2", ROLE_PRODUCTION_USER, LEVEL_USER)
        self.prod_admin = self.create_user_with_role("admin", ROLE_PRODUCTION_ADMIN, LEVEL_ADMIN)
        self.transfer_user = self.create_user_with_role("transfer_user", "transfer_user", LEVEL_USER)
        # remove production permission from transfer_user
        UserModulePermission.objects.filter(user=self.transfer_user).delete()
        UserModulePermission.objects.create(user=self.transfer_user, module=MODULE_TRANSFER, level=LEVEL_USER)

        self.c_anon = APIClient()
        self.c_user1 = APIClient()
        self.c_user1.force_login(self.prod_user_1)
        self.c_user2 = APIClient()
        self.c_user2.force_login(self.prod_user_2)
        self.c_admin = APIClient()
        self.c_admin.force_login(self.prod_admin)
        self.c_transfer = APIClient()
        self.c_transfer.force_login(self.transfer_user)

    def _create_issue(self, creator, order_num="1001", status=PendingIssue.PENDING_REVIEW):
        issue = PendingIssue.objects.create(
            production_order_doc_entry=int(order_num),
            production_order_doc_num=order_num,
            production_order_item_code="ITEM",
            posting_date=datetime.date.today(),
            total_components_count=1,
            total_quantity=5.0,
            status=status,
            created_by=creator,
        )
        PendingIssueLine.objects.create(
            pending_issue=issue,
            line_number=0,
            item_code="RAW-1",
            warehouse_code="01",
            planned_quantity=10.0,
            issued_quantity_at_submit=0.0,
            remaining_quantity_at_submit=10.0,
            issue_quantity=5.0,
        )
        return issue

    def test_unauthenticated_requests_return_401(self):
        issue = self._create_issue(self.prod_user_1)
        self.assertEqual(self.c_anon.get("/api/admin/pending-issues/").status_code, 401)
        self.assertEqual(self.c_anon.get(f"/api/admin/pending-issues/{issue.id}/").status_code, 401)
        self.assertEqual(self.c_anon.post(f"/api/admin/pending-issues/{issue.id}/approve-post/").status_code, 401)
        self.assertEqual(self.c_anon.post(f"/api/admin/pending-issues/{issue.id}/reject/").status_code, 401)
        self.assertEqual(self.c_anon.post("/api/pending-issues/", data={}, format="json").status_code, 401)

    def test_non_production_user_returns_403(self):
        issue = self._create_issue(self.prod_user_1)
        self.assertEqual(self.c_transfer.get("/api/admin/pending-issues/").status_code, 403)
        self.assertEqual(self.c_transfer.get(f"/api/admin/pending-issues/{issue.id}/").status_code, 403)
        self.assertEqual(self.c_transfer.post(f"/api/admin/pending-issues/{issue.id}/approve-post/").status_code, 403)
        self.assertEqual(self.c_transfer.post(f"/api/admin/pending-issues/{issue.id}/reject/").status_code, 403)
        self.assertEqual(self.c_transfer.post("/api/pending-issues/", data={}, format="json").status_code, 403)

    def test_regular_user_cannot_approve_or_reject(self):
        issue = self._create_issue(self.prod_user_1)
        # Regular user cannot approve/post
        resp_post = self.c_user1.post(f"/api/admin/pending-issues/{issue.id}/approve-post/")
        self.assertEqual(resp_post.status_code, 403)

        # Regular user cannot reject
        resp_rej = self.c_user1.post(f"/api/admin/pending-issues/{issue.id}/reject/", data={"reason": "test"}, format="json")
        self.assertEqual(resp_rej.status_code, 403)

    def test_scoping_and_visibility(self):
        issue1 = self._create_issue(self.prod_user_1, "1001")
        issue2 = self._create_issue(self.prod_user_2, "1002")

        # User 1 sees only issue 1
        r1 = self.c_user1.get("/api/admin/pending-issues/")
        self.assertEqual(r1.status_code, 200)
        items1 = r1.json()["data"]["issues"]
        self.assertEqual(len(items1), 1)
        self.assertEqual(items1[0]["id"], issue1.id)

        # User 1 cannot access detail of issue 2
        r_det_forbidden = self.c_user1.get(f"/api/admin/pending-issues/{issue2.id}/")
        self.assertEqual(r_det_forbidden.status_code, 403)

        # User 1 can access detail of issue 1
        r_det_ok = self.c_user1.get(f"/api/admin/pending-issues/{issue1.id}/")
        self.assertEqual(r_det_ok.status_code, 200)
        self.assertEqual(r_det_ok.json()["data"]["id"], issue1.id)

        # Admin sees both issue 1 and issue 2
        r_admin = self.c_admin.get("/api/admin/pending-issues/")
        self.assertEqual(r_admin.status_code, 200)
        items_admin = r_admin.json()["data"]["issues"]
        self.assertEqual(len(items_admin), 2)

        # Admin can access detail of issue 1 and issue 2
        self.assertEqual(self.c_admin.get(f"/api/admin/pending-issues/{issue1.id}/").status_code, 200)
        self.assertEqual(self.c_admin.get(f"/api/admin/pending-issues/{issue2.id}/").status_code, 200)


class ProductionIssueWorkflowAndPostingTests(ProductionIssueTestCaseBase, TestCase):
    """Tests for rejection flow, SAP approval posting, error handling, and payload construction."""

    def setUp(self):
        self.install_unmanaged_item_fixture()
        self.prod_user = self.create_user_with_role("prod_user", ROLE_PRODUCTION_USER, LEVEL_USER)
        self.prod_admin = self.create_user_with_role("prod_admin", ROLE_PRODUCTION_ADMIN, LEVEL_ADMIN)
        self.client_admin = APIClient()
        self.client_admin.force_login(self.prod_admin)
        self.client_user = APIClient()
        self.client_user.force_login(self.prod_user)
        self.client = APIClient()

    def _create_issue(self, status=PendingIssue.PENDING_REVIEW, with_allocations=True):
        issue = PendingIssue.objects.create(
            production_order_doc_entry=1234,
            production_order_doc_num="5678",
            production_order_item_code="FERT-001",
            production_order_item_name="Finished Good 1",
            posting_date=datetime.date.today(),
            document_date=datetime.date.today(),
            comments="Issue for Order 5678",
            journal_memo="Issue Memo 5678",
            total_components_count=1,
            total_quantity=10.0,
            status=status,
            created_by=self.prod_user,
        )
        allocations = (
            [
                {"batch_number": "B001", "quantity": 7.0, "bin_abs_entry": 55},
                {"batch_number": "B002", "quantity": 3.0, "bin_abs_entry": 56},
            ]
            if with_allocations
            else []
        )
        PendingIssueLine.objects.create(
            pending_issue=issue,
            line_number=0,
            item_code="RAW-001",
            item_name="Raw Material 1",
            uom_code="KG",
            warehouse_code="01",
            issue_type="Manual",
            planned_quantity=50.0,
            issued_quantity_at_submit=10.0,
            remaining_quantity_at_submit=40.0,
            issue_quantity=10.0,
            allocations_json=allocations,
        )
        return issue

    def test_rejection_flow(self):
        """Admin rejects pending issue with mandatory reason."""
        issue = self._create_issue()

        # Reject without reason fails
        r_fail = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/reject/", data={"reason": ""}, format="json")
        self.assertEqual(r_fail.status_code, 400)
        self.assertIn("reason is required", r_fail.json()["error"])

        # Reject with valid reason
        r_ok = self.client_admin.post(
            f"/api/admin/pending-issues/{issue.id}/reject/",
            data={"reason": "Incorrect component quantities specified."},
            format="json",
        )
        self.assertEqual(r_ok.status_code, 200)

        issue.refresh_from_db()
        self.assertEqual(issue.status, PendingIssue.REJECTED)
        self.assertEqual(issue.rejection_reason, "Incorrect component quantities specified.")
        self.assertEqual(issue.reviewed_by, self.prod_admin)
        self.assertIsNotNone(issue.reviewed_at)

        # Audit log verification
        audit = AuditLog.objects.filter(
            module=MODULE_PRODUCTION_ISSUE,
            action=ACTION_REJECT,
            entity_id=str(issue.id),
        ).first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.user, self.prod_admin)

    def test_cannot_reject_posted_issue(self):
        issue = self._create_issue(status=PendingIssue.POSTED)
        r = self.client_admin.post(
            f"/api/admin/pending-issues/{issue.id}/reject/",
            data={"reason": "Rejecting posted issue"},
            format="json",
        )
        self.assertEqual(r.status_code, 409)
        self.assertIn("already been posted", r.json()["error"])

    def test_cannot_reject_ambiguous_issue(self):
        issue = self._create_issue(status=PendingIssue.FAILED)
        issue.sap_error = "[AMBIGUOUS_FAILURE] Timed out"
        issue.save()
        r = self.client_admin.post(
            f"/api/admin/pending-issues/{issue.id}/reject/",
            data={"reason": "Rejecting ambiguous issue"},
            format="json",
        )
        self.assertEqual(r.status_code, 409)
        self.assertIn("ambiguous state", r.json()["error"])

    def test_payload_builder_structure(self):
        """Verify the exact SAP InventoryGenExits payload constructed by builder."""
        issue = self._create_issue(with_allocations=True)
        builder = ProductionIssuePayloadBuilder()
        payload = builder.build(issue)

        self.assertEqual(payload["DocType"], "dDocument_Items")
        self.assertEqual(payload["Comments"], issue.comments)
        self.assertEqual(len(payload["DocumentLines"]), 1)

        doc_line = payload["DocumentLines"][0]
        self.assertEqual(doc_line["BaseType"], 202)
        self.assertEqual(doc_line["BaseEntry"], 1234)
        self.assertEqual(doc_line["BaseLine"], 0)
        self.assertEqual(doc_line["Quantity"], 10.0)
        self.assertEqual(doc_line["WarehouseCode"], "01")

        # Batches
        batches = doc_line["BatchNumbers"]
        self.assertEqual(len(batches), 2)
        self.assertEqual(batches[0]["BatchNumber"], "B001")
        self.assertEqual(batches[0]["Quantity"], 7.0)
        self.assertEqual(batches[1]["BatchNumber"], "B002")
        self.assertEqual(batches[1]["Quantity"], 3.0)

        # Bin allocations
        bins = doc_line["DocumentLinesBinAllocations"]
        self.assertEqual(len(bins), 2)
        self.assertEqual(bins[0]["BinAbsEntry"], 55)
        self.assertEqual(bins[0]["Quantity"], 7.0)
        self.assertEqual(bins[0]["BaseLineNumber"], 0)

    @patch("api.issue_views.sap.create_issue_for_production")
    @patch("api.issue_views.sap.get_production_order")
    def test_approve_post_success_lifecycle(self, mock_get_order, mock_create_issue):
        """
        Admin approves and posts pending issue.
        Verifies SAP call, POSTED status, SAP doc identifiers, and audit log.
        """
        mock_get_order.return_value = make_mock_sap_order()
        mock_create_issue.return_value = {"DocEntry": "8765", "DocNum": "4321"}

        issue = self._create_issue(status=PendingIssue.PENDING_REVIEW)

        resp = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/approve-post/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()["data"]
        self.assertEqual(data["status"], PendingIssue.POSTED)
        self.assertEqual(data["sap_doc_num"], "4321")
        self.assertEqual(data["sap_doc_entry"], "8765")

        mock_create_issue.assert_called_once()

        issue.refresh_from_db()
        self.assertEqual(issue.status, PendingIssue.POSTED)
        self.assertEqual(issue.sap_doc_num, "4321")
        self.assertEqual(issue.sap_doc_entry, "8765")
        self.assertEqual(issue.posted_by, self.prod_admin)
        self.assertIsNotNone(issue.posted_at)

        # Audit log verification
        audit = AuditLog.objects.filter(
            module=MODULE_PRODUCTION_ISSUE,
            action=ACTION_POST,
            entity_id=str(issue.id),
            status="SUCCESS",
        ).first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.user, self.prod_admin)

    @patch("api.issue_views.sap.create_issue_for_production")
    @patch("api.issue_views.sap.get_production_order")
    def test_approve_post_failure_and_retry(self, mock_get_order, mock_create_issue):
        """
        When SAP returns an error, issue transitions to FAILED and remains retryable.
        Subsequent retry succeeds and transitions to POSTED.
        """
        mock_get_order.return_value = make_mock_sap_order()
        mock_create_issue.return_value = {"error": "Item RAW-001 has insufficient stock in warehouse 01."}

        issue = self._create_issue(status=PendingIssue.PENDING_REVIEW)

        # 1. First attempt fails
        resp = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/approve-post/")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("insufficient stock", resp.json()["error"])

        issue.refresh_from_db()
        self.assertEqual(issue.status, PendingIssue.FAILED)
        self.assertIn("insufficient stock", issue.sap_error)

        audit_failed = AuditLog.objects.filter(
            module=MODULE_PRODUCTION_ISSUE,
            action=ACTION_POST,
            entity_id=str(issue.id),
            status="FAILED",
        ).first()
        self.assertIsNotNone(audit_failed)

        # 2. Retry succeeds
        mock_create_issue.return_value = {"DocEntry": "9001", "DocNum": "9002"}
        resp_retry = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/approve-post/")
        self.assertEqual(resp_retry.status_code, 200)

        issue.refresh_from_db()
        self.assertEqual(issue.status, PendingIssue.POSTED)
        self.assertEqual(issue.sap_doc_num, "9002")
        self.assertEqual(issue.sap_doc_entry, "9001")
        self.assertEqual(issue.sap_error, "")

    @patch("api.issue_views.sap.create_issue_for_production")
    def test_cannot_post_already_posted_issue(self, mock_create_issue):
        """Attempting to post an already POSTED issue returns 409 Conflict."""
        issue = self._create_issue(status=PendingIssue.POSTED)
        resp = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/approve-post/")
        self.assertEqual(resp.status_code, 409)
        self.assertIn("already been posted", resp.json()["error"])
        mock_create_issue.assert_not_called()

    @patch("api.issue_views.sap.create_issue_for_production")
    def test_cannot_post_posting_state_issue(self, mock_create_issue):
        """Attempting to post an issue currently in POSTING status returns 409 Conflict."""
        issue = self._create_issue(status=PendingIssue.POSTING)
        resp = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/approve-post/")
        self.assertEqual(resp.status_code, 409)
        self.assertIn("currently being posted", resp.json()["error"])
        mock_create_issue.assert_not_called()

    @patch("api.issue_views.sap.create_issue_for_production")
    def test_cannot_post_rejected_state_issue(self, mock_create_issue):
        """Attempting to post an issue in REJECTED status returns 400 Bad Request."""
        issue = self._create_issue(status=PendingIssue.REJECTED)
        resp = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/approve-post/")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("not available for posting", resp.json()["error"])
        mock_create_issue.assert_not_called()

    @patch("api.issue_views.sap.create_issue_for_production")
    @patch("api.issue_views.sap.get_production_order")
    def test_ambiguous_failure_blocks_retry_without_reconciliation(self, mock_get_order, mock_create_issue):
        """
        When SAP call times out or fails ambiguously, issue is marked with [AMBIGUOUS_FAILURE].
        Subsequent approve-post calls are rejected with 409 Conflict without calling SAP.
        """
        mock_get_order.return_value = make_mock_sap_order()
        mock_create_issue.return_value = {"error": "HTTPSConnectionPool: Read timed out after 30 seconds."}

        issue = self._create_issue(status=PendingIssue.PENDING_REVIEW)

        # 1. First posting attempt experiences timeout -> 502 Bad Gateway
        resp1 = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/approve-post/")
        self.assertEqual(resp1.status_code, 502)
        self.assertIn("Ambiguous SAP response", resp1.json()["error"])

        issue.refresh_from_db()
        self.assertEqual(issue.status, PendingIssue.FAILED)
        self.assertIn("[AMBIGUOUS_FAILURE]", issue.sap_error)

        # Audit log has WARNING status (standard for ambiguous/partial states)
        ambig_audit = AuditLog.objects.filter(
            module=MODULE_PRODUCTION_ISSUE,
            action=ACTION_POST,
            entity_id=str(issue.id),
            status=AuditLog.STATUS_WARNING,
        ).first()
        self.assertIsNotNone(ambig_audit)
        self.assertTrue(ambig_audit.details.get("ambiguous"))

        # 2. Second posting attempt is blocked with 409 Conflict (no blind retry)
        mock_create_issue.reset_mock()
        resp2 = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/approve-post/")
        self.assertEqual(resp2.status_code, 409)
        self.assertIn("requires reconciliation", resp2.json()["error"])
        mock_create_issue.assert_not_called()

    @patch("api.issue_views.sap._request")
    @patch("api.issue_views.sap.get_production_order")
    def test_reconcile_found_in_sap_marks_posted(self, mock_get_order, mock_request):
        """
        When reconciling an ambiguous issue, if SAP InventoryGenExits confirms the document exists,
        issue transitions to POSTED with verified sap_doc_entry and sap_doc_num.
        """
        mock_get_order.return_value = make_mock_sap_order()
        # Mock InventoryGenExits query showing doc was created
        mock_request.return_value = {
            "value": [
                {
                    "DocEntry": 6789,
                    "DocNum": 9876,
                    "DocumentLines": [
                        {
                            "BaseType": 202,
                            "BaseEntry": 1234,
                            "BaseLine": 0,
                            "ItemCode": "RAW-001",
                            "Quantity": 10.0,
                            "WarehouseCode": "01",
                        }
                    ],
                }
            ]
        }

        issue = self._create_issue(status=PendingIssue.FAILED)
        issue.sap_error = "[AMBIGUOUS_FAILURE] Read timed out."
        issue.save()

        resp = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/reconcile/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()["data"]
        self.assertEqual(data["status"], PendingIssue.POSTED)
        self.assertEqual(data["sap_doc_num"], "9876")
        self.assertEqual(data["sap_doc_entry"], "6789")
        self.assertEqual(data["reconciliation_result"], "FOUND_AND_LINKED")

        issue.refresh_from_db()
        self.assertEqual(issue.status, PendingIssue.POSTED)
        self.assertEqual(issue.sap_doc_num, "9876")
        self.assertEqual(issue.sap_doc_entry, "6789")
        self.assertEqual(issue.sap_error, "")

    @patch("api.issue_views.sap.create_issue_for_production")
    @patch("api.issue_views.sap._request")
    @patch("api.issue_views.sap.get_production_order")
    def test_reconcile_not_in_sap_clears_ambiguity_for_retry(self, mock_get_order, mock_request, mock_create_issue):
        """
        When reconciling an ambiguous issue, if SAP confirms document was NOT created,
        ambiguity is cleared and subsequent approve-post is allowed and succeeds.
        """
        mock_get_order.return_value = make_mock_sap_order()
        mock_request.return_value = {"value": []}  # No exits found in SAP

        issue = self._create_issue(status=PendingIssue.FAILED)
        issue.sap_error = "[AMBIGUOUS_FAILURE] Connection refused."
        issue.save()

        # Reconcile clears ambiguity
        resp = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/reconcile/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["data"]["reconciliation_result"], "CLEARED_FOR_RETRY")

        issue.refresh_from_db()
        self.assertNotIn("[AMBIGUOUS_FAILURE]", issue.sap_error)

        # Retry now succeeds!
        mock_create_issue.return_value = {"DocEntry": "3333", "DocNum": "4444"}
        retry_resp = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/approve-post/")
        self.assertEqual(retry_resp.status_code, 200)
        issue.refresh_from_db()
        self.assertEqual(issue.status, PendingIssue.POSTED)
        self.assertEqual(issue.sap_doc_num, "4444")

    @patch("api.issue_views.sap.get_issue_for_production")
    def test_reconcile_with_manual_doc_identifiers(self, mock_get_issue):
        """Admin can reconcile an ambiguous issue by providing verified manual SAP identifiers."""
        mock_get_issue.return_value = {
            "DocEntry": 5555,
            "DocNum": 5556,
            "DocumentLines": [
                {
                    "BaseType": 202,
                    "BaseEntry": 1234,
                    "BaseLine": 0,
                    "ItemCode": "RAW-001",
                    "Quantity": 10.0,
                    "WarehouseCode": "01",
                }
            ],
        }
        issue = self._create_issue(status=PendingIssue.FAILED)
        issue.sap_error = "[AMBIGUOUS_FAILURE] 504 Gateway Timeout"
        issue.save()

        resp = self.client_admin.post(
            f"/api/admin/pending-issues/{issue.id}/reconcile/",
            {"sap_doc_entry": "5555", "sap_doc_num": "5556"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["data"]["status"], PendingIssue.POSTED)
        self.assertEqual(resp.json()["data"]["reconciliation_result"], "MANUALLY_LINKED")

        issue.refresh_from_db()
        self.assertEqual(issue.status, PendingIssue.POSTED)
        self.assertEqual(issue.sap_doc_entry, "5555")
        self.assertEqual(issue.sap_doc_num, "5556")
        self.assertEqual(issue.sap_error, "")

    @patch("api.issue_views.sap.get_issue_for_production")
    def test_manual_reconcile_with_unrelated_sap_document(self, mock_get_issue):
        """Manual reconcile rejects document from an unrelated Production Order or item."""
        mock_get_issue.return_value = {
            "DocEntry": 9999,
            "DocNum": 8888,
            "DocumentLines": [
                {
                    "BaseType": 202,
                    "BaseEntry": 9999,
                    "BaseLine": 0,
                    "ItemCode": "UNRELATED",
                    "Quantity": 10.0,
                    "WarehouseCode": "01",
                }
            ],
        }
        issue = self._create_issue(status=PendingIssue.FAILED)
        issue.sap_error = "[AMBIGUOUS_FAILURE] 504 Gateway Timeout"
        issue.save()

        resp = self.client_admin.post(
            f"/api/admin/pending-issues/{issue.id}/reconcile/",
            {"sap_doc_entry": "9999"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("does not correspond to this Issue draft", resp.json()["error"])

        issue.refresh_from_db()
        self.assertEqual(issue.status, PendingIssue.FAILED)
        self.assertIn("[AMBIGUOUS_FAILURE]", issue.sap_error)

    @patch("api.issue_views.sap._request")
    @patch("api.issue_views.sap.get_production_order")
    def test_reconciliation_search_returns_multiple_sap_documents(self, mock_get_order, mock_request):
        """When multiple identical SAP documents match, automated reconciliation refuses to guess and returns 409."""
        mock_get_order.return_value = make_mock_sap_order()
        matching_line = {
            "BaseType": 202,
            "BaseEntry": 1234,
            "BaseLine": 0,
            "ItemCode": "RAW-001",
            "Quantity": 10.0,
            "WarehouseCode": "01",
        }
        mock_request.return_value = {
            "value": [
                {"DocEntry": 101, "DocNum": 101, "DocumentLines": [matching_line]},
                {"DocEntry": 102, "DocNum": 102, "DocumentLines": [matching_line]},
            ]
        }
        issue = self._create_issue(status=PendingIssue.FAILED)
        issue.sap_error = "[AMBIGUOUS_FAILURE] Network dropped"
        issue.save()

        resp = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/reconcile/")
        self.assertEqual(resp.status_code, 409)
        self.assertIn("Multiple matching SAP Goods Issues found", resp.json()["error"])

        issue.refresh_from_db()
        self.assertEqual(issue.status, PendingIssue.FAILED)
        self.assertIn("[AMBIGUOUS_FAILURE]", issue.sap_error)

    def test_cannot_reconcile_posted_issue(self):
        """Reconciling an already POSTED issue returns safe idempotent 200 without mutating."""
        issue = self._create_issue(status=PendingIssue.POSTED)
        issue.sap_doc_entry = "7777"
        issue.sap_doc_num = "8888"
        issue.save()

        resp = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/reconcile/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["data"]["reconciliation_result"], "ALREADY_POSTED")
        self.assertEqual(resp.json()["data"]["sap_doc_entry"], "7777")
        self.assertEqual(resp.json()["data"]["sap_doc_num"], "8888")

        issue.refresh_from_db()
        self.assertEqual(issue.status, PendingIssue.POSTED)

    @patch("api.issue_views.sap.get_production_order")
    def test_concurrent_reconcile_does_not_downgrade_posted(self, mock_get_order):
        """If issue becomes POSTED concurrently during reconciliation, second thread does not overwrite to FAILED."""
        mock_get_order.return_value = make_mock_sap_order()
        issue = self._create_issue(status=PendingIssue.FAILED)
        issue.sap_error = "[AMBIGUOUS_FAILURE] Timed out"
        issue.save()

        def simulate_concurrent_post(*args, **kwargs):
            PendingIssue.objects.filter(id=issue.id).update(
                status=PendingIssue.POSTED,
                sap_doc_entry="9090",
                sap_doc_num="9091",
            )
            return {"value": []}

        with patch("api.issue_views.sap._request", side_effect=simulate_concurrent_post):
            resp = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/reconcile/")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["data"]["reconciliation_result"], "ALREADY_POSTED")
        issue.refresh_from_db()
        self.assertEqual(issue.status, PendingIssue.POSTED)
        self.assertEqual(issue.sap_doc_entry, "9090")

    def test_reconcile_permissions(self):
        """Unauthenticated -> 401, regular user -> 403, admin -> 200/400."""
        issue = self._create_issue(status=PendingIssue.FAILED)
        issue.sap_error = "[AMBIGUOUS_FAILURE] timeout"
        issue.save()

        # Unauthenticated
        resp_anon = self.client.post(f"/api/admin/pending-issues/{issue.id}/reconcile/")
        self.assertEqual(resp_anon.status_code, 401)

        # Regular user
        resp_user = self.client_user.post(f"/api/admin/pending-issues/{issue.id}/reconcile/")
        self.assertEqual(resp_user.status_code, 403)

    @patch("api.issue_views.sap.create_issue_for_production")
    @patch("api.issue_views.sap.get_production_order")
    def test_approve_post_live_order_not_released_blocks_posting(self, mock_get_order, mock_create_issue):
        """If production order in SAP is no longer Released, posting is aborted before calling SAP."""
        mock_get_order.return_value = make_mock_sap_order(status="boposClosed")
        issue = self._create_issue(status=PendingIssue.PENDING_REVIEW)

        resp = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/approve-post/")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("no longer Released", resp.json()["error"])
        mock_create_issue.assert_not_called()

        issue.refresh_from_db()
        self.assertEqual(issue.status, PendingIssue.FAILED)

    @patch("api.issue_views.sap.create_issue_for_production")
    @patch("api.issue_views.sap.get_production_order")
    def test_approve_post_live_component_line_missing_blocks_posting(self, mock_get_order, mock_create_issue):
        """If a component line was deleted from SAP order, posting is aborted before calling SAP."""
        order = make_mock_sap_order()
        order["ProductionOrderLines"] = [order["ProductionOrderLines"][1]]  # remove line 0
        mock_get_order.return_value = order

        issue = self._create_issue(status=PendingIssue.PENDING_REVIEW)

        resp = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/approve-post/")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("no longer exists in SAP", resp.json()["error"])
        mock_create_issue.assert_not_called()

    @patch("api.issue_views.sap.create_issue_for_production")
    @patch("api.issue_views.sap.get_production_order")
    def test_approve_post_live_remaining_quantity_exceeded_blocks_posting(self, mock_get_order, mock_create_issue):
        """If live remaining quantity in SAP is less than requested issue quantity, posting is aborted."""
        order = make_mock_sap_order()
        # Change line 0 so IssuedQuantity is 48.0 out of Planned 50.0 (remaining is only 2.0, but issue requests 10.0)
        order["ProductionOrderLines"][0]["IssuedQuantity"] = 48.0
        mock_get_order.return_value = order

        issue = self._create_issue(status=PendingIssue.PENDING_REVIEW)

        resp = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/approve-post/")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("exceeds live SAP remaining quantity", resp.json()["error"])
        mock_create_issue.assert_not_called()

    @patch("api.issue_views.sap.create_issue_for_production")
    @patch("api.issue_views.sap.get_production_order")
    def test_approve_post_batch_allocation_sum_mismatch_blocks_posting(self, mock_get_order, mock_create_issue):
        """If batch allocation sum does not match issue quantity, posting is aborted before SAP call."""
        mock_get_order.return_value = make_mock_sap_order()
        issue = self._create_issue(status=PendingIssue.PENDING_REVIEW)
        line = issue.lines.first()
        # Set allocation sum to 4.0 when line issue_quantity is 10.0
        line.allocations_json = [{"batch_number": "B01", "quantity": 4.0}]
        line.save()

        resp = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/approve-post/")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("does not match issue quantity", resp.json()["error"])
        mock_create_issue.assert_not_called()

    @patch("api.issue_views.log_action")
    @patch("api.issue_views.sap.create_issue_for_production")
    @patch("api.issue_views.sap.get_production_order")
    def test_post_commit_audit_failure_does_not_downgrade_posted_status(
        self, mock_get_order, mock_create_issue, mock_log_action
    ):
        """
        If audit logging raises an unexpected exception after DB commit of POSTED state,
        the request still returns HTTP 200 with SAP doc numbers and the issue remains POSTED.
        """
        mock_get_order.return_value = make_mock_sap_order()
        mock_create_issue.return_value = {"DocEntry": "7777", "DocNum": "8888"}
        mock_log_action.side_effect = RuntimeError("Database audit service transient failure")

        issue = self._create_issue(status=PendingIssue.PENDING_REVIEW)

        resp = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/approve-post/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["data"]["status"], PendingIssue.POSTED)
        self.assertEqual(resp.json()["data"]["sap_doc_num"], "8888")

        issue.refresh_from_db()
        self.assertEqual(issue.status, PendingIssue.POSTED)
        self.assertEqual(issue.sap_doc_num, "8888")
        self.assertEqual(issue.sap_doc_entry, "7777")

    @patch("api.issue_views.sap.create_issue_for_production")
    @patch("api.issue_views.sap.get_production_order")
    def test_approve_post_wrong_item_code_blocks_posting(self, mock_get_order, mock_create_issue):
        """If item code in SAP order does not match draft line item code, posting is aborted."""
        order = make_mock_sap_order()
        order["ProductionOrderLines"][0]["ItemNo"] = "DIFFERENT-ITEM"
        mock_get_order.return_value = order

        issue = self._create_issue(status=PendingIssue.PENDING_REVIEW)
        resp = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/approve-post/")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("item code mismatch", resp.json()["error"])
        mock_create_issue.assert_not_called()

    @patch("api.issue_views.sap.create_issue_for_production")
    @patch("api.issue_views.sap.get_production_order")
    def test_approve_post_invalid_batch_quantity_blocks_posting(self, mock_get_order, mock_create_issue):
        """If a batch has non-positive or missing quantity, posting is aborted before calling SAP."""
        mock_get_order.return_value = make_mock_sap_order()
        issue = self._create_issue(status=PendingIssue.PENDING_REVIEW)
        line = issue.lines.first()
        line.allocations_json = [{"batch_number": "B01", "quantity": -5.0}]
        line.save()

        resp = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/approve-post/")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("non-positive quantity", resp.json()["error"])
        mock_create_issue.assert_not_called()

    @patch("api.issue_views.sap.create_issue_for_production")
    @patch("api.issue_views.sap.get_production_order")
    def test_approve_post_bin_quantity_mismatch_blocks_posting(self, mock_get_order, mock_create_issue):
        """If bin allocation sum does not match batch quantity, posting is aborted before calling SAP."""
        mock_get_order.return_value = make_mock_sap_order()
        issue = self._create_issue(status=PendingIssue.PENDING_REVIEW)
        line = issue.lines.first()
        line.allocations_json = [
            {
                "batch_number": "B01",
                "quantity": 10.0,
                "bins": [{"bin_abs_entry": 55, "quantity": 4.0}],  # 4.0 != 10.0
            }
        ]
        line.save()

        resp = self.client_admin.post(f"/api/admin/pending-issues/{issue.id}/approve-post/")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("bin allocations total", resp.json()["error"])
        mock_create_issue.assert_not_called()


class ProductionIssueConcurrencyTests(ProductionIssueTestCaseBase, TransactionTestCase):
    """
    Multithreaded concurrency tests for atomic claim lock during approve-post.
    Ensures that concurrent posting attempts result in exactly ONE SAP call,
    while the competing thread receives a 409 Conflict.
    """
    reset_sequences = True

    def setUp(self):
        self.install_unmanaged_item_fixture()
        self.prod_user = self.create_user_with_role("concur_user", ROLE_PRODUCTION_USER, LEVEL_USER)
        self.prod_admin = self.create_user_with_role("concur_admin", ROLE_PRODUCTION_ADMIN, LEVEL_ADMIN)

    def _create_issue(self):
        issue = PendingIssue.objects.create(
            production_order_doc_entry=1234,
            production_order_doc_num="5678",
            production_order_item_code="FERT-001",
            posting_date=datetime.date.today(),
            total_components_count=1,
            total_quantity=5.0,
            status=PendingIssue.PENDING_REVIEW,
            created_by=self.prod_user,
        )
        PendingIssueLine.objects.create(
            pending_issue=issue,
            line_number=0,
            item_code="RAW-001",
            warehouse_code="01",
            planned_quantity=50.0,
            issued_quantity_at_submit=10.0,
            remaining_quantity_at_submit=40.0,
            issue_quantity=5.0,
        )
        return issue

    def _post_in_thread(self, issue_id, results, key):
        close_old_connections()
        try:
            client = APIClient()
            client.force_login(self.prod_admin)
            results[key] = client.post(f"/api/admin/pending-issues/{issue_id}/approve-post/")
        finally:
            close_old_connections()

    @patch("api.issue_views.sap.get_production_order")
    @patch("api.issue_views.sap.create_issue_for_production")
    def test_concurrent_approve_post_calls_sap_once(self, mock_create_issue, mock_get_order):
        """
        Two concurrent threads call approve-post on the same issue.
        First thread holds execution in SAP call using a threading Event.
        Second thread attempts approve-post simultaneously and must receive 409 Conflict.
        SAP is called exactly once.
        """
        mock_get_order.return_value = make_mock_sap_order()
        issue = self._create_issue()

        sap_entered = threading.Event()
        release_sap = threading.Event()

        def blocked_sap_call(_payload):
            sap_entered.set()
            # Wait until the test tells us to proceed
            self.assertTrue(release_sap.wait(5), "Test did not release blocked SAP call in time")
            return {"DocEntry": "8888", "DocNum": "7777"}

        mock_create_issue.side_effect = blocked_sap_call
        results = {}

        t1 = threading.Thread(target=self._post_in_thread, args=(issue.id, results, "t1"))
        t2 = threading.Thread(target=self._post_in_thread, args=(issue.id, results, "t2"))

        t1.start()
        # Wait until t1 is inside the SAP call (meaning it claimed the issue and is POSTING)
        self.assertTrue(sap_entered.wait(5), "Thread 1 did not reach mocked SAP in time")

        # Now start thread 2 while thread 1 is still busy in SAP
        t2.start()
        t2.join(timeout=5)

        # Thread 2 should have completed with 409 Conflict
        self.assertIn("t2", results)
        self.assertEqual(results["t2"].status_code, 409)
        self.assertIn("currently being posted", results["t2"].json()["error"])

        # Release thread 1 to finish its SAP call
        release_sap.set()
        t1.join(timeout=5)

        self.assertIn("t1", results)
        self.assertEqual(results["t1"].status_code, 200)

        # SAP must have been called exactly once
        self.assertEqual(mock_create_issue.call_count, 1)

        issue.refresh_from_db()
        self.assertEqual(issue.status, PendingIssue.POSTED)
        self.assertEqual(issue.sap_doc_num, "7777")
        self.assertEqual(issue.sap_doc_entry, "8888")


class ProductionIssueBatchBinAllocationTests(ProductionIssueTestCaseBase, TestCase):
    """
    Dedicated tests for the Batch-to-Bin allocation workflow:
    - Dynamic bin derivation from live SAP batch stock
    - Auto-selection for single-bin batches
    - Prevention of stale/leaked bin on batch switch
    - Rejection of system clearing bins (14) when physical bins exist
    - Multi-bin explicit selection enforcement
    - Bin-level inventory sufficiency validation
    - Construction of correct SAP DocumentLinesBinAllocations (e.g. 510, never 14)
    """

    def setUp(self):
        self.prod_user = self.create_user_with_role("alloc_user", ROLE_PRODUCTION_USER, LEVEL_USER)
        self.prod_admin = self.create_user_with_role("alloc_admin", ROLE_PRODUCTION_ADMIN, LEVEL_ADMIN)
        self.client_user = APIClient()
        self.client_user.force_login(self.prod_user)
        self.client_admin = APIClient()
        self.client_admin.force_login(self.prod_admin)

    def _mock_order_for_item_2710100006(self):
        return make_mock_sap_order(
            doc_entry=17184,
            doc_num="211007991",
            status="boposReleased",
            item_code="1110111002",
            item_name="Finished Potato Product",
            lines=[
                {
                    "LineNumber": 0,
                    "ItemNo": "2710100006",
                    "ItemDescription": "Raw Potato 2710100006",
                    "PlannedQuantity": 100.0,
                    "IssuedQuantity": 10.0,
                    "Warehouse": "20204",
                    "UoMCode": "KG",
                    "ProductionOrderIssueType": "boposManual",
                }
            ],
        )

    @patch("api.issue_views.sap.create_issue_for_production")
    @patch("api.issue_views.sap.get_bin_locations_by_warehouse")
    @patch("api.issue_views.sap.get_batch_bin_stock")
    @patch("api.issue_views.sap.get_item_tracking_flags")
    @patch("api.issue_views.sap.get_production_order")
    def test_case_1_batch_in_single_bin_binds_to_real_bin_510_and_sap_payload_has_bin_510(
        self, mock_order, mock_flags, mock_stock, mock_bins, mock_sap_post
    ):
        """
        Case 1: Batch '90246.23022026.1' of item '2710100006' in Whs '20204' lives in Bin 510 (20204-A01).
        When allocated with Bin 510, the draft is created with Bin 510.
        When posted to SAP, the SAP payload DocumentLinesBinAllocations has BinAbsEntry: 510 (NEVER 14).
        """
        mock_order.return_value = self._mock_order_for_item_2710100006()
        mock_flags.return_value = {"manage_batches": True, "manage_serials": False}
        mock_stock.return_value = [
            {
                "item_code": "2710100006",
                "batch_number": "90246.23022026.1",
                "warehouse_code": "20204",
                "bin_abs_entry": 510,
                "bin_code": "20204-A01",
                "on_hand_qty": 100000.0,
                "is_system_bin": False,
            }
        ]
        mock_bins.return_value = {
            "value": [
                {"AbsEntry": 14, "BinCode": "20204-SYSTEM-BIN-LOCATION", "IsSystemBin": "tYES"},
                {"AbsEntry": 510, "BinCode": "20204-A01", "IsSystemBin": "tNO"},
            ]
        }
        mock_sap_post.return_value = {"DocEntry": "9991", "DocNum": "8881"}

        payload = {
            "production_order_doc_entry": 17184,
            "lines": [
                {
                    "line_number": 0,
                    "item_code": "2710100006",
                    "issue_quantity": 15.0,
                    "warehouse_code": "20204",
                    "allocations": [
                        {
                            "batch_number": "90246.23022026.1",
                            "bin_abs_entry": 510,
                            "quantity": 15.0,
                        }
                    ],
                }
            ],
        }

        # 1. Draft Creation
        resp = self.client_user.post("/api/pending-issues/", data=payload, format="json")
        self.assertEqual(resp.status_code, 201)
        issue_id = resp.json()["data"]["pending_issue_id"]

        line = PendingIssueLine.objects.get(pending_issue_id=issue_id)
        self.assertEqual(line.allocations_json[0]["bin_abs_entry"], 510)
        self.assertEqual(line.allocations_json[0]["batch_number"], "90246.23022026.1")

        # 2. Admin Approve & Post to SAP
        post_resp = self.client_admin.post(f"/api/admin/pending-issues/{issue_id}/approve-post/")
        self.assertEqual(post_resp.status_code, 200)

        # 3. Verify the payload passed to SAP create_issue_for_production
        mock_sap_post.assert_called_once()
        sap_payload = mock_sap_post.call_args[0][0]

        doc_lines = sap_payload.get("DocumentLines", [])
        self.assertEqual(len(doc_lines), 1)
        doc_line = doc_lines[0]

        # Verify BatchNumbers
        batches = doc_line.get("BatchNumbers", [])
        self.assertEqual(len(batches), 1)
        self.assertEqual(batches[0]["BatchNumber"], "90246.23022026.1")
        self.assertEqual(batches[0]["Quantity"], 15.0)

        # Verify DocumentLinesBinAllocations: MUST BE 510, NEVER 14!
        bin_allocs = doc_line.get("DocumentLinesBinAllocations", [])
        self.assertEqual(len(bin_allocs), 1)
        self.assertEqual(bin_allocs[0]["BinAbsEntry"], 510)
        self.assertEqual(bin_allocs[0]["Quantity"], 15.0)
        self.assertNotEqual(bin_allocs[0]["BinAbsEntry"], 14)

    @patch("api.issue_views.sap.get_bin_locations_by_warehouse")
    @patch("api.issue_views.sap.get_batch_bin_stock")
    @patch("api.issue_views.sap.get_item_tracking_flags")
    @patch("api.issue_views.sap.get_production_order")
    def test_case_2_batch_switch_rejects_stale_inherited_bin(
        self, mock_order, mock_flags, mock_stock, mock_bins
    ):
        """
        Case 2: If a user selects Batch B ('BATCH-B' in Bin 509), but the allocation
        inherits stale Bin 510 (where Batch B has no stock), the backend rejects it.
        """
        mock_order.return_value = self._mock_order_for_item_2710100006()
        mock_flags.return_value = {"manage_batches": True, "manage_serials": False}
        mock_stock.return_value = [
            {
                "item_code": "2710100006",
                "batch_number": "BATCH-A",
                "warehouse_code": "20204",
                "bin_abs_entry": 510,
                "bin_code": "20204-A01",
                "on_hand_qty": 50.0,
                "is_system_bin": False,
            },
            {
                "item_code": "2710100006",
                "batch_number": "BATCH-B",
                "warehouse_code": "20204",
                "bin_abs_entry": 509,
                "bin_code": "20204-B01",
                "on_hand_qty": 50.0,
                "is_system_bin": False,
            },
        ]
        mock_bins.return_value = {"value": [{"AbsEntry": 510}, {"AbsEntry": 509}]}

        # Attempt to allocate BATCH-B from Bin 510 (mismatched/stale bin)
        payload = {
            "production_order_doc_entry": 17184,
            "lines": [
                {
                    "line_number": 0,
                    "item_code": "2710100006",
                    "issue_quantity": 10.0,
                    "warehouse_code": "20204",
                    "allocations": [
                        {
                            "batch_number": "BATCH-B",
                            "bin_abs_entry": 510,  # Wrong! BATCH-B is in 509
                            "quantity": 10.0,
                        }
                    ],
                }
            ],
        }

        resp = self.client_user.post("/api/pending-issues/", data=payload, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("has no stock in bin location '510'", resp.json()["error"])

    @patch("api.issue_views.sap.get_bin_locations_by_warehouse")
    @patch("api.issue_views.sap.get_batch_bin_stock")
    @patch("api.issue_views.sap.get_item_tracking_flags")
    @patch("api.issue_views.sap.get_production_order")
    def test_case_3_missing_bin_auto_resolves_when_single_bin_or_rejects_when_multi_bin(
        self, mock_order, mock_flags, mock_stock, mock_bins
    ):
        """
        Case 3: Missing bin:
        - When batch exists in exactly 1 physical storage bin, auto-resolves bin_abs_entry.
        - When batch exists in multiple bins, missing bin returns 400 requiring explicit selection.
        """
        mock_order.return_value = self._mock_order_for_item_2710100006()
        mock_flags.return_value = {"manage_batches": True, "manage_serials": False}
        mock_bins.return_value = {"value": [{"AbsEntry": 510}, {"AbsEntry": 509}]}

        # Scenario 3A: Single bin batch with bin omitted -> auto-resolves to 510
        mock_stock.return_value = [
            {
                "item_code": "2710100006",
                "batch_number": "90246.23022026.1",
                "warehouse_code": "20204",
                "bin_abs_entry": 510,
                "bin_code": "20204-A01",
                "on_hand_qty": 1000.0,
                "is_system_bin": False,
            }
        ]

        payload_single = {
            "production_order_doc_entry": 17184,
            "lines": [
                {
                    "line_number": 0,
                    "item_code": "2710100006",
                    "issue_quantity": 15.0,
                    "warehouse_code": "20204",
                    "allocations": [
                        {
                            "batch_number": "90246.23022026.1",
                            "bin_abs_entry": None,  # Omitted!
                            "quantity": 15.0,
                        }
                    ],
                }
            ],
        }
        resp = self.client_user.post("/api/pending-issues/", data=payload_single, format="json")
        self.assertEqual(resp.status_code, 201)
        issue_id = resp.json()["data"]["pending_issue_id"]
        line = PendingIssueLine.objects.get(pending_issue_id=issue_id)
        self.assertEqual(line.allocations_json[0]["bin_abs_entry"], 510)

        # Scenario 3B: Multi-bin batch with bin omitted -> rejected with 400
        mock_stock.return_value = [
            {
                "item_code": "2710100006",
                "batch_number": "MULTI-BATCH",
                "warehouse_code": "20204",
                "bin_abs_entry": 510,
                "bin_code": "20204-A01",
                "on_hand_qty": 50.0,
                "is_system_bin": False,
            },
            {
                "item_code": "2710100006",
                "batch_number": "MULTI-BATCH",
                "warehouse_code": "20204",
                "bin_abs_entry": 509,
                "bin_code": "20204-B01",
                "on_hand_qty": 50.0,
                "is_system_bin": False,
            },
        ]
        payload_multi = {
            "production_order_doc_entry": 17184,
            "lines": [
                {
                    "line_number": 0,
                    "item_code": "2710100006",
                    "issue_quantity": 15.0,
                    "warehouse_code": "20204",
                    "allocations": [
                        {
                            "batch_number": "MULTI-BATCH",
                            "bin_abs_entry": None,
                            "quantity": 15.0,
                        }
                    ],
                }
            ],
        }
        resp_multi = self.client_user.post("/api/pending-issues/", data=payload_multi, format="json")
        self.assertEqual(resp_multi.status_code, 400)
        self.assertIn("exists in multiple bin locations", resp_multi.json()["error"])

    @patch("api.issue_views.sap.get_bin_locations_by_warehouse")
    @patch("api.issue_views.sap.get_batch_bin_stock")
    @patch("api.issue_views.sap.get_item_tracking_flags")
    @patch("api.issue_views.sap.get_production_order")
    def test_case_4_system_bin_14_rejected_when_physical_bin_510_exists(
        self, mock_order, mock_flags, mock_stock, mock_bins
    ):
        """
        Case 4: System bin location (14) must be strictly rejected when physical storage bin (510) exists.
        """
        mock_order.return_value = self._mock_order_for_item_2710100006()
        mock_flags.return_value = {"manage_batches": True, "manage_serials": False}
        mock_stock.return_value = [
            {
                "item_code": "2710100006",
                "batch_number": "90246.23022026.1",
                "warehouse_code": "20204",
                "bin_abs_entry": 510,
                "bin_code": "20204-A01",
                "on_hand_qty": 100000.0,
                "is_system_bin": False,
            },
            {
                "item_code": "2710100006",
                "batch_number": "90246.23022026.1",
                "warehouse_code": "20204",
                "bin_abs_entry": 14,
                "bin_code": "20204-SYSTEM-BIN-LOCATION",
                "on_hand_qty": 500.0,
                "is_system_bin": True,
            },
        ]
        mock_bins.return_value = {"value": [{"AbsEntry": 14, "IsSystemBin": "tYES"}, {"AbsEntry": 510, "IsSystemBin": "tNO"}]}

        payload = {
            "production_order_doc_entry": 17184,
            "lines": [
                {
                    "line_number": 0,
                    "item_code": "2710100006",
                    "issue_quantity": 15.0,
                    "warehouse_code": "20204",
                    "allocations": [
                        {
                            "batch_number": "90246.23022026.1",
                            "bin_abs_entry": 14,  # SYSTEM BIN!
                            "quantity": 15.0,
                        }
                    ],
                }
            ],
        }

        resp = self.client_user.post("/api/pending-issues/", data=payload, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("System bin location '14' cannot be used", resp.json()["error"])

    @patch("api.issue_views.sap.get_bin_locations_by_warehouse")
    @patch("api.issue_views.sap.get_batch_bin_stock")
    @patch("api.issue_views.sap.get_item_tracking_flags")
    @patch("api.issue_views.sap.get_production_order")
    def test_case_5_multi_bin_batch_explicit_bin_selection_succeeds(
        self, mock_order, mock_flags, mock_stock, mock_bins
    ):
        """
        Case 5: When batch is in multiple bins, explicit selection of one of the valid bins succeeds.
        """
        mock_order.return_value = self._mock_order_for_item_2710100006()
        mock_flags.return_value = {"manage_batches": True, "manage_serials": False}
        mock_stock.return_value = [
            {
                "item_code": "2710100006",
                "batch_number": "MULTI-BATCH",
                "warehouse_code": "20204",
                "bin_abs_entry": 510,
                "bin_code": "20204-A01",
                "on_hand_qty": 30.0,
                "is_system_bin": False,
            },
            {
                "item_code": "2710100006",
                "batch_number": "MULTI-BATCH",
                "warehouse_code": "20204",
                "bin_abs_entry": 509,
                "bin_code": "20204-B01",
                "on_hand_qty": 40.0,
                "is_system_bin": False,
            },
        ]
        mock_bins.return_value = {"value": [{"AbsEntry": 510}, {"AbsEntry": 509}]}

        payload = {
            "production_order_doc_entry": 17184,
            "lines": [
                {
                    "line_number": 0,
                    "item_code": "2710100006",
                    "issue_quantity": 25.0,
                    "warehouse_code": "20204",
                    "allocations": [
                        {
                            "batch_number": "MULTI-BATCH",
                            "bin_abs_entry": 509,
                            "quantity": 25.0,
                        }
                    ],
                }
            ],
        }

        resp = self.client_user.post("/api/pending-issues/", data=payload, format="json")
        self.assertEqual(resp.status_code, 201)
        issue_id = resp.json()["data"]["pending_issue_id"]
        line = PendingIssueLine.objects.get(pending_issue_id=issue_id)
        self.assertEqual(line.allocations_json[0]["bin_abs_entry"], 509)

    @patch("api.issue_views.sap.get_bin_locations_by_warehouse")
    @patch("api.issue_views.sap.get_batch_bin_stock")
    @patch("api.issue_views.sap.get_item_tracking_flags")
    @patch("api.issue_views.sap.get_production_order")
    def test_case_6_insufficient_quantity_in_bin_rejected(
        self, mock_order, mock_flags, mock_stock, mock_bins
    ):
        """
        Case 6: Insufficient quantity in bin is rejected before touching SAP.
        """
        mock_order.return_value = self._mock_order_for_item_2710100006()
        mock_flags.return_value = {"manage_batches": True, "manage_serials": False}
        mock_stock.return_value = [
            {
                "item_code": "2710100006",
                "batch_number": "LOW-STOCK-BATCH",
                "warehouse_code": "20204",
                "bin_abs_entry": 510,
                "bin_code": "20204-A01",
                "on_hand_qty": 10.0,
                "is_system_bin": False,
            }
        ]
        mock_bins.return_value = {"value": [{"AbsEntry": 510}]}

        # Request 15.0 when only 10.0 is available in bin 510
        payload = {
            "production_order_doc_entry": 17184,
            "lines": [
                {
                    "line_number": 0,
                    "item_code": "2710100006",
                    "issue_quantity": 15.0,
                    "warehouse_code": "20204",
                    "allocations": [
                        {
                            "batch_number": "LOW-STOCK-BATCH",
                            "bin_abs_entry": 510,
                            "quantity": 15.0,
                        }
                    ],
                }
            ],
        }

        resp = self.client_user.post("/api/pending-issues/", data=payload, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("insufficient stock", resp.json()["error"])

    @patch("api.issue_views.sap.create_issue_for_production")
    @patch("api.issue_views.sap.get_bin_locations_by_warehouse")
    @patch("api.issue_views.sap.get_batch_bin_stock")
    @patch("api.issue_views.sap.get_item_tracking_flags")
    @patch("api.issue_views.sap.get_production_order")
    def test_case_7_multi_batch_allocations_with_respective_bins_post_correctly(
        self, mock_order, mock_flags, mock_stock, mock_bins, mock_sap_post
    ):
        """
        Case 7: Multi-batch allocations with respective bins (Batch 1 in Bin 510, Batch 2 in Bin 509)
        both post cleanly to SAP with distinct DocumentLinesBinAllocations entries.
        """
        mock_order.return_value = self._mock_order_for_item_2710100006()
        mock_flags.return_value = {"manage_batches": True, "manage_serials": False}
        mock_stock.return_value = [
            {
                "item_code": "2710100006",
                "batch_number": "BATCH-PART-1",
                "warehouse_code": "20204",
                "bin_abs_entry": 510,
                "bin_code": "20204-A01",
                "on_hand_qty": 50.0,
                "is_system_bin": False,
            },
            {
                "item_code": "2710100006",
                "batch_number": "BATCH-PART-2",
                "warehouse_code": "20204",
                "bin_abs_entry": 509,
                "bin_code": "20204-B01",
                "on_hand_qty": 50.0,
                "is_system_bin": False,
            },
        ]
        mock_bins.return_value = {"value": [{"AbsEntry": 510}, {"AbsEntry": 509}]}
        mock_sap_post.return_value = {"DocEntry": "7772", "DocNum": "6662"}

        payload = {
            "production_order_doc_entry": 17184,
            "lines": [
                {
                    "line_number": 0,
                    "item_code": "2710100006",
                    "issue_quantity": 25.0,
                    "warehouse_code": "20204",
                    "allocations": [
                        {"batch_number": "BATCH-PART-1", "bin_abs_entry": 510, "quantity": 10.0},
                        {"batch_number": "BATCH-PART-2", "bin_abs_entry": 509, "quantity": 15.0},
                    ],
                }
            ],
        }

        resp = self.client_user.post("/api/pending-issues/", data=payload, format="json")
        self.assertEqual(resp.status_code, 201)
        issue_id = resp.json()["data"]["pending_issue_id"]

        post_resp = self.client_admin.post(f"/api/admin/pending-issues/{issue_id}/approve-post/")
        self.assertEqual(post_resp.status_code, 200)

        # Inspect SAP payload
        mock_sap_post.assert_called_once()
        sap_payload = mock_sap_post.call_args[0][0]
        doc_line = sap_payload["DocumentLines"][0]

        # Verify 2 batch entries
        batches = doc_line["BatchNumbers"]
        self.assertEqual(len(batches), 2)
        self.assertEqual(batches[0]["BatchNumber"], "BATCH-PART-1")
        self.assertEqual(batches[0]["Quantity"], 10.0)
        self.assertEqual(batches[1]["BatchNumber"], "BATCH-PART-2")
        self.assertEqual(batches[1]["Quantity"], 15.0)

        # Verify 2 bin entries
        bin_allocs = doc_line["DocumentLinesBinAllocations"]
        self.assertEqual(len(bin_allocs), 2)
        self.assertEqual(bin_allocs[0]["BinAbsEntry"], 510)
        self.assertEqual(bin_allocs[0]["Quantity"], 10.0)
        self.assertEqual(bin_allocs[1]["BinAbsEntry"], 509)
        self.assertEqual(bin_allocs[1]["Quantity"], 15.0)

