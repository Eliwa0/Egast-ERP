from decimal import Decimal, ROUND_HALF_UP
from django.db import transaction
from django.utils import timezone

from ..models_purchase_quotation import PurchaseQuotationDraft, PurchaseQuotationPostingAuditLog


class ActivePurchaseQuotationDraftExists(ValueError):
    pass


class PurchaseQuotationDraftValidationError(ValueError):
    def __init__(self, errors):
        super().__init__("Purchase Quotation draft validation failed.")
        self.errors = errors


def _parse_date(value):
    if not value:
        return None
    if hasattr(value, "isoformat"):
        return value
    try:
        from datetime import date
        return date.fromisoformat(str(value).strip())
    except (ValueError, TypeError):
        return None


class PurchaseQuotationDraftService:
    """
    Foundation service for the independent Purchase Quotation workflow.
    Manages draft lifecycle, financial calculations, validation, approval, and cancellation.
    """

    editable_statuses = {PurchaseQuotationDraft.DRAFT, PurchaseQuotationDraft.POSTING_FAILED}

    def calculate_totals(self, draft):

        """
        Recalculates all line totals and header financial aggregates.
        Authoritative server-side calculations.
        """
        total_before_discount = Decimal("0.00")
        tax_total = Decimal("0.00")

        updated_lines = []
        for line in draft.lines or []:
            try:
                quoted_qty = Decimal(str(line.get("quoted_qty", 1) or 0))
            except Exception:
                quoted_qty = Decimal("0.00")

            try:
                unit_price = Decimal(str(line.get("unit_price", 0) or 0))
            except Exception:
                unit_price = Decimal("0.00")

            try:
                line_disc = Decimal(str(line.get("discount_percent", 0) or 0))
            except Exception:
                line_disc = Decimal("0.00")

            line_gross = quoted_qty * unit_price
            disc_factor = Decimal("1.00") - (line_disc / Decimal("100.00"))
            line_total = (line_gross * disc_factor).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)

            try:
                tax_rate = Decimal(str(line.get("tax_rate", 0) or 0))
            except Exception:
                tax_rate = Decimal("0.00")

            line_tax = (line_total * (tax_rate / Decimal("100.00"))).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)

            line_copy = dict(line)
            line_copy["line_total"] = float(line_total)
            line_copy["tax_amount"] = float(line_tax)
            updated_lines.append(line_copy)

            total_before_discount += line_total
            tax_total += line_tax

        draft.lines = updated_lines
        draft.total_before_discount = total_before_discount.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)

        try:
            hdr_disc_pct = Decimal(str(draft.discount_percent or 0))
        except Exception:
            hdr_disc_pct = Decimal("0.00")

        discount_amount = (draft.total_before_discount * (hdr_disc_pct / Decimal("100.00"))).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
        draft.discount_amount = discount_amount

        draft.tax_total = tax_total.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)

        try:
            freight = Decimal(str(draft.freight or 0))
        except Exception:
            freight = Decimal("0.00")

        try:
            rounding = Decimal(str(draft.rounding or 0))
        except Exception:
            rounding = Decimal("0.00")

        total_due = (draft.total_before_discount - discount_amount + draft.tax_total + freight + rounding).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
        draft.total_payment_due = max(Decimal("0.00"), total_due)

        return draft

    def create_draft(self, initial_data, user=None):
        today = timezone.now().date()
        posting_date = _parse_date(initial_data.get("posting_date")) or today
        valid_until = _parse_date(initial_data.get("valid_until")) or today
        document_date = _parse_date(initial_data.get("document_date")) or today
        required_date = _parse_date(initial_data.get("required_date")) or today

        raw_container_qty = initial_data.get("container_quantity")
        container_qty = 0
        if raw_container_qty is not None and raw_container_qty != "":
            try:
                if isinstance(raw_container_qty, float) and not raw_container_qty.is_integer():
                    container_qty = raw_container_qty
                elif isinstance(raw_container_qty, str) and "." in raw_container_qty:
                    container_qty = float(raw_container_qty)
                else:
                    container_qty = int(raw_container_qty)
            except (ValueError, TypeError):
                container_qty = raw_container_qty

        draft = PurchaseQuotationDraft(
            vehicle_number=str(initial_data.get("vehicle_number") or "").strip(),
            container_quantity=container_qty,
            vendor_card_code=initial_data.get("vendor_card_code", ""),
            vendor_name=initial_data.get("vendor_name", ""),
            contact_person_code=initial_data.get("contact_person_code"),
            vendor_ref_no=initial_data.get("vendor_ref_no", ""),
            currency=initial_data.get("currency", "EGP") or "EGP",
            group_no=initial_data.get("group_no", ""),
            posting_date=posting_date,
            valid_until=valid_until,
            document_date=document_date,
            required_date=required_date,
            buyer_code=initial_data.get("buyer_code"),
            owner_code=initial_data.get("owner_code"),
            journal_remark=initial_data.get("journal_remark", "Purchase Quotation"),
            remarks=initial_data.get("remarks", ""),
            ship_to_address=initial_data.get("ship_to_address", ""),
            pay_to_address=initial_data.get("pay_to_address", ""),
            payment_terms_code=initial_data.get("payment_terms_code"),
            discount_percent=initial_data.get("discount_percent", 0.0),
            freight=initial_data.get("freight", 0.0),
            rounding=initial_data.get("rounding", 0.0),
            lines=initial_data.get("lines", []),
            created_by=user if getattr(user, "is_authenticated", False) else None,
            updated_by=user if getattr(user, "is_authenticated", False) else None,
        )

        self.calculate_totals(draft)
        self.validate_draft_for_save(draft, for_approval=False)
        if draft.container_quantity is not None:
            try:
                draft.container_quantity = int(draft.container_quantity)
            except (ValueError, TypeError):
                pass
        draft.save()
        return draft

    def update_draft(self, draft, validated_data, user=None):
        if draft.status not in self.editable_statuses:
            raise ValueError("Only draft or posting-failed Purchase Quotations can be edited.")

        for field, value in validated_data.items():
            if hasattr(draft, field):
                if field in ("posting_date", "valid_until", "document_date", "required_date"):
                    value = _parse_date(value)
                elif field == "container_quantity" and value is not None:
                    if value == "":
                        value = 0
                    else:
                        try:
                            if isinstance(value, float) and not value.is_integer():
                                pass
                            elif isinstance(value, str) and "." in value:
                                value = float(value)
                            else:
                                value = int(value)
                        except (ValueError, TypeError):
                            pass
                elif field == "vehicle_number" and value is not None:
                    value = str(value).strip()
                setattr(draft, field, value)

        self.calculate_totals(draft)
        self.validate_draft_for_save(draft, for_approval=False)
        if draft.container_quantity is not None:
            try:
                draft.container_quantity = int(draft.container_quantity)
            except (ValueError, TypeError):
                pass

        draft.updated_by = user if getattr(user, "is_authenticated", False) else None
        draft.save()
        return draft


    def validate_draft_for_save(self, draft, for_approval=False):
        errors = {}

        if draft.vehicle_number:
            v_num = str(draft.vehicle_number).strip()
            if len(v_num) > 11:
                errors["vehicle_number"] = "Vehicle number cannot exceed 11 characters."

        if draft.container_quantity is not None:
            try:
                if isinstance(draft.container_quantity, float) and not draft.container_quantity.is_integer():
                    errors["container_quantity"] = "Container quantity must be a whole non-negative number."
                else:
                    c_qty = int(draft.container_quantity)
                    if c_qty < 0:
                        errors["container_quantity"] = "Container quantity cannot be negative."
            except (ValueError, TypeError):
                errors["container_quantity"] = "Container quantity must be a whole non-negative number."

        if for_approval:
            # Final approval requires full completeness before SAP staging/posting
            if not draft.vendor_card_code or str(draft.vendor_card_code).strip() == "":
                errors["vendor_card_code"] = "Vendor CardCode is required."

            if not draft.vendor_name or str(draft.vendor_name).strip() == "":
                errors["vendor_name"] = "Vendor Name is required."

            if not draft.posting_date:
                errors["posting_date"] = "Posting Date is required."

            if not draft.valid_until:
                errors["valid_until"] = "Valid Until date is required."

            if draft.posting_date and draft.valid_until and draft.valid_until < draft.posting_date:
                errors["valid_until"] = "Valid Until date cannot be before Posting Date."

            if not draft.lines or len(draft.lines) == 0:
                errors["lines"] = "At least one line item is required."
            else:
                for idx, line in enumerate(draft.lines):
                    if not line.get("item_code") or str(line.get("item_code")).strip() == "":
                        errors[f"line_{idx}_item_code"] = f"Line {idx+1}: Item Code is required."
                    try:
                        q_qty = float(line.get("quoted_qty", 0))
                        if q_qty <= 0:
                            raise ValueError()
                    except Exception:
                        errors[f"line_{idx}_quoted_qty"] = f"Line {idx+1}: Quoted Quantity must be > 0."

                    try:
                        r_qty = float(line.get("required_qty", 0))
                        if r_qty <= 0:
                            raise ValueError()
                    except Exception:
                        errors[f"line_{idx}_required_qty"] = f"Line {idx+1}: Required Quantity must be > 0."
        else:
            # Draft-progress save: allow saving intermediate progress during wizard steps
            if draft.posting_date and draft.valid_until and draft.valid_until < draft.posting_date:
                errors["valid_until"] = "Valid Until date cannot be before Posting Date."

            if draft.lines:
                for idx, line in enumerate(draft.lines):
                    # Only validate quantity if an item_code is already selected
                    if line.get("item_code") and str(line.get("item_code")).strip() != "":
                        try:
                            q_qty = float(line.get("quoted_qty", 0))
                            if q_qty < 0:
                                errors[f"line_{idx}_quoted_qty"] = f"Line {idx+1}: Quoted Quantity cannot be negative."
                        except Exception:
                            errors[f"line_{idx}_quoted_qty"] = f"Line {idx+1}: Quoted Quantity must be a valid number."

                        try:
                            r_qty = float(line.get("required_qty", 0))
                            if r_qty < 0:
                                errors[f"line_{idx}_required_qty"] = f"Line {idx+1}: Required Quantity cannot be negative."
                        except Exception:
                            errors[f"line_{idx}_required_qty"] = f"Line {idx+1}: Required Quantity must be a valid number."

        if errors:
            raise PurchaseQuotationDraftValidationError(errors)

    def approve_for_posting(self, draft, user=None):
        if draft.status not in self.editable_statuses:
            raise ValueError("Only draft or posting-failed Purchase Quotations can be approved for posting.")

        self.calculate_totals(draft)
        self.validate_draft_for_save(draft, for_approval=True)

        status_before = draft.status
        draft.status = PurchaseQuotationDraft.APPROVED_FOR_POSTING
        draft.sap_error_message = ""
        draft.updated_by = user if getattr(user, "is_authenticated", False) else None
        draft.save()

        PurchaseQuotationPostingAuditLog.objects.create(
            draft=draft,
            action=PurchaseQuotationPostingAuditLog.ACTION_APPROVE,
            status_before=status_before,
            status_after=draft.status,
            actor=user if getattr(user, "is_authenticated", False) else None,
        )
        return draft

    def cancel_draft(self, draft, user=None, reason=""):
        if draft.status == PurchaseQuotationDraft.POSTED:
            raise ValueError("Posted Purchase Quotations cannot be cancelled.")
        if draft.status == PurchaseQuotationDraft.CANCELLED:
            return draft

        draft.status = PurchaseQuotationDraft.CANCELLED
        draft.cancellation_reason = str(reason or "").strip()
        draft.cancelled_by = user if getattr(user, "is_authenticated", False) else None
        draft.cancelled_at = timezone.now()
        draft.updated_by = user if getattr(user, "is_authenticated", False) else None
        draft.save()
        return draft
