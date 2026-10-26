from django.contrib import admin
from .models import (
    UserProfile,
    ProductionOrderAttributeRule,
    UserAttributeRule,
    WarehouseAttributeVisibilityRule,
    TransferWarehouseRule,
    PendingTransferRequest,
    QualityCategory,
    InspectionStage,
    QualityCriterion,
    ItemQualityCriterion,
    PurchaseGRPODraft,
    PurchaseGRPOPostingAuditLog,
    PurchaseGRPODraftBatch,
    ColdStorageBinLayout,
    ColdStoragePalletPosition,
)


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ('user', 'role', 'warehouse')
    list_filter = ('role',)


@admin.register(ProductionOrderAttributeRule)
class ProductionOrderAttributeRuleAdmin(admin.ModelAdmin):
    list_display = ('doc_num', 'doc_entry', 'item_code', 'field_key', 'allowed_values_preview', 'updated_at')
    list_filter = ('field_key',)
    search_fields = ('doc_num', 'item_code', 'field_key')

    def allowed_values_preview(self, obj):
        vals = obj.allowed_values or []
        return ', '.join(str(v) for v in vals[:5]) + ('…' if len(vals) > 5 else '')
    allowed_values_preview.short_description = 'Allowed values'


@admin.register(UserAttributeRule)
class UserAttributeRuleAdmin(admin.ModelAdmin):
    list_display = ('user', 'field_key', 'allowed_values_preview', 'updated_at')
    list_filter = ('field_key',)
    search_fields = ('user__username', 'field_key')

    def allowed_values_preview(self, obj):
        vals = obj.allowed_values or []
        return ', '.join(str(v) for v in vals[:5]) + ('…' if len(vals) > 5 else '')
    allowed_values_preview.short_description = 'Allowed values'


@admin.register(WarehouseAttributeVisibilityRule)
class WarehouseAttributeVisibilityRuleAdmin(admin.ModelAdmin):
    list_display = ('warehouse_code', 'hidden_fields_preview', 'updated_at')

    def hidden_fields_preview(self, obj):
        fields = obj.hidden_fields or []
        return ', '.join(fields) if fields else '—'
    hidden_fields_preview.short_description = 'Hidden fields'


@admin.register(TransferWarehouseRule)
class TransferWarehouseRuleAdmin(admin.ModelAdmin):
    list_display = (
        'user',
        'warehouse_code',
        'warehouse_name',
        'direction',
        'stage',
        'is_active',
        'updated_at',
    )
    list_filter = ('direction', 'stage', 'is_active')
    search_fields = ('user__username', 'warehouse_code', 'warehouse_name')


@admin.register(PendingTransferRequest)
class PendingTransferRequestAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'transfer_stage',
        'from_warehouse',
        'to_warehouse',
        'batch_number',
        'quantity',
        'status',
        'created_by',
        'sap_doc_num',
        'created_at',
    )
    list_filter = ('status', 'transfer_stage', 'from_warehouse', 'to_warehouse')
    search_fields = ('batch_number', 'item_code', 'item_name', 'created_by__username', 'sap_doc_num')


@admin.register(QualityCategory)
class QualityCategoryAdmin(admin.ModelAdmin):
    list_display = ('code', 'name_en', 'name_ar', 'sort_order', 'is_active', 'updated_at')
    list_filter = ('is_active',)
    search_fields = ('code', 'name_en', 'name_ar')
    ordering = ('sort_order', 'id')


@admin.register(InspectionStage)
class InspectionStageAdmin(admin.ModelAdmin):
    list_display = ('code', 'name_en', 'name_ar', 'sort_order', 'is_active', 'updated_at')
    list_filter = ('is_active',)
    search_fields = ('code', 'name_en', 'name_ar')
    ordering = ('sort_order', 'id')


