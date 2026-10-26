from django.db import models
from django.contrib.auth.models import User

class PendingQualityInspection(models.Model):
    PENDING_REVIEW = 'PENDING_REVIEW'
    POSTED = 'POSTED'
    REJECTED = 'REJECTED'
    FAILED = 'FAILED'
    
    STATUS_CHOICES = [
        (PENDING_REVIEW, 'Pending Review'),
        (POSTED, 'Posted'),
        (REJECTED, 'Rejected'),
        (FAILED, 'Failed'),
    ]

    batch_number = models.CharField(max_length=100, db_index=True)
    item_code = models.CharField(max_length=100, blank=True)
    item_name = models.CharField(max_length=200, blank=True)
    vendor_card_code = models.CharField(max_length=100, blank=True)
    vendor_name = models.CharField(max_length=200, blank=True)
    supplier_name = models.CharField(max_length=200, blank=True)
    farm_origin = models.CharField(max_length=200, blank=True)
    inspector_name = models.CharField(max_length=100, blank=True)
    data_clerk_name = models.CharField(max_length=100, blank=True)
    contractor_name = models.CharField(max_length=100, blank=True)
    car_number = models.CharField(max_length=50, blank=True)
    container_quantity = models.IntegerField(default=0, blank=True)
    crop_name = models.CharField(max_length=100, blank=True)
    raw_material_type = models.CharField(max_length=100, blank=True)
    inspection_date = models.DateField(null=True, blank=True)
    posting_date = models.DateField(null=True, blank=True)
    document_date = models.DateField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)
    warehouse_code = models.CharField(max_length=50, blank=True)
    quantity = models.FloatField(default=0.0)
    uom_code = models.CharField(max_length=50, blank=True)
    uom_name = models.CharField(max_length=100, blank=True)
    unit_price = models.DecimalField(max_digits=19, decimal_places=6, null=True, blank=True)
    tax_code = models.CharField(max_length=50, blank=True)
    discount_percent = models.DecimalField(max_digits=9, decimal_places=4, null=True, blank=True)
    grpo_comments = models.TextField(blank=True)
    vendor_ref_no = models.CharField(max_length=100, blank=True)
    journal_remark = models.CharField(max_length=250, blank=True)
    location = models.CharField(max_length=100, blank=True)
    general = models.CharField(max_length=100, blank=True)
    batch_quantity = models.FloatField(default=0.0)
    manufacturing_date = models.DateField(null=True, blank=True)
    admission_date = models.DateField(null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    bin_abs_entry = models.CharField(max_length=50, blank=True)
    bin_code = models.CharField(max_length=100, blank=True)
    bin_quantity = models.FloatField(default=0.0)
    
    sample_size = models.IntegerField(default=5)
    samples_data = models.JSONField(default=list)
    notes = models.TextField(blank=True)
    
    # Calculated aggregates
    total_defects_count = models.IntegerField(default=0)
    average_defects_per_sample = models.FloatField(default=0.0)
    decision = models.CharField(max_length=50, default='Accepted')
    quarantine_violation = models.BooleanField(default=False)
    
    # Excel-specific metrics
    af_waste_total = models.IntegerField(default=0)
    ag_quality_total = models.IntegerField(default=0)
    ah_grand_total = models.IntegerField(default=0)
    combined_bruises_cuts_percentage = models.FloatField(default=0.0)
    high_cut_percentage = models.FloatField(default=0.0)
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=PENDING_REVIEW, db_index=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='quality_submissions')
    reviewed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='quality_reviews')
    rejection_reason = models.TextField(blank=True)
    
    sap_doc_entry = models.CharField(max_length=50, blank=True)
    sap_doc_num = models.CharField(max_length=50, blank=True)
    sap_error = models.TextField(blank=True)
    scale_draft = models.ForeignKey('scale.ScaleDraft', on_delete=models.SET_NULL, null=True, blank=True, related_name='quality_inspections')
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    posted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Inspection {self.id} — Batch {self.batch_number} [{self.status}]"


