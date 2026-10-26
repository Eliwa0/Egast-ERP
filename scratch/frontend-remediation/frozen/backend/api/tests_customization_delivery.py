"""Tests for the read-only Customization & Delivery module.

These tests assert three things that matter most for this module:

1. No write verb is ever accepted on the endpoints (405 / read-only).
2. The SAP layer only ever issues ``GET`` for ``Quotations`` and ``Orders``.
3. Permission keys stay independent: Customization access must not open Delivery.

SAP is mocked throughout, so no live SAP credentials are required.
"""

from unittest.mock import Mock, patch

from django.contrib.auth.models import User
from django.test import TestCase

from api.models import UserModulePermission, UserProfile
from api.services.sales_document_normalizer import (
    MAX_PAGE_SIZE,
    normalize_customization_header,
    normalize_delivery_header,
    normalize_list_params,
    normalize_sales_header,
    normalize_sales_line,
)
from api.services.sales_order_service import SalesOrderService
from api.services.sales_quotation_service import SalesQuotationService
from api.services.sap_service import SAPServiceLayer

QUOTATION_HEADER = {
    "DocEntry": 1001,
    "DocNum": "Q-1001",
    "DocDate": "2026-01-15T00:00:00Z",
    "DocDueDate": "2026-02-15T00:00:00Z",
    "CardCode": "C20000",
    "CardName": "Sample Customer",
    "DocCurrency": "USD",
    "DocumentStatus": "bost_Open",
}

QUOTATION_LINE = {
    "LineNum": 0,
    "ItemCode": "M0001",
    "ItemDescription": "Sample Item",
    "Quantity": 5,
    "UoMCode": "EA",
    "UnitPrice": 10.5,
    "LineTotal": 52.5,
    "WarehouseCode": "01",
    "LocationCode": "-",
}

ORDER_HEADER = {
    "DocEntry": 2001,
    "DocNum": "S-2001",
    "DocDate": "2026-01-20T00:00:00Z",
    "DocDueDate": "2026-02-20T00:00:00Z",
    "CardCode": "C20000",
    "CardName": "Sample Customer",
    "DocCurrency": "USD",
    "DocumentStatus": "bost_Open",
}


def _grant(user, module, level=UserModulePermission.LEVEL_USER):
    return UserModulePermission.objects.create(user=user, module=module, level=level)


def _make_user(username, *, super_admin=False, modules=()):
    # `api.signals` already creates a UserProfile on user creation, so update it
    # rather than creating a duplicate.
    user = User.objects.create_user(username=username, password="pw")
    profile, _ = UserProfile.objects.get_or_create(user=user)
    profile.role = "super_admin" if super_admin else "production_user"
    profile.module_permissions_initialized = True
    profile.save(update_fields=["role", "module_permissions_initialized"])
    for module in modules:
        _grant(user, module)
    return user


