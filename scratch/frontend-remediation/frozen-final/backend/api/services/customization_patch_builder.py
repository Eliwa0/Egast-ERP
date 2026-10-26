from decimal import Decimal
from typing import Any, Dict, List, Tuple


class CustomizationExternalChangeError(ValueError):
    """Raised when external changes are detected on the SAP Sales Quotation."""
    def __init__(self, message, differences=None):
        super().__init__(message)
        self.differences = differences or []


class CustomizationPatchValidationError(ValueError):
    """Raised when the customization draft payload is invalid."""
    pass


class CustomizationPatchBuilder:
    """
    Builds the payload for updating an existing SAP Sales Quotation via PATCH.
    Enforces pre-flight external change detection against the original snapshot.
    Defensively constructs DocumentLines to preserve unmodified lines.
    """

    @staticmethod
    def detect_external_changes(
        original_snapshot: Dict[str, Any],
        live_sap_quotation: Dict[str, Any]
    ) -> List[str]:
        """
        Compare live SAP quotation against the baseline snapshot stored at draft creation.
        Returns list of human-readable difference descriptions.
        """
        differences: List[str] = []
        if not original_snapshot or not live_sap_quotation:
            return differences

        # Status check
        live_status = live_sap_quotation.get("DocumentStatus")
        orig_status = original_snapshot.get("DocumentStatus")
        if live_status != orig_status:
            differences.append(f"Status changed from {orig_status} to {live_status}")

        # Check line level changes in SAP
        orig_lines = {l.get("LineNum"): l for l in original_snapshot.get("DocumentLines") or []}
        live_lines = {l.get("LineNum"): l for l in live_sap_quotation.get("DocumentLines") or []}

        for line_num, orig_line in orig_lines.items():
            live_line = live_lines.get(line_num)
            if not live_line:
                differences.append(f"Line {line_num} ({orig_line.get('ItemCode')}) was deleted in SAP")
                continue

            orig_qty = float(orig_line.get("Quantity") or 0.0)
            live_qty = float(live_line.get("Quantity") or 0.0)
            if abs(orig_qty - live_qty) > 0.0001:
                differences.append(f"Line {line_num} quantity changed in SAP from {orig_qty} to {live_qty}")

            orig_price = float(orig_line.get("UnitPrice") or 0.0)
            live_price = float(live_line.get("UnitPrice") or 0.0)
            if abs(orig_price - live_price) > 0.0001:
                differences.append(f"Line {line_num} price changed in SAP from {orig_price} to {live_price}")

            orig_whs = str(orig_line.get("WarehouseCode") or "").strip()
            live_whs = str(live_line.get("WarehouseCode") or "").strip()
            if orig_whs and live_whs and orig_whs != live_whs:
                differences.append(f"Line {line_num} warehouse changed in SAP from {orig_whs} to {live_whs}")

        for line_num in live_lines:
            if line_num not in orig_lines:
                differences.append(f"New line {line_num} was added externally in SAP")

        return differences

    def build_patch_payload(
        self,
        draft,
        live_sap_quotation: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Builds the PATCH payload for /b1s/v1/Quotations(<DocEntry>).
        Asserts no external changes before constructing the payload.
        """
        # Step 1: External change detection
        diffs = self.detect_external_changes(
            draft.original_sap_snapshot or {},
            live_sap_quotation
        )
        if diffs:
            diff_text = "; ".join(diffs)
            raise CustomizationExternalChangeError(
                f"Sales Quotation #{draft.quotation_doc_num} was modified externally in SAP since customization began: {diff_text}. "
                "Please review and refresh changes before updating.",
                differences=diffs,
            )

        # Step 2: Build lines map from draft
        draft_lines_by_num = {line.line_number: line for line in draft.lines.all()}
        if not draft_lines_by_num:
            raise CustomizationPatchValidationError("Customization draft has no line items.")

        # Step 3: Construct DocumentLines defensively (include all live lines, updating customized ones)
        live_lines = live_sap_quotation.get("DocumentLines") or []
        patch_document_lines: List[Dict[str, Any]] = []

        for live_line in live_lines:
            line_num = live_line.get("LineNum")
            customized = draft_lines_by_num.get(line_num)

            if customized and customized.is_selected:
                qty = float(customized.customized_quantity or 0.0)
                if qty <= 0:
                    raise CustomizationPatchValidationError(
                        f"Customized line {line_num} ({customized.item_code}) has non-positive quantity: {qty}"
                    )

                line_payload: Dict[str, Any] = {
                    "LineNum": int(line_num),
                    "Quantity": qty,
                }
                if customized.customized_unit_price is not None:
                    line_payload["UnitPrice"] = float(customized.customized_unit_price)

                if customized.warehouse_code:
                    line_payload["WarehouseCode"] = str(customized.warehouse_code).strip()

                free_texts = []
                if customized.free_text:
                    free_texts.append(str(customized.free_text).strip())
                if customized.u_specification:
                    free_texts.append(f"Spec: {str(customized.u_specification).strip()}")
                if customized.u_packing:
                    free_texts.append(f"Pack: {str(customized.u_packing).strip()}")

                if free_texts:
                    line_payload["FreeText"] = " | ".join(free_texts)

                if customized.u_brand:
                    line_payload["U_Brand"] = str(customized.u_brand).strip()

                patch_document_lines.append(line_payload)
            else:
                # Unselected or unmodified line: preserve existing SAP line data without modification
                patch_document_lines.append({
                    "LineNum": int(line_num),
                    "Quantity": float(live_line.get("Quantity") or 0.0),
                })

        payload: Dict[str, Any] = {
            "DocumentLines": patch_document_lines,
        }

        # Header updates if customized
        header_comments = str(draft.internal_approval_notes or "").strip()
        custom_ref = f"CD-{draft.id}"
        full_comment = f"Customized via App (Ref {custom_ref})"
        if header_comments:
            full_comment += f" - {header_comments}"
        payload["Comments"] = full_comment

        return payload
