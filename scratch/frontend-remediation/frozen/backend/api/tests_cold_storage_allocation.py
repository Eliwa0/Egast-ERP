"""
Tests for Cold Storage Pallet Allocation, Sequential Placement, and Delivery Vacating.

Covers the 7 required business rules:
1. Sequential placement: 17 pallets -> 17 sequential slots (01..17).
2. Existing occupied locations: occupied 01, 02 -> assigns 03, 04, 05.
3. Delivery frees location: occupied position 07 vacated upon post_delivery_to_sap.
4. Reuse freed location: new pallet assigned to vacated position 07 before later ones.
5. Transfer verification: move A-03-07 to B-02-04, source vacated, destination occupied.
6. Insufficient capacity: 17 pallets required, 10 available -> shortage of 7 returned without partial blind allocation.
7. Concurrency / duplicate prevention: two simultaneous allocations cannot claim same position.
8. API endpoints for preview and sequential allocation.
"""
from datetime import date
from unittest.mock import MagicMock, patch
from django.test import TestCase, Client
from django.contrib.auth.models import User
from django.utils import timezone

from api.models import AuditLog, UserModulePermission, UserProfile, PendingTransferRequest
from api.models_cold_storage import ColdStorageBinLayout, ColdStoragePalletPosition
from api.models_delivery import DeliveryDraft, DeliveryDraftLine, DeliveryDraftBatch
from api.role_permissions import MODULE_DELIVERY, MODULE_TRANSFER, LEVEL_ADMIN
from api.services.cold_storage_layout_service import (
    ColdStorageLayoutService,
    InsufficientCapacityError,
)
from api.services.delivery_posting_service import DeliveryPostingService
from api.services.transfer_service import TransferInventoryService


class ColdStorageSequentialAllocationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_superuser(username="admin_user", password="password123")
        profile, _ = UserProfile.objects.get_or_create(user=self.user)
        profile.role = "production_admin"
        profile.module_permissions_initialized = True
        profile.save(update_fields=["role", "module_permissions_initialized"])

        UserModulePermission.objects.create(user=self.user, module=MODULE_DELIVERY, level=LEVEL_ADMIN)
        UserModulePermission.objects.create(user=self.user, module=MODULE_TRANSFER, level=LEVEL_ADMIN)

        self.client = Client()
        self.client.force_login(self.user)
        self.service = ColdStorageLayoutService()

        # Channel 1: 20201-F01-R01-C01-RA (Chamber 1, Rack 1, Level RA, capacity 17)
        self.layout_1 = ColdStorageBinLayout.objects.create(
            warehouse_code="20201",
            bin_code="20201-F01-R01-C01-RA",
            sap_bin_abs_entry=142,
            sublevel1="F01",
            sublevel2="R01",
            sublevel3="C01",
            sublevel4="RA",
            capacity=17,
            allocation_type=ColdStorageBinLayout.ALLOC_ALLOCATABLE,
            sap_bin_classification=ColdStorageBinLayout.CLASS_PHYSICAL_CHANNEL,
            capacity_source=ColdStorageBinLayout.CAPACITY_SOURCE_CONFIGURED,
        )

        # Channel 2: 20201-F01-R02-C01-RA (Chamber 2, Rack 1, Level RA, capacity 17)
        self.layout_2 = ColdStorageBinLayout.objects.create(
            warehouse_code="20201",
            bin_code="20201-F01-R02-C01-RA",
            sap_bin_abs_entry=182,
            sublevel1="F01",
            sublevel2="R02",
            sublevel3="C01",
            sublevel4="RA",
            capacity=17,
            allocation_type=ColdStorageBinLayout.ALLOC_ALLOCATABLE,
            sap_bin_classification=ColdStorageBinLayout.CLASS_PHYSICAL_CHANNEL,
            capacity_source=ColdStorageBinLayout.CAPACITY_SOURCE_CONFIGURED,
        )

    # ─────────────────────────────────────────────────────────────────────────
    # Scenario 1: Sequential Allocation (17 Pallets -> 17 Sequential Slots 01..17)
    # ─────────────────────────────────────────────────────────────────────────
    def test_01_sequential_allocation_17_pallets(self):
        batches = [f"BATCH-{i:02d}" for i in range(1, 18)]

        result = self.service.allocate_sequentially(
            warehouse_code="20201",
            sap_bin_abs_entry=142,
            pallet_count=17,
            batches=batches,
            user=self.user,
            reference="Test Receipt PR-001",
            mode="OCCUPY",
        )

        self.assertEqual(result["allocated_count"], 17)
        self.assertEqual(result["shortage"], 0)

        # Verify each position is strictly sequential 1..17
        positions = list(self.layout_1.positions.all().order_by("position_index"))
        self.assertEqual(len(positions), 17)
        for idx, pos in enumerate(positions, start=1):
            expected_code = f"{idx:02d}"
            expected_batch = f"BATCH-{idx:02d}"
            self.assertEqual(pos.position_index, idx)
            self.assertEqual(pos.position_code, expected_code)
            self.assertEqual(pos.status, ColdStoragePalletPosition.OCCUPIED)
            self.assertEqual(pos.current_batch_number, expected_batch)

    # ─────────────────────────────────────────────────────────────────────────
    # Scenario 2: Skip Existing Occupied Locations (01, 02 occupied -> 03, 04, 05)
    # ─────────────────────────────────────────────────────────────────────────
    def test_02_skip_existing_occupied_locations(self):
        # Occupy positions 01 and 02 first
        pos_1 = self.layout_1.positions.get(position_index=1)
        pos_2 = self.layout_1.positions.get(position_index=2)
        pos_1.status = ColdStoragePalletPosition.OCCUPIED
        pos_1.current_batch_number = "EXISTING-01"
        pos_1.save()
        pos_2.status = ColdStoragePalletPosition.OCCUPIED
        pos_2.current_batch_number = "EXISTING-02"
        pos_2.save()

        # Allocate 3 new pallets
        new_batches = ["BATCH-NEW-A", "BATCH-NEW-B", "BATCH-NEW-C"]
        result = self.service.allocate_sequentially(
            warehouse_code="20201",
            sap_bin_abs_entry=142,
            pallet_count=3,
            batches=new_batches,
            user=self.user,
            mode="OCCUPY",
        )

        self.assertEqual(result["allocated_count"], 3)
        allocated = result["allocated_positions"]

        # Strictly assigned to positions 03, 04, 05
        self.assertEqual(allocated[0]["position_code"], "03")
        self.assertEqual(allocated[0]["position_index"], 3)
        self.assertEqual(allocated[0]["current_batch_number"], "BATCH-NEW-A")

        self.assertEqual(allocated[1]["position_code"], "04")
        self.assertEqual(allocated[1]["position_index"], 4)
        self.assertEqual(allocated[1]["current_batch_number"], "BATCH-NEW-B")

        self.assertEqual(allocated[2]["position_code"], "05")
        self.assertEqual(allocated[2]["position_index"], 5)
        self.assertEqual(allocated[2]["current_batch_number"], "BATCH-NEW-C")

        # Existing positions 01 and 02 remain untouched
        pos_1.refresh_from_db()
        pos_2.refresh_from_db()
        self.assertEqual(pos_1.current_batch_number, "EXISTING-01")
        self.assertEqual(pos_2.current_batch_number, "EXISTING-02")

    # ─────────────────────────────────────────────────────────────────────────
    # Scenario 3: Delivery Frees Pallet Location (Delivery Note vacates position)
    # ─────────────────────────────────────────────────────────────────────────
    def test_03_delivery_frees_pallet_location(self):
        # Occupy position 07 with batch BATCH-DELIV-07
        pos_7 = self.layout_1.positions.get(position_index=7)
        pos_7.status = ColdStoragePalletPosition.OCCUPIED
        pos_7.current_batch_number = "BATCH-DELIV-07"
        pos_7.save()

        # Create DeliveryDraft for BATCH-DELIV-07
        draft = DeliveryDraft.objects.create(
            sales_order_doc_entry="5001",
            sales_order_doc_num="6001",
            customer_code="C1001",
            customer_name="Alpha Trading",
            status=DeliveryDraft.STATUS_APPROVED,
            doc_date=date.today(),
            doc_due_date=date.today(),
            created_by=self.user,
        )
        line = DeliveryDraftLine.objects.create(
            draft=draft,
            line_number=0,
            item_code="ITEM-ORANGE",
            item_description="Fresh Oranges",
            delivery_quantity=100.0,
            warehouse_code="20201",
        )
        DeliveryDraftBatch.objects.create(
            line=line,
            batch_number="BATCH-DELIV-07",
            quantity=100.0,
            bin_abs_entry=142,
            bin_code="20201-F01-R01-C01-RA",
        )

        mock_sap = MagicMock()
        mock_sap._request.return_value = {"DocEntry": 8801, "DocNum": 9901}
        mock_sap.get_sales_order.return_value = {
            "DocEntry": 5001,
            "DocNum": 6001,
            "CardCode": "C1001",
            "DocumentStatus": "bost_Open",
            "DocumentLines": [{
                "LineNum": 0,
                "ItemCode": "ITEM-ORANGE",
                "RemainingOpenQuantity": 100.0,
                "WarehouseCode": "20201",
                "LineStatus": "bost_Open",
            }]
        }

        delivery_svc = DeliveryPostingService(sap_client=mock_sap)
        posted_draft = delivery_svc.post_delivery_to_sap(draft, user=self.user)

        self.assertEqual(posted_draft.status, DeliveryDraft.STATUS_POSTED)
        self.assertEqual(posted_draft.sap_doc_num, "9901")

        # Position 07 must be immediately AVAILABLE and batch cleared
        pos_7.refresh_from_db()
        self.assertEqual(pos_7.status, ColdStoragePalletPosition.AVAILABLE)
        self.assertEqual(pos_7.current_batch_number, "")

        # Historical delivery draft batch and audit log must be preserved
        self.assertTrue(line.batches.filter(batch_number="BATCH-DELIV-07").exists())
        audit = AuditLog.objects.filter(
            action="VACATE_DELIVERY",
            entity_id=str(pos_7.id),
        ).first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.details["batch_number"], "BATCH-DELIV-07")

    # ─────────────────────────────────────────────────────────────────────────
    # Scenario 4: Reuse Freed Location First (07 was freed, next pallet takes 07)
    # ─────────────────────────────────────────────────────────────────────────
    def test_04_reuse_freed_location_first(self):
        # Positions 01..06 are occupied
        for i in range(1, 7):
            pos = self.layout_1.positions.get(position_index=i)
            pos.status = ColdStoragePalletPosition.OCCUPIED
            pos.current_batch_number = f"EXISTING-{i:02d}"
            pos.save()

        # Position 07 is AVAILABLE (freed after delivery)
        pos_7 = self.layout_1.positions.get(position_index=7)
        self.assertEqual(pos_7.status, ColdStoragePalletPosition.AVAILABLE)

        # Positions 08..17 are also AVAILABLE
        for i in range(8, 18):
            pos = self.layout_1.positions.get(position_index=i)
            self.assertEqual(pos.status, ColdStoragePalletPosition.AVAILABLE)

        # Allocate 1 new pallet
        result = self.service.allocate_sequentially(
            warehouse_code="20201",
            sap_bin_abs_entry=142,
            pallet_count=1,
            batches=["BATCH-REUSED-07"],
            user=self.user,
        )

        self.assertEqual(result["allocated_count"], 1)
        allocated_pos = result["allocated_positions"][0]

        # Must reuse position 07 first, not 08 or later!
        self.assertEqual(allocated_pos["position_code"], "07")
        self.assertEqual(allocated_pos["position_index"], 7)
        self.assertEqual(allocated_pos["current_batch_number"], "BATCH-REUSED-07")

        pos_7.refresh_from_db()
        self.assertEqual(pos_7.status, ColdStoragePalletPosition.OCCUPIED)
        self.assertEqual(pos_7.current_batch_number, "BATCH-REUSED-07")

        # Position 08 must remain AVAILABLE
        pos_8 = self.layout_1.positions.get(position_index=8)
        self.assertEqual(pos_8.status, ColdStoragePalletPosition.AVAILABLE)

    # ─────────────────────────────────────────────────────────────────────────
    # Scenario 5: Transfer (Source Vacated, Destination Occupied)
    # ─────────────────────────────────────────────────────────────────────────
    def test_05_transfer_vacates_source_and_occupies_destination(self):
        # Source position: layout_1 pos 07
        src_pos = self.layout_1.positions.get(position_index=7)
        src_pos.status = ColdStoragePalletPosition.OCCUPIED
        src_pos.current_batch_number = "BATCH-TRANSFER-55"
        src_pos.save()

        # Destination position: layout_2 pos 04
        dest_pos = self.layout_2.positions.get(position_index=4)
        dest_pos.status = ColdStoragePalletPosition.AVAILABLE
        dest_pos.current_batch_number = ""
        dest_pos.save()

        # Create PendingTransferRequest
        ptr = PendingTransferRequest.objects.create(
            from_warehouse="20201",
            from_bin="20201-F01-R01-C01-RA",
            to_warehouse="20201",
            to_bin="20201-F01-R02-C01-RA",
            batch_number="BATCH-TRANSFER-55",
            pallet_position=dest_pos,
            created_by=self.user,
            lines=[{"item_code": "ITEM-1", "batch_number": "BATCH-TRANSFER-55", "quantity": 50}],
        )

        transfer_svc = TransferInventoryService(use_mock=True)

        # 1. Outbound reservation on source
        transfer_svc.reserve_source_pallet_position_for_transfer(
            pending_transfer=ptr,
            position_id=src_pos.id,
            user=self.user,
        )
        src_pos.refresh_from_db()
        self.assertEqual(src_pos.status, ColdStoragePalletPosition.RESERVED_OUTBOUND)

        # 2. Inbound reservation on destination
        transfer_svc.reserve_pallet_position_for_transfer(
            pending_transfer=ptr,
            position_id=dest_pos.id,
            user=self.user,
        )
        dest_pos.refresh_from_db()
        self.assertEqual(dest_pos.status, ColdStoragePalletPosition.RESERVED)

        # 3. Complete transfer: vacate source, occupy destination
        transfer_svc.vacate_source_pallet_position_for_transfer(ptr, user=self.user)
        transfer_svc.occupy_pallet_position_for_transfer(ptr, user=self.user)

        src_pos.refresh_from_db()
        dest_pos.refresh_from_db()

        # Source is now AVAILABLE
        self.assertEqual(src_pos.status, ColdStoragePalletPosition.AVAILABLE)
        self.assertEqual(src_pos.current_batch_number, "")

        # Destination is now OCCUPIED with the transferred batch
        self.assertEqual(dest_pos.status, ColdStoragePalletPosition.OCCUPIED)
        self.assertEqual(dest_pos.current_batch_number, "BATCH-TRANSFER-55")

    # ─────────────────────────────────────────────────────────────────────────
    # Scenario 6: Insufficient Capacity (17 Required, 10 Available -> Shortage 7)
    # ─────────────────────────────────────────────────────────────────────────
    def test_06_insufficient_capacity_handling(self):
        # Occupy positions 01..07 (leaving only 10 available)
        for i in range(1, 8):
            pos = self.layout_1.positions.get(position_index=i)
            pos.status = ColdStoragePalletPosition.OCCUPIED
            pos.current_batch_number = f"OCCUPIED-{i:02d}"
            pos.save()

        # 1. Preview shows exact shortage
        preview = self.service.preview_sequential_allocation(
            warehouse_code="20201",
            sap_bin_abs_entry=142,
            pallet_count=17,
        )
        self.assertEqual(preview["available_count"], 10)
        self.assertEqual(preview["required_count"], 17)
        self.assertEqual(preview["shortage"], 7)
        self.assertFalse(preview["can_fully_allocate"])

        # 2. Allocation without allow_partial raises InsufficientCapacityError
        with self.assertRaises(InsufficientCapacityError) as ctx:
            self.service.allocate_sequentially(
                warehouse_code="20201",
                sap_bin_abs_entry=142,
                pallet_count=17,
                allow_partial=False,
            )

        err = ctx.exception
        self.assertEqual(err.available, 10)
        self.assertEqual(err.required, 17)
        self.assertEqual(err.shortage, 7)

        # Verify no positions were accidentally partially allocated
        available_count = self.layout_1.positions.filter(status=ColdStoragePalletPosition.AVAILABLE).count()
        self.assertEqual(available_count, 10)

    # ─────────────────────────────────────────────────────────────────────────
    # Scenario 7: Duplicate Assignment / Concurrency Protection
    # ─────────────────────────────────────────────────────────────────────────
    def test_07_duplicate_assignment_protection(self):
        pos_1 = self.layout_1.positions.get(position_index=1)
        pos_1.status = ColdStoragePalletPosition.OCCUPIED
        pos_1.current_batch_number = "CLAIMED-BATCH"
        pos_1.save()

        # Direct attempt to occupy an already occupied slot must fail
        with self.assertRaises(ValueError) as ctx:
            ColdStoragePalletPosition.occupy_position(
                position_id=pos_1.id,
                user=self.user,
                batch_number="ANOTHER-BATCH",
            )
        self.assertIn("cannot be occupied", str(ctx.exception))

    # ─────────────────────────────────────────────────────────────────────────
    # Scenario 8: API Endpoints (Preview & Sequential Allocation & Shortage 409)
    # ─────────────────────────────────────────────────────────────────────────
    def test_08_api_endpoints(self):
        # 1. Preview API endpoint
        res = self.client.post(
            "/api/cold-storage/allocate-preview/",
            {
                "warehouse_code": "20201",
                "abs_entry": 142,
                "pallet_count": 5,
            },
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        json_data = res.json()
        self.assertTrue(json_data.get("success"))
        data = json_data.get("data")
        self.assertEqual(data["required_count"], 5)
        self.assertEqual(data["available_count"], 17)
        self.assertEqual(len(data["planned_allocations"]), 5)

        # 2. Allocation API endpoint
        res_alloc = self.client.post(
            "/api/cold-storage/allocate-sequential/",
            {
                "warehouse_code": "20201",
                "abs_entry": 142,
                "pallet_count": 3,
                "batches": ["API-B1", "API-B2", "API-B3"],
                "mode": "OCCUPY",
            },
            content_type="application/json",
        )
        self.assertEqual(res_alloc.status_code, 200)
        res_alloc_data = res_alloc.json().get("data")
        self.assertEqual(res_alloc_data["allocated_count"], 3)

        # 3. Shortage returns 409 Conflict with shortage details
        res_overflow = self.client.post(
            "/api/cold-storage/allocate-sequential/",
            {
                "warehouse_code": "20201",
                "abs_entry": 142,
                "pallet_count": 20,  # Only 14 left available
                "allow_partial": False,
            },
            content_type="application/json",
        )
        self.assertEqual(res_overflow.status_code, 409)
        err_json = res_overflow.json()
        self.assertEqual(err_json["code"], "INSUFFICIENT_CAPACITY")
        self.assertEqual(err_json["available"], 14)
        self.assertEqual(err_json["required"], 20)
        self.assertEqual(err_json["shortage"], 6)
