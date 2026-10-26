"""
Cold Storage Physical Capacity & Pallet Position Models.

Models the physical pallet-position layer inside SAP Bin Locations.
SAP Bin represents the inventory/accounting location (Warehouse, BinCode, AbsEntry).
ColdStoragePalletPosition represents a physical slot inside that SAP Bin channel.

Strict Invariants:
1. Every physical position has exactly one SAP parent Bin layout.
2. sap_bin_abs_entry is always populated and linked to its parent.
3. warehouse_code, bin_code, sap_bin_abs_entry are strictly synchronized.
4. Concurrency-safe reservations with select_for_update().
"""
from django.db import models, transaction
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.utils import timezone


class ColdStorageBinLayout(models.Model):
    """
    Physical layout and capacity configuration for a specific SAP Bin Location.
    """
    CHANNEL_STANDARD = 'STANDARD'
    CHANNEL_BULK = 'BULK'
    CHANNEL_CORRIDOR = 'CORRIDOR'
    CHANNEL_TYPE_CHOICES = [
        (CHANNEL_STANDARD, 'Standard Rack Channel'),
        (CHANNEL_BULK, 'Bulk Storage Floor'),
        (CHANNEL_CORRIDOR, 'Corridor / Transit Aisle'),
    ]

    # SAP Bin Classification
    CLASS_SYSTEM = 'SYSTEM'
    CLASS_PHYSICAL_CHANNEL = 'PHYSICAL_CHANNEL'
    CLASS_BULK_OR_GENERAL = 'BULK_OR_GENERAL'
    CLASS_CORRIDOR_OR_AISLE = 'CORRIDOR_OR_AISLE'
    CLASS_OTHER = 'OTHER'
    CLASSIFICATION_CHOICES = [
        (CLASS_SYSTEM, 'System Bin Location'),
        (CLASS_PHYSICAL_CHANNEL, 'Physical Multi-Depth Channel'),
        (CLASS_BULK_OR_GENERAL, 'Bulk / General Area Bin'),
        (CLASS_CORRIDOR_OR_AISLE, 'Corridor / Transit Aisle'),
        (CLASS_OTHER, 'Other / Unclassified'),
    ]

    # Capacity Source
    CAPACITY_SOURCE_CONFIGURED = 'CONFIGURED'
    CAPACITY_SOURCE_DEFAULT = 'DEFAULT'
    CAPACITY_SOURCE_SYSTEM = 'SYSTEM_DEFAULT'
    CAPACITY_SOURCE_UNCONFIGURED = 'UNCONFIGURED'
    CAPACITY_SOURCE_CHOICES = [
        (CAPACITY_SOURCE_CONFIGURED, 'Configured Physical Capacity'),
        (CAPACITY_SOURCE_DEFAULT, 'Default Standard Capacity'),
        (CAPACITY_SOURCE_SYSTEM, 'System Virtual Bin Default'),
        (CAPACITY_SOURCE_UNCONFIGURED, 'Unconfigured (Unknown Physical Depth)'),
    ]

    # Allocation Type
    ALLOC_ALLOCATABLE = 'ALLOCATABLE'
    ALLOC_STAGING_ONLY = 'STAGING_ONLY'
    ALLOC_NON_ALLOCATABLE = 'NON_ALLOCATABLE'
    ALLOC_UNCONFIGURED = 'UNCONFIGURED'
    ALLOCATION_TYPE_CHOICES = [
        (ALLOC_ALLOCATABLE, 'Allocatable for Pallets'),
        (ALLOC_STAGING_ONLY, 'Staging Only (Temporary Transit)'),
        (ALLOC_NON_ALLOCATABLE, 'Non-Allocatable / Blocked'),
        (ALLOC_UNCONFIGURED, 'Unconfigured Allocation Status'),
    ]

    warehouse_code = models.CharField(max_length=50, db_index=True)
    sap_bin_abs_entry = models.IntegerField(unique=True, db_index=True)
    bin_code = models.CharField(max_length=150, db_index=True)

    sublevel1 = models.CharField(max_length=50, blank=True, default='')
    sublevel2 = models.CharField(max_length=50, blank=True, default='')
    sublevel3 = models.CharField(max_length=50, blank=True, default='')
    sublevel4 = models.CharField(max_length=50, blank=True, default='')

    sap_bin_classification = models.CharField(
        max_length=30, choices=CLASSIFICATION_CHOICES, default=CLASS_OTHER, db_index=True
    )
    allocation_type = models.CharField(
        max_length=30, choices=ALLOCATION_TYPE_CHOICES, default=ALLOC_UNCONFIGURED, db_index=True
    )
    channel_type = models.CharField(max_length=30, choices=CHANNEL_TYPE_CHOICES, default=CHANNEL_STANDARD)
    capacity = models.PositiveIntegerField(default=1)
    capacity_source = models.CharField(
        max_length=30, choices=CAPACITY_SOURCE_CHOICES, default=CAPACITY_SOURCE_CONFIGURED, db_index=True
    )
    notes = models.TextField(blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['warehouse_code', 'bin_code']
        unique_together = [('warehouse_code', 'bin_code')]
        indexes = [
            models.Index(fields=['warehouse_code', 'sublevel1', 'sublevel2'], name='cs_layout_wh_sub1_sub2_idx'),
            models.Index(fields=['warehouse_code', 'sap_bin_classification'], name='cs_layout_wh_class_idx'),
            models.Index(fields=['warehouse_code', 'allocation_type'], name='cs_layout_wh_alloc_idx'),
            models.Index(fields=['sap_bin_abs_entry'], name='cs_layout_abs_entry_idx'),
        ]

    @property
    def is_allocatable(self) -> bool:
        return self.allocation_type == self.ALLOC_ALLOCATABLE

    @property
    def is_staging_only(self) -> bool:
        return self.allocation_type == self.ALLOC_STAGING_ONLY

    @property
    def is_unconfigured(self) -> bool:
        return self.allocation_type == self.ALLOC_UNCONFIGURED

    @property
    def is_non_allocatable(self) -> bool:
        return self.allocation_type == self.ALLOC_NON_ALLOCATABLE

    def clean(self):
        if not self.sap_bin_abs_entry or self.sap_bin_abs_entry <= 0:
            raise ValidationError("Valid SAP Bin AbsEntry (> 0) is mandatory.")
        if not self.warehouse_code:
            raise ValidationError("Warehouse code is mandatory.")
        if not self.bin_code:
            raise ValidationError("Bin code is mandatory.")
        if self.capacity < 1:
            raise ValidationError("Capacity must be at least 1 pallet position.")

        # Extract sublevels from segmented bin_code if missing
        if "-" in self.bin_code:
            parts = self.bin_code.split("-")
            if len(parts) >= 2 and not self.sublevel1:
                self.sublevel1 = parts[1]
            if len(parts) >= 3 and not self.sublevel2:
                self.sublevel2 = parts[2]
            if len(parts) >= 4 and not self.sublevel3:
                self.sublevel3 = parts[3]
            if len(parts) >= 5 and not self.sublevel4:
                self.sublevel4 = parts[4]

        # Infer default classification if missing or OTHER
        if self.sap_bin_classification == self.CLASS_OTHER:
            if "SYSTEM" in self.bin_code.upper():
                self.sap_bin_classification = self.CLASS_SYSTEM
            elif self.sublevel3 and self.sublevel4:
                self.sap_bin_classification = self.CLASS_PHYSICAL_CHANNEL
            elif self.sublevel3 and not self.sublevel4:
                s3_val = self.sublevel3.upper()
                if s3_val.startswith("B") or "AISLE" in s3_val or "CORRIDOR" in s3_val:
                    self.sap_bin_classification = self.CLASS_CORRIDOR_OR_AISLE
            elif not self.sublevel3 and not self.sublevel4:
                self.sap_bin_classification = self.CLASS_BULK_OR_GENERAL

        # Default allocation_type if UNCONFIGURED based on warehouse profiles
        if self.allocation_type == self.ALLOC_UNCONFIGURED:
            if self.sap_bin_classification == self.CLASS_SYSTEM:
                self.allocation_type = self.ALLOC_NON_ALLOCATABLE
            elif self.sap_bin_classification == self.CLASS_CORRIDOR_OR_AISLE:
                self.allocation_type = self.ALLOC_STAGING_ONLY
            elif self.warehouse_code == "20201" and self.sap_bin_classification == self.CLASS_PHYSICAL_CHANNEL:
                s2 = str(self.sublevel2 or "").upper()
                if s2 in ["R01", "R02", "R03", "R06", "R07", "R08", "R09", "R10"]:
                    self.allocation_type = self.ALLOC_ALLOCATABLE

    def sync_positions(self):
        """
        Synchronizes ColdStoragePalletPosition records to match self.capacity.
        Creates missing positions 01..N.
        Preserves existing status and reservations.
        """
        self.clean()
        with transaction.atomic():
            existing = {p.position_index: p for p in self.positions.all()}
            for idx in range(1, self.capacity + 1):
                pos_code = f"{idx:02d}"
                if idx in existing:
                    pos = existing[idx]
                    updated = False
                    if pos.position_code != pos_code:
                        pos.position_code = pos_code
                        updated = True
                    if pos.warehouse_code != self.warehouse_code:
                        pos.warehouse_code = self.warehouse_code
                        updated = True
                    if pos.bin_code != self.bin_code:
                        pos.bin_code = self.bin_code
                        updated = True
                    if pos.sap_bin_abs_entry != self.sap_bin_abs_entry:
                        pos.sap_bin_abs_entry = self.sap_bin_abs_entry
                        updated = True
                    if updated:
                        pos.save()
                else:
                    ColdStoragePalletPosition.objects.create(
                        bin_layout=self,
                        warehouse_code=self.warehouse_code,
                        bin_code=self.bin_code,
                        sap_bin_abs_entry=self.sap_bin_abs_entry,
                        position_index=idx,
                        position_code=pos_code,
                        status=ColdStoragePalletPosition.AVAILABLE,
                    )
            # Remove any excess positions only if they are available (not occupied/reserved)
            excess = self.positions.filter(position_index__gt=self.capacity, status=ColdStoragePalletPosition.AVAILABLE)
            excess.delete()

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)
        self.sync_positions()

    def __str__(self):
        return f"{self.bin_code} (AbsEntry: {self.sap_bin_abs_entry}, Capacity: {self.capacity})"


