from django.urls import path

from . import views
from . import physical_transfer_views
from . import shipping_views
from . import production_pallet_views

from . import quality_views

from . import grpo_views

from . import purchase_quotation_views
from . import cold_storage_report_views
from . import audit_views
from . import issue_views
from . import customization_delivery_views
from . import customization_views
from . import delivery_views







prod = views.require_production_access

production_admin = views.require_production_admin_access

transfer_admin = views.require_transfer_admin_access

user_admin = views.require_user_management_access



urlpatterns = [
    path('production/pallet-types/', production_pallet_views.pallet_types),
    path('shipping/operations/', shipping_views.shipping_list),
    path('shipping/operations/discover/', shipping_views.shipping_discover),
    path('shipping/operations/<int:pk>/', shipping_views.shipping_detail),
    path('shipping/operations/<int:pk>/submit/', shipping_views.shipping_action, {'action': 'submit'}),
    path('shipping/operations/<int:pk>/reopen/', shipping_views.shipping_action, {'action': 'reopen'}),
    path('shipping/sources/<str:batch>/', shipping_views.shipping_source),
    path('shipping/elements/', shipping_views.shipping_elements),
    path('shipping/orders/', shipping_views.shipping_orders),
    path('shipping/orders/<int:entry>/', shipping_views.shipping_order),
    path('shipping/deliveries/', shipping_views.shipping_delivery_list),
    path('shipping/operations/<int:pk>/delivery/', shipping_views.shipping_create_delivery),

    path("login/", views.login_view),

    path("me/", views.me_view),

    path("logout/", views.logout_view),

    path("create-user/", views.create_user_view),

    path("test/", views.test_api),

    path('transfer/physical/batches/<str:batch_number>/', views.require_transfer_access(physical_transfer_views.physical_batch)),
    path('transfer/physical/arrival/', views.require_transfer_access(physical_transfer_views.physical_move), {'operation': 'arrival'}),
    path('transfer/physical/load/', views.require_transfer_access(physical_transfer_views.physical_move), {'operation': 'load'}),
    path('transfer/physical/events/', transfer_admin(physical_transfer_views.physical_review)),

    path("transfer/warehouse-access/me/", views.transfer_my_warehouse_access),

    path("transfer/rules/warehouse-access/", transfer_admin(views.transfer_warehouse_access_rules)),

    path("transfer/rules/warehouse-access/<int:rule_id>/", transfer_admin(views.transfer_warehouse_access_rule_detail)),

    path("transfer/intermediate-warehouses/", views.transfer_intermediate_warehouses),

    path("transfer/warehouses/", views.transfer_warehouses),

    path("transfer/batches/<str:batch_number>/", views.transfer_batch_details),

    path("transfer/move/", views.transfer_move),

    path("admin/pending-transfers/", views.list_pending_transfers),

    path(
        "admin/reports/reserved-outbound-positions/",
        transfer_admin(cold_storage_report_views.list_reserved_outbound_positions),
    ),
    path("admin/pending-transfers/post-selected/", transfer_admin(views.post_selected_pending_transfers)),

    path("admin/pending-transfers/<int:transfer_id>/", transfer_admin(views.get_pending_transfer_detail)),

    path("admin/pending-transfers/<int:transfer_id>/post/", transfer_admin(views.post_pending_transfer)),

    path("admin/pending-transfers/<int:transfer_id>/reconcile-positions/", transfer_admin(views.reconcile_pending_transfer_positions)),
    path("uoms/", prod(views.get_all_uoms)),

    path("open-production-orders/", prod(views.get_open_production_orders)),

    path("production-orders/", prod(views.get_production_orders)),

    path(

        "production-orders/by-number/<int:doc_number>/",

        prod(views.get_production_order_by_number),

    ),

    path("production-orders/<int:doc_entry>/", prod(views.get_production_order)),

    path("production-orders/<int:doc_entry>/close/", prod(views.close_production_order)),

    path("receipts/", prod(views.get_receipts)),

    path("receipts/create/", prod(views.create_receipt)),

    path("inventory/<str:item_code>/", prod(views.get_item_stock)),

    path("inventory/low-stock/", prod(views.get_low_stock_items)),

    path("item-name/<str:item_code>/", prod(views.get_item_name_only)),

    path("item-details/<str:item_code>/", prod(views.get_item_details_api)),

    path("warehouses/", views.get_warehouses),

    path("bin-locations/<str:warehouse_code>/", views.get_bin_locations_by_warehouse),

    path("cold-storage/<str:warehouse_code>/hierarchy/", views.get_cold_storage_hierarchy),
    path("cold-storage/<str:warehouse_code>/layout/", views.get_cold_storage_layout),
    path("cold-storage/bin/<int:abs_entry>/positions/", views.get_cold_storage_bin_positions),
    path("cold-storage/positions/<int:position_id>/reserve/", transfer_admin(views.reserve_cold_storage_position)),
    path("cold-storage/positions/<int:position_id>/release/", transfer_admin(views.release_cold_storage_position)),
    path("cold-storage/positions/<int:position_id>/occupy/", transfer_admin(views.occupy_cold_storage_position)),
    path("cold-storage/positions/<int:position_id>/vacate/", transfer_admin(views.vacate_cold_storage_position)),
    path("cold-storage/bin/<int:abs_entry>/configure/", transfer_admin(views.configure_cold_storage_bin)),
    path("cold-storage/allocate-preview/", transfer_admin(views.preview_cold_storage_allocation)),
    path("cold-storage/allocate-sequential/", transfer_admin(views.allocate_cold_storage_sequential)),
    path("tax-codes/", views.get_tax_codes),

    path("grpo/tax-codes/", views.get_tax_codes),

    path("series/", prod(views.get_series_list)),

    path("account-codes/", prod(views.get_account_codes)),

    path(

        "production-order-warehouse/<int:doc_entry>/",

        prod(views.get_production_order_warehouse),

    ),

    path("distribution-rule/<int:doc_entry>/", prod(views.get_distribution_rule)),

    path(

        "production-order-location/<int:doc_entry>/",

        prod(views.get_production_order_location),

    ),

    path(

        "production-order-general/<int:doc_entry>/", prod(views.get_production_order_general)

    ),

    path("production-lines/", prod(views.get_production_lines)),

    path(

        "production-order-start-date/<int:doc_entry>/",

        prod(views.get_production_order_start_date),

    ),

    path("receipts/next-number/", prod(views.get_next_receipt_number)),

    path("next-batch-number/<str:production_order_number>/", prod(views.get_next_batch_number_for_order)),

    path("item-batch-attributes/<str:item_code>/", prod(views.get_item_batch_attributes)),

    path("batch-udf-metadata/", prod(views.get_batch_udf_metadata)),

    path("uom-options/", prod(views.get_uom_options)),

    path("company-options/", prod(views.get_company_options)),

    path("batch-details/<str:batch_number>/", prod(views.get_batch_details_by_number)),

    path("debug/item-full/<str:item_code>/", prod(views.debug_item_full)),

    path("debug/item-udf/<str:item_code>/", prod(views.debug_item_udf)),

    # ── Production Order Attribute Rules

    path("production-order-attribute-rules/<int:doc_entry>/", prod(views.get_production_order_attribute_rules)),

    path("admin/attribute-rules/", production_admin(views.admin_list_attribute_rules)),

    path("admin/attribute-rules/save/", production_admin(views.save_order_attribute_rules)),

    path("admin/attribute-rules/order/<int:doc_entry>/", production_admin(views.delete_order_attribute_rules)),

    # ── Admin: Users

    path("admin/users/", user_admin(views.admin_list_users)),

    path("admin/module-permissions/modules/", views.admin_module_permission_modules),

    path("admin/users/<int:user_id>/module-permissions/", views.admin_user_module_permissions),
    path("admin/users/<int:user_id>/", user_admin(views.admin_update_user)),

    path("admin/users/<int:user_id>/reset-password/", user_admin(views.admin_reset_password)),

    path("admin/users/<int:user_id>/set-active/", user_admin(views.admin_set_user_active)),

    path("admin/users/<int:user_id>/delete/", user_admin(views.admin_delete_user)),
    # ── Audit Log
    path("audit-log/", user_admin(audit_views.list_audit_logs)),
    path("audit-log/<int:log_id>/", user_admin(audit_views.get_audit_log_detail)),

    # ── User Attribute Rules

    path("user-attribute-rules/me/", prod(views.get_my_user_attribute_rules)),

    path("admin/user-attribute-rules/", production_admin(views.admin_list_user_attribute_rules)),

    path("admin/user-attribute-rules/set/", production_admin(views.admin_set_user_attribute_rules)),

    path("admin/user-attribute-rules/<int:user_id>/delete/", production_admin(views.admin_delete_user_attribute_rules)),

    # ── Warehouse Attribute Visibility Rules

    path("warehouse-attribute-visibility-rules/<str:warehouse_code>/", prod(views.get_warehouse_attribute_visibility_rules)),

    path("admin/warehouse-visibility-rules/", production_admin(views.admin_list_warehouse_visibility_rules)),

    path("admin/warehouse-visibility-rules/set/", production_admin(views.admin_set_warehouse_visibility_rule)),

    path("admin/warehouse-visibility-rules/<int:rule_id>/delete/", production_admin(views.admin_delete_warehouse_visibility_rule)),

    path("admin/warehouse-visibility-rules/by-warehouse/<str:warehouse_code>/delete/", production_admin(views.admin_delete_warehouse_visibility_rule_by_code)),

    # ── Warehouse Attribute Rules (value filtering per warehouse, mirrors User Attribute Rules)

    path("warehouse-attribute-rules/<str:warehouse_code>/", prod(views.get_warehouse_attribute_rules)),

    path("admin/warehouse-attribute-rules/", production_admin(views.admin_list_warehouse_attribute_rules)),

    path("admin/warehouse-attribute-rules/set/", production_admin(views.admin_set_warehouse_attribute_rules)),

    path("admin/warehouse-attribute-rules/<str:warehouse_code>/delete/", production_admin(views.admin_delete_warehouse_attribute_rules)),

    # ── Order Attribute Visibility (field show/hide per production order)

    path("order-attribute-visibility/<int:doc_entry>/", prod(views.get_order_attribute_visibility)),

    path("admin/order-attribute-visibility/", production_admin(views.admin_list_order_attribute_visibility)),

    path("admin/order-attribute-visibility/set/", production_admin(views.admin_set_order_attribute_visibility)),

    path("admin/order-attribute-visibility/order/<int:doc_entry>/", production_admin(views.admin_delete_order_attribute_visibility)),

    # ── User Attribute Visibility (field show/hide per user)

    path("user-attribute-visibility/me/", prod(views.get_my_user_attribute_visibility)),

    path("admin/user-attribute-visibility/", production_admin(views.admin_list_user_attribute_visibility)),

    path("admin/user-attribute-visibility/set/", production_admin(views.admin_set_user_attribute_visibility)),

    path("admin/user-attribute-visibility/<int:user_id>/delete/", production_admin(views.admin_delete_user_attribute_visibility)),

    # ── Production Order Visibility Rules (admin hides orders per warehouse)

    path("admin/production-order-visibility-rules/", production_admin(views.admin_list_order_visibility_rules)),

    path("admin/production-order-visibility-rules/bulk-update/", production_admin(views.admin_bulk_update_order_visibility)),

    # ── Pending Receipt Review flow

    path("reserve-next-batch-number/", prod(views.reserve_next_batch_number)),

    path("pending-receipts/", prod(views.create_pending_receipt)),

    path("admin/pending-receipts/", prod(views.list_pending_receipts)),
    path("admin/pending-receipts/<int:receipt_id>/", prod(views.get_pending_receipt_detail)),

    path("admin/pending-receipts/<int:receipt_id>/approve-post/", production_admin(views.approve_post_pending_receipt)),

    path("admin/pending-receipts/<int:receipt_id>/reject/", production_admin(views.reject_pending_receipt)),

    path("admin/pending-receipts/<int:receipt_id>/batches/<int:batch_id>/", prod(views.update_pending_receipt_batch)),

    path("admin/pending-receipts/<int:receipt_id>/batches/<int:batch_id>/delete/", prod(views.delete_pending_receipt_batch)),

    path("admin/pending-receipts/<int:receipt_id>/batches/<int:batch_id>/duplicate/", prod(views.duplicate_pending_receipt_batch)),

    # ── Bulk batch update

    path("admin/pending-receipt-batches/bulk-update/", production_admin(views.bulk_update_pending_receipt_batches)),

    # ── Post extra quantity / Change order

    path("admin/pending-receipts/<int:receipt_id>/post-extra-quantity/", production_admin(views.post_extra_quantity)),

    path("admin/pending-receipts/<int:receipt_id>/change-order/", production_admin(views.change_pending_receipt_order)),

    # ── Pending Issue Review flow
    path("pending-issues/available-batches/", prod(issue_views.get_production_issue_available_batches)),
    path("pending-issues/", prod(issue_views.create_pending_issue)),
    path("admin/pending-issues/", prod(issue_views.list_pending_issues)),
    path("admin/pending-issues/<int:issue_id>/", prod(issue_views.get_pending_issue_detail)),
    path("admin/pending-issues/<int:issue_id>/approve-post/", production_admin(issue_views.approve_post_pending_issue)),
    path("admin/pending-issues/<int:issue_id>/reject/", production_admin(issue_views.reject_pending_issue)),
    path("admin/pending-issues/<int:issue_id>/reconcile/", production_admin(issue_views.reconcile_pending_issue)),
    # ── Quality Inspection endpoints

    path("quality/inspections/", quality_views.list_pending_inspections),

    path("quality/inspections/create/", quality_views.create_quality_inspection),

    path("quality/inspections/<int:inspection_id>/", quality_views.get_quality_inspection_detail),

    path("quality/inspections/<int:inspection_id>/grpo-draft/", quality_views.purchase_grpo_draft_for_inspection),

    path("quality/grpo-drafts/<int:draft_id>/", quality_views.purchase_grpo_draft_detail),

    path("quality/grpo-drafts/<int:draft_id>/cancel/", quality_views.cancel_purchase_grpo_draft),

    path("quality/grpo-drafts/<int:draft_id>/approve-for-posting/", quality_views.approve_purchase_grpo_draft_for_posting),

    path("quality/grpo-drafts/<int:draft_id>/prepare-posting/", quality_views.prepare_purchase_grpo_posting),

    path("quality/grpo-drafts/<int:draft_id>/post-to-sap/", quality_views.post_purchase_grpo_draft_to_sap),

    path("quality/inspections/<int:inspection_id>/approve/", quality_views.approve_post_quality_inspection),

    path("quality/inspections/<int:inspection_id>/reject/", quality_views.reject_quality_inspection),

    path("quality/inspections/<int:inspection_id>/delete/", quality_views.delete_quality_inspection),

    path("quality/approve-bulk/", quality_views.approve_quality_inspection_bulk),

    path("quality/delete-bulk/", quality_views.delete_quality_inspection_bulk),

    path("quality/batches/<str:batch_number>/", quality_views.get_quality_batch_details),

    path("quality/item-groups/", quality_views.list_quality_item_groups),

    path("quality/farms/", quality_views.list_quality_farms),

    path("quality/contractors/", quality_views.list_quality_contractors),

    path("quality/items/", quality_views.list_quality_items),

    path("quality/cost-centers/", quality_views.list_quality_cost_centers),

    path("quality/categories/", quality_views.quality_categories_collection),

    path("quality/categories/<int:category_id>/", quality_views.quality_category_detail),

    path("quality/inspection-stages/", quality_views.inspection_stages_collection),

    path("quality/inspection-stages/<int:stage_id>/", quality_views.inspection_stage_detail),

    path("quality/inspection-criteria/", quality_views.inspection_quality_criteria),

    path("quality/criteria/", quality_views.quality_criteria_collection),

    path("quality/criteria/<int:criterion_id>/", quality_views.quality_criterion_detail),

    path("quality/item-criteria/", quality_views.item_quality_criteria_collection),

    path("quality/item-criteria/<int:mapping_id>/", quality_views.item_quality_criterion_detail),

    # ── Standalone GRPO endpoints

    path("grpo/pending-shipments/", grpo_views.list_pending_grpo_shipments),

    path("grpo/review/", grpo_views.list_completed_grpo_reviews),

    path("grpo/manual-receiving/", grpo_views.create_manual_receiving_request),

    path("grpo/scale-drafts/<int:scale_draft_id>/grpo-draft/", grpo_views.create_or_get_scale_draft_grpo),

    # ── Purchase Quotation endpoints

    path("purchase-quotations/locations/", purchase_quotation_views.list_warehouse_locations),

    path("warehouse-locations/", purchase_quotation_views.list_warehouse_locations),

    path("purchase-quotations/currencies/", purchase_quotation_views.list_currencies),

    path("currencies/", purchase_quotation_views.list_currencies),

    path("purchase-quotations/drafts/", purchase_quotation_views.list_purchase_quotation_drafts),

    path("purchase-quotations/create/", purchase_quotation_views.create_purchase_quotation_draft),

    path("purchase-quotations/<int:draft_id>/", purchase_quotation_views.purchase_quotation_draft_detail),

    path("purchase-quotations/<int:draft_id>/approve/", purchase_quotation_views.approve_purchase_quotation_draft),

    path("purchase-quotations/<int:draft_id>/prepare-posting/", purchase_quotation_views.prepare_purchase_quotation_posting),

    path("purchase-quotations/<int:draft_id>/post-to-sap/", purchase_quotation_views.post_purchase_quotation_to_sap),

    path("purchase-quotations/<int:draft_id>/cancel/", purchase_quotation_views.cancel_purchase_quotation_draft),

    path("purchase-quotations/review/", purchase_quotation_views.list_completed_purchase_quotations),

    # ── Customization & Delivery endpoints (read only, GET only)
    #
    # Customization reads SAP Sales Quotations (Quotations / OQUT / QUT1).
    # Delivery reads SAP Sales Orders (Orders / ORDR / RDR1). SAP Deliveries
    # (ODLN / DLN1) are intentionally not queried in this phase.

    path("customization-delivery/documents/", customization_delivery_views.customization_documents),

    path("customization-delivery/documents/<int:doc_entry>/", customization_delivery_views.customization_document_detail),

    path("customization-delivery/delivery-documents/", customization_delivery_views.delivery_documents),

    path("customization-delivery/delivery-documents/<int:doc_entry>/", customization_delivery_views.delivery_document_detail),

    # ── Customization Workflow Endpoints
    path("customization-delivery/customization/drafts/", customization_views.list_or_create_customization_drafts),
    path("customization-delivery/customization/drafts/<int:draft_id>/", customization_views.customization_draft_detail),
    path("customization-delivery/customization/drafts/<int:draft_id>/submit/", customization_views.submit_customization_draft),
    path("customization-delivery/customization/drafts/<int:draft_id>/approve/", customization_views.approve_customization_draft),
    path("customization-delivery/customization/drafts/<int:draft_id>/reject/", customization_views.reject_customization_draft),
    path("customization-delivery/customization/drafts/<int:draft_id>/patch-quotation/", customization_views.patch_quotation_to_sap),
    path("customization-delivery/customization/drafts/<int:draft_id>/customer-approval/", customization_views.record_customer_approval),
    path("customization-delivery/customization/drafts/<int:draft_id>/create-order/", customization_views.create_sales_order),

    # ── Delivery Workflow Endpoints
    path("customization-delivery/delivery/drafts/", delivery_views.list_or_create_delivery_drafts),
    path("customization-delivery/delivery/drafts/<int:draft_id>/", delivery_views.delivery_draft_detail),
    path("customization-delivery/delivery/drafts/<int:draft_id>/submit/", delivery_views.submit_delivery_draft),
    path("customization-delivery/delivery/drafts/<int:draft_id>/approve/", delivery_views.approve_delivery_draft),
    path("customization-delivery/delivery/drafts/<int:draft_id>/reject/", delivery_views.reject_delivery_draft),
    path("customization-delivery/delivery/drafts/<int:draft_id>/post/", delivery_views.post_delivery_to_sap),
    path("customization-delivery/delivery/drafts/<int:draft_id>/reconcile/", delivery_views.reconcile_delivery_draft),

    # ── 3-Layer Workflow Endpoints
    path("customization-delivery/quotations/create/", customization_views.create_sales_quotation_and_draft),
    path("customization-delivery/quotations/posting/<str:request_key>/", customization_views.quotation_posting_status),
    path("customization-delivery/customers/", customization_views.list_sales_customers),
    path("customization-delivery/items/", customization_views.list_sales_items),
    path("customization-delivery/quotation-metadata/", customization_views.sales_quotation_metadata),
    path("customization-delivery/quotation-context/", customization_views.sales_quotation_context),
    path("customization-delivery/delivery/eligible-orders/", delivery_views.list_eligible_delivery_orders),
    path("customization-delivery/delivery/posted-documents/<int:doc_entry>/", delivery_views.posted_delivery_document),
    path("customization-delivery/delivery/report/", delivery_views.delivery_review_report),
    path("customization-delivery/orders/", delivery_views.list_workflow_sales_orders),
    path("customization-delivery/orders/documents/<int:doc_entry>/", customization_delivery_views.sales_order_document_detail),
    path("customization-delivery/batches/", delivery_views.list_available_batches),

]


