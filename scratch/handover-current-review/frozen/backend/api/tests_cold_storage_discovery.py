import unittest
from unittest.mock import Mock, patch
from django.test import SimpleTestCase, TestCase
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from api.models import TransferWarehouseRule, UserProfile

from api.services.bin_discovery_service import BinDiscoveryService, get_bin_discovery_service
from api.services.sap_service import SAPServiceLayer


class BinDiscoveryPaginationTests(SimpleTestCase):
    """Test 1 — Pagination: Simulate multiple SAP pages and verify ALL bins are returned."""

    @patch("api.services.sap_service.SAPServiceLayer._http_request")
    def test_multi_page_pagination_retrieves_all_bins(self, mock_get):
        # Setup mock responses for 3 pages: 20 + 20 + 10 = 50 bins
        page1_bins = [{"AbsEntry": i, "BinCode": f"BIN-{i}", "Warehouse": "WH-TEST"} for i in range(1, 21)]
        page2_bins = [{"AbsEntry": i, "BinCode": f"BIN-{i}", "Warehouse": "WH-TEST"} for i in range(21, 41)]
        page3_bins = [{"AbsEntry": i, "BinCode": f"BIN-{i}", "Warehouse": "WH-TEST"} for i in range(41, 51)]

        resp1 = Mock()
        resp1.status_code = 200
        resp1.json.return_value = {
            "value": page1_bins,
            "@odata.nextLink": "BinLocations?$filter=Warehouse%20eq%20'WH-TEST'&$skip=20",
        }

        resp2 = Mock()
        resp2.status_code = 200
        resp2.json.return_value = {
            "value": page2_bins,
            "@odata.nextLink": "BinLocations?$filter=Warehouse%20eq%20'WH-TEST'&$skip=40",
        }

        resp3 = Mock()
        resp3.status_code = 200
        resp3.json.return_value = {
            "value": page3_bins,
            # No nextLink on final page
        }

        mock_get.side_effect = [resp1, resp2, resp3]

        sap_client = SAPServiceLayer()
        sap_client.session_id = "test_session_id"
        sap_client.base_url = "https://mock-sap:50000/b1s/v2"

        result = sap_client.get_bin_locations_by_warehouse("WH-TEST")
        rows = result.get("value", [])

        self.assertEqual(len(rows), 50)
        self.assertEqual(mock_get.call_count, 3)
        self.assertEqual(rows[0]["AbsEntry"], 1)
        self.assertEqual(rows[-1]["AbsEntry"], 50)


