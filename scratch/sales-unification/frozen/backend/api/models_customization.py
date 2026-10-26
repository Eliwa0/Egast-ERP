from django.db import models
from django.contrib.auth.models import User


class CustomizationDraft(models.Model):
    """
    Tracks local preparation, internal manager review, SAP quotation PATCH synchronization,
    external customer approval evidence, and subsequent native Sales Order creation.
    """
    STATUS_DRAFT = "DRAFT"
    STATUS_PENDING_INTERNAL_REVIEW = "PENDING_INTERNAL_REVIEW"
    STATUS_INTERNAL_APPROVED = "INTERNAL_APPROVED"
    STATUS_INTERNAL_REJECTED = "INTERNAL_REJECTED"
    STATUS_PATCHING = "PATCHING"
    STATUS_SAP_QUOTATION_UPDATED = "SAP_QUOTATION_UPDATED"
    STATUS_PATCH_FAILED = "PATCH_FAILED"
    STATUS_WAITING_CUSTOMER_APPROVAL = "WAITING_CUSTOMER_APPROVAL"
    STATUS_CUSTOMER_APPROVED = "CUSTOMER_APPROVED"
    STATUS_CUSTOMER_REJECTED = "CUSTOMER_REJECTED"
    STATUS_READY_FOR_ORDER = "READY_FOR_ORDER"
    STATUS_ORDER_POSTING = "ORDER_POSTING"
    STATUS_ORDER_POSTED = "ORDER_POSTED"
    STATUS_ORDER_FAILED = "ORDER_FAILED"

    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_PENDING_INTERNAL_REVIEW, "Pending Internal Review"),
        (STATUS_INTERNAL_APPROVED, "Internally Approved"),
        (STATUS_INTERNAL_REJECTED, "Internally Rejected"),
        (STATUS_PATCHING, "Patching SAP Quotation"),
        (STATUS_SAP_QUOTATION_UPDATED, "SAP Quotation Updated"),
        (STATUS_PATCH_FAILED, "SAP Quotation Patch Failed"),
        (STATUS_WAITING_CUSTOMER_APPROVAL, "Waiting Customer Approval"),
        (STATUS_CUSTOMER_APPROVED, "Customer Approved"),
        (STATUS_CUSTOMER_REJECTED, "Customer Rejected"),
        (STATUS_READY_FOR_ORDER, "Ready for Order"),
        (STATUS_ORDER_POSTING, "Posting Sales Order"),
        (STATUS_ORDER_POSTED, "Sales Order Posted"),
        (STATUS_ORDER_FAILED, "Sales Order Failed"),
    ]

    APPROVAL_TYPE_PO = "PURCHASE_ORDER"
    APPROVAL_TYPE_SIGNED_DOC = "SIGNED_QUOTATION"
    APPROVAL_TYPE_EMAIL = "EMAIL_CONFIRMATION"

    APPROVAL_TYPE_CHOICES = [
        (APPROVAL_TYPE_PO, "Customer Purchase Order (PO)"),
        (APPROVAL_TYPE_SIGNED_DOC, "Signed Quotation Document"),
        (APPROVAL_TYPE_EMAIL, "Written Email Confirmation"),
    ]

    # Target SAP Sales Quotation (OQUT) - Populated upon approval/posting to SAP
    quotation_doc_entry = models.IntegerField(null=True, blank=True, db_index=True)
    quotation_doc_num = models.CharField(max_length=50, blank=True, default="", db_index=True)
    customer_code = models.CharField(max_length=100)
    customer_name = models.CharField(max_length=200, blank=True)
    status = models.CharField(
        max_length=40,
        choices=STATUS_CHOICES,
        default=STATUS_DRAFT,
        db_index=True,
    )
    is_local_creation = models.BooleanField(
        default=True,
        db_index=True,
        help_text="True if created locally through our 3-layer workflow.",
    )
    quotation_doc_date = models.DateField(null=True, blank=True)
    quotation_valid_until = models.DateField(null=True, blank=True)
    tax_date = models.DateField(null=True, blank=True)
    doc_rate = models.FloatField(null=True, blank=True)
    currency = models.CharField(max_length=20, blank=True, default="EGP")
    payment_group_code = models.IntegerField(null=True, blank=True)
    sales_person_code = models.IntegerField(null=True, blank=True)
    comments = models.TextField(blank=True, default="")
    wrapping = models.CharField(max_length=100, blank=True, default="")
    header_fields = models.JSONField(default=dict, blank=True)
    draft_payload = models.JSONField(default=dict, blank=True, help_text="Full structured wizard payload before SAP creation.")

    # Initial snapshot from SAP for external change detection prior to PATCH
    original_sap_snapshot = models.JSONField(
        default=dict,
        help_text="Snapshot of OQUT/QUT1 fields at draft creation to detect external changes.",
    )

    # Internal Manager Review
    internal_reviewed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="customization_internal_reviews",
    )
    internal_reviewed_at = models.DateTimeField(null=True, blank=True)
    internal_approval_notes = models.TextField(blank=True)
    internal_rejection_reason = models.TextField(blank=True)

    # Customer Approval Gate (Recorded by Internal Employee)
    customer_approval_type = models.CharField(
        max_length=40,
        choices=APPROVAL_TYPE_CHOICES,
        blank=True,
    )
    customer_reference_number = models.CharField(
        max_length=100,
        blank=True,
        help_text="Customer PO number or signed document archive reference.",
    )
    customer_contact_person = models.CharField(
        max_length=150,
        blank=True,
        help_text="Name and title of the external customer authority who approved.",
    )
    customer_approval_notes = models.TextField(blank=True)
    customer_approval_recorded_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="customization_customer_approvals_recorded",
    )
    customer_approval_recorded_at = models.DateTimeField(null=True, blank=True)

    # SAP Order Result
    sap_order_doc_entry = models.CharField(max_length=50, blank=True)
    sap_order_doc_num = models.CharField(max_length=50, blank=True)
    order_posted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="customization_orders_posted",
    )
    order_posted_at = models.DateTimeField(null=True, blank=True)

    # Audit & Payloads
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="customization_drafts_created",
    )
    raw_patch_payload = models.JSONField(null=True, blank=True)
    raw_order_payload = models.JSONField(null=True, blank=True)
    sap_error = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["quotation_doc_entry", "status"], name="cd_entry_status_idx"),
            models.Index(fields=["status", "created_at"], name="cd_status_created_idx"),
        ]

    def __str__(self):
        return f"CustomizationDraft #{self.id} (Quotation {self.quotation_doc_num}) [{self.status}]"


