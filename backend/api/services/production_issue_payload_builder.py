"""
Payload builder for SAP Business One InventoryGenExits (Issue for Production).
"""
from datetime import date, datetime
from typing import Any, Dict, List, Optional


class ProductionIssuePayloadValidationError(ValueError):
    pass


class ProductionIssuePayloadBuilder:
    """
    Constructs the SAP Service Layer InventoryGenExits document payload
    from authoritative PendingIssue and PendingIssueLine database records.
    """

    @staticmethod
    def _format_date(val: Any) -> Optional[str]:
        if not val:
            return None
        if isinstance(val, (date, datetime)):
            return val.strftime("%Y-%m-%d")
        text = str(val).strip()
        if "T" in text:
            text = text.split("T")[0]
        return text

    def build(self, pending_issue) -> Dict[str, Any]:
        """
        Builds the complete InventoryGenExits payload.
        """
        if not pending_issue:
            raise ProductionIssuePayloadValidationError("Pending issue is required.")

        doc_entry = pending_issue.production_order_doc_entry
        if not doc_entry:
            raise ProductionIssuePayloadValidationError("Production order doc entry is required.")

        posting_date = self._format_date(pending_issue.posting_date) or date.today().strftime("%Y-%m-%d")
        doc_date = self._format_date(pending_issue.document_date) or posting_date

        order_num = pending_issue.production_order_doc_num or str(doc_entry)
        comments = (pending_issue.comments or f"Issue for Production Order {order_num}").strip()
        journal_memo = (pending_issue.journal_memo or f"Issue for Production - {order_num}").strip()

        lines = list(pending_issue.lines.all().order_by("line_number"))
        if not lines:
            raise ProductionIssuePayloadValidationError("Pending issue has no component lines.")

        document_lines: List[Dict[str, Any]] = []

        for line_idx, line in enumerate(lines):
            qty = float(line.issue_quantity or 0.0)
            if qty <= 0:
                raise ProductionIssuePayloadValidationError(
                    f"Line {line.line_number} ({line.item_code}) has non-positive quantity: {qty}"
                )

            doc_line: Dict[str, Any] = {
                "BaseType": 202,
                "BaseEntry": int(doc_entry),
                "BaseLine": int(line.line_number),
                "Quantity": qty,
                "WarehouseCode": str(line.warehouse_code).strip(),
            }

            allocations = line.allocations_json or []
            if isinstance(allocations, list) and allocations:
                batch_numbers: List[Dict[str, Any]] = []
                serial_numbers: List[Dict[str, Any]] = []
                bin_allocations: List[Dict[str, Any]] = []

                for batch_idx, alloc in enumerate(allocations):
                    if not isinstance(alloc, dict):
                        continue

                    alloc_qty = float(alloc.get("quantity") or 0.0)
                    batch_num = alloc.get("batch_number") or alloc.get("BatchNumber")
                    serial_num = alloc.get("serial_number") or alloc.get("SerialNumber") or alloc.get("InternalSerialNumber")
                    bin_abs = alloc.get("bin_abs_entry") or alloc.get("BinAbsEntry")

                    if batch_num:
                        batch_numbers.append({
                            "BatchNumber": str(batch_num).strip(),
                            "Quantity": alloc_qty,
                        })
                    elif serial_num:
                        serial_numbers.append({
                            "InternalSerialNumber": str(serial_num).strip(),
                        })

                    bins_list = alloc.get("bins") or alloc.get("DocumentLinesBinAllocations")
                    if isinstance(bins_list, list) and bins_list:
                        for b in bins_list:
                            b_entry = b.get("bin_abs_entry") or b.get("BinAbsEntry")
                            b_qty = float(b.get("quantity") or b.get("Quantity") or 0.0)
                            if b_entry not in (None, "") and b_qty > 0:
                                bin_allocations.append({
                                    "BinAbsEntry": int(b_entry),
                                    "Quantity": b_qty,
                                    "AllowNegativeQuantity": "tNO",
                                    "SerialAndBatchNumbersBaseLine": batch_idx if (batch_num or serial_num) else 0,
                                    "BaseLineNumber": line_idx,
                                })
                    elif bin_abs not in (None, ""):
                        bin_allocations.append({
                            "BinAbsEntry": int(bin_abs),
                            "Quantity": alloc_qty,
                            "AllowNegativeQuantity": "tNO",
                            "SerialAndBatchNumbersBaseLine": batch_idx if (batch_num or serial_num) else 0,
                            "BaseLineNumber": line_idx,
                        })

                if batch_numbers:
                    # Validate that sum of batch quantities equals line quantity
                    total_batch_qty = sum(b["Quantity"] for b in batch_numbers)
                    if abs(total_batch_qty - qty) > 0.0001:
                        raise ProductionIssuePayloadValidationError(
                            f"Line {line.line_number} ({line.item_code}) batch quantity sum "
                            f"({total_batch_qty}) does not match line quantity ({qty})."
                        )
                    doc_line["BatchNumbers"] = batch_numbers

                if serial_numbers:
                    if len(serial_numbers) != int(qty):
                        raise ProductionIssuePayloadValidationError(
                            f"Line {line.line_number} ({line.item_code}) selected serial count "
                            f"({len(serial_numbers)}) does not match line quantity ({qty})."
                        )
                    doc_line["SerialNumbers"] = serial_numbers

                if bin_allocations:
                    total_bin_qty = sum(b["Quantity"] for b in bin_allocations)
                    if abs(total_bin_qty - qty) > 0.0001:
                        raise ProductionIssuePayloadValidationError(
                            f"Line {line.line_number} ({line.item_code}) bin allocations total "
                            f"({total_bin_qty}) does not match line quantity ({qty})."
                        )
                    doc_line["DocumentLinesBinAllocations"] = bin_allocations

            document_lines.append(doc_line)

        payload: Dict[str, Any] = {
            "DocType": "dDocument_Items",
            "DocDate": posting_date,
            "Comments": comments,
            "JournalMemo": journal_memo,
            "DocumentLines": document_lines,
        }

        return payload
