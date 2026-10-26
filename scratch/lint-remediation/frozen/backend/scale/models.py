from decimal import Decimal
from django.db import IntegrityError, models, transaction
from django.db.models import F
from django.conf import settings
from django.core.validators import MinValueValidator
from django.utils import timezone


class ScaleDevice(models.Model):
    """Represents physical or network scale indicator devices."""
    DEVICE_TYPE_CHOICES = [
        ("local", "ميزان محلي (USB/COM)"),
        ("remote", "ميزان بعيد (شبكة IP)"),
        ("virtual", "ميزان افتراضي"),
    ]

    device_id = models.CharField(max_length=100, unique=True, db_index=True, verbose_name="معرف الجهاز")
    device_name = models.CharField(max_length=200, verbose_name="اسم الجهاز")
    device_type = models.CharField(max_length=20, choices=DEVICE_TYPE_CHOICES, default="local", verbose_name="نوع الجهاز")
    com_port = models.CharField(max_length=50, blank=True, null=True, verbose_name="منفذ COM")
    baud_rate = models.IntegerField(default=9600, blank=True, null=True, verbose_name="سرعة الباود")
    ip_address = models.GenericIPAddressField(blank=True, null=True, verbose_name="عنوان IP")
    port = models.IntegerField(default=80, blank=True, null=True, verbose_name="المنفذ")
    location = models.CharField(max_length=200, blank=True, verbose_name="الموقع")
    is_active = models.BooleanField(default=True, db_index=True, verbose_name="نشط")
    last_seen = models.DateTimeField(blank=True, null=True, verbose_name="آخر ظهور")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاريخ الإنشاء")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="تاريخ التحديث")

    class Meta:
        ordering = ["device_name"]
        verbose_name = "جهاز ميزان"
        verbose_name_plural = "أجهزة الميزان"

    def __str__(self):
        return f"{self.device_name} ({self.get_device_type_display()})"

    @property
    def is_online(self):
        if self.last_seen:
            return (timezone.now() - self.last_seen).total_seconds() < 30
        return False


class ScaleVehicle(models.Model):
    """Represents trucks and transport vehicles entering the facility."""
    VEHICLE_TYPE_CHOICES = [
        ("weighing", "للتوزين"),
        ("visit", "زيارة فقط"),
    ]

    vehicle_number = models.CharField(max_length=50, unique=True, db_index=True, verbose_name="رقم العربية")
    driver_name = models.CharField(max_length=150, blank=True, verbose_name="اسم السائق")
    driver_id = models.CharField(max_length=50, blank=True, verbose_name="رقم البطاقة / الهوية")
    phone = models.CharField(max_length=50, blank=True, verbose_name="رقم الهاتف")
    company = models.CharField(max_length=150, blank=True, verbose_name="الشركة الناقلة")
    vehicle_type = models.CharField(max_length=20, choices=VEHICLE_TYPE_CHOICES, default="weighing", verbose_name="نوع العربية")
    truck_type = models.CharField(max_length=20, choices=[("normal", "سيارة / شاحنة عادية"), ("container", "شاحنة حاويات")], default="normal", verbose_name="نوع الشاحنة")
    notes = models.TextField(blank=True, verbose_name="ملاحظات")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاريخ التسجيل")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="تاريخ التحديث")

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "عربية / شاحنة"
        verbose_name_plural = "العربيات والشاحنات"

    def __str__(self):
        return f"{self.vehicle_number} | {self.driver_name or 'بدون سائق'}"

    @property
    def current_status(self):
        last_movement = self.movements.order_by("-entry_time").first()
        if last_movement:
            return "متواجدة" if last_movement.exit_time is None else "مغادرة"
        return "لم تسجل حركة"

    @property
    def is_inside(self):
        last_movement = self.movements.order_by("-entry_time").first()
        return bool(last_movement and last_movement.exit_time is None)