class CustomizationDraftLine(models.Model):
    """
    Represents an item row within a Customization Draft, linking to QUT1.LineNum.
    """
    draft = models.ForeignKey(
        CustomizationDraft,
        on_delete=models.CASCADE,
        related_name="lines",
    )
    line_number = models.IntegerField(help_text="Corresponds to QUT1.LineNum")
    item_code = models.CharField(max_length=100)
    item_description = models.CharField(max_length=250, blank=True)
    uom = models.CharField(max_length=50, blank=True)

    original_quantity = models.FloatField(default=0.0)
    customized_quantity = models.FloatField(default=0.0)

    original_unit_price = models.DecimalField(max_digits=19, decimal_places=6, default=0.0)
    customized_unit_price = models.DecimalField(max_digits=19, decimal_places=6, default=0.0)

    warehouse_code = models.CharField(max_length=50, blank=True)
    cost_center_code = models.CharField(max_length=50, blank=True)
    free_text = models.TextField(blank=True)
    tax_code = models.CharField(max_length=50, blank=True, default="")
    discount_percent = models.FloatField(default=0.0)
    uom_entry = models.IntegerField(null=True, blank=True)

    # Customization Specifications (UDFs)
    u_specification = models.CharField(max_length=200, blank=True)
    u_brand = models.CharField(max_length=100, blank=True)
    u_size = models.CharField(max_length=50, blank=True, default="")
    u_pallets = models.CharField(max_length=50, blank=True, default="")
    u_packing = models.CharField(max_length=100, blank=True)

    # Selection state: only selected lines are transferred to the Sales Order
    is_selected = models.BooleanField(
        default=True,
        help_text="If False, line is omitted from the Sales Order and remains open in the Quotation.",
    )

    class Meta:
        ordering = ["line_number"]
        unique_together = [("draft", "line_number")]

    def __str__(self):
        return f"DraftLine #{self.line_number}: {self.item_code} (Qty: {self.customized_quantity})"
