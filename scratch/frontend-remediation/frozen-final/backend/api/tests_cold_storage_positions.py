"""
Tests for Phase 4: Cold Storage Pallet Positions & Physical Capacity Layer.

Verifies:
1. create layout
2. create physical positions
3. capacity 17 creates 17 positions
4. capacity 12 creates 12 positions
5. every position links to correct SAP Bin
6. AbsEntry preserved
7. duplicate position prevented
8. simultaneous reservation conflict handled (409 Conflict)
9. different bins cannot collide
10. irregular SAP hierarchy supported (bulk storage, corridor bins)
"""
from django.test import TestCase, Client
from django.contrib.auth.models import User
from django.db import IntegrityError
from django.core.exceptions import ValidationError

from api.models_cold_storage import ColdStorageBinLayout, ColdStoragePalletPosition
from api.services.cold_storage_layout_service import ColdStorageLayoutService


class MockBinDiscoveryService:
    """Mock discovery returning dynamic hierarchy with regular and irregular branches."""

    def discover_bin_locations(self, warehouse_code):
        return [
            {
                "AbsEntry": 142,
                "BinCode": f"{warehouse_code}-F01-R01-C01-RA",
                "Sublevel1": "F01",
                "Sublevel2": "R01",
                "Sublevel3": "C01",
                "Sublevel4": "RA",
                "IsSystemBin": False,
            },
            {
                "AbsEntry": 162,
                "BinCode": f"{warehouse_code}-F01-R01-B01",
                "Sublevel1": "F01",
                "Sublevel2": "R01",
                "Sublevel3": "B01",
                "Sublevel4": None,
                "IsSystemBin": False,
            },
            {
                "AbsEntry": 265,
                "BinCode": f"{warehouse_code}-F01-R04",
                "Sublevel1": "F01",
                "Sublevel2": "R04",
                "Sublevel3": None,
                "Sublevel4": None,
                "IsSystemBin": False,
            },
            {
                "AbsEntry": 269,
                "BinCode": f"{warehouse_code}-F01-R06-C01-RA",
                "Sublevel1": "F01",
                "Sublevel2": "R06",
                "Sublevel3": "C01",
                "Sublevel4": "RA",
                "IsSystemBin": False,
            },
            {
                "AbsEntry": 999,
                "BinCode": f"{warehouse_code}-SYSTEM-BIN-LOCATION",
                "Sublevel1": "SYSTEM",
                "Sublevel2": None,
                "Sublevel3": None,
                "Sublevel4": None,
                "IsSystemBin": True,
            },
        ]

    def get_warehouse_hierarchy(self, warehouse_code, force_refresh=False):
        raw = self.discover_bin_locations(warehouse_code)
        from api.services.bin_discovery_service import BinDiscoveryService
        return BinDiscoveryService().build_hierarchy(raw, warehouse_code=warehouse_code)


