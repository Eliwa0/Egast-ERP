from django.db import models
from django.contrib.auth.models import User


class DeliveryDraft(models.Model):
    """
    Represents a planned Delivery Note fulfillment against an existing SAP Sales Order (ORDR).
    Supports single or partial deliveries.
    """
    STATUS_DRAFT = "DRAFT"
    STATUS_PENDING_REVIEW = "PENDING_REVIEW"
    STATUS_APPROVED = "APPROVED"
    STATUS_REJECTED = "REJECTED"
    STATUS_POSTING = "POSTING"
    STATUS_POSTED = "POSTED"
    STATUS_FAILED = "FAILED"

    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_PENDING_REVIEW, "Pending Review"),
        (STATUS_APPROVED, "Approved for Posting"),
        (STATUS_REJECTED, "Rejected"),
        (STATUS_POSTING, "Posting to SAP"),
        (STATUS_POSTED, "Posted to SAP"),
        (STATUS_FAILED, "Failed"),
    ]

    # Source SAP Sales Order (ORDR)
    sales_order_doc_entry = models.IntegerField(db_index=True)
    sales_order_doc_num = models.CharField(max_length=50, db_index=True)
    customer_code = models.CharField(max_length=100)
    customer_name = models.CharField(max_length=200, blank=True)

    status = models.CharField(
        max_length=30,
        choices=STATUS_CHOICES,
        default=STATUS_DRAFT,
        db_index=True,
    )

    doc_date = models.DateField(help_text="Posting date in SAP")
    doc_due_date = models.DateField(help_text="Fulfillment due date in SAP")
    comments = models.TextField(blank=True)

    # Costing dimensions (Dimension 1 - Location, Dimension 2 - Department, Dimension 3 - Activity)
    cost_center_1 = models.CharField(max_length=50, blank=True)
    cost_center_2 = models.CharField(max_length=50, blank=True)
    cost_center_3 = models.CharField(max_length=50, blank=True)

    # Resulting SAP Delivery Note (ODLN)
    sap_doc_entry = models.CharField(max_length=50, blank=True)
    sap_doc_num = models.CharField(max_length=50, blank=True)

    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="delivery_drafts_created",
    )
    reviewed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="delivery_drafts_reviewed",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True)

    posted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="delivery_drafts_posted",
    )
    posted_at = models.DateTimeField(null=True, blank=True)

    raw_payload_json = models.JSONField(null=True, blank=True)
    sap_error = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=['sales_order_doc_entry'],
                condition=models.Q(status__in=['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'POSTING']),
                name='delivery_one_active_order'),
        ]
        indexes = [
            models.Index(fields=["sales_order_doc_entry", "status"], name="dd_so_status_idx"),
            models.Index(fields=["status", "created_at"], name="dd_status_created_idx"),
        ]

    def __str__(self):
        return f"DeliveryDraft #{self.id} for Order #{self.sales_order_doc_num} [{self.status}]"


class DeliveryDraftLine(models.Model):
    """
    Line item for a delivery draft referencing a specific RDR1.LineNum.
    """
    draft = models.ForeignKey(
        DeliveryDraft,
        on_delete=models.CASCADE,
        related_name="lines",
    )
    line_number = models.IntegerField(help_text="Corresponds to RDR1.LineNum")
    item_code = models.CharField(max_length=100)
    item_description = models.CharField(max_length=250, blank=True)
    uom = models.CharField(max_length=50, blank=True)

    order_quantity = models.FloatField(default=0.0)
    open_quantity_at_draft = models.FloatField(default=0.0)
    delivery_quantity = models.FloatField(default=0.0)

    warehouse_code = models.CharField(max_length=50)
    cost_center_code = models.CharField(max_length=50, blank=True)
    cost_center_code2 = models.CharField(max_length=50, blank=True)

    class Meta:
        ordering = ["line_number"]
        unique_together = [("draft", "line_number")]

    def __str__(self):
        return f"DeliveryLine #{self.line_number}: {self.item_code} (Qty: {self.delivery_quantity})"


class DeliveryDraftBatch(models.Model):
    """
    Batch number and bin allocation for a delivery draft line item.
    """
    line = models.ForeignKey(
        DeliveryDraftLine,
        on_delete=models.CASCADE,
        related_name="batches",
    )
    batch_number = models.CharField(max_length=100)
    quantity = models.FloatField(default=0.0)
    bin_abs_entry = models.IntegerField(null=True, blank=True)
    bin_code = models.CharField(max_length=100, blank=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"Batch {self.batch_number} (Qty: {self.quantity}) Bin: {self.bin_code or 'N/A'}"
