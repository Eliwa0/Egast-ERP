"""Cost Center cache architecture + Purchase Quotation payload dimension tests.

These tests verify the standardized cost-center caching:

- Cost centers use the central (Redis-backed) cache_service, never a process-local dict.
- Dimension 1 and Dimension 2 use distinct, per-company cache keys and never
  depend on each other.
- Successful SAP responses populate the shared cache; a SAP failure never
  overwrites last-known-good cached data; a cold cache + SAP failure returns the
  original 502 error.
- Purchase Quotation payloads map Dimension 1 -> CostingCode and Dimension 2 ->
  CostingCode2 and never allow a Dimension 2 code to slip into CostingCode.
"""

from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from .models import UserProfile
from .services.purchase_quotation_payload_builder import PurchaseQuotationPayloadBuilder


class _MemoryCacheStore:
    """Dict-backed shared cache store that replaces Redis for hermetic tests."""

    def __init__(self):
        self._store = {}

    def keys(self):
        return set(self._store.keys())

    def get(self, key, default=None):
        return self._store.get(key, default)

    def set(self, key, value, timeout=None):
        self._store[key] = value

    def delete(self, key):
        self._store.pop(key, None)

    def delete_many(self, keys):
        for key in keys:
            self._store.pop(key, None)

    def clear(self):
        self._store.clear()


def _rows_for_dimension(dimension=None):
    if dimension is None:
        return {
            "value": [
                {"CenterCode": "D1-A", "CenterName": "Dim One", "InWhichDimension": 1, "Active": "tYES"},
                {"CenterCode": "D2-A", "CenterName": "Dim Two", "InWhichDimension": 2, "Active": "tYES"},
            ]
        }
    return {
        "value": [{
            "CenterCode": f"D{dimension}-01",
            "CenterName": f"Dimension {dimension}",
            "InWhichDimension": dimension,
            "Active": "tYES",
        }]
    }


class CostCenterCacheArchitectureTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="costcenter_user", password="password123")
        UserProfile.objects.update_or_create(user=self.user, defaults={"role": "quality_admin"})
        self.client.force_login(self.user)

        self.cache_patcher = patch("api.services.cache_service.cache", new_callable=_MemoryCacheStore)
        self.store = self.cache_patcher.start()
        self.addCleanup(self.cache_patcher.stop)

        self.sap_patcher = patch("api.services.sap_service.SAPServiceLayer.get_profit_centers")
        self.mock_profit = self.sap_patcher.start()
        self.addCleanup(self.sap_patcher.stop)

    def test_successful_sap_response_populates_shared_cache_and_sets_cache_entry(self):
        self.mock_profit.side_effect = _rows_for_dimension

        response = self.client.get("/api/quality/cost-centers/?dimension=1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["cost_centers"][0]["code"], "D1-01")
        self.assertTrue(self.store.keys(), "a cache write should have occurred")
        written_keys = [key for key in self.store.keys() if "cost-centers" in key and ":1" in key]
        self.assertEqual(len(written_keys), 1)

    def test_dimension_one_and_two_use_distinct_keys(self):
        self.mock_profit.side_effect = _rows_for_dimension

        self.client.get("/api/quality/cost-centers/?dimension=1")
        self.client.get("/api/quality/cost-centers/?dimension=2")

        dim1_keys = [key for key in self.store.keys() if "cost-centers" in key and key.endswith(":1")]
        dim2_keys = [key for key in self.store.keys() if "cost-centers" in key and key.endswith(":2")]
        self.assertEqual(len(dim1_keys), 1)
        self.assertEqual(len(dim2_keys), 1)
        self.assertNotEqual(dim1_keys[0], dim2_keys[0])
        self.assertEqual(self.store.get(dim1_keys[0])[0]["code"], "D1-01")
        self.assertEqual(self.store.get(dim2_keys[0])[0]["code"], "D2-01")

    def test_dimensions_are_independent_of_each_other(self):
        def rows(dimension=None):
            if dimension == 2:
                return {"error": "SAP down"}
            return _rows_for_dimension(dimension)

        self.mock_profit.side_effect = rows

        location = self.client.get("/api/quality/cost-centers/?dimension=1")
        general = self.client.get("/api/quality/cost-centers/?dimension=2")

        self.assertEqual(location.status_code, 200)
        self.assertEqual(location.json()["cost_centers"][0]["code"], "D1-01")
        self.assertEqual(general.status_code, 502)

    def test_second_request_hits_shared_cache_not_sap(self):
        self.mock_profit.side_effect = _rows_for_dimension

        first = self.client.get("/api/quality/cost-centers/?dimension=1")
        second = self.client.get("/api/quality/cost-centers/?dimension=1")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["cost_centers"][0]["code"], "D1-01")
        self.assertEqual(self.mock_profit.call_count, 1, "the shared cache serves the second request")

    def test_sap_failure_never_overwrites_last_known_good_data(self):
        self.mock_profit.side_effect = _rows_for_dimension

        first = self.client.get("/api/quality/cost-centers/?dimension=1")
        self.assertEqual(first.status_code, 200)

        self.mock_profit.return_value = {"error": "Service Layer unreachable"}

        second = self.client.get("/api/quality/cost-centers/?dimension=1")

        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["success"], True)
        self.assertEqual(second.json()["cost_centers"][0]["code"], "D1-01")
        self.assertEqual(self.mock_profit.call_count, 1, "last-known-good cache is served; SAP is not retried")

    def test_cold_cache_with_sap_failure_returns_original_error(self):
        self.mock_profit.return_value = {"error": "Service Layer unreachable"}

        response = self.client.get("/api/quality/cost-centers/?dimension=1")

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["success"], False)
        self.assertEqual(response.json()["cost_centers"], [])

    def test_no_process_local_cost_center_cache_remains(self):
        from . import quality_views

        self.assertFalse(hasattr(quality_views, "_IN_MEMORY_COST_CENTERS"))

    def test_dimension_validation_is_preserved(self):
        response = self.client.get("/api/quality/cost-centers/?dimension=9")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "dimension must be 1 or 2")