class NormalizerTests(TestCase):
    def test_customization_header_uses_quotation_vocabulary(self):
        record = normalize_customization_header(QUOTATION_HEADER)

        self.assertEqual(record["section"], "customization")
        self.assertEqual(record["quotation_date"], "2026-01-15")
        self.assertEqual(record["valid_until"], "2026-02-15")
        self.assertEqual(record["status_label"], "Open")
        self.assertEqual(record["document_date"], "2026-01-15")

    def test_delivery_header_uses_order_vocabulary(self):
        record = normalize_delivery_header(ORDER_HEADER)

        self.assertEqual(record["section"], "delivery")
        self.assertEqual(record["order_date"], "2026-01-20")
        self.assertEqual(record["due_date"], "2026-02-20")
        self.assertEqual(record["document_date"], "2026-01-20")

    def test_missing_fields_become_none_rather_than_guesses(self):
        record = normalize_customization_header({"DocEntry": 5, "DocNum": "Q-5"})

        self.assertEqual(record["document_number"], "Q-5")
        self.assertIsNone(record["customer_code"])
        self.assertIsNone(record["quotation_date"])
        self.assertIsNone(record["status_code"])
        self.assertIsNone(record["status_label"])

    def test_unknown_status_code_is_passed_through_untranslated(self):
        record = normalize_customization_header(
            {"DocEntry": 1, "DocumentStatus": "bost_Future"}
        )

        self.assertEqual(record["status_code"], "bost_Future")
        self.assertEqual(record["status_label"], "bost_Future")

    def test_header_select_omits_the_invalid_docstatus_property(self):
        """SAP rejects `DocStatus` on a Document, so it must not be requested."""
        self.assertNotIn("DocStatus", SAPServiceLayer.SALES_DOCUMENT_HEADER_FIELDS)
        self.assertNotIn("DocStatus", SAPServiceLayer.SALES_DOCUMENT_FALLBACK_FIELDS)

    def test_line_normalization_prefers_uom_code(self):
        record = normalize_sales_line(QUOTATION_LINE)

        self.assertEqual(record["uom"], "EA")
        self.assertEqual(record["item_code"], "M0001")
        self.assertEqual(record["quantity"], 5)
        self.assertEqual(record["warehouse_code"], "01")
        self.assertEqual(record["location_code"], "-")

    def test_line_uom_falls_back_to_measure_unit(self):
        record = normalize_sales_line({"LineNum": 0, "MeasureUnit": "KG"})

        self.assertEqual(record["uom"], "KG")

    def test_line_uom_is_none_when_sap_omits_it(self):
        record = normalize_sales_line({"LineNum": 0, "Quantity": 2})

        self.assertIsNone(record["uom"])

    def test_sap_timestamps_are_reduced_to_calendar_dates(self):
        record = normalize_sales_header(
            {"DocEntry": 1, "DocDate": "2026-09-29T00:00:00Z", "DocDueDate": "2026-10-29T00:00:00Z"},
            "customization",
            {"quotation_date": "DocDate", "valid_until": "DocDueDate"},
        )

        self.assertEqual(record["quotation_date"], "2026-09-29")
        self.assertEqual(record["valid_until"], "2026-10-29")

    def test_live_status_enum_values_are_labelled(self):
        for sap_value, expected in (
            ("bost_Open", "Open"),
            ("bost_Close", "Closed"),
            ("bost_Paid", "Paid"),
            ("bost_Delivered", "Delivered"),
        ):
            with self.subTest(sap_value=sap_value):
                record = normalize_customization_header(
                    {"DocEntry": 1, "DocumentStatus": sap_value}
                )
                self.assertEqual(record["status_code"], sap_value)
                self.assertEqual(record["status_label"], expected)

    def test_list_params_are_clamped_to_max_page_size(self):
        params = normalize_list_params({"page_size": "100000"})

        self.assertEqual(params["page_size"], MAX_PAGE_SIZE)

    def test_list_params_reject_invented_filters_by_default(self):
        params = normalize_list_params({})

        self.assertIsNone(params["date_from"])
        self.assertIsNone(params["date_to"])
        self.assertIsNone(params["document_status"])
        self.assertIsNone(params["customer_code"])

    def test_list_params_bound_a_window_only_when_asked(self):
        params = normalize_list_params({"bounded": "true"})

        self.assertIsNotNone(params["date_from"])
        self.assertIsNotNone(params["date_to"])


class SalesQuotationServiceTests(TestCase):
    def test_list_uses_quotations_entity_and_reports_has_more(self):
        client = Mock()
        rows = [dict(QUOTATION_HEADER, DocEntry=i) for i in range(3)]
        client.get_sales_quotations.return_value = {"value": rows}

        result = SalesQuotationService(client).list_documents(
            normalize_list_params({"page_size": "2"})
        )

        self.assertEqual(client.get_sales_quotations.call_count, 1)
        kwargs = client.get_sales_quotations.call_args.kwargs
        self.assertEqual(kwargs["top"], 3)  # one look-ahead row for has_more
        self.assertTrue(result["has_more"])
        self.assertEqual(result["count"], 2)

    def test_detail_returns_normalized_lines(self):
        client = Mock()
        client.get_sales_quotation.return_value = {
            **QUOTATION_HEADER,
            "DocumentLines": [QUOTATION_LINE],
        }

        document = SalesQuotationService(client).get_document(1001)

        client.get_sales_quotation.assert_called_once_with(1001)
        self.assertEqual(document["line_count"], 1)
        self.assertEqual(document["lines"][0]["item_code"], "M0001")