class BinDiscoveryHierarchyTests(SimpleTestCase):
    """Test 2 — Hierarchy: Verify multi-level tree generation."""

    def test_structured_hierarchy_generation(self):
        records = [
            {
                "AbsEntry": 101,
                "BinCode": "20201-F01-R01-C01-RA",
                "Description": "F01 R01 C01 Level A",
                "Warehouse": "20201",
                "Sublevel1": "F01",
                "Sublevel2": "R01",
                "Sublevel3": "C01",
                "Sublevel4": "RA",
                "Inactive": "tNO",
                "IsSystemBin": "tNO",
            },
            {
                "AbsEntry": 102,
                "BinCode": "20201-F01-R01-C01-RB",
                "Description": "F01 R01 C01 Level B",
                "Warehouse": "20201",
                "Sublevel1": "F01",
                "Sublevel2": "R01",
                "Sublevel3": "C01",
                "Sublevel4": "RB",
                "Inactive": "tNO",
                "IsSystemBin": "tNO",
            },
            {
                "AbsEntry": 103,
                "BinCode": "20201-F01-R01-C02-RA",
                "Description": "F01 R01 C02 Level A",
                "Warehouse": "20201",
                "Sublevel1": "F01",
                "Sublevel2": "R01",
                "Sublevel3": "C02",
                "Sublevel4": "RA",
                "Inactive": "tNO",
                "IsSystemBin": "tNO",
            },
        ]

        service = BinDiscoveryService()
        result = service.build_hierarchy(records, warehouse_code="20201")

        self.assertEqual(result["warehouse_code"], "20201")
        self.assertEqual(result["total_bins"], 3)
        self.assertEqual(result["active_bins"], 3)
        self.assertEqual(result["inactive_bins"], 0)
        self.assertEqual(result["physical_bins"], 3)
        self.assertEqual(result["system_bins"], 0)

        hierarchy = result["hierarchy"]
        self.assertEqual(len(hierarchy), 1)  # Root: F01
        f01 = hierarchy[0]
        self.assertEqual(f01["code"], "F01")
        self.assertEqual(f01["sublevel"], 1)

        # Chamber R01
        self.assertEqual(len(f01["children"]), 1)
        r01 = f01["children"][0]
        self.assertEqual(r01["code"], "R01")
        self.assertEqual(r01["sublevel"], 2)

        # Racks C01, C02
        self.assertEqual(len(r01["children"]), 2)
        c01 = r01["children"][0]
        c02 = r01["children"][1]
        self.assertEqual(c01["code"], "C01")
        self.assertEqual(c02["code"], "C02")

        # C01 has levels RA, RB
        self.assertEqual(len(c01["children"]), 2)
        ra = c01["children"][0]
        rb = c01["children"][1]
        self.assertEqual(ra["code"], "RA")
        self.assertEqual(rb["code"], "RB")
        self.assertEqual(ra["bins"][0]["bin_code"], "20201-F01-R01-C01-RA")
        self.assertEqual(rb["bins"][0]["bin_code"], "20201-F01-R01-C01-RB")

        # C02 has level RA
        self.assertEqual(len(c02["children"]), 1)
        self.assertEqual(c02["children"][0]["code"], "RA")
        self.assertEqual(c02["children"][0]["bins"][0]["bin_code"], "20201-F01-R01-C02-RA")


