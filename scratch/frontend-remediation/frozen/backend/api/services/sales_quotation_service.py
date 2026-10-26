"""Read-only access to SAP Business One Sales Quotations.

SAP mapping
-----------
    Service Layer entity : Quotations
    Header table         : OQUT
    Line table           : QUT1

This service issues `GET` requests only. It never creates, updates, closes or
cancels a Sales Quotation, and it writes nothing to the local database.
"""

from .sales_document_normalizer import (
    CUSTOMIZATION_DATE_FIELDS,
    SECTION_CUSTOMIZATION,
    normalize_customization_header,
    normalize_sales_line,
    sap_local_currency,
)
from .sap_service import SAPServiceLayer


class SalesQuotationReadError(Exception):
    """Raised when SAP cannot supply Sales Quotation data."""

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


class SalesQuotationService:
    """Reads Sales Quotations (OQUT/QUT1) from SAP. Read-only."""

    SECTION = SECTION_CUSTOMIZATION
    DATE_FIELDS = CUSTOMIZATION_DATE_FIELDS
    ERROR_FALLBACK = "Unable to read Sales Quotation data from SAP."

    def __init__(self, sap_client=None):
        self.sap_client = sap_client or SAPServiceLayer()

    def list_documents(self, params):
        """Return one page of Sales Quotation headers.

        One extra row beyond the requested page size is fetched so the response can
        honestly report `has_more` instead of guessing.
        """
        page_size = params["page_size"]
        result = self.sap_client.get_sales_quotations(
            doc_date_from=params.get("date_from"),
            doc_date_to=params.get("date_to"),
            document_status=params.get("document_status"),
            card_code=params.get("customer_code"),
            top=page_size + 1,
            skip=params.get("offset"),
        )

        if not isinstance(result, dict):
            raise SalesQuotationReadError(self.ERROR_FALLBACK, {"response": result})

        if result.get("error"):
            raise SalesQuotationReadError(
                _sap_error_message(result, self.ERROR_FALLBACK), result
            )

        rows = result.get("value") or []
        has_more = len(rows) > page_size or bool(result.get("@odata.nextLink") or result.get("odata.nextLink"))
        try:
            local_currency = sap_local_currency(self.sap_client)
        except ValueError as exc:
            raise SalesQuotationReadError(str(exc)) from exc
        documents = [normalize_customization_header(row, local_currency) for row in rows[:page_size]]

        return {
            "documents": documents,
            "count": len(documents),
            "page_size": page_size,
            "offset": params.get("offset", 0),
            "has_more": has_more,
            "next_offset": params.get("offset", 0) + len(documents) if has_more else None,
        }

    def get_document(self, doc_entry):
        """Return one Sales Quotation header together with its QUT1 lines."""
        result = self.sap_client.get_sales_quotation(doc_entry)

        if not isinstance(result, dict):
            raise SalesQuotationReadError(self.ERROR_FALLBACK, {"response": result})

        if result.get("error"):
            raise SalesQuotationReadError(
                _sap_error_message(result, "Sales Quotation not found in SAP."),
                result,
            )

        if not result:
            raise SalesQuotationReadError("Sales Quotation not found in SAP.", result)

        try:
            local_currency = sap_local_currency(self.sap_client)
        except ValueError as exc:
            raise SalesQuotationReadError(str(exc)) from exc
        document = normalize_customization_header(result, local_currency)
        document["lines"] = [
            normalize_sales_line(line, result.get("DocCurrency"), local_currency) for line in (result.get("DocumentLines") or [])
        ]
        document["line_count"] = len(document["lines"])
        return document