class ScaleVehicleMovement(models.Model):
    """Audit log of vehicle entry and exit movements."""
    vehicle = models.ForeignKey(ScaleVehicle, on_delete=models.CASCADE, related_name="movements", verbose_name="العربية")
    driver_name = models.CharField(max_length=150, blank=True, verbose_name="اسم السائق أثناء الحركة")
    entry_time = models.DateTimeField(default=timezone.now, verbose_name="وقت الدخول")
    exit_time = models.DateTimeField(blank=True, null=True, verbose_name="وقت الخروج")
    notes = models.TextField(blank=True, verbose_name="ملاحظات")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="scale_vehicle_movements",
        verbose_name="تم التسجيل بواسطة",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-entry_time"]
        verbose_name = "حركة دخول وخروج عربية"
        verbose_name_plural = "حركات العربيات"

    def __str__(self):
        status = "نشطة (داخل المصنع)" if self.exit_time is None else "مكتملة"
        return f"{self.vehicle.vehicle_number} - {self.entry_time.strftime('%Y-%m-%d %H:%M')} ({status})"

    @property
    def is_active(self):
        return self.exit_time is None

    @property
    def duration(self):
        if self.exit_time:
            return self.exit_time - self.entry_time
        return None

class ScaleMovementTrailer(models.Model):
    movement = models.ForeignKey(ScaleVehicleMovement, on_delete=models.CASCADE, related_name="trailers")
    trailer_number = models.CharField(max_length=50)

class ScaleMovementContainer(models.Model):
    movement = models.ForeignKey(ScaleVehicleMovement, on_delete=models.CASCADE, related_name="containers")
    container_number = models.CharField(max_length=50)


class ScaleItemElement(models.Model):
    """Deductible or additional elements that affect tare/gross weights (pallets, boxes, tarpaulins)."""
    item_code = models.CharField(max_length=100, db_index=True, verbose_name="كود الصنف في SAP")
    item_name = models.CharField(max_length=200, blank=True, verbose_name="اسم الصنف")
    name = models.CharField(max_length=150, verbose_name="اسم العنصر (مثال: طبلية خشب، قفص)")
    weight = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="وزن القطعة (كجم)")
    is_active = models.BooleanField(default=True, db_index=True, verbose_name="نشط")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["item_code", "name"]
        unique_together = [("item_code", "name")]
        verbose_name = "عنصر وزن مؤثر (طبلية/صندوق)"
        verbose_name_plural = "العناصر المؤثرة على الأوزان"

    def __str__(self):
        return f"{self.item_code} | {self.name} - {self.weight} كجم"


class ScaleDraftNumberSequence(models.Model):
    """Per-item sequence source for official Scale draft numbers."""

    item_code = models.CharField(max_length=100, unique=True, db_index=True, verbose_name="كود الصنف")
    last_number = models.PositiveIntegerField(default=0, verbose_name="آخر رقم تسلسلي")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="تاريخ آخر تحديث")

    class Meta:
        verbose_name = "تسلسل رقم مسودة الميزان"
        verbose_name_plural = "تسلسلات أرقام مسودات الميزان"

    def __str__(self):
        return f"{self.item_code}: {self.last_number}"

    @classmethod
    def next_draft_number(cls, item_code):
        clean_item_code = str(item_code or "").strip()
        if not clean_item_code:
            return None

        with transaction.atomic():
            try:
                sequence = cls.objects.select_for_update().get(item_code=clean_item_code)
            except cls.DoesNotExist:
                try:
                    with transaction.atomic():
                        sequence = cls.objects.create(item_code=clean_item_code, last_number=0)
                except IntegrityError:
                    sequence = cls.objects.select_for_update().get(item_code=clean_item_code)

            cls.objects.filter(pk=sequence.pk).update(
                last_number=F("last_number") + 1,
                updated_at=timezone.now(),
            )
            sequence.refresh_from_db(fields=["last_number"])
            return f"{clean_item_code}-{sequence.last_number:04d}"