class QualityItemSequence(models.Model):
    item_code = models.CharField(max_length=100, unique=True, db_index=True)
    last_sequence = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.item_code} -> {self.last_sequence}"


class QualityCategory(models.Model):
    code = models.CharField(max_length=40, unique=True, db_index=True)
    name_ar = models.CharField(max_length=200)
    name_en = models.CharField(max_length=200)
    sort_order = models.IntegerField(default=0, db_index=True)
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "id"]
        verbose_name_plural = "Quality categories"

    def __str__(self):
        return f"{self.code} - {self.name_en or self.name_ar}"


class InspectionStage(models.Model):
    code = models.CharField(max_length=40, unique=True, db_index=True)
    name_ar = models.CharField(max_length=200)
    name_en = models.CharField(max_length=200)
    sort_order = models.IntegerField(default=0, db_index=True)
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "id"]

    def __str__(self):
        return f"{self.code} - {self.name_en or self.name_ar}"


class QualityCriterion(models.Model):
    code = models.CharField(max_length=80, unique=True, db_index=True)
    calculation_key = models.CharField(max_length=80, blank=True, db_index=True)
    name_ar = models.CharField(max_length=200)
    name_en = models.CharField(max_length=200, blank=True)
    inspection_stage = models.ForeignKey(InspectionStage, on_delete=models.PROTECT, related_name="criteria")
    category = models.ForeignKey(QualityCategory, on_delete=models.PROTECT, related_name="criteria")
    display_order = models.IntegerField(default=0, db_index=True)
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["display_order", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["inspection_stage", "calculation_key"],
                condition=~models.Q(calculation_key=""),
                name="unique_quality_criterion_calc_key_per_stage",
            ),
        ]

    def __str__(self):
        return f"{self.code} - {self.name_en or self.name_ar}"


class ItemQualityCriterion(models.Model):
    item_code = models.CharField(max_length=100, db_index=True)
    inspection_stage = models.ForeignKey(InspectionStage, on_delete=models.PROTECT, related_name="item_criteria")
    quality_criterion = models.ForeignKey(QualityCriterion, on_delete=models.CASCADE, related_name="item_mappings")
    display_order = models.IntegerField(default=0, db_index=True)
    is_required = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("item_code", "inspection_stage", "quality_criterion")]
        ordering = ["display_order", "id"]
        indexes = [
            models.Index(fields=["item_code", "inspection_stage", "display_order"], name="iqc_item_stage_order_idx"),
        ]

    def __str__(self):
        return f"{self.item_code} [{self.inspection_stage.code}] -> {self.quality_criterion.code}"


