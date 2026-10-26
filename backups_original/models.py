from django.db import models
from django.contrib.auth.models import User


class UserProfile(models.Model):
    ROLE_CHOICES = [
        ('admin', 'Super Admin'),
        ('super_admin', 'Super Admin'),
        ('production_admin', 'Production Admin'),
        ('transfer_admin', 'Transfer Admin'),
        ('production_user', 'Production User'),
        ('transfer_user', 'Transfer User'),
        ('production', 'Production User (legacy)'),
        ('transfer', 'Transfer User (legacy)'),
        ('user', 'Production User (legacy)'),
    ]

    user = models.OneToOneField(User, on_delete=models.CASCADE)
    warehouse = models.CharField(max_length=20, blank=True, db_index=True)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='production_user', db_index=True)

    def __str__(self):
        return f"{self.user.username} ({self.role}) - {self.warehouse}"


class ProductionOrderAttributeRule(models.Model):
    """Restricts which attribute option values are shown in the Receipt Wizard for a specific production order.
    If no rule exists for a field, all options are shown (default behavior unchanged)."""
    doc_entry = models.IntegerField(db_index=True)
    doc_num   = models.IntegerField(null=True, blank=True)
    item_code = models.CharField(max_length=100, blank=True)
    item_name = models.CharField(max_length=200, blank=True)
    field_key = models.CharField(max_length=50)  # e.g. 'size', 'brand', 'uom'
    allowed_values = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('doc_entry', 'field_key')]
        ordering = ['doc_entry', 'field_key']

    def __str__(self):
        return f"Order {self.doc_num or self.doc_entry}: {self.field_key} → {len(self.allowed_values)} values"


class UserAttributeRule(models.Model):
    """Restricts which attribute option values a specific user can see in the Receipt Wizard.
    Intersects with order-level rules. No rule = show all (backward-compatible)."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='attribute_rules')
    field_key = models.CharField(max_length=50)
    allowed_values = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('user', 'field_key')]
        ordering = ['user', 'field_key']

    def __str__(self):
        return f"{self.user.username}: {self.field_key} → {len(self.allowed_values)} values"


class WarehouseAttributeVisibilityRule(models.Model):
    """Hides specific attribute fields (not Quantity/Bin) for a warehouse in the Receipt Wizard.
    No rule = all fields visible (backward-compatible)."""
    warehouse_code = models.CharField(max_length=20, unique=True, db_index=True)
    hidden_fields = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Warehouse {self.warehouse_code}: hidden={self.hidden_fields}"


class OrderAttributeVisibilityRule(models.Model):
    """Hides specific attribute fields for a production order in the Receipt Wizard.
    If any level (order/user/warehouse) hides a field, it is hidden. No rule = all fields visible."""
    doc_entry = models.IntegerField(unique=True, db_index=True)
    doc_num   = models.IntegerField(null=True, blank=True)
    item_code = models.CharField(max_length=100, blank=True)
    item_name = models.CharField(max_length=200, blank=True)
    hidden_fields = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Order {self.doc_num or self.doc_entry}: hidden={self.hidden_fields}"


class UserAttributeVisibilityRule(models.Model):
    """Hides specific attribute fields for a user in the Receipt Wizard.
    If any level (order/user/warehouse) hides a field, it is hidden. No rule = all fields visible."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='attribute_visibility_rule')
    hidden_fields = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.username}: hidden={self.hidden_fields}"


class WarehouseAttributeRule(models.Model):
    """Restricts which attribute option values are shown for a specific warehouse in the Receipt Wizard.
    Intersects with user-level and order-level rules. No rule = show all (backward-compatible)."""
    warehouse_code = models.CharField(max_length=20, db_index=True)
    field_key = models.CharField(max_length=50)
    allowed_values = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('warehouse_code', 'field_key')]
        ordering = ['warehouse_code', 'field_key']

    def __str__(self):
        return f"Warehouse {self.warehouse_code}: {self.field_key} → {len(self.allowed_values)} values"


class TransferWarehouseRule(models.Model):
    DIRECTION_FROM = 'FROM'
    DIRECTION_TO = 'TO'
    DIRECTION_BOTH = 'BOTH'
    DIRECTION_CHOICES = [
        (DIRECTION_FROM, 'From'),
        (DIRECTION_TO, 'To'),
        (DIRECTION_BOTH, 'Both'),
    ]

    STAGE_1_TO_INTERMEDIATE = 'STAGE_1_TO_INTERMEDIATE'
    STAGE_2_TO_FRIDGE = 'STAGE_2_TO_FRIDGE'
    STAGE_BOTH = 'BOTH'
    STAGE_CHOICES = [
        (STAGE_1_TO_INTERMEDIATE, 'Stage 1 to Intermediate'),
        (STAGE_2_TO_FRIDGE, 'Stage 2 to Fridge'),
        (STAGE_BOTH, 'Both'),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='transfer_warehouse_rules')
    warehouse_code = models.CharField(max_length=20, db_index=True)
    warehouse_name = models.CharField(max_length=100, blank=True)
    direction = models.CharField(max_length=10, choices=DIRECTION_CHOICES)
    stage = models.CharField(max_length=30, choices=STAGE_CHOICES, default=STAGE_BOTH)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('user', 'warehouse_code', 'direction', 'stage')]
        ordering = ['user__username', 'warehouse_code', 'direction', 'stage']
        indexes = [
            models.Index(fields=['user', 'is_active'], name='twr_user_active_idx'),
            models.Index(fields=['warehouse_code', 'direction'], name='twr_wh_dir_idx'),
        ]

    def __str__(self):
        return (
            f"{self.user.username}: {self.warehouse_code} "
            f"{self.direction}/{self.stage} active={self.is_active}"
        )


