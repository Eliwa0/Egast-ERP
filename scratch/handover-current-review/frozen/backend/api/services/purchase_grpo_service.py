from django.db import IntegrityError, transaction
from django.utils import timezone

from ..models import (
    PendingQualityInspection,
    PurchaseGRPODraft,
    PurchaseGRPODraftBatch,
    PurchaseGRPOPostingAuditLog,
)
from .cache_service import build_cache_key, cache_get, cache_set


class ActivePurchaseGRPODraftExists(ValueError):
    pass


class GRPODraftResult(tuple):
    """
    Two-element tuple (draft, created) that also proxies attribute lookups
    and equality to the draft instance. This guarantees compatibility whether
    callers unpack `draft, created = ...` or use the result directly `draft = ...`.
    """

    def __new__(cls, draft, created):
        return super().__new__(cls, (draft, bool(created)))

    @property
    def draft(self):
        return self[0]

    @property
    def created(self):
        return self[1]

    def __getattr__(self, name):
        return getattr(self[0], name)

    def __eq__(self, other):
        if isinstance(other, PurchaseGRPODraft):
            return self[0] == other
        return super().__eq__(other)

    def __repr__(self):
        return f"({repr(self[0])}, {self[1]})"


class PurchaseGRPODraftValidationError(ValueError):
    def __init__(self, errors):
        super().__init__("Purchase GRPO draft validation failed.")
        self.errors = errors