class PurchaseGRPODraft(models.Model):
    DRAFT = "DRAFT"
    PENDING_REVIEW = "PENDING_REVIEW"
    APPROVED_FOR_POSTING = "APPROVED_FOR_POSTING"
    POSTED = "POSTED"
    POSTING_FAILED = "POSTING_FAILED"
    CANCELLED = "CANCELLED"

    ACTIVE_STATUSES = [
        DRAFT,
        PENDING_REVIEW,
        APPROVED_FOR_POSTING,
        POSTING_FAILED,
    ]

    STATUS_CHOICES = [
        (DRAFT, "Draft"),
        (PENDING_REVIEW, "Pending Review"),
        (APPROVED_FOR_POSTING, "Approved for Posting"),
        (POSTED, "Posted"),
        (POSTING_FAILED, "Posting Failed"),
        (CANCELLED, "Cancelled"),
    ]

    inspection = models.ForeignKey(
        PendingQualityInspection,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="grpo_drafts",
    )
    scale_draft = models.ForeignKey(
        'scale.ScaleDraft',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='grpo_drafts',
    )
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default=DRAFT, db_index=True)

    vendor_card_code = models.CharField(max_length=100, blank=True)
    vendor_name = models.CharField(max_length=200, blank=True)
    posting_date = models.DateField(null=True, blank=True)
    document_date = models.DateField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)
    comments = models.TextField(blank=True)
    vendor_ref_no = models.CharField(max_length=100, blank=True)
    journal_remark = models.CharField(max_length=250, blank=True)
    location = models.CharField(max_length=100, blank=True)
    general = models.CharField(max_length=100, blank=True)
    car_number = models.CharField(max_length=50, blank=True)
    container_quantity = models.IntegerField(default=0, blank=True)

    item_code = models.CharField(max_length=100, blank=True)
    item_name = models.CharField(max_length=200, blank=True)
    quantity = models.FloatField(default=0.0)
    uom_code = models.CharField(max_length=50, blank=True)
    uom_name = models.CharField(max_length=100, blank=True)
    warehouse_code = models.CharField(max_length=50, blank=True)
    unit_price = models.DecimalField(max_digits=19, decimal_places=6, null=True, blank=True)
    tax_code = models.CharField(max_length=50, blank=True)
    discount_percent = models.DecimalField(max_digits=9, decimal_places=4, null=True, blank=True)

    batch_number = models.CharField(max_length=100, blank=True, db_index=True)
    batch_quantity = models.FloatField(default=0.0)
    manufacturing_date = models.DateField(null=True, blank=True)
    admission_date = models.DateField(null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True)

    bin_abs_entry = models.CharField(max_length=50, blank=True)
    bin_code = models.CharField(max_length=100, blank=True)
    bin_quantity = models.FloatField(default=0.0)

    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_purchase_grpo_drafts",
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="updated_purchase_grpo_drafts",
    )
    cancelled_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cancelled_purchase_grpo_drafts",
    )
    posted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="posted_purchase_grpo_drafts",
    )
    cancellation_reason = models.TextField(blank=True)

    sap_doc_entry = models.CharField(max_length=50, blank=True)
    sap_doc_num = models.CharField(max_length=50, blank=True)
    sap_error_message = models.TextField(blank=True)
    sap_payload_snapshot = models.JSONField(null=True, blank=True)
    sap_response_snapshot = models.JSONField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    posted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["inspection", "status"], name="grpo_draft_ins_status_idx"),
            models.Index(fields=["status", "created_at"], name="grpo_draft_status_created_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["inspection"],
                condition=models.Q(
                    status__in=[
                        "DRAFT",
                        "PENDING_REVIEW",
                        "APPROVED_FOR_POSTING",
                        "POSTING_FAILED",
                    ]
                ),
                name="unique_active_grpo_draft_per_inspection",
            ),
            models.UniqueConstraint(
                fields=["scale_draft"],
                condition=models.Q(
                    status__in=[
                        "DRAFT",
                        "PENDING_REVIEW",
                        "APPROVED_FOR_POSTING",
                        "POSTING_FAILED",
                    ]
                ),
                name="unique_active_grpo_draft_per_scale_draft",
            ),
        ]

    @property
    def is_active(self):
        return self.status in self.ACTIVE_STATUSES

    @property
    def quotation(self):
        """
        Resolves the linked PurchaseQuotationDraft from the underlying ScaleDraft,
        preserving the single source of truth established during weighbridge matching.
        """
        if getattr(self, "_quotation_override", None) is not None:
            return self._quotation_override
        if self.scale_draft_id and self.scale_draft:
            return self.scale_draft.quotation
        return None

    @quotation.setter
    def quotation(self, value):
        self._quotation_override = value

    @property
    def quotation_line_index(self):
        """
        Resolves the matched quotation line index from the underlying ScaleDraft.
        Returns None if no quotation is linked to the scale draft.
        """
        if getattr(self, "_quotation_line_index_override", None) is not None:
            return self._quotation_line_index_override
        if self.scale_draft_id and self.scale_draft and self.scale_draft.quotation_id:
            return self.scale_draft.quotation_line_index
        return None

    @quotation_line_index.setter
    def quotation_line_index(self, value):
        self._quotation_line_index_override = value

    def __str__(self):
        source = f"Inspection #{self.inspection_id}" if self.inspection_id else (f"Scale #{self.scale_draft_id}" if self.scale_draft_id else "Direct")
        return f"Purchase GRPO Draft #{self.id} for {source} [{self.status}]"