# ── Pending Receipt Review flow ───────────────────────────────────────────────

# Pending Transfer Review flow
class PendingTransferRequest(models.Model):
    PENDING = 'PENDING'
    POSTED = 'POSTED'
    FAILED = 'FAILED'
    STATUS_CHOICES = [
        (PENDING, 'Pending'),
        (POSTED, 'Posted'),
        (FAILED, 'Failed'),
    ]

    transfer_stage = models.CharField(max_length=40, db_index=True)
    from_warehouse = models.CharField(max_length=20, db_index=True)
    from_bin = models.CharField(max_length=100, blank=True)
    to_warehouse = models.CharField(max_length=20, db_index=True)
    to_bin = models.CharField(max_length=100, blank=True)
    destination_type = models.CharField(max_length=40, blank=True)

    item_code = models.CharField(max_length=100, blank=True)
    item_name = models.CharField(max_length=200, blank=True)
    batch_number = models.CharField(max_length=100, blank=True, db_index=True)
    quantity = models.FloatField(default=0)
    lines = models.JSONField(default=list)
    raw_payload_json = models.JSONField(default=dict)

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=PENDING, db_index=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='pending_transfer_requests')
    posted_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='posted_transfer_requests')

    sap_doc_entry = models.CharField(max_length=50, blank=True)
    sap_doc_num = models.CharField(max_length=50, blank=True)
    error_message = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    posted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', 'created_at'], name='ptr_status_created_idx'),
            models.Index(fields=['created_by', 'status'], name='ptr_creator_status_idx'),
            models.Index(fields=['from_warehouse', 'status'], name='ptr_from_wh_status_idx'),
            models.Index(fields=['to_warehouse', 'status'], name='ptr_to_wh_status_idx'),
            models.Index(fields=['transfer_stage', 'status'], name='ptr_stage_status_idx'),
        ]

    def __str__(self):
        return f"PendingTransferRequest #{self.id} [{self.status}]"


# Pending Receipt Review flow
class PendingReceipt(models.Model):
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

    production_order_doc_entry = models.IntegerField(db_index=True)
    production_order_doc_num   = models.CharField(max_length=50, db_index=True)
    item_code    = models.CharField(max_length=100, blank=True)
    item_name    = models.CharField(max_length=200, blank=True)
    warehouse_code = models.CharField(max_length=20, blank=True)
    warehouse_name = models.CharField(max_length=100, blank=True)
    uom_entry    = models.CharField(max_length=20, blank=True)
    uom_label    = models.CharField(max_length=100, blank=True)
    unit_count   = models.IntegerField(default=0)
    final_quantity = models.FloatField(default=0)

    status       = models.CharField(max_length=20, choices=STATUS_CHOICES, default=PENDING_REVIEW)
    created_by   = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                     related_name='pending_receipts')
    reviewed_by  = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                     related_name='reviewed_receipts')

    sap_document_number = models.CharField(max_length=50, blank=True)
    sap_order_number    = models.CharField(max_length=50, blank=True)
    sap_error           = models.TextField(blank=True)
    raw_payload_json    = models.JSONField(null=True, blank=True)

    # Over-receipt tracking
    sap_remaining_at_submit        = models.FloatField(null=True, blank=True)
    local_pending_quantity_at_submit = models.FloatField(null=True, blank=True)
    available_quantity_at_submit   = models.FloatField(null=True, blank=True)
    requested_quantity   = models.FloatField(default=0)
    is_over_receipt      = models.BooleanField(default=False)
    over_receipt_quantity = models.FloatField(default=0)
    over_receipt_warning = models.TextField(blank=True)

    rejection_reason = models.TextField(blank=True)

    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    posted_at   = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', 'created_at'], name='pr_status_created_idx'),
            models.Index(fields=['created_by', 'status'], name='pr_creator_status_idx'),
            models.Index(fields=['warehouse_code', 'status'], name='pr_wh_status_idx'),
            models.Index(fields=['production_order_doc_num'], name='pr_order_num_idx'),
        ]

    def __str__(self):
        return f"PendingReceipt #{self.id} — Order {self.production_order_doc_num} [{self.status}]"


