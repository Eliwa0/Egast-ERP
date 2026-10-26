from django.contrib import admin
from .models import (
    ScaleDevice,
    ScaleVehicle,
    ScaleVehicleMovement,
    ScaleItemElement,
    ScaleDraft,
    ScaleDraftElement,
    ScalePermit,
    ScaleReceipt,
    ScaleReceiptItem,
    ScaleEntryExitPermit,
    ScaleEntryExitPermitItem,
)


@admin.register(ScaleDevice)
class ScaleDeviceAdmin(admin.ModelAdmin):
    list_display = ("device_id", "device_name", "device_type", "com_port", "ip_address", "is_active", "last_seen")
    list_filter = ("device_type", "is_active")
    search_fields = ("device_id", "device_name", "com_port", "ip_address", "location")


@admin.register(ScaleVehicle)
class ScaleVehicleAdmin(admin.ModelAdmin):
    list_display = ("vehicle_number", "driver_name", "phone", "company", "vehicle_type", "current_status", "created_at")
    list_filter = ("vehicle_type",)
    search_fields = ("vehicle_number", "driver_name", "phone", "company")


@admin.register(ScaleVehicleMovement)
class ScaleVehicleMovementAdmin(admin.ModelAdmin):
    list_display = ("vehicle", "driver_name", "entry_time", "exit_time", "is_active", "created_by")
    list_filter = ("entry_time", "exit_time")
    search_fields = ("vehicle__vehicle_number", "driver_name")


@admin.register(ScaleItemElement)
class ScaleItemElementAdmin(admin.ModelAdmin):
    list_display = ("item_code", "name", "weight", "is_active", "updated_at")
    list_filter = ("is_active",)
    search_fields = ("item_code", "item_name", "name")


class ScaleDraftElementInline(admin.TabularInline):
    model = ScaleDraftElement
    extra = 0




@admin.register(ScaleDraft)
class ScaleDraftAdmin(admin.ModelAdmin):
    list_display = (
        "draft_number",
        "effective_vehicle_number",
        "item_code",
        "vendor_name",
        "start_type",
        "weight_loaded",
        "weight_empty",
        "product_weight",
        "status",
        "is_closed",
        "created_at",
    )
    list_filter = ("status", "is_closed", "start_type", "is_direct_entry", "created_at")
    search_fields = ("draft_number", "vehicle__vehicle_number", "direct_vehicle_number", "item_code", "vendor_name")
    inlines = [ScaleDraftElementInline]


@admin.register(ScaleDraftElement)
class ScaleDraftElementAdmin(admin.ModelAdmin):
    list_display = ("draft", "item_element", "count", "stage", "action", "unit_weight", "total_weight")
    list_filter = ("stage", "action")
    search_fields = ("draft__draft_number", "item_element__name")




@admin.register(ScalePermit)
class ScalePermitAdmin(admin.ModelAdmin):
    list_display = ("permit_number", "draft", "permit_type", "driver_name", "supplier", "entry_time", "exit_time")
    list_filter = ("permit_type", "entry_time")
    search_fields = ("permit_number", "draft__draft_number", "driver_name", "supplier")


class ScaleReceiptItemInline(admin.TabularInline):
    model = ScaleReceiptItem
    extra = 0


@admin.register(ScaleReceipt)
class ScaleReceiptAdmin(admin.ModelAdmin):
    list_display = (
        "receipt_number",
        "receipt_date",
        "vehicle_number",
        "driver_name",
        "source",
        "total_quantity_kg",
        "created_at",
    )
    list_filter = ("receipt_date", "created_at")
    search_fields = ("receipt_number", "vehicle_number", "driver_name", "source", "supplier_name")
    inlines = [ScaleReceiptItemInline]


class ScaleEntryExitPermitItemInline(admin.TabularInline):
    model = ScaleEntryExitPermitItem
    extra = 0


@admin.register(ScaleEntryExitPermit)
class ScaleEntryExitPermitAdmin(admin.ModelAdmin):
    list_display = (
        "permit_number",
        "get_permit_type_display",
        "permit_date",
        "vehicle_number",
        "driver_name",
        "supplier_name",
        "buyer_name",
        "destination",
        "created_by",
        "created_at",
    )
    list_filter = ("permit_type", "permit_date", "created_at")
    search_fields = (
        "permit_number",
        "vehicle_number",
        "driver_name",
        "supplier_name",
        "buyer_name",
        "destination",
    )
    inlines = [ScaleEntryExitPermitItemInline]