class ScaleDraft(models.Model):
    """Core scale weighing record (Loaded / Empty / Batches / Net Weight)."""
    STATUS_FIRST_WEIGHT = "FIRST_WEIGHT"
    STATUS_SECOND_WEIGHT_PENDING = "SECOND_WEIGHT_PENDING"
    STATUS_COMPLETED = "COMPLETED"
    STATUS_SENT_TO_QUALITY = "SENT_TO_QUALITY"
    STATUS_CANCELLED = "CANCELLED"

    STATUS_CHOICES = [
        (STATUS_FIRST_WEIGHT, "تم تسجيل الوزنة الأولى"),
        (STATUS_SECOND_WEIGHT_PENDING, "في انتظار الوزنة الثانية"),
        (STATUS_COMPLETED, "مكتملة"),
        (STATUS_SENT_TO_QUALITY, "تم التحويل للجودة"),
        (STATUS_CANCELLED, "ملغاة"),
    ]

    START_TYPE_CHOICES = [
        ("loaded", "قايم أولاً (Loaded First)"),
        ("empty", "فارغ أولاً (Empty First)"),
    ]

    draft_number = models.CharField(max_length=100, unique=True, db_index=True, verbose_name="رقم مسودة الميزان")
    start_type = models.CharField(max_length=10, choices=START_TYPE_CHOICES, default="loaded", verbose_name="نوع البدء")

    vehicle = models.ForeignKey(
        ScaleVehicle,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="drafts",
        verbose_name="العربية",
    )
    is_direct_entry = models.BooleanField(default=False, verbose_name="دخول مباشر وسريع")
    direct_vehicle_number = models.CharField(max_length=50, blank=True, verbose_name="رقم العربية المباشر")
    direct_driver_name = models.CharField(max_length=150, blank=True, verbose_name="اسم السائق المباشر")

    truck_type = models.CharField(max_length=20, choices=[("normal", "سيارة / شاحنة عادية"), ("container", "شاحنة حاويات")], default="normal", verbose_name="نوع الشاحنة")
    trailer_number = models.CharField(max_length=50, blank=True, verbose_name="رقم المقطورة")
    container_number = models.CharField(max_length=50, blank=True, verbose_name="رقم الحاوية")

    item_code = models.CharField(max_length=100, db_index=True, verbose_name="كود الصنف")
    item_name = models.CharField(max_length=200, blank=True, verbose_name="اسم الصنف")
    vendor_card_code = models.CharField(max_length=100, blank=True, db_index=True, verbose_name="كود المورد في SAP")
    vendor_name = models.CharField(max_length=200, blank=True, verbose_name="اسم المورد")

    scale_device = models.ForeignKey(
        ScaleDevice,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="drafts",
        verbose_name="جهاز الميزان المستخدم",
    )

    # ── Non-Invasive Purchase Quotation Matching ──────────────
    quotation = models.ForeignKey(
        "api.PurchaseQuotationDraft",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="scale_drafts",
        verbose_name="عرض سعر الشراء المرتبط",
    )
    quotation_line_index = models.IntegerField(
        default=0,
        validators=[MinValueValidator(0)],
        verbose_name="رقم سطر عرض السعر",
    )

    # ── Loaded Weight (الوزن القايم) ───────────────────────────
    weight_loaded = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True, verbose_name="الوزن القايم الإجمالي")
    net_weight_loaded = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True, verbose_name="صافي الوزن القايم بعد العناصر")
    loaded_time = models.DateTimeField(null=True, blank=True, verbose_name="وقت الوزن القايم")

    # ── Empty Weight (الوزن الفارغ) ───────────────────────────
    weight_empty = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True, verbose_name="الوزن الفارغ الإجمالي")
    net_weight_empty = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True, verbose_name="صافي الوزن الفارغ بعد العناصر")
    empty_time = models.DateTimeField(null=True, blank=True, verbose_name="وقت الوزن الفارغ")

    # ── Final Product Weight (صافي وزن المنتج) ────────────────
    product_weight = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True, verbose_name="وزن المنتج النهائي الصافي (كجم)")

    # ── Multi-Allocation & Certified Locking ──────────────────
    is_multi_allocation = models.BooleanField(default=False, verbose_name="حمولة متعددة التخصيص")
    is_certified_locked = models.BooleanField(default=False, db_index=True, verbose_name="تم اعتماد وقفل الوزن الصافي")

    # ── Batch / Pivot Distribution ────────────────────────────

    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default=STATUS_FIRST_WEIGHT, db_index=True, verbose_name="حالة المسودة")
    is_closed = models.BooleanField(default=False, db_index=True, verbose_name="مغلقة")

    # ── Printing Flags ─────────────────────────────────────────
    permit_printed = models.BooleanField(default=False, verbose_name="تم طباعة إذن بسكول")
    permit_printed_at = models.DateTimeField(null=True, blank=True, verbose_name="تاريخ طباعة الإذن")
    final_card_printed = models.BooleanField(default=False, verbose_name="تم طباعة الكارت النهائي")
    final_card_printed_at = models.DateTimeField(null=True, blank=True, verbose_name="تاريخ طباعة الكارت")

    # ── Audit & User Tracking ──────────────────────────────────
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_scale_drafts",
        verbose_name="أنشئ بواسطة",
    )
    closed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="closed_scale_drafts",
        verbose_name="أغلق بواسطة",
    )
    notes = models.TextField(blank=True, verbose_name="ملاحظات")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاريخ الإنشاء")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="تاريخ التحديث")

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "مسودة ميزان"
        verbose_name_plural = "مسودات الميزان"
        constraints = [
            models.UniqueConstraint(
                fields=["quotation"],
                condition=models.Q(
                    quotation__isnull=False,
                    status__in=["FIRST_WEIGHT", "SECOND_WEIGHT_PENDING"],
                ),
                name="unique_active_scale_draft_per_quotation",
            ),
        ]

    def __str__(self):
        v_num = self.effective_vehicle_number
        return f"مسودة ميزان #{self.draft_number} - {v_num} [{self.get_status_display()}]"

    @property
    def effective_vehicle_number(self):
        if self.vehicle:
            return self.vehicle.vehicle_number
        return self.direct_vehicle_number or "بدون رقم"

    @property
    def effective_driver_name(self):
        if self.vehicle and self.vehicle.driver_name:
            return self.vehicle.driver_name
        return self.direct_driver_name or ""

    def calculate_net_weights(self):
        """Calculates adjustments for loaded & empty stages and final product weight."""
        if self.is_certified_locked:
            return "Scale draft is certified and locked. Net product weight cannot be recalculated."

        # Calculate loaded net
        if self.weight_loaded is not None:
            loaded_adj = Decimal("0.00")
            for elem in self.draft_elements.filter(stage="loaded"):
                loaded_adj += elem.signed_weight
            self.net_weight_loaded = self.weight_loaded + loaded_adj

        # Calculate empty net
        if self.weight_empty is not None:
            empty_adj = Decimal("0.00")
            for elem in self.draft_elements.filter(stage="empty"):
                empty_adj += elem.signed_weight
            self.net_weight_empty = self.weight_empty + empty_adj

        # Calculate product weight: Net Loaded minus Net Empty
        if self.net_weight_loaded is not None and self.net_weight_empty is not None:
            calculated_net = self.net_weight_loaded - self.net_weight_empty
            if calculated_net < Decimal("0.00") or (calculated_net == Decimal("0.00") and self.allocations.exists()):
                self.product_weight = None
                return "Invalid weighing: Gross loaded weight minus tare empty weight and deductions must result in a positive net product weight (> 0 kg)."
            self.product_weight = calculated_net.quantize(Decimal("0.01"))
            self.is_closed = True
            self.is_certified_locked = True
            if self.status not in (self.STATUS_SENT_TO_QUALITY, self.STATUS_CANCELLED):
                self.status = self.STATUS_COMPLETED
            return None
    def save(self, *args, **kwargs):
        if not self.draft_number:
            self.draft_number = ScaleDraftNumberSequence.next_draft_number(self.item_code)
            if not self.draft_number:
                date_str = timezone.now().strftime("%Y%m%d")
                count = ScaleDraft.objects.filter(created_at__date=timezone.now().date()).count() + 1
                self.draft_number = f"SD-{date_str}-{count:04d}"
        super().save(*args, **kwargs)


