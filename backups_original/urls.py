from django.urls import path
from . import views

prod = views.require_production_access
production_admin = views.require_production_admin_access
transfer_admin = views.require_transfer_admin_access
user_admin = views.require_user_management_access

urlpatterns = [
    path("login/", views.login_view),
    path("me/", views.me_view),
    path("logout/", views.logout_view),
    path("create-user/", views.create_user_view),
    path("test/", views.test_api),
    path("transfer/config/", views.transfer_config),
    path("transfer/warehouse-access/me/", views.transfer_my_warehouse_access),
    path("transfer/rules/warehouse-access/", transfer_admin(views.transfer_warehouse_access_rules)),
    path("transfer/rules/warehouse-access/<int:rule_id>/", transfer_admin(views.transfer_warehouse_access_rule_detail)),
    path("transfer/intermediate-warehouses/", views.transfer_intermediate_warehouses),
    path("transfer/warehouses/", views.transfer_warehouses),
    path("transfer/batches/<str:batch_number>/", views.transfer_batch_details),
    path("transfer/move/", views.transfer_move),
    path("admin/pending-transfers/", views.list_pending_transfers),
    path("admin/pending-transfers/post-selected/", transfer_admin(views.post_selected_pending_transfers)),
    path("admin/pending-transfers/<int:transfer_id>/", transfer_admin(views.get_pending_transfer_detail)),
    path("admin/pending-transfers/<int:transfer_id>/post/", transfer_admin(views.post_pending_transfer)),
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
    path("bin-locations/<str:warehouse_code>/", views.get_bin_locations_by_warehouse),
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
    path("admin/users/<int:user_id>/", user_admin(views.admin_update_user)),
    path("admin/users/<int:user_id>/reset-password/", user_admin(views.admin_reset_password)),
    path("admin/users/<int:user_id>/set-active/", user_admin(views.admin_set_user_active)),
    path("admin/users/<int:user_id>/delete/", user_admin(views.admin_delete_user)),
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
    path("admin/pending-receipts/", production_admin(views.list_pending_receipts)),
    path("admin/pending-receipts/<int:receipt_id>/", production_admin(views.get_pending_receipt_detail)),
    path("admin/pending-receipts/<int:receipt_id>/approve-post/", production_admin(views.approve_post_pending_receipt)),
    path("admin/pending-receipts/<int:receipt_id>/reject/", production_admin(views.reject_pending_receipt)),
    path("admin/pending-receipts/<int:receipt_id>/batches/<int:batch_id>/", production_admin(views.update_pending_receipt_batch)),
    path("admin/pending-receipts/<int:receipt_id>/batches/<int:batch_id>/delete/", production_admin(views.delete_pending_receipt_batch)),
    path("admin/pending-receipts/<int:receipt_id>/batches/<int:batch_id>/duplicate/", production_admin(views.duplicate_pending_receipt_batch)),
    # ── Bulk batch update
    path("admin/pending-receipt-batches/bulk-update/", production_admin(views.bulk_update_pending_receipt_batches)),
    # ── Post extra quantity / Change order
    path("admin/pending-receipts/<int:receipt_id>/post-extra-quantity/", production_admin(views.post_extra_quantity)),
    path("admin/pending-receipts/<int:receipt_id>/change-order/", production_admin(views.change_pending_receipt_order)),
]
