from django.conf import settings
from django.db import models


class ShippingOperation(models.Model):
    """One outbound scale ticket, one sales order, one loading manifest."""
    scale_draft = models.OneToOneField('scale.ScaleDraft', on_delete=models.PROTECT, related_name='shipping_operation')
    company_scope = models.CharField(max_length=255)
    status = models.CharField(max_length=20, default='WAITING', choices=[
        ('WAITING', 'Waiting for loading'), ('LOADING', 'Loading'),
        ('READY', 'Ready for second weight'), ('WEIGHED', 'Ready for delivery'),
        ('DELIVERY_CREATED', 'Delivery draft created'),
    ])
    sales_order_doc_entry = models.PositiveIntegerField(null=True, blank=True)
    order_snapshot = models.JSONField(default=dict)
    container_number = models.CharField(max_length=100, blank=True)
    revision = models.PositiveIntegerField(default=0)
    submitted_at = models.DateTimeField(null=True, blank=True)
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='+')
    delivery = models.OneToOneField('api.DeliveryDraft', null=True, blank=True, on_delete=models.PROTECT, related_name='shipping_operation')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class ShippingPallet(models.Model):
    operation = models.ForeignKey(ShippingOperation, on_delete=models.CASCADE, related_name='pallets')
    batch_number = models.CharField(max_length=100)
    order_line_number = models.PositiveIntegerField()
    item_code = models.CharField(max_length=100)
    item_name = models.CharField(max_length=250, blank=True)
    quantity = models.DecimalField(max_digits=16, decimal_places=6)
    uom = models.CharField(max_length=50, blank=True)
    source_warehouse = models.CharField(max_length=100)
    bin_code = models.CharField(max_length=150, blank=True)
    bin_abs_entry = models.PositiveIntegerField(null=True, blank=True)
    pallet_element = models.ForeignKey('scale.ScaleItemElement', on_delete=models.PROTECT, related_name='+')
    box_element = models.ForeignKey('scale.ScaleItemElement', on_delete=models.PROTECT, related_name='+')
    box_count = models.PositiveIntegerField()
    pallet_unit_weight = models.DecimalField(max_digits=10, decimal_places=2)
    box_unit_weight = models.DecimalField(max_digits=10, decimal_places=2)
    loading_event = models.OneToOneField('api.PhysicalTransferEvent', null=True, blank=True, on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['operation', 'batch_number'], name='shipping_manifest_batch_unique')]
