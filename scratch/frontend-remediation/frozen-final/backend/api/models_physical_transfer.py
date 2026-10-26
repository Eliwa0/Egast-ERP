"""Local pallet custody after SAP Stage 3; these locations are not SAP warehouses."""
import uuid
from django.conf import settings
from django.db import models


class ShippingContainer(models.Model):
    company_scope = models.CharField(max_length=255)
    container_number = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['company_scope', 'container_number'], name='physical_container_unique')]


class TransferPalletCustody(models.Model):
    IN_SHIPPING_HALL = 'IN_SHIPPING_HALL'
    LOADED_TO_CONTAINER = 'LOADED_TO_CONTAINER'
    company_scope = models.CharField(max_length=255)
    batch_number = models.CharField(max_length=100)
    state = models.CharField(max_length=24, choices=[(IN_SHIPPING_HALL, IN_SHIPPING_HALL), (LOADED_TO_CONTAINER, LOADED_TO_CONTAINER)])
    physical_location = models.CharField(max_length=120)
    source_transfer = models.ForeignKey('api.PendingTransferRequest', on_delete=models.PROTECT)
    container = models.ForeignKey(ShippingContainer, null=True, blank=True, on_delete=models.PROTECT)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['company_scope', 'batch_number'], name='physical_pallet_unique'),
            models.CheckConstraint(condition=(models.Q(state='IN_SHIPPING_HALL', container__isnull=True, physical_location='SHIPPING_HALL') |
                models.Q(state='LOADED_TO_CONTAINER', container__isnull=False)), name='physical_pallet_state_valid'),
        ]


class PhysicalTransferEvent(models.Model):
    reference = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    pallet = models.ForeignKey(TransferPalletCustody, on_delete=models.PROTECT, related_name='events')
    stage = models.PositiveSmallIntegerField(choices=[(4, 'Shipping Hall arrival'), (5, 'Container loading')])
    state = models.CharField(max_length=24)
    source_location = models.CharField(max_length=120)
    destination_location = models.CharField(max_length=120)
    container = models.ForeignKey(ShippingContainer, null=True, blank=True, on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']
        constraints = [models.UniqueConstraint(fields=['pallet', 'stage'], name='physical_pallet_stage_unique')]

    def save(self, *args, **kwargs):
        if self.pk:
            raise TypeError('Physical transfer events are append-only.')
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise TypeError('Physical transfer events cannot be deleted.')
