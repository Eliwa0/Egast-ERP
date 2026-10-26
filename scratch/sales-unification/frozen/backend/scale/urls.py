from django.urls import path
from . import views

urlpatterns = [
    # ── Live weight & Ingestion
    path("live-weight/", views.live_weight_view, name="scale_live_weight"),
    path("receive-weight/", views.receive_weight_api, name="scale_receive_weight"),

    # ── Devices
    path("devices/", views.scale_devices_collection, name="scale_devices_collection"),
    path("devices/<int:device_id>/", views.scale_device_detail, name="scale_device_detail"),

    # ── Vehicles & Movements
    path("vehicles/", views.scale_vehicles_collection, name="scale_vehicles_collection"),
    path("vehicles/entry/", views.scale_vehicle_entry, name="scale_vehicle_entry"),
    path("vehicles/exit/", views.scale_vehicle_exit, name="scale_vehicle_exit"),

    # ── Item Elements (Tare)
    path("item-elements/", views.scale_item_elements_collection, name="scale_item_elements_collection"),
    path("item-elements/<int:element_id>/", views.scale_item_element_detail, name="scale_item_element_detail"),

    # ── Drafts workflow
    path("master-data/farms/", views.scale_receiving_farms_view, name="scale_receiving_farms"),
    path("master-data/item-groups/", views.scale_receiving_item_groups_view, name="scale_receiving_item_groups"),
    path("master-data/items/", views.scale_receiving_items_view, name="scale_receiving_items"),

    path("available-quotations/", views.available_purchase_quotations_view, name="scale_available_quotations"),
    path("drafts/", views.scale_drafts_list_view, name="scale_drafts_list"),
    path("drafts/first-weight/", views.scale_draft_first_weight_view, name="scale_draft_first_weight"),
    path("drafts/<int:draft_id>/", views.scale_draft_detail_view, name="scale_draft_detail"),
    path("drafts/<int:draft_id>/second-weight/", views.scale_draft_second_weight_view, name="scale_draft_second_weight"),
    path("drafts/<int:draft_id>/elements/", views.scale_draft_elements_view, name="scale_draft_elements"),
    path("drafts/<int:draft_id>/allocations/", views.scale_draft_allocations_view, name="scale_draft_allocations"),
    path("drafts/<int:draft_id>/send-to-quality/", views.scale_draft_send_to_quality_view, name="scale_draft_send_to_quality"),
    path("drafts/<int:draft_id>/cancel/", views.scale_draft_cancel_view, name="scale_draft_cancel"),

    # ── Quality Integration
    path("quality/pending-drafts/", views.quality_pending_scale_drafts_view, name="scale_quality_pending_drafts"),

    # ── Receipts (إيصال الاستلام)
    path("receipts/", views.scale_receipts_collection, name="scale_receipts_collection"),
    path("receipts/<int:receipt_id>/", views.scale_receipt_detail, name="scale_receipt_detail"),

    # ── Entry & Exit Permits (تصاريح الدخول والخروج — EG.ST.F05/F06)
    path("entry-exit-permits/", views.scale_entry_exit_permits_collection, name="scale_entry_exit_permits_collection"),
    path("entry-exit-permits/<int:permit_id>/", views.scale_entry_exit_permit_detail, name="scale_entry_exit_permit_detail"),

    # ── Virtual Scale Simulator (Development & UI Testing)
    path("simulator/set/", views.scale_simulator_set_view, name="scale_simulator_set"),
    path("simulator/status/", views.scale_simulator_status_view, name="scale_simulator_status"),
]
