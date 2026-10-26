"""Read-only normalization of SAP Business One sales documents into business terms.

Scope
-----
This module maps SAP Service Layer field names onto the operational vocabulary
used by the Customization & Delivery module (Document Number, Customer, Item,
Quantity, ...). It performs **no** SAP calls and **no** persistence.

It is deliberately strict about one rule: a value is either read from a field SAP
actually returned, or it is ``None``. Nothing is defaulted, derived or invented.
If SAP omits a field the UI renders a blank rather than a guessed value.

SAP table mapping enforced by this module
----------------------------------------
    Sales Quotation -> OQUT (header) / QUT1 (lines) -> Service Layer `Quotations`
    Sales Order     -> ORDR (header) / RDR1 (lines) -> Service Layer `Orders`
    Delivery        -> ODLN (header) / DLN1 (lines) -> reference only, not read

Note that ``RDT1`` is **not** a SAP Business One table and is never referenced.
"""

from datetime import date, datetime, timedelta

# Business section identifiers exposed to the frontend.
SECTION_CUSTOMIZATION = "customization"
SECTION_DELIVERY = "delivery"

# Hard ceiling on how many documents a single list page may return. SAP applies
# `$orderby` + `$top` so only the newest N headers are transferred.
MAX_PAGE_SIZE = 100
DEFAULT_PAGE_SIZE = 50

# Date-range look-back used only when a caller explicitly asks for a bounded
# window without supplying one. Never applied implicitly to the default listing.
DEFAULT_DATE_WINDOW_DAYS = 90

# The SAP `BoStatus` enum for a sales Document, confirmed against the live
# service: 'bost_Open'-'O', 'bost_Close'-'C', 'bost_Paid'-'P', 'bost_Delivered'-'D'.
# The raw SAP value is always returned alongside the label so the UI can fall
# back to it verbatim if SAP introduces a member that is not mapped here.
_DOCUMENT_STATUS_LABELS = {
    "bost_Open": "Open",
    "bost_Close": "Closed",
    "bost_Paid": "Paid",
    "bost_Delivered": "Delivered",
    # Short aliases are accepted by the SAP $filter, so handle them too.
    "O": "Open",
    "C": "Closed",
    "P": "Paid",
    "D": "Delivered",
}