class BinDiscoveryIrregularHierarchyTests(SimpleTestCase):
    """Test 3 — Irregular hierarchy: Handling missing Sublevel3 or Sublevel4 gracefully."""

    def test_irregular_depth_bins(self):
        records = [
            # System bin: Sublevel1 only
            {
                "AbsEntry": 1,
                "BinCode": "20201-SYSTEM-BIN-LOCATION",
                "Warehouse": "20201",
                "Sublevel1": "SYSTEM-BIN-LOCATION",
                "Sublevel2": None,
                "Sublevel3": None,
                "Sublevel4": None,
                "Inactive": "tNO",
                "IsSystemBin": "tYES",
            },
            # Bulk chamber bin: Sublevel1 + Sublevel2 only
            {
                "AbsEntry": 2,
                "BinCode": "20201-F01-R04",
                "Warehouse": "20201",
                "Sublevel1": "F01",
                "Sublevel2": "R04",
                "Sublevel3": None,
                "Sublevel4": None,
                "Inactive": "tNO",
                "IsSystemBin": "tNO",
            },
            # Corridor bin: Sublevel1 + Sublevel2 + Sublevel3
            {
                "AbsEntry": 3,
                "BinCode": "20201-F01-R01-B01",
                "Warehouse": "20201",
                "Sublevel1": "F01",
                "Sublevel2": "R01",
                "Sublevel3": "B01",
                "Sublevel4": None,
                "Inactive": "tNO",
                "IsSystemBin": "tNO",
            },
            # Standard 4-tier bin
            {
                "AbsEntry": 4,
                "BinCode": "20201-F01-R01-C01-RA",
                "Warehouse": "20201",
                "Sublevel1": "F01",
                "Sublevel2": "R01",
                "Sublevel3": "C01",
                "Sublevel4": "RA",
                "Inactive": "tNO",
                "IsSystemBin": "tNO",
            },
        ]

        service = BinDiscoveryService()
        result = service.build_hierarchy(records, warehouse_code="20201")

        self.assertEqual(result["total_bins"], 4)
        self.assertEqual(result["system_bins"], 1)
        self.assertEqual(result["physical_bins"], 3)

        roots = {node["code"]: node for node in result["hierarchy"]}
        self.assertIn("SYSTEM-BIN-LOCATION", roots)
        self.assertIn("F01", roots)

        # System bin attached directly at root (Sublevel 1)
        sys_node = roots["SYSTEM-BIN-LOCATION"]
        self.assertEqual(len(sys_node["bins"]), 1)
        self.assertEqual(sys_node["bins"][0]["bin_code"], "20201-SYSTEM-BIN-LOCATION")
        self.assertEqual(len(sys_node["children"]), 0)

        # F01 root contains R04 and R01
        f01_node = roots["F01"]
        f01_children = {child["code"]: child for child in f01_node["children"]}
        self.assertIn("R04", f01_children)
        self.assertIn("R01", f01_children)

        # R04 bulk bin attached directly at Sublevel 2
        r04_node = f01_children["R04"]
        self.assertEqual(len(r04_node["bins"]), 1)
        self.assertEqual(r04_node["bins"][0]["bin_code"], "20201-F01-R04")
        self.assertEqual(len(r04_node["children"]), 0)

        # R01 has children B01 (corridor) and C01 (rack)
        r01_node = f01_children["R01"]
        r01_children = {child["code"]: child for child in r01_node["children"]}
        self.assertIn("B01", r01_children)
        self.assertIn("C01", r01_children)

        # B01 corridor attached directly at Sublevel 3
        b01_node = r01_children["B01"]
        self.assertEqual(len(b01_node["bins"]), 1)
        self.assertEqual(b01_node["bins"][0]["bin_code"], "20201-F01-R01-B01")
        self.assertEqual(len(b01_node["children"]), 0)

        # C01 rack has child RA at Sublevel 4
        c01_node = r01_children["C01"]
        self.assertEqual(len(c01_node["children"]), 1)
        self.assertEqual(c01_node["children"][0]["code"], "RA")
        self.assertEqual(c01_node["children"][0]["bins"][0]["bin_code"], "20201-F01-R01-C01-RA")


class BinDiscoveryAbsEntryPreservationTests(SimpleTestCase):
    """Test 4 — AbsEntry preservation: Verify every Bin retains its SAP AbsEntry."""

    def test_abs_entry_retained_through_all_transformations(self):
        records = [
            {
                "AbsEntry": 98765,
                "BinCode": "TEST-BIN-98765",
                "Warehouse": "WH-TEST",
                "Sublevel1": "S1",
                "Sublevel2": "S2",
                "Sublevel3": "S3",
                "Sublevel4": "S4",
                "Inactive": "tNO",
                "IsSystemBin": "tNO",
            }
        ]

        service = BinDiscoveryService()
        result = service.build_hierarchy(records, warehouse_code="WH-TEST")

        leaf_bin = result["hierarchy"][0]["children"][0]["children"][0]["children"][0]["bins"][0]
        self.assertEqual(leaf_bin["abs_entry"], 98765)
        self.assertEqual(leaf_bin["bin_code"], "TEST-BIN-98765")