class ScaleDraftElement(models.Model):
    """Specific tare/additive elements applied to a scale draft stage."""
    STAGE_CHOICES = [
        ("loaded", "مرحلة القايم (Loaded)"),
        ("empty", "مرحلة الفارغ (Empty)"),
    ]
    ACTION_CHOICES = [
        ("add", "إضافة (+)"),
        ("remove", "خصم (-)"),
    ]

    draft = models.ForeignKey(ScaleDraft, on_delete=models.CASCADE, related_name="draft_elements", verbose_name="المسودة")
    item_element = models.ForeignKey(ScaleItemElement, on_delete=models.PROTECT, related_name="draft_elements", verbose_name="العنصر المؤثر")
    count = models.PositiveIntegerField(default=1, verbose_name="العدد")
    stage = models.CharField(max_length=10, choices=STAGE_CHOICES, default="loaded", verbose_name="مرحلة الوزن")
    action = models.CharField(max_length=10, choices=ACTION_CHOICES, default="remove", verbose_name="نوع الإجراء")
    unit_weight = models.DecimalField(max_digits=10, decimal_places=2, default=0.00, verbose_name="وزن الوحدة (كجم)")
    total_weight = models.DecimalField(max_digits=12, decimal_places=2, default=0.00, verbose_name="الوزن الإجمالي للعنصر (كجم)")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["stage", "id"]
        verbose_name = "عنصر مسودة ميزان"
        verbose_name_plural = "عناصر مسودات الميزان"

    def __str__(self):
        return f"{self.item_element.name} × {self.count} ({self.get_action_display()} - {self.get_stage_display()})"

    @property
    def signed_weight(self):
        w = self.total_weight or (self.unit_weight * self.count)
        return -w if self.action == "remove" else w

    def save(self, *args, **kwargs):
        if self.item_element and not self.unit_weight:
            self.unit_weight = self.item_element.weight
        self.total_weight = (self.unit_weight * self.count).quantize(Decimal("0.01"))
        super().save(*args, **kwargs)


