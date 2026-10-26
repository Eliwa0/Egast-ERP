from unittest.mock import Mock, call, patch

from django.test import SimpleTestCase
from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework.test import APIRequestFactory

from .models import (
    BatchNumberReservation,
    PendingReceipt,
    PendingReceiptBatch,
    TransferWarehouseRule,
    UserProfile,
)
from .services.sap_service import SAPServiceLayer
from .views import _build_batch_udf_payload, create_receipt


def install_grpo_uom_fixture(case, allowed_codes):
    """Declare the item master UOMs used by this isolated workflow fixture."""
    def item_uom(item_code, *args, **kwargs):
        if item_code not in allowed_codes:
            raise AssertionError(f"Undeclared GRPO item fixture: {item_code}")
        return ('KG', 'KG')
    fixture = patch('api.services.purchase_grpo_service.PurchaseGRPODraftService.resolve_item_uom', side_effect=item_uom)
    fixture.start()
    case.addCleanup(fixture.stop)


class _MemoryCacheStore:
    """Dict-backed shared cache store used to make cache-aware tests hermetic.

    Replaces the configured Redis backend for the duration of a test, emulating a
    single shared store that every request/worker would read from.
    """

    def __init__(self):
        self._store = {}

    def get(self, key, default=None):
        return self._store.get(key, default)

    def set(self, key, value, timeout=None):
        self._store[key] = value

    def delete(self, key):
        self._store.pop(key, None)

    def delete_many(self, keys):
        for key in keys:
            self._store.pop(key, None)


class BatchPayloadMappingTests(SimpleTestCase):
    def test_udf_payload_keeps_uom_udf(self):
        payload = _build_batch_udf_payload(
            {
                "uom": "118",
                "brand": "Supplier batch",
            }
        )

        self.assertEqual(payload["U_UOM"], "118")
        self.assertEqual(payload["U_Brand"], "Supplier batch")

    @patch("api.views.sap.create_receipt_from_production")
    @patch("api.views.sap.get_item_stock")
    @patch("api.views.sap.get_production_order")
    def test_create_receipt_builds_document_lines_with_inventory_account(
        self, mock_get_production_order, mock_get_item_stock, mock_create_receipt
    ):
        factory = APIRequestFactory()
        mock_get_production_order.return_value = {
            "DocumentNumber": 200,
            "ItemNo": "FG-001",
            "ProductionOrderStatus": "boposReleased",
            "PlannedQuantity": 10,
            "CompletedQuantity": 0,
        }
        mock_get_item_stock.return_value = {
            "ItemWarehouseInfoCollection": [
                {"WarehouseCode": "20203", "InventoryAccount": "INV-ACC-001"}
            ]
        }
        mock_create_receipt.return_value = {"DocEntry": 1}
        request_payload = {
            "ProductionOrderEntry": 100,
            "ProductionOrderNumber": 200,
            "BaseEntry": 100,
            "BaseType": 202,
            "BaseLine": 0,
            "Quantity": 10,
            "Warehouse": "20203",
            "PostingDate": "2026-04-10",
            "DocumentDate": "2026-04-10",
            "Batches": [
                {
                    "batchNumber": "B1",
                    "quantity": 10,
                    "binAbsEntry": 13,
                    "details": "Blue drums",
                    "size": "42",
                    "brand": "Brand A",
                    "uom": "118",
                    "vendor": "Vendor A",
                    "part": "Part-01",
                    "category": "Blue",
                    "packing": "Sticker",
                    "extraSpecification": "Europe",
                    "number": "15",
                }
            ],
        }

        request = factory.post(
            "/api/receipts/create/",
            request_payload,
            format="json",
        )

        with patch("api.views.time.time", return_value=1710000000.123), patch("builtins.print"):
            response = create_receipt(request)

        self.assertEqual(response.status_code, 200)
        mock_get_production_order.assert_called_once_with(100)
        mock_get_item_stock.assert_not_called()
        mock_create_receipt.assert_called_once_with(
            {
                "ProductionOrder": 100,
                "DocumentDate": "2026-04-10",
                "PostingDate": "2026-04-10",
                "Warehouse": "20203",
                "Comments": "Receipt from Production Order 200 | LIVE-TEST-B1-1710000000123",
                "Remarks": "Receipt from Production Order 200",
                "JournalRemarks": "Receipt from Production",
                "DocumentLines": [
                    {
                        "BaseType": 202,
                        "BaseEntry": 100,
                        "TransactionType": "botrntComplete",
                        "WarehouseCode": "20203",
                        "Quantity": 10.0,
                        "BatchNumbers": [
                            {
                                "BatchNumber": "B1",
                                "Quantity": 10.0,
                                "Notes": "Blue drums",
                                "U_Size": "42",
                                "U_Brand": "Brand A",
                                "U_UOM": "118",
                                "U_vendor": "Vendor A",
                                "U_Part": "Part-01",
                                "U_Category": "Blue",
                                "U_Packing": "Sticker",
                                "U_Specification": "Europe",
                                "U_Number": "15",
                            }
                        ],
                        "DocumentLinesBinAllocations": [
                            {
                                "BinAbsEntry": 13,
                                "Quantity": 10.0,
                                "AllowNegativeQuantity": "tNO",
                                "SerialAndBatchNumbersBaseLine": 0,
                                "BaseLineNumber": 0,
                            }
                        ],
                    }
                ],
                "BinAllocations": [],
            }
        )
        self.assertEqual(response.data["success"], True)
        self.assertEqual(response.data["data"], {"DocEntry": 1, "AssignedBatchNumbers": ["B1"]})

    @patch("api.views.sap.create_receipt_from_production")
    @patch("api.views.sap.get_item_stock")
    @patch("api.views.sap.get_production_order")
    def test_create_receipt_returns_formatted_error_when_sap_fails(
        self, mock_get_production_order, mock_get_item_stock, mock_create_receipt
    ):
        factory = APIRequestFactory()
        mock_get_production_order.return_value = {
            "DocumentNumber": 200,
            "ItemCode": "FG-001",
            "ProductionOrderStatus": "boposReleased",
            "PlannedQuantity": 10,
            "CompletedQuantity": 0,
        }
        mock_get_item_stock.return_value = {
            "ItemWarehouseInfoCollection": [
                {"WarehouseCode": "WH-01", "InventoryAccount": "INV-ACC-002"}
            ]
        }
        mock_create_receipt.return_value = {
            "error": "1470000465 - You cannot allocate bin locations in document row 1"
        }
        request_payload = {
            "ProductionOrderEntry": 100,
            "ProductionOrderNumber": 200,
            "Quantity": 1,
            "Warehouse": "WH-01",
            "Batches": [{"batchNumber": "B1", "quantity": 1}],
            "DocumentDate": "2026-04-10",
        }

        request = factory.post(
            "/api/receipts/create/",
            request_payload,
            format="json",
        )

        with patch("api.views.time.time", return_value=1710000000.123), patch("builtins.print"):
            response = create_receipt(request)

        self.assertEqual(response.status_code, 400)
        mock_get_production_order.assert_called_once_with(100)
        mock_get_item_stock.assert_not_called()
        mock_create_receipt.assert_called_once_with(
            {
                "ProductionOrder": 100,
                "DocumentDate": "2026-04-10",
                "PostingDate": "2026-04-10",
                "Warehouse": "WH-01",
                "Comments": "Receipt from Production Order 200 | LIVE-TEST-B1-1710000000123",
                "Remarks": "Receipt from Production Order 200",
                "JournalRemarks": "Receipt from Production",
                "DocumentLines": [
                    {
                        "BaseType": 202,
                        "BaseEntry": 100,
                        "TransactionType": "botrntComplete",
                        "WarehouseCode": "WH-01",
                        "Quantity": 1.0,
                        "BatchNumbers": [
                            {
                                "BatchNumber": "B1",
                                "Quantity": 1.0,
                            }
                        ],
                    }
                ],
                "BinAllocations": [],
            }
        )
        self.assertEqual(
            response.data,
            {
                "success": False,
                "error": "1470000465 - You cannot allocate bin locations in document row 1",
            },
        )

    @patch("api.views.sap.create_receipt_from_production")
    @patch("api.views.sap.get_advanced_gl_account")
    @patch("api.views.sap.get_item_stock")
    @patch("api.views.sap.get_production_order")
    def test_create_receipt_uses_advanced_gl_account_when_inventory_account_missing(
        self,
        mock_get_production_order,
        mock_get_item_stock,
        mock_get_advanced_gl_account,
        mock_create_receipt,
    ):
        factory = APIRequestFactory()
        mock_get_production_order.return_value = {
            "ItemCode": "FG-002",
            "ProductionOrderStatus": "boposReleased",
            "PlannedQuantity": 5,
            "CompletedQuantity": 0,
        }
        mock_get_item_stock.return_value = {
            "ItemWarehouseInfoCollection": [
                {"WarehouseCode": "FG-HEADER-WH", "InventoryAccount": None}
            ]
        }
        mock_get_advanced_gl_account.return_value = {"AccountCode": "ADV-GL-01"}
        mock_create_receipt.return_value = {"DocEntry": 2}

        request = factory.post(
            "/api/receipts/create/",
            {
                "ProductionOrderEntry": 101,
                "BaseType": -1,
                "Quantity": 5,
                "Warehouse": "FG-HEADER-WH",
                "DocumentDate": "2026-04-11",
            },
            format="json",
        )

        with patch("api.views.time.time", return_value=1710000000.123), patch("builtins.print"):
            response = create_receipt(request)

        self.assertEqual(response.status_code, 200)
        mock_get_production_order.assert_called_once_with(101)
        mock_get_item_stock.assert_called_once_with("FG-002")
        mock_get_advanced_gl_account.assert_called_once_with(
            "FG-002",
            "FG-HEADER-WH",
            "2026-04-11",
            account_type="iatInventory",
        )
        mock_create_receipt.assert_called_once_with(
            {
                "ProductionOrder": 101,
                "DocumentDate": "2026-04-11",
                "PostingDate": "2026-04-11",
                "Warehouse": "FG-HEADER-WH",
                "Comments": "Receipt from Production Order 101 | LIVE-TEST-NO-BATCH-1710000000123",
                "Remarks": "Receipt from Production Order 101",
                "JournalRemarks": "Receipt from Production",
                "DocumentLines": [
                    {
                        "ItemCode": "FG-002",
                        "AccountCode": "ADV-GL-01",
                        "BaseType": -1,
                        "WarehouseCode": "FG-HEADER-WH",
                        "Quantity": 5.0,
                    }
                ],
                "BinAllocations": [],
            }
        )


