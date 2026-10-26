import json
import time
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from unittest.mock import patch
from django.db import IntegrityError, close_old_connections
from django.test import TestCase, TransactionTestCase, override_settings, skipUnlessDBFeature
from django.contrib.auth.models import User
from django.utils import timezone
from api.models import PendingQualityInspection
from api.models_purchase_quotation import PurchaseQuotationDraft
from api.models_quality import PurchaseGRPODraft
from api.role_permissions import (
    ROLE_SCALE_ADMIN,
    ROLE_SCALE_OPERATOR,
    can_access_scale,
    can_manage_scale,
    is_scale_admin,
    is_scale_operator,
    can_create_user_role,
    normalize_role,
)
from scale.models import (
    ScaleDevice,
    ScaleVehicle,
    ScaleVehicleMovement,
    ScaleItemElement,
    ScaleDraft,
    ScaleDraftNumberSequence,
    ScaleDraftElement,
    ScaleDraftAllocation,
    ScalePermit,
    ScaleReceipt,
    ScaleReceiptItem,
    ScaleEntryExitPermit,
    ScaleEntryExitPermitItem,
)
from scale.services.scale_reader import (
    parse_raw_weight,
    ScaleDeviceState,
    scale_reader_service,
)


class ScaleReaderServiceTestCase(TestCase):
    def setUp(self):
        scale_reader_service.reset()

    def test_parse_valid_raw_weights(self):
        self.assertEqual(parse_raw_weight("ST,GS,+012540.00kg\r\n"), Decimal("12540.00"))
        self.assertEqual(parse_raw_weight("WN: 5420.5 kg"), Decimal("5420.5"))
        self.assertEqual(parse_raw_weight("12500"), Decimal("12500"))
        self.assertEqual(parse_raw_weight("+0.00"), Decimal("0.00"))
        self.assertEqual(parse_raw_weight("-150.25"), Decimal("-150.25"))

    def test_parse_invalid_raw_weights(self):
        self.assertIsNone(parse_raw_weight(""))
        self.assertIsNone(parse_raw_weight("NO_DATA_AVAILABLE"))
        self.assertIsNone(parse_raw_weight(None))
        self.assertIsNone(parse_raw_weight("ERROR_TIMEOUT"))

    def test_stability_detection(self):
        state = ScaleDeviceState(device_id="test_scale", stability_window_seconds=1.0, stability_tolerance_kg=Decimal("0.50"))
        self.assertFalse(state.is_stable)

        # Feed 3 consistent readings
        state.update_reading(Decimal("10000.00"))
        state.update_reading(Decimal("10000.20"))
        state.update_reading(Decimal("10000.10"))
        self.assertTrue(state.is_stable)

        # Feed fluctuating reading
        state.update_reading(Decimal("10050.00"))
        self.assertFalse(state.is_stable)

    def test_device_offline_detection(self):
        state = ScaleDeviceState(device_id="test_offline")
        state.update_reading(Decimal("5000.00"))
        info = state.to_dict(offline_threshold_seconds=0.1)
        self.assertTrue(info["is_online"])

        # Fake time lapse
        state.last_seen = time.time() - 30.0
        offline_info = state.to_dict(offline_threshold_seconds=10.0)
        self.assertFalse(offline_info["is_online"])
        self.assertFalse(offline_info["is_stable"])

    def test_redis_shared_cache_write_and_read(self):
        res = scale_reader_service.record_reading(
            device_id="scale_redis_test",
            weight=Decimal("12345.50"),
            is_stable=True,
            device_name="Redis Test Scale",
        )
        self.assertEqual(res["weight"], 12345.50)
        self.assertTrue(res["is_stable"])
        self.assertTrue(res["is_online"])

        # Verify reading directly via get_live_reading
        live = scale_reader_service.get_live_reading("scale_redis_test")
        self.assertEqual(live["weight"], 12345.50)
        self.assertTrue(live["is_stable"])
        self.assertTrue(live["is_online"])

    def test_cache_unavailable_fallback_to_in_memory(self):
        # Mock cache raising exception
        with patch("django.core.cache.cache.get", side_effect=Exception("Redis connection refused")), \
             patch("django.core.cache.cache.set", side_effect=Exception("Redis write timeout")):
            
            res = scale_reader_service.record_reading(
                device_id="scale_fallback_test",
                weight=Decimal("7777.00"),
                is_stable=True,
            )
            self.assertEqual(res["weight"], 7777.00)

            live = scale_reader_service.get_live_reading("scale_fallback_test")
            self.assertEqual(live["weight"], 7777.00)
            self.assertTrue(live["is_online"])