class ScaleDraftTrailer(models.Model):
    """Represents one of potentially multiple trailers attached to a draft."""
    draft = models.ForeignKey(ScaleDraft, on_delete=models.CASCADE, related_name="trailers", verbose_name="مسودة الميزان")
    trailer_number = models.CharField(max_length=50, verbose_name="رقم المقطورة")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        verbose_name = "مقطورة المسودة"
        verbose_name_plural = "مقطورات المسودة"

    def __str__(self):
        return self.trailer_number


class ScaleDraftContainer(models.Model):
    """Represents one of potentially multiple containers attached to a draft."""
    draft = models.ForeignKey(ScaleDraft, on_delete=models.CASCADE, related_name="containers", verbose_name="مسودة الميزان")
    container_number = models.CharField(max_length=50, verbose_name="رقم الحاوية")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        verbose_name = "حاوية المسودة"
        verbose_name_plural = "حاويات المسودة"

    def __str__(self):
        return self.container_number


class ScaleDraftAllocation(models.Model):
    """
    Represents an individual product allocation line on a scale draft.
    Combines: (Supplier + Item + Package Count + Est. Unit Weight + Batch/Parcel + Allocated Weight).
    """
    
    draft = models.ForeignKey(
        ScaleDraft,
        on_delete=models.CASCADE,
        related_name="allocations",
        verbose_name="مسودة الميزان"
    )
    line_number = models.PositiveSmallIntegerField(default=1, verbose_name="رقم البند")

    # ── Supplier / Vendor ──────────────────────────────────────────────────
    vendor_card_code = models.CharField(max_length=100, blank=True, db_index=True, verbose_name="كود المورد في SAP")
    vendor_name = models.CharField(max_length=200, blank=True, verbose_name="اسم المورد / المزرعة")

    # ── Commodity / Item ───────────────────────────────────────────────────
    item_code = models.CharField(max_length=100, blank=True, db_index=True, verbose_name="كود الصنف في SAP")
    item_name = models.CharField(max_length=200, blank=True, verbose_name="اسم الصنف / المحصول")
    crop_name = models.CharField(max_length=100, blank=True, verbose_name="نوع المحصول")
    raw_material_type = models.CharField(max_length=100, blank=True, verbose_name="طبيعة المادة الخام")

    # ── Batch & Parcel Traceability ────────────────────────────────────────
    batch_number = models.CharField(max_length=100, blank=True, db_index=True, verbose_name="رقم التشغيلة / البيفوت")
    farm_origin = models.CharField(max_length=200, blank=True, verbose_name="المنشأ / الحوشة / البيفوت")
    contractor_name = models.CharField(max_length=150, blank=True, verbose_name="اسم المقاول / المتعهد")

    # ── Package Metrics (Distribution Basis) ───────────────────────────────

    # ── Calculated Weights & Percentages ───────────────────────────────────
    notes = models.TextField(blank=True, verbose_name="ملاحظات")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["draft", "line_number", "id"]
        verbose_name = "بند تخصيص حمولة ميزان"
        verbose_name_plural = "بنود تخصيص حمولة الميزان"

    def __str__(self):
        return f"Line {self.line_number}: {self.vendor_name} - {self.item_name} [{self.batch_number}]"