class ColdStoragePalletPosition(models.Model):
    """
    Physical pallet position inside a ColdStorageBinLayout channel.
    """
    AVAILABLE = 'AVAILABLE'
    RESERVED = 'RESERVED'
    OCCUPIED = 'OCCUPIED'
    RESERVED_OUTBOUND = 'RESERVED_OUTBOUND'
    MAINTENANCE = 'MAINTENANCE'
    STATUS_CHOICES = [
        (AVAILABLE, 'Available'),
        (RESERVED, 'Reserved'),
        (OCCUPIED, 'Occupied'),
        (RESERVED_OUTBOUND, 'Reserved Outbound'),
        (MAINTENANCE, 'Maintenance / Blocked'),
    ]

    bin_layout = models.ForeignKey(ColdStorageBinLayout, on_delete=models.CASCADE, related_name='positions')
    warehouse_code = models.CharField(max_length=50, db_index=True)
    bin_code = models.CharField(max_length=150, db_index=True)
    sap_bin_abs_entry = models.IntegerField(db_index=True)

    position_index = models.PositiveIntegerField()
    position_code = models.CharField(max_length=20)  # e.g. "01", "02", ...

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=AVAILABLE, db_index=True)

    reserved_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name='cold_storage_reservations')
    reserved_at = models.DateTimeField(null=True, blank=True)
    reservation_reference = models.CharField(max_length=100, blank=True, default='')
    transfer_reference = models.CharField(max_length=100, blank=True, default='')

    current_batch_number = models.CharField(max_length=100, blank=True, default='')
    notes = models.CharField(max_length=255, blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['bin_layout', 'position_index']
        unique_together = [
            ('bin_layout', 'position_index'),
            ('bin_layout', 'position_code'),
        ]
        indexes = [
            models.Index(fields=['warehouse_code', 'status'], name='cs_pos_wh_status_idx'),
            models.Index(fields=['sap_bin_abs_entry', 'status'], name='cs_pos_abs_status_idx'),
            models.Index(fields=['bin_code', 'position_code'], name='cs_pos_bincode_code_idx'),
        ]

    def clean(self):
        if self.bin_layout:
            self.warehouse_code = self.bin_layout.warehouse_code
            self.bin_code = self.bin_layout.bin_code
            self.sap_bin_abs_entry = self.bin_layout.sap_bin_abs_entry

        if not self.sap_bin_abs_entry or self.sap_bin_abs_entry <= 0:
            raise ValidationError("Position must have a valid positive SAP Bin AbsEntry.")
        if not self.position_code:
            self.position_code = f"{self.position_index:02d}"

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    @classmethod
    def reserve_position(cls, position_id, user=None, reference='', transfer_reference=''):
        """
        Concurrency-safe atomic reservation using select_for_update().
        Validates that parent SAP Bin is ALLOCATABLE and position is AVAILABLE.
        """
        with transaction.atomic():
            pos = cls.objects.select_for_update().select_related('bin_layout').get(id=position_id)
            if pos.bin_layout.allocation_type != ColdStorageBinLayout.ALLOC_ALLOCATABLE:
                raise ValueError(
                    f"SAP Bin {pos.bin_code} is {pos.bin_layout.allocation_type} and cannot be reserved for pallet allocation."
                )
            if pos.status != cls.AVAILABLE:
                raise ValueError(
                    f"Position {pos.position_code} in bin {pos.bin_code} is currently {pos.status} and cannot be reserved."
                )
            pos.status = cls.RESERVED
            pos.reserved_by = user
            pos.reserved_at = timezone.now()
            pos.reservation_reference = str(reference or '').strip()
            if transfer_reference:
                pos.transfer_reference = str(transfer_reference or '').strip()
            pos.save(update_fields=['status', 'reserved_by', 'reserved_at', 'reservation_reference', 'transfer_reference', 'updated_at'])
            return pos

    @classmethod
    def release_position(cls, position_id, user=None):
        """
        Concurrency-safe release of an inbound reservation back to AVAILABLE.
        Outbound reservations and maintenance use their dedicated transitions.
        """
        with transaction.atomic():
            pos = cls.objects.select_for_update().get(id=position_id)
            if pos.status != cls.RESERVED:
                raise ValueError(
                    f"Position {pos.position_code} is {pos.status} (expected RESERVED) and cannot be released directly."
                )
            pos.status = cls.AVAILABLE
            pos.reserved_by = None
            pos.reserved_at = None
            pos.reservation_reference = ''
            pos.transfer_reference = ''
            pos.save(update_fields=['status', 'reserved_by', 'reserved_at', 'reservation_reference', 'transfer_reference', 'updated_at'])
            return pos

    @classmethod
    def occupy_position(cls, position_id, user=None, batch_number='', reference='', transfer_reference=''):
        """
        Concurrency-safe transition to OCCUPIED.
        Can only occupy an ALLOCATABLE bin that is AVAILABLE or RESERVED.
        """
        with transaction.atomic():
            pos = cls.objects.select_for_update().select_related('bin_layout').get(id=position_id)
            if pos.bin_layout.allocation_type != ColdStorageBinLayout.ALLOC_ALLOCATABLE:
                raise ValueError(
                    f"SAP Bin {pos.bin_code} is {pos.bin_layout.allocation_type} and cannot be occupied for pallet storage."
                )
            if pos.status not in (cls.AVAILABLE, cls.RESERVED):
                raise ValueError(
                    f"Position {pos.position_code} in bin {pos.bin_code} is {pos.status} "
                    "(expected AVAILABLE or RESERVED) and cannot be occupied."
                )
            pos.status = cls.OCCUPIED
            pos.current_batch_number = str(batch_number or '').strip()
            pos.reservation_reference = str(reference or '').strip()
            pos.transfer_reference = str(transfer_reference or '').strip()
            pos.reserved_by = user
            pos.reserved_at = timezone.now()
            pos.save(update_fields=[
                'status', 'current_batch_number', 'reservation_reference',
                'transfer_reference', 'reserved_by', 'reserved_at', 'updated_at'
            ])
            return pos

    @classmethod
    def vacate_position(cls, position_id, user=None):
        """
        Concurrency-safe release of an OCCUPIED position back to AVAILABLE.
        """
        with transaction.atomic():
            pos = cls.objects.select_for_update().get(id=position_id)
            if pos.status != cls.OCCUPIED:
                raise ValueError(
                    f"Position {pos.position_code} is {pos.status} (not OCCUPIED) and cannot be vacated."
                )
            pos.status = cls.AVAILABLE
            pos.current_batch_number = ''
            pos.reservation_reference = ''
            pos.transfer_reference = ''
            pos.reserved_by = None
            pos.reserved_at = None
            pos.save(update_fields=[
                'status', 'current_batch_number', 'reservation_reference',
                'transfer_reference', 'reserved_by', 'reserved_at', 'updated_at'
            ])
            return pos

    @classmethod
    def reserve_position_for_outbound(cls, position_id, user=None, reference='', transfer_reference=''):
        """
        Concurrency-safe atomic outbound reservation of an OCCUPIED position.
        Transitions OCCUPIED -> RESERVED_OUTBOUND.
        Preserves current_batch_number and existing transfer_reference.
        """
        with transaction.atomic():
            pos = cls.objects.select_for_update().select_related('bin_layout').get(id=position_id)
            if pos.bin_layout.allocation_type != ColdStorageBinLayout.ALLOC_ALLOCATABLE:
                raise ValueError(
                    f"SAP Bin {pos.bin_code} is {pos.bin_layout.allocation_type} and cannot be reserved for outbound transfer."
                )
            if pos.status != cls.OCCUPIED:
                raise ValueError(
                    f"Position {pos.position_code} in bin {pos.bin_code} is {pos.status} (expected OCCUPIED) and cannot be reserved for outbound transfer."
                )
            pos.status = cls.RESERVED_OUTBOUND
            if reference:
                pos.reservation_reference = str(reference or '').strip()
            # Preserve existing transfer_reference unless an explicit outbound transfer_reference is provided
            # (and if none provided, keep the existing one intact)
            if user:
                pos.reserved_by = user
            pos.reserved_at = timezone.now()
            pos.save(update_fields=[
                'status', 'reservation_reference', 'reserved_by', 'reserved_at', 'updated_at'
            ])
            return pos

    @classmethod
    def release_outbound_reservation(cls, position_id, user=None):
        """
        Concurrency-safe release of an outbound reservation back to OCCUPIED.
        Only RESERVED_OUTBOUND can be released back to OCCUPIED.
        Strictly preserves current_batch_number and transfer_reference.
        """
        with transaction.atomic():
            pos = cls.objects.select_for_update().get(id=position_id)
            if pos.status != cls.RESERVED_OUTBOUND:
                raise ValueError(
                    f"Position {pos.position_code} in bin {pos.bin_code} is {pos.status} (expected RESERVED_OUTBOUND) and cannot release outbound reservation."
                )
            pos.status = cls.OCCUPIED
            pos.reservation_reference = ''
            pos.reserved_by = None
            pos.reserved_at = None
            pos.save(update_fields=['status', 'reservation_reference', 'reserved_by', 'reserved_at', 'updated_at'])
            return pos

    @classmethod
    def vacate_outbound_position(cls, position_id, user=None):
        """
        Concurrency-safe transition of a RESERVED_OUTBOUND position to AVAILABLE after confirmed SAP transfer.
        Clears live occupancy metadata: current_batch_number, reservation_reference, transfer_reference,
        reserved_by, reserved_at.
        """
        with transaction.atomic():
            pos = cls.objects.select_for_update().get(id=position_id)
            if pos.status == cls.AVAILABLE:
                # Idempotent: already available
                return pos
            if pos.status != cls.RESERVED_OUTBOUND:
                raise ValueError(
                    f"Position {pos.position_code} in bin {pos.bin_code} is {pos.status} (expected RESERVED_OUTBOUND) and cannot complete outbound vacate."
                )
            pos.status = cls.AVAILABLE
            pos.current_batch_number = ''
            pos.reservation_reference = ''
            pos.transfer_reference = ''
            pos.reserved_by = None
            pos.reserved_at = None
            pos.save(update_fields=[
                'status', 'current_batch_number', 'reservation_reference',
                'transfer_reference', 'reserved_by', 'reserved_at', 'updated_at'
            ])
            return pos

    @classmethod
    def set_maintenance(cls, position_id, user=None, notes=''):
        """
        Places a position under MAINTENANCE / Blocked state.
        Cannot place an OCCUPIED position under maintenance without vacating first.
        """
        with transaction.atomic():
            pos = cls.objects.select_for_update().get(id=position_id)
            if pos.status == cls.OCCUPIED:
                raise ValueError(
                    f"Position {pos.position_code} is OCCUPIED and cannot be placed under MAINTENANCE directly."
                )
            pos.status = cls.MAINTENANCE
            if notes:
                pos.notes = str(notes or '').strip()
            pos.save(update_fields=['status', 'notes', 'updated_at'])
            return pos

    @classmethod
    def restore_from_maintenance(cls, position_id, user=None):
        """
        Restores a MAINTENANCE position back to AVAILABLE.
        """
        with transaction.atomic():
            pos = cls.objects.select_for_update().get(id=position_id)
            if pos.status != cls.MAINTENANCE:
                raise ValueError(
                    f"Position {pos.position_code} is {pos.status} (not MAINTENANCE)."
                )
            pos.status = cls.AVAILABLE
            pos.save(update_fields=['status', 'updated_at'])
            return pos

    def __str__(self):
        return f"{self.bin_code} - Pos {self.position_code} [{self.status}] (AbsEntry: {self.sap_bin_abs_entry})"
