"""Read-only API endpoints for the Customization & Delivery module.

Two independent operations, each protected by its own permission key:

    /api/customization-delivery/documents/            -> Sales Quotations  (OQUT / QUT1)
    /api/customization-delivery/delivery-documents/   -> Sales Orders      (ORDR / RDR1)

Every view here is a `GET` endpoint. There is deliberately no `POST`, `PUT`,
`PATCH` or `DELETE` handler, and nothing is written to the local database or to
SAP. SAP `Deliveries` (`ODLN` / `DLN1`) is not part of this phase and is not
queried anywhere below.
"""

import logging

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET

from .role_permissions import MODULE_CUSTOMIZATION, MODULE_DELIVERY, require_module_access
from .services.sales_document_normalizer import normalize_list_params
from .services.sales_order_service import SalesOrderReadError, SalesOrderService
from .services.sales_quotation_service import (
    SalesQuotationReadError,
    SalesQuotationService,
)

logger = logging.getLogger(__name__)


@require_GET
@require_module_access(MODULE_CUSTOMIZATION)
def sales_order_document_detail(request, doc_entry):
    """Read a Sales Order using the same permission as its creation/list page."""
    try:
        document = SalesOrderService().get_document(doc_entry)
    except SalesOrderReadError as exc:
        return _service_error(exc.message)
    return JsonResponse({"success": True, "document": document})


def _bad_request(message):
    return JsonResponse({"success": False, "error": message}, status=400)


def _service_error(message):
    return JsonResponse({"success": False, "error": message}, status=502)


@csrf_exempt
@require_GET
@require_module_access(MODULE_CUSTOMIZATION)
def customization_documents(request):
    """List Sales Quotations (SAP `Quotations`, OQUT) - read only."""
    params = normalize_list_params(request.GET)

    try:
        payload = SalesQuotationService().list_documents(params)
    except SalesQuotationReadError as exc:
        logger.warning("Customization list failed: %s", exc.message)
        return _service_error(exc.message)

    return JsonResponse({"success": True, **payload})


@csrf_exempt
@require_GET
@require_module_access(MODULE_CUSTOMIZATION)
def customization_document_detail(request, doc_entry):
    """Read one Sales Quotation and its QUT1 lines."""
    try:
        normalized_entry = int(str(doc_entry).strip())
    except (TypeError, ValueError):
        return _bad_request("Invalid document reference.")

    try:
        document = SalesQuotationService().get_document(normalized_entry)
    except SalesQuotationReadError as exc:
        logger.warning("Customization detail %s failed: %s", normalized_entry, exc.message)
        return _service_error(exc.message)

    return JsonResponse({"success": True, "document": document})


@csrf_exempt
@require_GET
@require_module_access(MODULE_DELIVERY)
def delivery_documents(request):
    """List Sales Orders (SAP `Orders`, ORDR) - read only."""
    params = normalize_list_params(request.GET)

    try:
        payload = SalesOrderService().list_documents(params)
    except SalesOrderReadError as exc:
        logger.warning("Delivery list failed: %s", exc.message)
        return _service_error(exc.message)

    return JsonResponse({"success": True, **payload})


@csrf_exempt
@require_GET
@require_module_access(MODULE_DELIVERY)
def delivery_document_detail(request, doc_entry):
    """Read one Sales Order and its RDR1 lines."""
    try:
        normalized_entry = int(str(doc_entry).strip())
    except (TypeError, ValueError):
        return _bad_request("Invalid document reference.")

    try:
        document = SalesOrderService().get_document(normalized_entry)
    except SalesOrderReadError as exc:
        logger.warning("Delivery detail %s failed: %s", normalized_entry, exc.message)
        return _service_error(exc.message)

    return JsonResponse({"success": True, "document": document})