class ScalePermit(models.Model):
    draft = models.OneToOneField(ScaleDraft, on_delete=models.CASCADE, related_name='permit', verbose_name='المسودة')
    permit_number = models.CharField(max_length=100, unique=True, blank=True, verbose_name='رقم التصريح')
    permit_type = models.CharField(max_length=10, choices=[('entry', 'دخول'), ('exit', 'خروج'), ('both', 'دخول وخروج')], default='both', verbose_name='نوع التصريح')
    driver_name = models.CharField(max_length=150, blank=True, verbose_name='اسم السائق')
    driver_id = models.CharField(max_length=50, blank=True, verbose_name='رقم البطاقة')
    phone = models.CharField(max_length=50, blank=True, verbose_name='رقم الهاتف')
    company = models.CharField(max_length=150, blank=True, verbose_name='الشركة')
    purpose = models.TextField(blank=True, verbose_name='الغرض')
    supplier = models.CharField(max_length=200, blank=True, verbose_name='المورد')
    entry_time = models.DateTimeField(default=timezone.now, verbose_name='وقت الدخول')
    exit_time = models.DateTimeField(null=True, blank=True, verbose_name='وقت الخروج')
    include_batches_info = models.BooleanField(default=False, verbose_name='تضمين بيانات البيفوت')
    batch_details = models.TextField(blank=True, verbose_name='تفاصيل البيفوت')
    notes = models.TextField(blank=True, verbose_name='ملاحظات')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='created_scale_permits')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'تصريح'
        verbose_name_plural = 'تصاريح'


