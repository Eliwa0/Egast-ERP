from django.db import models
from django.contrib.auth.models import User


class PendingIssue(models.Model):
    PENDING_REVIEW = "PENDING_REVIEW"
    POSTING = "POSTING"
    POSTED = "POSTED"
    REJECTED = "REJECTED"
    FAILED = "FAILED"

    STATUS_CHOICES = [
        (PENDING_REVIEW, "Pending Review"),
        (POSTING, "Posting to SAP"),
        (POSTED, "Posted"),
        (REJECTED, "Rejected"),
        (FAILED, "Failed"),
    ]

    production_order_doc_entry = models.IntegerField(db_index=True)
    production_order_doc_num = models.CharField(max_length=50, db_index=True)
    production_order_item_code = models.CharField(max_length=100, blank=True)
    production_order_item_name = models.CharField(max_length=200, blank=True)
    production_order_status = models.CharField(max_length=20, default="R", blank=True)

    posting_date = models.DateField()
    document_date = models.DateField(null=True, blank=True)
    comments = models.TextField(blank=True)
    journal_memo = models.CharField(max_length=250, blank=True)

    total_components_count = models.IntegerField(default=0)
    total_quantity = models.FloatField(default=0.0)

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=PENDING_REVIEW,
        db_index=True,
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pending_issues",
    )
    reviewed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reviewed_issues",
    )
    posted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="posted_issues",
    )

    sap_doc_entry = models.CharField(max_length=50, blank=True)
    sap_doc_num = models.CharField(max_length=50, blank=True)
    sap_error = models.TextField(blank=True)
    rejection_reason = models.TextField(blank=True)
    raw_payload_json = models.JSONField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    posted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "created_at"], name="pi_status_created_idx"),
            models.Index(fields=["production_order_doc_num"], name="pi_order_num_idx"),
            models.Index(fields=["created_by", "status"], name="pi_user_status_idx"),
        ]

    def __str__(self):
        return f"PendingIssue #{self.id} — Order {self.production_order_doc_num} [{self.status}]"


class PendingIssueLine(models.Model):
    pending_issue = models.ForeignKey(
        PendingIssue,
        on_delete=models.CASCADE,
        related_name="lines",
    )
    line_number = models.IntegerField()
    item_code = models.CharField(max_length=100)
    item_name = models.CharField(max_length=200, blank=True)
    uom_code = models.CharField(max_length=50, blank=True)
    warehouse_code = models.CharField(max_length=50)
    issue_type = models.CharField(max_length=20, default="Manual", blank=True)

    planned_quantity = models.FloatField(default=0.0)
    issued_quantity_at_submit = models.FloatField(default=0.0)
    remaining_quantity_at_submit = models.FloatField(default=0.0)
    issue_quantity = models.FloatField(default=0.0)
    allocations_json = models.JSONField(default=list, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["line_number"]
        indexes = [
            models.Index(fields=["pending_issue", "line_number"], name="pil_issue_line_idx"),
            models.Index(fields=["item_code"], name="pil_item_idx"),
        ]

    def __str__(self):
        return f"Line {self.line_number}: {self.item_code} ({self.issue_quantity})"