class PurchaseGRPODraftService:
    """
    Foundation service for the independent Purchase GRPO workflow.

    This service deliberately stops before SAP posting. Future PurchaseDeliveryNotes
    payload building/posting should live behind a separate SAP boundary and consume an
    approved PurchaseGRPODraft rather than mutating the Quality Inspection workflow.
    """

    editable_statuses = {PurchaseGRPODraft.DRAFT, PurchaseGRPODraft.POSTING_FAILED}
    required_fields = {
        "vendor_card_code": "Vendor CardCode is required.",
        "vendor_name": "Vendor Name is required.",
        "posting_date": "Posting Date is required.",
        "document_date": "Document Date is required.",
        "due_date": "Due Date is required.",
        "item_code": "Item Code is required.",
        "item_name": "Item Name is required.",
        "uom_code": "Unit of Measure is required.",
        "warehouse_code": "Warehouse is required.",
        "unit_price": "Unit Price is required.",
        "tax_code": "Tax Code is required.",
        "batch_number": "Batch Number is required.",
        "manufacturing_date": "Manufacturing Date is required.",
        "admission_date": "Admission Date is required.",
        "bin_code": "Bin Location is required.",
        "bin_abs_entry": "Bin Location is required.",
    }

    def __init__(self, sap_client=None):
        self.sap_client = sap_client

    def _get_sap_client(self):
        if self.sap_client is None:
            from .sap_service import SAPServiceLayer
            self.sap_client = SAPServiceLayer()
        return self.sap_client

    @staticmethod
    def _get_case_insensitive(row, key, default=None):
        if not row:
            return default
        if key in row:
            return row[key]
        if key.lower() in row:
            return row[key.lower()]
        if key.upper() in row:
            return row[key.upper()]
        title_key = key.title()
        if title_key in row:
            return row[title_key]
        for current_key in row.keys():
            if current_key.lower() == key.lower().replace("_", "") or current_key.lower().replace("_", "") == key.lower():
                return row[current_key]
        return default

    @classmethod
    def _get_item_uom_fields(cls, row):
        uom_code = cls._get_case_insensitive(row, "InventoryUOM") or ""
        uom_name = uom_code
        return str(uom_code or "").strip(), str(uom_name or "").strip()

    def resolve_item_uom(self, item_code):
        item_code = str(item_code or "").strip()
        if not item_code:
            return "", ""

        cache_key = build_cache_key("sap:item-uom", item_code)
        cached = cache_get(cache_key)
        if cached:
            return cached

        try:
            item = self._get_sap_client().get_item_with_warehouse_stock(item_code)
        except Exception:
            return "KG", "KG"

        if not item or item.get("error"):
            return "KG", "KG"

        uom_code, uom_name = self._get_item_uom_fields(item)
        if not uom_code:
            uom_code, uom_name = "KG", "KG"
        cache_set("sap:item-uom", cache_key, (uom_code, uom_name), "sap_items")
        return uom_code, uom_name

    def resolve_inspection_uom(self, inspection):
        if not inspection:
            return "", ""

        uom_code = str(inspection.uom_code or "").strip()
        uom_name = str(inspection.uom_name or uom_code or "").strip()
        if uom_code:
            return uom_code, uom_name

        item_code = str(inspection.item_code or "").strip()
        if not item_code:
            return "", ""

        uom_code, uom_name = self.resolve_item_uom(item_code)
        if uom_code:
            inspection.uom_code = uom_code
            inspection.uom_name = uom_name or uom_code
            inspection.save(update_fields=["uom_code", "uom_name"])
        return uom_code, uom_name

    def ensure_draft_uom(self, draft):
        if not draft or draft.status == PurchaseGRPODraft.POSTED:
            return draft

        if draft.uom_code:
            return draft

        if getattr(draft, "inspection", None):
            uom_code, uom_name = self.resolve_inspection_uom(draft.inspection)
        elif getattr(draft, "item_code", None):
            uom_code, uom_name = self.resolve_item_uom(draft.item_code)
        else:
            uom_code, uom_name = "", ""

        if not uom_code:
            return draft

        update_fields = []
        if draft.uom_code != uom_code:
            draft.uom_code = uom_code
            update_fields.append("uom_code")
        if draft.uom_name != (uom_name or uom_code):
            draft.uom_name = uom_name or uom_code
            update_fields.append("uom_name")
        if update_fields:
            draft.save(update_fields=update_fields)
        return draft

    def get_active_draft(self, inspection):
        return (
            PurchaseGRPODraft.objects.filter(
                inspection=inspection,
                status__in=PurchaseGRPODraft.ACTIVE_STATUSES,
            )
            .order_by("-created_at")
            .first()
        )

    def get_posted_draft(self, inspection):
        return (
            PurchaseGRPODraft.objects.filter(
                inspection=inspection,
                status=PurchaseGRPODraft.POSTED,
            )
            .order_by("-posted_at", "-updated_at", "-created_at")
            .first()
        )

    def get_active_draft_for_scale(self, scale_draft):
        return (
            PurchaseGRPODraft.objects.filter(
                scale_draft=scale_draft,
                status__in=PurchaseGRPODraft.ACTIVE_STATUSES,
            )
            .order_by("-created_at")
            .first()
        )

    def get_posted_draft_for_scale(self, scale_draft):
        return (
            PurchaseGRPODraft.objects.filter(
                scale_draft=scale_draft,
                status=PurchaseGRPODraft.POSTED,
            )
            .order_by("-posted_at", "-updated_at", "-created_at")
            .first()
        )

    @classmethod
    def validate_scale_draft_completed(cls, scale_draft):
        from scale.models import ScaleDraft

        if not scale_draft:
            raise ValueError("A valid ScaleDraft instance is required.")

        draft_ident = getattr(scale_draft, "draft_number", None) or getattr(scale_draft, "id", "Unknown")

        if getattr(scale_draft, "status", None) not in {ScaleDraft.STATUS_COMPLETED, ScaleDraft.STATUS_SENT_TO_QUALITY}:
            raise ValueError(
                f"Scale draft #{draft_ident} is not completed (current status: {getattr(scale_draft, 'status', None)})."
            )

        if not getattr(scale_draft, "is_closed", False):
            raise ValueError(f"Scale draft #{draft_ident} is not closed.")

        product_weight = getattr(scale_draft, "product_weight", None)
        try:
            p_weight = float(product_weight or 0.0)
        except (TypeError, ValueError):
            p_weight = 0.0

        if p_weight <= 0:
            raise ValueError(f"Scale draft #{draft_ident} does not have a certified positive product weight (> 0 kg).")

    def create_draft_from_inspection(self, inspection, user=None):
        if self.get_posted_draft(inspection):
            raise ActivePurchaseGRPODraftExists(
                "This inspection already has a posted Purchase GRPO document."
            )

        active = self.get_active_draft(inspection)
        if active:
            raise ActivePurchaseGRPODraftExists("This inspection already has an active Purchase GRPO draft.")

        uom_code, uom_name = self.resolve_inspection_uom(inspection)

        try:
            with transaction.atomic():
                draft = PurchaseGRPODraft.objects.create(
                    inspection=inspection,
                    vendor_card_code=inspection.vendor_card_code or inspection.farm_origin or "",
                    vendor_name=inspection.vendor_name or inspection.supplier_name or "",
                    posting_date=inspection.posting_date or inspection.inspection_date,
                    document_date=inspection.document_date or inspection.inspection_date,
                    due_date=inspection.due_date or inspection.document_date or inspection.inspection_date,
                    comments=inspection.grpo_comments or inspection.notes or "",
                    vendor_ref_no=getattr(inspection, "vendor_ref_no", "") or "",
                    journal_remark=getattr(inspection, "journal_remark", "") or "",
                    location=getattr(inspection, "location", "") or "",
                    general=getattr(inspection, "general", "") or "",
                    item_code=inspection.item_code or "",
                    item_name=inspection.item_name or "",
                    quantity=inspection.quantity or 0.0,
                    container_quantity=getattr(inspection, "container_quantity", 0) or 0,
                    uom_code=uom_code,
                    uom_name=uom_name,
                    warehouse_code=inspection.warehouse_code or "",
                    unit_price=inspection.unit_price,
                    tax_code=inspection.tax_code or "",
                    discount_percent=inspection.discount_percent if inspection.discount_percent is not None else 0,
                    batch_number=inspection.batch_number or "",
                    batch_quantity=inspection.quantity or 0.0,
                    manufacturing_date=inspection.manufacturing_date,
                    admission_date=inspection.admission_date,
                    expiry_date=inspection.expiry_date,
                    bin_abs_entry=inspection.bin_abs_entry or "",
                    bin_code=inspection.bin_code or "",
                    bin_quantity=inspection.quantity if (inspection.bin_abs_entry or inspection.bin_code) else 0.0,
                    created_by=user if getattr(user, "is_authenticated", False) else None,
                    updated_by=user if getattr(user, "is_authenticated", False) else None,
                )
                if draft.batch_number or draft.quantity:
                    PurchaseGRPODraftBatch.objects.create(
                        draft=draft,
                        batch_number=draft.batch_number or "",
                        quantity=draft.quantity or 0.0,
                        bin_abs_entry=draft.bin_abs_entry or "",
                        bin_code=draft.bin_code or "",
                        manufacturing_date=draft.manufacturing_date,
                        admission_date=draft.admission_date,
                        expiry_date=draft.expiry_date,
                    )
                return draft
        except IntegrityError as exc:
            raise ActivePurchaseGRPODraftExists(
                "This inspection already has an active Purchase GRPO draft."
            ) from exc

    def ensure_draft_batches(self, draft):
        if not draft:
            return draft
        if not draft.batches.exists() and (draft.batch_number or draft.quantity):
            PurchaseGRPODraftBatch.objects.create(
                draft=draft,
                batch_number=draft.batch_number or "",
                quantity=draft.quantity or 0.0,
                bin_abs_entry=draft.bin_abs_entry or "",
                bin_code=draft.bin_code or "",
                manufacturing_date=draft.manufacturing_date,
                admission_date=draft.admission_date,
                expiry_date=draft.expiry_date,
            )
        return draft

    def get_or_create_draft_from_inspection(self, inspection, user=None):
        posted = self.get_posted_draft(inspection)
        if posted:
            return posted, False

        active = self.get_active_draft(inspection)
        if active:
            return self.ensure_draft_batches(self.ensure_draft_uom(active)), False
        try:
            return self.create_draft_from_inspection(inspection, user=user), True
        except ActivePurchaseGRPODraftExists:
            return self.ensure_draft_batches(self.ensure_draft_uom(self.get_active_draft(inspection))), False

    def create_draft_from_scale(self, scale_draft, user=None):
        self.validate_scale_draft_completed(scale_draft)

        if self.get_posted_draft_for_scale(scale_draft):
            raise ActivePurchaseGRPODraftExists(
                "This scale draft already has a posted Purchase GRPO document."
            )

        active = self.get_active_draft_for_scale(scale_draft)
        if active:
            raise ActivePurchaseGRPODraftExists(
                "This scale draft already has an active Purchase GRPO draft."
            )

        vehicle_num = getattr(scale_draft, "effective_vehicle_number", "")
        if not vehicle_num or vehicle_num == "بدون رقم":
            vehicle_num = getattr(scale_draft, "direct_vehicle_number", "") or ""
        car_number = str(vehicle_num or "").strip()

        quantity = float(scale_draft.product_weight or 0.0)

        pkg_count = getattr(scale_draft, "package_count", None)
        container_quantity = int(pkg_count) if pkg_count is not None else 0

        uom_code, uom_name = self.resolve_item_uom(scale_draft.item_code)

        today = timezone.localdate() if hasattr(timezone, "localdate") else timezone.now().date()
        doc_date = scale_draft.created_at.date() if getattr(scale_draft, "created_at", None) else today
        batch_number = str(getattr(scale_draft, "draft_number", "") or "").strip()

        try:
            with transaction.atomic():
                draft_fields = {
                    "inspection": None,
                    "scale_draft": scale_draft,
                    "vendor_card_code": str(scale_draft.vendor_card_code or "").strip(),
                    "vendor_name": str(scale_draft.vendor_name or "").strip(),
                    "posting_date": doc_date,
                    "document_date": doc_date,
                    "due_date": doc_date,
                    "comments": str(getattr(scale_draft, "notes", "") or "").strip(),
                    "vendor_ref_no": "",
                    "journal_remark": "",
                    "location": "",
                    "general": "",
                    "car_number": car_number,
                    "container_quantity": container_quantity,
                    "item_code": str(scale_draft.item_code or "").strip(),
                    "item_name": str(scale_draft.item_name or "").strip(),
                    "quantity": quantity,
                    "uom_code": uom_code,
                    "uom_name": uom_name,
                    "warehouse_code": "",
                    "unit_price": None,
                    "tax_code": "",
                    "discount_percent": 0,
                    "batch_number": batch_number,
                    "batch_quantity": quantity,
                    "manufacturing_date": doc_date,
                    "admission_date": doc_date,
                    "expiry_date": None,
                    "bin_abs_entry": "",
                    "bin_code": "",
                    "bin_quantity": 0.0,
                    "created_by": user if getattr(user, "is_authenticated", False) else None,
                    "updated_by": user if getattr(user, "is_authenticated", False) else None,
                }
                if hasattr(PurchaseGRPODraft, "container_number"):
                    draft_fields["container_number"] = str(getattr(scale_draft, "container_number", "") or "").strip()

                draft = PurchaseGRPODraft.objects.create(**draft_fields)

                if draft.batch_number or draft.quantity:
                    PurchaseGRPODraftBatch.objects.create(
                        draft=draft,
                        batch_number=draft.batch_number or "",
                        quantity=draft.quantity or 0.0,
                        bin_abs_entry="",
                        bin_code="",
                        manufacturing_date=draft.manufacturing_date,
                        admission_date=draft.admission_date,
                        expiry_date=draft.expiry_date,
                    )
                return draft
        except IntegrityError as exc:
            raise ActivePurchaseGRPODraftExists(
                "This scale draft already has an active Purchase GRPO draft."
            ) from exc

    def get_or_create_draft_from_scale(self, scale_draft, user=None):
        from scale.models import ScaleDraft

        self.validate_scale_draft_completed(scale_draft)

        if not getattr(scale_draft, "id", None):
            raise ValueError("ScaleDraft must be saved in the database before creating a GRPO draft.")

        with transaction.atomic():
            locked_scale = ScaleDraft.objects.select_for_update().get(id=scale_draft.id)
            self.validate_scale_draft_completed(locked_scale)

            posted = self.get_posted_draft_for_scale(locked_scale)
            if posted:
                return GRPODraftResult(posted, False)

            active = self.get_active_draft_for_scale(locked_scale)
            if active:
                return GRPODraftResult(self.ensure_draft_batches(self.ensure_draft_uom(active)), False)

            try:
                draft = self.create_draft_from_scale(locked_scale, user=user)
                return GRPODraftResult(draft, True)
            except ActivePurchaseGRPODraftExists:
                active = self.get_active_draft_for_scale(locked_scale)
                if active:
                    return GRPODraftResult(self.ensure_draft_batches(self.ensure_draft_uom(active)), False)
                posted = self.get_posted_draft_for_scale(locked_scale)
                if posted:
                    return GRPODraftResult(posted, False)
                raise

    def update_draft(self, draft, validated_data, user=None, inspection_updates=None, batches=None):
        if draft.status not in self.editable_statuses:
            raise ValueError("Only draft or posting-failed GRPO drafts can be edited.")

        for field, value in validated_data.items():
            setattr(draft, field, value)

        cleaned_batches = []
        if batches is not None:
            if not isinstance(batches, list) or len(batches) == 0:
                raise PurchaseGRPODraftValidationError({"batches": "At least one batch is required."})

            total_batch_qty = 0.0
            for idx, b in enumerate(batches):
                try:
                    b_qty = float(b.get("quantity") or 0.0)
                except (TypeError, ValueError):
                    b_qty = 0.0
                if b_qty <= 0:
                    raise PurchaseGRPODraftValidationError({"batches": f"Batch #{idx+1} quantity must be greater than zero."})

                b_num = str(b.get("batch_number") or "").strip()
                if not b_num:
                    raise PurchaseGRPODraftValidationError({"batches": f"Batch #{idx+1} number is required."})

                total_batch_qty += b_qty
                cleaned_batches.append({
                    "batch_number": b_num,
                    "quantity": b_qty,
                    "bin_abs_entry": str(b.get("bin_abs_entry") or b.get("binAbsEntry") or "").strip(),
                    "bin_code": str(b.get("bin_code") or b.get("bin_location_code") or "").strip(),
                    "manufacturing_date": b.get("manufacturing_date") or None,
                    "admission_date": b.get("admission_date") or None,
                    "expiry_date": b.get("expiry_date") or None,
                    "size": str(b.get("size") or "").strip(),
                    "brand": str(b.get("brand") or "").strip(),
                    "category": str(b.get("category") or "").strip(),
                    "packing": str(b.get("packing") or "").strip(),
                    "season": str(b.get("season") or "").strip(),
                    "extra_specification": str(b.get("extra_specification") or "").strip(),
                    "vendor": str(b.get("vendor") or "").strip(),
                    "part": str(b.get("part") or "").strip(),
                    "company": str(b.get("company") or "").strip(),
                    "number": str(b.get("number") or "").strip(),
                    "details": str(b.get("details") or "").strip(),
                    "batch_attribute_1": str(b.get("batch_attribute_1") or b.get("batchAttribute1") or "").strip(),
                    "batch_attribute_2": str(b.get("batch_attribute_2") or b.get("batchAttribute2") or "").strip(),
                })

        with transaction.atomic():
            if batches is not None:
                draft.batches.all().delete()
                for b in cleaned_batches:
                    PurchaseGRPODraftBatch.objects.create(draft=draft, **b)
                if cleaned_batches:
                    first = cleaned_batches[0]
                    draft.batch_number = first["batch_number"]
                    draft.batch_quantity = first["quantity"]
                    if first["bin_abs_entry"]:
                        draft.bin_abs_entry = first["bin_abs_entry"]
                        if first["bin_code"]:
                            draft.bin_code = first["bin_code"]
                        draft.bin_quantity = first["quantity"]
                    if first["manufacturing_date"]:
                        draft.manufacturing_date = first["manufacturing_date"]
                    if first["admission_date"]:
                        draft.admission_date = first["admission_date"]
                    if first["expiry_date"]:
                        draft.expiry_date = first["expiry_date"]
            else:
                self.ensure_draft_batches(draft)
                if hasattr(draft, "batches") and draft.batches.count() == 1:
                    single_b = draft.batches.first()
                    if "quantity" in validated_data:
                        single_b.quantity = draft.quantity
                    if "batch_number" in validated_data:
                        single_b.batch_number = draft.batch_number
                    if "bin_abs_entry" in validated_data:
                        single_b.bin_abs_entry = draft.bin_abs_entry
                    if "bin_code" in validated_data:
                        single_b.bin_code = draft.bin_code
                    if "manufacturing_date" in validated_data:
                        single_b.manufacturing_date = draft.manufacturing_date
                    if "admission_date" in validated_data:
                        single_b.admission_date = draft.admission_date
                    if "expiry_date" in validated_data:
                        single_b.expiry_date = draft.expiry_date
                    single_b.save()

            self.validate_draft_for_save(draft)

            draft.batch_quantity = draft.quantity or 0.0
            draft.bin_quantity = draft.quantity if (draft.bin_abs_entry or draft.bin_code) else 0.0
            draft.updated_by = user if getattr(user, "is_authenticated", False) else None
            draft.save()

            # Manual receiving drafts persist a few fields only on the linked inspection
            # (e.g. car_number, notes). Write them through only for manual entries.
            if inspection_updates and getattr(draft.inspection, "inspector_name", None) == "MANUAL":
                inspection = draft.inspection
                for field, value in inspection_updates.items():
                    setattr(inspection, field, value)
                if "container_quantity" in validated_data:
                    inspection.container_quantity = draft.container_quantity
                if "vendor_ref_no" in validated_data:
                    inspection.vendor_ref_no = draft.vendor_ref_no
                if "journal_remark" in validated_data:
                    inspection.journal_remark = draft.journal_remark
                if "unit_price" in validated_data:
                    inspection.unit_price = draft.unit_price
                if "tax_code" in validated_data:
                    inspection.tax_code = draft.tax_code
                inspection.save()

        return draft

    def validate_draft_for_save(self, draft):
        errors = {}
        for field, message in self.required_fields.items():
            value = getattr(draft, field, None)
            if value is None or str(value).strip() == "":
                errors[field] = message

        try:
            quantity = float(draft.quantity or 0)
        except (TypeError, ValueError):
            quantity = 0
        if quantity <= 0:
            errors["quantity"] = "Quantity must be greater than zero."

        if draft.discount_percent is not None and draft.discount_percent < 0:
            errors["discount_percent"] = "Discount Percent cannot be negative."

        if hasattr(draft, "batches") and draft.batches.exists():
            total_batch_qty = sum(b.quantity for b in draft.batches.all())
            draft_qty = float(draft.quantity or 0.0)
            if abs(total_batch_qty - draft_qty) > 0.001:
                errors["batches"] = f"Total batch quantity ({total_batch_qty:.3f}) does not match draft quantity ({draft_qty:.3f})."

        if errors:
            raise PurchaseGRPODraftValidationError(errors)

    def approve_for_posting(self, draft, user=None):
        if draft.status not in self.editable_statuses:
            raise ValueError("Only draft or posting-failed GRPO drafts can be approved for posting.")

        self.validate_draft_for_save(draft)
        status_before = draft.status
        draft.batch_quantity = draft.quantity or 0.0
        draft.bin_quantity = draft.quantity if (draft.bin_abs_entry or draft.bin_code) else 0.0
        draft.status = PurchaseGRPODraft.APPROVED_FOR_POSTING
        draft.sap_error_message = ""
        draft.updated_by = user if getattr(user, "is_authenticated", False) else None
        draft.save()
        PurchaseGRPOPostingAuditLog.objects.create(
            draft=draft,
            action=PurchaseGRPOPostingAuditLog.ACTION_APPROVE,
            status_before=status_before,
            status_after=draft.status,
            actor=user if getattr(user, "is_authenticated", False) else None,
        )
        return draft

    def cancel_draft(self, draft, user=None, reason=""):
        if draft.status == PurchaseGRPODraft.POSTED:
            raise ValueError("Posted Purchase GRPO drafts cannot be cancelled.")
        if draft.status == PurchaseGRPODraft.CANCELLED:
            return draft

        draft.status = PurchaseGRPODraft.CANCELLED
        draft.cancellation_reason = str(reason or "").strip()
        draft.cancelled_by = user if getattr(user, "is_authenticated", False) else None
        draft.cancelled_at = timezone.now()
        draft.updated_by = user if getattr(user, "is_authenticated", False) else None
        draft.save()

        # If linked inspection was a MANUAL receiving request, mark it as REJECTED so it doesn't leave an orphaned pending shipment
        inspection = getattr(draft, "inspection", None)
        if inspection and getattr(inspection, "inspector_name", "") == "MANUAL":
            inspection.status = PendingQualityInspection.REJECTED
            clean_reason = str(reason or "").strip()
            inspection.rejection_reason = f"Draft #{draft.id} cancelled: {clean_reason}" if clean_reason else f"Draft #{draft.id} cancelled"
            inspection.save(update_fields=["status", "rejection_reason", "updated_at"])

        return draft


def get_inspection_or_raise(inspection_id):
    return PendingQualityInspection.objects.get(id=inspection_id)