class ScaleReceipt(models.Model):
    """Digital receiving receipt (إيصال استلام) matching form EG.ST.F04."""
    receipt_number = models.CharField(max_length=100, unique=True, db_index=True, blank=True, verbose_name="رقم الإيصال")
    receipt_date = models.DateField(default=timezone.localdate, verbose_name="التاريخ")

    vehicle_number = models.CharField(max_length=50, blank=True, verbose_name="رقم السيارة")
    driver_name = models.CharField(max_length=150, blank=True, verbose_name="اسم السائق")
    driver_license = models.CharField(max_length=50, blank=True, verbose_name="رقم الرخصة")
    source = models.CharField(max_length=200, blank=True, verbose_name="من المصدر")
    supplier_name = models.CharField(max_length=200, blank=True, verbose_name="المورد / المزرعة")

    total_quantity_kg = models.DecimalField(max_digits=14, decimal_places=2, default=0.00, verbose_name="الإجمالي بالكيلو")
    total_quantity_ton = models.DecimalField(max_digits=14, decimal_places=3, default=0.000, verbose_name="الإجمالي بالطن")

    driver_signature_name = models.CharField(max_length=150, blank=True, verbose_name="اسم السائق (التوقيع)")
    receiver_signature_name = models.CharField(max_length=150, blank=True, verbose_name="اسم المستلم بقيمة البضاعة")
    driver_signature = models.TextField(blank=True, verbose_name="توقيع السائق (صورة)")
    receiver_signature = models.TextField(blank=True, verbose_name="توقيع المستلم (صورة)")

    notes = models.TextField(blank=True, verbose_name="ملاحظات")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_scale_receipts",
        verbose_name="أنشئ بواسطة",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاريخ الإنشاء")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="تاريخ التحديث")

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "إيصال استلام"
        verbose_name_plural = "إيصالات الاستلام"

    def __str__(self):
        return f"إيصال استلام #{self.receipt_number} - {self.vehicle_number or 'بدون رقم'}"

    @classmethod
    def next_receipt_number(cls):
        date_str = timezone.now().strftime("%Y%m%d")
        count = cls.objects.filter(created_at__date=timezone.now().date()).count() + 1
        return f"RCP-{date_str}-{count:04d}"

    def save(self, *args, **kwargs):
        if not self.receipt_number:
            self.receipt_number = self.next_receipt_number()
        super().save(*args, **kwargs)


class ScaleReceiptItem(models.Model):
    """Line item on a ScaleReceipt (item, count, kg/ton quantities, package type)."""
    receipt = models.ForeignKey(ScaleReceipt, on_delete=models.CASCADE, related_name="items", verbose_name="الإيصال")
    line_number = models.PositiveSmallIntegerField(default=1, verbose_name="رقم البند")
    item_code = models.CharField(max_length=100, blank=True, db_index=True, verbose_name="الرقم الكودي")
    item_name = models.CharField(max_length=200, blank=True, verbose_name="اسم الصنف")
    count = models.PositiveIntegerField(default=1, verbose_name="العدد")
    quantity_kg = models.DecimalField(max_digits=14, decimal_places=2, default=0.00, verbose_name="الكمية بالكيلو")
    quantity_ton = models.DecimalField(max_digits=14, decimal_places=3, default=0.000, verbose_name="الكمية بالطن")
    package_type = models.CharField(max_length=100, blank=True, verbose_name="نوع العبوة")
    notes = models.CharField(max_length=255, blank=True, verbose_name="ملاحظات")

    class Meta:
        ordering = ["line_number", "id"]
        verbose_name = "بند إيصال استلام"
        verbose_name_plural = "بنود إيصال الاستلام"

    def __str__(self):
        return f"{self.receipt.receipt_number} - {self.item_name or self.item_code}"


