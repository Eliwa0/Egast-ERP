from unittest.mock import MagicMock, patch
from decimal import Decimal
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from api.models import UserModulePermission, UserProfile
from api.models_customization import CustomizationDraft, CustomizationDraftLine
from api.role_permissions import MODULE_CUSTOMIZATION, LEVEL_USER, LEVEL_ADMIN
from api.services.customization_service import CustomizationService, CustomizationStateError


class CustomizationWorkflowTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        # Regular operator user
        self.user = User.objects.create_user(username="custom_user", password="password123")
        profile, _ = UserProfile.objects.get_or_create(user=self.user)
        profile.role = "production_user"
        profile.module_permissions_initialized = True
        profile.save(update_fields=["role", "module_permissions_initialized"])
        UserModulePermission.objects.create(user=self.user, module=MODULE_CUSTOMIZATION, level=LEVEL_USER)

        # Manager user
        self.manager = User.objects.create_user(username="custom_mgr", password="password123")
        m_profile, _ = UserProfile.objects.get_or_create(user=self.manager)
        m_profile.role = "production_admin"
        m_profile.module_permissions_initialized = True
        m_profile.save(update_fields=["role", "module_permissions_initialized"])
        UserModulePermission.objects.create(user=self.manager, module=MODULE_CUSTOMIZATION, level=LEVEL_ADMIN)

        # Super admin
        self.admin = User.objects.create_superuser(username="admin_user", email="admin@example.com", password="password123")

        # Mock SAP Sales Quotation payload
        self.mock_quotation = {
            "DocEntry": 1001,
            "DocNum": 5001,
            "CardCode": "C10001",
            "CardName": "Acme Industrial Supplies",
            "DocDate": "2026-09-30",
            "DocDueDate": "2026-10-15",
            "DocumentStatus": "bost_Open",
            "Comments": "Sample quotation for custom parts",
            "DocumentLines": [
                {
                    "LineNum": 0,
                    "ItemCode": "ITEM-001",
                    "ItemDescription": "Standard Steel Flange",
                    "UoMCode": "PCS",
                    "Quantity": 100.0,
                    "UnitPrice": 25.50,
                    "WarehouseCode": "W01",
                    "LineStatus": "bost_Open",
                    "FreeText": "Original spec",
                },
                {
                    "LineNum": 1,
                    "ItemCode": "ITEM-002",
                    "ItemDescription": "Rubber Gasket 4-inch",
                    "UoMCode": "PCS",
                    "Quantity": 200.0,
                    "UnitPrice": 5.00,
                    "WarehouseCode": "W01",
                    "LineStatus": "bost_Open",
                    "FreeText": "",
                },
            ],
        }

    def test_create_draft_and_snapshot(self):
        """Test draft initialization from SAP Quotation with full line snapshot."""
        mock_sap = MagicMock()
        mock_sap.get_sales_quotation.return_value = self.mock_quotation

        service = CustomizationService(sap_client=mock_sap)
        draft = service.create_draft(user=self.user, quotation_doc_entry=1001)

        self.assertEqual(draft.quotation_doc_entry, 1001)
        self.assertEqual(draft.quotation_doc_num, "5001")
        self.assertEqual(draft.customer_code, "C10001")
        self.assertEqual(draft.status, CustomizationDraft.STATUS_DRAFT)
        self.assertEqual(draft.lines.count(), 2)

        line0 = draft.lines.get(line_number=0)
        self.assertEqual(line0.item_code, "ITEM-001")
        self.assertEqual(line0.original_quantity, 100.0)
        self.assertEqual(line0.customized_quantity, 100.0)
        self.assertEqual(line0.original_unit_price, Decimal("25.50"))
        self.assertTrue(line0.is_selected)

    def test_duplicate_active_draft_prevention(self):
        """Cannot create a second active draft for the same Sales Quotation."""
        mock_sap = MagicMock()
        mock_sap.get_sales_quotation.return_value = self.mock_quotation

        service = CustomizationService(sap_client=mock_sap)
        service.create_draft(user=self.user, quotation_doc_entry=1001)

        with self.assertRaises(CustomizationStateError) as ctx:
            service.create_draft(user=self.user, quotation_doc_entry=1001)
        self.assertIn("already exists", str(ctx.exception))

    def test_update_draft_lines(self):
        """Update customized values on draft lines."""
        mock_sap = MagicMock()
        mock_sap.get_sales_quotation.return_value = self.mock_quotation

        service = CustomizationService(sap_client=mock_sap)
        draft = service.create_draft(user=self.user, quotation_doc_entry=1001)

        lines_update = [
            {
                "line_number": 0,
                "customized_quantity": 80.0,
                "customized_unit_price": 28.00,
                "u_specification": "High-Pressure Spec ANSI 300",
                "u_brand": "VortexPro",
                "u_packing": "Crate 50pcs",
                "is_selected": True,
            },
            {
                "line_number": 1,
                "is_selected": False,  # unselected line stays open in quotation
            }
        ]

        updated = service.update_draft(draft=draft, lines_data=lines_update, user=self.user)
        line0 = updated.lines.get(line_number=0)
        self.assertEqual(line0.customized_quantity, 80.0)
        self.assertEqual(line0.customized_unit_price, Decimal("28.00"))
        self.assertEqual(line0.u_specification, "High-Pressure Spec ANSI 300")
        self.assertTrue(line0.is_selected)

        line1 = updated.lines.get(line_number=1)
        self.assertFalse(line1.is_selected)

    def test_internal_review_lifecycle(self):
        """Draft -> Submit -> Review (Approve/Reject)."""
        mock_sap = MagicMock()
        mock_sap.get_sales_quotation.return_value = self.mock_quotation

        service = CustomizationService(sap_client=mock_sap)
        draft = service.create_draft(user=self.user, quotation_doc_entry=1001)

        # Submit
        service.submit_for_internal_review(draft=draft, user=self.user)
        self.assertEqual(draft.status, CustomizationDraft.STATUS_PENDING_INTERNAL_REVIEW)

        # Reject with reason
        service.reject_internal_review(draft=draft, user=self.manager, reason="Price margin too low")
        self.assertEqual(draft.status, CustomizationDraft.STATUS_INTERNAL_REJECTED)
        self.assertEqual(draft.internal_rejection_reason, "Price margin too low")

        # Edit again and re-submit
        service.update_draft(draft, [{"line_number": 0, "customized_unit_price": 30.00}], self.user)
        service.submit_for_internal_review(draft, self.user)
        self.assertEqual(draft.status, CustomizationDraft.STATUS_PENDING_INTERNAL_REVIEW)

        # Approve
        service.approve_internal_review(draft=draft, user=self.manager, notes="Approved at updated margin")
        self.assertEqual(draft.status, CustomizationDraft.STATUS_INTERNAL_APPROVED)
        self.assertEqual(draft.internal_reviewed_by, self.manager)

    def test_external_sap_change_detection_aborts_patch(self):
        """Before PATCH, if SAP quotation changed externally, sync must abort."""
        mock_sap = MagicMock()
        mock_sap.get_sales_quotation.return_value = self.mock_quotation

        service = CustomizationService(sap_client=mock_sap)
        draft = service.create_draft(user=self.user, quotation_doc_entry=1001)
        service.submit_for_internal_review(draft, self.user)
        service.approve_internal_review(draft, self.manager)

        # Simulate external change in SAP (e.g. quantity on line 0 changed to 150)
        altered_quotation = dict(self.mock_quotation)
        altered_quotation["DocumentLines"] = [
            dict(self.mock_quotation["DocumentLines"][0], Quantity=150.0),
            self.mock_quotation["DocumentLines"][1],
        ]
        mock_sap.get_sales_quotation.return_value = altered_quotation

        with self.assertRaises(CustomizationStateError) as ctx:
            service.patch_sap_quotation(draft, self.user)

        self.assertIn("modified externally in SAP", str(ctx.exception))
        draft.refresh_from_db()
        self.assertEqual(draft.status, CustomizationDraft.STATUS_PATCH_FAILED)

    def test_patch_same_quotation_and_customer_approval_gate(self):
        """Same quotation PATCH -> Customer approval gate -> Sales Order creation."""
        mock_sap = MagicMock()
        mock_sap.get_sales_quotation.return_value = self.mock_quotation
        mock_sap._request.return_value = {}  # PATCH returns empty or dict

        service = CustomizationService(sap_client=mock_sap)
        draft = service.create_draft(user=self.user, quotation_doc_entry=1001)

        # Customize line 0, deselect line 1
        service.update_draft(
            draft,
            [
                {"line_number": 0, "customized_quantity": 90.0, "customized_unit_price": 27.50},
                {"line_number": 1, "is_selected": False},
            ],
            self.user
        )
        service.submit_for_internal_review(draft, self.user)
        service.approve_internal_review(draft, self.manager)

        # PATCH quotation in SAP
        service.patch_sap_quotation(draft, self.user)
        draft.refresh_from_db()
        self.assertEqual(draft.status, CustomizationDraft.STATUS_WAITING_CUSTOMER_APPROVAL)

        # Verify PATCH was called on the same Quotation DocEntry
        mock_sap._request.assert_called_with("PATCH", "Quotations(1001)", draft.raw_patch_payload)

        # Customer Approval: Reject unauthorized type
        with self.assertRaises(CustomizationStateError):
            service.record_customer_approval(
                draft=draft,
                user=self.user,
                approval_type="MANAGEMENT_OVERRIDE",  # Strictly forbidden
                reference_number="PO-999",
                contact_person="John Doe",
            )

        # Customer Approval: Valid PO
        service.record_customer_approval(
            draft=draft,
            user=self.user,
            approval_type=CustomizationDraft.APPROVAL_TYPE_PO,
            reference_number="PO-ACME-8842",
            contact_person="Jane Smith (Procurement Dir)",
            notes="Received via signed PDF",
        )
        draft.refresh_from_db()
        self.assertEqual(draft.status, CustomizationDraft.STATUS_READY_FOR_ORDER)
        self.assertEqual(draft.customer_reference_number, "PO-ACME-8842")

        # Create Sales Order: mock SAP response
        mock_sap._request.return_value = {"DocEntry": 2002, "DocNum": 7002}
        service.post_sales_order_to_sap(draft, self.user)
        draft.refresh_from_db()

        self.assertEqual(draft.status, CustomizationDraft.STATUS_ORDER_POSTED)
        self.assertEqual(draft.sap_order_doc_entry, "2002")
        self.assertEqual(draft.sap_order_doc_num, "7002")

        # Verify native base linkage in posted payload:
        # BaseType: 23, BaseEntry: 1001, BaseLine: 0
        order_payload = draft.raw_order_payload
        self.assertEqual(order_payload["CardCode"], "C10001")
        self.assertEqual(order_payload["NumAtCard"], "PO-ACME-8842")
        self.assertEqual(len(order_payload["DocumentLines"]), 1)  # line 1 was unselected!
        order_line = order_payload["DocumentLines"][0]
        self.assertEqual(order_line["BaseType"], 23)
        self.assertEqual(order_line["BaseEntry"], 1001)
        self.assertEqual(order_line["BaseLine"], 0)
        self.assertEqual(order_line["Quantity"], 90.0)

    def _order_only_ready_draft(self):
        draft = CustomizationDraft.objects.create(
            quotation_doc_entry=1001, quotation_doc_num='5001', customer_code='C10001',
            customer_name='Order-only customer', status=CustomizationDraft.STATUS_READY_FOR_ORDER,
            customer_reference_number='PO-ORDER-ONLY', created_by=self.user,
        )
        CustomizationDraftLine.objects.create(
            draft=draft, line_number=0, item_code='ITEM-001', original_quantity=10,
            customized_quantity=10, original_unit_price=25, customized_unit_price=25,
            warehouse_code='W01', is_selected=True,
        )
        return draft

    @patch('api.services.customization_service.SAPServiceLayer')
    def test_create_order_endpoint_stops_after_orders_post_without_delivery(self, factory):
        from api.models_delivery import DeliveryDraft, DeliveryDraftLine, DeliveryDraftBatch
        draft = self._order_only_ready_draft()
        self.client.force_authenticate(self.manager)
        sap = factory.return_value
        sap._request.return_value = {'DocEntry': 2002, 'DocNum': 7002}
        response = self.client.post(f'/api/customization-delivery/customization/drafts/{draft.id}/create-order/', {}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['draft']['status'], 'ORDER_POSTED')
        self.assertEqual(response.data['draft']['sap_order_doc_entry'], '2002')
        self.assertEqual(response.data['draft']['sap_order_doc_num'], '7002')
        sap._request.assert_called_once()
        method, endpoint, payload = sap._request.call_args.args
        self.assertEqual((method, endpoint), ('POST', 'Orders'))
        self.assertEqual(payload['DocumentLines'][0]['BaseType'], 23)
        self.assertEqual(payload['DocumentLines'][0]['BaseEntry'], 1001)
        self.assertEqual(DeliveryDraft.objects.count(), 0)
        self.assertEqual(DeliveryDraftLine.objects.count(), 0)
        self.assertEqual(DeliveryDraftBatch.objects.count(), 0)
        # Repeating the action must neither duplicate the order nor create a delivery.
        repeat = self.client.post(f'/api/customization-delivery/customization/drafts/{draft.id}/create-order/', {}, format='json')
        self.assertEqual(repeat.status_code, 200)
        sap._request.assert_called_once()
        self.assertEqual(DeliveryDraft.objects.count(), 0)

    @patch('api.services.customization_service.SAPServiceLayer')
    def test_rejected_order_never_creates_delivery_or_reports_success(self, factory):
        from api.models_delivery import DeliveryDraft
        draft = self._order_only_ready_draft()
        self.client.force_authenticate(self.manager)
        factory.return_value._request.return_value = {'error': {'message': 'Order rejected'}}
        response = self.client.post(f'/api/customization-delivery/customization/drafts/{draft.id}/create-order/', {}, format='json')
        self.assertEqual(response.status_code, 502)
        self.assertFalse(response.data['success'])
        draft.refresh_from_db()
        self.assertEqual(draft.status, CustomizationDraft.STATUS_ORDER_FAILED)
        self.assertFalse(draft.sap_order_doc_entry)
        factory.return_value._request.assert_called_once()
        self.assertEqual(factory.return_value._request.call_args.args[:2], ('POST', 'Orders'))
        self.assertEqual(DeliveryDraft.objects.count(), 0)

    def test_api_endpoints_permissions(self):
        """Verify API endpoints require proper authentication and module permissions."""
        self.client.force_authenticate(user=self.user)

        with patch("api.services.sap_service.SAPServiceLayer.get_sales_quotation") as mock_get_q:
            mock_get_q.return_value = self.mock_quotation

            # User can create draft
            res = self.client.post(
                "/api/customization-delivery/customization/drafts/",
                {"quotation_doc_entry": 1001},
                format="json",
            )
            self.assertEqual(res.status_code, 201)

        # Operator cannot approve (requires admin)
        draft = CustomizationDraft.objects.create(
            quotation_doc_entry=1002,
            quotation_doc_num="5002",
            customer_code="C10001",
            status=CustomizationDraft.STATUS_PENDING_INTERNAL_REVIEW,
        )
        res_approve = self.client.post(f"/api/customization-delivery/customization/drafts/{draft.id}/approve/")
        self.assertEqual(res_approve.status_code, 403)

        # Manager can approve
        self.client.force_authenticate(user=self.manager)
        res_approve_mgr = self.client.post(
            f"/api/customization-delivery/customization/drafts/{draft.id}/approve/",
            {"notes": "Looks good"},

            format="json",
        )
        self.assertEqual(res_approve_mgr.status_code, 200)
    @patch("api.services.sap_service.SAPServiceLayer.get_sales_quotation")
    @patch("api.services.sap_service.SAPServiceLayer.create_sales_quotation")
    def test_create_sales_quotation_and_draft_api(self, mock_create, mock_get):
        """DIRECT SAP CREATION: creating a quotation via wizard posts immediately to SAP Business One."""
        self.client.force_authenticate(user=self.user)
        mock_create.return_value = {
            "DocEntry": 11160,
            "DocNum": 132000018,
            "CardCode": "C10001",
            "CardName": "Acme Industrial Supplies",
            "DocumentLines": [
                {
                    "LineNum": 0,
                    "ItemCode": "ITEM-001",
                    "ItemDescription": "Standard Steel Flange",
                    "Quantity": 50.0,
                    "UnitPrice": 30.0,
                    "WarehouseCode": "W01",
                }
            ],
        }
        mock_get.return_value = mock_create.return_value

        payload = {
            "customer_code": "C10001",
            "customer_name": "Acme Industrial Supplies",
            "doc_date": "2026-09-30",
            "doc_due_date": "2026-10-15",
            "comments": "Testing layer 1",
            "lines": [
                {
                    "item_code": "ITEM-001",
                    "item_description": "Standard Steel Flange",
                    "quantity": 50.0,
                    "unit_price": 30.0,
                    "warehouse_code": "W01",
                    "free_text": "Custom packaging",
                    "u_brand": "MeemBrand",
                }
            ],
        }

        res = self.client.post(
            "/api/customization-delivery/quotations/create/",
            payload,
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertTrue(data["success"])
        # Crucial: verify SAP WAS called directly
        mock_create.assert_called_once()
        self.assertEqual(data["quotation_doc_entry"], 11160)
        self.assertEqual(data["quotation_doc_num"], "132000018")

        draft_id = data["draft"]["id"]
        draft = CustomizationDraft.objects.get(id=draft_id)
        # Crucial: verify quotation_doc_entry is 11160 and status is READY_FOR_ORDER
        self.assertEqual(draft.quotation_doc_entry, 11160)
        self.assertEqual(draft.quotation_doc_num, "132000018")
        self.assertEqual(draft.status, CustomizationDraft.STATUS_READY_FOR_ORDER)
        self.assertTrue(draft.is_local_creation)
        self.assertEqual(draft.lines.count(), 1)
        line = draft.lines.first()
        self.assertEqual(line.customized_quantity, 50.0)
        self.assertEqual(line.warehouse_code, "W01")
        self.assertEqual(line.free_text, "Custom packaging")
        self.assertEqual(line.u_brand, "MeemBrand")

    @patch("api.services.sap_service.SAPServiceLayer._request")
    @patch("api.services.sap_service.SAPServiceLayer.create_sales_quotation")
    @patch("api.services.sap_service.SAPServiceLayer.get_sales_quotation")
    def test_local_first_sales_quotation_timing_lifecycle(self, mock_get_q, mock_create_q, mock_request):
        """
        Verify the backward-compatible local draft lifecycle:
        Local Draft -> Pending Review -> Reject (no SAP) -> Resubmit -> Approve (no SAP) ->
        Customer Approval (creates SAP quotation exactly once) -> Sales Order (BaseType 23) -> Idempotency.
        """
        self.client.force_authenticate(user=self.user)

        # 1. Create local quotation draft (action="save_draft")
        payload = {
            "action": "save_draft",
            "customer_code": "C10001",
            "customer_name": "Acme Industrial Supplies",
            "doc_date": "2026-09-30",
            "doc_due_date": "2026-10-15",
            "comments": "Testing local first timing",
            "lines": [
                {
                    "item_code": "ITEM-001",
                    "item_description": "Standard Steel Flange",
                    "quantity": 100.0,
                    "unit_price": 25.0,
                    "warehouse_code": "W01",
                }
            ],
        }
        res = self.client.post("/api/customization-delivery/customization/drafts/", payload, format="json")
        self.assertEqual(res.status_code, 201)
        draft_id = res.json()["draft"]["id"]
        mock_create_q.assert_not_called()

        draft = CustomizationDraft.objects.get(id=draft_id)
        self.assertIsNone(draft.quotation_doc_entry)

        # Submit for review
        res_submit_initial = self.client.post(f"/api/customization-delivery/customization/drafts/{draft.id}/submit/")
        self.assertEqual(res_submit_initial.status_code, 200)
        draft.refresh_from_db()
        self.assertEqual(draft.status, CustomizationDraft.STATUS_PENDING_INTERNAL_REVIEW)

        # 2. Manager rejects the review
        self.client.force_authenticate(user=self.manager)
        res_reject = self.client.post(
            f"/api/customization-delivery/customization/drafts/{draft.id}/reject/",
            {"reason": "Margin too thin"},
            format="json",
        )
        self.assertEqual(res_reject.status_code, 200)
        draft.refresh_from_db()
        self.assertEqual(draft.status, CustomizationDraft.STATUS_INTERNAL_REJECTED)
        # Verify still NO SAP quotation exists
        mock_create_q.assert_not_called()
        self.assertIsNone(draft.quotation_doc_entry)

        # 3. Operator resubmits
        self.client.force_authenticate(user=self.user)
        res_submit = self.client.post(f"/api/customization-delivery/customization/drafts/{draft.id}/submit/")
        self.assertEqual(res_submit.status_code, 200)
        draft.refresh_from_db()
        self.assertEqual(draft.status, CustomizationDraft.STATUS_PENDING_INTERNAL_REVIEW)

        # 4. Manager approves
        self.client.force_authenticate(user=self.manager)
        res_approve = self.client.post(
            f"/api/customization-delivery/customization/drafts/{draft.id}/approve/",
            {"notes": "Approved upon review"},
            format="json",
        )
        self.assertEqual(res_approve.status_code, 200)
        draft.refresh_from_db()
        # Verify status is INTERNAL_APPROVED and STILL NO SAP quotation exists!
        self.assertEqual(draft.status, CustomizationDraft.STATUS_INTERNAL_APPROVED)
        mock_create_q.assert_not_called()
        self.assertIsNone(draft.quotation_doc_entry)

        # 5. Customer Approval Gate -> Now creates the official SAP quotation
        mock_create_q.return_value = {
            "DocEntry": 9901,
            "DocNum": 13200999,
            "CardCode": "C10001",
            "CardName": "Acme Industrial Supplies",
            "DocumentLines": [
                {
                    "LineNum": 0,
                    "ItemCode": "ITEM-001",
                    "ItemDescription": "Standard Steel Flange",
                    "Quantity": 100.0,
                    "UnitPrice": 25.0,
                    "WarehouseCode": "W01",
                }
            ],
        }
        mock_get_q.return_value = mock_create_q.return_value

        res_cust = self.client.post(
            f"/api/customization-delivery/customization/drafts/{draft.id}/customer-approval/",
            {
                "approval_type": "PURCHASE_ORDER",
                "reference_number": "PO-998877",
                "contact_person": "Jane Doe",
                "notes": "Signed order received",
            },
            format="json",
        )
        self.assertEqual(res_cust.status_code, 200)
        # Verify SAP quotation creation was called EXACTLY ONCE
        mock_create_q.assert_called_once()

        draft.refresh_from_db()
        self.assertEqual(draft.status, CustomizationDraft.STATUS_READY_FOR_ORDER)
        self.assertEqual(draft.quotation_doc_entry, 9901)
        self.assertEqual(draft.quotation_doc_num, "13200999")

        # 6. Retry recording customer approval -> Must NOT create duplicate SAP quotation
        res_cust_retry = self.client.post(
            f"/api/customization-delivery/customization/drafts/{draft.id}/customer-approval/",
            {
                "approval_type": "PURCHASE_ORDER",
                "reference_number": "PO-998877",
                "contact_person": "Jane Doe",
            },
            format="json",
        )
        self.assertEqual(res_cust_retry.status_code, 200)
        # Call count remains 1!
        mock_create_q.assert_called_once()

        # 7. Create Sales Order linked with BaseType: 23
        mock_request.return_value = {"DocEntry": 8801, "DocNum": 31100888}
        res_order = self.client.post(
            f"/api/customization-delivery/customization/drafts/{draft.id}/create-order/",
            {"doc_due_date": "2026-10-20"},
            format="json",
        )
        self.assertEqual(res_order.status_code, 200)
        draft.refresh_from_db()
        self.assertEqual(draft.status, CustomizationDraft.STATUS_ORDER_POSTED)
        self.assertEqual(draft.sap_order_doc_entry, "8801")
        self.assertEqual(draft.sap_order_doc_num, "31100888")

        # Verify BaseType: 23 relationship
        order_payload = draft.raw_order_payload
        self.assertEqual(order_payload["CardCode"], "C10001")
        order_line = order_payload["DocumentLines"][0]
        self.assertEqual(order_line["BaseType"], 23)
        self.assertEqual(order_line["BaseEntry"], 9901)
        self.assertEqual(order_line["BaseLine"], 0)

    @patch("api.services.sap_service.SAPServiceLayer._request")
    def test_list_sales_customers_and_items_api(self, mock_request):
        from api.services.cache_service import invalidate_cache_namespaces, sap_master_namespace
        invalidate_cache_namespaces(sap_master_namespace("sales-customers"))
        self.client.force_authenticate(user=self.user)
        mock_request.return_value = {
            "value": [
                {"CardCode": "C10001", "CardName": "Customer A", "Currency": "USD"},
            ]
        }
        res_cust = self.client.get("/api/customization-delivery/customers/")
        self.assertEqual(res_cust.status_code, 200)
        self.assertEqual(len(res_cust.json()["customers"]), 1)

        mock_request.return_value = {
            "value": [
                {"ItemCode": "ITEM-001", "ItemName": "Item A", "InventoryUOM": "PCS"},
            ]
        }
        res_items = self.client.get("/api/customization-delivery/items/")
        self.assertEqual(res_items.status_code, 200)
        self.assertEqual(len(res_items.json()["items"]), 1)

    @patch("api.services.sap_service.SAPServiceLayer.get_sales_order")
    def test_list_eligible_delivery_orders_api(self, mock_get_order):
        from api.models_delivery import DeliveryDraft
        from api.models import UserModulePermission
        from api.role_permissions import MODULE_DELIVERY, LEVEL_USER

        UserModulePermission.objects.create(user=self.user, module=MODULE_DELIVERY, level=LEVEL_USER)
        self.client.force_authenticate(user=self.user)

        # Create a customization draft that has posted an order
        draft = CustomizationDraft.objects.create(
            quotation_doc_entry=1001,
            quotation_doc_num="5001",
            customer_code="C10001",
            customer_name="Acme",
            status=CustomizationDraft.STATUS_ORDER_POSTED,
            sap_order_doc_entry="7001",
            sap_order_doc_num="8001",
        )
        CustomizationDraftLine.objects.create(
            draft=draft,
            line_number=0,
            item_code="ITEM-001",
            item_description="Test Item",
            customized_quantity=100.0,
            is_selected=True,
        )

        mock_get_order.return_value = {
            "DocEntry": 7001,
            "DocNum": 8001,
            "DocumentStatus": "bost_Open",
            "DocumentLines": [
                {
                    "LineNum": 0,
                    "ItemCode": "ITEM-001",
                    "ItemDescription": "Test Item",
                    "Quantity": 100.0,
                    "RemainingOpenQuantity": 40.0,
                }
            ],
        }

        res = self.client.get("/api/customization-delivery/delivery/eligible-orders/")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        self.assertEqual(len(data["orders"]), 1)
        order_card = data["orders"][0]
        self.assertEqual(order_card["sales_order_doc_entry"], 7001)
        self.assertEqual(order_card["ordered_quantity"], 100.0)
        self.assertEqual(order_card["remaining_open_quantity"], 40.0)
        self.assertEqual(order_card["delivered_quantity"], 60.0)
        self.assertTrue(order_card["has_remaining"])

    @patch("api.customization_views.SAPServiceLayer")
    def test_list_sales_customers_sap_driven(self, mock_sap_cls):
        """Test sales customers endpoint returns enriched, filtered SAP customer master data."""
        from api.services.cache_service import invalidate_cache_namespaces, sap_master_namespace
        invalidate_cache_namespaces(sap_master_namespace("sales-customers"))
        mock_sap = MagicMock()
        mock_sap_cls.return_value = mock_sap

        from api.customization_views import _OCTG_TERMS_CACHE
        _OCTG_TERMS_CACHE.clear()

        mock_sap.execute_sql_query.return_value = {
            "value": [{"GroupNum": 18, "PymntGroup": "Net 60 Days"}]
        }

        mock_sap._request.return_value = {
            "value": [
                {
                    "CardCode": "C10001",
                    "CardName": "Acme Europe BV",
                    "Currency": "EUR",
                    "PriceListNum": 2,
                    "PayTermsGrpCode": 18,
                    "ShipToDefault": "SHIP-1",
                    "BilltoDefault": "BILL-1",
                    "ContactEmployees": [
                        {"InternalCode": 838, "Name": "John Doe", "E_Mail": "john@acme.com"}
                    ],
                },
                {
                    "CardCode": "C10002",
                    "CardName": "   ",  # Blank name should be filtered out
                    "Currency": "EUR",
                },
            ]
        }

        self.client.force_authenticate(user=self.admin)
        res = self.client.get("/api/customization-delivery/customers/?search=Acme")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        self.assertEqual(len(data["customers"]), 1)
        cust = data["customers"][0]
        self.assertEqual(cust["card_code"], "C10001")
        self.assertEqual(cust["card_name"], "Acme Europe BV")
        self.assertEqual(cust["currency"], "EUR")
        self.assertEqual(cust["price_list_num"], 2)
        self.assertEqual(cust["payment_group_code"], 18)
        self.assertEqual(cust["payment_terms_name"], "Net 60 Days")
        self.assertNotIn("contact_persons", cust)
        self.assertNotIn("contact_person", cust)
        self.assertEqual(cust["ship_to_default"], "SHIP-1")
        self.assertEqual(cust["bill_to_default"], "BILL-1")
        customer_query = mock_sap._request.call_args_list[0].args[1]
        self.assertIn("BilltoDefault", customer_query)
        self.assertNotIn("BillToDefault", customer_query)
        self.assertNotIn("ContactPerson", customer_query)

    @patch("api.customization_views.SAPServiceLayer")
    def test_list_sales_customers_surfaces_sap_failure(self, mock_sap_cls):
        from api.services.cache_service import invalidate_cache_namespaces, sap_master_namespace
        invalidate_cache_namespaces(sap_master_namespace("sales-customers"))
        mock_sap = MagicMock()
        mock_sap_cls.return_value = mock_sap
        mock_sap._request.return_value = {"error": {"message": "Invalid SAP property"}}

        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/customization-delivery/customers/")

        self.assertEqual(response.status_code, 502)
        self.assertFalse(response.json()["success"])
        self.assertEqual(response.json()["error"], "Unable to load customers from SAP.")

    @patch("api.customization_views.SAPServiceLayer")
    def test_list_sales_customers_pagination_exceeds_500(self, mock_sap_cls):
        """Test sales customers endpoint fully traverses odata.nextLink past 500 records."""
        from api.services.cache_service import invalidate_cache_namespaces, sap_master_namespace
        invalidate_cache_namespaces(sap_master_namespace("sales-customers"))
        mock_sap = MagicMock()
        mock_sap_cls.return_value = mock_sap

        page1 = [
            {"CardCode": f"C{i:04d}", "CardName": f"Customer {i}", "Currency": "USD"}
            for i in range(1, 501)
        ]
        page2 = [
            {"CardCode": "CXACA003", "CardName": "Salix", "Currency": "USD"},
            {"CardCode": "C9999", "CardName": "Zeta Corp", "Currency": "USD"},
        ]

        def mock_request(method, endpoint, **kwargs):
            if "skip=500" in endpoint:
                return {
                    "value": page2,
                }
            return {
                "value": page1,
                "odata.nextLink": "BusinessPartners?$skip=500",
            }

        mock_sap._request.side_effect = mock_request
        mock_sap.execute_sql_query.return_value = {"value": []}

        self.client.force_authenticate(user=self.admin)
        res = self.client.get("/api/customization-delivery/customers/")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        # Total must exceed 500 (500 + 2 = 502)
        self.assertEqual(len(data["customers"]), 502)
        # Verify CXACA003 exists in the returned list
        cx_cust = next((c for c in data["customers"] if c["card_code"] == "CXACA003"), None)
        self.assertIsNotNone(cx_cust)
        self.assertEqual(cx_cust["card_name"], "Salix")

        # Test search with lowercase "cx"
        res_cx = self.client.get("/api/customization-delivery/customers/?search=cx")
        self.assertEqual(res_cx.status_code, 200)
        data_cx = res_cx.json()
        self.assertEqual(len(data_cx["customers"]), 1)
        self.assertEqual(data_cx["customers"][0]["card_code"], "CXACA003")

        # Test search with "Salix"
        res_salix = self.client.get("/api/customization-delivery/customers/?search=salix")
        self.assertEqual(res_salix.status_code, 200)
        data_salix = res_salix.json()
        self.assertEqual(len(data_salix["customers"]), 1)
        self.assertEqual(data_salix["customers"][0]["card_name"], "Salix")

    @patch("api.customization_views.SAPServiceLayer")
    def test_list_sales_items_sap_driven(self, mock_sap_cls):
        """Test sales items endpoint returns SalesUnit and resolves price from customer price list."""
        mock_sap = MagicMock()
        mock_sap_cls.return_value = mock_sap

        mock_sap._request.return_value = {
            "value": [
                {
                    "ItemCode": "1110119001",
                    "ItemName": "Orange Carozo Export",
                    "SalesUnit": "KG",
                    "ItemPrices": [
                        {"PriceList": 1, "Price": 1.25, "Currency": "EUR"},
                        {"PriceList": 2, "Price": 1.45, "Currency": "EUR"},
                    ],
                }
            ]
        }

        self.client.force_authenticate(user=self.admin)
        res = self.client.get("/api/customization-delivery/items/?search=Carozo&price_list=2")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        self.assertEqual(len(data["items"]), 1)
        item = data["items"][0]
        self.assertEqual(item["item_code"], "1110119001")
        self.assertEqual(item["sales_unit"], "KG")
        self.assertEqual(item["default_price"], 1.45)

    @patch("api.services.customization_service.SAPServiceLayer")
    def test_create_quotation_payload_sap_fields(self, mock_sap_cls):
        """Test that create_quotation_and_draft sends full SAP commercial context and line UDFs."""
        mock_sap = MagicMock()
        mock_sap_cls.return_value = mock_sap

        mock_sap.create_sales_quotation.return_value = {
            "DocEntry": 9901,
            "DocNum": 9901,
            "CardCode": "C10001",
            "CardName": "Acme Europe BV",
            "DocDate": "2026-09-30",
            "DocDueDate": "2026-10-15",
            "DocumentStatus": "bost_Open",
            "DocumentLines": [
                {
                    "LineNum": 0,
                    "ItemCode": "1110119001",
                    "ItemDescription": "Orange Carozo Export",
                    "Quantity": 500.0,
                    "UnitPrice": 1.45,
                    "WarehouseCode": "01",
                    "FreeText": None,
                }
            ],
        }

        service = CustomizationService(sap_client=mock_sap)
        draft = service.create_quotation_and_draft(
            user=self.user,
            customer_code="C10001",
            customer_name="Acme Europe BV",
            doc_date="2026-09-30",
            doc_due_date="2026-10-15",
            comments="Export quotation",
            currency="EUR",
            payment_group_code=18,
            sales_person_code=9,
            wrapping="Yes",
            tax_date="2026-09-30",
            doc_rate=52.25,
            header_fields={
                "po_number": "PO-2026-77",
                "contract_no": "CON-77",
                "lc_number": "LC-88",
                "container_count": "9",
                "header_uom": "Package",
                "week_no": 40,
                "pay_to_code": "BILL-1",
                "ship_to_code": "SHIP-1",
                "transportation_code": 1,
                "shipping_line": "MSC",
                "etd": "2026-10-01",
                "eta": "2026-10-20",
                "incoterms": "CFR",
                "pol": "Alexandria",
                "pod": "Rotterdam",
                "notify": "Notify party",
                "dhl": "DHL instructions",
            },
            lines_data=[
                {
                    "item_code": "1110119001",
                    "item_description": "Orange Carozo Export",
                    "quantity": 500.0,
                    "unit_price": 1.45,
                    "uom": "KG",
                    "u_brand": "Carozo Brand",
                    "u_size": "48",
                    "u_specification": "Export Grade A",
                    "u_pallets": 10,
                    "discount_percent": 2.5,
                    "u_container_no": "CONT-100",
                    "u_packed": 25,
                    "u_defect": "7%",
                    "free_text": "Spec free text",
                    "tax_code": "O1",
                }
            ],
        )

        self.assertEqual(draft.quotation_doc_entry, 9901)

        # Verify the payload sent to SAP create_sales_quotation
        mock_sap.create_sales_quotation.assert_called_once()
        called_payload = mock_sap.create_sales_quotation.call_args[0][0]

        self.assertEqual(called_payload["CardCode"], "C10001")
        self.assertEqual(called_payload["DocCurrency"], "EUR")
        self.assertEqual(called_payload["PaymentGroupCode"], 18)
        self.assertNotIn("ContactPersonCode", called_payload)
        self.assertEqual(called_payload["SalesPersonCode"], 9)
        self.assertEqual(called_payload["U_Wrapping"], "Yes")
        self.assertEqual(called_payload["TaxDate"], "2026-09-30")
        self.assertEqual(called_payload["DocRate"], 52.25)
        self.assertEqual(called_payload["NumAtCard"], "PO-2026-77")
        self.assertEqual(called_payload["U_Contract_no"], "CON-77")
        self.assertEqual(called_payload["U_LC"], "LC-88")
        self.assertEqual(called_payload["U_TCON"], "9")
        self.assertEqual(called_payload["U_UOM"], "Package")
        self.assertEqual(called_payload["U_week_no"], 40)
        self.assertEqual(called_payload["PayToCode"], "BILL-1")
        self.assertEqual(called_payload["ShipToCode"], "SHIP-1")
        self.assertEqual(called_payload["TransportationCode"], 1)
        self.assertEqual(called_payload["U_Shipping"], "MSC")
        self.assertEqual(called_payload["U_Shipment"], "CFR")
        self.assertEqual(called_payload["U_POL"], "Alexandria")
        self.assertEqual(called_payload["U_POD"], "Rotterdam")

        line_payload = called_payload["DocumentLines"][0]
        self.assertEqual(line_payload["ItemCode"], "1110119001")
        self.assertEqual(line_payload["Quantity"], 500.0)
        self.assertEqual(line_payload["UnitPrice"], 1.45)
        self.assertNotIn("WarehouseCode", line_payload)
        self.assertNotIn("CostingCode", line_payload)
        self.assertNotIn("CostingCode2", line_payload)
        self.assertEqual(line_payload["U_Brand"], "Carozo Brand")
        self.assertEqual(line_payload["U_size"], "48")
        self.assertEqual(line_payload["U_Pallets"], "10")
        self.assertEqual(line_payload["DiscountPercent"], 2.5)
        self.assertEqual(line_payload["U_Container_no"], "CONT-100")
        self.assertEqual(line_payload["U_PACKED"], 25.0)
        self.assertEqual(line_payload["U_Defect"], "7%")
        self.assertNotIn("U_Housh", line_payload)
        self.assertNotIn("U_Alternative", line_payload)
        self.assertNotIn("U_Alternate_Item_Desc", line_payload)
        self.assertEqual(line_payload["TaxCode"], "O1")
        self.assertEqual(line_payload["VatGroup"], "O1")

    @patch("api.services.customization_service.SAPServiceLayer")
    def test_create_quotation_payload_empty_tax_code_omitted(self, mock_sap_cls):
        """When tax_code is empty or omitted, TaxCode and VatGroup are not sent to SAP, letting SAP apply its native defaults."""
        mock_sap = MagicMock()
        mock_sap_cls.return_value = mock_sap
        mock_sap.create_sales_quotation.return_value = {
            "DocEntry": 9902,
            "DocNum": 9902,
            "CardCode": "C10001",
            "DocumentLines": [],
        }

        service = CustomizationService(sap_client=mock_sap)
        service.create_quotation_and_draft(
            user=self.user,
            customer_code="C10001",
            doc_date="2026-09-30",
            doc_due_date="2026-10-15",
            lines_data=[
                {
                    "item_code": "1110119001",
                    "quantity": 10.0,
                    "unit_price": 5.0,
                    "tax_code": "",
                }
            ],
        )

        called_payload = mock_sap.create_sales_quotation.call_args[0][0]
        line_payload = called_payload["DocumentLines"][0]
        self.assertNotIn("TaxCode", line_payload)
        self.assertNotIn("VatGroup", line_payload)

    def test_save_local_draft_and_submit_to_review(self):
        """User can save local draft without SAP posting, then submit for review."""
        service = CustomizationService()
        # 1. Save draft
        draft = service.save_or_update_draft(
            user=self.user,
            customer_code="C10001",
            customer_name="Acme Corp",
            doc_date="2026-10-01",
            doc_due_date="2026-10-15",
            comments="Test draft",
            lines_data=[
                {
                    "item_code": "1110119001",
                    "item_description": "Orange Carozo Export",
                    "quantity": 25.0,
                    "unit_price": 12.5,
                    "tax_code": "O1",
                    "u_brand": "EGAST",
                }
            ],
            submit=False,
        )
        self.assertEqual(draft.status, CustomizationDraft.STATUS_DRAFT)
        self.assertIsNone(draft.quotation_doc_entry)
        self.assertEqual(draft.quotation_doc_num, "")
        self.assertEqual(draft.lines.count(), 1)
        self.assertEqual(draft.lines.first().tax_code, "O1")

        # 2. Submit for review
        submitted = service.submit_for_internal_review(draft, self.user)
        self.assertEqual(submitted.status, CustomizationDraft.STATUS_PENDING_INTERNAL_REVIEW)
        self.assertIsNone(submitted.quotation_doc_entry)

    @patch("api.services.customization_service.SAPServiceLayer")
    def test_approve_local_draft_posts_to_sap(self, mock_sap_cls):
        """When manager approves a local draft in review, it dispatches to SAP and captures DocEntry/DocNum."""
        mock_sap = MagicMock()
        mock_sap_cls.return_value = mock_sap
        mock_sap.create_sales_quotation.return_value = {
            "DocEntry": 8801,
            "DocNum": 990088,
            "CardCode": "C10001",
            "CardName": "Acme Corp",
            "DocumentLines": [
                {
                    "LineNum": 0,
                    "ItemCode": "1110119001",
                    "Quantity": 25.0,
                    "UnitPrice": 12.5,
                    "TaxCode": "O1",
                    "VatGroup": "O1",
                }
            ],
        }

        service = CustomizationService(sap_client=mock_sap)
        draft = service.save_or_update_draft(
            user=self.user,
            customer_code="C10001",
            customer_name="Acme Corp",
            doc_date="2026-10-01",
            doc_due_date="2026-10-15",
            lines_data=[
                {
                    "item_code": "1110119001",
                    "quantity": 25.0,
                    "unit_price": 12.5,
                    "tax_code": "O1",
                    "u_brand": "EGAST",
                }
            ],
            submit=True,
        )
        self.assertEqual(draft.status, CustomizationDraft.STATUS_PENDING_INTERNAL_REVIEW)

        # Manager approves in review (LOCAL FIRST: stays local)
        approved = service.approve_internal_review(draft, self.manager, notes="Approved for export")
        self.assertEqual(approved.status, CustomizationDraft.STATUS_INTERNAL_APPROVED)
        self.assertIsNone(approved.quotation_doc_entry)
        self.assertEqual(approved.internal_approval_notes, "Approved for export")
        mock_sap.create_sales_quotation.assert_not_called()

        # Customer approval triggers official SAP quotation creation exactly once
        customer_approved = service.record_customer_approval(
            draft=approved,
            user=self.user,
            approval_type="PURCHASE_ORDER",
            reference_number="PO-9900",
            contact_person="Acme Purchaser",
        )
        self.assertEqual(customer_approved.status, CustomizationDraft.STATUS_READY_FOR_ORDER)
        self.assertEqual(customer_approved.quotation_doc_entry, 8801)
        self.assertEqual(customer_approved.quotation_doc_num, "990088")

        # Verify SAP payload sent exactly once
        mock_sap.create_sales_quotation.assert_called_once()
        payload = mock_sap.create_sales_quotation.call_args[0][0]
        self.assertEqual(payload["CardCode"], "C10001")
        self.assertEqual(payload["DocumentLines"][0]["TaxCode"], "O1")
        self.assertEqual(payload["DocumentLines"][0]["VatGroup"], "O1")

    @patch("api.customization_views.CustomizationService")
    def test_direct_sap_quotation_creation_endpoint(self, mock_service_cls):
        """
        Sales Quotation direct SAP creation:
        User submits quotation form -> calls SAP directly -> returns DocEntry/DocNum -> status is READY_FOR_ORDER.
        No approval gates required.
        """
        self.client.force_authenticate(user=self.user)
        mock_service = MagicMock()
        mock_service_cls.return_value = mock_service

        mock_draft = CustomizationDraft.objects.create(
            customer_code="C10001",
            customer_name="Acme Industrial Supplies",
            quotation_doc_entry=11160,
            quotation_doc_num="132000018",
            status=CustomizationDraft.STATUS_READY_FOR_ORDER,
            created_by=self.user,
        )
        mock_service.create_quotation_and_draft.return_value = mock_draft

        payload = {
            "customer_code": "C10001",
            "customer_name": "Acme Industrial Supplies",
            "doc_date": "2026-10-01",
            "doc_due_date": "2026-10-15",
            "lines": [
                {
                    "item_code": "1110119001",
                    "item_description": "Orange Carozo Export",
                    "quantity": 100,
                    "unit_price": 25.5,
                }
            ],
        }

        resp = self.client.post("/api/customization-delivery/quotations/create/", payload, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(resp.data["success"])
        self.assertEqual(resp.data["quotation_doc_entry"], 11160)
        self.assertEqual(resp.data["quotation_doc_num"], "132000018")
        self.assertEqual(resp.data["draft"]["status"], CustomizationDraft.STATUS_READY_FOR_ORDER)
        mock_service.create_quotation_and_draft.assert_called_once()

    @patch("api.customization_views.CustomizationService")
    def test_direct_sap_quotation_creation_idempotency(self, mock_service_cls):
        """
        If draft already has quotation_doc_entry, re-submitting returns 200 without creating duplicate in SAP.
        """
        self.client.force_authenticate(user=self.user)
        mock_service = MagicMock()
        mock_service_cls.return_value = mock_service

        existing = CustomizationDraft.objects.create(
            customer_code="C10001",
            customer_name="Acme Industrial Supplies",
            quotation_doc_entry=11160,
            quotation_doc_num="132000018",
            status=CustomizationDraft.STATUS_READY_FOR_ORDER,
            created_by=self.user,
        )

        payload = {
            "draft_id": existing.id,
            "customer_code": "C10001",
            "lines": [{"item_code": "1110119001", "quantity": 100}],
        }

        resp = self.client.post("/api/customization-delivery/quotations/create/", payload, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["quotation_doc_entry"], 11160)
        self.assertEqual(resp.data["quotation_doc_num"], "132000018")
        mock_service.create_quotation_and_draft.assert_not_called()
        mock_service.post_quotation_to_sap.assert_not_called()

    @patch("api.services.customization_service.SAPServiceLayer")
    def test_direct_quotation_can_immediately_create_sales_order(self, mock_sap_cls):
        """
        A quotation created directly in SAP has status READY_FOR_ORDER and can be converted
        to a Sales Order (BaseType: 23) immediately without waiting for any manager or customer approvals.
        """
        mock_sap = MagicMock()
        mock_sap_cls.return_value = mock_sap
        mock_sap.create_sales_quotation.return_value = {
            "DocEntry": 11160,
            "DocNum": 132000018,
            "CardCode": "C10001",
            "DocumentLines": [
                {
                    "LineNum": 0,
                    "ItemCode": "1110119001",
                    "Quantity": 50.0,
                    "UnitPrice": 10.0,
                }
            ],
        }
        mock_sap._request.return_value = {
            "DocEntry": 25823,
            "DocNum": 311002628,
            "CardCode": "C10001",
        }

        service = CustomizationService(sap_client=mock_sap)
        draft = service.create_quotation_and_draft(
            user=self.user,
            customer_code="C10001",
            lines_data=[{"item_code": "1110119001", "quantity": 50.0, "unit_price": 10.0}],
        )

        self.assertEqual(draft.status, CustomizationDraft.STATUS_READY_FOR_ORDER)
        self.assertEqual(draft.quotation_doc_entry, 11160)

        # Directly post Sales Order (BaseType: 23) without any approval gates
        order_draft = service.post_sales_order_to_sap(draft=draft, user=self.user)
        self.assertEqual(order_draft.status, CustomizationDraft.STATUS_ORDER_POSTED)
        self.assertEqual(order_draft.sap_order_doc_entry, "25823")
        self.assertEqual(order_draft.sap_order_doc_num, "311002628")

        # Verify Order payload was called with BaseType: 23
        mock_sap._request.assert_called_once()
        call_args = mock_sap._request.call_args
        method, endpoint, order_payload = call_args[0]
        self.assertEqual(method, "POST")
        self.assertEqual(endpoint, "Orders")
        self.assertEqual(order_payload["DocumentLines"][0]["BaseType"], 23)
        self.assertEqual(order_payload["DocumentLines"][0]["BaseEntry"], 11160)




