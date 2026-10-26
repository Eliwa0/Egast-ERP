"""Read-only access to SAP Business One Sales Orders.

SAP mapping
-----------
    Service Layer entity : Orders
    Header table         : ORDR
    Line table           : RDR1

The Delivery section of the Customization & Delivery module displays Sales Order
data only. SAP `Deliveries` (header `ODLN`, lines `DLN1`) is a reference mapping
for a later phase and is deliberately NOT read or created here.

This service issues `GET` requests only and writes nothing to the local database.
"""

from .sales_document_normalizer import (
    DELIVERY_DATE_FIELDS,
    SECTION_DELIVERY,
    normalize_delivery_header,
    normalize_sales_line,
    sap_local_currency,
)
from .sap_service import SAPServiceLayer


class SalesOrderReadError(Exception):
    """Raised when SAP cannot supply Sales Order data."""

    def __init__(self, message, sap_response=None):
        super().__init__(message)
        self.message = str(message)
        self.sap_response = sap_response or {}


def _sap_error_message(result, fallback):
    """Extract a human-readable message from a SAP error envelope."""
    error = result.get("error")
    if isinstance(error, dict):
        inner = error.get("message")
        if isinstance(inner, dict):
            inner = inner.get("value")
        if inner:
            return str(inner)
    if isinstance(error, str) and error.strip():
        return error.strip()
    return fallback


class SalesOrderService:
    """Reads Sales Orders (ORDR/RDR1) from SAP. Read-only."""

    SECTION = SECTION_DELIVERY
    DATE_FIELDS = DELIVERY_DATE_FIELDS
    ERROR_FALLBACK = "Unable to read Sales Order data from SAP."

    def __init__(self, sap_client=None):
        self.sap_client = sap_client or SAPServiceLayer()

    def list_documents(self, params):
        """Return one page of Sales Order headers."""
        page_size = params["page_size"]
        result = self.sap_client.get_sales_orders(
            doc_date_from=params.get("date_from"),
            doc_date_to=params.get("date_to"),
            document_status=params.get("document_status"),
            card_code=params.get("customer_code"),
            top=page_size + 1,
            skip=params.get("offset"),
        )

        if not isinstance(result, dict):
            raise SalesOrderReadError(self.ERROR_FALLBACK, {"response": result})

        if result.get("error"):
            raise SalesOrderReadError(
                _sap_error_message(result, self.ERROR_FALLBACK), result
            )

        rows = result.get("value") or []
        has_more = len(rows) > page_size or bool(result.get("@odata.nextLink") or result.get("odata.nextLink"))
        try:
            local_currency = sap_local_currency(self.sap_client)
        except ValueError as exc:
            raise SalesOrderReadError(str(exc)) from exc
        documents = [normalize_delivery_header(row, local_currency) for row in rows[:page_size]]

        return {
            "documents": documents,
            "count": len(documents),
            "page_size": page_size,
            "offset": params.get("offset", 0),
            "has_more": has_more,
            "next_offset": params.get("offset", 0) + len(documents) if has_more else None,
        }

    def get_document(self, doc_entry):
        """Return one Sales Order header together with its RDR1 lines."""
        result = self.sap_client.get_sales_order(doc_entry)

        if not isinstance(result, dict):
            raise SalesOrderReadError(self.ERROR_FALLBACK, {"response": result})

        if result.get("error"):
            raise SalesOrderReadError(
                _sap_error_message(result, "Sales Order not found in SAP."),
                result,
            )

        if not result:
            raise SalesOrderReadError("Sales Order not found in SAP.", result)

        try:
            local_currency = sap_local_currency(self.sap_client)
        except ValueError as exc:
            raise SalesOrderReadError(str(exc)) from exc
        document = normalize_delivery_header(result, local_currency)
        document["remarks"] = result.get("Comments") or document["remarks"]
        document["lines"] = [
            normalize_sales_line(line, result.get("DocCurrency"), local_currency) for line in (result.get("DocumentLines") or [])
        ]
        document["line_count"] = len(document["lines"])
        return document
