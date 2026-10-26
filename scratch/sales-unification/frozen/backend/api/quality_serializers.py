from django.db import IntegrityError, transaction
from rest_framework import serializers

from .models import (
    InspectionStage,
    ItemQualityCriterion,
    PendingQualityInspection,
    PurchaseGRPODraft,
    PurchaseGRPODraftBatch,
    QualityCategory,
    QualityCriterion,
)
from .services.quality_service import AF_KEYS, AG_KEYS


VALID_CALCULATION_KEYS = set(AF_KEYS) | set(AG_KEYS) | {"grade_1", "grade_2", "high_cut"}


class QualityCategorySerializer(serializers.ModelSerializer):
    code = serializers.CharField(max_length=40, trim_whitespace=True)
    name_ar = serializers.CharField(max_length=200, trim_whitespace=True)
    name_en = serializers.CharField(max_length=200, trim_whitespace=True)

    class Meta:
        model = QualityCategory
        fields = [
            "id",
            "code",
            "name_ar",
            "name_en",
            "sort_order",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_code(self, value):
        code = str(value or "").strip().upper()
        if not code:
            raise serializers.ValidationError("Code is required.")
        queryset = QualityCategory.objects.filter(code__iexact=code)
        if self.instance is not None:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError("A category with this code already exists.")
        return code

    def validate_sort_order(self, value):
        if value is None:
            return 0
        return int(value)

    def validate(self, attrs):
        for field in ("name_ar", "name_en"):
            if not str(attrs.get(field, getattr(self.instance, field, "")) or "").strip():
                raise serializers.ValidationError({field: "This field is required."})
        return attrs


class InspectionStageSerializer(serializers.ModelSerializer):
    code = serializers.CharField(max_length=40, trim_whitespace=True)
    name_ar = serializers.CharField(max_length=200, trim_whitespace=True)
    name_en = serializers.CharField(max_length=200, trim_whitespace=True)

    class Meta:
        model = InspectionStage
        fields = [
            "id",
            "code",
            "name_ar",
            "name_en",
            "sort_order",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_code(self, value):
        code = str(value or "").strip().upper()
        if not code:
            raise serializers.ValidationError("Code is required.")
        queryset = InspectionStage.objects.filter(code__iexact=code)
        if self.instance is not None:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError("An inspection stage with this code already exists.")
        return code

    def validate_sort_order(self, value):
        if value is None:
            return 0
        return int(value)

    def validate(self, attrs):
        for field in ("name_ar", "name_en"):
            if not str(attrs.get(field, getattr(self.instance, field, "")) or "").strip():
                raise serializers.ValidationError({field: "This field is required."})
        return attrs


def _generate_criterion_code():
    max_number = 0
    for code in QualityCriterion.objects.filter(code__startswith="QC").values_list("code", flat=True):
        suffix = str(code or "")[2:]
        if suffix.isdigit():
            max_number = max(max_number, int(suffix))
    return f"QC{max_number + 1:04d}"


class QualityCriterionSerializer(serializers.ModelSerializer):
    code = serializers.CharField(read_only=True)
    calculation_key = serializers.CharField(max_length=80, trim_whitespace=True, required=False, allow_blank=True)
    name_ar = serializers.CharField(max_length=200, trim_whitespace=True)
    name_en = serializers.CharField(max_length=200, trim_whitespace=True, required=False, allow_blank=True)
    inspection_stage = serializers.PrimaryKeyRelatedField(queryset=InspectionStage.objects.all())
    inspection_stage_detail = InspectionStageSerializer(source="inspection_stage", read_only=True)
    inspection_stage_code = serializers.CharField(source="inspection_stage.code", read_only=True)
    inspection_stage_name_ar = serializers.CharField(source="inspection_stage.name_ar", read_only=True)
    inspection_stage_name_en = serializers.CharField(source="inspection_stage.name_en", read_only=True)
    category = serializers.PrimaryKeyRelatedField(queryset=QualityCategory.objects.all())
    category_detail = QualityCategorySerializer(source="category", read_only=True)
    category_code = serializers.CharField(source="category.code", read_only=True)
    category_name_ar = serializers.CharField(source="category.name_ar", read_only=True)
    category_name_en = serializers.CharField(source="category.name_en", read_only=True)

    class Meta:
        model = QualityCriterion
        fields = [
            "id",
            "code",
            "calculation_key",
            "name_ar",
            "name_en",
            "inspection_stage",
            "inspection_stage_detail",
            "inspection_stage_code",
            "inspection_stage_name_ar",
            "inspection_stage_name_en",
            "category",
            "category_detail",
            "category_code",
            "category_name_ar",
            "category_name_en",
            "display_order",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "code",
            "inspection_stage_detail",
            "inspection_stage_code",
            "inspection_stage_name_ar",
            "inspection_stage_name_en",
            "category_detail",
            "category_code",
            "category_name_ar",
            "category_name_en",
            "created_at",
            "updated_at",
        ]

    def validate_display_order(self, value):
        if value is None:
            return 0
        return int(value)

    def validate_calculation_key(self, value):
        return str(value or "").strip()

    def validate(self, attrs):
        for field in ("name_ar", "inspection_stage", "category"):
            if not str(attrs.get(field, getattr(self.instance, field, "")) or "").strip():
                raise serializers.ValidationError({field: "This field is required."})
        is_active = attrs.get("is_active", getattr(self.instance, "is_active", True))
        calculation_key = str(attrs.get("calculation_key", getattr(self.instance, "calculation_key", "")) or "").strip()
        inspection_stage = attrs.get("inspection_stage", getattr(self.instance, "inspection_stage", None))
        if is_active and not calculation_key:
            raise serializers.ValidationError({"calculation_key": "Calculation key is required for active criteria."})
        if calculation_key and calculation_key not in VALID_CALCULATION_KEYS:
            raise serializers.ValidationError({"calculation_key": "Calculation key is not supported by the current quality formulas."})
        if inspection_stage and calculation_key:
            queryset = QualityCriterion.objects.filter(
                inspection_stage=inspection_stage,
                calculation_key=calculation_key,
            )
            if self.instance is not None:
                queryset = queryset.exclude(pk=self.instance.pk)
            if queryset.exists():
                raise serializers.ValidationError({"calculation_key": "This calculation key is already used in the selected inspection stage."})
        return attrs

    def create(self, validated_data):
        for _ in range(100):
            code = _generate_criterion_code()
            if QualityCriterion.objects.filter(code=code).exists():
                continue
            try:
                with transaction.atomic():
                    next_data = {**validated_data, "code": code}
                    return super().create(next_data)
            except IntegrityError:
                continue
        raise serializers.ValidationError({"code": "Could not generate a unique criterion code."})


class ItemQualityCriterionSerializer(serializers.ModelSerializer):
    inspection_stage_detail = InspectionStageSerializer(source="inspection_stage", read_only=True)
    quality_criterion_detail = QualityCriterionSerializer(source="quality_criterion", read_only=True)
    criterion = serializers.PrimaryKeyRelatedField(source="quality_criterion", queryset=QualityCriterion.objects.all(), required=False, write_only=True)
    criterion_detail = QualityCriterionSerializer(source="quality_criterion", read_only=True)

    class Meta:
        model = ItemQualityCriterion
        fields = [
            "id",
            "item_code",
            "inspection_stage",
            "inspection_stage_detail",
            "quality_criterion",
            "quality_criterion_detail",
            "criterion",
            "criterion_detail",
            "display_order",
            "is_required",
            "created_at",
        ]
        read_only_fields = ["id", "inspection_stage_detail", "quality_criterion_detail", "criterion_detail", "created_at"]

    def validate_item_code(self, value):
        item_code = str(value or "").strip()
        if not item_code:
            raise serializers.ValidationError("Item code is required.")
        return item_code

    def validate(self, attrs):
        item_code = attrs.get("item_code", getattr(self.instance, "item_code", ""))
        inspection_stage = attrs.get("inspection_stage", getattr(self.instance, "inspection_stage", None))
        quality_criterion = attrs.get("quality_criterion", getattr(self.instance, "quality_criterion", None))
        if not inspection_stage:
            raise serializers.ValidationError({"inspection_stage": "Inspection stage is required."})
        if not quality_criterion:
            raise serializers.ValidationError({"quality_criterion": "Criterion is required."})
        if inspection_stage and quality_criterion and quality_criterion.inspection_stage_id != inspection_stage.id:
            raise serializers.ValidationError({"quality_criterion": "Criterion does not belong to the selected inspection stage."})
        queryset = ItemQualityCriterion.objects.filter(
            item_code=item_code,
            inspection_stage=inspection_stage,
            quality_criterion=quality_criterion,
        )
        if self.instance is not None:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError("This criterion is already mapped to the item and inspection stage.")
        return attrs


class PurchaseGRPODraftBatchSerializer(serializers.ModelSerializer):
    class Meta:
        model = PurchaseGRPODraftBatch
        fields = [
            "id",
            "batch_number",
            "quantity",
            "bin_abs_entry",
            "bin_code",
            "manufacturing_date",
            "admission_date",
            "expiry_date",
            "size",
            "brand",
            "category",
            "packing",
            "season",
            "extra_specification",
            "vendor",
            "part",
            "company",
            "number",
            "details",
            "batch_attribute_1",
            "batch_attribute_2",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class PurchaseGRPODraftSerializer(serializers.ModelSerializer):
    inspection_id = serializers.IntegerField(read_only=True, allow_null=True)
    scale_draft_id = serializers.IntegerField(read_only=True, allow_null=True)
    scale_draft = serializers.IntegerField(source="scale_draft_id", read_only=True, allow_null=True)
    inspection = serializers.IntegerField(source="inspection_id", read_only=True, allow_null=True)
    inspection_context = serializers.SerializerMethodField()
    batches = serializers.SerializerMethodField()
    quotation = serializers.SerializerMethodField()
    quotation_number = serializers.SerializerMethodField()
    quotation_sap_doc_entry = serializers.SerializerMethodField()
    quotation_line_index = serializers.SerializerMethodField()
    created_by_username = serializers.CharField(source="created_by.username", read_only=True)
    updated_by_username = serializers.CharField(source="updated_by.username", read_only=True)
    cancelled_by_username = serializers.CharField(source="cancelled_by.username", read_only=True)
    posted_by_username = serializers.CharField(source="posted_by.username", read_only=True)
    is_active = serializers.BooleanField(read_only=True)

    class Meta:
        model = PurchaseGRPODraft
        fields = [
            "id",
            "inspection",
            "inspection_id",
            "scale_draft",
            "scale_draft_id",
            "inspection_context",
            "status",
            "is_active",
            "vendor_card_code",
            "vendor_name",
            "posting_date",
            "document_date",
            "due_date",
            "vendor_ref_no",
            "journal_remark",
            "comments",
            "location",
            "general",
            "car_number",
            "container_quantity",
            "item_code",
            "item_name",
            "quantity",
            "uom_code",
            "uom_name",
            "warehouse_code",
            "unit_price",
            "tax_code",
            "discount_percent",
            "batch_number",
            "batch_quantity",
            "manufacturing_date",
            "admission_date",
            "expiry_date",
            "bin_abs_entry",
            "bin_code",
            "bin_quantity",
            "created_by",
            "created_by_username",
            "updated_by",
            "updated_by_username",
            "cancelled_by",
            "cancelled_by_username",
            "posted_by",
            "posted_by_username",
            "cancellation_reason",
            "sap_doc_entry",
            "sap_doc_num",
            "sap_error_message",
            "sap_payload_snapshot",
            "sap_response_snapshot",
            "batches",
            "quotation",
            "quotation_number",
            "quotation_sap_doc_entry",
            "quotation_line_index",
            "created_at",
            "updated_at",
            "cancelled_at",
            "posted_at",
        ]
        read_only_fields = [
            "id",
            "inspection",
            "inspection_id",
            "scale_draft",
            "scale_draft_id",
            "inspection_context",
            "batches",
            "quotation",
            "quotation_number",
            "quotation_sap_doc_entry",
            "quotation_line_index",
            "status",
            "is_active",
            "batch_quantity",
            "bin_quantity",
            "created_by",
            "created_by_username",
            "updated_by",
            "updated_by_username",
            "cancelled_by",
            "cancelled_by_username",
            "posted_by",
            "posted_by_username",
            "cancellation_reason",
            "sap_doc_entry",
            "sap_doc_num",
            "sap_error_message",
            "sap_payload_snapshot",
            "sap_response_snapshot",
            "created_at",
            "updated_at",
            "cancelled_at",
            "posted_at",
        ]

    def get_quotation(self, obj):
        q = getattr(obj, "quotation", None)
        return q.id if q else None

    def get_quotation_number(self, obj):
        q = getattr(obj, "quotation", None)
        if not q:
            return None
        return str(q.sap_doc_num or q.id)

    def get_quotation_sap_doc_entry(self, obj):
        q = getattr(obj, "quotation", None)
        if not q or not q.sap_doc_entry:
            return None
        return str(q.sap_doc_entry)

    def get_quotation_line_index(self, obj):
        return getattr(obj, "quotation_line_index", None)

    def get_batches(self, obj):
        child_batches = list(obj.batches.all())
        if child_batches:
            return PurchaseGRPODraftBatchSerializer(child_batches, many=True).data
        if obj.batch_number or obj.quantity:
            mfr_date = obj.manufacturing_date.isoformat() if hasattr(obj.manufacturing_date, "isoformat") else obj.manufacturing_date
            adm_date = obj.admission_date.isoformat() if hasattr(obj.admission_date, "isoformat") else obj.admission_date
            exp_date = obj.expiry_date.isoformat() if hasattr(obj.expiry_date, "isoformat") else obj.expiry_date
            return [
                {
                    "id": None,
                    "batch_number": obj.batch_number or "",
                    "quantity": float(obj.batch_quantity or obj.quantity or 0.0),
                    "bin_abs_entry": obj.bin_abs_entry or "",
                    "bin_code": obj.bin_code or "",
                    "manufacturing_date": mfr_date,
                    "admission_date": adm_date,
                    "expiry_date": exp_date,
                    "size": "",
                    "brand": "",
                    "category": "",
                    "packing": "",
                    "season": "",
                    "extra_specification": "",
                    "vendor": "",
                    "part": "",
                    "company": "",
                    "number": "",
                    "details": "",
                    "batch_attribute_1": "",
                    "batch_attribute_2": "",
                }
            ]
        return []

    def get_inspection_context(self, obj):
        inspection = obj.inspection
        if not inspection:
            return None
        return {
            "id": inspection.id,
            "batch_number": inspection.batch_number,
            "item_code": inspection.item_code,
            "item_name": inspection.item_name,
            "vendor_card_code": inspection.vendor_card_code,
            "vendor_name": inspection.vendor_name,
            "quantity": inspection.quantity,
            "uom_code": inspection.uom_code,
            "uom_name": inspection.uom_name,
            "decision": inspection.decision,
            "status": inspection.status,
            "is_manual": getattr(inspection, "inspector_name", None) == "MANUAL",
            "car_number": getattr(inspection, "car_number", "") or "",
            "container_quantity": getattr(inspection, "container_quantity", 0) or 0,
            "vendor_ref_no": getattr(inspection, "vendor_ref_no", "") or "",
            "journal_remark": getattr(inspection, "journal_remark", "") or "",
        }

    def validate(self, attrs):
        instance = self.instance
        if instance and instance.status not in (PurchaseGRPODraft.DRAFT, PurchaseGRPODraft.POSTING_FAILED):
            raise serializers.ValidationError("Only draft or posting-failed GRPO drafts can be edited.")

        quantity = attrs.get("quantity", getattr(instance, "quantity", 0.0) if instance else 0.0)
        if quantity is not None and float(quantity) < 0:
            raise serializers.ValidationError({"quantity": "Quantity cannot be negative."})

        container_quantity = attrs.get(
            "container_quantity",
            getattr(instance, "container_quantity", 0) if instance else 0,
        )
        if container_quantity is not None:
            try:
                if isinstance(container_quantity, float) and not container_quantity.is_integer():
                    raise serializers.ValidationError({"container_quantity": "No. Packed must be a whole non-negative number."})
                c_qty = int(container_quantity)
                if c_qty < 0:
                    raise serializers.ValidationError({"container_quantity": "No. Packed cannot be negative."})
            except (ValueError, TypeError):
                raise serializers.ValidationError({"container_quantity": "No. Packed must be a whole non-negative number."})

        discount_percent = attrs.get(
            "discount_percent",
            getattr(instance, "discount_percent", None) if instance else None,
        )
        if discount_percent is not None and discount_percent < 0:
            raise serializers.ValidationError({"discount_percent": "Discount Percent cannot be negative."})

        inspection = attrs.get("inspection", getattr(instance, "inspection", None) if instance else None)
        if inspection and instance is None:
            existing = PurchaseGRPODraft.objects.filter(
                inspection=inspection,
                status__in=[
                    *PurchaseGRPODraft.ACTIVE_STATUSES,
                    PurchaseGRPODraft.POSTED,
                ],
            )
            if existing.exists():
                raise serializers.ValidationError("This inspection already has a Purchase GRPO draft or posted document.")
        return attrs
