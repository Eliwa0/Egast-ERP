from datetime import date
from typing import Any, Dict, List


class DeliveryPayloadValidationError(ValueError):
    pass


class DeliveryPayloadBuilder:
    """
    Constructs the native SAP Business One Delivery Note (ODLN) payload from a DeliveryDraft.
    Enforces native BaseType: 17, BaseEntry, BaseLine linking to the Sales Order (ORDR).
    Handles batch numbers and bin allocations.
    """

    sap_object = "DeliveryNotes"
    base_type_sales_order = 17

    def build(self, draft) -> Dict[str, Any]:
        """
        Builds the payload for POST /b1s/v1/DeliveryNotes based on a DeliveryDraft.
        """
        lines = list(draft.lines.all().prefetch_related("batches"))
        if not lines:
            raise DeliveryPayloadValidationError("Delivery draft contains no line items.")

        posting_date = draft.doc_date.isoformat() if hasattr(draft.doc_date, "isoformat") else str(draft.doc_date)
        due_date = draft.doc_due_date.isoformat() if hasattr(draft.doc_due_date, "isoformat") else str(draft.doc_due_date)

        document_lines: List[Dict[str, Any]] = []

        for line in lines:
            qty = float(line.delivery_quantity or 0.0)
            if qty <= 0:
                continue

            line_idx = len(document_lines)
            line_payload: Dict[str, Any] = {
                "BaseType": self.base_type_sales_order,
                "BaseEntry": int(draft.sales_order_doc_entry),
                "BaseLine": int(line.line_number),
                "Quantity": qty,
                "WarehouseCode": str(line.warehouse_code).strip(),
            }


            # Costing codes for required G/L dimensions
            c1 = (getattr(line, "cost_center_code", "") or getattr(draft, "cost_center_1", "") or "").strip()
            c2 = (getattr(line, "cost_center_code2", "") or getattr(draft, "cost_center_2", "") or "").strip()
            c3 = (getattr(draft, "cost_center_3", "") or "").strip()

            # Parse from draft.comments if not set explicitly on draft fields
            draft_comments = getattr(draft, "comments", "") or ""
            if not c1 and "Dim1:" in draft_comments:
                import re
                m1 = re.search(r"Dim1:\s*([^|]+)", draft_comments)
                if m1:
                    c1 = m1.group(1).strip()
            if not c2 and "Dim2:" in draft_comments:
                import re
                m2 = re.search(r"Dim2:\s*([^|]+)", draft_comments)
                if m2:
                    c2 = m2.group(1).strip()

            # Assign resolved codes or fallback to default GL codes
            costing_code_1 = c1 if c1 else "MPH53VPT"
            costing_code_2 = c2 if c2 else "PPAPOTLM"
            costing_code_3 = c3 if c3 else "00003NON"

            line_payload["CostingCode"] = costing_code_1
            line_payload["COGSCostingCode"] = costing_code_1
            line_payload["CostingCode2"] = costing_code_2
            line_payload["COGSCostingCode2"] = costing_code_2
            line_payload["CostingCode3"] = costing_code_3
            line_payload["COGSCostingCode3"] = costing_code_3

            batches = list(line.batches.all())
            if batches:
                batch_sum = sum(float(b.quantity or 0.0) for b in batches)
                if abs(batch_sum - qty) > 0.0001:
                    raise DeliveryPayloadValidationError(
                        f"Line {line.line_number} ({line.item_code}) batch quantity sum ({batch_sum}) does not match line delivery quantity ({qty})."
                    )

                batch_numbers_list: List[Dict[str, Any]] = []
                bin_allocations_list: List[Dict[str, Any]] = []

                for batch_idx, batch_obj in enumerate(batches):
                    b_qty = float(batch_obj.quantity or 0.0)
                    batch_numbers_list.append({
                        "BatchNumber": str(batch_obj.batch_number).strip(),
                        "Quantity": b_qty,
                    })

                    if batch_obj.bin_abs_entry:
                        bin_allocations_list.append({
                            "BinAbsEntry": int(batch_obj.bin_abs_entry),
                            "Quantity": b_qty,
                            "AllowNegativeQuantity": "tNO",
                            "BaseLineNumber": line_idx,
                            "SerialAndBatchNumbersBaseLine": batch_idx,
                        })

                line_payload["BatchNumbers"] = batch_numbers_list
                if bin_allocations_list:
                    line_payload["DocumentLinesBinAllocations"] = bin_allocations_list

            document_lines.append(line_payload)

        if not document_lines:
            raise DeliveryPayloadValidationError("Delivery draft has no line items with positive delivery quantity.")

        comments = f"Delivery Note created from Sales Order #{draft.sales_order_doc_num} (Draft #{draft.id})"
        if draft.comments:
            comments += f" - {draft.comments}"

        payload: Dict[str, Any] = {
            "CardCode": str(draft.customer_code).strip(),
            "DocDate": posting_date,
            "DocDueDate": due_date,
            "Comments": comments,
            "DocumentLines": document_lines,
        }

        return payload