def _text(value):
    """Return a trimmed string, or None when SAP returned nothing usable."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _sap_date(value):
    """Render a SAP date/timestamp as ``YYYY-MM-DD``.

    SAP returns dates as `2026-09-29T00:00:00Z`. Only the calendar date is
    exposed; any time component is dropped rather than reformatted, so the value
    always matches the date the user filters on.
    """
    if value in (None, ""):
        return None
    text = str(value).strip()
    if not text:
        return None
    return text.split("T", 1)[0] or None


def _number(value):
    """Return a numeric value as-is, or None when SAP returned nothing usable."""
    if value is None or value == "":
        return None
    return value


def _resolve_status(row):
    """Return ``(status_code, status_label)`` for a SAP sales document header.

    `DocumentStatus` is the only status property readable through Service Layer:
    SAP rejects `DocStatus` on a Document entity, so that legacy integer column is
    never relied upon here. Unmapped values are returned unchanged rather than
    being forced into a known label.
    """
    raw_status = row.get("DocumentStatus")
    if raw_status in (None, ""):
        return None, None
    code = str(raw_status).strip()
    return code, _DOCUMENT_STATUS_LABELS.get(code, code)


def document_currency_amount(row, local_field, foreign_field, currency, local_currency=None):
    """Keep SAP local and foreign amounts paired with their actual currency."""
    if isinstance(local_currency, str) and local_currency.strip() and currency:
        field = local_field if str(currency).upper() == local_currency.upper() else foreign_field
        return _number(row.get(field))
    # Without company context an amount cannot safely be labelled in a known
    # document currency. Unlabelled legacy lines retain their local raw amount.
    return None if currency else _number(row.get(local_field))


def sap_local_currency(client):
    value = client.get_local_currency()
    return value if isinstance(value, str) else None


def normalize_sales_line(line, document_currency=None, local_currency=None):
    """Map one SAP document line (QUT1 / RDR1 row) to business field names.

    `UomCode` is the SAP Service Layer unit-of-measures code. `MeasureUnit` is
    read only as a fallback for older payloads; it is never substituted when
    `UomCode` is present.
    """
    # `UoMCode` is the unit code on the live payload; `UomCode` (different casing)
    # is accepted too because OData $select is case sensitive per property and
    # older payloads use it. Neither is invented: an absent unit stays None.
    uom = _text(line.get("UoMCode")) or _text(line.get("UomCode"))
    if not uom:
        uom = _text(line.get("MeasureUnit"))

    rem_open = line.get("RemainingOpenQuantity")
    if rem_open is None:
        rem_open = line.get("OpenQuantity")
    if rem_open is None:
        rem_open = line.get("OpenQty")

    return {
        "line_number": _number(line.get("LineNum")),
        "item_code": _text(line.get("ItemCode")),
        "item_description": _text(line.get("ItemDescription")),
        "quantity": _number(line.get("Quantity")),
        "delivered_quantity": _number(line.get("DeliveredQuantity")),
        "remaining_open_quantity": _number(rem_open),
        "line_status": _text(line.get("LineStatus")),
        "base_type": _number(line.get("BaseType")),
        "base_entry": _number(line.get("BaseEntry")),
        "base_line": _number(line.get("BaseLine")),
        "uom": uom,
        "unit_price": _number(line.get("UnitPrice")),
        "line_total": document_currency_amount(line, "LineTotal", "RowTotalFC", document_currency or line.get("Currency"), local_currency),
        "currency": _text(document_currency or line.get("Currency")),
        "warehouse_code": _text(line.get("WarehouseCode")),
        "location_code": _text(line.get("LocationCode")),
        "ship_date": _sap_date(line.get("ShipDate")),
        "free_text": _text(line.get("FreeText")),
    }


def normalize_sales_header(row, section, date_fields, local_currency=None):
    """Map one SAP sales document header to business field names.

    `date_fields` names the business keys for the SAP `DocDate` / `DocDueDate`
    columns, because the same SAP fields carry different operational meaning for
    a Sales Quotation (Valid Until) and a Sales Order (Due Date).
    """
    status_code, status_label = _resolve_status(row)
    normalized = {
        "section": section,
        "document_entry": _number(row.get("DocEntry")),
        "document_number": _text(row.get("DocNum")),
        "customer_code": _text(row.get("CardCode")),
        "customer_name": _text(row.get("CardName")),
        "contact_person_code": _number(row.get("ContactPersonCode")),
        "currency": _text(row.get("DocCurrency")),
        "total_amount": document_currency_amount(row, "DocTotal", "DocTotalFc", row.get("DocCurrency"), local_currency),
        "status_code": status_code,
        "status_label": status_label,
        "remarks": _text(row.get("Remarks")),
        "document_date": _sap_date(row.get("DocDate")),
        "due_date": _sap_date(row.get("DocDueDate")),
    }
    for business_key, sap_key in date_fields.items():
        normalized[business_key] = _sap_date(row.get(sap_key))
    return normalized


CUSTOMIZATION_DATE_FIELDS = {
    # Sales Quotation (OQUT): DocDate is the quotation date, DocDueDate is "Valid Until".
    "quotation_date": "DocDate",
    "valid_until": "DocDueDate",
}

DELIVERY_DATE_FIELDS = {
    # Sales Order (ORDR): DocDate is the order date, DocDueDate is the promised due date.
    "order_date": "DocDate",
    "due_date": "DocDueDate",
}


def normalize_customization_header(row, local_currency=None):
    return normalize_sales_header(row, SECTION_CUSTOMIZATION, CUSTOMIZATION_DATE_FIELDS, local_currency)


def normalize_delivery_header(row, local_currency=None):
    return normalize_sales_header(row, SECTION_DELIVERY, DELIVERY_DATE_FIELDS, local_currency)


def parse_iso_date(value):
    """Parse an ``YYYY-MM-DD`` string into a ``date``, returning None on any problem."""
    if not value:
        return None
    try:
        return datetime.strptime(str(value).strip(), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def normalize_list_params(query_params):
    """Validate and clamp the list query parameters coming from the request.

    Every value here is an explicit caller choice; nothing is defaulted into a
    filter that SAP would not otherwise apply, apart from a bounded look-back
    window when the caller supplies `bounded=true`.
    """
    page_size = DEFAULT_PAGE_SIZE
    try:
        page_size = int(query_params.get("page_size", DEFAULT_PAGE_SIZE))
    except (TypeError, ValueError):
        page_size = DEFAULT_PAGE_SIZE
    page_size = max(1, min(page_size, MAX_PAGE_SIZE))

    try:
        offset = int(query_params.get("offset", 0))
    except (TypeError, ValueError):
        offset = 0
    offset = max(0, offset)

    date_from = parse_iso_date(query_params.get("date_from"))
    date_to = parse_iso_date(query_params.get("date_to"))

    # `bounded=true` asks for a recent window so the very first SAP call cannot
    # fan out across the whole sales document history.
    bounded = str(query_params.get("bounded", "")).strip().lower() in {"1", "true", "yes"}
    if bounded and date_to is None:
        date_to = date.today()
    if bounded and date_from is None:
        date_from = date_to - timedelta(days=DEFAULT_DATE_WINDOW_DAYS)

    if date_from and date_to and date_from > date_to:
        date_from, date_to = date_to, date_from

    document_status = _text(query_params.get("status"))
    customer_code = _text(query_params.get("customer_code"))

    return {
        "date_from": date_from.isoformat() if date_from else None,
        "date_to": date_to.isoformat() if date_to else None,
        "document_status": document_status,
        "customer_code": customer_code,
        "offset": offset,
        "page_size": page_size,
    }
