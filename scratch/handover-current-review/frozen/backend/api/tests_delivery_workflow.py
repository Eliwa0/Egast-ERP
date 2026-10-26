from unittest.mock import MagicMock, patch
from datetime import date
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from api.models import UserModulePermission, UserProfile
from api.models_delivery import DeliveryDraft, DeliveryDraftLine, DeliveryDraftBatch
from api.role_permissions import MODULE_DELIVERY, LEVEL_USER, LEVEL_ADMIN
from api.services.delivery_posting_service import (
    DeliveryPostingService,
    DeliveryStateError,
    calculate_line_open_quantity,
)


class DeliveryWorkflowTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        # Regular operator user
        self.user = User.objects.create_user(username="deliv_user", password="password123")
        profile, _ = UserProfile.objects.get_or_create(user=self.user)
        profile.role = "production_user"
        profile.module_permissions_initialized = True
        profile.save(update_fields=["role", "module_permissions_initialized"])
        UserModulePermission.objects.create(user=self.user, module=MODULE_DELIVERY, level=LEVEL_USER)

        # Manager user
        self.manager = User.objects.create_user(username="deliv_mgr", password="password123")
        m_profile, _ = UserProfile.objects.get_or_create(user=self.manager)
        m_profile.role = "production_admin"
        m_profile.module_permissions_initialized = True
        m_profile.save(update_fields=["role", "module_permissions_initialized"])
        UserModulePermission.objects.create(user=self.manager, module=MODULE_DELIVERY, level=LEVEL_ADMIN)

        # Mock SAP Sales Order
        self.mock_order = {
            "DocEntry": 2001,
            "DocNum": 6001,
            "CardCode": "C20001",
            "CardName": "Beta Construction Co",
            "DocDate": "2026-09-30",
            "DocDueDate": "2026-10-10",
            "DocumentStatus": "bost_Open",
            "Comments": "Sales Order for steel pipes and fittings",
            "DocumentLines": [
                {
                    "LineNum": 0,
                    "ItemCode": "PIPE-01",
                    "ItemDescription": "Seamless Steel Pipe 2-inch",
                    "UoMCode": "MTR",
                    "Quantity": 500.0,
                    "DeliveredQuantity": 100.0,
                    "RemainingOpenQuantity": 400.0,
                    "WarehouseCode": "W01",
                    "LineStatus": "bost_Open",
                },
                {
                    "LineNum": 1,
                    "ItemCode": "ELBOW-01",
                    "ItemDescription": "90 Deg Pipe Elbow 2-inch",
                    "UoMCode": "PCS",
                    "Quantity": 50.0,
                    "DeliveredQuantity": 0.0,
                    "RemainingOpenQuantity": 50.0,
                    "WarehouseCode": "W01",
                    "LineStatus": "bost_Open",
                },
            ],
        }

    def test_calculate_line_open_quantity(self):
        """Verify open quantity calculation precedence."""
        line1 = {"RemainingOpenQuantity": 25.0, "Quantity": 100.0, "DeliveredQuantity": 75.0}
        self.assertEqual(calculate_line_open_quantity(line1), 25.0)

        line2 = {"OpenQuantity": 30.0, "Quantity": 100.0, "DeliveredQuantity": 70.0}
        self.assertEqual(calculate_line_open_quantity(line2), 30.0)

        line3 = {"Quantity": 100.0, "DeliveredQuantity": 40.0}
        self.assertEqual(calculate_line_open_quantity(line3), 60.0)

        closed = {"LineStatus": "bost_Close", "Quantity": 100.0}
        self.assertEqual(calculate_line_open_quantity(closed), 0.0)

    def test_create_draft_from_sales_order(self):
        """Test delivery draft creation from live SAP Sales Order."""
        mock_sap = MagicMock()
        mock_sap.get_sales_order.return_value = self.mock_order

        service = DeliveryPostingService(sap_client=mock_sap)
        draft = service.create_draft(user=self.user, sales_order_doc_entry=2001)

        self.assertEqual(draft.sales_order_doc_entry, 2001)
        self.assertEqual(draft.sales_order_doc_num, "6001")
        self.assertEqual(draft.customer_code, "C20001")
        self.assertEqual(draft.status, DeliveryDraft.STATUS_DRAFT)
        self.assertEqual(draft.lines.count(), 2)

        line0 = draft.lines.get(line_number=0)
        self.assertEqual(line0.item_code, "PIPE-01")
        self.assertEqual(line0.order_quantity, 500.0)
        self.assertEqual(line0.open_quantity_at_draft, 400.0)
        self.assertEqual(line0.delivery_quantity, 400.0)

    def test_closed_order_rejection(self):
        """Cannot create delivery draft for closed Sales Order."""
        closed_order = dict(self.mock_order, DocumentStatus="bost_Close")
        mock_sap = MagicMock()
        mock_sap.get_sales_order.return_value = closed_order

        service = DeliveryPostingService(sap_client=mock_sap)
        with self.assertRaises(DeliveryStateError) as ctx:
            service.create_draft(user=self.user, sales_order_doc_entry=2001)
        self.assertIn("closed", str(ctx.exception).lower())

    def test_duplicate_active_delivery_draft_prevention(self):
        """Cannot create two active delivery drafts for the same Sales Order."""
        mock_sap = MagicMock()
        mock_sap.get_sales_order.return_value = self.mock_order

        service = DeliveryPostingService(sap_client=mock_sap)
        service.create_draft(user=self.user, sales_order_doc_entry=2001)

        with self.assertRaises(DeliveryStateError) as ctx:
            service.create_draft(user=self.user, sales_order_doc_entry=2001)
        self.assertIn("already exists", str(ctx.exception))

    def test_rejected_draft_cannot_reactivate_beside_replacement(self):
        sap = MagicMock()
        sap.get_sales_order.return_value = self.mock_order
        service = DeliveryPostingService(sap)
        rejected = service.create_draft(self.user, 2001)
        rejected.status = DeliveryDraft.STATUS_REJECTED
        rejected.save(update_fields=['status'])
        replacement = service.create_draft(self.user, 2001)
        for operation in [lambda: service.update_draft(rejected, [], self.user),
                          lambda: service.submit_for_review(rejected, self.user)]:
            rejected.refresh_from_db()
            with self.assertRaisesRegex(DeliveryStateError, 'active Delivery Draft'):
                operation()
            rejected.refresh_from_db()
            self.assertEqual(rejected.status, DeliveryDraft.STATUS_REJECTED)
            replacement.refresh_from_db()
            self.assertEqual(replacement.status, DeliveryDraft.STATUS_DRAFT)

    def test_rejected_draft_can_reopen_without_active_replacement(self):
        sap = MagicMock()
        sap.get_sales_order.return_value = self.mock_order
        service = DeliveryPostingService(sap)
        draft = service.create_draft(self.user, 2001)
        draft.status = DeliveryDraft.STATUS_REJECTED
        draft.save(update_fields=['status'])
        service.update_draft(draft, [], self.user)
        draft.refresh_from_db()
        self.assertEqual(draft.status, DeliveryDraft.STATUS_DRAFT)

    def test_update_draft_and_batch_allocations(self):
        """Update line delivery quantity and batch allocations."""
        mock_sap = MagicMock()
        mock_sap.get_sales_order.return_value = self.mock_order

        service = DeliveryPostingService(sap_client=mock_sap)
        draft = service.create_draft(user=self.user, sales_order_doc_entry=2001)

        lines_update = [
            {
                "line_number": 0,
                "delivery_quantity": 150.0,
                "warehouse_code": "W01",
                "batches": [
                    {"batch_number": "BATCH-A1", "quantity": 100.0, "bin_abs_entry": 10, "bin_code": "W01-A-01"},
                    {"batch_number": "BATCH-A2", "quantity": 50.0, "bin_abs_entry": 11, "bin_code": "W01-A-02"},
                ],
            },
            {
                "line_number": 1,
                "delivery_quantity": 0.0,  # partial delivery: line 1 not delivered now
            },
        ]

        updated = service.update_draft(draft=draft, lines_data=lines_update, user=self.user)
        line0 = updated.lines.get(line_number=0)
        self.assertEqual(line0.delivery_quantity, 150.0)
        self.assertEqual(line0.batches.count(), 2)

        # Batch sum mismatch rejection
        bad_batches = [
            {
                "line_number": 0,
                "delivery_quantity": 150.0,
                "batches": [
                    {"batch_number": "BATCH-A1", "quantity": 100.0},
                    {"batch_number": "BATCH-A2", "quantity": 40.0},  # Sum 140 != 150
                ],
            }
        ]
        with self.assertRaises(DeliveryStateError) as ctx:
            service.update_draft(draft=draft, lines_data=bad_batches, user=self.user)
        self.assertIn("does not match", str(ctx.exception))

    def test_over_delivery_rejection(self):
        """Cannot request delivery quantity greater than open quantity."""
        mock_sap = MagicMock()
        mock_sap.get_sales_order.return_value = self.mock_order

        service = DeliveryPostingService(sap_client=mock_sap)
        draft = service.create_draft(user=self.user, sales_order_doc_entry=2001)

        over_delivery = [
            {"line_number": 0, "delivery_quantity": 450.0}  # Open is 400!
        ]
        with self.assertRaises(DeliveryStateError) as ctx:
            service.update_draft(draft=draft, lines_data=over_delivery, user=self.user)
        self.assertIn("exceeds open quantity", str(ctx.exception))

    def test_manager_review_lifecycle(self):
        """Submit -> Approve / Reject."""
        mock_sap = MagicMock()
        mock_sap.get_sales_order.return_value = self.mock_order

        service = DeliveryPostingService(sap_client=mock_sap)
        draft = service.create_draft(user=self.user, sales_order_doc_entry=2001)

        # Submit
        service.submit_for_review(draft=draft, user=self.user)
        self.assertEqual(draft.status, DeliveryDraft.STATUS_PENDING_REVIEW)

        # Reject
        service.reject_review(draft=draft, user=self.manager, reason="Batch inspection incomplete")
        self.assertEqual(draft.status, DeliveryDraft.STATUS_REJECTED)
        self.assertEqual(draft.rejection_reason, "Batch inspection incomplete")

        # Resubmit & Approve
        service.submit_for_review(draft=draft, user=self.user)
        service.approve_review(draft=draft, user=self.manager)
        self.assertEqual(draft.status, DeliveryDraft.STATUS_APPROVED)
        self.assertEqual(draft.reviewed_by, self.manager)

    def test_live_open_qty_re_verification_detects_concurrency_conflict(self):
        """Post time verification aborts if live open quantity decreased below requested delivery quantity."""
        mock_sap = MagicMock()
        mock_sap.get_sales_order.return_value = self.mock_order

        service = DeliveryPostingService(sap_client=mock_sap)
        draft = service.create_draft(user=self.user, sales_order_doc_entry=2001)

        # Operator set delivery_quantity = 300
        service.update_draft(draft, [{"line_number": 0, "delivery_quantity": 300.0}], self.user)
        service.submit_for_review(draft, self.user)
        service.approve_review(draft, self.manager)

        # Concurrently, another shipment delivered 250 in SAP, leaving only 150 open!
        concurrent_order = dict(self.mock_order)
        concurrent_order["DocumentLines"] = [
            dict(self.mock_order["DocumentLines"][0], RemainingOpenQuantity=150.0, DeliveredQuantity=350.0),
            self.mock_order["DocumentLines"][1],
        ]
        mock_sap.get_sales_order.return_value = concurrent_order

        with self.assertRaises(DeliveryStateError) as ctx:
            service.post_delivery_to_sap(draft=draft, user=self.user)

        self.assertIn("exceeds current live SAP open quantity", str(ctx.exception))
        draft.refresh_from_db()
        self.assertEqual(draft.status, DeliveryDraft.STATUS_FAILED)

    def test_native_delivery_note_posting(self):
        """Verify native BaseType: 17, BaseEntry, BaseLine, Batch, and Bin linkage."""
        mock_sap = MagicMock()
        mock_sap.get_sales_order.return_value = self.mock_order
        mock_sap._request.return_value = {"DocEntry": 3003, "DocNum": 9003}

        service = DeliveryPostingService(sap_client=mock_sap)
        draft = service.create_draft(user=self.user, sales_order_doc_entry=2001)

        service.update_draft(
            draft,
            [
                {
                    "line_number": 0,
                    "delivery_quantity": 100.0,
                    "batches": [
                        {"batch_number": "BATCH-01", "quantity": 100.0, "bin_abs_entry": 5, "bin_code": "BIN-A"},
                    ],
                },
                {"line_number": 1, "delivery_quantity": 0.0},
            ],
            self.user
        )
        service.submit_for_review(draft, self.user)
        service.approve_review(draft, self.manager)

        posted = service.post_delivery_to_sap(draft, self.user)
        self.assertEqual(posted.status, DeliveryDraft.STATUS_POSTED)
        self.assertEqual(posted.sap_doc_entry, "3003")
        self.assertEqual(posted.sap_doc_num, "9003")

        # Verify payload sent to SAP
        payload = posted.raw_payload_json
        self.assertEqual(payload["CardCode"], "C20001")
        self.assertEqual(len(payload["DocumentLines"]), 1)

        d_line = payload["DocumentLines"][0]
        self.assertEqual(d_line["BaseType"], 17)
        self.assertEqual(d_line["BaseEntry"], 2001)
        self.assertEqual(d_line["BaseLine"], 0)
        self.assertEqual(d_line["Quantity"], 100.0)

        # Batch & Bin allocations
        self.assertEqual(len(d_line["BatchNumbers"]), 1)
        self.assertEqual(d_line["BatchNumbers"][0]["BatchNumber"], "BATCH-01")
        self.assertEqual(d_line["BatchNumbers"][0]["Quantity"], 100.0)

        self.assertEqual(len(d_line["DocumentLinesBinAllocations"]), 1)
        bin_alloc = d_line["DocumentLinesBinAllocations"][0]
        self.assertEqual(bin_alloc["BinAbsEntry"], 5)
        self.assertEqual(bin_alloc["Quantity"], 100.0)
        self.assertEqual(bin_alloc.get("AllowNegativeQuantity"), "tNO")

    def test_delivery_api_endpoints_permissions(self):
        """Test API endpoints authorization."""
        self.client.force_authenticate(user=self.user)

        with patch("api.services.sap_service.SAPServiceLayer.get_sales_order") as mock_get_order:
            mock_get_order.return_value = self.mock_order

            # User can create draft
            res = self.client.post(
                "/api/customization-delivery/delivery/drafts/",
                {"sales_order_doc_entry": 2001},
                format="json",
            )
            self.assertEqual(res.status_code, 201)

        # Exercise approval on the same draft created through the API.
        draft = DeliveryDraft.objects.get(pk=res.data['draft']['id'])
        draft.status = DeliveryDraft.STATUS_PENDING_REVIEW
        draft.save(update_fields=['status'])
        res_approve = self.client.post(f"/api/customization-delivery/delivery/drafts/{draft.id}/approve/")
        self.assertEqual(res_approve.status_code, 403)

        # Operator cannot post delivery to SAP
        self.client.force_authenticate(user=self.user)
        res_post_op = self.client.post(f"/api/customization-delivery/delivery/drafts/{draft.id}/post/")
        self.assertEqual(res_post_op.status_code, 403)

        # Manager can approve
        self.client.force_authenticate(user=self.manager)
        res_approve_mgr = self.client.post(f"/api/customization-delivery/delivery/drafts/{draft.id}/approve/")
        self.assertEqual(res_approve_mgr.status_code, 200)

    def test_list_available_batches_endpoint(self):
        """Test the available batches lookup endpoint with mocked SAP Service Layer."""
        self.client.force_authenticate(user=self.user)

        # Missing item_code
        res_bad = self.client.get("/api/customization-delivery/batches/")
        self.assertEqual(res_bad.status_code, 400)

        # Valid lookup with mocked SAP execute_sql_query
        with patch("api.services.sap_service.SAPServiceLayer.execute_sql_query") as mock_sql:
            mock_sql.return_value = {
                "value": [
                    {
                        "ItemCode": "PIPE-01",
                        "BatchNumber": "BAT-2026-001",
                        "WhsCode": "W01",
                        "OnHandQty": 250.0,
                        "BinAbsEntry": 15,
                        "BinCode": "W01-BIN-01",
                    },
                    {
                        "ItemCode": "PIPE-01",
                        "BatchNumber": "BAT-EMPTY",
                        "WhsCode": "W01",
                        "OnHandQty": 0.0,
                    },
                    {
                        "ItemCode": "PIPE-01",
                        "BatchNumber": "BAT-OTHER-WHS",
                        "WhsCode": "W02",
                        "OnHandQty": 50.0,
                    },
                ]
            }

            # Filter by warehouse W01
            res = self.client.get("/api/customization-delivery/batches/?item_code=PIPE-01&warehouse_code=W01")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertTrue(data["success"])
            self.assertEqual(len(data["batches"]), 1)
            batch = data["batches"][0]
            self.assertEqual(batch["batch_number"], "BAT-2026-001")
            self.assertEqual(batch["on_hand_qty"], 250.0)
            self.assertEqual(batch["bin_code"], "W01-BIN-01")
            self.assertEqual(batch["bin_abs_entry"], 15)