class ScaleWorkflowAPIsTestCase(TestCase):
    def setUp(self):
        scale_reader_service.reset()

        # Scale Operator
        self.operator = User.objects.create_user(username="op_user", password="password123")
        self.operator.userprofile.role = "scale_operator"
        self.operator.userprofile.warehouse = "WH-01"
        self.operator.userprofile.save()

        # Scale Admin
        self.admin = User.objects.create_user(username="admin_user", password="password123")
        self.admin.userprofile.role = "scale_admin"
        self.admin.userprofile.warehouse = "WH-01"
        self.admin.userprofile.save()

        # Quality User
        self.qa_user = User.objects.create_user(username="qa_user", password="password123")
        self.qa_user.userprofile.role = "quality_user"
        self.qa_user.userprofile.warehouse = "WH-01"
        self.qa_user.userprofile.save()

        # Production User (unauthorized for scale management)
        self.prod_user = User.objects.create_user(username="prod_user", password="password123")
        self.prod_user.userprofile.role = "production_user"
        self.prod_user.userprofile.warehouse = "WH-01"
        self.prod_user.userprofile.save()

        # Device & Item elements
        self.device = ScaleDevice.objects.create(
            device_id="scale_001",
            device_name="Scale In Gate",
            device_type="local",
            com_port="COM3",
        )
        self.pallet = ScaleItemElement.objects.create(
            item_code="ITEM-STRAWBERRY",
            item_name="Strawberries",
            name="Wood Pallet",
            weight=Decimal("20.00"),
        )
        self.crate = ScaleItemElement.objects.create(
            item_code="ITEM-STRAWBERRY",
            item_name="Strawberries",
            name="Plastic Crate",
            weight=Decimal("1.50"),
        )

    @override_settings(SCALE_AGENT_AUTH_TOKEN="test-scale-agent-token")
    def test_live_weight_and_receive_weight_apis(self):
        # 1. Ingest reading via receive-weight API
        payload = {
            "device_id": "scale_001",
            "weight": "15420.50",
            "is_stable": True,
            "device_name": "Scale In Gate",
        }
        res = self.client.post(
            "/api/scale/receive-weight/",
            data=json.dumps(payload),
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer test-scale-agent-token",
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["success"])

        # 2. Get live weight as operator
        self.client.force_login(self.operator)
        res_live = self.client.get("/api/scale/live-weight/?device_id=scale_001")
        self.assertEqual(res_live.status_code, 200)
        body = res_live.json()
        self.assertTrue(body["success"])
        self.assertEqual(body["data"]["weight"], 15420.50)
        self.assertTrue(body["data"]["is_online"])
        self.assertTrue(body["data"]["is_stable"])

    @override_settings(SCALE_AGENT_AUTH_TOKEN="test-scale-agent-token")
    def test_receive_weight_requires_valid_scale_agent_credential(self):
        payload = {
            "device_id": "scale_001",
            "weight": "15420.50",
            "is_stable": True,
            "raw_data": "15420.50 kg",
        }

        anonymous = self.client.post(
            "/api/scale/receive-weight/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        self.assertEqual(anonymous.status_code, 401)

        self.client.force_login(self.operator)
        browser_without_credential = self.client.post(
            "/api/scale/receive-weight/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        self.assertEqual(browser_without_credential.status_code, 401)

        invalid_token = "invalid-agent-token"
        invalid = self.client.post(
            "/api/scale/receive-weight/",
            data=json.dumps(payload),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {invalid_token}",
        )
        self.assertEqual(invalid.status_code, 401)
        self.assertNotIn(invalid_token, invalid.content.decode("utf-8"))

        valid = self.client.post(
            "/api/scale/receive-weight/",
            data=json.dumps(payload),
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer test-scale-agent-token",
        )
        self.assertEqual(valid.status_code, 200)
        self.assertTrue(valid.json()["success"])
        self.assertNotIn("test-scale-agent-token", valid.content.decode("utf-8"))
        self.assertEqual(valid.json()["data"]["weight"], 15420.5)

    @override_settings(SCALE_AGENT_AUTH_TOKEN="test-scale-agent-token")
    def test_receive_weight_valid_credential_keeps_payload_validation(self):
        response = self.client.post(
            "/api/scale/receive-weight/",
            data=json.dumps({"device_id": "scale_001", "weight": "not-a-number"}),
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer test-scale-agent-token",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.json()["success"])

    @override_settings(SCALE_AGENT_AUTH_TOKEN="")
    def test_receive_weight_fails_closed_when_server_credential_is_unconfigured(self):
        response = self.client.post(
            "/api/scale/receive-weight/",
            data=json.dumps({"device_id": "scale_001", "weight": "100"}),
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer any-token",
        )
        self.assertEqual(response.status_code, 401)

    @patch("scale.views.cache_set")
    @patch("scale.views.cache_get", return_value=None)
    @patch("scale.views._fetch_all_sap_pages")
    @patch("scale.views.SAPServiceLayer")
    def test_receiving_items_lookup_by_item_code_returns_group_code(
        self,
        _mock_sap_service,
        mock_fetch_all,
        _mock_cache_get,
        _mock_cache_set,
    ):
        self.client.force_login(self.operator)
        mock_fetch_all.return_value = [
            {
                "ItemCode": "27007777",
                "ItemName": "Receiving Item",
                "ItemsGroupCode": 123,
                "InventoryUOM": "KG",
            },
        ]

        response = self.client.get("/api/scale/master-data/items/?item_code=27007777")

        self.assertEqual(response.status_code, 200)
        item = response.json()["items"][0]
        self.assertEqual(item["item_code"], "27007777")
        self.assertEqual(item["item_group_code"], "123")

        requested_endpoint = mock_fetch_all.call_args[0][1]
        self.assertIn("ItemCode eq '27007777'", requested_endpoint)
        self.assertIn("startswith(ItemCode, '27')", requested_endpoint)

    def test_complete_scale_draft_workflow(self):
        self.client.force_login(self.operator)

        # ── Step 1: First Weight (Loaded) ──────────────────────────────────
        first_payload = {
            "start_type": "loaded",
            "direct_vehicle_number": "TRUCK-9900",
            "direct_driver_name": "Hassan Ibrahim",
            "item_code": "ITEM-STRAWBERRY",
            "item_name": "Strawberries",
            "vendor_card_code": "VEND-DELTA",
            "vendor_name": "Delta Farms",
            "weight": "24000.00",
            "elements": [
                {"item_element_id": self.pallet.id, "count": 10, "action": "remove"},  # -200kg
            ],
            "notes": "Truck arrived loaded with fresh crop"
        }
        res_first = self.client.post(
            "/api/scale/drafts/first-weight/",
            data=json.dumps(first_payload),
            content_type="application/json",
        )
        self.assertEqual(res_first.status_code, 201)
        draft_data = res_first.json()["data"]
        draft_id = draft_data["id"]

        self.assertEqual(draft_data["status"], ScaleDraft.STATUS_SECOND_WEIGHT_PENDING)
        self.assertEqual(draft_data["weight_loaded"], "24000.00")
        self.assertEqual(draft_data["net_weight_loaded"], "23800.00")
        self.assertIsNone(draft_data["product_weight"])
        self.assertFalse(draft_data["is_closed"])

        # ── Step 2: Second Weight (Empty) ──────────────────────────────────
        second_payload = {
            "weight": "9000.00",
            "elements": [
                {"item_element_id": self.crate.id, "count": 100, "action": "remove"},  # -150kg
            ]
        }
        res_second = self.client.post(
            f"/api/scale/drafts/{draft_id}/second-weight/",
            data=json.dumps(second_payload),
            content_type="application/json",
        )
        self.assertEqual(res_second.status_code, 200)
        draft_second = res_second.json()["data"]

        # Net loaded: 23800.00, Net empty: 9000 - 150 = 8850.00
        # Product weight: 23800 - 8850 = 14950.00
        self.assertEqual(draft_second["net_weight_empty"], "8850.00")
        self.assertEqual(draft_second["product_weight"], "14950.00")
        self.assertTrue(draft_second["is_closed"])
        self.assertEqual(draft_second["status"], ScaleDraft.STATUS_COMPLETED)

        # Check list endpoint ensures the draft is included
        res_list = self.client.get("/api/scale/drafts/")
        self.assertEqual(res_list.status_code, 200)
        self.assertTrue(len(res_list.json()["data"]) > 0)

        # ── Step 4: Send to Quality ────────────────────────────────────────
        res_send = self.client.post(f"/api/scale/drafts/{draft_id}/send-to-quality/")
        self.assertEqual(res_send.status_code, 200)
        self.assertEqual(res_send.json()["data"]["status"], ScaleDraft.STATUS_SENT_TO_QUALITY)

        # ── Step 5: Quality Pending Endpoint ───────────────────────────────
        self.client.force_login(self.qa_user)
        res_qa = self.client.get("/api/scale/quality/pending-drafts/")
        self.assertEqual(res_qa.status_code, 200)
        qa_data = res_qa.json()["data"]
        self.assertTrue(any(d["scale_draft_id"] == draft_id for d in qa_data))
        matched = next(d for d in qa_data if d["scale_draft_id"] == draft_id)
        self.assertEqual(matched["vehicle_number"], "TRUCK-9900")
        self.assertEqual(matched["product_weight"], 14950.0)

    def test_second_weight_allocation_item_correction_updates_draft_item(self):
        self.client.force_login(self.operator)
        draft = ScaleDraft.objects.create(
            start_type="loaded",
            direct_vehicle_number="CORR-TRUCK-01",
            item_code="27000001",
            item_name="Old Item",
            vendor_card_code="VEND-DELTA",
            vendor_name="Delta Farms",
            weight_loaded=Decimal("12000.00"),
            created_by=self.operator,
            status=ScaleDraft.STATUS_SECOND_WEIGHT_PENDING,
        )
        ScaleDraftAllocation.objects.create(
            draft=draft,
            line_number=1,
            vendor_card_code="VEND-DELTA",
            vendor_name="Delta Farms",
            item_code="27000001",
            item_name="Old Item",
            crop_name="Old Item",
        )

        response = self.client.post(
            f"/api/scale/drafts/{draft.id}/second-weight/",
            data=json.dumps({
                "weight": "5000.00",
                "allocations": [
                    {
                        "vendor_card_code": "VEND-DELTA",
                        "vendor_name": "Delta Farms",
                        "item_code": "27001234",
                        "item_name": "Corrected Item",
                    },
                ],
            }),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["item_code"], "27001234")
        self.assertEqual(data["item_name"], "Corrected Item")

        draft.refresh_from_db()
        self.assertEqual(draft.item_code, "27001234")
        self.assertEqual(draft.item_name, "Corrected Item")
        allocation = draft.allocations.get(line_number=1)
        self.assertEqual(allocation.item_code, "27001234")
        self.assertEqual(allocation.item_name, "Corrected Item")

    def test_new_scale_draft_numbers_are_item_code_sequences(self):
        self.client.force_login(self.operator)

        def create_first_weight(item_code, vehicle_number):
            response = self.client.post(
                "/api/scale/drafts/first-weight/",
                data=json.dumps({
                    "start_type": "loaded",
                    "direct_vehicle_number": vehicle_number,
                    "item_code": item_code,
                    "item_name": f"Item {item_code}",
                    "weight": "12000.00",
                }),
                content_type="application/json",
            )
            self.assertEqual(response.status_code, 201)
            return response.json()["data"]

        first = create_first_weight("27001234", "SEQ-TRUCK-01")
        second = create_first_weight("27001234", "SEQ-TRUCK-02")
        other_item = create_first_weight("27005678", "SEQ-TRUCK-03")

        self.assertEqual(first["draft_number"], "27001234-0001")
        self.assertEqual(second["draft_number"], "27001234-0002")
        self.assertEqual(other_item["draft_number"], "27005678-0001")
        self.assertEqual(
            ScaleDraftNumberSequence.objects.get(item_code="27001234").last_number,
            2,
        )
        self.assertEqual(
            ScaleDraftNumberSequence.objects.get(item_code="27005678").last_number,
            1,
        )

    def test_existing_sd_draft_number_is_not_changed(self):
        draft = ScaleDraft.objects.create(
            draft_number="SD-20260825-0003",
            start_type="loaded",
            item_code="27009999",
            item_name="Legacy Item",
            direct_vehicle_number="LEGACY-TRUCK",
            weight_loaded=Decimal("10000.00"),
            created_by=self.operator,
        )

        draft.refresh_from_db()
        self.assertEqual(draft.draft_number, "SD-20260825-0003")
        self.assertFalse(ScaleDraftNumberSequence.objects.filter(item_code="27009999").exists())

    def test_virtual_scale_simulation(self):
        self.client.force_login(self.operator)

        # 1. Set Virtual Scale Weight
        sim_payload = {
            "device_id": "scale_virtual_001",
            "weight": "16500.25",
            "is_stable": True,
            "is_online": True,
            "device_name": "Virtual Lab Scale",
        }
        res_set = self.client.post(
            "/api/scale/simulator/set/",
            data=json.dumps(sim_payload),
            content_type="application/json",
        )
        self.assertEqual(res_set.status_code, 200)
        self.assertTrue(res_set.json()["success"])

        # 2. Read live-weight for virtual scale
        res_live = self.client.get("/api/scale/live-weight/?device_id=scale_virtual_001")
        self.assertEqual(res_live.status_code, 200)
        data = res_live.json()["data"]
        self.assertEqual(data["weight"], 16500.25)
        self.assertTrue(data["is_stable"])
        self.assertTrue(data["is_online"])

        # 3. Simulate Unstable weight
        self.client.post(
            "/api/scale/simulator/set/",
            data=json.dumps({"device_id": "scale_virtual_001", "weight": "16510.00", "is_stable": False}),
            content_type="application/json",
        )
        res_unstable = self.client.get("/api/scale/live-weight/?device_id=scale_virtual_001")
        self.assertFalse(res_unstable.json()["data"]["is_stable"])

        # 4. Simulate Offline
        self.client.post(
            "/api/scale/simulator/set/",
            data=json.dumps({"device_id": "scale_virtual_001", "weight": "16510.00", "is_online": False}),
            content_type="application/json",
        )
        res_offline = self.client.get("/api/scale/live-weight/?device_id=scale_virtual_001")
        self.assertFalse(res_offline.json()["data"]["is_online"])

        # 5. Check simulator status
        res_status = self.client.get("/api/scale/simulator/status/")
        self.assertEqual(res_status.status_code, 200)
        self.assertTrue(len(res_status.json()["data"]) >= 1)

    def test_virtual_scale_cannot_override_physical_device(self):
        self.client.force_login(self.operator)

        # Attempt to simulate on physical device 'scale_001' (type='local')
        payload = {
            "device_id": "scale_001",
            "weight": "99999.00",
        }
        res = self.client.post(
            "/api/scale/simulator/set/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("cannot override", res.json()["error"])

    def test_vehicle_entry_exit_workflow(self):
        self.client.force_login(self.operator)

        # Vehicle Entry
        entry_payload = {
            "vehicle_number": "TRUCK-FLOW-01",
            "driver_name": "Sami Nabil",
            "company": "Fast Express",
            "notes": "Gate 1 Entry"
        }
        res_entry = self.client.post(
            "/api/scale/vehicles/entry/",
            data=json.dumps(entry_payload),
            content_type="application/json",
        )
        self.assertEqual(res_entry.status_code, 201)
        vehicle = ScaleVehicle.objects.get(vehicle_number="TRUCK-FLOW-01")
        self.assertTrue(vehicle.is_inside)

        # Vehicle Exit
        exit_payload = {
            "vehicle_number": "TRUCK-FLOW-01",
        }
        res_exit = self.client.post(
            "/api/scale/vehicles/exit/",
            data=json.dumps(exit_payload),
            content_type="application/json",
        )
        self.assertEqual(res_exit.status_code, 200)
        vehicle.refresh_from_db()
        self.assertFalse(vehicle.is_inside)

    def test_invalid_first_weight_validation(self):
        self.client.force_login(self.operator)

        # Negative weight
        res = self.client.post(
            "/api/scale/drafts/first-weight/",
            data=json.dumps({"weight": "-500.00"}),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 400)

        # Non-numeric weight
        res_text = self.client.post(
            "/api/scale/drafts/first-weight/",
            data=json.dumps({"weight": "abc"}),
            content_type="application/json",
        )
        self.assertEqual(res_text.status_code, 400)

    def test_cannot_send_incomplete_draft_to_quality(self):
        self.client.force_login(self.operator)

        # Draft with only first weight
        res = self.client.post(
            "/api/scale/drafts/first-weight/",
            data=json.dumps({"weight": "10000.00", "direct_vehicle_number": "TRUCK-HALF"}),
            content_type="application/json",
        )
        draft_id = res.json()["data"]["id"]

        # Attempt to send to quality prematurely
        res_send = self.client.post(f"/api/scale/drafts/{draft_id}/send-to-quality/")
        self.assertEqual(res_send.status_code, 400)
        self.assertIn("error", res_send.json())

    def test_draft_cancellation(self):
        self.client.force_login(self.operator)

        res = self.client.post(
            "/api/scale/drafts/first-weight/",
            data=json.dumps({"weight": "10000.00", "direct_vehicle_number": "TRUCK-CANCEL"}),
            content_type="application/json",
        )
        draft_id = res.json()["data"]["id"]

        res_cancel = self.client.post(f"/api/scale/drafts/{draft_id}/cancel/")
        self.assertEqual(res_cancel.status_code, 200)
        self.assertEqual(res_cancel.json()["data"]["status"], ScaleDraft.STATUS_CANCELLED)

    def test_permissions_access_control(self):
        # 1. Unauthenticated user denied
        res = self.client.get("/api/scale/live-weight/")
        self.assertEqual(res.status_code, 401)

        # 2. Production user denied access to scale
        self.client.force_login(self.prod_user)
        res_prod = self.client.get("/api/scale/live-weight/")
        self.assertEqual(res_prod.status_code, 403)

        # 3. Scale operator cannot create devices (admin only)
        self.client.force_login(self.operator)
        res_dev = self.client.post(
            "/api/scale/devices/",
            data=json.dumps({"device_id": "scale_99", "device_name": "New Scale", "device_type": "local", "com_port": "COM4"}),
            content_type="application/json",
        )
        self.assertEqual(res_dev.status_code, 403)

        # 4. Scale admin can create devices
        self.client.force_login(self.admin)
        res_dev_admin = self.client.post(
            "/api/scale/devices/",
            data=json.dumps({"device_id": "scale_99", "device_name": "New Scale", "device_type": "local", "com_port": "COM4"}),
            content_type="application/json",
        )
        self.assertEqual(res_dev_admin.status_code, 201)

    def test_net_product_weight_cases(self):
        """
        Verify exact business calculation:
        NET PRODUCT WEIGHT = GROSS WEIGHT - EMPTY TARE WEIGHT - TOTAL INFLUENCING ELEMENT WEIGHT
        """
        self.client.force_login(self.operator)

        # CASE 1: Gross = 18,450, Empty = 18,000, Tare elements = 100 x 0.5 = 50 -> Expected Net = 400 KG
        draft1 = ScaleDraft.objects.create(
            start_type="loaded",
            direct_vehicle_number="CASE-01",
            weight_loaded=Decimal("18450.00"),
            created_by=self.operator
        )
        ScaleDraftElement.objects.create(
            draft=draft1,
            item_element=self.crate,  # weight = 0.50
            count=100,
            stage="loaded",
            action="remove",
            unit_weight=Decimal("0.50")
        )
        res1 = self.client.post(
            f"/api/scale/drafts/{draft1.id}/second-weight/",
            data=json.dumps({"weight": "18000.00"}),
            content_type="application/json"
        )
        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res1.json()["data"]["product_weight"], "400.00")

        # CASE 2: Gross = 18,450, Empty = 18,450, Tare elements = 50 -> INVALID / 400 error (NOT 50 KG)
        draft2 = ScaleDraft.objects.create(
            start_type="loaded",
            direct_vehicle_number="CASE-02",
            weight_loaded=Decimal("18450.00"),
            created_by=self.operator
        )
        ScaleDraftElement.objects.create(
            draft=draft2,
            item_element=self.crate,
            count=100,
            stage="loaded",
            action="remove",
            unit_weight=Decimal("0.50")
        )
        res2 = self.client.post(
            f"/api/scale/drafts/{draft2.id}/second-weight/",
            data=json.dumps({"weight": "18450.00"}),
            content_type="application/json"
        )
        self.assertEqual(res2.status_code, 400)
        self.assertIn("Invalid weighing", res2.json()["error"])
        draft2.refresh_from_db()
        self.assertIsNone(draft2.product_weight)
        self.assertFalse(draft2.is_closed)

        # CASE 3: Gross = 20,000, Empty = 15,000, Tare elements = 500 -> Expected Net = 4,500 KG
        draft3 = ScaleDraft.objects.create(
            start_type="loaded",
            direct_vehicle_number="CASE-03",
            weight_loaded=Decimal("20000.00"),
            created_by=self.operator
        )
        ScaleDraftElement.objects.create(
            draft=draft3,
            item_element=self.pallet,
            count=25,  # 25 x 20 = 500 kg
            stage="loaded",
            action="remove",
            unit_weight=Decimal("20.00")
        )
        res3 = self.client.post(
            f"/api/scale/drafts/{draft3.id}/second-weight/",
            data=json.dumps({"weight": "15000.00"}),
            content_type="application/json"
        )
        self.assertEqual(res3.status_code, 200)
        self.assertEqual(res3.json()["data"]["product_weight"], "4500.00")

    def test_phase1_multi_allocation_suite(self):
        pass

    def test_option3_proportional_distribution(self):
        pass


class ScaleDraftNumberingConcurrencyTestCase(TransactionTestCase):
    @skipUnlessDBFeature('has_select_for_update')
    def test_concurrent_drafts_for_same_item_get_unique_sequence_numbers(self):
        item_code = "27001234"

        def create_draft(index):
            close_old_connections()
            try:
                draft = ScaleDraft.objects.create(
                    start_type="loaded",
                    item_code=item_code,
                    item_name="Concurrent Item",
                    direct_vehicle_number=f"CONCURRENT-{index}",
                    weight_loaded=Decimal("10000.00"),
                )
                return draft.draft_number
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=4) as executor:
            draft_numbers = list(executor.map(create_draft, range(4)))

        self.assertEqual(len(set(draft_numbers)), 4)
        self.assertEqual(
            sorted(draft_numbers),
            [f"{item_code}-{index:04d}" for index in range(1, 5)],
        )
        self.assertEqual(
            ScaleDraftNumberSequence.objects.get(item_code=item_code).last_number,
            4,
        )

    def test_zero_package_count_validation(self):
        pass


class AutoDeviceTestCase(TestCase):
    """Phase C/D: Local devices with AUTO com_port/baud via the serializer."""

    def setUp(self):
        self.admin = User.objects.create_user(username="auto_admin", password="password123")
        self.admin.userprofile.role = "scale_admin"
        self.admin.userprofile.save()
        self.client.force_login(self.admin)

    def test_create_auto_device_no_com_port(self):
        res = self.client.post(
            "/api/scale/devices/",
            data=json.dumps({
                "device_id": "SCALE-AUTO-TEST",
                "device_name": "Auto Test",
                "device_type": "local",
                "com_port": "",
                "baud_rate": None,
                "location": "Gate 1",
                "is_active": True,
            }),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 201)
        dev = ScaleDevice.objects.get(device_id="SCALE-AUTO-TEST")
        self.assertIsNone(dev.com_port)
        self.assertIsNone(dev.baud_rate)

    def test_manual_port_with_auto_baud(self):
        res = self.client.post('/api/scale/devices/', data=json.dumps({
            'device_id': 'MANUAL-PORT-AUTO-BAUD', 'device_name': 'Auto Baud',
            'device_type': 'local', 'com_port': 'COM7', 'baud_rate': None,
        }), content_type='application/json')
        self.assertEqual(res.status_code, 201)
        device = ScaleDevice.objects.get(device_id='MANUAL-PORT-AUTO-BAUD')
        self.assertEqual(device.com_port, 'COM7')
        self.assertIsNone(device.baud_rate)

    def test_create_manual_device_preserves_values(self):
        res = self.client.post(
            "/api/scale/devices/",
            data=json.dumps({
                "device_id": "SCALE-MANUAL",
                "device_name": "Manual",
                "device_type": "local",
                "com_port": "COM7",
                "baud_rate": 4800,
            }),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 201)
        dev = ScaleDevice.objects.get(device_id="SCALE-MANUAL")
        self.assertEqual(dev.com_port, "COM7")
        self.assertEqual(dev.baud_rate, 4800)

    def test_update_auto_to_manual(self):
        dev = ScaleDevice.objects.create(
            device_id="SCALE-UPD", device_name="Upd",
            device_type="local", com_port=None, baud_rate=None,
        )
        res = self.client.put(
            f"/api/scale/devices/{dev.pk}/",
            data=json.dumps({"com_port": "COM9", "baud_rate": 19200}),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        dev.refresh_from_db()
        self.assertEqual(dev.com_port, "COM9")
        self.assertEqual(dev.baud_rate, 19200)

    def test_auto_device_getting_baud_rate_none(self):
        dev = ScaleDevice.objects.create(
            device_id="SCALE-NULL", device_name="Null",
            device_type="local", com_port=None, baud_rate=None,
        )
        res = self.client.get(f"/api/scale/devices/{dev.pk}/")
        self.assertEqual(res.status_code, 200)
        data = res.json()["data"]
        self.assertIsNone(data["com_port"])
        self.assertIsNone(data["baud_rate"])


class ScaleReceiptAPIsTestCase(TestCase):
    """EG.ST.F04 receiving receipt (إيصال الاستلام) APIs."""

    def setUp(self):
        self.user = User.objects.create_user(username="receipt_operator", password="password123")
        self.user.userprofile.role = "scale_operator"
        self.user.userprofile.save()
        self.client.force_login(self.user)

    def _create_receipt(self, **overrides):
        payload = {
            "receipt_date": "2026-09-17",
            "vehicle_number": "1234 أ ب",
            "driver_name": "محمد أحمد",
            "driver_license": "R123456",
            "source": "مزرعة النور",
            "supplier_name": "مزرعة النور",
            "items": [
                {
                    "line_number": 1,
                    "item_code": "27110000",
                    "item_name": "طماطم كيلو",
                    "count": 5,
                    "quantity_kg": "2500.00",
                    "package_type": "كرتونة",
                    "notes": "",
                },
                {
                    "line_number": 2,
                    "item_code": "27120000",
                    "item_name": "بطاطس",
                    "count": 3,
                    "quantity_kg": "1500.75",
                    "package_type": "شيكارة",
                    "notes": "",
                },
            ],
            **overrides,
        }
        return self.client.post(
            "/api/scale/receipts/",
            data=json.dumps(payload),
            content_type="application/json",
        )

    def test_create_receipt_with_items(self):
        res = self._create_receipt()
        self.assertEqual(res.status_code, 201, res.content)
        body = res.json()["data"]
        self.assertTrue(body["receipt_number"].startswith("RCP-"))
        self.assertEqual(len(body["items"]), 2)
        self.assertEqual(Decimal(body["total_quantity_kg"]), Decimal("4000.75"))
        self.assertEqual(Decimal(body["total_quantity_ton"]), Decimal("4.001"))
        self.assertEqual(body["items"][0]["quantity_ton"], "2.500")
        self.assertEqual(body["created_by_username"], "receipt_operator")

    def test_create_receipt_without_items(self):
        res = self._create_receipt(items=[])
        self.assertEqual(res.status_code, 201, res.content)
        body = res.json()["data"]
        self.assertEqual(Decimal(body["total_quantity_kg"]), Decimal("0.00"))
        self.assertEqual(Decimal(body["total_quantity_ton"]), Decimal("0.000"))
        self.assertIsNotNone(ScaleReceipt.objects.get(pk=body["id"]).receipt_number)

    def test_receipt_number_is_unique_and_generated(self):
        receipt = ScaleReceipt.objects.create(
            receipt_date="2026-09-17", vehicle_number="TEST-1"
        )
        self.assertTrue(receipt.receipt_number.startswith("RCP-"))
        other = ScaleReceipt.objects.create(
            receipt_date="2026-09-17", vehicle_number="TEST-2"
        )
        self.assertNotEqual(receipt.receipt_number, other.receipt_number)

    def test_get_receipt_list_and_detail(self):
        created = self._create_receipt().json()["data"]
        lst = self.client.get("/api/scale/receipts/")
        self.assertEqual(lst.status_code, 200)
        self.assertEqual(len(lst.json()["data"]), 1)

        detail = self.client.get(f"/api/scale/receipts/{created['id']}/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["data"]["vehicle_number"], "1234 أ ب")
        self.assertEqual(len(detail.json()["data"]["items"]), 2)

    def test_update_receipt_replaces_items(self):
        created = self._create_receipt().json()["data"]
        res = self.client.put(
            f"/api/scale/receipts/{created['id']}/",
            data=json.dumps({
                "vehicle_number": "9999 م م",
                "items": [
                    {
                        "item_code": "27000000",
                        "item_name": "بصل",
                        "count": 2,
                        "quantity_kg": "200",
                        "package_type": "كرتونة",
                    }
                ],
            }),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()["data"]
        self.assertEqual(body["vehicle_number"], "9999 م م")
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(Decimal(body["total_quantity_kg"]), Decimal("200.00"))
        self.assertEqual(ScaleReceiptItem.objects.filter(receipt_id=created["id"]).count(), 1)

    def test_delete_receipt(self):
        created = self._create_receipt().json()["data"]
        res = self.client.delete(f"/api/scale/receipts/{created['id']}/")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(ScaleReceipt.objects.filter(pk=created["id"]).exists())

    def test_receipt_requires_scale_access(self):
        self.client.logout()
        res = self._create_receipt()
        self.assertEqual(res.status_code, 401)

    def test_receipt_rejects_negative_quantities(self):
        payload = {
            "receipt_date": "2026-09-17",
            "items": [{"item_name": "طماطم", "count": 1, "quantity_kg": "-5"}],
        }
        res = self.client.post(
            "/api/scale/receipts/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 400, res.content)

    def test_receipt_rejects_negative_count(self):
        payload = {
            "receipt_date": "2026-09-17",
            "items": [{"item_name": "طماطم", "count": -3, "quantity_kg": 10}],
        }
        res = self.client.post(
            "/api/scale/receipts/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 400, res.content)


class ScaleEntryExitPermitAPIsTestCase(TestCase):
    """EG.ST.F05/F06 gate entry & exit permit APIs."""

    def setUp(self):
        self.user = User.objects.create_user(username="gate_operator", password="password123")
        self.user.userprofile.role = "scale_operator"
        self.user.userprofile.save()
        self.client.force_login(self.user)

    def _create_entry(self, **overrides):
        payload = {
            "permit_type": "entry",
            "permit_date": "2026-09-17",
            "supplier_name": "مزرعة النور",
            "driver_name": "محمود حسن",
            "vehicle_number": "س ص 4512",
            "inspection_result": "مطابق للقائمة الواردة",
            "gate_writer": "أحمد",
            "inspection_head": "خالد",
            "gross_weight_kg": "25000.00",
            "tare_weight_kg": "3000.00",
            "scale_operator": "سامي",
            "general_manager": "م. محمد",
            "weight_in_words": "فقط اثنان وعشرون طناً",
            "items": [
                {"line_number": 1, "item_code": "27110000", "item_name": "طماطم كيلو", "count": 20, "quantity_kg": "20000.00"},
                {"line_number": 2, "item_code": "27120000", "item_name": "بطاطس", "count": 5, "quantity_kg": "2000.50"},
            ],
            **overrides,
        }
        return self.client.post(
            "/api/scale/entry-exit-permits/",
            data=json.dumps(payload),
            content_type="application/json",
        )

    def _create_exit(self, **overrides):
        payload = {
            "permit_type": "exit",
            "permit_date": "2026-09-17",
            "buyer_name": "شركة الأهرام",
            "driver_name": "نبيل عادل",
            "destination": "الإسكندرية",
            "vehicle_number": "د هـ 7788",
            "responsible_person": "أشرف",
            "department_manager": "سعيد",
            "general_manager": "م. محمد",
            "items": [
                {"line_number": 1, "item_code": "27110000", "item_name": "طماطم كيلو", "count": 10, "quantity_kg": "12000.00"},
            ],
            **overrides,
        }
        return self.client.post(
            "/api/scale/entry-exit-permits/",
            data=json.dumps(payload),
            content_type="application/json",
        )

    def test_create_entry_permit_computes_net_and_ton(self):
        res = self._create_entry()
        self.assertEqual(res.status_code, 201, res.content)
        body = res.json()["data"]
        self.assertTrue(body["permit_number"].startswith("EP-"))
        self.assertEqual(len(body["items"]), 2)
        self.assertEqual(Decimal(body["net_weight_kg"]), Decimal("22000.00"))
        self.assertEqual(Decimal(body["gross_weight_ton"]), Decimal("25.000"))
        self.assertEqual(Decimal(body["net_weight_ton"]), Decimal("22.000"))
        self.assertEqual(Decimal(body["items"][0]["quantity_ton"]), Decimal("20.000"))
        self.assertEqual(body["created_by_username"], "gate_operator")
        self.assertIsNotNone(ScaleEntryExitPermit.objects.get(pk=body["id"]).permit_number)

    def test_create_exit_permit_uses_exx_prefix(self):
        res = self._create_exit()
        self.assertEqual(res.status_code, 201, res.content)
        body = res.json()["data"]
        self.assertTrue(body["permit_number"].startswith("EX-"))
        self.assertEqual(body["permit_type_display"], "تصريح خروج")
        self.assertEqual(Decimal(body["items"][0]["quantity_ton"]), Decimal("12.000"))

    def test_permit_number_is_unique(self):
        first = ScaleEntryExitPermit.objects.create(permit_type="entry", vehicle_number="T1")
        second = ScaleEntryExitPermit.objects.create(permit_type="entry", vehicle_number="T2")
        self.assertNotEqual(first.permit_number, second.permit_number)

    def test_entry_requires_supplier_driver_vehicle(self):
        res = self._create_entry(supplier_name="")
        self.assertEqual(res.status_code, 400, res.content)

    def test_exit_requires_buyer_destination(self):
        res = self._create_exit(destination="")
        self.assertEqual(res.status_code, 400, res.content)

    def test_permit_requires_at_least_one_product(self):
        res = self._create_entry(items=[])
        self.assertEqual(res.status_code, 400, res.content)
        res = self._create_entry(items=[{"item_name": "", "count": 1, "quantity_kg": "0"}])
        self.assertEqual(res.status_code, 400, res.content)

    def test_entry_rejects_gross_smaller_than_tare(self):
        res = self._create_entry(gross_weight_kg="1000.00", tare_weight_kg="3000.00")
        self.assertEqual(res.status_code, 400, res.content)

    def test_permit_rejects_negative_quantities(self):
        res = self._create_entry(items=[{"item_name": "بصل", "count": 1, "quantity_kg": "-5"}])
        self.assertEqual(res.status_code, 400, res.content)

    def test_get_list_and_detail(self):
        created = self._create_entry().json()["data"]
        lst = self.client.get("/api/scale/entry-exit-permits/")
        self.assertEqual(lst.status_code, 200)
        self.assertEqual(len(lst.json()["data"]), 1)

        detail = self.client.get(f"/api/scale/entry-exit-permits/{created['id']}/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["data"]["vehicle_number"], "س ص 4512")

    def test_update_permit_replaces_items(self):
        created = self._create_exit().json()["data"]
        res = self.client.put(
            f"/api/scale/entry-exit-permits/{created['id']}/",
            data=json.dumps({
                "permit_type": "exit",
                "permit_date": "2026-09-17",
                "buyer_name": "شركة النيل",
                "driver_name": "نبيل عادل",
                "destination": "بورسعيد",
                "vehicle_number": "د هـ 7788",
                "items": [
                    {"item_name": "بصل", "count": 3, "quantity_kg": "300"},
                ],
            }),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["data"]["buyer_name"], "شركة النيل")
        self.assertEqual(res.json()["data"]["destination"], "بورسعيد")
        self.assertEqual(len(res.json()["data"]["items"]), 1)
        self.assertEqual(ScaleEntryExitPermitItem.objects.filter(permit_id=created["id"]).count(), 1)

    def test_delete_permit(self):
        created = self._create_entry().json()["data"]
        res = self.client.delete(f"/api/scale/entry-exit-permits/{created['id']}/")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(ScaleEntryExitPermit.objects.filter(pk=created["id"]).exists())

    def test_permit_requires_scale_access(self):
        self.client.logout()
        res = self._create_entry()
        self.assertEqual(res.status_code, 401)


class ScaleDraftQuotationLinkageTestCase(TestCase):
    """Phase 1: ScaleDraft to PurchaseQuotationDraft non-invasive database relationship and constraints."""

    def setUp(self):
        self.quotation = PurchaseQuotationDraft.objects.create(
            vehicle_number="ق هـ ر 1234",
            vendor_card_code="V1001",
            vendor_name="شركة الدلتا للتوريدات",
            status=PurchaseQuotationDraft.APPROVED_FOR_POSTING,
        )

    def test_create_scale_draft_without_quotation(self):
        """Backward compatibility: scale draft can be created without any quotation reference."""
        draft = ScaleDraft.objects.create(
            item_code="ITEM-001",
            vendor_card_code="V1001",
            status=ScaleDraft.STATUS_FIRST_WEIGHT,
        )
        self.assertIsNone(draft.quotation)
        self.assertEqual(draft.quotation_line_index, 0)

    def test_multiple_scale_drafts_without_quotation_coexist(self):
        """Drafts without quotation (null) must not trigger unique constraint conflicts."""
        d1 = ScaleDraft.objects.create(item_code="ITEM-001", status=ScaleDraft.STATUS_FIRST_WEIGHT)
        d2 = ScaleDraft.objects.create(item_code="ITEM-002", status=ScaleDraft.STATUS_FIRST_WEIGHT)
        self.assertIsNone(d1.quotation)
        self.assertIsNone(d2.quotation)
        self.assertNotEqual(d1.pk, d2.pk)

    def test_create_scale_draft_with_quotation_link(self):
        """ScaleDraft links cleanly to PurchaseQuotationDraft with optional line index."""
        draft = ScaleDraft.objects.create(
            item_code="ITEM-001",
            vendor_card_code=self.quotation.vendor_card_code,
            quotation=self.quotation,
            quotation_line_index=1,
            status=ScaleDraft.STATUS_FIRST_WEIGHT,
        )
        self.assertEqual(draft.quotation, self.quotation)
        self.assertEqual(draft.quotation_line_index, 1)
        self.assertIn(draft, self.quotation.scale_drafts.all())

    def test_duplicate_active_scale_draft_on_same_quotation_rejected(self):
        """Unique constraint prevents two simultaneous active scale drafts on the same quotation."""
        ScaleDraft.objects.create(
            item_code="ITEM-001",
            quotation=self.quotation,
            status=ScaleDraft.STATUS_FIRST_WEIGHT,
        )
        with self.assertRaises(IntegrityError):
            ScaleDraft.objects.create(
                item_code="ITEM-002",
                quotation=self.quotation,
                status=ScaleDraft.STATUS_FIRST_WEIGHT,
            )

    def test_second_weight_pending_also_counts_as_active(self):
        """SECOND_WEIGHT_PENDING is active and prevents another draft on same quotation."""
        ScaleDraft.objects.create(
            item_code="ITEM-001",
            quotation=self.quotation,
            status=ScaleDraft.STATUS_SECOND_WEIGHT_PENDING,
        )
        with self.assertRaises(IntegrityError):
            ScaleDraft.objects.create(
                item_code="ITEM-002",
                quotation=self.quotation,
                status=ScaleDraft.STATUS_FIRST_WEIGHT,
            )

    def test_completed_or_cancelled_draft_allows_new_or_coexisting_reference(self):
        """Completed or cancelled drafts no longer violate the active-only constraint."""
        completed_draft = ScaleDraft.objects.create(
            item_code="ITEM-001",
            quotation=self.quotation,
            status=ScaleDraft.STATUS_COMPLETED,
        )
        # Another active draft on the same quotation should succeed
        active_draft = ScaleDraft.objects.create(
            item_code="ITEM-002",
            quotation=self.quotation,
            status=ScaleDraft.STATUS_FIRST_WEIGHT,
        )
        self.assertNotEqual(completed_draft.pk, active_draft.pk)
        self.assertEqual(self.quotation.scale_drafts.count(), 2)

    def test_quotation_deletion_sets_null_on_scale_draft(self):
        """Deleting quotation sets quotation FK to null on scale draft (on_delete=SET_NULL)."""
        draft = ScaleDraft.objects.create(
            item_code="ITEM-001",
            quotation=self.quotation,
            status=ScaleDraft.STATUS_COMPLETED,
        )
        self.quotation.delete()
        draft.refresh_from_db()
        self.assertIsNone(draft.quotation)


class AvailablePurchaseQuotationsAPITestCase(TestCase):
    """Phase 2: Tests for GET /api/scale/available-quotations/ endpoint."""

    def setUp(self):
        self.scale_user = User.objects.create_user(username="scale_op_user", password="password123")
        self.scale_user.userprofile.role = "scale_operator"
        self.scale_user.userprofile.save()
        self.client.force_login(self.scale_user)

        self.eligible_quotation = PurchaseQuotationDraft.objects.create(
            status=PurchaseQuotationDraft.POSTED,
            sap_doc_entry="5001",
            sap_doc_num="10001",
            vehicle_number="TRK-888",
            vendor_card_code="21120525",
            vendor_name="مزرعة الوادي",
            container_quantity=150,
            lines=[
                {
                    "item_code": "27110000",
                    "item_description": "طماطم كيلو",
                    "quoted_qty": 20000.0,
                    "uom_code": "KG",
                    "warehouse_code": "01",
                    "container_quantity": 150,
                }
            ],
        )

    def test_posted_eligible_quotation_appears_without_filters(self):
        res = self.client.get("/api/scale/available-quotations/")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        quotations = data["data"]
        self.assertEqual(len(quotations), 1)
        q = quotations[0]
        self.assertEqual(q["id"], self.eligible_quotation.id)
        self.assertEqual(q["quotation_number"], "10001")
        self.assertEqual(q["sap_doc_entry"], "5001")
        self.assertEqual(q["vehicle_number"], "TRK-888")
        self.assertEqual(q["vendor_card_code"], "21120525")
        self.assertEqual(q["vendor_name"], "مزرعة الوادي")
        self.assertEqual(q["quoted_quantity"], 20000.0)
        self.assertEqual(q["container_quantity"], 150)
        self.assertEqual(q["warehouse_code"], "01")
        self.assertEqual(len(q["lines"]), 1)
        self.assertEqual(q["lines"][0]["item_code"], "27110000")
        self.assertEqual(q["lines"][0]["line_index"], 0)

    def test_non_posted_quotation_does_not_appear(self):
        for status in [
            PurchaseQuotationDraft.DRAFT,
            PurchaseQuotationDraft.PENDING_REVIEW,
            PurchaseQuotationDraft.APPROVED_FOR_POSTING,
            PurchaseQuotationDraft.POSTING_FAILED,
            PurchaseQuotationDraft.CANCELLED,
        ]:
            PurchaseQuotationDraft.objects.create(
                status=status,
                sap_doc_entry="5002",
                vehicle_number=f"TRK-{status}",
                vendor_card_code="V999",
            )
        res = self.client.get("/api/scale/available-quotations/")
        data = res.json()["data"]
        ids = [item["id"] for item in data]
        self.assertIn(self.eligible_quotation.id, ids)
        self.assertEqual(len(data), 1)

    def test_quotation_without_sap_doc_entry_does_not_appear(self):
        # Empty string sap_doc_entry
        PurchaseQuotationDraft.objects.create(
            status=PurchaseQuotationDraft.POSTED,
            sap_doc_entry="",
            vehicle_number="TRK-NO-ENTRY",
            vendor_card_code="V999",
        )
        res = self.client.get("/api/scale/available-quotations/")
        data = res.json()["data"]
        vehicle_numbers = [item["vehicle_number"] for item in data]
        self.assertNotIn("TRK-NO-ENTRY", vehicle_numbers)

    def test_vehicle_filter_works(self):
        PurchaseQuotationDraft.objects.create(
            status=PurchaseQuotationDraft.POSTED,
            sap_doc_entry="5002",
            vehicle_number="TRK-999",
            vendor_card_code="V123",
        )
        res = self.client.get("/api/scale/available-quotations/?vehicle=TRK-888")
        data = res.json()["data"]
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["vehicle_number"], "TRK-888")

        res2 = self.client.get("/api/scale/available-quotations/?vehicle=trk-999")
        data2 = res2.json()["data"]
        self.assertEqual(len(data2), 1)
        self.assertEqual(data2[0]["vehicle_number"], "TRK-999")

    def test_vendor_farm_filter_works(self):
        PurchaseQuotationDraft.objects.create(
            status=PurchaseQuotationDraft.POSTED,
            sap_doc_entry="5002",
            vehicle_number="TRK-999",
            vendor_card_code="333444",
        )
        res = self.client.get("/api/scale/available-quotations/?vendor_card_code=21120525")
        data = res.json()["data"]
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["vendor_card_code"], "21120525")

        res2 = self.client.get("/api/scale/available-quotations/?vendor_card_code=333444")
        data2 = res2.json()["data"]
        self.assertEqual(len(data2), 1)
        self.assertEqual(data2[0]["vendor_card_code"], "333444")

    def test_both_vehicle_and_vendor_filters_require_both_conditions(self):
        # Matching vehicle, non-matching vendor
        res = self.client.get("/api/scale/available-quotations/?vehicle=TRK-888&vendor_card_code=999999")
        data = res.json()["data"]
        self.assertEqual(len(data), 0)

        # Non-matching vehicle, matching vendor
        res2 = self.client.get("/api/scale/available-quotations/?vehicle=NO-SUCH-VEHICLE&vendor_card_code=21120525")
        data2 = res2.json()["data"]
        self.assertEqual(len(data2), 0)

        # Both match
        res3 = self.client.get("/api/scale/available-quotations/?vehicle=TRK-888&vendor_card_code=21120525")
        data3 = res3.json()["data"]
        self.assertEqual(len(data3), 1)
        self.assertEqual(data3[0]["id"], self.eligible_quotation.id)

    def test_quotation_linked_to_first_weight_scale_draft_does_not_appear(self):
        ScaleDraft.objects.create(
            item_code="27110000",
            quotation=self.eligible_quotation,
            status=ScaleDraft.STATUS_FIRST_WEIGHT,
        )
        res = self.client.get("/api/scale/available-quotations/")
        data = res.json()["data"]
        ids = [item["id"] for item in data]
        self.assertNotIn(self.eligible_quotation.id, ids)

    def test_quotation_linked_to_second_weight_pending_does_not_appear(self):
        ScaleDraft.objects.create(
            item_code="27110000",
            quotation=self.eligible_quotation,
            status=ScaleDraft.STATUS_SECOND_WEIGHT_PENDING,
        )
        res = self.client.get("/api/scale/available-quotations/")
        data = res.json()["data"]
        ids = [item["id"] for item in data]
        self.assertNotIn(self.eligible_quotation.id, ids)

    def test_quotation_linked_only_to_completed_scale_draft_can_appear(self):
        ScaleDraft.objects.create(
            item_code="27110000",
            quotation=self.eligible_quotation,
            status=ScaleDraft.STATUS_COMPLETED,
        )
        res = self.client.get("/api/scale/available-quotations/")
        data = res.json()["data"]
        ids = [item["id"] for item in data]
        self.assertIn(self.eligible_quotation.id, ids)

    def test_quotation_linked_to_scale_draft_with_posted_grpo_does_not_appear(self):
        draft = ScaleDraft.objects.create(
            item_code="27110000",
            quotation=self.eligible_quotation,
            status=ScaleDraft.STATUS_COMPLETED,
        )
        PurchaseGRPODraft.objects.create(
            scale_draft=draft,
            status=PurchaseGRPODraft.POSTED,
            vendor_card_code="21120525",
            item_code="27110000",
        )
        res = self.client.get("/api/scale/available-quotations/")
        data = res.json()["data"]
        ids = [item["id"] for item in data]
        self.assertNotIn(self.eligible_quotation.id, ids)

    def test_quotation_linked_to_scale_draft_with_active_grpo_does_not_appear(self):
        draft = ScaleDraft.objects.create(
            item_code="27110000",
            quotation=self.eligible_quotation,
            status=ScaleDraft.STATUS_COMPLETED,
        )
        PurchaseGRPODraft.objects.create(
            scale_draft=draft,
            status=PurchaseGRPODraft.DRAFT,
            vendor_card_code="21120525",
            item_code="27110000",
        )
        res = self.client.get("/api/scale/available-quotations/")
        data = res.json()["data"]
        ids = [item["id"] for item in data]
        self.assertNotIn(self.eligible_quotation.id, ids)

    def test_multiple_eligible_quotations_can_be_returned(self):
        PurchaseQuotationDraft.objects.create(
            status=PurchaseQuotationDraft.POSTED,
            sap_doc_entry="5002",
            vehicle_number="TRK-777",
            vendor_card_code="V777",
        )
        PurchaseQuotationDraft.objects.create(
            status=PurchaseQuotationDraft.POSTED,
            sap_doc_entry="5003",
            vehicle_number="TRK-666",
            vendor_card_code="V666",
        )
        res = self.client.get("/api/scale/available-quotations/")
        data = res.json()["data"]
        self.assertEqual(len(data), 3)

    def test_empty_filters_do_not_accidentally_filter_everything(self):
        res = self.client.get("/api/scale/available-quotations/?vehicle=&vendor_card_code=")
        data = res.json()["data"]
        self.assertEqual(len(data), 1)

        res2 = self.client.get("/api/scale/available-quotations/?vehicle=%20%20&vendor_card_code=%20")
        data2 = res2.json()["data"]
        self.assertEqual(len(data2), 1)

    def test_authentication_and_permissions(self):
        self.client.logout()
        res = self.client.get("/api/scale/available-quotations/")
        self.assertEqual(res.status_code, 401)

        unauth_user = User.objects.create_user(username="random_user", password="password123")
        self.client.force_login(unauth_user)
        res2 = self.client.get("/api/scale/available-quotations/")
        self.assertEqual(res2.status_code, 403)


class FirstWeightQuotationMatchingAPITestCase(TestCase):
    """Phase 3: Tests for matching Purchase Quotation in POST /api/scale/drafts/first-weight/"""

    def setUp(self):
        self.scale_user = User.objects.create_user(username="scale_operator_match", password="password123")
        self.scale_user.userprofile.role = "scale_operator"
        self.scale_user.userprofile.save()
        self.client.force_login(self.scale_user)

        self.device = ScaleDevice.objects.create(
            device_id="SCALE-MATCH-01",
            device_name="Scale Match Test",
            device_type="virtual",
        )

        self.single_line_quotation = PurchaseQuotationDraft.objects.create(
            status=PurchaseQuotationDraft.POSTED,
            sap_doc_entry="8001",
            sap_doc_num="20001",
            vehicle_number="TRK-100",
            vendor_card_code="V100",
            vendor_name="مزرعة الهدى",
            lines=[
                {
                    "item_code": "27110000",
                    "item_description": "طماطم",
                    "quoted_qty": 15000.0,
                    "uom_code": "KG",
                    "warehouse_code": "01",
                }
            ],
        )

        self.multi_line_quotation = PurchaseQuotationDraft.objects.create(
            status=PurchaseQuotationDraft.POSTED,
            sap_doc_entry="8002",
            sap_doc_num="20002",
            vehicle_number="TRK-200",
            vendor_card_code="V200",
            vendor_name="مزرعة الصفا",
            lines=[
                {
                    "item_code": "27110000",
                    "item_description": "طماطم",
                    "quoted_qty": 10000.0,
                    "uom_code": "KG",
                    "warehouse_code": "01",
                },
                {
                    "item_code": "27120000",
                    "item_description": "خيار",
                    "quoted_qty": 5000.0,
                    "uom_code": "KG",
                    "warehouse_code": "02",
                },
            ],
        )

    def _first_weight_payload(self, **overrides):
        payload = {
            "weight": "25000.00",
            "start_type": "loaded",
            "direct_vehicle_number": "TRK-100",
            "direct_driver_name": "أحمد محمود",
            "scale_device_id": self.device.id,
            "vendor_card_code": "V100",
            "vendor_name": "مزرعة الهدى",
            "item_code": "27110000",
            "item_name": "طماطم",
        }
        payload.update(overrides)
        return payload

    def test_valid_posted_quotation_matched_successfully(self):
        payload = self._first_weight_payload(
            quotation_id=self.single_line_quotation.id,
            quotation_line_index=0,
        )
        res = self.client.post("/api/scale/drafts/first-weight/", data=json.dumps(payload), content_type="application/json")
        self.assertEqual(res.status_code, 201, res.content)
        data = res.json()["data"]
        self.assertEqual(data["quotation"], self.single_line_quotation.id)
        self.assertEqual(data["quotation_line_index"], 0)

        # Verify DB
        draft = ScaleDraft.objects.get(id=data["id"])
        self.assertEqual(draft.quotation, self.single_line_quotation)
        self.assertEqual(draft.quotation_line_index, 0)
        self.assertEqual(draft.status, ScaleDraft.STATUS_SECOND_WEIGHT_PENDING)

    def test_non_posted_quotation_rejected(self):
        draft_pqt = PurchaseQuotationDraft.objects.create(
            status=PurchaseQuotationDraft.DRAFT,
            sap_doc_entry="8003",
            vehicle_number="TRK-300",
        )
        payload = self._first_weight_payload(quotation_id=draft_pqt.id)
        res = self.client.post("/api/scale/drafts/first-weight/", data=json.dumps(payload), content_type="application/json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("POSTED", res.json()["error"])

    def test_quotation_without_sap_doc_entry_rejected(self):
        unposted_pqt = PurchaseQuotationDraft.objects.create(
            status=PurchaseQuotationDraft.POSTED,
            sap_doc_entry="",
            vehicle_number="TRK-400",
        )
        payload = self._first_weight_payload(quotation_id=unposted_pqt.id)
        res = self.client.post("/api/scale/drafts/first-weight/", data=json.dumps(payload), content_type="application/json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("SAP document reference", res.json()["error"])

    def test_already_active_quotation_cannot_be_matched(self):
        # Create an existing active scale draft
        ScaleDraft.objects.create(
            item_code="27110000",
            quotation=self.single_line_quotation,
            status=ScaleDraft.STATUS_SECOND_WEIGHT_PENDING,
        )
        payload = self._first_weight_payload(quotation_id=self.single_line_quotation.id)
        res = self.client.post("/api/scale/drafts/first-weight/", data=json.dumps(payload), content_type="application/json")
        self.assertEqual(res.status_code, 409)
        self.assertIn("already linked to an active weighing", res.json()["error"])

    def test_invalid_quotation_id_rejected(self):
        payload = self._first_weight_payload(quotation_id=999999)
        res = self.client.post("/api/scale/drafts/first-weight/", data=json.dumps(payload), content_type="application/json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("not found", res.json()["error"])

    def test_invalid_quotation_line_index_negative_rejected(self):
        payload = self._first_weight_payload(
            quotation_id=self.single_line_quotation.id,
            quotation_line_index=-1,
        )
        res = self.client.post("/api/scale/drafts/first-weight/", data=json.dumps(payload), content_type="application/json")
        self.assertEqual(res.status_code, 400)

    def test_invalid_quotation_line_index_out_of_range_rejected(self):
        payload = self._first_weight_payload(
            quotation_id=self.single_line_quotation.id,
            quotation_line_index=5,
        )
        res = self.client.post("/api/scale/drafts/first-weight/", data=json.dumps(payload), content_type="application/json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("out of range", res.json()["error"])

    def test_single_line_quotation_stores_line_index_zero(self):
        payload = self._first_weight_payload(
            quotation_id=self.single_line_quotation.id,
        )
        res = self.client.post("/api/scale/drafts/first-weight/", data=json.dumps(payload), content_type="application/json")
        self.assertEqual(res.status_code, 201)
        draft = ScaleDraft.objects.get(id=res.json()["data"]["id"])
        self.assertEqual(draft.quotation_line_index, 0)

    def test_multi_line_quotation_stores_selected_line_index(self):
        payload = self._first_weight_payload(
            quotation_id=self.multi_line_quotation.id,
            quotation_line_index=1,
        )
        res = self.client.post("/api/scale/drafts/first-weight/", data=json.dumps(payload), content_type="application/json")
        self.assertEqual(res.status_code, 201)
        draft = ScaleDraft.objects.get(id=res.json()["data"]["id"])
        self.assertEqual(draft.quotation, self.multi_line_quotation)
        self.assertEqual(draft.quotation_line_index, 1)

    def test_existing_first_weight_without_quotation_still_works(self):
        payload = self._first_weight_payload()
        res = self.client.post("/api/scale/drafts/first-weight/", data=json.dumps(payload), content_type="application/json")
        self.assertEqual(res.status_code, 201)
        draft = ScaleDraft.objects.get(id=res.json()["data"]["id"])
        self.assertIsNone(draft.quotation)
        self.assertEqual(draft.quotation_line_index, 0)
        self.assertEqual(draft.effective_vehicle_number, "TRK-100")

    def test_existing_manual_direct_scaledraft_behavior_unchanged(self):
        payload = self._first_weight_payload(
            is_direct_entry=True,
            direct_vehicle_number="DIR-999",
            direct_driver_name="سائق مباشر",
        )
        res = self.client.post("/api/scale/drafts/first-weight/", data=json.dumps(payload), content_type="application/json")
        self.assertEqual(res.status_code, 201)
        draft = ScaleDraft.objects.get(id=res.json()["data"]["id"])
        self.assertTrue(draft.is_direct_entry)
        self.assertEqual(draft.direct_vehicle_number, "DIR-999")
        self.assertIsNone(draft.quotation)

    def test_concurrent_duplicate_matching_rejected_safely(self):
        # First match succeeds
        payload1 = self._first_weight_payload(quotation_id=self.single_line_quotation.id)
        res1 = self.client.post("/api/scale/drafts/first-weight/", data=json.dumps(payload1), content_type="application/json")
        self.assertEqual(res1.status_code, 201)

        # Second match with same quotation receives 409 Conflict
        payload2 = self._first_weight_payload(quotation_id=self.single_line_quotation.id)
        res2 = self.client.post("/api/scale/drafts/first-weight/", data=json.dumps(payload2), content_type="application/json")
        self.assertEqual(res2.status_code, 409)
        self.assertIn("already linked to an active weighing", res2.json()["error"])


class WeighingCycleQuotationPreservationTestCase(TestCase):
    """
    Phase 4: Verify that a matched Purchase Quotation relationship survives the
    COMPLETE weighing lifecycle:
    First Weight -> Second Weight -> Net Weight Calculation -> Completed Scale Ticket.
    """

    def setUp(self):
        self.user = User.objects.create_user(
            username="scale_operator_p4",
            password="testpassword",
            email="scale_p4@example.com",
        )
        self.user.userprofile.role = "scale_operator"
        self.user.userprofile.save()
        self.client.force_login(self.user)
        self.device = ScaleDevice.objects.create(
            device_id="virtual_scale_p4",
            device_name="Virtual Scale P4",
            device_type="virtual",
            is_active=True,
        )
        self.vehicle = ScaleVehicle.objects.create(
            vehicle_number="TRK-900",
            driver_name="أحمد حسن",
        )
        self.single_line_quotation = PurchaseQuotationDraft.objects.create(
            status=PurchaseQuotationDraft.POSTED,
            sap_doc_entry="9001",
            sap_doc_num="19001",
            vendor_card_code="V900",
            vendor_name="مزرعة التميز",
            vehicle_number="TRK-900",
            lines=[
                {
                    "item_code": "ITEM-A",
                    "item_name": "برتقال بلدي",
                    "quantity": 10000,
                    "unit_price": 12.5,
                }
            ],
        )
        self.multi_line_quotation = PurchaseQuotationDraft.objects.create(
            status=PurchaseQuotationDraft.POSTED,
            sap_doc_entry="9002",
            sap_doc_num="19002",
            vendor_card_code="V902",
            vendor_name="مزارع الوادي",
            vehicle_number="TRK-902",
            lines=[
                {"item_code": "ITEM-0", "item_name": "ليمون أضاليا", "quantity": 3000},
                {"item_code": "ITEM-1", "item_name": "يوسفي موريت", "quantity": 4000},
                {"item_code": "ITEM-2", "item_name": "برتقال سكري", "quantity": 5000},
            ],
        )
        self.tare_element = ScaleItemElement.objects.create(
            item_code="ITEM-A",
            name="صندوق بلاستيك كبير",
            weight=Decimal("2.50"),
            is_active=True,
        )

    def test_complete_weighing_cycle_preserves_quotation_link(self):
        # Step 1: First Weight (Loaded: 15,000 KG)
        first_payload = {
            "start_type": "loaded",
            "vehicle_id": self.vehicle.id,
            "weight": 15000,
            "scale_device_id": self.device.id,
            "vendor_card_code": "V900",
            "vendor_name": "مزرعة التميز",
            "item_code": "ITEM-A",
            "item_name": "برتقال بلدي",
            "quotation_id": self.single_line_quotation.id,
            "quotation_line_index": 0,
            "allocations": [
                {
                    "vendor_card_code": "V900",
                    "vendor_name": "مزرعة التميز",
                    "item_code": "ITEM-A",
                    "item_name": "برتقال بلدي",
                }
            ],
        }
        res1 = self.client.post("/api/scale/drafts/first-weight/", data=json.dumps(first_payload), content_type="application/json")
        self.assertEqual(res1.status_code, 201)
        draft_id = res1.json()["data"]["id"]

        draft = ScaleDraft.objects.get(id=draft_id)
        self.assertEqual(draft.status, ScaleDraft.STATUS_SECOND_WEIGHT_PENDING)
        self.assertEqual(draft.quotation, self.single_line_quotation)
        self.assertEqual(draft.quotation_line_index, 0)
        self.assertEqual(draft.weight_loaded, Decimal("15000"))

        # Step 2: Second Weight (Empty: 5,000 KG)
        second_payload = {
            "weight": 5000,
            "scale_device_id": self.device.id,
        }
        res2 = self.client.post(f"/api/scale/drafts/{draft_id}/second-weight/", data=json.dumps(second_payload), content_type="application/json")
        self.assertEqual(res2.status_code, 200)

        # Step 3: Verify completed Scale Draft state
        draft.refresh_from_db()
        self.assertEqual(draft.status, ScaleDraft.STATUS_COMPLETED)
        self.assertTrue(draft.is_closed)
        self.assertTrue(draft.is_certified_locked)
        self.assertEqual(draft.weight_loaded, Decimal("15000"))
        self.assertEqual(draft.weight_empty, Decimal("5000"))
        self.assertEqual(draft.product_weight, Decimal("10000"))

        # Crucial Phase 4 Verification: Quotation linkage remains strictly intact
        self.assertEqual(draft.quotation, self.single_line_quotation)
        self.assertEqual(draft.quotation_line_index, 0)

        # Quotation row itself is completely unmodified
        self.single_line_quotation.refresh_from_db()
        self.assertEqual(self.single_line_quotation.status, PurchaseQuotationDraft.POSTED)
        self.assertEqual(self.single_line_quotation.sap_doc_entry, "9001")

    def test_multi_line_quotation_preserves_selected_line_index_through_cycle(self):
        # Step 1: First Weight selecting line_index=2
        first_payload = {
            "start_type": "loaded",
            "vehicle_id": self.vehicle.id,
            "weight": 18000,
            "scale_device_id": self.device.id,
            "vendor_card_code": "V902",
            "vendor_name": "مزارع الوادي",
            "item_code": "ITEM-2",
            "item_name": "برتقال سكري",
            "quotation_id": self.multi_line_quotation.id,
            "quotation_line_index": 2,
            "allocations": [
                {
                    "vendor_card_code": "V902",
                    "vendor_name": "مزارع الوادي",
                    "item_code": "ITEM-2",
                    "item_name": "برتقال سكري",
                }
            ],
        }
        res1 = self.client.post("/api/scale/drafts/first-weight/", data=json.dumps(first_payload), content_type="application/json")
        self.assertEqual(res1.status_code, 201)
        draft_id = res1.json()["data"]["id"]

        # Step 2: Complete Second Weight
        second_payload = {
            "weight": 6000,
            "scale_device_id": self.device.id,
        }
        res2 = self.client.post(f"/api/scale/drafts/{draft_id}/second-weight/", data=json.dumps(second_payload), content_type="application/json")
        self.assertEqual(res2.status_code, 200)

        draft = ScaleDraft.objects.get(id=draft_id)
        self.assertEqual(draft.status, ScaleDraft.STATUS_COMPLETED)
        self.assertEqual(draft.product_weight, Decimal("12000"))
        # Line index 2 must NOT reset to 0
        self.assertEqual(draft.quotation, self.multi_line_quotation)
        self.assertEqual(draft.quotation_line_index, 2)

    def test_tare_elements_and_net_weight_calculation_unaffected(self):
        # First Weight with Tare Elements deduction (40 boxes * 2.5 KG = 100 KG)
        first_payload = {
            "start_type": "loaded",
            "vehicle_id": self.vehicle.id,
            "weight": 15000,
            "scale_device_id": self.device.id,
            "vendor_card_code": "V900",
            "vendor_name": "مزرعة التميز",
            "item_code": "ITEM-A",
            "item_name": "برتقال بلدي",
            "quotation_id": self.single_line_quotation.id,
            "quotation_line_index": 0,
            "elements": [
                {
                    "item_element_id": self.tare_element.id,
                    "count": 40,
                    "action": "remove",
                }
            ],
            "allocations": [
                {
                    "vendor_card_code": "V900",
                    "vendor_name": "مزرعة التميز",
                    "item_code": "ITEM-A",
                    "item_name": "برتقال بلدي",
                }
            ],
        }
        res1 = self.client.post("/api/scale/drafts/first-weight/", data=json.dumps(first_payload), content_type="application/json")
        self.assertEqual(res1.status_code, 201)
        draft_id = res1.json()["data"]["id"]

        draft = ScaleDraft.objects.get(id=draft_id)
        # Gross = 15,000, tare elements deduction = 100, Net loaded = 14,900
        self.assertEqual(draft.net_weight_loaded, Decimal("14900"))

        # Second Weight (Empty: 5,000 KG)
        second_payload = {
            "weight": 5000,
            "scale_device_id": self.device.id,
        }
        res2 = self.client.post(f"/api/scale/drafts/{draft_id}/second-weight/", data=json.dumps(second_payload), content_type="application/json")
        self.assertEqual(res2.status_code, 200)

        draft.refresh_from_db()
        self.assertEqual(draft.status, ScaleDraft.STATUS_COMPLETED)
        # Product weight = 14,900 - 5,000 = 9,900
        self.assertEqual(draft.product_weight, Decimal("9900"))
        self.assertEqual(draft.quotation, self.single_line_quotation)

    def test_completed_draft_api_and_serializers_include_quotation_fields(self):
        # Create and complete draft
        draft = ScaleDraft.objects.create(
            vehicle=self.vehicle,
            start_type="loaded",
            quotation=self.single_line_quotation,
            quotation_line_index=0,
            weight_loaded=Decimal("15000"),
            net_weight_loaded=Decimal("15000"),
            weight_empty=Decimal("5000"),
            net_weight_empty=Decimal("5000"),
            product_weight=Decimal("10000"),
            status=ScaleDraft.STATUS_COMPLETED,
            is_closed=True,
            is_certified_locked=True,
        )

        # Test Detail API (ScaleDraftDetailSerializer)
        res_detail = self.client.get(f"/api/scale/drafts/{draft.id}/")
        self.assertEqual(res_detail.status_code, 200)
        data = res_detail.json()["data"]
        self.assertEqual(data["quotation"], self.single_line_quotation.id)
        self.assertEqual(data["quotation_number"], "19001")
        self.assertEqual(data["quotation_sap_doc_entry"], "9001")
        self.assertEqual(data["quotation_line_index"], 0)
        self.assertEqual(data["status"], "COMPLETED")
        self.assertEqual(Decimal(str(data["product_weight"])), Decimal("10000"))

        # Test List API (ScaleDraftListSerializer)
        res_list = self.client.get("/api/scale/drafts/")
        self.assertEqual(res_list.status_code, 200)
        results = res_list.json()["data"]
        matching = next((item for item in results if item["id"] == draft.id), None)
        self.assertIsNotNone(matching)
        self.assertEqual(matching["quotation"], self.single_line_quotation.id)
        self.assertEqual(matching["quotation_number"], "19001")
        self.assertEqual(matching["quotation_sap_doc_entry"], "9001")
        self.assertEqual(matching["quotation_line_index"], 0)

    def test_normal_cycle_without_quotation_unaffected(self):
        # Standard manual weighing without quotation
        first_payload = {
            "start_type": "loaded",
            "vehicle_id": self.vehicle.id,
            "weight": 14000,
            "scale_device_id": self.device.id,
            "vendor_name": "مورد عام",
            "item_name": "بطاطس تصدير",
            "allocations": [{"vendor_name": "مورد عام", "item_name": "بطاطس تصدير"}],
        }
        res1 = self.client.post("/api/scale/drafts/first-weight/", data=json.dumps(first_payload), content_type="application/json")
        self.assertEqual(res1.status_code, 201)
        draft_id = res1.json()["data"]["id"]

        second_payload = {"weight": 4000, "scale_device_id": self.device.id}
        res2 = self.client.post(f"/api/scale/drafts/{draft_id}/second-weight/", data=json.dumps(second_payload), content_type="application/json")
        self.assertEqual(res2.status_code, 200)

        draft = ScaleDraft.objects.get(id=draft_id)
        self.assertEqual(draft.status, ScaleDraft.STATUS_COMPLETED)
        self.assertIsNone(draft.quotation)
        self.assertEqual(draft.product_weight, Decimal("10000"))

        # Detail API returns null for quotation fields
        res_detail = self.client.get(f"/api/scale/drafts/{draft_id}/")
        data = res_detail.json()["data"]
        self.assertIsNone(data["quotation"])
        self.assertIsNone(data["quotation_number"])
        self.assertIsNone(data["quotation_sap_doc_entry"])

    def test_empty_first_cycle_without_quotation_unaffected(self):
        # Empty-first cycle (start_type="empty")
        first_payload = {
            "start_type": "empty",
            "vehicle_id": self.vehicle.id,
            "weight": 4500,
            "scale_device_id": self.device.id,
        }
        res1 = self.client.post("/api/scale/drafts/first-weight/", data=json.dumps(first_payload), content_type="application/json")
        self.assertEqual(res1.status_code, 201)
        draft_id = res1.json()["data"]["id"]

        draft = ScaleDraft.objects.get(id=draft_id)
        self.assertEqual(draft.start_type, "empty")
        self.assertIsNone(draft.quotation)

        # Second Weight (Loaded: 16,500 KG)
        second_payload = {
            "weight": 16500,
            "scale_device_id": self.device.id,
            "allocations": [{"vendor_name": "مزرعة", "item_name": "عنب"}],
        }
        res2 = self.client.post(f"/api/scale/drafts/{draft_id}/second-weight/", data=json.dumps(second_payload), content_type="application/json")
        self.assertEqual(res2.status_code, 200)

        draft.refresh_from_db()
        self.assertEqual(draft.status, ScaleDraft.STATUS_COMPLETED)
        self.assertEqual(draft.product_weight, Decimal("12000"))
        self.assertIsNone(draft.quotation)