class BinDiscoveryWarehouseIsolationTests(SimpleTestCase):
    """Test 5 — Warehouse isolation: Bins from WH A must never leak into WH B."""

    @patch.object(BinDiscoveryService, "_get_sap_client")
    def test_warehouse_isolation(self, mock_get_sap):
        mock_sap = Mock()
        mock_sap.get_bin_locations_by_warehouse.side_effect = lambda wh: {
            "value": [
                {
                    "AbsEntry": 100 if wh == "WH-A" else 200,
                    "BinCode": f"{wh}-BIN-01",
                    "Warehouse": wh,
                    "Sublevel1": "F01",
                    "Sublevel2": "R01",
                    "Sublevel3": "C01",
                    "Sublevel4": "RA",
                }
            ]
        }
        mock_get_sap.return_value = mock_sap

        service = BinDiscoveryService(sap_client=mock_sap)

        wh_a_bins = service.discover_bin_locations("WH-A", force_refresh=True)
        wh_b_bins = service.discover_bin_locations("WH-B", force_refresh=True)

        self.assertEqual(wh_a_bins[0]["Warehouse"], "WH-A")
        self.assertEqual(wh_b_bins[0]["Warehouse"], "WH-B")
        self.assertNotEqual(wh_a_bins[0]["AbsEntry"], wh_b_bins[0]["AbsEntry"])

        tree_a = service.build_hierarchy(wh_a_bins, warehouse_code="WH-A")
        tree_b = service.build_hierarchy(wh_b_bins, warehouse_code="WH-B")

        self.assertEqual(tree_a["warehouse_code"], "WH-A")
        self.assertEqual(tree_b["warehouse_code"], "WH-B")


class BinDiscoveryEndpointTests(TestCase):
    """Test cold storage hierarchy and backward-compatible bin-locations endpoints."""

    @patch("api.services.bin_discovery_service.BinDiscoveryService.discover_bin_locations")
    def test_cold_storage_hierarchy_endpoint(self, mock_discover):
        mock_discover.return_value = [
            {
                "AbsEntry": 142,
                "BinCode": "20201-F01-R01-C01-RA",
                "Description": "Test Bin",
                "Warehouse": "20201",
                "Sublevel1": "F01",
                "Sublevel2": "R01",
                "Sublevel3": "C01",
                "Sublevel4": "RA",
                "Inactive": "tNO",
                "IsSystemBin": "tNO",
            }
        ]

        client = APIClient()
        user = User.objects.create_user(username='hierarchy_reader', password='test-password')
        UserProfile.objects.filter(user=user).update(role='transfer_user')
        TransferWarehouseRule.objects.create(
            user=user, warehouse_code='20201', direction='TO',
            stage=TransferWarehouseRule.STAGE_2_TO_FRIDGE,
        )
        client.force_login(user)
        response = client.get("/api/cold-storage/20201/hierarchy/?refresh=true")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data.get("success"))
        payload = data.get("data")
        self.assertEqual(payload["warehouse_code"], "20201")
        self.assertEqual(payload["total_bins"], 1)
        self.assertEqual(len(payload["hierarchy"]), 1)
        self.assertEqual(payload["hierarchy"][0]["code"], "F01")

    @patch("api.services.bin_discovery_service.BinDiscoveryService.discover_bin_locations")
    def test_existing_bin_locations_backward_compatibility(self, mock_discover):
        mock_discover.return_value = [
            {
                "AbsEntry": 142,
                "BinCode": "20201-F01-R01-C01-RA",
                "Description": "Test Bin Desc",
                "Warehouse": "20201",
                "Sublevel1": "F01",
                "Sublevel2": "R01",
                "Sublevel3": "C01",
                "Sublevel4": "RA",
                "Inactive": "tNO",
                "IsSystemBin": "tNO",
            }
        ]

        client = APIClient()
        response = client.get("/api/bin-locations/20201/")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data.get("success"))
        payload = data.get("data")
        self.assertEqual(payload["warehouse_code"], "20201")
        locations = payload["locations"]
        self.assertEqual(len(locations), 1)
        # Verify backward-compatible contract
        loc = locations[0]
        self.assertEqual(loc["code"], "20201-F01-R01-C01-RA")
        self.assertEqual(loc["absEntry"], 142)
        self.assertEqual(loc["description"], "Test Bin Desc")
        # Verify enriched fields
        self.assertEqual(loc["sublevel1"], "F01")
        self.assertEqual(loc["sublevel2"], "R01")
        self.assertEqual(loc["sublevel3"], "C01")
        self.assertEqual(loc["sublevel4"], "RA")
        self.assertEqual(loc["inactive"], False)
        self.assertEqual(loc["is_system_bin"], False)