class SalesOrderServiceTests(TestCase):
    def test_list_uses_orders_entity(self):
        client = Mock()
        client.get_sales_orders.return_value = {"value": [ORDER_HEADER]}

        result = SalesOrderService(client).list_documents(normalize_list_params({}))

        self.assertEqual(result["count"], 1)
        self.assertFalse(result["has_more"])
        self.assertEqual(result["documents"][0]["section"], "delivery")

    def test_detail_uses_orders_entity(self):
        client = Mock()
        client.get_sales_order.return_value = {**ORDER_HEADER, "DocumentLines": []}

        document = SalesOrderService(client).get_document(2001)

        client.get_sales_order.assert_called_once_with(2001)
        self.assertEqual(document["line_count"], 0)


class SapReadOnlyTests(TestCase):
    """The real SAP client must never issue anything but GET for these entities."""

    def _sap_with_recorded_requests(self, responses):
        sap = SAPServiceLayer.__new__(SAPServiceLayer)
        sap._sales_local_currency = "EGP"
        sap._request = Mock(side_effect=responses)
        return sap

    def test_quotation_reads_issue_get_against_expected_entities(self):
        sap = self._sap_with_recorded_requests(
            [{"value": [QUOTATION_HEADER]}, {**QUOTATION_HEADER, "DocumentLines": []}]
        )

        service = SalesQuotationService(sap)
        service.list_documents(normalize_list_params({}))
        service.get_document(1001)

        for call in sap._request.call_args_list:
            self.assertEqual(call.args[0], "GET", "only GET may reach SAP")
        endpoints = [call.args[1].split("?")[0] for call in sap._request.call_args_list]
        self.assertEqual(endpoints, ["Quotations", "Quotations(1001)"])

    def test_order_reads_issue_get_against_expected_entities(self):
        sap = self._sap_with_recorded_requests(
            [{"value": [ORDER_HEADER]}, {**ORDER_HEADER, "DocumentLines": []}]
        )

        service = SalesOrderService(sap)
        service.list_documents(normalize_list_params({}))
        service.get_document(2001)

        for call in sap._request.call_args_list:
            self.assertEqual(call.args[0], "GET", "only GET may reach SAP")
        endpoints = [call.args[1].split("?")[0] for call in sap._request.call_args_list]
        self.assertEqual(endpoints, ["Orders", "Orders(2001)"])

    def test_detail_does_not_use_an_invalid_expand(self):
        """SAP rejects `$expand=DocumentLines`; lines arrive inline instead."""
        sap = self._sap_with_recorded_requests([{**QUOTATION_HEADER, "DocumentLines": []}])

        SalesQuotationService(sap).get_document(1001)

        endpoint = sap._request.call_args[0][1]
        self.assertNotIn("$expand", endpoint)
        self.assertEqual(endpoint, "Quotations(1001)")

    def test_detail_reads_inline_document_lines(self):
        sap = self._sap_with_recorded_requests(
            [{**QUOTATION_HEADER, "DocumentLines": [QUOTATION_LINE]}]
        )

        document = SalesQuotationService(sap).get_document(1001)

        self.assertEqual(document["line_count"], 1)

    def test_list_never_registers_an_sql_query(self):
        """`ensure_sql_query` would require a SAP POST, so it must never be used."""
        sap = self._sap_with_recorded_requests([{"value": []}])

        with patch.object(
            SAPServiceLayer, "ensure_sql_query", side_effect=AssertionError("write attempted")
        ) as register:
            SalesQuotationService(sap).list_documents(normalize_list_params({}))

        register.assert_not_called()

    def test_odata_literals_are_escaped(self):
        escaped = SAPServiceLayer._escape_odata_literal("O'Brien")
        self.assertEqual(escaped, "O''Brien")