class PurchaseQuotationCostCenterDimensionTests(APITestCase):
    """Payload mapping: Dimension 1 -> CostingCode, Dimension 2 -> CostingCode2."""

    def setUp(self):
        self.cache_patcher = patch("api.services.cache_service.cache", new_callable=_MemoryCacheStore)
        self.store = self.cache_patcher.start()
        self.addCleanup(self.cache_patcher.stop)

        self.sap_patcher = patch("api.services.sap_service.SAPServiceLayer.get_profit_centers")
        self.mock_profit = self.sap_patcher.start()
        self.addCleanup(self.sap_patcher.stop)
        self.mock_profit.side_effect = _rows_for_dimension

    def _populate_cache(self):
        # Populate the shared cost-center cache the same way the API does.
        from .services.cache_service import build_cache_key, cache_set, sap_master_namespace

        namespace = sap_master_namespace("cost-centers")
        for dim in (1, 2):
            rows = [_rows_for_dimension(dim)["value"][0]]
            normalized = [{
                "code": str(rows[0]["CenterCode"]).strip(),
                "name": rows[0]["CenterName"],
                "dimension": int(rows[0]["InWhichDimension"]),
            }]
            cache_set(namespace, build_cache_key(namespace, dim), normalized, "sap_cost_centers")

    def _build_draft(self, costing_code, dimension=None):
        lines = [{
            "item_code": "RAW-001",
            "quoted_qty": 1,
            "required_qty": 1,
            "unit_price": 5,
            "costing_code": costing_code,
        }]
        if dimension is not None:
            lines[0]["cost_center_dimension"] = dimension
        return SimpleNamespace(
            vendor_card_code="V-001",
            vendor_name="Vendor",
            lines=lines,
            posting_date="2026-09-02",
            document_date="2026-09-02",
            valid_until="2026-12-31",
            remarks="",
            vehicle_number=None,
            container_quantity=None,
            contact_person_code=None,
            vendor_ref_no=None,
            currency=None,
            group_no=None,
            required_date=None,
            buyer_code=None,
            owner_code=None,
            journal_remark=None,
            discount_percent=None,
            freight=None,
            rounding=None,
        )

    def test_dimension_one_cost_code_maps_to_costing_code(self):
        self._populate_cache()
        payload = PurchaseQuotationPayloadBuilder().build(self._build_draft("D1-01"))
        line = payload["DocumentLines"][0]
        self.assertEqual(line.get("CostingCode"), "D1-01")
        self.assertNotIn("CostingCode2", line)

    def test_dimension_two_cost_code_maps_to_costing_code2(self):
        self._populate_cache()
        payload = PurchaseQuotationPayloadBuilder().build(self._build_draft("D2-01"))
        line = payload["DocumentLines"][0]
        self.assertEqual(line.get("CostingCode2"), "D2-01")
        self.assertNotIn("CostingCode", line)

    def test_dimension_two_never_drops_into_costing_code_regression(self):
        # Regression: the old code looked up _IN_MEMORY_COST_CENTERS.get("rows"),
        # which always returned [] so Dimension 2 codes fell through to CostingCode
        # unless the "210" prefix heuristic matched. With the shared Redis cache,
        # a Dimension 2 code must land in CostingCode2.
        self._populate_cache()
        payload = PurchaseQuotationPayloadBuilder().build(self._build_draft("D2-01"))
        line = payload["DocumentLines"][0]
        self.assertNotEqual(line.get("CostingCode"), "D2-01")
        self.assertEqual(line.get("CostingCode2"), "D2-01")

    def test_explicit_dimension_two_resolves_without_cache(self):
        # Explicit cost_center_dimension must win and needs no cache lookup.
        self.mock_profit.return_value = {"error": "SAP down"}
        payload = PurchaseQuotationPayloadBuilder().build(self._build_draft("D2-99", dimension=2))
        line = payload["DocumentLines"][0]
        self.assertEqual(line.get("CostingCode2"), "D2-99")
        self.assertNotIn("CostingCode", line)