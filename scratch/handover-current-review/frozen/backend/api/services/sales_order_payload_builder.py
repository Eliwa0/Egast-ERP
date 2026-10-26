from datetime import date
from typing import Any, Dict, List


class SalesOrderPayloadValidationError(ValueError):
    pass


class SalesOrderPayloadBuilder:
    """
    Constructs the native SAP Business One Sales Order (ORDR) payload from an approved Customization Draft.
    Enforces native BaseType: 23, BaseEntry, BaseLine linking to the Sales Quotation.
    Only includes selected active lines.
    """

    sap_object = "Orders"
    base_type_quotation = 23

    def build(self, draft, doc_due_date: str = None, customer_reference_number: str = None) -> Dict[str, Any]:
        """
        Builds the payload for POST /b1s/v1/Orders based on a CustomizationDraft.
        """
        ref_num = str(
            customer_reference_number
            or draft.customer_reference_number
            or (draft.header_fields or {}).get("po_number")
            or f"QT-{draft.quotation_doc_num or draft.id}"
        ).strip()

        active_lines = [line for line in draft.lines.all() if line.is_selected]
        if not active_lines:
            raise SalesOrderPayloadValidationError(
                "Cannot generate Sales Order: No active lines selected in the customization draft."
            )

        due_date_str = str(doc_due_date or draft.quotation_valid_until or date.today().isoformat()).strip()
        posting_date_str = str(draft.quotation_doc_date or date.today().isoformat()).strip()

        document_lines: List[Dict[str, Any]] = []
        for line in active_lines:
            qty = float(line.customized_quantity or 0.0)
            if qty <= 0:
                raise SalesOrderPayloadValidationError(
                    f"Line {line.line_number} ({line.item_code}) has non-positive quantity: {qty}"
                )

            line_payload: Dict[str, Any] = {
                "BaseType": self.base_type_quotation,
                "BaseEntry": int(draft.quotation_doc_entry),
                "BaseLine": int(line.line_number),
                "Quantity": qty,
            }

            if line.warehouse_code:
                line_payload["WarehouseCode"] = str(line.warehouse_code).strip()

            if line.customized_unit_price is not None:
                line_payload["UnitPrice"] = float(line.customized_unit_price)

            free_texts = []
            if line.free_text:
                free_texts.append(str(line.free_text).strip())
            if line.u_specification:
                free_texts.append(f"Spec: {str(line.u_specification).strip()}")
            if line.u_packing:
                free_texts.append(f"Pack: {str(line.u_packing).strip()}")

            if free_texts:
                line_payload["FreeText"] = " | ".join(free_texts)

            if line.u_brand:
                line_payload["U_Brand"] = str(line.u_brand).strip()

            document_lines.append(line_payload)

        custom_ref = f"CD-{draft.id}"
        memo = f"Order based on Quotation #{draft.quotation_doc_num} (Ref {custom_ref})"
        if ref_num:
            memo += f" - Cust Ref: {ref_num}"

        payload: Dict[str, Any] = {
            "CardCode": str(draft.customer_code).strip(),
            "DocDate": posting_date_str,
            "DocDueDate": due_date_str,
            "Comments": memo,
            "NumAtCard": ref_num[:100],
            "DocumentLines": document_lines,
        }

        # Preserve the base quotation's actual currency, including imported quotations.
        currency = (draft.original_sap_snapshot or {}).get("DocCurrency") or draft.currency
        if currency:
            payload["DocCurrency"] = currency

        return payload