class EndpointTests(TestCase):
    def setUp(self):
        self.customization_url = "/api/customization-delivery/documents/"
        self.delivery_url = "/api/customization-delivery/delivery-documents/"
        self.customization_detail_url = "/api/customization-delivery/documents/1001/"
        self.delivery_detail_url = "/api/customization-delivery/delivery-documents/2001/"

    def test_requires_authentication(self):
        response = self.client.get(self.customization_url)
        self.assertIn(response.status_code, (401, 302))

    def test_customization_denies_user_without_permission(self):
        user = _make_user("no_perm", modules=[])
        self.client.force_login(user)

        response = self.client.get(self.customization_url)

        self.assertEqual(response.status_code, 403)

    def test_delivery_denied_for_customization_only_user(self):
        """Holding Customization must not grant Delivery."""
        user = _make_user("custom_only", modules=[UserModulePermission.MODULE_CUSTOMIZATION])
        self.client.force_login(user)

        with patch(
            "api.services.sales_order_service.SalesOrderService.list_documents"
        ) as listing:
            listing.return_value = {"documents": [], "count": 0, "has_more": False}
            self.assertEqual(self.client.get(self.delivery_url).status_code, 403)
        listing.assert_not_called()

    def test_customization_and_delivery_permissions_are_independent(self):
        user = _make_user("delivery_only", modules=[UserModulePermission.MODULE_DELIVERY])
        self.client.force_login(user)

        self.assertEqual(self.client.get(self.customization_url).status_code, 403)
        self.assertEqual(self.client.get(self.customization_detail_url).status_code, 403)

    def test_super_admin_reaches_both(self):
        user = _make_user("root", super_admin=True, modules=[])
        self.client.force_login(user)

        with patch("api.services.sales_order_service.SalesOrderService.list_documents") as listing:
            listing.return_value = {"documents": [], "count": 0, "has_more": False}
            self.assertEqual(self.client.get(self.delivery_url).status_code, 200)

    def test_list_returns_normalized_payload(self):
        user = _make_user("reader", modules=[UserModulePermission.MODULE_CUSTOMIZATION])
        self.client.force_login(user)

        with patch(
            "api.services.sales_quotation_service.SalesQuotationService.list_documents"
        ) as listing:
            listing.return_value = {
                "documents": [normalize_customization_header(QUOTATION_HEADER)],
                "count": 1,
                "page_size": 50,
                "offset": 0,
                "has_more": False,
            }
            response = self.client.get(self.customization_url)

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["documents"][0]["document_number"], "Q-1001")

    def test_detail_returns_document(self):
        user = _make_user("reader2", modules=[UserModulePermission.MODULE_DELIVERY])
        self.client.force_login(user)

        with patch(
            "api.services.sales_order_service.SalesOrderService.get_document"
        ) as detail:
            detail.return_value = normalize_delivery_header(ORDER_HEADER)
            response = self.client.get(self.delivery_detail_url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["document"]["document_number"], "S-2001")

    def test_detail_surfaces_sap_failure_as_502(self):
        from api.services.sales_order_service import SalesOrderReadError

        user = _make_user("reader3", modules=[UserModulePermission.MODULE_DELIVERY])
        self.client.force_login(user)

        with patch(
            "api.services.sales_order_service.SalesOrderService.get_document",
            side_effect=SalesOrderReadError("SAP unavailable"),
        ):
            response = self.client.get(self.delivery_detail_url)

        self.assertEqual(response.status_code, 502)
        self.assertIn("SAP unavailable", response.json()["error"])

    def test_write_verbs_are_rejected(self):
        user = _make_user("writer", super_admin=True, modules=[])
        self.client.force_login(user)

        for url in (self.customization_url, self.delivery_url):
            for verb in ("post", "put", "patch", "delete"):
                response = getattr(self.client, verb)(url)
                self.assertEqual(
                    response.status_code, 405, f"{verb.upper()} {url} must be rejected"
                )

    def test_non_numeric_document_reference_is_not_routed(self):
        user = _make_user("reader4", super_admin=True, modules=[])
        self.client.force_login(user)

        response = self.client.get("/api/customization-delivery/documents/abc/")

        self.assertEqual(response.status_code, 404)