@admin.register(QualityCriterion)
class QualityCriterionAdmin(admin.ModelAdmin):
    list_display = ('code', 'calculation_key', 'name_en', 'name_ar', 'inspection_stage', 'category', 'display_order', 'is_active', 'updated_at')
    list_filter = ('inspection_stage', 'category', 'is_active')
    search_fields = ('code', 'calculation_key', 'name_en', 'name_ar', 'inspection_stage__code', 'inspection_stage__name_en', 'inspection_stage__name_ar', 'category__code', 'category__name_en', 'category__name_ar')
    ordering = ('inspection_stage__sort_order', 'display_order', 'id')


@admin.register(ItemQualityCriterion)
class ItemQualityCriterionAdmin(admin.ModelAdmin):
    list_display = ('item_code', 'inspection_stage', 'quality_criterion', 'display_order', 'is_required', 'created_at')
    list_filter = ('is_required', 'inspection_stage', 'quality_criterion__category')
    search_fields = ('item_code', 'inspection_stage__code', 'quality_criterion__code', 'quality_criterion__name_en', 'quality_criterion__name_ar')
    ordering = ('item_code', 'inspection_stage__sort_order', 'display_order', 'id')


class PurchaseGRPODraftBatchInline(admin.TabularInline):
    model = PurchaseGRPODraftBatch
    extra = 0


@admin.register(PurchaseGRPODraft)
class PurchaseGRPODraftAdmin(admin.ModelAdmin):
    inlines = [PurchaseGRPODraftBatchInline]
    list_display = (
        'id',
        'inspection',
        'status',
        'vendor_card_code',
        'item_code',
        'quantity',
        'warehouse_code',
        'created_by',
        'created_at',
    )
    list_filter = ('status', 'warehouse_code')
    search_fields = (
        'id',
        'inspection__batch_number',
        'vendor_card_code',
        'vendor_name',
        'item_code',
        'item_name',
        'batch_number',
    )
    readonly_fields = ('created_at', 'updated_at', 'cancelled_at', 'posted_at')
    ordering = ('-created_at',)


@admin.register(PurchaseGRPOPostingAuditLog)
class PurchaseGRPOPostingAuditLogAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'draft',
        'action',
        'status_before',
        'status_after',
        'sap_object',
        'actor',
        'created_at',
    )
    list_filter = ('action', 'sap_object', 'created_at')
    search_fields = ('draft__id', 'draft__batch_number', 'draft__sap_doc_entry', 'draft__sap_doc_num', 'error_message')
    readonly_fields = (
        'draft',
        'action',
        'status_before',
        'status_after',
        'sap_object',
        'payload_snapshot',
        'response_snapshot',
        'error_message',
        'actor',
        'created_at',
    )
    ordering = ('-created_at',)


class PalletPositionInline(admin.TabularInline):
    model = ColdStoragePalletPosition
    extra = 0
    fields = ('position_index', 'position_code', 'status', 'reserved_by', 'reserved_at', 'reservation_reference', 'current_batch_number')
    readonly_fields = ('warehouse_code', 'bin_code', 'sap_bin_abs_entry', 'created_at', 'updated_at')


@admin.register(ColdStorageBinLayout)
class ColdStorageBinLayoutAdmin(admin.ModelAdmin):
    list_display = ('bin_code', 'warehouse_code', 'sap_bin_abs_entry', 'capacity', 'channel_type', 'updated_at')
    list_filter = ('warehouse_code', 'channel_type')
    search_fields = ('bin_code', 'warehouse_code', 'sap_bin_abs_entry')
    inlines = [PalletPositionInline]


@admin.register(ColdStoragePalletPosition)
class ColdStoragePalletPositionAdmin(admin.ModelAdmin):
    list_display = ('bin_code', 'position_code', 'warehouse_code', 'sap_bin_abs_entry', 'status', 'reserved_by', 'updated_at')
    list_filter = ('warehouse_code', 'status')
    search_fields = ('bin_code', 'position_code', 'warehouse_code', 'sap_bin_abs_entry', 'reservation_reference')
