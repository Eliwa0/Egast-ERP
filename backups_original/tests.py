from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework.test import APIRequestFactory

from .models import (
    BatchNumberReservation,
    PendingReceipt,
    PendingReceiptBatch,
    PendingTransferRequest,
    TransferWarehouseRule,
    UserProfile,
)
from .services.sap_service import SAPServiceLayer
from .services.transfer_service import TransferBatchNotFound
from .views import _build_batch_udf_payload, create_receipt


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
    @patch("api.services.sap_service.requests.post")
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
    @patch("api.services.sap_service.requests.post")
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
        self.production_admin = User.objects.create_user("prod-admin", password="pass")
        self.transfer_admin = User.objects.create_user("transfer-admin", password="pass")
        self.production = User.objects.create_user("prod", password="pass")
        self.transfer = User.objects.create_user("transfer", password="pass")
        UserProfile.objects.update_or_create(
            user=self.production_admin,
            defaults={"role": "production_admin", "warehouse": ""},
        )
        UserProfile.objects.update_or_create(
            user=self.transfer_admin,
            defaults={"role": "transfer_admin", "warehouse": ""},
        )
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

    def test_production_user_cannot_access_receipt_review(self):
        self._create_pending(user=self.production)
        other_user = User.objects.create_user("other", password="pass")
        UserProfile.objects.update_or_create(
            user=other_user,
            defaults={"role": "production", "warehouse": "WH-02"},
        )
        self._create_pending(user=other_user)
        self.client.login(username="prod", password="pass")

        response = self.client.get("/api/admin/pending-receipts/")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_production_admin_can_access_receipt_review(self):
        own = self._create_pending(user=self.production)
        other_user = User.objects.create_user("other", password="pass")
        UserProfile.objects.update_or_create(
            user=other_user,
            defaults={"role": "production", "warehouse": "WH-02"},
        )
        other = self._create_pending(user=other_user)
        self.client.login(username="prod-admin", password="pass")

        response = self.client.get("/api/admin/pending-receipts/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        receipts = response.data["data"]["receipts"]
        self.assertEqual({item["id"] for item in receipts}, {own.id, other.id})

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

    def _create_pending_transfer(self, user=None, batch_number="TR-BATCH-1"):
        user = user or self.transfer
        payload = {
            "transfer_stage": TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE,
            "from_warehouse": "WH-FROM",
            "to_warehouse": "WH-TO",
            "lines": [
                {
                    "item_code": "ITEM-1",
                    "item_name": "Item One",
                    "batch_number": batch_number,
                    "quantity": 2,
                }
            ],
        }
        return PendingTransferRequest.objects.create(
            transfer_stage=payload["transfer_stage"],
            from_warehouse=payload["from_warehouse"],
            to_warehouse=payload["to_warehouse"],
            item_code="ITEM-1",
            item_name="Item One",
            batch_number=batch_number,
            quantity=2,
            lines=payload["lines"],
            raw_payload_json=payload,
            status=PendingTransferRequest.PENDING,
            created_by=user,
        )

    def _grant_transfer_access(self, user, warehouse_code, direction=TransferWarehouseRule.DIRECTION_BOTH):
        return TransferWarehouseRule.objects.create(
            user=user,
            warehouse_code=warehouse_code,
            warehouse_name=warehouse_code,
            direction=direction,
            stage=TransferWarehouseRule.STAGE_BOTH,
            is_active=True,
        )

    def _create_local_receipt_batch(self, batch_number="LOCAL-BATCH-1", status_value=PendingReceipt.PENDING_REVIEW):
        receipt = self._create_pending(user=self.production)
        receipt.warehouse_code = "WH-FROM"
        receipt.status = status_value
        receipt.save()
        batch = receipt.batches.first()
        batch.batch_number = batch_number
        batch.quantity = 3
        batch.uom_label = "KG"
        batch.save()
        return receipt, batch

    def _create_linked_pending_transfer(self, receipt, batch, status_value=PendingTransferRequest.PENDING):
        line = {
            "item_code": receipt.item_code,
            "item_name": receipt.item_name,
            "batch_number": batch.batch_number,
            "quantity": float(batch.quantity or 0),
            "uom": batch.uom_label,
            "uom_entry": batch.uom_entry,
            "brand": batch.brand,
            "size": batch.size,
            "from_warehouse": receipt.warehouse_code,
            "from_bin": batch.bin_location,
            "source_type": "local_receipt",
            "availability_status": "LOCAL_PENDING_RECEIPT",
            "source_status_label": "Local pending receipt",
            "source_message": "Pending receipt - not posted to SAP yet",
            "can_post_to_sap": False,
            "receipt_status": receipt.status,
            "pending_receipt_id": receipt.id,
            "pending_receipt_batch_id": batch.id,
        }
        payload = {
            "transfer_stage": TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE,
            "from_warehouse": receipt.warehouse_code,
            "from_bin": batch.bin_location,
            "to_warehouse": "WH-TO",
            "lines": [dict(line)],
        }
        return PendingTransferRequest.objects.create(
            transfer_stage=payload["transfer_stage"],
            from_warehouse=payload["from_warehouse"],
            from_bin=payload["from_bin"],
            to_warehouse=payload["to_warehouse"],
            item_code=receipt.item_code,
            item_name=receipt.item_name,
            batch_number=batch.batch_number,
            quantity=float(batch.quantity or 0),
            lines=[line],
            raw_payload_json=payload,
            status=status_value,
            created_by=self.transfer,
        )

    def test_editing_pending_receipt_batch_syncs_linked_pending_transfer(self):
        receipt = self._create_pending(user=self.production)
        batch = receipt.batches.first()
        batch.bin_location = "BIN-A"
        batch.brand = "Old Brand"
        batch.size = "Old Size"
        batch.save()
        pending = self._create_linked_pending_transfer(receipt, batch)
        self.client.login(username="admin", password="pass")

        response = self.client.patch(
            f"/api/admin/pending-receipts/{receipt.id}/batches/{batch.id}/",
            {
                "quantity": 7.5,
                "unit_count": 3,
                "uom_entry": "220",
                "uom_label": "TON",
                "brand": "New Brand",
                "size": "Large",
                "bin_location": "BIN-B",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        pending.refresh_from_db()
        self.assertEqual(pending.status, PendingTransferRequest.PENDING)
        self.assertEqual(pending.quantity, 7.5)
        self.assertEqual(pending.batch_number, batch.batch_number)
        self.assertEqual(pending.from_warehouse, receipt.warehouse_code)
        self.assertEqual(pending.from_bin, "BIN-B")
        line = pending.lines[0]
        self.assertEqual(line["quantity"], 7.5)
        self.assertEqual(line["uom"], "TON")
        self.assertEqual(line["uom_entry"], "220")
        self.assertEqual(line["brand"], "New Brand")
        self.assertEqual(line["size"], "Large")
        self.assertEqual(line["from_bin"], "BIN-B")
        self.assertEqual(line["pending_receipt_batch_id"], batch.id)
        raw_line = pending.raw_payload_json["lines"][0]
        self.assertEqual(raw_line["quantity"], 7.5)
        self.assertEqual(raw_line["brand"], "New Brand")

    def test_editing_pending_receipt_batch_does_not_sync_posted_or_failed_transfer(self):
        receipt = self._create_pending(user=self.production)
        batch = receipt.batches.first()
        batch.brand = "Old Brand"
        batch.size = "Old Size"
        batch.save()
        posted = self._create_linked_pending_transfer(
            receipt,
            batch,
            status_value=PendingTransferRequest.POSTED,
        )
        failed = self._create_linked_pending_transfer(
            receipt,
            batch,
            status_value=PendingTransferRequest.FAILED,
        )
        self.client.login(username="admin", password="pass")

        response = self.client.patch(
            f"/api/admin/pending-receipts/{receipt.id}/batches/{batch.id}/",
            {
                "quantity": 8,
                "brand": "New Brand",
                "size": "Large",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        posted.refresh_from_db()
        failed.refresh_from_db()
        self.assertEqual(posted.quantity, 5)
        self.assertEqual(posted.lines[0]["brand"], "Old Brand")
        self.assertEqual(failed.quantity, 5)
        self.assertEqual(failed.lines[0]["brand"], "Old Brand")

    @patch("api.views._get_true_next_batch_suffix", return_value=1)
    @patch("api.views.sap.get_production_order")
    def test_change_receipt_order_syncs_linked_pending_transfer_snapshot(
        self,
        mock_get_production_order,
        _mock_next_suffix,
    ):
        mock_get_production_order.return_value = {
            "DocNum": "300",
            "ItemNo": "FG-002",
            "ItemDescription": "Finished Good 2",
        }
        receipt = self._create_pending(user=self.production)
        batch = receipt.batches.first()
        pending = self._create_linked_pending_transfer(receipt, batch)
        self.client.login(username="admin", password="pass")

        with patch("builtins.print"):
            response = self.client.post(
                f"/api/admin/pending-receipts/{receipt.id}/change-order/",
                {"new_doc_entry": 300},
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        batch.refresh_from_db()
        pending.refresh_from_db()
        self.assertEqual(batch.batch_number, "300-1")
        self.assertEqual(pending.item_code, "FG-002")
        self.assertEqual(pending.item_name, "Finished Good 2")
        self.assertEqual(pending.batch_number, "300-1")
        self.assertEqual(pending.lines[0]["item_code"], "FG-002")
        self.assertEqual(pending.lines[0]["batch_number"], "300-1")

    @patch("api.views.transfer_service.get_batch_details")
    def test_transfer_batch_lookup_returns_local_pending_receipt_when_not_in_sap(self, mock_get_batch_details):
        _receipt, batch = self._create_local_receipt_batch(batch_number="LOCAL-PENDING-1")
        self._grant_transfer_access(self.transfer, "WH-FROM")
        mock_get_batch_details.side_effect = TransferBatchNotFound("not in SAP")
        self.client.login(username="transfer", password="pass")

        response = self.client.get(
            f"/api/transfer/batches/{batch.batch_number}/",
            {
                "from_warehouse": "WH-FROM",
                "transfer_stage": TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE,
            },
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data["batch"]
        self.assertEqual(payload["availability_status"], "LOCAL_PENDING_RECEIPT")
        self.assertEqual(payload["source_message"], "Pending receipt - not posted to SAP yet")
        self.assertEqual(payload["can_post_to_sap"], False)

    @patch("api.views.transfer_service._resolve_intermediate_warehouses", return_value=["WH-TO"])
    @patch("api.views.transfer_service.get_batch_details")
    def test_transfer_user_can_create_pending_request_for_local_receipt_batch(
        self,
        mock_get_batch_details,
        _mock_intermediate,
    ):
        _receipt, batch = self._create_local_receipt_batch(batch_number="LOCAL-PENDING-2")
        self._grant_transfer_access(self.transfer, "WH-FROM")
        self._grant_transfer_access(self.transfer, "WH-TO")
        mock_get_batch_details.side_effect = TransferBatchNotFound("not in SAP")
        self.client.login(username="transfer", password="pass")

        response = self.client.post(
            "/api/transfer/move/",
            {
                "transfer_stage": TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE,
                "from_warehouse": "WH-FROM",
                "to_warehouse": "WH-TO",
                "lines": [
                    {
                        "item_code": "FG-001",
                        "item_name": "Finished Good",
                        "batch_number": batch.batch_number,
                        "quantity": 3,
                        "uom": "KG",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["pending"], True)
        pending = PendingTransferRequest.objects.get(id=response.data["pending_transfer_id"])
        self.assertEqual(pending.status, PendingTransferRequest.PENDING)
        self.assertEqual(pending.lines[0]["availability_status"], "LOCAL_PENDING_RECEIPT")
        self.assertEqual(pending.lines[0]["can_post_to_sap"], False)

    @patch("api.views.transfer_service._resolve_intermediate_warehouses", return_value=["WH-TO"])
    @patch("api.views.transfer_service.move_inventory")
    @patch("api.views.transfer_service.get_batch_details")
    def test_admin_post_blocks_local_receipt_batch_until_it_exists_in_sap(
        self,
        mock_get_batch_details,
        mock_move_inventory,
        _mock_intermediate,
    ):
        _receipt, batch = self._create_local_receipt_batch(batch_number="LOCAL-PENDING-3")
        pending = self._create_pending_transfer(user=self.transfer, batch_number=batch.batch_number)
        pending.from_warehouse = "WH-FROM"
        pending.to_warehouse = "WH-TO"
        pending.raw_payload_json["from_warehouse"] = "WH-FROM"
        pending.raw_payload_json["to_warehouse"] = "WH-TO"
        pending.raw_payload_json["lines"][0]["batch_number"] = batch.batch_number
        pending.raw_payload_json["lines"][0]["quantity"] = 3
        pending.save()
        mock_get_batch_details.side_effect = TransferBatchNotFound("not in SAP")
        self.client.login(username="admin", password="pass")

        response = self.client.post(f"/api/admin/pending-transfers/{pending.id}/post/")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data["error"],
            "Cannot post transfer because source batch has not been posted to SAP yet.",
        )
        pending.refresh_from_db()
        self.assertEqual(pending.status, PendingTransferRequest.FAILED)
        mock_move_inventory.assert_not_called()

    @patch("api.views.transfer_service._resolve_intermediate_warehouses", return_value=["WH-TO"])
    @patch("api.views.transfer_service.move_inventory")
    @patch("api.views.transfer_service.get_batch_details")
    def test_admin_post_succeeds_after_sap_batch_is_available(
        self,
        mock_get_batch_details,
        mock_move_inventory,
        _mock_intermediate,
    ):
        _receipt, batch = self._create_local_receipt_batch(
            batch_number="LOCAL-POSTED-1",
            status_value=PendingReceipt.POSTED,
        )
        pending = self._create_pending_transfer(user=self.transfer, batch_number=batch.batch_number)
        pending.from_warehouse = "WH-FROM"
        pending.to_warehouse = "WH-TO"
        pending.raw_payload_json["from_warehouse"] = "WH-FROM"
        pending.raw_payload_json["to_warehouse"] = "WH-TO"
        pending.raw_payload_json["lines"][0]["batch_number"] = batch.batch_number
        pending.raw_payload_json["lines"][0]["quantity"] = 3
        pending.save()
        mock_get_batch_details.return_value = {
            "item_code": "ITEM-1",
            "item_name": "Item One",
            "batch_number": batch.batch_number,
            "available_quantity": 3,
            "uom": "KG",
        }
        mock_move_inventory.return_value = {"sap_doc_entry": 11, "sap_doc_num": 22}
        self.client.login(username="admin", password="pass")

        response = self.client.post(f"/api/admin/pending-transfers/{pending.id}/post/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        pending.refresh_from_db()
        self.assertEqual(pending.status, PendingTransferRequest.POSTED)
        self.assertEqual(pending.sap_doc_entry, "11")
        self.assertEqual(pending.sap_doc_num, "22")

    def _create_pending_transfer_chain(self, batch_number="CHAIN-BULK-1"):
        prerequisite = self._create_pending_transfer(
            user=self.transfer,
            batch_number=batch_number,
        )
        prerequisite.transfer_stage = TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE
        prerequisite.from_warehouse = "WH-STATION"
        prerequisite.to_warehouse = "WH-INTERMEDIATE"
        prerequisite.lines[0]["batch_number"] = batch_number
        prerequisite.raw_payload_json.update({
            "transfer_stage": prerequisite.transfer_stage,
            "from_warehouse": prerequisite.from_warehouse,
            "to_warehouse": prerequisite.to_warehouse,
            "lines": prerequisite.lines,
        })
        prerequisite.save()

        dependent_payload = {
            "transfer_stage": TransferWarehouseRule.STAGE_2_TO_FRIDGE,
            "from_warehouse": "WH-INTERMEDIATE",
            "to_warehouse": "WH-FRIDGE",
            "lines": [{
                "item_code": "ITEM-1",
                "item_name": "Item One",
                "batch_number": batch_number,
                "quantity": 2,
                "source_transfer_id": prerequisite.id,
                "source_transfer_status": PendingTransferRequest.PENDING,
            }],
        }
        dependent = PendingTransferRequest.objects.create(
            transfer_stage=dependent_payload["transfer_stage"],
            from_warehouse=dependent_payload["from_warehouse"],
            to_warehouse=dependent_payload["to_warehouse"],
            item_code="ITEM-1",
            item_name="Item One",
            batch_number=batch_number,
            quantity=2,
            lines=dependent_payload["lines"],
            raw_payload_json=dependent_payload,
            status=PendingTransferRequest.PENDING,
            created_by=self.transfer,
        )
        return prerequisite, dependent

    @patch("api.views._assert_transfer_payload_sap_available")
    @patch("api.views.transfer_service.move_inventory")
    def test_bulk_post_orders_prerequisite_before_dependent(
        self,
        mock_move_inventory,
        _mock_assert_available,
    ):
        prerequisite, dependent = self._create_pending_transfer_chain()
        mock_move_inventory.side_effect = [
            {"sap_doc_entry": 11, "sap_doc_num": 21},
            {"sap_doc_entry": 12, "sap_doc_num": 22},
        ]
        self.client.login(username="admin", password="pass")

        response = self.client.post(
            "/api/admin/pending-transfers/post-selected/",
            {"transfer_ids": [dependent.id, prerequisite.id]},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data["data"]["results"]
        self.assertEqual(
            [(result["id"], result["status"]) for result in results],
            [(prerequisite.id, "POSTED"), (dependent.id, "POSTED")],
        )
        posted_stages = [
            call.args[0]["transfer_stage"]
            for call in mock_move_inventory.call_args_list
        ]
        self.assertEqual(
            posted_stages,
            [
                TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE,
                TransferWarehouseRule.STAGE_2_TO_FRIDGE,
            ],
        )
        prerequisite.refresh_from_db()
        dependent.refresh_from_db()
        self.assertEqual(prerequisite.status, PendingTransferRequest.POSTED)
        self.assertEqual(dependent.status, PendingTransferRequest.POSTED)

    @patch("api.views._assert_transfer_payload_sap_available")
    @patch("api.views.transfer_service.move_inventory")
    def test_bulk_post_skips_dependent_when_prerequisite_fails(
        self,
        mock_move_inventory,
        _mock_assert_available,
    ):
        prerequisite, dependent = self._create_pending_transfer_chain(
            batch_number="CHAIN-BULK-FAIL",
        )
        mock_move_inventory.side_effect = RuntimeError("SAP stage 1 failed")
        self.client.login(username="admin", password="pass")

        response = self.client.post(
            "/api/admin/pending-transfers/post-selected/",
            {"transfer_ids": [dependent.id, prerequisite.id]},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data["data"]["results"]
        self.assertEqual(
            [(result["id"], result["status"]) for result in results],
            [(prerequisite.id, "FAILED"), (dependent.id, "SKIPPED")],
        )
        self.assertEqual(results[1]["blocked_by"], [prerequisite.id])
        self.assertEqual(mock_move_inventory.call_count, 1)
        prerequisite.refresh_from_db()
        dependent.refresh_from_db()
        self.assertEqual(prerequisite.status, PendingTransferRequest.FAILED)
        self.assertEqual(dependent.status, PendingTransferRequest.PENDING)
        self.assertEqual(dependent.error_message, "")

    @patch("api.views.transfer_service.get_batch_details")
    def test_transfer_review_recomputes_local_source_when_batch_reaches_sap(self, mock_get_batch_details):
        pending = self._create_pending_transfer(user=self.transfer, batch_number="LOCAL-NOW-SAP")
        pending.lines[0]["availability_status"] = "LOCAL_PENDING_RECEIPT"
        pending.lines[0]["source_status_label"] = "Local pending receipt"
        pending.lines[0]["source_message"] = "Pending receipt - not posted to SAP yet"
        pending.lines[0]["can_post_to_sap"] = False
        pending.save()
        mock_get_batch_details.return_value = {
            "item_code": "ITEM-1",
            "item_name": "Item One",
            "batch_number": "LOCAL-NOW-SAP",
            "available_quantity": 2,
            "uom": "KG",
        }
        self.client.login(username="admin", password="pass")

        response = self.client.get("/api/admin/pending-transfers/?status=ALL")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        line = response.data["data"]["transfers"][0]["lines"][0]
        self.assertEqual(line["availability_status"], "SAP_AVAILABLE")
        self.assertEqual(line["source_status_label"], "SAP available")
        self.assertEqual(line["source_message"], "SAP available")
        self.assertEqual(line["can_post_to_sap"], True)

    @patch("api.views.transfer_service.get_batch_details")
    def test_transfer_review_can_skip_source_refresh_for_fast_list(self, mock_get_batch_details):
        pending = self._create_pending_transfer(user=self.transfer, batch_number="LOCAL-SNAPSHOT")
        pending.lines[0]["availability_status"] = "LOCAL_PENDING_RECEIPT"
        pending.lines[0]["source_status_label"] = "Local pending receipt"
        pending.lines[0]["source_message"] = "Pending receipt - not posted to SAP yet"
        pending.lines[0]["can_post_to_sap"] = False
        pending.save()
        self.client.login(username="admin", password="pass")

        response = self.client.get("/api/admin/pending-transfers/?status=ALL&refresh_sources=false")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        mock_get_batch_details.assert_not_called()
        line = response.data["data"]["transfers"][0]["lines"][0]
        self.assertEqual(line["availability_status"], "LOCAL_PENDING_RECEIPT")
        self.assertEqual(line["source_status_label"], "Local pending receipt")
        self.assertEqual(line["source_message"], "Pending receipt - not posted to SAP yet")
        self.assertEqual(line["can_post_to_sap"], False)

    def test_posted_transfer_review_never_shows_stale_pending_source_message(self):
        pending = self._create_pending_transfer(user=self.transfer, batch_number="POSTED-OLD-LINE")
        pending.status = PendingTransferRequest.POSTED
        pending.sap_doc_entry = "11"
        pending.sap_doc_num = "22"
        pending.lines[0]["availability_status"] = "LOCAL_PENDING_RECEIPT"
        pending.lines[0]["source_status_label"] = "Local pending receipt"
        pending.lines[0]["source_message"] = "Pending receipt - not posted to SAP yet"
        pending.lines[0]["can_post_to_sap"] = False
        pending.save()
        self.client.login(username="admin", password="pass")

        response = self.client.get("/api/admin/pending-transfers/?status=ALL")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        line = response.data["data"]["transfers"][0]["lines"][0]
        self.assertEqual(line["availability_status"], "SAP_POSTED")
        self.assertEqual(line["source_status_label"], "Posted / SAP posted")
        self.assertEqual(line["source_message"], "")
        self.assertEqual(line["can_post_to_sap"], True)

    def test_transfer_user_cannot_access_transfer_review(self):
        self._create_pending_transfer(user=self.transfer, batch_number="OWN-BATCH")
        other_user = User.objects.create_user("transfer-other", password="pass")
        UserProfile.objects.update_or_create(
            user=other_user,
            defaults={"role": "transfer", "warehouse": ""},
        )
        self._create_pending_transfer(user=other_user, batch_number="OTHER-BATCH")
        self.client.login(username="transfer", password="pass")

        response = self.client.get("/api/admin/pending-transfers/")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_transfer_admin_review_list_returns_all_transfer_requests(self):
        own = self._create_pending_transfer(user=self.transfer, batch_number="OWN-BATCH")
        other_user = User.objects.create_user("transfer-other", password="pass")
        UserProfile.objects.update_or_create(
            user=other_user,
            defaults={"role": "transfer", "warehouse": ""},
        )
        other = self._create_pending_transfer(user=other_user, batch_number="OTHER-BATCH")
        self.client.login(username="transfer-admin", password="pass")

        response = self.client.get("/api/admin/pending-transfers/?status=ALL")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        transfers = response.data["data"]["transfers"]
        self.assertEqual({item["id"] for item in transfers}, {own.id, other.id})

    def test_admin_review_list_returns_all_transfer_requests(self):
        own = self._create_pending_transfer(user=self.transfer, batch_number="OWN-BATCH")
        other_user = User.objects.create_user("transfer-other", password="pass")
        UserProfile.objects.update_or_create(
            user=other_user,
            defaults={"role": "transfer", "warehouse": ""},
        )
        other = self._create_pending_transfer(user=other_user, batch_number="OTHER-BATCH")
        self.client.login(username="admin", password="pass")

        response = self.client.get("/api/admin/pending-transfers/?status=ALL")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        transfers = response.data["data"]["transfers"]
        self.assertEqual({item["id"] for item in transfers}, {own.id, other.id})

    @patch("api.views.transfer_service._resolve_intermediate_warehouses", return_value=["WH-TO"])
    @patch("api.views.transfer_service.move_inventory")
    @patch("api.views.transfer_service.get_batch_details")
    def test_admin_creation_stays_pending_until_review_post(
        self,
        mock_get_batch_details,
        mock_move_inventory,
        _mock_intermediate,
    ):
        mock_get_batch_details.return_value = {
            "item_code": "ITEM-1",
            "item_name": "Item One",
            "batch_number": "ADMIN-CREATE-1",
            "available_quantity": 2,
            "uom": "KG",
        }
        self.client.login(username="admin", password="pass")

        response = self.client.post(
            "/api/transfer/move/",
            {
                "transfer_stage": TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE,
                "from_warehouse": "WH-FROM",
                "to_warehouse": "WH-TO",
                "lines": [
                    {
                        "item_code": "ITEM-1",
                        "item_name": "Item One",
                        "batch_number": "ADMIN-CREATE-1",
                        "quantity": 2,
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["pending"], True)
        pending = PendingTransferRequest.objects.get(
            id=response.data["pending_transfer_id"],
        )
        self.assertEqual(pending.status, PendingTransferRequest.PENDING)
        self.assertEqual(pending.created_by, self.admin)
        mock_move_inventory.assert_not_called()

        review_response = self.client.get(
            "/api/admin/pending-transfers/?status=PENDING&refresh_sources=false",
        )
        self.assertEqual(review_response.status_code, status.HTTP_200_OK)
        review_ids = {
            transfer["id"]
            for transfer in review_response.data["data"]["transfers"]
        }
        self.assertIn(pending.id, review_ids)

    @patch("api.views.transfer_service._resolve_intermediate_warehouses", return_value=["WH-NEW"])
    @patch("api.views.transfer_service.get_batch_details")
    def test_transfer_review_save_persists_valid_edit(
        self,
        mock_get_batch_details,
        _mock_intermediate,
    ):
        pending = self._create_pending_transfer(user=self.transfer)
        mock_get_batch_details.return_value = {
            "item_code": "ITEM-1",
            "item_name": "Item One",
            "batch_number": pending.batch_number,
            "available_quantity": 5,
            "uom": "KG",
        }
        self.client.login(username="admin", password="pass")

        response = self.client.patch(
            f"/api/admin/pending-transfers/{pending.id}/",
            {
                "from_warehouse": "WH-FROM",
                "to_warehouse": "WH-NEW",
                "quantity": 1.5,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        pending.refresh_from_db()
        self.assertEqual(pending.to_warehouse, "WH-NEW")
        self.assertEqual(pending.quantity, 1.5)
        self.assertEqual(pending.lines[0]["quantity"], 1.5)
        self.assertEqual(pending.raw_payload_json["to_warehouse"], "WH-NEW")
        self.assertEqual(pending.raw_payload_json["lines"][0]["quantity"], 1.5)

    @patch("api.views.transfer_service._resolve_intermediate_warehouses", return_value=["WH-TO"])
    @patch("api.views.transfer_service.get_batch_details")
    def test_transfer_review_save_rejects_invalid_quantity_without_persisting(
        self,
        mock_get_batch_details,
        _mock_intermediate,
    ):
        pending = self._create_pending_transfer(user=self.transfer)
        original_payload = pending.raw_payload_json
        mock_get_batch_details.return_value = {
            "item_code": "ITEM-1",
            "item_name": "Item One",
            "batch_number": pending.batch_number,
            "available_quantity": 2,
            "uom": "KG",
        }
        self.client.login(username="admin", password="pass")

        response = self.client.patch(
            f"/api/admin/pending-transfers/{pending.id}/",
            {"quantity": 3},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        pending.refresh_from_db()
        self.assertEqual(pending.quantity, 2)
        self.assertEqual(pending.lines[0]["quantity"], 2)
        self.assertEqual(pending.raw_payload_json, original_payload)

    def test_transfer_review_can_delete_editable_transfer(self):
        pending = self._create_pending_transfer(user=self.transfer)
        self.client.login(username="admin", password="pass")

        response = self.client.delete(
            f"/api/admin/pending-transfers/{pending.id}/",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data["data"]["deleted_transfer_id"],
            pending.id,
        )
        self.assertFalse(
            PendingTransferRequest.objects.filter(id=pending.id).exists(),
        )

    def test_transfer_review_cannot_delete_posted_transfer(self):
        pending = self._create_pending_transfer(user=self.transfer)
        pending.status = PendingTransferRequest.POSTED
        pending.save(update_fields=["status"])
        self.client.login(username="admin", password="pass")

        response = self.client.delete(
            f"/api/admin/pending-transfers/{pending.id}/",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(
            PendingTransferRequest.objects.filter(id=pending.id).exists(),
        )

    def test_transfer_user_can_read_but_not_edit_or_post_own_transfer(self):
        pending = self._create_pending_transfer(user=self.transfer)
        self.client.login(username="transfer", password="pass")

        detail_response = self.client.get(f"/api/admin/pending-transfers/{pending.id}/")
        patch_response = self.client.patch(
            f"/api/admin/pending-transfers/{pending.id}/",
            {"to_warehouse": "WH-NEW"},
            format="json",
        )
        post_response = self.client.post(f"/api/admin/pending-transfers/{pending.id}/post/")

        self.assertEqual(detail_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(patch_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(post_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_module_admin_user_management_is_scoped_by_module(self):
        self.client.login(username="prod-admin", password="pass")
        list_response = self.client.get("/api/admin/users/")
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            {item["username"] for item in list_response.data["data"]["users"]},
            {"prod"},
        )

        create_transfer = self.client.post(
            "/api/create-user/",
            {"username": "bad-transfer", "password": "pass", "role": "transfer_user"},
            format="json",
        )
        create_production = self.client.post(
            "/api/create-user/",
            {
                "username": "good-production",
                "password": "pass",
                "role": "production_user",
                "warehouse": "WH-01",
            },
            format="json",
        )
        edit_admin = self.client.patch(
            f"/api/admin/users/{self.admin.id}/",
            {"username": "changed-admin"},
            format="json",
        )

        self.assertEqual(create_transfer.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(create_production.status_code, status.HTTP_200_OK)
        self.assertEqual(edit_admin.status_code, status.HTTP_403_FORBIDDEN)

        self.client.logout()
        self.client.login(username="transfer-admin", password="pass")
        create_production_for_transfer_admin = self.client.post(
            "/api/create-user/",
            {
                "username": "bad-production",
                "password": "pass",
                "role": "production_user",
                "warehouse": "WH-01",
            },
            format="json",
        )
        create_transfer_for_transfer_admin = self.client.post(
            "/api/create-user/",
            {"username": "good-transfer", "password": "pass", "role": "transfer_user"},
            format="json",
        )

        self.assertEqual(create_production_for_transfer_admin.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(create_transfer_for_transfer_admin.status_code, status.HTTP_200_OK)


class TransferBatchValidationTests(APITestCase):
    """Test strict batch validation for transfer operations."""

    def setUp(self):
        self.admin = User.objects.create_user("admin", password="pass", is_superuser=True)
        self.transfer_user = User.objects.create_user("transfer", password="pass")
        UserProfile.objects.update_or_create(
            user=self.transfer_user,
            defaults={"role": "transfer", "warehouse": ""},
        )
        # Grant warehouse access for transfer operations
        TransferWarehouseRule.objects.create(
            user=self.transfer_user,
            warehouse_code="WH-01",
            warehouse_name="Warehouse 01",
            direction=TransferWarehouseRule.DIRECTION_FROM,
            stage=TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE,
            is_active=True,
        )
        TransferWarehouseRule.objects.create(
            user=self.transfer_user,
            warehouse_code="WH-02",
            warehouse_name="Warehouse 02",
            direction=TransferWarehouseRule.DIRECTION_TO,
            stage=TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE,
            is_active=True,
        )

    @patch("api.views.transfer_service.get_batch_details")
    @patch("api.views.sap.get_intermediate_warehouses")
    def test_duplicate_batch_in_same_transfer_is_rejected(self, mock_get_intermediate, mock_get_batch_details):
        """Batch number cannot be added twice to the same transfer."""
        mock_get_intermediate.return_value = []
        mock_get_batch_details.return_value = {
            "item_code": "ITEM-1",
            "item_name": "Item One",
            "batch_number": "BATCH-001",
            "batch_abs_entry": 1,
            "available_quantity": 100,
            "uom": "CTN",
            "expiry_date": None,
            "from_warehouse": "WH-01",
            "from_bin": "BIN-A",
            "mock": False,
        }
        self.client.login(username="transfer", password="pass")

        response = self.client.post(
            "/api/transfer/move/",
            {
                "transfer_stage": TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE,
                "from_warehouse": "WH-01",
                "to_warehouse": "WH-02",
                "lines": [
                    {
                        "item_code": "ITEM-1",
                        "item_name": "Item One",
                        "batch_number": "BATCH-001",
                        "quantity": 50,
                    },
                    {
                        "item_code": "ITEM-1",
                        "item_name": "Item One",
                        "batch_number": "BATCH-001",  # Duplicate!
                        "quantity": 30,
                    },
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, msg=f"Response: {response.data}")
        self.assertIn("Batch already added", response.data["error"])
        self.assertEqual(PendingTransferRequest.objects.count(), 0)

    @patch("api.views.transfer_service.get_batch_details")
    @patch("api.views.sap.get_intermediate_warehouses")
    def test_duplicate_batch_case_insensitive_is_rejected(self, mock_get_intermediate, mock_get_batch_details):
        """Duplicate detection is case-insensitive for batch numbers."""
        mock_get_intermediate.return_value = []
        mock_get_batch_details.side_effect = lambda batch_number, **kwargs: {
            "item_code": "ITEM-1",
            "item_name": "Item One",
            "batch_number": batch_number.upper(),
            "batch_abs_entry": 1,
            "available_quantity": 100,
            "uom": "CTN",
            "expiry_date": None,
            "from_warehouse": "WH-01",
            "from_bin": "BIN-A",
            "mock": False,
        }
        self.client.login(username="transfer", password="pass")

        response = self.client.post(
            "/api/transfer/move/",
            {
                "transfer_stage": TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE,
                "from_warehouse": "WH-01",
                "to_warehouse": "WH-02",
                "lines": [
                    {
                        "batch_number": "batch-001",
                        "quantity": 50,
                    },
                    {
                        "batch_number": "BATCH-001",  # Different case, same batch
                        "quantity": 30,
                    },
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, msg=f"Response: {response.data}")
        self.assertIn("Batch already added", response.data["error"])

    @patch("api.views.transfer_service.get_batch_details")
    @patch("api.views.sap.get_intermediate_warehouses")
    def test_completely_invalid_batch_is_rejected(self, mock_get_intermediate, mock_get_batch_details):
        """Batch that doesn't exist in SAP or local receipts is rejected."""
        mock_get_intermediate.return_value = []
        mock_get_batch_details.side_effect = TransferBatchNotFound("Batch not found in SAP")
        self.client.login(username="transfer", password="pass")

        response = self.client.post(
            "/api/transfer/move/",
            {
                "transfer_stage": TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE,
                "from_warehouse": "WH-01",
                "to_warehouse": "WH-02",
                "lines": [
                    {
                        "batch_number": "NONEXISTENT-BATCH",
                        "quantity": 50,
                    },
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, msg=f"Response: {response.data}")
        self.assertIn("not found", response.data["error"].lower())
        self.assertEqual(PendingTransferRequest.objects.count(), 0)

    @patch("api.views.transfer_service.get_batch_details")
    @patch("api.views.sap.get_intermediate_warehouses")
    def test_valid_sap_batch_is_accepted(self, mock_get_intermediate, mock_get_batch_details):
        """Valid batch from SAP is accepted."""
        mock_get_intermediate.return_value = []
        mock_get_batch_details.return_value = {
            "item_code": "ITEM-1",
            "item_name": "Item One",
            "batch_number": "BATCH-001",
            "batch_abs_entry": 1,
            "available_quantity": 100,
            "uom": "CTN",
            "expiry_date": None,
            "from_warehouse": "WH-01",
            "from_bin": "BIN-A",
            "mock": False,
        }
        self.client.login(username="transfer", password="pass")

        response = self.client.post(
            "/api/transfer/move/",
            {
                "transfer_stage": TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE,
                "from_warehouse": "WH-01",
                "to_warehouse": "WH-02",
                "lines": [
                    {
                        "batch_number": "BATCH-001",
                        "quantity": 50,
                    },
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=f"Response: {response.data}")
        self.assertEqual(response.data["success"], True)
        pending = PendingTransferRequest.objects.get()
        self.assertEqual(pending.batch_number, "BATCH-001")
        self.assertEqual(pending.quantity, 50)

    @patch("api.views.transfer_service.get_batch_details")
    def test_batch_lookup_excludes_batch_with_active_pending_transfer_for_route(
        self,
        mock_get_batch_details,
    ):
        PendingTransferRequest.objects.create(
            transfer_stage=TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE,
            from_warehouse="WH-01",
            to_warehouse="WH-02",
            batch_number="BATCH-RESERVED-1",
            quantity=50,
            lines=[{"batch_number": "BATCH-RESERVED-1", "quantity": 50}],
            raw_payload_json={},
            status=PendingTransferRequest.PENDING,
            created_by=self.transfer_user,
        )
        self.client.login(username="transfer", password="pass")

        response = self.client.get(
            "/api/transfer/batches/BATCH-RESERVED-1/",
            {
                "from_warehouse": "WH-01",
                "transfer_stage": TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE,
            },
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn("active pending transfer", response.data["error"])
        mock_get_batch_details.assert_not_called()

    @patch("api.views.transfer_service.get_batch_details")
    @patch("api.views.transfer_service._resolve_intermediate_warehouses", return_value=[])
    def test_second_pending_transfer_for_same_batch_and_route_is_rejected(
        self,
        mock_get_intermediate,
        mock_get_batch_details,
    ):
        mock_get_intermediate.return_value = []
        mock_get_batch_details.return_value = {
            "item_code": "ITEM-1",
            "item_name": "Item One",
            "batch_number": "BATCH-RESERVED-2",
            "batch_abs_entry": 1,
            "available_quantity": 50,
            "uom": "CTN",
            "expiry_date": None,
            "from_warehouse": "WH-01",
            "from_bin": "",
            "mock": False,
        }
        self.client.login(username="transfer", password="pass")

        payload = {
            "transfer_stage": TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE,
            "from_warehouse": "WH-01",
            "to_warehouse": "WH-02",
            "lines": [
                {
                    "item_code": "ITEM-1",
                    "item_name": "Item One",
                    "batch_number": "batch-reserved-2",
                    "quantity": 50,
                }
            ],
        }
        create_response = self.client.post(
            "/api/transfer/move/",
            payload,
            format="json",
        )
        search_response = self.client.get(
            "/api/transfer/batches/BATCH-RESERVED-2/",
            {
                "from_warehouse": "WH-01",
                "transfer_stage": TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE,
            },
        )
        duplicate_response = self.client.post(
            "/api/transfer/move/",
            payload,
            format="json",
        )

        self.assertEqual(create_response.status_code, status.HTTP_200_OK)
        self.assertEqual(search_response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn("active pending transfer", search_response.data["error"])
        self.assertEqual(duplicate_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("active pending transfer", duplicate_response.data["error"])
        self.assertEqual(PendingTransferRequest.objects.count(), 1)
        self.assertEqual(mock_get_batch_details.call_count, 1)

    @patch("api.views.transfer_service.get_batch_details")
    @patch("api.views.sap.get_intermediate_warehouses")
    def test_valid_local_receipt_batch_is_accepted(self, mock_get_intermediate, mock_get_batch_details):
        """Valid batch from local pending receipt is accepted even if not in SAP."""
        mock_get_intermediate.return_value = []
        mock_get_batch_details.side_effect = TransferBatchNotFound("Not in SAP")

        receipt = PendingReceipt.objects.create(
            production_order_doc_entry=100,
            production_order_doc_num="200",
            item_code="ITEM-1",
            item_name="Item One",
            warehouse_code="WH-01",
            warehouse_name="Warehouse 01",
            uom_entry="118",
            uom_label="KG",
            unit_count=50,
            final_quantity=50,
            requested_quantity=50,
            status=PendingReceipt.PENDING_REVIEW,
            created_by=self.transfer_user,
            sap_order_number="200",
            raw_payload_json={},
        )
        PendingReceiptBatch.objects.create(
            pending_receipt=receipt,
            batch_number="LOCAL-BATCH-1",
            quantity=50,
            unit_count=50,
            uom_entry="118",
            uom_label="KG",
        )

        self.client.login(username="transfer", password="pass")

        response = self.client.post(
            "/api/transfer/move/",
            {
                "transfer_stage": TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE,
                "from_warehouse": "WH-01",
                "to_warehouse": "WH-02",
                "lines": [
                    {
                        "batch_number": "LOCAL-BATCH-1",
                        "quantity": 30,
                    },
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=f"Response: {response.data}")
        self.assertEqual(response.data["success"], True)
        pending = PendingTransferRequest.objects.get()
        self.assertEqual(pending.batch_number, "LOCAL-BATCH-1")
        self.assertEqual(pending.quantity, 30)

    @patch("api.views.transfer_service.get_batch_details")
    @patch("api.views.sap.get_intermediate_warehouses")
    def test_valid_pending_transfer_chain_batch_is_accepted(self, mock_get_intermediate, mock_get_batch_details):
        """Valid batch from pending transfer chain is accepted."""
        mock_get_intermediate.return_value = []
        mock_get_batch_details.side_effect = TransferBatchNotFound("Not in SAP")

        source_transfer = PendingTransferRequest.objects.create(
            transfer_stage=TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE,
            from_warehouse="WH-00",
            to_warehouse="WH-01",
            item_code="ITEM-1",
            item_name="Item One",
            batch_number="CHAIN-BATCH-1",
            quantity=100,
            lines=[
                {
                    "batch_number": "CHAIN-BATCH-1",
                    "quantity": 100,
                }
            ],
            raw_payload_json={},
            status=PendingTransferRequest.PENDING,
            created_by=self.transfer_user,
        )

        self.client.login(username="transfer", password="pass")

        response = self.client.post(
            "/api/transfer/move/",
            {
                "transfer_stage": TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE,
                "from_warehouse": "WH-01",
                "to_warehouse": "WH-02",
                "lines": [
                    {
                        "batch_number": "CHAIN-BATCH-1",
                        "quantity": 50,
                    },
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=f"Response: {response.data}")
        self.assertEqual(response.data["success"], True)
        pending = PendingTransferRequest.objects.filter(
            from_warehouse="WH-01"
        ).get()
        self.assertEqual(pending.batch_number, "CHAIN-BATCH-1")