class SAPReceiptTracingTests(SimpleTestCase):
    @patch("api.services.sap_service._append_live_receipt_trace")
    @patch("api.services.sap_service.SAPServiceLayer._http_request")
    def test_create_receipt_requires_created_document_identifiers(
        self, mock_post, mock_append_trace
    ):
        service = SAPServiceLayer()
        service.session_id = "SESSION-1"
        mock_post.return_value = Mock(
            status_code=201,
            text='{"Message":"Created without identifiers"}',
        )
        mock_post.return_value.json.return_value = {
            "Message": "Created without identifiers"
        }

        result = service.create_receipt_from_production(
            {
                "Comments": "Receipt from Production Order 200 | LIVE-TEST-B1-1710000000123",
                "DocumentLines": [
                    {
                        "BatchNumbers": [
                            {
                                "BatchNumber": "B1",
                                "Quantity": 1,
                            }
                        ]
                    }
                ],
            }
        )

        self.assertEqual(result["success"], False)
        self.assertIn("without DocEntry/DocNum", result["error"])
        self.assertEqual(mock_append_trace.call_count, 2)

    @patch("api.services.sap_service._append_live_receipt_trace")
    @patch("api.services.sap_service.SAPServiceLayer._http_request")
    def test_create_receipt_logs_created_document_identifiers(
        self, mock_post, mock_append_trace
    ):
        service = SAPServiceLayer()
        service.session_id = "SESSION-1"
        mock_post.return_value = Mock(
            status_code=201,
            text='{"DocEntry":321,"DocNum":654}',
        )
        mock_post.return_value.json.return_value = {
            "DocEntry": 321,
            "DocNum": 654,
        }

        result = service.create_receipt_from_production(
            {
                "Comments": "Receipt from Production Order 200 | LIVE-TEST-B1-1710000000123",
                "DocumentLines": [
                    {
                        "BatchNumbers": [
                            {
                                "BatchNumber": "B1",
                                "Quantity": 1,
                            }
                        ]
                    }
                ],
            }
        )

        self.assertEqual(result, {"DocEntry": 321, "DocNum": 654})
        self.assertEqual(mock_append_trace.call_args_list[0].args[0], "before_post")
        self.assertEqual(mock_append_trace.call_args_list[1].args[0], "after_post")
        after_payload = mock_append_trace.call_args_list[1].args[1]
        self.assertEqual(after_payload["comments_marker"], "Receipt from Production Order 200 | LIVE-TEST-B1-1710000000123")
        self.assertEqual(after_payload["batch_numbers"], ["B1"])
        self.assertEqual(after_payload["created_doc_entry"], 321)
        self.assertEqual(after_payload["created_doc_num"], 654)
        self.assertEqual(after_payload["created_document"], True)


class ReceiptReviewFlowRegressionTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user("admin", password="pass", is_superuser=True)
        self.production = User.objects.create_user("prod", password="pass")
        self.transfer = User.objects.create_user("transfer", password="pass")
        UserProfile.objects.update_or_create(
            user=self.production,
            defaults={"role": "production", "warehouse": "WH-01"},
        )
        UserProfile.objects.update_or_create(
            user=self.transfer,
            defaults={"role": "transfer", "warehouse": ""},
        )

    def _receipt_payload(self):
        return {
            "ProductionOrderEntry": 100,
            "ProductionOrderNumber": 200,
            "Quantity": 5,
            "Warehouse": "WH-01",
            "UomEntry": "118",
            "UomLabel": "KG",
            "UnitCount": 5,
            "Batches": [
                {
                    "autoGenerated": True,
                    "quantity": 5,
                    "unitCount": 5,
                    "binLocationCode": "WH-01-BIN",
                }
            ],
        }

    def _create_pending(self, user=None):
        user = user or self.production
        suffix = BatchNumberReservation.objects.count() + 1
        batch_number = f"200-{suffix}"
        receipt = PendingReceipt.objects.create(
            production_order_doc_entry=100,
            production_order_doc_num="200",
            item_code="FG-001",
            item_name="Finished Good",
            warehouse_code="WH-01",
            warehouse_name="Warehouse 01",
            uom_entry="118",
            uom_label="KG",
            unit_count=5,
            final_quantity=5,
            requested_quantity=5,
            status=PendingReceipt.PENDING_REVIEW,
            created_by=user,
            sap_order_number="200",
            raw_payload_json={"TransactionType": "botrntComplete"},
        )
        reservation = BatchNumberReservation.objects.create(
            production_order_doc_entry=100,
            production_order_doc_num="200",
            item_code="FG-001",
            suffix=suffix,
            batch_number=batch_number,
            status=BatchNumberReservation.PENDING_REVIEW,
            reserved_by=user,
            pending_receipt=receipt,
        )
        PendingReceiptBatch.objects.create(
            pending_receipt=receipt,
            batch_reservation=reservation,
            batch_number=batch_number,
            quantity=5,
            unit_count=5,
            uom_entry="118",
            uom_label="KG",
        )
        return receipt

    @patch("api.views._get_true_next_batch_suffix", return_value=1)
    @patch("api.views.sap.get_warehouses", return_value={"value": [{"WarehouseCode": "WH-01", "WarehouseName": "Warehouse 01"}]})
    @patch("api.views.sap.get_production_order")
    def test_receipt_creation_saves_pending_receipt_for_authenticated_user(
        self,
        mock_get_production_order,
        _mock_get_warehouses,
        _mock_next_suffix,
    ):
        mock_get_production_order.return_value = {
            "ItemNo": "FG-001",
            "ItemDescription": "Finished Good",
            "PlannedQuantity": 10,
            "CompletedQuantity": 0,
        }
        self.client.login(username="prod", password="pass")

        with patch("builtins.print"):
            response = self.client.post("/api/pending-receipts/", self._receipt_payload(), format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        receipt = PendingReceipt.objects.get()
        self.assertEqual(receipt.created_by, self.production)
        self.assertEqual(receipt.status, PendingReceipt.PENDING_REVIEW)
        self.assertEqual(receipt.batches.count(), 1)

    @patch("api.views._get_true_next_batch_suffix", return_value=1)
    @patch("api.views.sap.get_warehouses", return_value={"value": []})
    @patch("api.views.sap.get_production_order")
    def test_receipt_creation_rejects_negative_batch_quantity_without_saving(
        self,
        mock_get_production_order,
        _mock_get_warehouses,
        _mock_next_suffix,
    ):
        mock_get_production_order.return_value = {
            "ItemNo": "FG-001",
            "PlannedQuantity": 10,
            "CompletedQuantity": 0,
        }
        payload = self._receipt_payload()
        payload["Batches"][0]["quantity"] = -1
        self.client.login(username="prod", password="pass")

        with patch("builtins.print"):
            response = self.client.post("/api/pending-receipts/", payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(PendingReceipt.objects.count(), 0)

    @patch("api.views.sap.create_receipt_from_production", return_value={"DocEntry": 10, "DocNum": 900})
    @patch("api.views.sap.get_production_order")
    def test_admin_can_approve_pending_receipt(self, mock_get_production_order, mock_create_receipt):
        mock_get_production_order.return_value = {
            "ProductionOrderStatus": "boposReleased",
            "ItemNo": "FG-001",
        }
        receipt = self._create_pending()
        self.client.login(username="admin", password="pass")

        response = self.client.post(f"/api/admin/pending-receipts/{receipt.id}/approve-post/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        receipt.refresh_from_db()
        self.assertEqual(receipt.status, PendingReceipt.POSTED)
        self.assertEqual(receipt.sap_document_number, "900")
        self.assertTrue(mock_create_receipt.called)

    @patch("api.views.sap.create_receipt_from_production", return_value={"error": "SAP failed"})
    @patch("api.views.sap.get_production_order")
    def test_approve_marks_receipt_failed_when_sap_returns_error(self, mock_get_production_order, _mock_create_receipt):
        mock_get_production_order.return_value = {
            "ProductionOrderStatus": "boposReleased",
            "ItemNo": "FG-001",
        }
        receipt = self._create_pending()
        self.client.login(username="admin", password="pass")

        response = self.client.post(f"/api/admin/pending-receipts/{receipt.id}/approve-post/")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        receipt.refresh_from_db()
        self.assertEqual(receipt.status, PendingReceipt.FAILED)
        self.assertEqual(receipt.sap_error, "SAP failed")
        self.assertEqual(
            BatchNumberReservation.objects.get(pending_receipt=receipt).status,
            BatchNumberReservation.FAILED,
        )

    def test_admin_can_reject_pending_receipt(self):
        receipt = self._create_pending()
        self.client.login(username="admin", password="pass")

        response = self.client.post(
            f"/api/admin/pending-receipts/{receipt.id}/reject/",
            {"reason": "bad data"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        receipt.refresh_from_db()
        self.assertEqual(receipt.status, PendingReceipt.REJECTED)
        self.assertEqual(receipt.rejection_reason, "bad data")

    def test_permissions_separate_production_and_transfer_routes(self):
        self.client.login(username="transfer", password="pass")
        production_response = self.client.get("/api/open-production-orders/")
        self.assertEqual(production_response.status_code, status.HTTP_403_FORBIDDEN)

        self.client.logout()
        self.client.login(username="prod", password="pass")
        transfer_response = self.client.get("/api/transfer/warehouse-access/me/")
        self.assertEqual(transfer_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_production_user_review_list_only_returns_own_receipts(self):
        own = self._create_pending(user=self.production)
        other_user = User.objects.create_user("other", password="pass")
        UserProfile.objects.update_or_create(
            user=other_user,
            defaults={"role": "production", "warehouse": "WH-02"},
        )
        self._create_pending(user=other_user)
        self.client.login(username="prod", password="pass")

        response = self.client.get("/api/admin/pending-receipts/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        receipts = response.data["data"]["receipts"]
        self.assertEqual([item["id"] for item in receipts], [own.id])

    def test_admin_can_create_and_transfer_user_can_read_warehouse_rule(self):
        self.client.login(username="admin", password="pass")
        response = self.client.post(
            "/api/transfer/rules/warehouse-access/",
            {
                "user_id": self.transfer.id,
                "warehouse_code": "WH-TR",
                "warehouse_name": "Transfer Warehouse",
                "direction": "BOTH",
                "stage": "BOTH",
                "is_active": True,
            },
            format="json",
        )
        self.assertIn(response.status_code, {status.HTTP_200_OK, status.HTTP_201_CREATED})
        self.assertEqual(TransferWarehouseRule.objects.count(), 1)

        self.client.logout()
        self.client.login(username="transfer", password="pass")
        access_response = self.client.get("/api/transfer/warehouse-access/me/")

        self.assertEqual(access_response.status_code, status.HTTP_200_OK)
        access = access_response.data["data"]["access"]
        self.assertEqual(access["allowed_from"], ["WH-TR"])
        self.assertEqual(access["allowed_to"], ["WH-TR"])


class PurchaseGRPOVendorRefAndJournalRemarkTests(APITestCase):
    def setUp(self):
        install_grpo_uom_fixture(self, ['RAW-001', 'RAW-002'])
        from .models import PendingQualityInspection, PurchaseGRPODraft, UserProfile
        self.user = User.objects.create_user(username="grpo_test_user", password="password123")
        UserProfile.objects.update_or_create(
            user=self.user,
            defaults={"role": "quality_admin", "warehouse": "WH-01"},
        )
        self.client.force_login(self.user)

    def _create_valid_draft(self, **overrides):
        from .models import PendingQualityInspection, PurchaseGRPODraft
        inspection = PendingQualityInspection.objects.create(
            batch_number=overrides.get("batch_number", "B-TEST-VRN-001"),
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
            vendor_ref_no=overrides.get("vendor_ref_no", ""),
            journal_remark=overrides.get("journal_remark", ""),
            inspector_name=overrides.get("inspector_name", "MANUAL"),
        )
        draft = PurchaseGRPODraft.objects.create(
            inspection=inspection,
            vendor_card_code=inspection.vendor_card_code,
            vendor_name=inspection.vendor_name,
            item_code=inspection.item_code,
            item_name=inspection.item_name,
            quantity=inspection.quantity,
            uom_code="KG",
            uom_name="KG",
            warehouse_code=inspection.warehouse_code,
            bin_abs_entry=inspection.bin_abs_entry,
            bin_code=inspection.bin_code,
            batch_number=inspection.batch_number,
            batch_quantity=inspection.quantity,
            bin_quantity=inspection.quantity,
            manufacturing_date=inspection.manufacturing_date,
            admission_date=inspection.admission_date,
            expiry_date=inspection.expiry_date,
            posting_date=inspection.posting_date,
            document_date=inspection.document_date,
            due_date=inspection.due_date,
            unit_price=10.0,
            tax_code="TAX14",
            vendor_ref_no=overrides.get("vendor_ref_no", ""),
            journal_remark=overrides.get("journal_remark", ""),
        )
        return draft

    def test_payload_builder_omits_empty_vendor_ref_no_and_journal_remark(self):
        from .services.purchase_grpo_payload_builder import PurchaseGRPOPayloadBuilder
        draft = self._create_valid_draft(vendor_ref_no="", journal_remark="")
        payload = PurchaseGRPOPayloadBuilder().build(draft)
        self.assertNotIn("NumAtCard", payload)
        self.assertNotIn("JournalMemo", payload)

    def test_payload_builder_maps_vendor_ref_no_and_journal_remark(self):
        from .services.purchase_grpo_payload_builder import PurchaseGRPOPayloadBuilder
        draft = self._create_valid_draft(
            vendor_ref_no="VRN-INV-9876",
            journal_remark="GRPO Receipt Remark 2026",
        )
        payload = PurchaseGRPOPayloadBuilder().build(draft)
        self.assertEqual(payload["NumAtCard"], "VRN-INV-9876")
        self.assertEqual(payload["JournalMemo"], "GRPO Receipt Remark 2026")

    def test_draft_service_create_from_inspection_inherits_fields(self):
        from .models import PendingQualityInspection
        from .services.purchase_grpo_service import PurchaseGRPODraftService
        inspection = PendingQualityInspection.objects.create(
            batch_number="B-INSP-HERIT",
            item_code="RAW-002",
            item_name="Grapefruit",
            quantity=50.0,
            vendor_card_code="V-888",
            vendor_name="Citrus Co",
            warehouse_code="WH-01",
            bin_abs_entry="124",
            bin_code="BIN-A2",
            vendor_ref_no="V-INSP-REF-44",
            journal_remark="Inherited from quality inspection",
        )
        service = PurchaseGRPODraftService()
        draft = service.create_draft_from_inspection(inspection, user=self.user)
        self.assertEqual(draft.vendor_ref_no, "V-INSP-REF-44")
        self.assertEqual(draft.journal_remark, "Inherited from quality inspection")

    def test_draft_api_patch_persists_and_writes_through_to_inspection(self):
        draft = self._create_valid_draft()
        res = self.client.patch(
            f"/api/quality/grpo-drafts/{draft.id}/",
            {
                "vendor_ref_no": "PATCHED-VRN-111",
                "journal_remark": "Patched Journal Memo 222",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        draft.refresh_from_db()
        self.assertEqual(draft.vendor_ref_no, "PATCHED-VRN-111")
        self.assertEqual(draft.journal_remark, "Patched Journal Memo 222")

        draft.inspection.refresh_from_db()
        self.assertEqual(draft.inspection.vendor_ref_no, "PATCHED-VRN-111")
        self.assertEqual(draft.inspection.journal_remark, "Patched Journal Memo 222")

    @patch("api.services.sap_service.SAPServiceLayer._request", return_value={"value": []})
    def test_manual_receiving_creates_draft_and_inspection_with_fields(self, mock_sap):
        from .models import PendingQualityInspection, PurchaseGRPODraft
        payload = {
            "car_number": "TRK-MAN-99",
            "vendor_name": "Manual Vendor",
            "vendor_card_code": "V-MAN-1",
            "item_code": "RAW-MAN-1",
            "item_name": "Manual Item",
            "quantity": 25,
            "warehouse_code": "WH-01",
            "batch_number": "B-MAN-99",
            "vendor_ref_no": "MAN-VRN-55",
            "journal_remark": "Manual Entry Journal",
        }
        res = self.client.post("/api/grpo/manual-receiving/", payload, format="json")
        self.assertEqual(res.status_code, 201)
        data = res.json()["data"]
        inspection = PendingQualityInspection.objects.get(id=data["inspection_id"])
        draft = PurchaseGRPODraft.objects.get(id=data["draft_id"])

        self.assertEqual(inspection.vendor_ref_no, "MAN-VRN-55")
        self.assertEqual(inspection.journal_remark, "Manual Entry Journal")
        self.assertEqual(draft.vendor_ref_no, "MAN-VRN-55")
        self.assertEqual(draft.journal_remark, "Manual Entry Journal")


class PurchaseGRPODraftWorkflowTests(APITestCase):
    def setUp(self):
        from .models import PendingQualityInspection, PurchaseGRPODraft, UserProfile
        self.user = User.objects.create_user(username="grpo_workflow_user", password="password123")
        UserProfile.objects.update_or_create(
            user=self.user,
            defaults={"role": "quality_admin", "warehouse": "WH-01"},
        )
        self.client.force_login(self.user)

    def _create_valid_draft(self, **overrides):
        from .models import PendingQualityInspection, PurchaseGRPODraft
        inspection = PendingQualityInspection.objects.create(
            batch_number=overrides.get("batch_number", "B-WF-001"),
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

    @patch("api.services.sap_service.SAPServiceLayer._request", return_value={"value": []})
    def test_manual_receiving_creates_draft_and_inspection_with_unit_price_and_tax_code(self, mock_sap):
        from .models import PendingQualityInspection, PurchaseGRPODraft
        payload = {
            "car_number": "TRK-WF-01",
            "vendor_name": "WF Vendor",
            "vendor_card_code": "V-WF-1",
            "item_code": "RAW-WF-1",
            "item_name": "WF Item",
            "quantity": 30,
            "warehouse_code": "WH-01",
            "batch_number": "B-WF-99",
            "unit_price": "25.750000",
            "tax_code": "V1",
        }
        res = self.client.post("/api/grpo/manual-receiving/", payload, format="json")
        self.assertEqual(res.status_code, 201)
        data = res.json()["data"]
        inspection = PendingQualityInspection.objects.get(id=data["inspection_id"])
        draft = PurchaseGRPODraft.objects.get(id=data["draft_id"])

        from decimal import Decimal
        self.assertEqual(inspection.unit_price, Decimal("25.750000"))
        self.assertEqual(inspection.tax_code, "V1")
        self.assertEqual(draft.unit_price, Decimal("25.750000"))
        self.assertEqual(draft.tax_code, "V1")

    def test_draft_patch_persists_unit_price_and_tax_code(self):
        draft = self._create_valid_draft(unit_price=10.0, tax_code="V0")
        res = self.client.patch(
            f"/api/quality/grpo-drafts/{draft.id}/",
            {
                "unit_price": "45.500000",
                "tax_code": "TAX14",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        draft.refresh_from_db()
        from decimal import Decimal
        self.assertEqual(draft.unit_price, Decimal("45.500000"))
        self.assertEqual(draft.tax_code, "TAX14")
        self.assertEqual(draft.inspection.unit_price, Decimal("45.500000"))
        self.assertEqual(draft.inspection.tax_code, "TAX14")

    def test_review_validation_passes_when_both_populated(self):
        from .services.purchase_grpo_service import PurchaseGRPODraftService
        draft = self._create_valid_draft(unit_price=20.0, tax_code="V1")
        service = PurchaseGRPODraftService()
        # Should not raise PurchaseGRPODraftValidationError
        service.validate_draft_for_save(draft)


class PurchaseGRPOScaleDraftServiceTests(APITestCase):
    def setUp(self):
        install_grpo_uom_fixture(self, ['RAW-ORANGE-01', 'RAW-02'])
        from decimal import Decimal
        from scale.models import ScaleDraft, ScaleVehicle
        self.vehicle = ScaleVehicle.objects.create(vehicle_number="TRK-777", driver_name="Driver John")
        self.scale_draft = ScaleDraft.objects.create(
            vehicle=self.vehicle,
            item_code="RAW-ORANGE-01",
            item_name="Orange Navel",
            vendor_card_code="V-100",
            vendor_name="Delta Farms",
            weight_loaded=Decimal("15000.00"),
            weight_empty=Decimal("5000.00"),
            net_weight_loaded=Decimal("15000.00"),
            net_weight_empty=Decimal("5000.00"),
            product_weight=Decimal("10000.00"),
            status=ScaleDraft.STATUS_COMPLETED,
            is_closed=True,
            is_certified_locked=True,
        )

    def test_create_draft_from_scale_success(self):
        from .services.purchase_grpo_service import PurchaseGRPODraftService
        from .models import PurchaseGRPODraft
        service = PurchaseGRPODraftService()
        draft = service.create_draft_from_scale(self.scale_draft)

        self.assertIsNone(draft.inspection)
        self.assertEqual(draft.scale_draft, self.scale_draft)
        self.assertEqual(draft.quantity, 10000.0)
        self.assertEqual(draft.car_number, "TRK-777")
        self.assertEqual(draft.item_code, "RAW-ORANGE-01")
        self.assertEqual(draft.vendor_card_code, "V-100")
        self.assertEqual(draft.status, PurchaseGRPODraft.DRAFT)
        self.assertEqual(draft.batch_number, self.scale_draft.draft_number)

    def test_get_or_create_draft_from_scale_is_idempotent(self):
        from .services.purchase_grpo_service import PurchaseGRPODraftService
        service = PurchaseGRPODraftService()
        res1 = service.get_or_create_draft_from_scale(self.scale_draft)
        res2 = service.get_or_create_draft_from_scale(self.scale_draft)

        self.assertEqual(res1.id, res2.id)
        # Verify tuple unpacking also works
        d1, created1 = res1
        d2, created2 = res2
        self.assertEqual(d1.id, d2.id)
        self.assertTrue(created1)
        self.assertFalse(created2)

    def test_duplicate_active_draft_is_prevented(self):
        from .services.purchase_grpo_service import PurchaseGRPODraftService, ActivePurchaseGRPODraftExists
        service = PurchaseGRPODraftService()
        service.create_draft_from_scale(self.scale_draft)
        with self.assertRaises(ActivePurchaseGRPODraftExists):
            service.create_draft_from_scale(self.scale_draft)

    def test_incomplete_scale_draft_is_rejected(self):
        from decimal import Decimal
        from scale.models import ScaleDraft
        from .services.purchase_grpo_service import PurchaseGRPODraftService
        incomplete_scale = ScaleDraft.objects.create(
            item_code="RAW-02",
            weight_loaded=Decimal("5000.00"),
            status=ScaleDraft.STATUS_FIRST_WEIGHT,
            is_closed=False,
        )
        service = PurchaseGRPODraftService()
        with self.assertRaises(ValueError):
            service.create_draft_from_scale(incomplete_scale)


class PurchaseGRPOScaleDraftAPITests(APITestCase):
    def setUp(self):
        install_grpo_uom_fixture(self, {'RAW-APPLE-01', 'RAW-QUAL', 'RAW99'})
        from decimal import Decimal
        from django.contrib.auth.models import User
        from .models import UserProfile
        from scale.models import ScaleDraft, ScaleVehicle

        self.user = User.objects.create_user(username="scale_grpo_api_user", password="password123")
        UserProfile.objects.update_or_create(
            user=self.user,
            defaults={"role": "quality_admin", "warehouse": "WH-01"},
        )
        self.client.force_login(self.user)

        self.vehicle = ScaleVehicle.objects.create(vehicle_number="TRK-888", driver_name="Driver Dave")
        self.scale_draft = ScaleDraft.objects.create(
            vehicle=self.vehicle,
            item_code="RAW-APPLE-01",
            item_name="Red Apple",
            vendor_card_code="V-200",
            vendor_name="Orchard Co",
            weight_loaded=Decimal("12000.00"),
            weight_empty=Decimal("4000.00"),
            net_weight_loaded=Decimal("12000.00"),
            net_weight_empty=Decimal("4000.00"),
            product_weight=Decimal("8000.00"),
            status=ScaleDraft.STATUS_COMPLETED,
            is_closed=True,
            is_certified_locked=True,
        )

    def test_post_scale_draft_creates_grpo_draft(self):
        from .models import PurchaseGRPODraft
        url = f"/api/grpo/scale-drafts/{self.scale_draft.id}/grpo-draft/"
        res = self.client.post(url, {}, format="json")
        self.assertEqual(res.status_code, 201)
        data = res.json()["data"]

        draft_data = data.get("draft", data)
        self.assertEqual(draft_data["scale_draft_id"], self.scale_draft.id)
        self.assertIsNone(draft_data["inspection_id"])
        self.assertEqual(draft_data["quantity"], 8000.0)
        self.assertEqual(draft_data["car_number"], "TRK-888")

        draft = PurchaseGRPODraft.objects.get(id=draft_data["id"])
        self.assertIsNone(draft.inspection)
        self.assertEqual(draft.scale_draft, self.scale_draft)

    def test_post_scale_draft_is_idempotent(self):
        from .models import PurchaseGRPODraft
        url = f"/api/grpo/scale-drafts/{self.scale_draft.id}/grpo-draft/"
        res1 = self.client.post(url, {}, format="json")
        self.assertEqual(res1.status_code, 201)
        id1 = res1.json()["data"]["id"]

        res2 = self.client.post(url, {}, format="json")
        self.assertEqual(res2.status_code, 200)
        id2 = res2.json()["data"]["id"]

        self.assertEqual(id1, id2)
        self.assertEqual(PurchaseGRPODraft.objects.filter(scale_draft=self.scale_draft).count(), 1)

    def test_post_incomplete_scale_draft_returns_4xx(self):
        from decimal import Decimal
        from scale.models import ScaleDraft
        from .models import PurchaseGRPODraft
        incomplete = ScaleDraft.objects.create(
            item_code="RAW-99",
            status=ScaleDraft.STATUS_FIRST_WEIGHT,
            weight_loaded=Decimal("5000.00"),
            is_closed=False,
        )
        url = f"/api/grpo/scale-drafts/{incomplete.id}/grpo-draft/"
        res = self.client.post(url, {}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertFalse(PurchaseGRPODraft.objects.filter(scale_draft=incomplete).exists())

    def test_serializer_scale_draft_and_quality_draft(self):
        from .models import PendingQualityInspection, PurchaseGRPODraft
        from .quality_serializers import PurchaseGRPODraftSerializer
        from .services.purchase_grpo_service import PurchaseGRPODraftService

        # 1. Scale-backed draft
        service = PurchaseGRPODraftService()
        scale_grpo = service.create_draft_from_scale(self.scale_draft)
        s_data = PurchaseGRPODraftSerializer(scale_grpo).data
        self.assertEqual(s_data["scale_draft_id"], self.scale_draft.id)
        self.assertIsNone(s_data["inspection_id"])
        self.assertIsNone(s_data["inspection_context"])

        # 2. Quality-backed draft
        inspection = PendingQualityInspection.objects.create(
            batch_number="B-QUAL-01",
            item_code="RAW-QUAL",
            item_name="Quality Raw",
            quantity=500.0,
            status=PendingQualityInspection.PENDING_REVIEW,
        )
        qual_grpo = service.create_draft_from_inspection(inspection)
        q_data = PurchaseGRPODraftSerializer(qual_grpo).data
        self.assertEqual(q_data["inspection_id"], inspection.id)
        self.assertIsNone(q_data["scale_draft_id"])
        self.assertIsNotNone(q_data["inspection_context"])
        self.assertEqual(q_data["inspection_context"]["batch_number"], "B-QUAL-01")

    def test_pending_shipments_exposes_unconsumed_scale_draft_and_avoids_duplicate(self):
        from .services.purchase_grpo_service import PurchaseGRPODraftService
        # 1. Before creating GRPO draft, scale_draft is visible in pending shipments
        res = self.client.get("/api/grpo/pending-shipments/")
        self.assertEqual(res.status_code, 200)
        shipments = res.json()["data"]["shipments"]
        found = [s for s in shipments if s.get("scale_draft_id") == self.scale_draft.id]
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["car_number"], "TRK-888")
        self.assertEqual(found[0]["quantity"], 8000.0)

        # 2. After creating active GRPO draft, it should not duplicate
        service = PurchaseGRPODraftService()
        existing = service.create_draft_from_scale(self.scale_draft)

        res2 = self.client.get("/api/grpo/pending-shipments/")
        shipments2 = res2.json()["data"]["shipments"]
        found2 = [s for s in shipments2 if s.get("scale_draft_id") == self.scale_draft.id]
        self.assertEqual(len(found2), 1)
        self.assertTrue(found2[0]['has_active_draft'])
        self.assertEqual(found2[0]['grpo_draft_id'], existing.id)
        self.assertEqual(service.get_or_create_draft_from_scale(self.scale_draft).id, existing.id)
        self.assertEqual(type(existing).objects.filter(scale_draft=self.scale_draft).count(), 1)

    def test_grpo_vehicle_number_survives_save_reload_and_appears_in_review(self):
        from .models import PurchaseGRPODraft
        from .services.purchase_grpo_payload_builder import PurchaseGRPOPayloadBuilder
        from .services.purchase_grpo_service import PurchaseGRPODraftService

        draft = PurchaseGRPODraftService().create_draft_from_scale(self.scale_draft)
        draft.uom_code = "KG"
        draft.uom_name = "KG"
        draft.warehouse_code = "WH-01"
        draft.unit_price = 5
        draft.tax_code = "V1"
        draft.bin_abs_entry = "123"
        draft.bin_code = "BIN-A1"
        draft.save()
        draft.batches.update(bin_abs_entry="123", bin_code="BIN-A1")
        save_url = f"/api/quality/grpo-drafts/{draft.id}/"

        saved = self.client.patch(
            save_url,
            {
                "car_number": "TEST-1234",
                "location": "D1-01",
                "general": "D2-01",
            },
            format="json",
        )
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["data"]["draft"]["car_number"], "TEST-1234")
        self.assertEqual(saved.json()["data"]["draft"]["location"], "D1-01")
        self.assertEqual(saved.json()["data"]["draft"]["general"], "D2-01")

        draft.refresh_from_db()
        self.assertEqual(draft.car_number, "TEST-1234")
        self.assertEqual(draft.location, "D1-01")
        self.assertEqual(draft.general, "D2-01")

        navigation_save = self.client.patch(
            save_url,
            {"comments": "subsequent wizard-step save"},
            format="json",
        )
        self.assertEqual(navigation_save.status_code, 200)
        draft.refresh_from_db()
        self.assertEqual(draft.car_number, "TEST-1234")
        self.assertEqual(draft.location, "D1-01")
        self.assertEqual(draft.general, "D2-01")

        payload = PurchaseGRPOPayloadBuilder().build(draft)
        self.assertEqual(payload["DocumentLines"][0]["U_Container_no"], "TEST-1234")

        draft.status = PurchaseGRPODraft.POSTED
        draft.save(update_fields=["status", "updated_at"])
        review = self.client.get("/api/grpo/review/")
        self.assertEqual(review.status_code, 200)
        record = next(
            item for item in review.json()["data"]["records"]
            if item["id"] == draft.id
        )
        self.assertEqual(record["car_number"], "TEST-1234")
        self.assertEqual(record["container_number"], "TEST-1234")

    @patch("api.services.cache_service.cache", new_callable=_MemoryCacheStore)
    @patch("api.services.sap_service.SAPServiceLayer.get_profit_centers")
    def test_cost_center_endpoints_load_each_requested_dimension(self, mock_profit_centers, _mock_cache):
        def rows_for_dimension(dimension=None):
            return {
                "value": [{
                    "CenterCode": f"D{dimension}-01",
                    "CenterName": f"Dimension {dimension}",
                    "InWhichDimension": dimension,
                    "Active": "tYES",
                }]
            }

        mock_profit_centers.side_effect = rows_for_dimension

        location = self.client.get("/api/quality/cost-centers/?dimension=1")
        general = self.client.get("/api/quality/cost-centers/?dimension=2")

        self.assertEqual(location.status_code, 200)
        self.assertEqual(general.status_code, 200)
        self.assertEqual(location.json()["cost_centers"][0]["code"], "D1-01")
        self.assertEqual(general.json()["cost_centers"][0]["code"], "D2-01")
        self.assertEqual(
            mock_profit_centers.call_args_list,
            [call(dimension=1), call(dimension=2)],
        )

    @patch.object(SAPServiceLayer, "_request", return_value={"value": []})
    def test_profit_center_sap_query_is_filtered_and_bounded(self, mock_request):
        SAPServiceLayer().get_profit_centers(dimension=1)

        endpoint = mock_request.call_args.args[1]
        self.assertIn("$select=CenterCode,CenterName,InWhichDimension,Active", endpoint)
        self.assertIn("InWhichDimension eq 1", endpoint)
        self.assertIn("Active eq 'tYES'", endpoint)
        self.assertIn("$top=1000", endpoint)


class PurchaseGRPOScaleQuotationHandoffTests(APITestCase):
    """
    Phase 5: Scale -> GRPO Quotation Handoff Tests.
    Verifies that when a PurchaseGRPODraft is created from a ScaleDraft,
    the quotation relationship and quotation line index are cleanly preserved
    via the underlying ScaleDraft reference, without modifying or copying quotation data.
    """

    def setUp(self):
        install_grpo_uom_fixture(self, ['ITEM-1', 'ITEM-2', 'ITEM-MANUAL'])
        from decimal import Decimal
        from django.contrib.auth.models import User
        from .models import UserProfile, PurchaseQuotationDraft
        from scale.models import ScaleDraft, ScaleVehicle

        self.user = User.objects.create_user(username="grpo_p5_user", password="password123")
        UserProfile.objects.update_or_create(
            user=self.user,
            defaults={"role": "quality_admin", "warehouse": "WH-01"},
        )
        self.client.force_login(self.user)

        self.vehicle = ScaleVehicle.objects.create(vehicle_number="TRK-P5-100", driver_name="سائق الطور الخامس")

        self.quotation = PurchaseQuotationDraft.objects.create(
            status=PurchaseQuotationDraft.POSTED,
            sap_doc_entry="7001",
            sap_doc_num="17001",
            vendor_card_code="V700",
            vendor_name="مزارع النيل للتنمية",
            vehicle_number="TRK-P5-100",
            lines=[
                {"item_code": "ITEM-0", "item_name": "برتقال فالنسيا", "quantity": 12000, "unit_price": 14.0},
                {"item_code": "ITEM-1", "item_name": "يوسفي كليمونتين", "quantity": 8000, "unit_price": 16.5},
                {"item_code": "ITEM-2", "item_name": "ليمون بلدي", "quantity": 5000, "unit_price": 20.0},
            ],
        )

        self.scale_draft_with_quotation = ScaleDraft.objects.create(
            vehicle=self.vehicle,
            start_type="loaded",
            quotation=self.quotation,
            quotation_line_index=1,
            item_code="ITEM-1",
            item_name="يوسفي كليمونتين",
            vendor_card_code="V700",
            vendor_name="مزارع النيل للتنمية",
            weight_loaded=Decimal("18000.00"),
            weight_empty=Decimal("6000.00"),
            net_weight_loaded=Decimal("18000.00"),
            net_weight_empty=Decimal("6000.00"),
            product_weight=Decimal("12000.00"),
            status=ScaleDraft.STATUS_COMPLETED,
            is_closed=True,
            is_certified_locked=True,
        )

        self.scale_draft_without_quotation = ScaleDraft.objects.create(
            vehicle=self.vehicle,
            start_type="loaded",
            quotation=None,
            quotation_line_index=0,
            item_code="ITEM-MANUAL",
            item_name="بطاطس تصدير",
            vendor_card_code="V-MANUAL",
            vendor_name="مورد يدوي",
            weight_loaded=Decimal("15000.00"),
            weight_empty=Decimal("5000.00"),
            net_weight_loaded=Decimal("15000.00"),
            net_weight_empty=Decimal("5000.00"),
            product_weight=Decimal("10000.00"),
            status=ScaleDraft.STATUS_COMPLETED,
            is_closed=True,
            is_certified_locked=True,
        )

    def test_completed_scale_draft_without_quotation_creates_grpo_normally(self):
        from .services.purchase_grpo_service import PurchaseGRPODraftService
        from .quality_serializers import PurchaseGRPODraftSerializer

        service = PurchaseGRPODraftService()
        draft = service.create_draft_from_scale(self.scale_draft_without_quotation, user=self.user)

        self.assertEqual(draft.scale_draft, self.scale_draft_without_quotation)
        self.assertIsNone(draft.quotation)
        self.assertIsNone(draft.quotation_line_index)

        s_data = PurchaseGRPODraftSerializer(draft).data
        self.assertIsNone(s_data["quotation"])
        self.assertIsNone(s_data["quotation_number"])
        self.assertIsNone(s_data["quotation_sap_doc_entry"])
        self.assertIsNone(s_data["quotation_line_index"])

    def test_completed_scale_draft_with_quotation_preserves_relationship_in_grpo(self):
        from .services.purchase_grpo_service import PurchaseGRPODraftService

        service = PurchaseGRPODraftService()
        draft = service.create_draft_from_scale(self.scale_draft_with_quotation, user=self.user)

        # 1. Direct relationship checks
        self.assertEqual(draft.scale_draft, self.scale_draft_with_quotation)
        self.assertEqual(draft.quotation, self.quotation)
        self.assertEqual(draft.quotation_line_index, 1)

        # 2. Quotation instance points to exact model in database
        self.assertEqual(draft.quotation.id, self.quotation.id)
        self.assertEqual(draft.quotation.sap_doc_entry, "7001")
        self.assertEqual(draft.quotation.sap_doc_num, "17001")

    def test_multi_line_quotation_line_index_preserved_accurately(self):
        from .services.purchase_grpo_service import PurchaseGRPODraftService
        from scale.models import ScaleDraft
        from decimal import Decimal

        scale_draft_line2 = ScaleDraft.objects.create(
            vehicle=self.vehicle,
            start_type="loaded",
            quotation=self.quotation,
            quotation_line_index=2,
            item_code="ITEM-2",
            item_name="ليمون بلدي",
            vendor_card_code="V700",
            vendor_name="مزارع النيل للتنمية",
            weight_loaded=Decimal("10000.00"),
            weight_empty=Decimal("4000.00"),
            net_weight_loaded=Decimal("10000.00"),
            net_weight_empty=Decimal("4000.00"),
            product_weight=Decimal("6000.00"),
            status=ScaleDraft.STATUS_COMPLETED,
            is_closed=True,
            is_certified_locked=True,
        )

        service = PurchaseGRPODraftService()
        draft = service.create_draft_from_scale(scale_draft_line2, user=self.user)

        self.assertEqual(draft.quotation, self.quotation)
        self.assertEqual(draft.quotation_line_index, 2)

    def test_quotation_remains_completely_unmodified_after_grpo_creation(self):
        from .services.purchase_grpo_service import PurchaseGRPODraftService

        # Capture snapshot before GRPO draft creation
        before_status = self.quotation.status
        before_sap_entry = self.quotation.sap_doc_entry
        before_sap_num = self.quotation.sap_doc_num
        before_lines = list(self.quotation.lines)
        before_vendor = self.quotation.vendor_card_code

        service = PurchaseGRPODraftService()
        service.create_draft_from_scale(self.scale_draft_with_quotation, user=self.user)

        self.quotation.refresh_from_db()
        self.assertEqual(self.quotation.status, before_status)
        self.assertEqual(self.quotation.sap_doc_entry, before_sap_entry)
        self.assertEqual(self.quotation.sap_doc_num, before_sap_num)
        self.assertEqual(self.quotation.lines, before_lines)
        self.assertEqual(self.quotation.vendor_card_code, before_vendor)

    def test_grpo_api_exposes_read_only_quotation_metadata(self):
        # API creation via endpoint
        url = f"/api/grpo/scale-drafts/{self.scale_draft_with_quotation.id}/grpo-draft/"
        res = self.client.post(url, {}, format="json")
        self.assertEqual(res.status_code, 201)
        data = res.json()["data"]

        draft_data = data.get("draft", data)
        self.assertEqual(draft_data["scale_draft_id"], self.scale_draft_with_quotation.id)
        self.assertEqual(draft_data["quotation"], self.quotation.id)
        self.assertEqual(draft_data["quotation_number"], "17001")
        self.assertEqual(draft_data["quotation_sap_doc_entry"], "7001")
        self.assertEqual(draft_data["quotation_line_index"], 1)

        # Pending shipments API also exposes quotation metadata
        res_shipments = self.client.get("/api/grpo/pending-shipments/")
        self.assertEqual(res_shipments.status_code, 200)

    def test_idempotent_grpo_creation_preserves_quotation_link(self):
        from .services.purchase_grpo_service import PurchaseGRPODraftService

        service = PurchaseGRPODraftService()
        res1 = service.get_or_create_draft_from_scale(self.scale_draft_with_quotation, user=self.user)
        res2 = service.get_or_create_draft_from_scale(self.scale_draft_with_quotation, user=self.user)

        d1 = res1.draft if hasattr(res1, "draft") else res1[0]
        d2 = res2.draft if hasattr(res2, "draft") else res2[0]

        self.assertEqual(d1.id, d2.id)
        self.assertEqual(d1.quotation, self.quotation)
        self.assertEqual(d2.quotation, self.quotation)
        self.assertEqual(d1.quotation_line_index, 1)
        self.assertEqual(d2.quotation_line_index, 1)


class PurchaseGRPOSAPBaseDocumentLinkageTests(APITestCase):
    """
    Phase 6 verification: Matched Purchase Quotation is linked as SAP Base Document
    (BaseType=540000006, BaseEntry=quotation.sap_doc_entry, BaseLine=quotation_line_index)
    on the SAP PurchaseDeliveryNotes DocumentLines.
    """

    def setUp(self):
        install_grpo_uom_fixture(self, ['RAW-FRUIT-0', 'RAW-FRUIT-2', 'RAW-FRUIT-UNMATCHED'])
        from decimal import Decimal
        from .models import PurchaseQuotationDraft, UserProfile
        from scale.models import ScaleDraft, ScaleVehicle

        self.user = User.objects.create_user(username="phase6_grpo_user", password="password123")
        UserProfile.objects.update_or_create(
            user=self.user,
            defaults={"role": "quality_admin", "warehouse": "WH-01"},
        )
        self.client.force_login(self.user)

        self.vehicle = ScaleVehicle.objects.create(vehicle_number="TRK-P6-888", driver_name="Driver P6")

        self.quotation = PurchaseQuotationDraft.objects.create(
            status=PurchaseQuotationDraft.POSTED,
            sap_doc_entry="125",
            sap_doc_num="10125",
            vendor_card_code="V-BASE-100",
            vendor_name="Base Vendor Co",
            vehicle_number="TRK-P6-888",
            posting_date="2026-09-24",
            valid_until="2026-10-24",
            lines=[
                {"item_code": "RAW-FRUIT-0", "item_name": "Fruit Zero", "quantity": 1000, "unit_price": 10.0},
                {"item_code": "RAW-FRUIT-1", "item_name": "Fruit One", "quantity": 2000, "unit_price": 12.0},
                {"item_code": "RAW-FRUIT-2", "item_name": "Fruit Two", "quantity": 3000, "unit_price": 15.0},
            ],
        )

        self.scale_draft_matched_line0 = ScaleDraft.objects.create(
            vehicle=self.vehicle,
            start_type="loaded",
            quotation=self.quotation,
            quotation_line_index=0,
            item_code="RAW-FRUIT-0",
            item_name="Fruit Zero",
            vendor_card_code="V-BASE-100",
            vendor_name="Base Vendor Co",
            weight_loaded=Decimal("15000.00"),
            weight_empty=Decimal("5000.00"),
            net_weight_loaded=Decimal("15000.00"),
            net_weight_empty=Decimal("5000.00"),
            product_weight=Decimal("10000.00"),
            status=ScaleDraft.STATUS_COMPLETED,
            is_closed=True,
            is_certified_locked=True,
        )

        self.scale_draft_matched_line2 = ScaleDraft.objects.create(
            vehicle=self.vehicle,
            start_type="loaded",
            quotation=self.quotation,
            quotation_line_index=2,
            item_code="RAW-FRUIT-2",
            item_name="Fruit Two",
            vendor_card_code="V-BASE-100",
            vendor_name="Base Vendor Co",
            weight_loaded=Decimal("15000.00"),
            weight_empty=Decimal("5000.00"),
            net_weight_loaded=Decimal("15000.00"),
            net_weight_empty=Decimal("5000.00"),
            product_weight=Decimal("10000.00"),
            status=ScaleDraft.STATUS_COMPLETED,
            is_closed=True,
            is_certified_locked=True,
        )

        self.scale_draft_unmatched = ScaleDraft.objects.create(
            vehicle=self.vehicle,
            start_type="loaded",
            quotation=None,
            quotation_line_index=0,
            item_code="RAW-FRUIT-UNMATCHED",
            item_name="Fruit Unmatched",
            vendor_card_code="V-BASE-999",
            vendor_name="Unmatched Vendor",
            weight_loaded=Decimal("12000.00"),
            weight_empty=Decimal("4000.00"),
            net_weight_loaded=Decimal("12000.00"),
            net_weight_empty=Decimal("4000.00"),
            product_weight=Decimal("8000.00"),
            status=ScaleDraft.STATUS_COMPLETED,
            is_closed=True,
            is_certified_locked=True,
        )

    def _setup_approved_grpo_draft(self, scale_draft):
        from .services.purchase_grpo_service import PurchaseGRPODraftService
        from .models import PurchaseGRPODraftBatch

        service = PurchaseGRPODraftService()
        draft = service.create_draft_from_scale(scale_draft, user=self.user)
        draft.unit_price = 10.0
        draft.tax_code = "TAX14"
        draft.bin_abs_entry = "99"
        draft.bin_code = "BIN-P6"
        draft.warehouse_code = "WH-01"
        draft.uom_code = "KG"
        draft.uom_name = "KG"
        draft.posting_date = "2026-09-24"
        draft.document_date = "2026-09-24"
        draft.due_date = "2026-10-01"
        draft.manufacturing_date = "2026-09-20"
        draft.admission_date = "2026-09-24"
        draft.expiry_date = "2027-09-20"
        draft.batch_quantity = draft.quantity
        draft.bin_quantity = draft.quantity
        draft.save()

        # Update batch with bin info
        b = draft.batches.first()
        if b:
            b.bin_abs_entry = "99"
            b.bin_code = "BIN-P6"
            b.manufacturing_date = "2026-09-20"
            b.admission_date = "2026-09-24"
            b.expiry_date = "2027-09-20"
            b.quantity = draft.quantity
            b.save()
        else:
            PurchaseGRPODraftBatch.objects.create(
                draft=draft,
                batch_number=draft.batch_number or "B-P6",
                quantity=draft.quantity,
                bin_abs_entry="99",
                bin_code="BIN-P6",
                manufacturing_date="2026-09-20",
                admission_date="2026-09-24",
                expiry_date="2027-09-20",
            )
        draft.refresh_from_db()
        return draft

    def test_test1_matched_quotation_payload_has_basetype_baseentry_baseline(self):
        from .services.purchase_grpo_payload_builder import PurchaseGRPOPayloadBuilder

        draft = self._setup_approved_grpo_draft(self.scale_draft_matched_line0)
        payload = PurchaseGRPOPayloadBuilder().build(draft)

        lines = payload.get("DocumentLines", [])
        self.assertEqual(len(lines), 1)
        line = lines[0]

        self.assertIn("BaseType", line)
        self.assertIn("BaseEntry", line)
        self.assertIn("BaseLine", line)

        self.assertEqual(line["BaseType"], 540000006)
        self.assertEqual(line["BaseEntry"], 125)
        self.assertEqual(line["BaseLine"], 0)

        # Check types are integers
        self.assertIsInstance(line["BaseType"], int)
        self.assertIsInstance(line["BaseEntry"], int)
        self.assertIsInstance(line["BaseLine"], int)

    def test_test2_different_quotation_line_sets_baseline_correctly(self):
        from .services.purchase_grpo_payload_builder import PurchaseGRPOPayloadBuilder

        draft = self._setup_approved_grpo_draft(self.scale_draft_matched_line2)
        payload = PurchaseGRPOPayloadBuilder().build(draft)

        line = payload["DocumentLines"][0]
        self.assertEqual(line["BaseType"], 540000006)
        self.assertEqual(line["BaseEntry"], 125)
        self.assertEqual(line["BaseLine"], 2)
        self.assertNotEqual(line["BaseLine"], 0)

    def test_test3_unmatched_scale_draft_omits_base_fields(self):
        from .services.purchase_grpo_payload_builder import PurchaseGRPOPayloadBuilder

        draft = self._setup_approved_grpo_draft(self.scale_draft_unmatched)
        payload = PurchaseGRPOPayloadBuilder().build(draft)

        line = payload["DocumentLines"][0]
        self.assertNotIn("BaseType", line)
        self.assertNotIn("BaseEntry", line)
        self.assertNotIn("BaseLine", line)

    def test_test4_database_id_must_not_be_used_for_base_entry(self):
        from .services.purchase_grpo_payload_builder import PurchaseGRPOPayloadBuilder

        draft = self._setup_approved_grpo_draft(self.scale_draft_matched_line0)
        # Ensure quotation database ID is distinctly different from sap_doc_entry
        self.assertNotEqual(self.quotation.id, 125)

        payload = PurchaseGRPOPayloadBuilder().build(draft)
        line = payload["DocumentLines"][0]

        self.assertEqual(line["BaseEntry"], 125)
        self.assertNotEqual(line["BaseEntry"], self.quotation.id)

    def test_test5_sap_doc_entry_missing_raises_validation_error(self):
        from .services.purchase_grpo_payload_builder import (
            PurchaseGRPOPayloadBuilder,
            PurchaseGRPOPayloadValidationError,
        )

        self.quotation.sap_doc_entry = ""
        self.quotation.save()

        draft = self._setup_approved_grpo_draft(self.scale_draft_matched_line0)

        with self.assertRaises(PurchaseGRPOPayloadValidationError) as ctx:
            PurchaseGRPOPayloadBuilder().build(draft)

        self.assertIn("quotation_sap_doc_entry", ctx.exception.errors)

    def test_test6_invalid_quotation_line_raises_validation_error(self):
        from .services.purchase_grpo_payload_builder import (
            PurchaseGRPOPayloadBuilder,
            PurchaseGRPOPayloadValidationError,
        )

        # Quotation has 3 lines (indices 0, 1, 2); set line index to 99
        self.scale_draft_matched_line0.quotation_line_index = 99
        self.scale_draft_matched_line0.save()

        draft = self._setup_approved_grpo_draft(self.scale_draft_matched_line0)

        with self.assertRaises(PurchaseGRPOPayloadValidationError) as ctx:
            PurchaseGRPOPayloadBuilder().build(draft)

        self.assertIn("quotation_line_index", ctx.exception.errors)

    def test_test7_quotation_is_not_modified_by_payload_generation_or_posting(self):
        from .services.purchase_grpo_payload_builder import PurchaseGRPOPayloadBuilder
        from .services.purchase_grpo_posting_service import PurchaseGRPOPostingService
        from .services.purchase_grpo_service import PurchaseGRPODraftService
        from unittest.mock import MagicMock

        draft = self._setup_approved_grpo_draft(self.scale_draft_matched_line0)
        PurchaseGRPODraftService().approve_for_posting(draft, user=self.user)

        # Snapshot quotation
        before_status = self.quotation.status
        before_doc_entry = self.quotation.sap_doc_entry
        before_doc_num = self.quotation.sap_doc_num
        before_lines = list(self.quotation.lines)

        payload = PurchaseGRPOPayloadBuilder().build(draft)

        mock_sap = MagicMock()
        mock_sap.create_purchase_delivery_note.return_value = {
            "DocEntry": 905,
            "DocNum": 1905,
        }
        service = PurchaseGRPOPostingService(sap_client=mock_sap)
        posted_draft = service.post(draft, payload, user=self.user)

        self.assertEqual(posted_draft.status, "POSTED")
        self.quotation.refresh_from_db()
        self.assertEqual(self.quotation.status, before_status)
        self.assertEqual(self.quotation.sap_doc_entry, before_doc_entry)
        self.assertEqual(self.quotation.sap_doc_num, before_doc_num)
        self.assertEqual(self.quotation.lines, before_lines)

    def test_test8_existing_grpo_behavior_maintained_for_unmatched(self):
        from .services.purchase_grpo_payload_builder import PurchaseGRPOPayloadBuilder

        draft = self._setup_approved_grpo_draft(self.scale_draft_unmatched)
        payload = PurchaseGRPOPayloadBuilder().build(draft)

        self.assertIn("CardCode", payload)
        self.assertIn("DocDate", payload)
        self.assertIn("DocumentLines", payload)
        self.assertNotIn("BaseType", payload["DocumentLines"][0])
        self.assertEqual(payload["CardCode"], "V-BASE-999")

    def test_test9_payload_structure_document_lines_level(self):
        from .services.purchase_grpo_payload_builder import PurchaseGRPOPayloadBuilder

        draft = self._setup_approved_grpo_draft(self.scale_draft_matched_line0)
        payload = PurchaseGRPOPayloadBuilder().build(draft)

        # Ensure BaseType/BaseEntry/BaseLine are NOT at header level
        self.assertNotIn("BaseType", payload)
        self.assertNotIn("BaseEntry", payload)
        self.assertNotIn("BaseLine", payload)

        # Ensure BaseType/BaseEntry/BaseLine are at DocumentLines[0] level
        line = payload["DocumentLines"][0]
        self.assertEqual(line.get("BaseType"), 540000006)
        self.assertEqual(line.get("BaseEntry"), 125)
        self.assertEqual(line.get("BaseLine"), 0)

    def test_test10_sap_posting_service_sends_exact_base_document_payload(self):
        from .services.purchase_grpo_payload_builder import PurchaseGRPOPayloadBuilder
        from .services.purchase_grpo_posting_service import PurchaseGRPOPostingService
        from .services.purchase_grpo_service import PurchaseGRPODraftService
        from unittest.mock import MagicMock

        draft = self._setup_approved_grpo_draft(self.scale_draft_matched_line0)
        PurchaseGRPODraftService().approve_for_posting(draft, user=self.user)

        payload = PurchaseGRPOPayloadBuilder().build(draft)

        mock_sap = MagicMock()
        mock_sap.create_purchase_delivery_note.return_value = {
            "DocEntry": 7777,
            "DocNum": 9999,
        }

        posting_service = PurchaseGRPOPostingService(sap_client=mock_sap)
        posting_service.post(draft, payload, user=self.user)

        mock_sap.create_purchase_delivery_note.assert_called_once()
        sent_payload = mock_sap.create_purchase_delivery_note.call_args[0][0]

        sent_line = sent_payload["DocumentLines"][0]
        self.assertEqual(sent_line["BaseType"], 540000006)
        self.assertEqual(sent_line["BaseEntry"], 125)
        self.assertEqual(sent_line["BaseLine"], 0)