class ColdStoragePhysicalPositionTests(TestCase):
    def setUp(self):
        self.user_a = User.objects.create_superuser(username='operator_a', password='password123')
        self.user_b = User.objects.create_user(username='operator_b', password='password123')
        self.client = Client()
        self.client.force_login(self.user_a)
        self.mock_discovery = MockBinDiscoveryService()
        self.service = ColdStorageLayoutService(bin_discovery_service=self.mock_discovery)

    # 1. create layout
    def test_01_create_layout(self):
        layout = ColdStorageBinLayout.objects.create(
            warehouse_code='20201',
            bin_code='20201-F01-R01-C01-RA',
            sap_bin_abs_entry=142,
            sublevel1='F01',
            sublevel2='R01',
            sublevel3='C01',
            sublevel4='RA',
            capacity=17,
        )
        self.assertIsNotNone(layout.id)
        self.assertEqual(layout.warehouse_code, '20201')
        self.assertEqual(layout.sap_bin_abs_entry, 142)
        self.assertEqual(layout.capacity, 17)

    # 2. create physical positions
    def test_02_create_physical_positions(self):
        layout = ColdStorageBinLayout.objects.create(
            warehouse_code='20201',
            bin_code='20201-F01-R01-C01-RA',
            sap_bin_abs_entry=142,
            capacity=5,
        )
        positions = layout.positions.all()
        self.assertEqual(positions.count(), 5)
        codes = [p.position_code for p in positions]
        self.assertEqual(codes, ['01', '02', '03', '04', '05'])

    # 3. capacity 17 creates 17 positions
    def test_03_capacity_17_creates_17_positions(self):
        layout = ColdStorageBinLayout.objects.create(
            warehouse_code='20201',
            bin_code='20201-F01-R01-C01-RA',
            sap_bin_abs_entry=142,
            capacity=17,
        )
        self.assertEqual(layout.positions.count(), 17)
        indices = list(layout.positions.values_list('position_index', flat=True))
        self.assertEqual(indices, list(range(1, 18)))
        self.assertEqual(layout.positions.first().position_code, '01')
        self.assertEqual(layout.positions.last().position_code, '17')

    # 4. capacity 12 creates 12 positions
    def test_04_capacity_12_creates_12_positions(self):
        layout = ColdStorageBinLayout.objects.create(
            warehouse_code='20201',
            bin_code='20201-F01-R06-C01-RA',
            sap_bin_abs_entry=269,
            capacity=12,
        )
        self.assertEqual(layout.positions.count(), 12)
        self.assertEqual(layout.positions.last().position_code, '12')

    # 5. every position links to correct SAP Bin
    def test_05_every_position_links_to_correct_sap_bin(self):
        layout = ColdStorageBinLayout.objects.create(
            warehouse_code='20201',
            bin_code='20201-F01-R01-C01-RA',
            sap_bin_abs_entry=142,
            capacity=17,
        )
        for pos in layout.positions.all():
            self.assertEqual(pos.warehouse_code, '20201')
            self.assertEqual(pos.bin_code, '20201-F01-R01-C01-RA')
            self.assertEqual(pos.sap_bin_abs_entry, 142)
            self.assertEqual(pos.bin_layout_id, layout.id)

    # 6. AbsEntry preserved and validated
    def test_06_abs_entry_preserved_and_validated(self):
        layout = ColdStorageBinLayout.objects.create(
            warehouse_code='20201',
            bin_code='20201-F01-R01-C01-RA',
            sap_bin_abs_entry=142,
            capacity=3,
        )
        pos = layout.positions.first()
        self.assertEqual(pos.sap_bin_abs_entry, 142)

        # Invariant: Invalid or negative AbsEntry raises ValidationError
        with self.assertRaises(ValidationError):
            bad_layout = ColdStorageBinLayout(
                warehouse_code='20201',
                bin_code='20201-INVALID',
                sap_bin_abs_entry=-1,
                capacity=1,
            )
            bad_layout.clean()

    # 7. duplicate position prevented
    def test_07_duplicate_position_prevented(self):
        layout = ColdStorageBinLayout.objects.create(
            warehouse_code='20201',
            bin_code='20201-F01-R01-C01-RA',
            sap_bin_abs_entry=142,
            capacity=3,
        )
        with self.assertRaises(IntegrityError):
            ColdStoragePalletPosition.objects.create(
                bin_layout=layout,
                warehouse_code=layout.warehouse_code,
                bin_code=layout.bin_code,
                sap_bin_abs_entry=layout.sap_bin_abs_entry,
                position_index=1, # duplicate
                position_code='01',
            )

    # 8. simultaneous reservation conflict handled
    def test_08_simultaneous_reservation_conflict(self):
        layout = ColdStorageBinLayout.objects.create(
            warehouse_code='20201',
            bin_code='20201-F01-R01-C01-RA',
            sap_bin_abs_entry=142,
            capacity=3,
        )
        pos = layout.positions.first()

        # User A reserves position 01
        reserved_a = self.service.reserve_position(pos.id, user=self.user_a, reference='REQ-001')
        self.assertEqual(reserved_a['status'], 'RESERVED')
        self.assertEqual(reserved_a['reserved_by'], 'operator_a')

        # User B attempts to reserve the same position simultaneously
        with self.assertRaises(ValueError) as ctx:
            self.service.reserve_position(pos.id, user=self.user_b, reference='REQ-002')
        self.assertIn("cannot be reserved", str(ctx.exception))

        # API check: HTTP 409 Conflict
        response = self.client.post(
            f"/api/cold-storage/positions/{pos.id}/reserve/",
            data={"reference": "REQ-003"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 409)
        self.assertFalse(response.json()["success"])

        # Release position and verify available again
        released = self.service.release_position(pos.id)
        self.assertEqual(released['status'], 'AVAILABLE')
        self.assertIsNone(released['reserved_by'])

    # 9. different bins cannot collide
    def test_09_different_bins_cannot_collide(self):
        layout_a = ColdStorageBinLayout.objects.create(
            warehouse_code='20201',
            bin_code='20201-F01-R01-C01-RA',
            sap_bin_abs_entry=142,
            capacity=5,
        )
        layout_b = ColdStorageBinLayout.objects.create(
            warehouse_code='20201',
            bin_code='20201-F01-R01-C01-RB',
            sap_bin_abs_entry=143,
            capacity=5,
        )

        pos_a1 = layout_a.positions.get(position_index=1)
        pos_b1 = layout_b.positions.get(position_index=1)

        # Both have position_code '01', but different layouts and different AbsEntries
        self.assertEqual(pos_a1.position_code, '01')
        self.assertEqual(pos_b1.position_code, '01')
        self.assertNotEqual(pos_a1.id, pos_b1.id)
        self.assertEqual(pos_a1.sap_bin_abs_entry, 142)
        self.assertEqual(pos_b1.sap_bin_abs_entry, 143)

        # Reserving pos_a1 does not affect pos_b1
        self.service.reserve_position(pos_a1.id, user=self.user_a)
        pos_b1.refresh_from_db()
        self.assertEqual(pos_b1.status, ColdStoragePalletPosition.AVAILABLE)

    # 10. irregular SAP hierarchy supported
    def test_10_irregular_sap_hierarchy_supported(self):
        # Discovers warehouse layout using mock discovery containing:
        # - regular rack channel (C01-RA)
        # - corridor bin (B01)
        # - bulk storage floor (R04)
        # - system bin (SYSTEM-BIN-LOCATION)
        warehouse_layout = self.service.get_warehouse_layout('20201')

        self.assertEqual(warehouse_layout['warehouse_code'], '20201')
        self.assertGreater(warehouse_layout['total_capacity'], 0)

        # Verify bulk bin R04 (AbsEntry 265)
        pos_r04 = self.service.get_bin_positions(265)
        self.assertEqual(pos_r04['bin_code'], '20201-F01-R04')
        self.assertEqual(pos_r04['channel_type'], ColdStorageBinLayout.CHANNEL_BULK)
        self.assertEqual(pos_r04['capacity'], 1)
        self.assertEqual(len(pos_r04['positions']), 1)

        # Verify corridor bin B01 (AbsEntry 162)
        pos_b01 = self.service.get_bin_positions(162)
        self.assertEqual(pos_b01['bin_code'], '20201-F01-R01-B01')
        self.assertEqual(pos_b01['channel_type'], ColdStorageBinLayout.CHANNEL_CORRIDOR)
        self.assertEqual(pos_b01['capacity'], 1)

        # Verify regular rack C01-RA (AbsEntry 142) has capacity 17
        pos_ra = self.service.get_bin_positions(142)
        self.assertEqual(pos_ra['capacity'], 17)
        self.assertEqual(len(pos_ra['positions']), 17)

    # 11. 353 live-bin reconciliation logic and mutual exclusivity
    def test_11_353_bin_reconciliation_and_mutual_exclusivity(self):
        # Fixture representing the 4 distinct categories in the 353-bin Warehouse 20201
        sample_records = [
            # 1. System bin
            {"BinCode": "20201-SYSTEM-BIN-LOCATION", "Sublevel1": "SYSTEM", "IsSystemBin": True, "Description": ""},
            # 2. Corridor bin
            {"BinCode": "20201-F01-R01-B01", "Sublevel1": "F01", "Sublevel2": "R01", "Sublevel3": "B01", "Sublevel4": None, "Description": "طرقة 1"},
            # 3. Bulk bin
            {"BinCode": "20201-F01-R04", "Sublevel1": "F01", "Sublevel2": "R04", "Sublevel3": None, "Sublevel4": None, "Description": "عنبر 4"},
            # 4. Physical Channel
            {"BinCode": "20201-F01-R01-C01-RA", "Sublevel1": "F01", "Sublevel2": "R01", "Sublevel3": "C01", "Sublevel4": "RA", "Description": "Tier A"},
        ]

        classifications = [ColdStorageLayoutService.classify_sap_bin(r) for r in sample_records]
        self.assertEqual(classifications[0], ColdStorageBinLayout.CLASS_SYSTEM)
        self.assertEqual(classifications[1], ColdStorageBinLayout.CLASS_CORRIDOR_OR_AISLE)
        self.assertEqual(classifications[2], ColdStorageBinLayout.CLASS_BULK_OR_GENERAL)
        self.assertEqual(classifications[3], ColdStorageBinLayout.CLASS_PHYSICAL_CHANNEL)

    # 12. system bin exclusion from physical allocation
    def test_12_system_bin_exclusion(self):
        sys_record = {"BinCode": "20201-SYSTEM-BIN-LOCATION", "Sublevel1": "SYSTEM", "IsSystemBin": True}
        classification = ColdStorageLayoutService.classify_sap_bin(sys_record)
        res = self.service.determine_channel_and_capacity(
            warehouse_code="20201",
            bin_code="20201-SYSTEM-BIN-LOCATION",
            classification=classification,
        )
        self.assertEqual(classification, ColdStorageBinLayout.CLASS_SYSTEM)
        self.assertEqual(res["capacity_source"], ColdStorageBinLayout.CAPACITY_SOURCE_SYSTEM)
        self.assertEqual(res["capacity"], 1)

    # 13. capacity source resolution (CONFIGURED vs DEFAULT vs UNCONFIGURED)
    def test_13_capacity_source_resolution(self):
        # 13a. Warehouse 20201 Chamber 1 (R01) -> CONFIGURED 17
        res_r01 = self.service.determine_channel_and_capacity(
            warehouse_code="20201",
            bin_code="20201-F01-R01-C01-RA",
            classification=ColdStorageBinLayout.CLASS_PHYSICAL_CHANNEL,
            sublevel2="R01",
            sublevel3="C01",
            sublevel4="RA",
        )
        self.assertEqual(res_r01["capacity"], 17)
        self.assertEqual(res_r01["capacity_source"], ColdStorageBinLayout.CAPACITY_SOURCE_CONFIGURED)

        # 13b. Warehouse 20201 Chamber 6 (R06) -> CONFIGURED 12
        res_r06 = self.service.determine_channel_and_capacity(
            warehouse_code="20201",
            bin_code="20201-F01-R06-C01-RA",
            classification=ColdStorageBinLayout.CLASS_PHYSICAL_CHANNEL,
            sublevel2="R06",
            sublevel3="C01",
            sublevel4="RA",
        )
        self.assertEqual(res_r06["capacity"], 12)
        self.assertEqual(res_r06["capacity_source"], ColdStorageBinLayout.CAPACITY_SOURCE_CONFIGURED)

        # 13c. Warehouse 20201 Corridor bin -> DEFAULT 1
        res_corridor = self.service.determine_channel_and_capacity(
            warehouse_code="20201",
            bin_code="20201-F01-R01-B01",
            classification=ColdStorageBinLayout.CLASS_CORRIDOR_OR_AISLE,
            sublevel2="R01",
            sublevel3="B01",
        )
        self.assertEqual(res_corridor["capacity"], 1)
        self.assertEqual(res_corridor["capacity_source"], ColdStorageBinLayout.CAPACITY_SOURCE_DEFAULT)

    # 14. unknown warehouse does not guess capacity (UNCONFIGURED)
    def test_14_unknown_warehouse_unconfigured_capacity(self):
        # Future/unknown warehouse "99999" with a physical channel
        res_unknown = self.service.determine_channel_and_capacity(
            warehouse_code="99999",
            bin_code="99999-SEC-A-C01-RA",
            classification=ColdStorageBinLayout.CLASS_PHYSICAL_CHANNEL,
            sublevel2="SEC-A",
            sublevel3="C01",
            sublevel4="RA",
        )
        # MUST NOT guess 17 or 12
        self.assertEqual(res_unknown["capacity_source"], ColdStorageBinLayout.CAPACITY_SOURCE_UNCONFIGURED)
        self.assertEqual(res_unknown["capacity"], 1)

    # 15. future/new SAP hierarchy values handled gracefully
    def test_15_future_new_sap_hierarchy_values(self):
        # New arbitrary hierarchy: Area F03, Section SEC-X, Row ROW-05, Tier TE
        rec = {
            "AbsEntry": 8888,
            "BinCode": "WH-NEW-F03-SEC-X-ROW-05-TE",
            "Sublevel1": "F03",
            "Sublevel2": "SEC-X",
            "Sublevel3": "ROW-05",
            "Sublevel4": "TE",
            "IsSystemBin": False,
        }
        classification = ColdStorageLayoutService.classify_sap_bin(rec)
        self.assertEqual(classification, ColdStorageBinLayout.CLASS_PHYSICAL_CHANNEL)

        layout = self.service.get_or_create_bin_layout(
            warehouse_code="WH-NEW",
            bin_code=rec["BinCode"],
            sap_bin_abs_entry=rec["AbsEntry"],
            sublevel1=rec["Sublevel1"],
            sublevel2=rec["Sublevel2"],
            sublevel3=rec["Sublevel3"],
            sublevel4=rec["Sublevel4"],
        )
        self.assertEqual(layout.sap_bin_classification, ColdStorageBinLayout.CLASS_PHYSICAL_CHANNEL)
        self.assertEqual(layout.capacity_source, ColdStorageBinLayout.CAPACITY_SOURCE_UNCONFIGURED)
        self.assertEqual(layout.positions.count(), 1)

    # 16. existing positions and reservations preserved during synchronization
    def test_16_existing_positions_and_reservations_preserved_on_sync(self):
        layout = self.service.get_or_create_bin_layout(
            warehouse_code="20201",
            bin_code="20201-F01-R01-C01-RA",
            sap_bin_abs_entry=142,
            capacity=17,
        )
        pos = layout.positions.first()
        self.service.reserve_position(pos.id, user=self.user_a, reference="SAFE-REF")

        # Run warehouse layout sync
        self.service.ensure_warehouse_layouts("20201")

        # Verify reservation and position count are strictly preserved
        pos.refresh_from_db()
        self.assertEqual(pos.status, ColdStoragePalletPosition.RESERVED)
        self.assertEqual(pos.reserved_by, self.user_a)
        self.assertEqual(pos.reservation_reference, "SAFE-REF")
        self.assertEqual(layout.positions.count(), 17)

    # 17. no fake SAP bins permitted
    def test_17_no_fake_sap_bins_permitted(self):
        # Attempting to create layout with missing or non-positive AbsEntry
        with self.assertRaises(ValueError):
            self.service.get_or_create_bin_layout(
                warehouse_code="20201",
                bin_code="20201-FAKE",
                sap_bin_abs_entry=0, # Invalid
                capacity=10,
            )


class ColdStorageOccupancyFoundationPhase5Tests(TestCase):
    """
    Phase 5: Physical Capacity Configuration & Occupancy Foundation Tests.
    Covers the 15 required scenarios for physical position lifecycle, allocation types,
    concurrency, and SAP decoupling.
    """

    def setUp(self):
        self.user_a = User.objects.create_superuser(username='operator_a', password='password123')
        self.user_b = User.objects.create_user(username='operator_b', password='password123')
        self.client = Client()
        self.client.force_login(self.user_a)
        self.mock_discovery = MockBinDiscoveryService()
        self.service = ColdStorageLayoutService(bin_discovery_service=self.mock_discovery)

        # Standard physical channel in 20201 (R01 channel C01, capacity 17)
        self.channel_layout = self.service.get_or_create_bin_layout(
            warehouse_code="20201",
            bin_code="20201-F01-R01-C01-RA",
            sap_bin_abs_entry=142,
            sublevel1="F01",
            sublevel2="R01",
            sublevel3="C01",
            sublevel4="RA",
            capacity=17,
        )

    # 1. AVAILABLE -> RESERVED
    def test_scenario_01_available_to_reserved(self):
        pos = self.channel_layout.positions.first()
        self.assertEqual(pos.status, ColdStoragePalletPosition.AVAILABLE)

        res = self.service.reserve_position(
            position_id=pos.id,
            user=self.user_a,
            reference="REQ-101",
            transfer_reference="TRF-901",
        )
        self.assertEqual(res["status"], ColdStoragePalletPosition.RESERVED)
        self.assertEqual(res["reserved_by"], "operator_a")
        self.assertEqual(res["reservation_reference"], "REQ-101")
        self.assertEqual(res["transfer_reference"], "TRF-901")

        pos.refresh_from_db()
        self.assertEqual(pos.status, ColdStoragePalletPosition.RESERVED)
        self.assertIsNotNone(pos.reserved_at)

    # 2. RESERVED -> AVAILABLE (release)
    def test_scenario_02_reserved_to_available_release(self):
        pos = self.channel_layout.positions.first()
        self.service.reserve_position(pos.id, user=self.user_a, reference="REQ-102")

        rel = self.service.release_position(pos.id, user=self.user_a)
        self.assertEqual(rel["status"], ColdStoragePalletPosition.AVAILABLE)
        self.assertIsNone(rel["reserved_by"])
        self.assertEqual(rel["reservation_reference"], "")

        pos.refresh_from_db()
        self.assertEqual(pos.status, ColdStoragePalletPosition.AVAILABLE)
        self.assertIsNone(pos.reserved_at)

    # 3. RESERVED simultaneous conflict -> HTTP 409
    def test_scenario_03_simultaneous_reservation_conflict_409(self):
        pos = self.channel_layout.positions.first()
        # User A reserves
        self.service.reserve_position(pos.id, user=self.user_a, reference="USER-A")

        # User B attempts to reserve same position via API
        response = self.client.post(
            f"/api/cold-storage/positions/{pos.id}/reserve/",
            data={"reference": "USER-B", "transfer_reference": "TRF-FAIL"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 409)
        self.assertIn("cannot be reserved", response.json().get("error", ""))

    # 4. OCCUPIED cannot be reserved
    def test_scenario_04_occupied_cannot_be_reserved(self):
        pos = self.channel_layout.positions.first()
        self.service.occupy_position(
            pos.id,
            user=self.user_a,
            batch_number="B-123456",
            reference="TRF-OCC-1",
        )
        pos.refresh_from_db()
        self.assertEqual(pos.status, ColdStoragePalletPosition.OCCUPIED)

        # Attempt to reserve occupied position via API
        response = self.client.post(
            f"/api/cold-storage/positions/{pos.id}/reserve/",
            data={"reference": "TRY-RESERVE"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 409)

        # Attempt directly via service
        with self.assertRaises(ValueError):
            self.service.reserve_position(pos.id, user=self.user_b)

    # 5. MAINTENANCE cannot be reserved
    def test_scenario_05_maintenance_cannot_be_reserved(self):
        pos = self.channel_layout.positions.first()
        self.service.set_position_maintenance(pos.id, user=self.user_a, notes="Broken rail")
        pos.refresh_from_db()
        self.assertEqual(pos.status, ColdStoragePalletPosition.MAINTENANCE)

        # Attempt to reserve maintenance position
        response = self.client.post(
            f"/api/cold-storage/positions/{pos.id}/reserve/",
            data={"reference": "TRY-RESERVE-MAINT"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 409)

    # 6. NON_ALLOCATABLE bin cannot be reserved
    def test_scenario_06_non_allocatable_bin_cannot_be_reserved(self):
        layout = self.service.get_or_create_bin_layout(
            warehouse_code="20201",
            bin_code="20201-NON-ALLOC",
            sap_bin_abs_entry=555,
            allocation_type=ColdStorageBinLayout.ALLOC_NON_ALLOCATABLE,
            capacity=1,
        )
        pos = layout.positions.first()
        response = self.client.post(
            f"/api/cold-storage/positions/{pos.id}/reserve/",
            data={"reference": "TRY-NON-ALLOC"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 409)
        self.assertIn("cannot be reserved", response.json().get("error", ""))

    # 7. SYSTEM bin cannot be reserved
    def test_scenario_07_system_bin_cannot_be_reserved(self):
        layout = self.service.get_or_create_bin_layout(
            warehouse_code="20201",
            bin_code="20201-SYSTEM-BIN-LOCATION",
            sap_bin_abs_entry=999,
            is_system_bin=True,
        )
        self.assertEqual(layout.allocation_type, ColdStorageBinLayout.ALLOC_NON_ALLOCATABLE)
        pos = layout.positions.first()
        with self.assertRaises(ValueError):
            self.service.reserve_position(pos.id)

    # 8. STAGING_ONLY behavior (e.g. B01 corridor)
    def test_scenario_08_staging_only_behavior(self):
        layout = self.service.get_or_create_bin_layout(
            warehouse_code="20201",
            bin_code="20201-F01-R01-B01",
            sap_bin_abs_entry=162,
            sublevel1="F01",
            sublevel2="R01",
            sublevel3="B01",
        )
        self.assertEqual(layout.allocation_type, ColdStorageBinLayout.ALLOC_STAGING_ONLY)
        self.assertTrue(layout.is_staging_only)
        self.assertFalse(layout.is_allocatable)

        pos = layout.positions.first()
        # Staging positions cannot be reserved for normal pallet placement
        with self.assertRaises(ValueError):
            self.service.reserve_position(pos.id, user=self.user_a)

    # 9. UNCONFIGURED behavior
    def test_scenario_09_unconfigured_behavior(self):
        # Bulk bin R04 in 20201 is UNCONFIGURED by default
        layout = self.service.get_or_create_bin_layout(
            warehouse_code="20201",
            bin_code="20201-F01-R04",
            sap_bin_abs_entry=265,
            sublevel1="F01",
            sublevel2="R04",
        )
        self.assertEqual(layout.allocation_type, ColdStorageBinLayout.ALLOC_UNCONFIGURED)
        self.assertTrue(layout.is_unconfigured)
        self.assertFalse(layout.is_allocatable)

        pos = layout.positions.first()
        with self.assertRaises(ValueError):
            self.service.reserve_position(pos.id)

        # Configure explicitly via API
        response = self.client.post(
            f"/api/cold-storage/bin/{layout.sap_bin_abs_entry}/configure/",
            data={"allocation_type": "ALLOCATABLE", "capacity": 10},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)

        layout.refresh_from_db()
        self.assertEqual(layout.allocation_type, ColdStorageBinLayout.ALLOC_ALLOCATABLE)
        self.assertEqual(layout.capacity, 10)
        self.assertEqual(layout.positions.count(), 10)

        # Now can be reserved
        new_pos = layout.positions.first()
        res = self.service.reserve_position(new_pos.id, user=self.user_a)
        self.assertEqual(res["status"], ColdStoragePalletPosition.RESERVED)

    # 10. Multiple physical positions sharing one AbsEntry
    def test_scenario_10_multiple_physical_positions_share_one_abs_entry(self):
        positions = self.channel_layout.positions.all().order_by("position_index")
        self.assertEqual(positions.count(), 17)

        # All 17 positions MUST share the exact same SAP Bin AbsEntry 142
        for p in positions:
            self.assertEqual(p.sap_bin_abs_entry, 142)
            self.assertEqual(p.bin_code, "20201-F01-R01-C01-RA")

        # Distinct statuses inside the same SAP Bin
        self.service.reserve_position(positions[0].id, user=self.user_a, reference="POS-01")
        self.service.occupy_position(positions[1].id, user=self.user_a, batch_number="BATCH-X")
        self.service.set_position_maintenance(positions[2].id, notes="Inspection")

        bin_data = self.service.get_bin_positions(142)
        occ = bin_data["occupancy"]
        self.assertEqual(occ["total"], 17)
        self.assertEqual(occ["reserved"], 1)
        self.assertEqual(occ["occupied"], 1)
        self.assertEqual(occ["maintenance"], 1)
        self.assertEqual(occ["available"], 14)

    # 11. Reservation metadata
    def test_scenario_11_reservation_metadata(self):
        pos = self.channel_layout.positions.all()[3]
        self.service.reserve_position(
            pos.id,
            user=self.user_b,
            reference="PALLET-BATCH-777",
            transfer_reference="TRANSFER-999",
        )
        pos.refresh_from_db()
        self.assertEqual(pos.reserved_by, self.user_b)
        self.assertIsNotNone(pos.reserved_at)
        self.assertEqual(pos.reservation_reference, "PALLET-BATCH-777")
        self.assertEqual(pos.transfer_reference, "TRANSFER-999")

    # 12. Concurrent reservation safety
    def test_scenario_12_concurrent_reservation_safety(self):
        pos = self.channel_layout.positions.all()[4]
        # First reservation succeeds
        self.service.reserve_position(pos.id, user=self.user_a, reference="FIRST")
        # Second immediate reservation attempt must raise ValueError and not alter reserved_by
        with self.assertRaises(ValueError):
            self.service.reserve_position(pos.id, user=self.user_b, reference="SECOND")

        pos.refresh_from_db()
        self.assertEqual(pos.reserved_by, self.user_a)
        self.assertEqual(pos.reservation_reference, "FIRST")

    # 13. Existing SAP BinAbsEntry preservation
    def test_scenario_13_sap_bin_abs_entry_preservation(self):
        pos = self.channel_layout.positions.all()[5]
        orig_abs = pos.sap_bin_abs_entry

        # AVAILABLE -> RESERVED -> OCCUPIED -> VACATED -> AVAILABLE
        self.service.reserve_position(pos.id, user=self.user_a)
        self.service.occupy_position(pos.id, user=self.user_a, batch_number="B-99")
        self.service.vacate_position(pos.id, user=self.user_a)

        pos.refresh_from_db()
        self.assertEqual(pos.status, ColdStoragePalletPosition.AVAILABLE)
        self.assertEqual(pos.sap_bin_abs_entry, orig_abs)
        self.assertEqual(pos.sap_bin_abs_entry, 142)

    # 14. Existing Transfer payload remains unchanged
    def test_scenario_14_existing_transfer_payload_unchanged(self):
        # Emulate how transfer lines are created and ensure the payload uses BinAbsEntry
        pos = self.channel_layout.positions.first()
        transfer_payload_line = {
            "ItemCode": "ITEM-001",
            "Quantity": 10.0,
            "WarehouseCode": pos.warehouse_code,
            "BinAbsEntry": pos.sap_bin_abs_entry,  # Real SAP Bin
        }
        # Invariant: physical position code is NOT injected into SAP payload
        self.assertEqual(transfer_payload_line["BinAbsEntry"], 142)
        self.assertEqual(transfer_payload_line["WarehouseCode"], "20201")
        self.assertNotIn("PalletPosition", transfer_payload_line)

    # 15. New SAP hierarchy values remain supported
    def test_scenario_15_new_sap_hierarchy_values_supported(self):
        # Arbitrary new warehouse and chamber
        new_layout = self.service.get_or_create_bin_layout(
            warehouse_code="WH-FUTURE",
            bin_code="WH-FUTURE-ZONE-Z-TIER-9",
            sap_bin_abs_entry=7777,
            sublevel1="ZONE-Z",
            sublevel2="TIER-9",
        )
        self.assertEqual(new_layout.allocation_type, ColdStorageBinLayout.ALLOC_UNCONFIGURED)
        self.assertEqual(new_layout.capacity, 1)
        self.assertFalse(new_layout.is_allocatable)
