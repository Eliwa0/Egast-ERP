import logging
from math import isfinite
from typing import Any, Dict, List, Optional
from django.db import transaction
from django.utils import timezone

from api.models_customization import CustomizationDraft, CustomizationDraftLine
from api.services.customization_patch_builder import (
    CustomizationExternalChangeError,
    CustomizationPatchBuilder,
    CustomizationPatchValidationError,
)
from api.services.sales_order_payload_builder import (
    SalesOrderPayloadBuilder,
    SalesOrderPayloadValidationError,
)
from api.services.sap_service import SAPServiceLayer
from api.services.sales_order_service import _sap_error_message

logger = logging.getLogger(__name__)


class CustomizationStateError(ValueError):
    pass


class CustomizationPostingError(Exception):
    def __init__(self, message, sap_response=None, is_ambiguous=False):
        super().__init__(message)
        self.message = str(message)
        self.sap_response = sap_response or {}
        self.is_ambiguous = is_ambiguous


class CustomizationService:
    """
    Manages the full Customization Draft lifecycle:
    Draft -> Internal Review -> SAP Quotation PATCH -> Customer Approval Gate -> Native Sales Order Posting.
    """

    def __init__(self, sap_client=None):
        self.sap_client = sap_client or SAPServiceLayer()
        self.patch_builder = CustomizationPatchBuilder()
        self.order_builder = SalesOrderPayloadBuilder()

    DEFAULT_QUOTATION_CURRENCY = "USD"

    def create_quotation_and_draft(
        self,
        user,
        customer_code: str,
        customer_name: str = "",
        doc_date: str = None,
        doc_due_date: str = None,
        comments: str = "",
        lines_data: List[Dict[str, Any]] = None,
        currency: str = None,
        payment_group_code: Any = None,
        contact_person_code: Any = None,
        sales_person_code: Any = None,
        wrapping: str = None,
        tax_date: str = None,
        doc_rate: Any = None,
        header_fields: Dict[str, Any] = None,
        request_key: str = None,
    ) -> CustomizationDraft:
        """
        Layer 1 entry point:
        1. Posts new Sales Quotation to SAP (POST /b1s/v1/Quotations).
        2. Captures returned DocEntry & DocNum.
        3. Creates local CustomizationDraft and lines with is_local_creation=True.
        """
        if not customer_code:
            raise CustomizationStateError("Customer is required to create a Sales Quotation.")
        if not lines_data:
            raise CustomizationStateError("At least one line item is required.")

        currency = str(currency or self.DEFAULT_QUOTATION_CURRENCY).strip() or self.DEFAULT_QUOTATION_CURRENCY

        today_str = timezone.now().strftime("%Y-%m-%d")
        posting_date = doc_date or today_str
        due_date = doc_due_date or today_str

        sap_lines = []
        for line in lines_data:
            item_code = str(line.get("item_code") or "").strip()
            if not item_code:
                raise CustomizationStateError("Item code is required for each line.")
            try:
                qty = float(line.get("quantity", line.get("customized_quantity", 1.0)))
            except (TypeError, ValueError):
                raise CustomizationStateError(f"Quantity for item '{item_code}' must be greater than zero.")
            if not isfinite(qty) or qty <= 0:
                raise CustomizationStateError(f"Quantity for item '{item_code}' must be greater than zero.")
            price = float(line.get("unit_price", line.get("customized_unit_price", 0.0)) or 0.0)

            sap_line = {
                "ItemCode": item_code,
                "Quantity": qty,
                "UnitPrice": price,
            }
            whs = str(line.get("warehouse_code") or "").strip()
            if whs:
                sap_line["WarehouseCode"] = whs

            uom_entry = line.get("uom_entry")
            if uom_entry not in (None, ""):
                sap_line["UoMEntry"] = int(uom_entry)

            discount_percent = line.get("discount_percent")
            if discount_percent not in (None, ""):
                sap_line["DiscountPercent"] = float(discount_percent)

            # Line UDFs (Brand, Size, Pallets only)
            brand = str(line.get("u_brand") or "").strip()
            if brand:
                sap_line["U_Brand"] = brand

            size = str(line.get("u_size") or "").strip()
            if size:
                sap_line["U_size"] = size

            pallets = line.get("u_pallets")
            if pallets not in (None, ""):
                sap_line["U_Pallets"] = str(pallets).strip()

            for line_field, sap_key in {
                "u_container_no": "U_Container_no",
                "u_packed": "U_PACKED",
                "u_defect": "U_Defect",
            }.items():
                value = line.get(line_field)
                if value in (None, ""):
                    continue
                sap_line[sap_key] = float(value) if line_field == "u_packed" else str(value).strip()

            free_txt = str(line.get("free_text") or "").strip()
            if free_txt:
                sap_line["FreeText"] = free_txt

            tax_code = str(line.get("tax_code") or line.get("TaxCode") or line.get("VatGroup") or "").strip()
            if tax_code:
                sap_line["TaxCode"] = tax_code
                sap_line["VatGroup"] = tax_code
            sap_lines.append(sap_line)

        payload = {
            "CardCode": customer_code,
            "DocDate": posting_date,
            "DocDueDate": due_date,
            "Comments": comments or "Created from Customization & Delivery module",
            "DocumentLines": sap_lines,
        }
        if tax_date:
            payload["TaxDate"] = tax_date
        if doc_rate not in (None, ""):
            payload["DocRate"] = float(doc_rate)
        if currency:
            payload["DocCurrency"] = currency
        if payment_group_code not in (None, ""):
            try:
                payload["PaymentGroupCode"] = int(payment_group_code)
            except (ValueError, TypeError):
                pass
        if sales_person_code not in (None, ""):
            try:
                payload["SalesPersonCode"] = int(sales_person_code)
            except (ValueError, TypeError):
                pass
        if wrapping not in (None, ""):
            payload["U_Wrapping"] = str(wrapping)

        header_map = {
            "po_number": "NumAtCard",
            "ship_to_code": "ShipToCode",
            "pay_to_code": "PayToCode",
            "transportation_code": "TransportationCode",
            "contract_no": "U_Contract_no",
            "lc_number": "U_LC",
            "container_count": "U_TCON",
            "header_uom": "U_UOM",
            "week_no": "U_week_no",
            "shipping_line": "U_Shipping",
            "etd": "U_ETD",
            "eta": "U_ETA",
            "incoterms": "U_Shipment",
            "pol": "U_POL",
            "pod": "U_POD",
            "notify": "U_Notify",
            "dhl": "U_DHL",
        }
        for header_key, sap_key in header_map.items():
            value = (header_fields or {}).get(header_key)
            if value in (None, ""):
                continue
            payload[sap_key] = int(value) if header_key in {"transportation_code", "week_no"} else str(value).strip()

        from .sales_posting_journal import SalesPostingJournal, PostingPending
        request_data = dict(customer_code=customer_code, customer_name=customer_name, doc_date=posting_date,
            doc_due_date=due_date, comments=comments, lines_data=lines_data, currency=currency,
            payment_group_code=payment_group_code, contact_person_code=contact_person_code,
            sales_person_code=sales_person_code, wrapping=wrapping, tax_date=tax_date,
            doc_rate=doc_rate, header_fields=header_fields)
        try:
            result = SalesPostingJournal(user, self.sap_client, 'Quotations', request_key).post(payload, request_data, send=self.sap_client.create_sales_quotation)
        except PostingPending as exc:
            raise CustomizationPostingError(str(exc), is_ambiguous=True) from exc
        if not isinstance(result, dict) or result.get("error") or not result.get("DocEntry"):
            error_msg = _sap_error_message(result if isinstance(result, dict) else {}, "SAP did not confirm quotation creation.")
            ambiguous = not (isinstance(result, dict) and isinstance(result.get("error"), dict))
            raise CustomizationPostingError(f"Sales Quotation creation was not confirmed: {error_msg}" if ambiguous else f"SAP rejected Sales Quotation creation: {error_msg}", result, is_ambiguous=ambiguous)

        doc_entry = int(result.get("DocEntry"))
        existing = CustomizationDraft.objects.filter(quotation_doc_entry=doc_entry, is_local_creation=True).first()
        if existing:
            return existing
        verified_result = self.sap_client.get_sales_quotation(doc_entry)
        if isinstance(verified_result, dict) and not verified_result.get("error"):
            result = verified_result
        doc_num = str(result.get("DocNum") or doc_entry)
        resolved_card_name = customer_name or str(result.get("CardName") or "")

        with transaction.atomic():
            from django.contrib.auth.models import User
            User.objects.select_for_update().get(pk=user.pk)
            existing = CustomizationDraft.objects.filter(quotation_doc_entry=doc_entry, is_local_creation=True).first()
            if existing:
                return existing
            draft = CustomizationDraft.objects.create(
                quotation_doc_entry=doc_entry,
                quotation_doc_num=doc_num,
                customer_code=customer_code,
                customer_name=resolved_card_name,
                status=CustomizationDraft.STATUS_READY_FOR_ORDER,
                original_sap_snapshot=result,
                currency=result.get("DocCurrency") or currency,
                is_local_creation=True,
                quotation_doc_date=posting_date,
                quotation_valid_until=due_date,
                comments=comments or "",
                tax_date=tax_date or None,
                doc_rate=doc_rate if doc_rate not in (None, "") else None,
                header_fields=header_fields or {},
                created_by=user,
            )

            created_sap_lines = result.get("DocumentLines") or []

            for idx, sap_line in enumerate(created_sap_lines):
                line_num = int(sap_line.get("LineNum", idx))
                item_code = str(sap_line.get("ItemCode") or "")
                desc = str(sap_line.get("ItemDescription") or "")
                uom = str(sap_line.get("UoMCode") or sap_line.get("UomCode") or sap_line.get("MeasureUnit") or "")
                orig_qty = float(sap_line.get("Quantity") or 0.0)
                orig_price = float(sap_line.get("UnitPrice") or 0.0)
                whs = str(sap_line.get("WarehouseCode") or "")

                # A repeated ItemCode is still a distinct quotation/base line.
                override = lines_data[line_num] if 0 <= line_num < len(lines_data) else {}
                custom_qty = float(override.get("customized_quantity", override.get("quantity", orig_qty)))
                custom_price = float(override.get("customized_unit_price", override.get("unit_price", orig_price)))

                CustomizationDraftLine.objects.create(
                    draft=draft,
                    line_number=line_num,
                    item_code=item_code,
                    item_description=desc or override.get("item_description", ""),
                    uom=uom or override.get("uom", ""),
                    original_quantity=orig_qty,
                    customized_quantity=custom_qty,
                    original_unit_price=orig_price,
                    customized_unit_price=custom_price,
                    uom_entry=sap_line.get("UoMEntry", override.get("uom_entry")),
                    tax_code=str(sap_line.get("VatGroup") or sap_line.get("TaxCode") or override.get("tax_code") or ""),
                    discount_percent=float(sap_line.get("DiscountPercent", override.get("discount_percent", 0)) or 0),
                    warehouse_code=override.get("warehouse_code", whs),
                    cost_center_code=str(override.get("location") or override.get("costing_code") or override.get("cost_center_code") or sap_line.get("CostingCode") or ""),
                    free_text=override.get("free_text") or sap_line.get("FreeText") or "",
                    u_specification=override.get("u_specification", override.get("u_size", sap_line.get("U_size", ""))),
                    u_brand=override.get("u_brand", sap_line.get("U_Brand", "")),
                    u_packing=str(override.get("u_packing", override.get("u_pallets", sap_line.get("U_Pallets", "")))),
                    is_selected=bool(override.get("is_selected", True)),
                )

        return draft

    def save_or_update_draft(
        self,
        user,
        draft_id: Optional[int] = None,
        customer_code: str = "",
        customer_name: str = "",
        doc_date: str = None,
        doc_due_date: str = None,
        comments: str = "",
        lines_data: List[Dict[str, Any]] = None,
        currency: str = None,
        payment_group_code: Any = None,
        sales_person_code: Any = None,
        wrapping: str = None,
        tax_date: str = None,
        doc_rate: Any = None,
        header_fields: Dict[str, Any] = None,
        submit: bool = False,
    ) -> CustomizationDraft:
        """
        Saves or updates a local Sales Quotation workflow draft in the Django DB
        without directly creating the SAP document yet.
        """
        if not customer_code:
            raise CustomizationStateError("Customer is required to save a Sales Quotation draft.")
        if not lines_data:
            raise CustomizationStateError("At least one item line is required.")

        today_str = timezone.now().strftime("%Y-%m-%d")
        posting_date = doc_date or today_str
        due_date = doc_due_date or today_str

        with transaction.atomic():
            if draft_id:
                try:
                    draft = CustomizationDraft.objects.select_for_update().get(id=draft_id)
                except CustomizationDraft.DoesNotExist:
                    raise CustomizationStateError(f"Draft #{draft_id} not found.")
                if draft.status not in [CustomizationDraft.STATUS_DRAFT, CustomizationDraft.STATUS_INTERNAL_REJECTED]:
                    raise CustomizationStateError(f"Draft #{draft.id} cannot be edited in status '{draft.status}'.")
            else:
                draft = CustomizationDraft(created_by=user, is_local_creation=True)

            draft.customer_code = customer_code
            draft.customer_name = customer_name or ""
            draft.quotation_doc_date = posting_date
            draft.quotation_valid_until = due_date
            draft.tax_date = tax_date or posting_date
            draft.currency = currency or (draft.currency if draft_id else self.DEFAULT_QUOTATION_CURRENCY)
            draft.comments = comments or ""
            draft.wrapping = str(wrapping or "")
            draft.header_fields = header_fields or {}

            if doc_rate not in (None, ""):
                try:
                    draft.doc_rate = float(doc_rate)
                except (ValueError, TypeError):
                    draft.doc_rate = None

            if payment_group_code not in (None, ""):
                try:
                    draft.payment_group_code = int(payment_group_code)
                except (ValueError, TypeError):
                    draft.payment_group_code = None

            if sales_person_code not in (None, ""):
                try:
                    draft.sales_person_code = int(sales_person_code)
                except (ValueError, TypeError):
                    draft.sales_person_code = None

            draft.status = CustomizationDraft.STATUS_PENDING_INTERNAL_REVIEW if submit else CustomizationDraft.STATUS_DRAFT

            full_payload = {
                "customer_code": customer_code,
                "customer_name": customer_name,
                "doc_date": posting_date,
                "doc_due_date": due_date,
                "tax_date": tax_date,
                "doc_rate": doc_rate,
                "comments": comments,
                "currency": draft.currency,
                "payment_group_code": payment_group_code,
                "sales_person_code": sales_person_code,
                "wrapping": wrapping,
                "header_fields": header_fields or {},
                "lines": lines_data,
            }
            draft.draft_payload = full_payload
            draft.save()

            draft.lines.all().delete()
            for idx, line in enumerate(lines_data):
                item_code = str(line.get("item_code") or "").strip()
                if not item_code:
                    continue
                qty = float(line.get("quantity", line.get("customized_quantity", 1.0)) or 1.0)
                price = float(line.get("unit_price", line.get("customized_unit_price", 0.0)) or 0.0)

                uom_entry_val = line.get("uom_entry")
                try:
                    uom_entry_int = int(uom_entry_val) if uom_entry_val not in (None, "") else None
                except (ValueError, TypeError):
                    uom_entry_int = None

                disc_val = line.get("discount_percent")
                try:
                    disc_float = float(disc_val) if disc_val not in (None, "") else 0.0
                except (ValueError, TypeError):
                    disc_float = 0.0

                tax_code_val = str(line.get("tax_code") or line.get("TaxCode") or line.get("VatGroup") or "").strip()

                CustomizationDraftLine.objects.create(
                    draft=draft,
                    line_number=idx,
                    item_code=item_code,
                    item_description=str(line.get("item_description") or ""),
                    uom=str(line.get("uom") or ""),
                    uom_entry=uom_entry_int,
                    original_quantity=qty,
                    customized_quantity=qty,
                    original_unit_price=price,
                    customized_unit_price=price,
                    discount_percent=disc_float,
                    tax_code=tax_code_val,
                    warehouse_code=str(line.get("warehouse_code") or ""),
                    cost_center_code=str(line.get("cost_center_code") or line.get("location") or ""),
                    free_text=str(line.get("free_text") or ""),
                    u_specification=str(line.get("u_specification") or ""),
                    u_brand=str(line.get("u_brand") or ""),
                    u_size=str(line.get("u_size") or ""),
                    u_pallets=str(line.get("u_pallets") or ""),
                    u_packing=str(line.get("u_packing") or ""),
                    is_selected=bool(line.get("is_selected", True)),
                )

        return draft

    def post_quotation_to_sap(self, draft: CustomizationDraft, user) -> CustomizationDraft:
        """
        Takes an approved local draft, constructs the verified SAP Service Layer payload
        (including VatGroup and TaxCode), and creates the native Sales Quotation in SAP.
        Guarantees idempotency: returns existing draft if already created in SAP.
        """
        if draft.quotation_doc_entry:
            return draft

        sap_lines = []
        for line in draft.lines.filter(is_selected=True):
            item_code = str(line.item_code or "").strip()
            qty = float(line.customized_quantity or line.original_quantity or 1.0)
            price = float(line.customized_unit_price or line.original_unit_price or 0.0)
            sap_line = {
                "ItemCode": item_code,
                "Quantity": qty,
                "UnitPrice": price,
            }
            if line.warehouse_code:
                sap_line["WarehouseCode"] = line.warehouse_code
            if line.uom_entry is not None:
                sap_line["UoMEntry"] = int(line.uom_entry)
            if line.discount_percent:
                sap_line["DiscountPercent"] = float(line.discount_percent)
            if line.u_brand:
                sap_line["U_Brand"] = line.u_brand
            if line.u_size:
                sap_line["U_size"] = line.u_size
            if line.u_pallets:
                sap_line["U_Pallets"] = str(line.u_pallets).strip()
            if line.free_text:
                sap_line["FreeText"] = line.free_text

            tax_code = str(line.tax_code or "").strip()
            if tax_code:
                sap_line["TaxCode"] = tax_code
                sap_line["VatGroup"] = tax_code
            sap_lines.append(sap_line)

        payload = {
            "CardCode": draft.customer_code,
            "DocDate": str(draft.quotation_doc_date or timezone.now().strftime("%Y-%m-%d")),
            "DocDueDate": str(draft.quotation_valid_until or timezone.now().strftime("%Y-%m-%d")),
            "Comments": draft.comments or "Created from Customization & Delivery module",
            "DocumentLines": sap_lines,
        }
        if draft.tax_date:
            payload["TaxDate"] = str(draft.tax_date)
        if draft.doc_rate not in (None, ""):
            payload["DocRate"] = float(draft.doc_rate)
        if draft.currency:
            payload["DocCurrency"] = draft.currency
        if draft.payment_group_code not in (None, ""):
            payload["PaymentGroupCode"] = int(draft.payment_group_code)
        if draft.sales_person_code not in (None, ""):
            payload["SalesPersonCode"] = int(draft.sales_person_code)
        if draft.wrapping:
            payload["U_Wrapping"] = str(draft.wrapping)

        header_map = {
            "po_number": "NumAtCard",
            "ship_to_code": "ShipToCode",
            "pay_to_code": "PayToCode",
            "transportation_code": "TransportationCode",
            "contract_no": "U_Contract_no",
            "lc_number": "U_LC",
            "container_count": "U_TCON",
            "header_uom": "U_UOM",
            "week_no": "U_week_no",
            "shipping_line": "U_Shipping",
            "etd": "U_ETD",
            "eta": "U_ETA",
            "incoterms": "U_Shipment",
            "pol": "U_POL",
            "pod": "U_POD",
            "notify": "U_Notify",
            "dhl": "U_DHL",
        }
        for request_key, sap_key in header_map.items():
            value = (draft.header_fields or {}).get(request_key)
            if value in (None, ""):
                continue
            payload[sap_key] = int(value) if request_key in {"transportation_code", "week_no"} else str(value).strip()

        from .sales_posting_journal import SalesPostingJournal, PostingPending
        journal = SalesPostingJournal(user, self.sap_client, 'Quotations', f'draftquote-{draft.id}')
        previous = journal.scope().filter(entity_id=journal.key).order_by('-id').first()
        if previous:
            payload = previous.details['payload']
        try:
            result = journal.post(payload, send=self.sap_client.create_sales_quotation)
        except PostingPending as exc:
            draft.sap_error = str(exc)
            draft.save(update_fields=['sap_error', 'updated_at'])
            raise CustomizationPostingError(str(exc), is_ambiguous=True) from exc
        if not isinstance(result, dict) or result.get("error"):
            error_msg = str(result.get("error") if isinstance(result, dict) else result)
            draft.sap_error = error_msg
            draft.save(update_fields=["sap_error", "updated_at"])
            raise CustomizationPostingError(f"SAP rejected Sales Quotation creation: {error_msg}", result)

        doc_entry = int(result.get("DocEntry"))
        verified_result = self.sap_client.get_sales_quotation(doc_entry)
        if isinstance(verified_result, dict) and not verified_result.get("error"):
            result = verified_result
        doc_num = str(result.get("DocNum") or doc_entry)
        resolved_card_name = draft.customer_name or str(result.get("CardName") or "")

        draft.quotation_doc_entry = doc_entry
        draft.quotation_doc_num = doc_num
        draft.customer_name = resolved_card_name
        draft.original_sap_snapshot = result
        draft.currency = result.get("DocCurrency") or draft.currency
        draft.status = CustomizationDraft.STATUS_READY_FOR_ORDER
        draft.sap_error = ""
        draft.save(update_fields=["quotation_doc_entry", "quotation_doc_num", "customer_name", "original_sap_snapshot", "currency", "status", "sap_error", "updated_at"])
        return draft

    def create_draft(self, user, quotation_doc_entry: int, lines_data: List[Dict[str, Any]] = None) -> CustomizationDraft:
        """
        Creates a new CustomizationDraft from an existing SAP Sales Quotation.
        Captures the original SAP snapshot for subsequent change detection.
        """
        quotation = self.sap_client.get_sales_quotation(quotation_doc_entry)
        if not quotation or quotation.get("error"):
            error_msg = quotation.get("error", "Quotation not found in SAP") if isinstance(quotation, dict) else "Quotation not found"
            raise CustomizationStateError(f"Cannot initialize customization: {error_msg}")

        doc_num = str(quotation.get("DocNum") or quotation_doc_entry)
        card_code = str(quotation.get("CardCode") or "")
        card_name = str(quotation.get("CardName") or "")

        with transaction.atomic():
            # Check for existing active draft for this quotation
            existing = CustomizationDraft.objects.filter(
                quotation_doc_entry=quotation_doc_entry,
                status__in=[
                    CustomizationDraft.STATUS_DRAFT,
                    CustomizationDraft.STATUS_PENDING_INTERNAL_REVIEW,
                    CustomizationDraft.STATUS_INTERNAL_APPROVED,
                    CustomizationDraft.STATUS_PATCHING,
                    CustomizationDraft.STATUS_SAP_QUOTATION_UPDATED,
                    CustomizationDraft.STATUS_WAITING_CUSTOMER_APPROVAL,
                    CustomizationDraft.STATUS_CUSTOMER_APPROVED,
                    CustomizationDraft.STATUS_READY_FOR_ORDER,
                    CustomizationDraft.STATUS_ORDER_POSTING,
                ]
            ).first()
            if existing:
                raise CustomizationStateError(
                    f"An active Customization Draft (#{existing.id}, Status: {existing.status}) already exists for Quotation #{doc_num}."
                )

            draft = CustomizationDraft.objects.create(
                quotation_doc_entry=quotation_doc_entry,
                quotation_doc_num=doc_num,
                customer_code=card_code,
                customer_name=card_name,
                status=CustomizationDraft.STATUS_DRAFT,
                original_sap_snapshot=quotation,
                currency=quotation.get("DocCurrency") or "",
                created_by=user,
            )

            sap_lines = quotation.get("DocumentLines") or []
            override_by_line = {int(l.get("line_number", l.get("LineNum"))): l for l in (lines_data or [])}

            for sap_line in sap_lines:
                line_num = int(sap_line.get("LineNum"))
                item_code = str(sap_line.get("ItemCode") or "")
                desc = str(sap_line.get("ItemDescription") or "")
                uom = str(sap_line.get("UoMCode") or sap_line.get("UomCode") or sap_line.get("MeasureUnit") or "")
                orig_qty = float(sap_line.get("Quantity") or 0.0)
                orig_price = float(sap_line.get("UnitPrice") or 0.0)
                whs = str(sap_line.get("WarehouseCode") or "")

                override = override_by_line.get(line_num, {})
                custom_qty = float(override.get("customized_quantity", orig_qty))
                custom_price = float(override.get("customized_unit_price", orig_price))

                CustomizationDraftLine.objects.create(
                    draft=draft,
                    line_number=line_num,
                    item_code=item_code,
                    item_description=desc,
                    uom=uom,
                    original_quantity=orig_qty,
                    customized_quantity=custom_qty,
                    original_unit_price=orig_price,
                    customized_unit_price=custom_price,
                    warehouse_code=override.get("warehouse_code", whs),
                    cost_center_code=override.get("cost_center_code", ""),
                    free_text=override.get("free_text", ""),
                    u_specification=override.get("u_specification", ""),
                    u_brand=override.get("u_brand", ""),
                    u_packing=override.get("u_packing", ""),
                    is_selected=bool(override.get("is_selected", True)),
                )

        return draft

    def update_draft(self, draft: CustomizationDraft, lines_data: List[Dict[str, Any]], user) -> CustomizationDraft:
        """Updates line customizations while draft is in editable state."""
        if draft.status not in [CustomizationDraft.STATUS_DRAFT, CustomizationDraft.STATUS_INTERNAL_REJECTED, CustomizationDraft.STATUS_CUSTOMER_REJECTED]:
            raise CustomizationStateError(f"Cannot edit Customization Draft in status '{draft.status}'.")

        with transaction.atomic():
            for line_in in lines_data:
                line_num = int(line_in.get("line_number", line_in.get("LineNum")))
                line_obj = draft.lines.filter(line_number=line_num).first()
                if not line_obj:
                    continue

                if "customized_quantity" in line_in:
                    qty = float(line_in["customized_quantity"])
                    if qty <= 0:
                        raise CustomizationPatchValidationError(f"Line {line_num} quantity must be positive.")
                    line_obj.customized_quantity = qty

                if "customized_unit_price" in line_in:
                    line_obj.customized_unit_price = float(line_in["customized_unit_price"])

                if "warehouse_code" in line_in:
                    line_obj.warehouse_code = str(line_in["warehouse_code"]).strip()

                if "free_text" in line_in:
                    line_obj.free_text = str(line_in["free_text"]).strip()

                if "u_specification" in line_in:
                    line_obj.u_specification = str(line_in["u_specification"]).strip()

                if "u_brand" in line_in:
                    line_obj.u_brand = str(line_in["u_brand"]).strip()

                if "u_packing" in line_in:
                    line_obj.u_packing = str(line_in["u_packing"]).strip()

                if "is_selected" in line_in:
                    line_obj.is_selected = bool(line_in["is_selected"])

                line_obj.save()

            draft.status = CustomizationDraft.STATUS_DRAFT
            draft.save(update_fields=["status", "updated_at"])

        return draft

    def submit_for_internal_review(self, draft: CustomizationDraft, user) -> CustomizationDraft:
        if draft.status not in [CustomizationDraft.STATUS_DRAFT, CustomizationDraft.STATUS_INTERNAL_REJECTED]:
            raise CustomizationStateError(f"Draft #{draft.id} cannot be submitted from status '{draft.status}'.")

        active_lines = draft.lines.filter(is_selected=True)
        if not active_lines.exists():
            raise CustomizationStateError("At least one line must be selected for customization.")

        draft.status = CustomizationDraft.STATUS_PENDING_INTERNAL_REVIEW
        draft.save(update_fields=["status", "updated_at"])
        return draft

    def approve_internal_review(self, draft: CustomizationDraft, user, notes: str = "") -> CustomizationDraft:
        if draft.status != CustomizationDraft.STATUS_PENDING_INTERNAL_REVIEW:
            raise CustomizationStateError(f"Draft #{draft.id} is not pending review (status: {draft.status}).")

        # LOCAL FIRST: Manager approval is recorded locally; quotation remains local draft
        draft.status = CustomizationDraft.STATUS_INTERNAL_APPROVED
        draft.internal_reviewed_by = user
        draft.internal_reviewed_at = timezone.now()
        draft.internal_approval_notes = str(notes or "").strip()
        draft.save(update_fields=["status", "internal_reviewed_by", "internal_reviewed_at", "internal_approval_notes", "updated_at"])
        return draft

    def reject_internal_review(self, draft: CustomizationDraft, user, reason: str) -> CustomizationDraft:
        if draft.status != CustomizationDraft.STATUS_PENDING_INTERNAL_REVIEW:
            raise CustomizationStateError(f"Draft #{draft.id} is not pending review (status: {draft.status}).")

        clean_reason = str(reason or "").strip()
        if not clean_reason:
            raise CustomizationStateError("A rejection reason is required.")

        draft.status = CustomizationDraft.STATUS_INTERNAL_REJECTED
        draft.internal_reviewed_by = user
        draft.internal_reviewed_at = timezone.now()
        draft.internal_rejection_reason = clean_reason
        draft.save(update_fields=["status", "internal_reviewed_by", "internal_reviewed_at", "internal_rejection_reason", "updated_at"])
        return draft

    def patch_sap_quotation(self, draft: CustomizationDraft, user) -> CustomizationDraft:
        """
        Executes the same-quotation update via PATCH /b1s/v1/Quotations(<DocEntry>).
        1. Atomic lock on local draft.
        2. Re-fetch live SAP quotation.
        3. Detect external changes vs original snapshot (aborts if changed).
        4. Dispatch PATCH to SAP.
        5. Verify read-back.
        6. Transition to WAITING_CUSTOMER_APPROVAL.
        """
        with transaction.atomic():
            locked = CustomizationDraft.objects.select_for_update().get(id=draft.id)
            if locked.status != CustomizationDraft.STATUS_INTERNAL_APPROVED:
                raise CustomizationStateError(f"Draft #{locked.id} cannot be patched (status: {locked.status}). Must be internally approved.")

            locked.status = CustomizationDraft.STATUS_PATCHING
            locked.save(update_fields=["status", "updated_at"])


        # Fetch live SAP quotation
        live_quotation = self.sap_client.get_sales_quotation(draft.quotation_doc_entry)
        if not live_quotation or live_quotation.get("error"):
            with transaction.atomic():
                draft.status = CustomizationDraft.STATUS_PATCH_FAILED
                draft.sap_error = f"Failed to retrieve live quotation from SAP: {live_quotation}"
                draft.save(update_fields=["status", "sap_error", "updated_at"])
            raise CustomizationPostingError("Failed to retrieve live quotation from SAP prior to update.", live_quotation)

        # Build payload & check external changes
        try:
            payload = self.patch_builder.build_patch_payload(draft, live_quotation)
        except (CustomizationExternalChangeError, CustomizationPatchValidationError) as exc:
            with transaction.atomic():
                draft.status = CustomizationDraft.STATUS_PATCH_FAILED
                draft.sap_error = str(exc)
                draft.save(update_fields=["status", "sap_error", "updated_at"])
            raise CustomizationStateError(str(exc))

        endpoint = f"Quotations({draft.quotation_doc_entry})"
        patch_result = self.sap_client._request("PATCH", endpoint, payload)

        if isinstance(patch_result, dict) and patch_result.get("error"):
            with transaction.atomic():
                draft.status = CustomizationDraft.STATUS_PATCH_FAILED
                draft.raw_patch_payload = payload
                draft.sap_error = str(patch_result.get("error"))
                draft.save(update_fields=["status", "raw_patch_payload", "sap_error", "updated_at"])
            raise CustomizationPostingError(f"SAP rejected Quotation update: {patch_result.get('error')}", patch_result)

        # Verification Read-Back
        verified_quotation = self.sap_client.get_sales_quotation(draft.quotation_doc_entry)
        with transaction.atomic():
            draft.status = CustomizationDraft.STATUS_WAITING_CUSTOMER_APPROVAL
            draft.raw_patch_payload = payload
            draft.sap_error = ""
            # Update baseline snapshot with newly patched state
            if isinstance(verified_quotation, dict) and not verified_quotation.get("error"):
                draft.original_sap_snapshot = verified_quotation
            draft.save(update_fields=["status", "raw_patch_payload", "sap_error", "original_sap_snapshot", "updated_at"])

        return draft

    def record_customer_approval(
        self,
        draft: CustomizationDraft,
        user,
        approval_type: str,
        reference_number: str,
        contact_person: str,
        notes: str = ""
    ) -> CustomizationDraft:
        """
        Customer Approval Gate:
        Internal employee records external customer approval evidence.
        """
        valid_types = {t[0] for t in CustomizationDraft.APPROVAL_TYPE_CHOICES}
        if approval_type not in valid_types:
            raise CustomizationStateError(f"Invalid customer approval type: {approval_type}. Must be one of {valid_types}")

        clean_ref = str(reference_number or "").strip()
        if not clean_ref:
            raise CustomizationStateError("Customer reference number (e.g. PO# or signed document ID) is required.")

        clean_contact = str(contact_person or "").strip()
        if not clean_contact:
            raise CustomizationStateError("Customer contact person name is required.")

        with transaction.atomic():
            locked = CustomizationDraft.objects.select_for_update().get(id=draft.id)
            if locked.status not in [CustomizationDraft.STATUS_WAITING_CUSTOMER_APPROVAL, CustomizationDraft.STATUS_INTERNAL_APPROVED, CustomizationDraft.STATUS_READY_FOR_ORDER]:
                raise CustomizationStateError(
                    f"Customer approval can only be logged for drafts in WAITING_CUSTOMER_APPROVAL or INTERNAL_APPROVED (current: {locked.status})."
                )

            locked.customer_approval_type = approval_type
            locked.customer_reference_number = clean_ref
            locked.customer_contact_person = clean_contact
            locked.customer_approval_notes = str(notes or "").strip()
            locked.customer_approval_recorded_by = user
            locked.customer_approval_recorded_at = timezone.now()
            locked.status = CustomizationDraft.STATUS_READY_FOR_ORDER
            locked.save(update_fields=[
                "customer_approval_type",
                "customer_reference_number",
                "customer_contact_person",
                "customer_approval_notes",
                "customer_approval_recorded_by",
                "customer_approval_recorded_at",
                "status",
                "updated_at",
            ])

        # LOCAL FIRST: Now that both internal review and customer approval are satisfied,
        # post the official Sales Quotation to SAP exactly once
        if not locked.quotation_doc_entry:
            locked = self.post_quotation_to_sap(draft=locked, user=user)

        return locked

    def post_sales_order_to_sap(
        self,
        draft: CustomizationDraft,
        user,
        doc_due_date: str = None,
        customer_reference_number: str = None,
    ) -> CustomizationDraft:
        """
        Creates the SAP Sales Order (ORDR) using native BaseType: 23 linkage.
        Enforces single-order-per-customization rule.
        """
        with transaction.atomic():
            locked = CustomizationDraft.objects.select_for_update().get(id=draft.id)
            was_posting = locked.status == CustomizationDraft.STATUS_ORDER_POSTING
            if locked.status != CustomizationDraft.STATUS_READY_FOR_ORDER:
                if locked.status == CustomizationDraft.STATUS_ORDER_POSTED:
                    return locked
                if locked.status != CustomizationDraft.STATUS_ORDER_POSTING:
                    raise CustomizationStateError(f"Draft is not ready for Sales Order creation (current status: {locked.status}).")

            locked.status = CustomizationDraft.STATUS_ORDER_POSTING
            locked.save(update_fields=["status", "updated_at"])

        from .sales_posting_journal import SalesPostingJournal, PostingPending
        journal = SalesPostingJournal(user, self.sap_client, 'Orders', f'order-{draft.id}')
        previous = journal.scope().filter(entity_id=journal.key).order_by('-id').first()
        if was_posting and not previous:
            raise CustomizationPostingError('Checking document status in SAP; this earlier attempt has no durable verification reference. Administrative verification is required before another posting.', is_ambiguous=True)

        # Guard: Ensure quotation exists in SAP before constructing BaseType: 23 order payload
        if not draft.quotation_doc_entry:
            draft = self.post_quotation_to_sap(draft=draft, user=user)

        # Construct payload
        try:
            payload = previous.details['payload'] if previous else self.order_builder.build(
                draft,
                doc_due_date=doc_due_date,
                customer_reference_number=customer_reference_number,
            )
        except SalesOrderPayloadValidationError as exc:
            with transaction.atomic():
                draft.status = CustomizationDraft.STATUS_ORDER_FAILED
                draft.sap_error = str(exc)
                draft.save(update_fields=["status", "sap_error", "updated_at"])
            raise CustomizationStateError(str(exc))

        draft.raw_order_payload = payload
        draft.save(update_fields=['raw_order_payload', 'updated_at'])
        try:
            result = journal.post(payload)
        except ValueError as exc:
            if not previous:
                draft.status = CustomizationDraft.STATUS_ORDER_FAILED
                draft.sap_error = str(exc)
                draft.save(update_fields=['status', 'sap_error', 'updated_at'])
            raise CustomizationStateError(str(exc)) from exc
        except PostingPending as exc:
            draft.raw_order_payload = payload
            draft.sap_error = str(exc)
            draft.save(update_fields=['raw_order_payload', 'sap_error', 'updated_at'])
            raise CustomizationPostingError(str(exc), is_ambiguous=True) from exc

        if not isinstance(result, dict) or result.get("error") or not result.get("DocEntry"):
            error_details = _sap_error_message(result if isinstance(result, dict) else {}, "SAP did not confirm Sales Order creation.")
            ambiguous = not (isinstance(result, dict) and isinstance(result.get("error"), dict))
            with transaction.atomic():
                draft.status = CustomizationDraft.STATUS_ORDER_POSTING if ambiguous else CustomizationDraft.STATUS_ORDER_FAILED
                draft.raw_order_payload = payload
                draft.sap_error = error_details
                draft.save(update_fields=["status", "raw_order_payload", "sap_error", "updated_at"])
            raise CustomizationPostingError(f"Sales Order creation was not confirmed: {error_details}" if ambiguous else f"SAP rejected Sales Order creation: {error_details}", result, is_ambiguous=ambiguous)

        doc_entry = str(result.get("DocEntry") or "")
        doc_num = str(result.get("DocNum") or doc_entry)

        with transaction.atomic():
            draft.status = CustomizationDraft.STATUS_ORDER_POSTED
            draft.sap_order_doc_entry = doc_entry
            draft.sap_order_doc_num = doc_num
            draft.order_posted_by = user
            draft.order_posted_at = timezone.now()
            draft.raw_order_payload = payload
            draft.sap_error = ""
            draft.save(update_fields=[
                "status",
                "sap_order_doc_entry",
                "sap_order_doc_num",
                "order_posted_by",
                "order_posted_at",
                "raw_order_payload",
                "sap_error",
                "updated_at",
            ])

        return draft