class BatchNumberReservation(models.Model):
    RESERVED       = 'RESERVED'
    PENDING_REVIEW = 'PENDING_REVIEW'
    POSTED         = 'POSTED'
    CANCELLED      = 'CANCELLED'
    FAILED         = 'FAILED'
    STATUS_CHOICES = [
        (RESERVED,       'Reserved'),
        (PENDING_REVIEW, 'Pending Review'),
        (POSTED,         'Posted'),
        (CANCELLED,      'Cancelled'),
        (FAILED,         'Failed'),
    ]

    production_order_doc_entry = models.IntegerField(db_index=True)
    production_order_doc_num   = models.CharField(max_length=50, db_index=True)
    item_code    = models.CharField(max_length=100, blank=True)
    batch_number = models.CharField(max_length=100, unique=True)
    suffix       = models.IntegerField()
    status       = models.CharField(max_length=20, choices=STATUS_CHOICES, default=RESERVED)

    reserved_by     = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                        related_name='batch_reservations')
    pending_receipt = models.ForeignKey(PendingReceipt, on_delete=models.SET_NULL, null=True, blank=True,
                                        related_name='batch_reservations')

    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)
    posted_at    = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = [('production_order_doc_num', 'suffix')]
        ordering = ['production_order_doc_num', 'suffix']
        indexes = [
            models.Index(fields=['status'], name='bnr_status_idx'),
            models.Index(fields=['reserved_by', 'status'], name='bnr_user_status_idx'),
        ]

    def __str__(self):
        return f"{self.batch_number} [{self.status}]"


class PendingReceiptBatch(models.Model):

    pending_receipt   = models.ForeignKey(PendingReceipt, on_delete=models.CASCADE,
                                          related_name='batches')
    batch_reservation = models.ForeignKey(BatchNumberReservation, on_delete=models.SET_NULL,
                                          null=True, blank=True, related_name='pending_batches')
    batch_number = models.CharField(max_length=100)
    quantity     = models.FloatField(default=0)
    unit_count   = models.IntegerField(default=0)
    uom_entry    = models.CharField(max_length=20, blank=True)
    uom_label    = models.CharField(max_length=100, blank=True)
    bin_location = models.CharField(max_length=100, blank=True)
    bin_abs_entry = models.CharField(max_length=20, blank=True)
    admission_date = models.CharField(max_length=20, blank=True)
    mfr_date     = models.CharField(max_length=20, blank=True)
    brand        = models.CharField(max_length=100, blank=True)
    size         = models.CharField(max_length=100, blank=True)
    category     = models.CharField(max_length=100, blank=True)
    packing      = models.CharField(max_length=100, blank=True)
    season       = models.CharField(max_length=100, blank=True, default="")
    company      = models.CharField(max_length=100, blank=True)
    vendor       = models.CharField(max_length=100, blank=True)
    part         = models.CharField(max_length=100, blank=True)
    number       = models.CharField(max_length=100, blank=True)
    details      = models.TextField(blank=True)
    extra_specification = models.CharField(max_length=200, blank=True)
    raw_batch_json = models.JSONField(null=True, blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['id']
        indexes = [
            models.Index(fields=['batch_number'], name='prb_batch_num_idx'),
        ]

    def __str__(self):
        return f"Batch {self.batch_number} → Receipt #{self.pending_receipt_id}"


class ProductionOrderVisibilityRule(models.Model):
    """Hides specific production orders from normal users based on warehouse.
    Admin sets is_hidden=True to prevent the order from appearing in the Receipt Wizard for that warehouse."""
    warehouse_code = models.CharField(max_length=20, db_index=True)
    production_order_doc_num   = models.CharField(max_length=50, db_index=True)
    production_order_doc_entry = models.IntegerField()
    item_code = models.CharField(max_length=100, blank=True)
    item_name = models.CharField(max_length=200, blank=True)
    is_hidden = models.BooleanField(default=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='order_visibility_rules')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('warehouse_code', 'production_order_doc_num')]
        ordering = ['warehouse_code', 'production_order_doc_num']

    def __str__(self):
        return f"Warehouse {self.warehouse_code}: Order {self.production_order_doc_num} hidden={self.is_hidden}"


class PostedBatchExtraReceipt(models.Model):
    """Audit log for extra quantity posted on top of an already-POSTED batch.
    The same batch_number is reused in SAP — no new batch is reserved."""
    original_pending_receipt = models.ForeignKey(
        PendingReceipt, on_delete=models.CASCADE, related_name='extra_receipts')
    original_batch = models.ForeignKey(
        PendingReceiptBatch, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='extra_receipts')
    batch_number      = models.CharField(max_length=100)
    extra_unit_count  = models.IntegerField(default=0)
    extra_quantity    = models.FloatField(default=0)
    uom_entry         = models.CharField(max_length=20, blank=True)
    uom_label         = models.CharField(max_length=100, blank=True)
    sap_document_number = models.CharField(max_length=50, blank=True)
    created_by        = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                          related_name='extra_receipts')
    created_at        = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Extra {self.extra_quantity} on batch {self.batch_number}"