class ScaleEntryExitPermit(models.Model):
    """Gate entry/exit permit (تصريح دخول/خروج) — forms EG.ST.F05 and EG.ST.F06."""
    PERMIT_TYPE_CHOICES = [
        ("entry", "تصريح دخول"),
        ("exit", "تصريح خروج"),
    ]

    permit_type = models.CharField(max_length=10, choices=PERMIT_TYPE_CHOICES, verbose_name="نوع التصريح")
    permit_number = models.CharField(max_length=100, unique=True, db_index=True, blank=True, verbose_name="رقم التصريح")
    permit_date = models.DateField(default=timezone.localdate, verbose_name="التاريخ")

    # ── Parties ─────────────────────────────────────────────────────────────
    supplier_name = models.CharField(max_length=200, blank=True, verbose_name="اسم المورد")
    buyer_name = models.CharField(max_length=200, blank=True, verbose_name="اسم المشتري")
    driver_name = models.CharField(max_length=150, blank=True, verbose_name="اسم السائق")
    destination = models.CharField(max_length=200, blank=True, verbose_name="الجهة")
    vehicle_number = models.CharField(max_length=50, blank=True, verbose_name="رقم السيارة")

    # ── Entry inspection (نتيجة الفحص والمعاينة) ────────────────────────────
    inspection_result = models.TextField(blank=True, verbose_name="نتيجة الفحص والمعاينة")
    gate_writer = models.CharField(max_length=150, blank=True, verbose_name="كاتب البوابة")
    inspection_head = models.CharField(max_length=150, blank=True, verbose_name="رئيس قسم التفتيش الوارد")

    # ── Entry load weight statement (بيان وزن الحمولة) ──────────────────────
    gross_weight_kg = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True, verbose_name="الوزن القائم (كجم)")
    tare_weight_kg = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True, verbose_name="الوزن الفارغ (كجم)")
    net_weight_kg = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True, verbose_name="الوزن الصافي (كجم)")

    # ── Approvals / signatures (names) ──────────────────────────────────────
    scale_operator = models.CharField(max_length=150, blank=True, verbose_name="مسؤول الباسكول")
    general_manager = models.CharField(max_length=150, blank=True, verbose_name="مدير عام الشركة")
    responsible_person = models.CharField(max_length=150, blank=True, verbose_name="المسؤول")
    department_manager = models.CharField(max_length=150, blank=True, verbose_name="مدير الإدارة")

    weight_in_words = models.TextField(blank=True, verbose_name="فقط وقدره")
    notes = models.TextField(blank=True, verbose_name="ملاحظات")

    # ── Drawn signature images (data URLs) per approval role ────────────────
    gate_writer_signature = models.TextField(blank=True, verbose_name="توقيع كاتب البوابة")
    inspection_head_signature = models.TextField(blank=True, verbose_name="توقيع رئيس قسم التفتيش الوارد")
    scale_operator_signature = models.TextField(blank=True, verbose_name="توقيع مسؤول الباسكول")
    general_manager_signature = models.TextField(blank=True, verbose_name="توقيع مدير عام الشركة")
    responsible_signature = models.TextField(blank=True, verbose_name="توقيع المسؤول")
    department_manager_signature = models.TextField(blank=True, verbose_name="توقيع مدير الإدارة")

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_scale_entry_exit_permits",
        verbose_name="أنشئ بواسطة",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاريخ الإنشاء")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="تاريخ التحديث")

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "تصريح دخول وخروج"
        verbose_name_plural = "تصاريح الدخول والخروج"

    def __str__(self):
        return f"{self.get_permit_type_display()} #{self.permit_number} - {self.vehicle_number or 'بدون رقم'}"

    @classmethod
    def next_permit_number(cls, permit_type):
        prefix = "EP" if permit_type == "entry" else "EX"
        date_str = timezone.now().strftime("%Y%m%d")
        count = cls.objects.filter(permit_type=permit_type, created_at__date=timezone.now().date()).count() + 1
        return f"{prefix}-{date_str}-{count:04d}"

    def save(self, *args, **kwargs):
        if not self.permit_number:
            self.permit_number = self.next_permit_number(self.permit_type)
        super().save(*args, **kwargs)


class ScaleEntryExitPermitItem(models.Model):
    """Line item (product) on an entry/exit gate permit."""
    permit = models.ForeignKey(ScaleEntryExitPermit, on_delete=models.CASCADE, related_name="items", verbose_name="التصريح")
    line_number = models.PositiveSmallIntegerField(default=1, verbose_name="رقم البند")
    item_code = models.CharField(max_length=100, blank=True, db_index=True, verbose_name="الرقم الكودي")
    item_name = models.CharField(max_length=200, blank=True, verbose_name="اسم الصنف")
    count = models.PositiveIntegerField(default=1, verbose_name="العدد")
    quantity_kg = models.DecimalField(max_digits=14, decimal_places=2, default=0.00, verbose_name="الوزن بالكيلو")
    quantity_ton = models.DecimalField(max_digits=14, decimal_places=3, default=0.000, verbose_name="الوزن بالطن")
    notes = models.CharField(max_length=255, blank=True, verbose_name="ملاحظات")

    class Meta:
        ordering = ["line_number", "id"]
        verbose_name = "بند تصريح دخول وخروج"
        verbose_name_plural = "بنود تصاريح الدخول والخروج"

    def __str__(self):
        return f"{self.permit.permit_number} - {self.item_name or self.item_code}"