class PurchaseGRPOPostingAuditLog(models.Model):
    ACTION_PREVIEW = "PREVIEW"
    ACTION_VERIFY = "VERIFY"
    ACTION_APPROVE = "APPROVE"
    ACTION_POST_ATTEMPT = "POST_ATTEMPT"
    ACTION_POST_SUCCESS = "POST_SUCCESS"
    ACTION_POST_FAILURE = "POST_FAILURE"

    ACTION_CHOICES = [
        (ACTION_PREVIEW, "Preview"),
        (ACTION_VERIFY, "Verify"),
        (ACTION_APPROVE, "Approve"),
        (ACTION_POST_ATTEMPT, "Post Attempt"),
        (ACTION_POST_SUCCESS, "Post Success"),
        (ACTION_POST_FAILURE, "Post Failure"),
    ]

    draft = models.ForeignKey(
        PurchaseGRPODraft,
        on_delete=models.CASCADE,
        related_name="posting_audit_logs",
    )
    action = models.CharField(max_length=30, choices=ACTION_CHOICES, db_index=True)
    status_before = models.CharField(max_length=30, blank=True)
    status_after = models.CharField(max_length=30, blank=True)
    sap_object = models.CharField(max_length=80, blank=True)
    payload_snapshot = models.JSONField(null=True, blank=True)
    response_snapshot = models.JSONField(null=True, blank=True)
    error_message = models.TextField(blank=True)
    actor = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="purchase_grpo_posting_audit_logs",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["draft", "created_at"], name="grpo_audit_draft_created_idx"),
            models.Index(fields=["action", "created_at"], name="grpo_audit_action_created_idx"),
        ]

    def __str__(self):
        return f"Purchase GRPO Audit #{self.id} draft={self.draft_id} action={self.action}"


class PurchaseGRPODraftBatch(models.Model):
    draft = models.ForeignKey(
        PurchaseGRPODraft,
        on_delete=models.CASCADE,
        related_name="batches",
    )
    batch_number = models.CharField(max_length=100, blank=True, db_index=True)
    quantity = models.FloatField(default=0.0)

    # Bin location
    bin_abs_entry = models.CharField(max_length=50, blank=True)
    bin_code = models.CharField(max_length=100, blank=True)

    # Dates
    manufacturing_date = models.DateField(null=True, blank=True)
    admission_date = models.DateField(null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True)

    # 11 Batch properties matching ReceiptWizard (kept for backward compatibility):
    size = models.CharField(max_length=100, blank=True)
    brand = models.CharField(max_length=100, blank=True)
    category = models.CharField(max_length=100, blank=True)
    packing = models.CharField(max_length=100, blank=True)
    season = models.CharField(max_length=100, blank=True)
    extra_specification = models.CharField(max_length=100, blank=True)
    vendor = models.CharField(max_length=100, blank=True)
    part = models.CharField(max_length=100, blank=True)
    company = models.CharField(max_length=100, blank=True)
    number = models.CharField(max_length=100, blank=True)
    details = models.TextField(blank=True)

    # Simplified 6-attributes workflow attributes (Batch Attribute 1 & 2):
    batch_attribute_1 = models.CharField(max_length=100, blank=True, default="")
    batch_attribute_2 = models.CharField(max_length=100, blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]
        indexes = [
            models.Index(fields=["draft", "batch_number"], name="grpo_batch_draft_num_idx"),
        ]

    def __str__(self):
        return f"Batch {self.batch_number} (Qty: {self.quantity}) for Draft #{self.draft_id}"
