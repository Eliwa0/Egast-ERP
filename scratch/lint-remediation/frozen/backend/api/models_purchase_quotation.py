from django.db import models
from django.contrib.auth.models import User


class PurchaseQuotationDraft(models.Model):
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

    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default=DRAFT, db_index=True)

    # Header Fields
    vehicle_number = models.CharField(max_length=100, blank=True, default="")
    container_quantity = models.IntegerField(default=0, blank=True)
    vendor_card_code = models.CharField(max_length=100, blank=True)
    vendor_name = models.CharField(max_length=200, blank=True)
    contact_person_code = models.IntegerField(null=True, blank=True)
    vendor_ref_no = models.CharField(max_length=100, blank=True)
    currency = models.CharField(max_length=20, default="EGP", blank=True)
    group_no = models.CharField(max_length=50, blank=True)  # PQTGrpNum
    posting_date = models.DateField(null=True, blank=True)
    valid_until = models.DateField(null=True, blank=True)
    document_date = models.DateField(null=True, blank=True)
    required_date = models.DateField(null=True, blank=True)
    buyer_code = models.IntegerField(null=True, blank=True)
    owner_code = models.IntegerField(null=True, blank=True)
    journal_remark = models.CharField(max_length=250, blank=True)
    remarks = models.TextField(blank=True)

    # Logistics & Accounting Fields
    ship_to_address = models.TextField(blank=True)
    pay_to_address = models.TextField(blank=True)
    payment_terms_code = models.IntegerField(null=True, blank=True)

    # Totals / Financial Aggregates
    total_before_discount = models.DecimalField(max_digits=19, decimal_places=6, default=0.0)
    discount_percent = models.DecimalField(max_digits=9, decimal_places=4, default=0.0)
    discount_amount = models.DecimalField(max_digits=19, decimal_places=6, default=0.0)
    freight = models.DecimalField(max_digits=19, decimal_places=6, default=0.0)
    tax_total = models.DecimalField(max_digits=19, decimal_places=6, default=0.0)
    rounding = models.DecimalField(max_digits=19, decimal_places=6, default=0.0)
    total_payment_due = models.DecimalField(max_digits=19, decimal_places=6, default=0.0)

    # Line Items JSON
    lines = models.JSONField(default=list)

    # Audit & User References
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_purchase_quotation_drafts",
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="updated_purchase_quotation_drafts",
    )
    cancelled_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cancelled_purchase_quotation_drafts",
    )
    posted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="posted_purchase_quotation_drafts",
    )
    cancellation_reason = models.TextField(blank=True)

    # SAP Integration Fields
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
            models.Index(fields=["status", "created_at"], name="pq_draft_status_created_idx"),
            models.Index(fields=["vendor_card_code"], name="pq_draft_vendor_card_idx"),
        ]

    @property
    def is_active(self):
        return self.status in self.ACTIVE_STATUSES

    def __str__(self):
        return f"Purchase Quotation Draft #{self.id} for Vendor {self.vendor_name or self.vendor_card_code} [{self.status}]"


class PurchaseQuotationPostingAuditLog(models.Model):
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
        PurchaseQuotationDraft,
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
        related_name="purchase_quotation_posting_audit_logs",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["draft", "created_at"], name="pq_audit_draft_created_idx"),
            models.Index(fields=["action", "created_at"], name="pq_audit_action_created_idx"),
        ]

    def __str__(self):
        return f"Purchase Quotation Audit #{self.id} draft={self.draft_id} action={self.action}"
