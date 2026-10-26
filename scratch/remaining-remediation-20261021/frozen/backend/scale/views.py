import json
from decimal import Decimal, InvalidOperation
from functools import wraps
from typing import Optional
from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Q, CharField
from django.db.models.functions import Cast
from django.http import JsonResponse
from django.utils.crypto import constant_time_compare
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework.decorators import api_view

from api.quality_views import (
    _fetch_all_sap_pages,
    _fetch_business_partners_by_group_names,
    _get_case_insensitive,
    _get_item_uom_fields,
    _item_group_business_sort_key,
)
from api.role_permissions import (
    MODULE_GRPO,
    can_access_scale,
    can_manage_scale,
    can_access_quality,
    can_access_module,
)
from api.services.cache_service import build_cache_key, cache_get, cache_set
from api.services.sap_service import SAPServiceLayer
from api.models_purchase_quotation import PurchaseQuotationDraft
from api.models_quality import PurchaseGRPODraft
from api.services.audit_service import (
    audit_mutation,
    log_action,
    MODULE_SCALE,
    ACTION_CREATE,
    ACTION_UPDATE,
    ACTION_DELETE,
    ACTION_WEIGH,
    ACTION_APPROVE,
    ACTION_CANCEL,
)
from .models import (
    ScaleDevice,
    ScaleVehicle,
    ScaleVehicleMovement,
    ScaleItemElement,
    ScaleDraft,
    ScaleDraftElement,
    ScaleDraftAllocation,
    ScalePermit,
    ScaleDraftTrailer,
    ScaleDraftContainer,
    ScaleMovementTrailer,
    ScaleMovementContainer,
    ScaleReceipt,
    ScaleEntryExitPermit,
    ScaleEntryExitPermitItem,
)
from .serializers import (
    ScaleDeviceSerializer,
    ScaleVehicleSerializer,
    ScaleVehicleMovementSerializer,
    ScaleItemElementSerializer,
    ScaleDraftListSerializer,
    ScaleDraftDetailSerializer,
    ScaleDraftElementSerializer,
ScaleDraftAllocationSerializer,
    ScalePermitSerializer,
    ScaleReceiptSerializer,
    ScaleEntryExitPermitSerializer,
)
from .services.scale_reader import scale_reader_service, parse_raw_weight

SCALE_RECEIVING_ITEM_GROUP_PREFIX = "27"


# ── Permission Decorators ───────────────────────────────────────────────────

def require_scale_access(view_func):
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"success": False, "error": "Authentication required"}, status=401)
        if not can_access_scale(request.user):
            return JsonResponse({"success": False, "error": "Scale access required"}, status=403)
        return view_func(request, *args, **kwargs)
    wrapped.csrf_exempt = getattr(view_func, "csrf_exempt", False)
    return wrapped


def require_scale_admin_access(view_func):
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"success": False, "error": "Authentication required"}, status=401)
        if not can_manage_scale(request.user):
            return JsonResponse({"success": False, "error": "Scale admin access required"}, status=403)
        return view_func(request, *args, **kwargs)
    wrapped.csrf_exempt = getattr(view_func, "csrf_exempt", False)
    return wrapped


def require_scale_or_quality_access(view_func):
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"success": False, "error": "Authentication required"}, status=401)
        if not (
            can_access_scale(request.user)
            or can_access_quality(request.user)
            or can_access_module(request.user, MODULE_GRPO)
        ):
            return JsonResponse({"success": False, "error": "Scale or Quality access required"}, status=403)
        return view_func(request, *args, **kwargs)
    wrapped.csrf_exempt = getattr(view_func, "csrf_exempt", False)
    return wrapped


def _parse_decimal(value, field_name: str = "Weight") -> (Optional[Decimal], Optional[str]):
    if value in (None, ""):
        return None, f"{field_name} is required."
    try:
        parsed = Decimal(str(value))
        if not parsed.is_finite():
            return None, f"{field_name} must be a finite number."
        return parsed, None
    except (InvalidOperation, TypeError, ValueError):
        return None, f"{field_name} must be a valid number."


def _sync_draft_item_from_primary_allocation(draft, allocations_data):
    if not isinstance(allocations_data, list) or not allocations_data:
        return

    primary_allocation = allocations_data[0] or {}
    item_code = str(primary_allocation.get("item_code") or "").strip()
    item_name = str(primary_allocation.get("item_name") or "").strip()

    if item_code or item_name:
        draft.item_code = item_code
        draft.item_name = item_name


def _get_clean_param(request, name: str) -> str:
    return str(request.GET.get(name) or "").strip()


def _filter_decimal_range(queryset, request, field_name: str, min_param: str, max_param: str):
    min_value = _get_clean_param(request, min_param)
    max_value = _get_clean_param(request, max_param)

    if min_value:
        try:
            queryset = queryset.filter(**{f"{field_name}__gte": Decimal(min_value)})
        except (InvalidOperation, ValueError):
            pass

    if max_value:
        try:
            queryset = queryset.filter(**{f"{field_name}__lte": Decimal(max_value)})
        except (InvalidOperation, ValueError):
            pass

    return queryset


def _filter_date_range(queryset, request, field_name: str, from_param: str, to_param: str):
    from_value = parse_date(_get_clean_param(request, from_param))
    to_value = parse_date(_get_clean_param(request, to_param))

    if from_value:
        queryset = queryset.filter(**{f"{field_name}__date__gte": from_value})

    if to_value:
        queryset = queryset.filter(**{f"{field_name}__date__lte": to_value})

    return queryset


# ── Live Weight & Ingestion APIs ───────────────────────────────────────────

@api_view(["GET"])
@require_scale_access
def live_weight_view(request):
    """Returns current live weight reading, stability, device status and timestamp."""
    device_id = request.GET.get("device_id")
    if not device_id:
        # Fall back to first active device in DB or default
        dev = ScaleDevice.objects.filter(is_active=True).first()
        device_id = dev.device_id if dev else "scale_001"

    data = scale_reader_service.get_live_reading(device_id)

    # Sync DB last_seen if reading is fresh
    if data.get("is_online") and data.get("last_seen"):
        ScaleDevice.objects.filter(device_id=device_id).update(last_seen=timezone.now())

    return JsonResponse({"success": True, "data": data})


@api_view(["POST"])
def receive_weight_api(request):
    """
    HTTP Ingestion endpoint for remote scale indicators / IoT gateways / Python reader agents.
    Payload: {"device_id": "scale_001", "weight": "12540.00", "is_stable": true, "raw_data": "..."}
    """
    configured_token = str(getattr(settings, "SCALE_AGENT_AUTH_TOKEN", "") or "")
    authorization = str(request.headers.get("Authorization") or "")
    scheme, separator, supplied_token = authorization.partition(" ")
    credential_valid = (
        bool(configured_token)
        and separator == " "
        and scheme.lower() == "bearer"
        and bool(supplied_token)
        and constant_time_compare(supplied_token, configured_token)
    )
    if not credential_valid:
        return JsonResponse(
            {"success": False, "error": "Valid Scale Agent credential required"},
            status=401,
        )

    body = request.data or {}
    device_id = str(body.get("device_id") or "scale_001").strip()
    raw_weight_val = body.get("weight")
    raw_data = str(body.get("raw_data") or "")

    weight = None
    if raw_weight_val is not None:
        weight, err = _parse_decimal(raw_weight_val, "weight")
    elif raw_data:
        weight = parse_raw_weight(raw_data)

    if weight is None:
        return JsonResponse({"success": False, "error": "Valid numeric weight or raw_data required"}, status=400)

    is_stable = body.get("is_stable")
    if is_stable is not None:
        is_stable = bool(is_stable)

    device_name = body.get("device_name")
    location = body.get("location")

    result = scale_reader_service.record_reading(
        device_id=device_id,
        weight=weight,
        is_stable=is_stable,
        raw_data=raw_data,
        device_name=device_name,
        location=location,
    )

    # Update DB last_seen timestamp
    ScaleDevice.objects.filter(device_id=device_id).update(last_seen=timezone.now())

    return JsonResponse({"success": True, "data": result})


# ── Scale Devices Management ────────────────────────────────────────────────

@api_view(["GET", "POST"])
@require_scale_access
@audit_mutation(module=MODULE_SCALE, entity_type="ScaleDevice", methods=("POST",))
def scale_devices_collection(request):
    if request.method == "GET":
        devices = ScaleDevice.objects.all()
        serializer = ScaleDeviceSerializer(devices, many=True)
        active_in_memory = scale_reader_service.list_active_devices()
        return JsonResponse({
            "success": True,
            "data": {
                "devices": serializer.data,
                "live_states": active_in_memory,
            }
        })

    # POST (Admin only)
    if not can_manage_scale(request.user):
        return JsonResponse({"success": False, "error": "Scale admin permission required"}, status=403)

    serializer = ScaleDeviceSerializer(data=request.data)
    if not serializer.is_valid():
        return JsonResponse({"success": False, "errors": serializer.errors}, status=400)

    device = serializer.save()
    return JsonResponse({"success": True, "data": ScaleDeviceSerializer(device).data}, status=201)


@api_view(["GET", "PUT", "DELETE"])
@require_scale_access
@audit_mutation(module=MODULE_SCALE, entity_type="ScaleDevice")
def scale_device_detail(request, device_id):
    try:
        device = ScaleDevice.objects.get(id=device_id)
    except ScaleDevice.DoesNotExist:
        return JsonResponse({"success": False, "error": "Scale device not found"}, status=404)

    if request.method == "GET":
        live_state = scale_reader_service.get_live_reading(device.device_id)
        data = ScaleDeviceSerializer(device).data
        data["live_state"] = live_state
        return JsonResponse({"success": True, "data": data})

    if not can_manage_scale(request.user):
        return JsonResponse({"success": False, "error": "Scale admin permission required"}, status=403)

    if request.method == "DELETE":
        device.delete()
        return JsonResponse({"success": True, "message": "Device deleted successfully"})

    serializer = ScaleDeviceSerializer(device, data=request.data, partial=True)
    if not serializer.is_valid():
        return JsonResponse({"success": False, "errors": serializer.errors}, status=400)

    updated = serializer.save()
    return JsonResponse({"success": True, "data": ScaleDeviceSerializer(updated).data})


# ── Vehicle & Movement APIs ─────────────────────────────────────────────────

@api_view(["GET", "POST"])
@require_scale_access
@audit_mutation(module=MODULE_SCALE, entity_type="ScaleVehicle", methods=("POST",))
def scale_vehicles_collection(request):
    if request.method == "GET":
        queryset = ScaleVehicle.objects.all()
        inside_only = request.GET.get("inside_only")
        search = request.GET.get("search", "").strip()

        if search:
            queryset = queryset.filter(
                Q(vehicle_number__icontains=search)
                | Q(driver_name__icontains=search)
                | Q(company__icontains=search)
            )

        vehicles = list(queryset[:100])
        if inside_only in ("true", "1"):
            vehicles = [v for v in vehicles if v.is_inside]

        return JsonResponse({"success": True, "data": ScaleVehicleSerializer(vehicles, many=True).data})

    serializer = ScaleVehicleSerializer(data=request.data)
    if not serializer.is_valid():
        return JsonResponse({"success": False, "errors": serializer.errors}, status=400)

    vehicle = serializer.save()
    return JsonResponse({"success": True, "data": ScaleVehicleSerializer(vehicle).data}, status=201)


@api_view(["POST"])
@require_scale_access
@audit_mutation(module=MODULE_SCALE, entity_type="ScaleVehicleMovement", action=ACTION_CREATE)
def scale_vehicle_entry(request):
    """Records truck entry into the premises."""
    data = request.data or {}
    vehicle_number = str(data.get("vehicle_number") or "").strip()
    driver_name = str(data.get("driver_name") or "").strip()
    notes = str(data.get("notes") or "").strip()
    truck_type = str(data.get("truck_type") or "normal").strip()
    trailers = data.get("trailers", [])
    containers = data.get("containers", [])

    if not vehicle_number:
        return JsonResponse({"success": False, "error": "Vehicle number is required"}, status=400)
    
    vehicle, _ = ScaleVehicle.objects.get_or_create(
        vehicle_number=vehicle_number,
        defaults={
            "driver_name": driver_name, 
            "company": str(data.get("company") or ""),
            "truck_type": truck_type,
        }
    )
    
    update_fields = []
    if driver_name and vehicle.driver_name != driver_name:
        vehicle.driver_name = driver_name
        update_fields.append("driver_name")
        
    if vehicle.truck_type != truck_type:
        vehicle.truck_type = truck_type
        update_fields.append("truck_type")
        
    if update_fields:
        vehicle.save(update_fields=update_fields)

    movement = ScaleVehicleMovement.objects.create(
        vehicle=vehicle,
        driver_name=driver_name or vehicle.driver_name,
        entry_time=timezone.now(),
        notes=notes,
        created_by=request.user,
    )

    for t in trailers:
        t_num = str(t.get("trailer_number") or "").strip()
        if t_num:
            ScaleMovementTrailer.objects.create(movement=movement, trailer_number=t_num)

    for c in containers:
        c_num = str(c.get("container_number") or "").strip()
        if c_num:
            ScaleMovementContainer.objects.create(movement=movement, container_number=c_num)

    # Refresh the vehicle so the serializer picks up the newly created active movement and its trailers/containers
    vehicle.refresh_from_db()

    return JsonResponse({
        "success": True,
        "message": f"Vehicle {vehicle.vehicle_number} entry recorded",
        "data": {
            "vehicle": ScaleVehicleSerializer(vehicle).data,
            "movement": ScaleVehicleMovementSerializer(movement).data,
        }
    }, status=201)


@api_view(["POST"])
@require_scale_access
@audit_mutation(module=MODULE_SCALE, entity_type="ScaleVehicleMovement", action=ACTION_UPDATE)
def scale_vehicle_exit(request):
    """Records truck exit."""
    data = request.data or {}
    vehicle_id = data.get("vehicle_id")
    vehicle_number = str(data.get("vehicle_number") or "").strip()

    vehicle = None
    if vehicle_id:
        vehicle = ScaleVehicle.objects.filter(id=vehicle_id).first()
    elif vehicle_number:
        vehicle = ScaleVehicle.objects.filter(vehicle_number=vehicle_number).first()

    if not vehicle:
        return JsonResponse({"success": False, "error": "Vehicle not found"}, status=404)

    active_movement = vehicle.movements.filter(exit_time__isnull=True).order_by("-entry_time").first()
    if not active_movement:
        return JsonResponse({"success": False, "error": "No active entry movement found for this vehicle"}, status=400)

    active_movement.exit_time = timezone.now()
    active_movement.save()

    return JsonResponse({
        "success": True,
        "message": f"Vehicle {vehicle.vehicle_number} exit recorded",
        "data": ScaleVehicleMovementSerializer(active_movement).data
    })


# ── Scale Item Elements (Tare Configurations) ───────────────────────────────

@api_view(["GET", "POST"])
@require_scale_access
@audit_mutation(module=MODULE_SCALE, entity_type="ScaleItemElement", methods=("POST",))
def scale_item_elements_collection(request):
    if request.method == "GET":
        item_code = request.GET.get("item_code", "").strip()
        queryset = ScaleItemElement.objects.all()
        if item_code:
            queryset = queryset.filter(item_code=item_code)
        return JsonResponse({"success": True, "data": ScaleItemElementSerializer(queryset, many=True).data})

    if not can_manage_scale(request.user):
        return JsonResponse({"success": False, "error": "Scale admin permission required"}, status=403)

    serializer = ScaleItemElementSerializer(data=request.data)
    if not serializer.is_valid():
        return JsonResponse({"success": False, "errors": serializer.errors}, status=400)

    element = serializer.save()
    return JsonResponse({"success": True, "data": ScaleItemElementSerializer(element).data}, status=201)


@api_view(["GET", "PUT"])
@require_scale_access
@audit_mutation(module=MODULE_SCALE, entity_type="ScaleItemElement", action=ACTION_UPDATE, methods=("PUT",))
def scale_item_element_detail(request, element_id):
    try:
        element = ScaleItemElement.objects.get(id=element_id)
    except ScaleItemElement.DoesNotExist:
        return JsonResponse({"success": False, "error": "Scale item element not found"}, status=404)

    if request.method == "GET":
        return JsonResponse({"success": True, "data": ScaleItemElementSerializer(element).data})

    if not can_manage_scale(request.user):
        return JsonResponse({"success": False, "error": "Scale admin permission required"}, status=403)

    serializer = ScaleItemElementSerializer(element, data=request.data, partial=True)
    if not serializer.is_valid():
        return JsonResponse({"success": False, "errors": serializer.errors}, status=400)

    updated = serializer.save()
    return JsonResponse({"success": True, "data": ScaleItemElementSerializer(updated).data})


# Scale-safe SAP Receiving Master Data

@api_view(["GET"])
@require_scale_access
def scale_receiving_farms_view(request):
    from api.services.master_data_search import is_lookup, lookup_response
    if is_lookup(request):
        return lookup_response(request, SAPServiceLayer(), "farms", "farms")
    """
    Return the same SAP vendor/farm master data used by Receiving quality,
    protected by Scale permissions instead of Quality permissions.
    """
    cache_key = build_cache_key("sap:farms", "quality")
    cached_farms = cache_get(cache_key)
    if cached_farms is not None:
        return JsonResponse({"success": True, "farms": cached_farms})

    try:
        sap_client = SAPServiceLayer()
        sql_code = "CODX_QUALITY_FARMS"
        sql_text = """
SELECT
    T0."CardCode",
    T0."CardName"
FROM OCRD T0
JOIN OCRG T1
ON T0."GroupCode" = T1."GroupCode"
WHERE T1."GroupName" IN (
    'مزارع الشركة',
    'موردين خام'
)
ORDER BY T0."CardName"
""".strip()

        rows = []
        ensure_result = sap_client.ensure_sql_query(sql_code, "Quality farms by vendor group", sql_text)
        if not ensure_result.get("error"):
            query_result = sap_client.execute_sql_query(sql_code)
            if not query_result.get("error"):
                rows = query_result.get("value", [])

        if not rows:
            rows = _fetch_business_partners_by_group_names(
                sap_client,
                ["مزارع الشركة", "موردين خام"],
                "scale receiving farms",
            )

        farms = []
        for row in rows:
            farm_code = _get_case_insensitive(row, "CardCode")
            farm_name = _get_case_insensitive(row, "CardName") or farm_code
            group_name = _get_case_insensitive(row, "GroupName") or ""
            if farm_code:
                farms.append({
                    "farmCode": farm_code,
                    "farmName": farm_name,
                    "GroupName": group_name,
                })
        cache_set("sap:farms", cache_key, farms, "sap_farms")
        return JsonResponse({"success": True, "farms": farms})
    except Exception as exc:
        return JsonResponse({"success": False, "farms": [], "error": str(exc)})


@api_view(["GET"])
@require_scale_access
def scale_receiving_item_groups_view(request):
    """
    Return SAP item groups for Receiving items only, using the same prefix-27
    source used by the Receiving quality flow.
    """
    cache_key = build_cache_key("sap:item-groups", "receiving")
    cached_groups = cache_get(cache_key)
    if cached_groups:
        return JsonResponse({"success": True, "item_groups": cached_groups})

    try:
        sap_client = SAPServiceLayer()
        item_group_rows = []
        try:
            item_group_rows = _fetch_all_sap_pages(
                sap_client,
                f"ItemGroups?$select=Number,GroupName&$filter=contains(GroupName, '{SCALE_RECEIVING_ITEM_GROUP_PREFIX}')",
                "ItemGroups",
            )
        except Exception:
            item_group_rows = []

        if not item_group_rows:
            item_group_rows = _fetch_all_sap_pages(
                sap_client,
                "ItemGroups?$select=Number,GroupName",
                "ItemGroups",
            )

        groups = []
        for row in item_group_rows:
            group_code = _get_case_insensitive(row, "Number")
            group_name = _get_case_insensitive(row, "GroupName")
            normalized_group_name = str(group_name or "").strip()
            if SCALE_RECEIVING_ITEM_GROUP_PREFIX and SCALE_RECEIVING_ITEM_GROUP_PREFIX not in normalized_group_name:
                continue
            groups.append({
                "ItmsGrpCod": group_code,
                "ItmsGrpNam": normalized_group_name,
            })

        groups.sort(key=_item_group_business_sort_key)
        if groups:
            cache_set("sap:item-groups", cache_key, groups, "sap_item_groups")
        return JsonResponse({"success": True, "item_groups": groups})
    except Exception as exc:
        cached_fallback = cache_get(cache_key)
        if cached_fallback:
            return JsonResponse({"success": True, "item_groups": cached_fallback})
        import logging
        logging.getLogger(__name__).error("Failed to load scale receiving item groups: %s", exc)
        return JsonResponse({"success": False, "item_groups": [], "error": str(exc)}, status=500)


@api_view(["GET"])
@require_scale_access
def scale_receiving_items_view(request):
    from api.services.master_data_search import is_lookup, lookup_response
    if is_lookup(request):
        return lookup_response(request, SAPServiceLayer(), "scale-items", "items")
    """Return SAP receiving items for the selected SAP item group."""
    search_query = request.query_params.get("search", "").strip()
    item_group_code = request.query_params.get("item_group_code", "").strip()
    item_code_query = request.query_params.get("item_code", "").strip()
    if not item_group_code and not item_code_query:
        return JsonResponse({"success": False, "items": [], "error": "item_group_code or item_code is required"}, status=400)

    group_code = None
    if item_group_code:
        try:
            group_code = int(item_group_code)
        except (TypeError, ValueError):
            return JsonResponse({"success": False, "items": [], "error": "Invalid item_group_code"}, status=400)

    cache_key_parts = ["sap:scale:items", "receiving"]
    if group_code is not None:
        cache_key_parts.extend(["group", group_code])
    if item_code_query:
        cache_key_parts.extend(["item", item_code_query])
    cache_key_parts.append("inventory-uom-v4")
    cache_key = build_cache_key(*cache_key_parts, search=search_query)
    cached_items = cache_get(cache_key)
    if cached_items is not None:
        return JsonResponse({"success": True, "items": cached_items})

    try:
        sap_client = SAPServiceLayer()
        filters = [
            f"startswith(ItemCode, '{SCALE_RECEIVING_ITEM_GROUP_PREFIX}')",
        ]
        if group_code is not None:
            filters.append(f"ItemsGroupCode eq {group_code}")
        if item_code_query:
            safe_item_code = item_code_query.replace("'", "''")
            filters.append(f"ItemCode eq '{safe_item_code}'")
        if search_query:
            safe_search = search_query.replace("'", "''")
            filters.append(f"(contains(ItemCode, '{safe_search}') or contains(ItemName, '{safe_search}'))")
        endpoint = (
            "Items?$select=ItemCode,ItemName,ItemsGroupCode,InventoryUOM"
            f"&$filter={' and '.join(filters)}&$orderby=ItemName"
        )
        rows = _fetch_all_sap_pages(sap_client, endpoint, "Items")
        items = []
        for row in rows:
            item_code = _get_case_insensitive(row, "ItemCode")
            if not item_code:
                continue
            uom_code, uom_name = _get_item_uom_fields(row)
            item_group_value = _get_case_insensitive(row, "ItemsGroupCode")
            items.append({
                "item_code": item_code,
                "item_name": _get_case_insensitive(row, "ItemName") or item_code,
                "item_group_code": "" if item_group_value is None else str(item_group_value),
                "farm_origin": _get_case_insensitive(row, "U_Brand") or "",
                "raw_material_type": _get_case_insensitive(row, "U_Category") or "",
                "uom_code": uom_code,
                "uom_name": uom_name,
            })
        items.sort(key=lambda item: str(item["item_name"] or "").strip())
        cache_set("sap:scale:items", cache_key, items, "sap_items")
        return JsonResponse({"success": True, "items": items})
    except Exception as exc:
        return JsonResponse({"success": False, "items": [], "error": str(exc)}, status=500)


# ── Scale Draft Workflow APIs ───────────────────────────────────────────────

@api_view(["GET"])
@require_scale_access
def available_purchase_quotations_view(request):
    """
    Read-only API for Weighbridge to discover eligible POSTED Purchase Quotations.
    Allows filtering by vehicle plate and/or vendor card code (farm).
    Excludes quotations that are already matched to an active ScaleDraft.
    """
    queryset = (
        PurchaseQuotationDraft.objects.filter(
            status=PurchaseQuotationDraft.POSTED,
        )
        .exclude(
            sap_doc_entry="",
        )
        .exclude(
            sap_doc_entry__isnull=True,
        )
        .exclude(
            scale_drafts__status__in=[
                ScaleDraft.STATUS_FIRST_WEIGHT,
                ScaleDraft.STATUS_SECOND_WEIGHT_PENDING,
            ],
        )
        .exclude(
            scale_drafts__grpo_drafts__status__in=[
                PurchaseGRPODraft.POSTED,
                PurchaseGRPODraft.APPROVED_FOR_POSTING,
                PurchaseGRPODraft.PENDING_REVIEW,
                PurchaseGRPODraft.DRAFT,
            ],
        )
        .distinct()
    )

    vehicle = _get_clean_param(request, "vehicle")
    if vehicle:
        queryset = queryset.filter(vehicle_number__icontains=vehicle)

    vendor_card_code = _get_clean_param(request, "vendor_card_code")
    if vendor_card_code:
        queryset = queryset.filter(vendor_card_code__icontains=vendor_card_code)

    queryset = queryset.order_by("-posted_at", "-created_at")

    quotations = []
    for draft in queryset[:100]:
        lines = []
        total_quoted_qty = 0.0
        primary_warehouse = ""

        for idx, line in enumerate(draft.lines or []):
            if not isinstance(line, dict):
                continue
            try:
                qty = float(line.get("quoted_qty") or line.get("quantity") or 0)
            except (ValueError, TypeError):
                qty = 0.0
            total_quoted_qty += qty

            line_whs = str(line.get("warehouse_code") or "").strip()
            if not primary_warehouse and line_whs:
                primary_warehouse = line_whs

            lines.append({
                "line_index": idx,
                "item_code": str(line.get("item_code") or "").strip(),
                "item_name": str(line.get("item_description") or line.get("item_name") or "").strip(),
                "quoted_qty": qty,
                "uom_code": str(line.get("uom_code") or "").strip(),
                "warehouse_code": line_whs,
                "container_quantity": line.get("container_quantity") or 0,
            })

        container_qty = draft.container_quantity or 0
        if not container_qty and lines:
            container_qty = lines[0].get("container_quantity") or 0

        quotations.append({
            "id": draft.id,
            "quotation_number": str(draft.sap_doc_num or draft.id),
            "sap_doc_entry": str(draft.sap_doc_entry or ""),
            "vehicle_number": draft.vehicle_number or "",
            "vendor_card_code": draft.vendor_card_code or "",
            "vendor_name": draft.vendor_name or "",
            "quoted_quantity": total_quoted_qty,
            "container_quantity": container_qty,
            "warehouse_code": primary_warehouse,
            "posted_at": draft.posted_at.isoformat() if draft.posted_at else None,
            "lines": lines,
        })

    return JsonResponse({"success": True, "data": quotations})


@api_view(["GET"])
@require_scale_access
def scale_drafts_list_view(request):
    queryset = ScaleDraft.objects.select_related("vehicle", "scale_device", "created_by").prefetch_related("allocations").all()
    requires_distinct = False

    status = request.GET.get("status")
    if status:
        queryset = queryset.filter(status=status)

    is_closed = request.GET.get("is_closed")
    if is_closed in ("true", "1"):
        queryset = queryset.filter(is_closed=True)
    elif is_closed in ("false", "0"):
        queryset = queryset.filter(is_closed=False)

    item_code = request.GET.get("item_code")
    if item_code:
        queryset = queryset.filter(item_code=item_code)

    queryset = _filter_date_range(queryset, request, "created_at", "date_from", "date_to")
    queryset = _filter_date_range(queryset, request, "updated_at", "updated_from", "updated_to")
    queryset = _filter_date_range(queryset, request, "loaded_time", "loaded_from", "loaded_to")
    queryset = _filter_date_range(queryset, request, "empty_time", "empty_from", "empty_to")

    draft_number = _get_clean_param(request, "draft_number")
    if draft_number:
        queryset = queryset.filter(draft_number__icontains=draft_number)

    vehicle_number = _get_clean_param(request, "vehicle_number")
    if vehicle_number:
        queryset = queryset.filter(
            Q(vehicle__vehicle_number__icontains=vehicle_number)
            | Q(direct_vehicle_number__icontains=vehicle_number)
        )

    driver = _get_clean_param(request, "driver")
    if driver:
        queryset = queryset.filter(
            Q(vehicle__driver_name__icontains=driver)
            | Q(vehicle__driver_id__icontains=driver)
            | Q(direct_driver_name__icontains=driver)
        )

    vendor = _get_clean_param(request, "vendor")
    if vendor:
        queryset = queryset.filter(
            Q(vendor_card_code__icontains=vendor)
            | Q(vendor_name__icontains=vendor)
            | Q(allocations__vendor_card_code__icontains=vendor)
            | Q(allocations__vendor_name__icontains=vendor)
        )
        requires_distinct = True

    item = _get_clean_param(request, "item")
    if item:
        queryset = queryset.filter(
            Q(item_code__icontains=item)
            | Q(item_name__icontains=item)
            | Q(allocations__item_code__icontains=item)
            | Q(allocations__item_name__icontains=item)
            | Q(allocations__crop_name__icontains=item)
        )
        requires_distinct = True

    truck_type = _get_clean_param(request, "truck_type")
    if truck_type:
        queryset = queryset.filter(truck_type=truck_type)

    trailer_number = _get_clean_param(request, "trailer_number")
    if trailer_number:
        queryset = queryset.filter(
            Q(trailer_number__icontains=trailer_number)
            | Q(trailers__trailer_number__icontains=trailer_number)
        )
        requires_distinct = True

    container_number = _get_clean_param(request, "container_number")
    if container_number:
        queryset = queryset.filter(
            Q(container_number__icontains=container_number)
            | Q(containers__container_number__icontains=container_number)
        )
        requires_distinct = True

    batch_number = _get_clean_param(request, "batch_number")
    if batch_number:
        queryset = queryset.filter(allocations__batch_number__icontains=batch_number)
        requires_distinct = True

    farm_origin = _get_clean_param(request, "farm_origin")
    if farm_origin:
        queryset = queryset.filter(allocations__farm_origin__icontains=farm_origin)
        requires_distinct = True

    contractor_name = _get_clean_param(request, "contractor_name")
    if contractor_name:
        queryset = queryset.filter(allocations__contractor_name__icontains=contractor_name)
        requires_distinct = True

    raw_material_type = _get_clean_param(request, "raw_material_type")
    if raw_material_type:
        queryset = queryset.filter(allocations__raw_material_type__icontains=raw_material_type)
        requires_distinct = True

    created_by = _get_clean_param(request, "created_by")
    if created_by:
        queryset = queryset.filter(created_by__username__icontains=created_by)

    queryset = _filter_decimal_range(queryset, request, "weight_loaded", "weight_loaded_min", "weight_loaded_max")
    queryset = _filter_decimal_range(queryset, request, "net_weight_loaded", "net_weight_loaded_min", "net_weight_loaded_max")
    queryset = _filter_decimal_range(queryset, request, "weight_empty", "weight_empty_min", "weight_empty_max")
    queryset = _filter_decimal_range(queryset, request, "net_weight_empty", "net_weight_empty_min", "net_weight_empty_max")
    queryset = _filter_decimal_range(queryset, request, "product_weight", "product_weight_min", "product_weight_max")

    search = request.GET.get("search", "").strip()
    if search:
        queryset = queryset.annotate(
            weight_loaded_str=Cast('weight_loaded', CharField()),
            net_weight_loaded_str=Cast('net_weight_loaded', CharField()),
            weight_empty_str=Cast('weight_empty', CharField()),
            net_weight_empty_str=Cast('net_weight_empty', CharField()),
            product_weight_str=Cast('product_weight', CharField()),
        ).filter(
            Q(draft_number__icontains=search)
            | Q(vehicle__vehicle_number__icontains=search)
            | Q(direct_vehicle_number__icontains=search)
            | Q(vehicle__driver_name__icontains=search)
            | Q(vehicle__driver_id__icontains=search)
            | Q(direct_driver_name__icontains=search)
            | Q(vendor_card_code__icontains=search)
            | Q(vendor_name__icontains=search)
            | Q(item_code__icontains=search)
            | Q(item_name__icontains=search)
            | Q(truck_type__icontains=search)
            | Q(trailer_number__icontains=search)
            | Q(container_number__icontains=search)
            | Q(allocations__vendor_name__icontains=search)
            | Q(allocations__vendor_card_code__icontains=search)
            | Q(allocations__item_name__icontains=search)
            | Q(allocations__item_code__icontains=search)
            | Q(allocations__crop_name__icontains=search)
            | Q(allocations__raw_material_type__icontains=search)
            | Q(allocations__batch_number__icontains=search)
            | Q(allocations__farm_origin__icontains=search)
            | Q(allocations__contractor_name__icontains=search)
            | Q(created_by__username__icontains=search)
            | Q(status__icontains=search)
            | Q(weight_loaded_str__icontains=search)
            | Q(net_weight_loaded_str__icontains=search)
            | Q(weight_empty_str__icontains=search)
            | Q(net_weight_empty_str__icontains=search)
            | Q(product_weight_str__icontains=search)
        )
        requires_distinct = True

    if requires_distinct:
        queryset = queryset.distinct()

    serializer = ScaleDraftListSerializer(queryset[:100], many=True)
    return JsonResponse({"success": True, "data": serializer.data})


@api_view(["GET"])
@require_scale_access
def scale_draft_detail_view(request, draft_id):
    try:
        draft = ScaleDraft.objects.select_related(
            "vehicle", "scale_device", "created_by", "closed_by", "permit"
        ).prefetch_related("draft_elements__item_element").get(id=draft_id)
    except ScaleDraft.DoesNotExist:
        return JsonResponse({"success": False, "error": "Scale draft not found"}, status=404)

    return JsonResponse({"success": True, "data": ScaleDraftDetailSerializer(draft).data})


@api_view(["POST"])
@require_scale_access
@audit_mutation(module=MODULE_SCALE, entity_type="ScaleDraft", action=ACTION_WEIGH, log_success=False)
@transaction.atomic
def scale_draft_first_weight_view(request):
    """
    Step 1: Start new scale draft and record first weight (Loaded or Empty).
    """
    data = request.data or {}
    start_type = data.get("start_type", "loaded")
    if start_type not in ("loaded", "empty"):
        start_type = "loaded"

    weight_val, err = _parse_decimal(data.get("weight"), "First weight")
    if err:
        return JsonResponse({"success": False, "error": err}, status=400)
    if weight_val <= Decimal("0.00"):
        return JsonResponse({"success": False, "error": "Weight must be greater than zero"}, status=400)

    # Vehicle resolution
    is_direct_entry = bool(data.get("is_direct_entry", False))
    vehicle_id = data.get("vehicle_id")
    direct_vehicle_number = str(data.get("direct_vehicle_number") or "").strip()
    direct_driver_name = str(data.get("direct_driver_name") or "").strip()

    vehicle = None
    if vehicle_id:
        vehicle = ScaleVehicle.objects.filter(id=vehicle_id).first()
    elif direct_vehicle_number and not is_direct_entry:
        vehicle, _ = ScaleVehicle.objects.get_or_create(
            vehicle_number=direct_vehicle_number,
            defaults={"driver_name": direct_driver_name}
        )

    item_code = str(data.get("item_code") or "").strip()
    item_name = str(data.get("item_name") or "").strip()
    vendor_card_code = str(data.get("vendor_card_code") or "").strip()
    vendor_name = str(data.get("vendor_name") or "").strip()

    device_id = data.get("scale_device_id")
    device = ScaleDevice.objects.filter(id=device_id).first() if device_id else None

    draft_truck_type = vehicle.truck_type if vehicle else str(data.get("truck_type") or "normal").strip()
    
    trailers_data = data.get("trailers", [])
    containers_data = data.get("containers", [])

    draft_trailer_number = ""
    if trailers_data and len(trailers_data) > 0:
        draft_trailer_number = str(trailers_data[0].get("trailer_number") or "").strip()
    elif vehicle:
        last_movement = vehicle.movements.order_by("-entry_time").first()
        if last_movement and last_movement.exit_time is None:
            first_trailer = last_movement.trailers.first()
            if first_trailer:
                draft_trailer_number = first_trailer.trailer_number

    draft_container_number = ""
    if draft_truck_type == "container":
        if containers_data and len(containers_data) > 0:
            draft_container_number = str(containers_data[0].get("container_number") or "").strip()
        elif vehicle:
            last_movement = vehicle.movements.order_by("-entry_time").first()
            if last_movement and last_movement.exit_time is None:
                first_container = last_movement.containers.first()
                if first_container:
                    draft_container_number = first_container.container_number

    # Purchase Quotation Matching (Phase 3)
    if start_type == 'empty' and draft_truck_type == 'container' and not data.get('quotation_id') and not draft_container_number:
        return JsonResponse({'success': False, 'error': 'Container number is required for an outbound empty weighing.'}, status=400)
    quotation_id = data.get("quotation_id")
    quotation = None
    quotation_line_index = 0
    if quotation_id:
        try:
            quotation = PurchaseQuotationDraft.objects.select_for_update().get(id=quotation_id)
        except (PurchaseQuotationDraft.DoesNotExist, ValueError, TypeError):
            return JsonResponse({"success": False, "error": "Selected Purchase Quotation not found."}, status=400)

        if quotation.status != PurchaseQuotationDraft.POSTED:
            return JsonResponse({"success": False, "error": "Purchase Quotation must be POSTED to be matched."}, status=400)

        if not quotation.sap_doc_entry:
            return JsonResponse({"success": False, "error": "Purchase Quotation does not have a valid SAP document reference."}, status=400)

        if quotation.scale_drafts.filter(status__in=[ScaleDraft.STATUS_FIRST_WEIGHT, ScaleDraft.STATUS_SECOND_WEIGHT_PENDING]).exists():
            return JsonResponse({"success": False, "error": "This Purchase Quotation is already linked to an active weighing operation."}, status=409)

        raw_line_index = data.get("quotation_line_index", 0)
        try:
            quotation_line_index = int(raw_line_index)
            if quotation_line_index < 0:
                raise ValueError()
        except (ValueError, TypeError):
            return JsonResponse({"success": False, "error": "Invalid quotation line index."}, status=400)

        lines = quotation.lines or []
        if isinstance(lines, list) and len(lines) > 0:
            if quotation_line_index >= len(lines):
                return JsonResponse({"success": False, "error": f"Quotation line index {quotation_line_index} is out of range."}, status=400)
        elif quotation_line_index != 0:
            return JsonResponse({"success": False, "error": "Invalid quotation line index."}, status=400)

    # Create Draft instance
    draft = ScaleDraft(
        start_type=start_type,
        vehicle=vehicle,
        is_direct_entry=is_direct_entry or (vehicle is None and bool(direct_vehicle_number)),
        direct_vehicle_number=direct_vehicle_number,
        direct_driver_name=direct_driver_name,
        truck_type=draft_truck_type,
        trailer_number=draft_trailer_number,
        container_number=draft_container_number,
        item_code=item_code,
        item_name=item_name,
        vendor_card_code=vendor_card_code,
        vendor_name=vendor_name,
        scale_device=device,
        quotation=quotation,
        quotation_line_index=quotation_line_index,
        status=ScaleDraft.STATUS_SECOND_WEIGHT_PENDING,
        created_by=request.user,
        notes=str(data.get("notes") or ""),
    )

    now = timezone.now()
    if start_type == "loaded":
        draft.weight_loaded = weight_val
        draft.loaded_time = now
    else:
        draft.weight_empty = weight_val
        draft.empty_time = now

    try:
        draft.save()
    except IntegrityError:
        return JsonResponse({"success": False, "error": "This Purchase Quotation is already linked to an active weighing operation."}, status=409)

    # Handle trailers
    if trailers_data:
        for t in trailers_data:
            t_num = str(t.get("trailer_number") or "").strip()
            if t_num:
                ScaleDraftTrailer.objects.create(draft=draft, trailer_number=t_num)
    elif vehicle:
        last_movement = vehicle.movements.order_by("-entry_time").first()
        if last_movement and last_movement.exit_time is None:
            for t in last_movement.trailers.all():
                ScaleDraftTrailer.objects.create(draft=draft, trailer_number=t.trailer_number)

    # Handle containers
    if containers_data and draft_truck_type == "container":
        for c in containers_data:
            c_num = str(c.get("container_number") or "").strip()
            if c_num:
                ScaleDraftContainer.objects.create(draft=draft, container_number=c_num)
    elif vehicle and draft_truck_type == "container":
        last_movement = vehicle.movements.order_by("-entry_time").first()
        if last_movement and last_movement.exit_time is None:
            for c in last_movement.containers.all():
                ScaleDraftContainer.objects.create(draft=draft, container_number=c.container_number)

    # Add Elements for the first stage if supplied
    elements_data = data.get("elements", [])
    if isinstance(elements_data, list):
        for el in elements_data:
            item_element_id = el.get("item_element_id")
            count = int(el.get("count", 1))
            action = el.get("action", "remove")
            if item_element_id and count > 0:
                item_elem = ScaleItemElement.objects.filter(id=item_element_id).first()
                if item_elem:
                    ScaleDraftElement.objects.create(
                        draft=draft,
                        item_element=item_elem,
                        count=count,
                        stage=start_type,
                        action=action,
                        unit_weight=item_elem.weight,
                    )

    # Add initial allocations if supplied, otherwise create default single allocation
    allocations_data = data.get("allocations", [])
    if isinstance(allocations_data, list) and len(allocations_data) > 0:
        draft.is_multi_allocation = len(allocations_data) > 1
        for idx, item in enumerate(allocations_data, start=1):
            ScaleDraftAllocation.objects.create(
                draft=draft,
                line_number=idx,
                vendor_card_code=str(item.get("vendor_card_code") or item.get("supplier_card_code") or "").strip(),
                vendor_name=str(item.get("vendor_name") or item.get("supplier_name") or "").strip(),
                item_code=str(item.get("item_code") or "").strip(),
                item_name=str(item.get("item_name") or "").strip(),
                crop_name=str(item.get("crop_name") or item.get("item_name") or "").strip(),
                raw_material_type=str(item.get("raw_material_type") or "").strip(),
                batch_number=str(item.get("batch_number") or "").strip(),
                farm_origin=str(item.get("farm_origin") or "").strip(),
                contractor_name=str(item.get("contractor_name") or "").strip(),
                notes=str(item.get("notes") or "").strip(),
            )
    elif vendor_name or item_name or vendor_card_code or item_code:
        ScaleDraftAllocation.objects.create(
            draft=draft,
            line_number=1,
            vendor_card_code=vendor_card_code,
            vendor_name=vendor_name,
            item_code=item_code,
            item_name=item_name,
            crop_name=item_name,
        )

    draft.calculate_net_weights()
    draft.save()

    from api.services.shipping_service import create_for_scale
    create_for_scale(draft)

    log_action(
        request=request,
        user=request.user,
        action=ACTION_WEIGH,
        module=MODULE_SCALE,
        entity_type="ScaleDraft",
        entity_id=str(draft.id),
        description=f"Recorded first weight ({weight_val} kg) on scale draft #{draft.draft_number}",
        details={"draft_number": draft.draft_number, "first_weight": float(weight_val)},
    )

    return JsonResponse({
        "success": True,
        "message": f"First weight ({weight_val} kg) recorded on draft #{draft.draft_number}",
        "data": ScaleDraftDetailSerializer(draft).data
    }, status=201)


@api_view(["POST"])
@require_scale_access
@audit_mutation(module=MODULE_SCALE, entity_type="ScaleDraft", action=ACTION_WEIGH, log_success=False)
@transaction.atomic
def scale_draft_second_weight_view(request, draft_id):
    """
    Step 2: Record second weight, calculate net tare adjustments, final certified product net weight,
    and distribute weights across load allocation lines.
    """
    try:
        draft = ScaleDraft.objects.get(id=draft_id)
    except ScaleDraft.DoesNotExist:
        return JsonResponse({"success": False, "error": "Scale draft not found"}, status=404)

    if draft.is_closed and draft.product_weight is not None:
        return JsonResponse({"success": False, "error": "Scale draft is already completed and closed"}, status=400)

    from api.models_shipping import ShippingOperation
    shipping = ShippingOperation.objects.select_for_update().filter(scale_draft=draft).first()
    if shipping and shipping.status != 'READY':
        return JsonResponse({'success': False, 'error': 'Loading manifest must be submitted by Shipping before the second weight.'}, status=409)
    data = dict(request.data or {})
    if shipping:
        if data.get('elements') or data.get('allocations'):
            return JsonResponse({'success': False, 'error': 'Shipping packaging and cargo cannot be edited by the scale operator.'}, status=400)
    weight_val, err = _parse_decimal(data.get("weight"), "Second weight")
    if err:
        return JsonResponse({"success": False, "error": err}, status=400)
    if weight_val <= Decimal("0.00"):
        return JsonResponse({"success": False, "error": "Weight must be greater than zero"}, status=400)

    second_stage = "empty" if draft.start_type == "loaded" else "loaded"
    now = timezone.now()

    if second_stage == "empty":
        draft.weight_empty = weight_val
        draft.empty_time = now
    else:
        draft.weight_loaded = weight_val
        draft.loaded_time = now

    # Add Elements for the second stage if supplied
    elements_data = data.get("elements", [])
    if isinstance(elements_data, list):
        for el in elements_data:
            item_element_id = el.get("item_element_id")
            count = int(el.get("count", 1))
            action = el.get("action", "remove")
            if item_element_id and count > 0:
                item_elem = ScaleItemElement.objects.filter(id=item_element_id).first()
                if item_elem:
                    ScaleDraftElement.objects.create(
                        draft=draft,
                        item_element=item_elem,
                        count=count,
                        stage=second_stage,
                        action=action,
                        unit_weight=item_elem.weight,
                    )

    # Optional updated allocations passed at second weight stage
    allocations_data = data.get("allocations")
    if isinstance(allocations_data, list) and len(allocations_data) > 0:
        draft.allocations.all().delete()
        draft.is_multi_allocation = len(allocations_data) > 1
        for idx, item in enumerate(allocations_data, start=1):
            ScaleDraftAllocation.objects.create(
                draft=draft,
                line_number=idx,
                vendor_card_code=str(item.get("vendor_card_code") or item.get("supplier_card_code") or "").strip(),
                vendor_name=str(item.get("vendor_name") or item.get("supplier_name") or "").strip(),
                item_code=str(item.get("item_code") or "").strip(),
                item_name=str(item.get("item_name") or "").strip(),
                crop_name=str(item.get("crop_name") or item.get("item_name") or "").strip(),
                raw_material_type=str(item.get("raw_material_type") or "").strip(),
                batch_number=str(item.get("batch_number") or "").strip(),
                farm_origin=str(item.get("farm_origin") or "").strip(),
                contractor_name=str(item.get("contractor_name") or "").strip(),
                notes=str(item.get("notes") or "").strip(),
            )
        _sync_draft_item_from_primary_allocation(draft, allocations_data)

    draft.closed_by = request.user
    calc_err = draft.calculate_net_weights()
    if calc_err:
        return JsonResponse({"success": False, "error": calc_err}, status=400)
    if shipping and (draft.product_weight is None or draft.product_weight <= 0):
        return JsonResponse({'success': False, 'error': 'Shipping net weight must be positive.'}, status=400)
    draft.save()
    if shipping:
        from api.services.shipping_service import audit
        shipping.status = 'WEIGHED'
        shipping.revision += 1
        shipping.save()
        audit(shipping, request.user, 'Certified second weight; ready for delivery', request)

    second_weight_value = (
        draft.weight_empty if second_stage == "empty" else draft.weight_loaded
    )

    log_action(
        request=request,
        user=request.user,
        action=ACTION_WEIGH,
        module=MODULE_SCALE,
        entity_type="ScaleDraft",
        entity_id=str(draft.id),
        description=f"Recorded second weight ({second_weight_value} kg) on scale draft #{draft.draft_number}",
        details={
            "draft_number": draft.draft_number,
            "second_weight": float(second_weight_value or 0),
            "product_weight": float(draft.product_weight or 0),
        },
    )

    return JsonResponse({
        "success": True,
        "message": f"Second weight recorded. Product net weight: {draft.product_weight} kg",
        "data": ScaleDraftDetailSerializer(draft).data
    })


@api_view(["POST"])
@require_scale_access
@audit_mutation(module=MODULE_SCALE, entity_type="ScaleDraftElement", action=ACTION_UPDATE)
@transaction.atomic
def scale_draft_elements_view(request, draft_id):
    """Add, update, or remove tare elements for a draft and recalculate net weights."""
    try:
        draft = ScaleDraft.objects.get(id=draft_id)
    except ScaleDraft.DoesNotExist:
        return JsonResponse({"success": False, "error": "Scale draft not found"}, status=404)

    if hasattr(draft, 'shipping_operation'):
        return JsonResponse({'success': False, 'error': 'Outbound packaging is managed by Shipping.'}, status=403)
    if draft.is_certified_locked:
        return JsonResponse({
            "success": False,
            "error": "Scale draft is certified and locked. Tare elements cannot be modified."
        }, status=400)

    data = request.data or {}
    action_type = data.get("action_type", "add_or_update")  # 'add_or_update' or 'delete'

    if action_type == "delete":
        element_id = data.get("draft_element_id")
        ScaleDraftElement.objects.filter(id=element_id, draft=draft).delete()
    else:
        item_element_id = data.get("item_element_id")
        count = int(data.get("count", 1))
        stage = data.get("stage", "loaded")
        action = data.get("action", "remove")

        item_elem = ScaleItemElement.objects.filter(id=item_element_id).first()
        if not item_elem:
            return JsonResponse({"success": False, "error": "Scale item element not found"}, status=404)

        draft_elem, created = ScaleDraftElement.objects.get_or_create(
            draft=draft,
            item_element=item_elem,
            stage=stage,
            defaults={"count": count, "action": action, "unit_weight": item_elem.weight}
        )
        if not created:
            draft_elem.count = count
            draft_elem.action = action
            draft_elem.save()

    calc_err = draft.calculate_net_weights()
    if calc_err and draft.weight_loaded is not None and draft.weight_empty is not None:
        return JsonResponse({"success": False, "error": calc_err}, status=400)
    draft.save()

    return JsonResponse({
        "success": True,
        "data": ScaleDraftDetailSerializer(draft).data
    })


@api_view(["POST"])
@require_scale_access
@audit_mutation(module=MODULE_SCALE, entity_type="ScaleDraftAllocation", action=ACTION_UPDATE)
@transaction.atomic
def scale_draft_allocations_view(request, draft_id):
    """
    Configure and update multi-item / multi-supplier load allocation lines.
    Allocations are purely descriptive data and do not divide the weight.
    """
    try:
        draft = ScaleDraft.objects.get(id=draft_id)
    except ScaleDraft.DoesNotExist:
        return JsonResponse({"success": False, "error": "Scale draft not found"}, status=404)

    if hasattr(draft, 'shipping_operation'):
        return JsonResponse({'success': False, 'error': 'Outbound cargo is managed by Shipping.'}, status=403)
    data = request.data or {}
    allocations_data = data.get("allocations", [])
    if not allocations_data:
        return JsonResponse({"success": False, "error": "At least one allocation line is required"}, status=400)

    # Delete existing allocations and rebuild
    draft.allocations.all().delete()
    created_allocations = []
    draft.is_multi_allocation = len(allocations_data) > 1

    for idx, item in enumerate(allocations_data, start=1):
        alloc = ScaleDraftAllocation(
            draft=draft,
            line_number=idx,
            vendor_card_code=str(item.get("vendor_card_code") or item.get("supplier_card_code") or "").strip(),
            vendor_name=str(item.get("vendor_name") or item.get("supplier_name") or "").strip(),
            item_code=str(item.get("item_code") or "").strip(),
            item_name=str(item.get("item_name") or "").strip(),
            crop_name=str(item.get("crop_name") or item.get("item_name") or "").strip(),
            raw_material_type=str(item.get("raw_material_type") or "").strip(),
            batch_number=str(item.get("batch_number") or "").strip(),
            farm_origin=str(item.get("farm_origin") or "").strip(),
            contractor_name=str(item.get("contractor_name") or "").strip(),
            notes=str(item.get("notes") or "").strip(),
        )
        created_allocations.append(alloc)

    ScaleDraftAllocation.objects.bulk_create(created_allocations)
    _sync_draft_item_from_primary_allocation(draft, allocations_data)

    draft.save()

    return JsonResponse({
        "success": True,
        "message": "Allocations configured and distributed successfully",
        "data": ScaleDraftDetailSerializer(draft).data
    })



@api_view(["POST"])
@require_scale_access
@audit_mutation(module=MODULE_SCALE, entity_type="ScaleDraft", action=ACTION_APPROVE, log_success=False)
def scale_draft_send_to_quality_view(request, draft_id):
    """Marks the scale draft as completed and transferred to Quality Inspection."""
    try:
        draft = ScaleDraft.objects.get(id=draft_id)
    except ScaleDraft.DoesNotExist:
        return JsonResponse({"success": False, "error": "Scale draft not found"}, status=404)

    if hasattr(draft, 'shipping_operation'):
        return JsonResponse({'success': False, 'error': 'Outbound shipments are handed to Delivery, not Quality.'}, status=400)
    if not draft.is_closed or draft.product_weight is None or draft.product_weight <= Decimal("0.00"):
        return JsonResponse({
            "success": False,
            "error": "Draft must have both weights completed and valid product weight before sending to Quality"
        }, status=400)

    draft.status = ScaleDraft.STATUS_SENT_TO_QUALITY
    draft.save()

    log_action(
        request=request,
        user=request.user,
        action=ACTION_APPROVE,
        module=MODULE_SCALE,
        entity_type="ScaleDraft",
        entity_id=str(draft.id),
        description=f"Sent scale draft #{draft.draft_number} to Quality inspection",
        details={"draft_number": draft.draft_number, "product_weight": float(draft.product_weight or 0)},
    )

    return JsonResponse({
        "success": True,
        "message": f"Draft #{draft.draft_number} successfully marked as ready for Quality inspection",
        "data": ScaleDraftDetailSerializer(draft).data
    })


@api_view(["POST"])
@require_scale_access
@audit_mutation(module=MODULE_SCALE, entity_type="ScaleDraft", action=ACTION_CANCEL, log_success=False)
@transaction.atomic
def scale_draft_cancel_view(request, draft_id):
    """Cancels a scale draft."""
    try:
        draft = ScaleDraft.objects.get(id=draft_id)
    except ScaleDraft.DoesNotExist:
        return JsonResponse({"success": False, "error": "Scale draft not found"}, status=404)

    from api.models_shipping import ShippingOperation
    shipping = ShippingOperation.objects.select_for_update().filter(scale_draft=draft).first()
    if shipping and shipping.pallets.filter(loading_event__isnull=False).exists():
        return JsonResponse({'success': False, 'error': 'A loaded outbound shipment cannot be cancelled from the scale.'}, status=409)
    if draft.quality_inspections.exists():
        return JsonResponse({
            "success": False,
            "error": "Cannot cancel draft because quality inspections have already been created for it"
        }, status=400)

    draft.status = ScaleDraft.STATUS_CANCELLED
    draft.is_closed = True
    draft.notes = f"{draft.notes}\n[Cancelled by {request.user.username} at {timezone.now().isoformat()}]"
    draft.save()

    log_action(
        request=request,
        user=request.user,
        action=ACTION_CANCEL,
        module=MODULE_SCALE,
        entity_type="ScaleDraft",
        entity_id=str(draft.id),
        description=f"Cancelled scale draft #{draft.draft_number}",
        details={"draft_number": draft.draft_number},
    )

    return JsonResponse({
        "success": True,
        "message": f"Draft #{draft.draft_number} cancelled",
        "data": ScaleDraftDetailSerializer(draft).data
    })


# ── Quality Integration API ─────────────────────────────────────────────────

@api_view(["GET"])
@require_scale_or_quality_access
def quality_pending_scale_drafts_view(request):
    """
    Dedicated endpoint for Quality Inspection module to retrieve completed scale drafts ready for inspection.
    """
    queryset = ScaleDraft.objects.filter(
        is_closed=True,
        shipping_operation__isnull=True,
        product_weight__gt=Decimal("0.00"),
        status__in=[ScaleDraft.STATUS_COMPLETED, ScaleDraft.STATUS_SENT_TO_QUALITY]
    ).select_related("vehicle", "created_by").prefetch_related("allocations").order_by("-updated_at")

    results = []
    for draft in queryset[:50]:
        allocations = [
            {
                "id": allocation.id,
                "line_number": allocation.line_number,
                "vendor_card_code": allocation.vendor_card_code,
                "vendor_name": allocation.vendor_name,
                "item_code": allocation.item_code,
                "item_name": allocation.item_name,
                "crop_name": allocation.crop_name,
                "raw_material_type": allocation.raw_material_type,
                "batch_number": allocation.batch_number,
                "farm_origin": allocation.farm_origin,
                "contractor_name": allocation.contractor_name,
            }
            for allocation in draft.allocations.all()
        ]
        primary_allocation = allocations[0] if allocations else {}
        results.append({
            "scale_draft_id": draft.id,
            "draft_number": draft.draft_number,
            "vehicle_number": draft.effective_vehicle_number,
            "driver_name": draft.effective_driver_name,
            "item_code": draft.item_code,
            "item_name": draft.item_name,
            "vendor_card_code": draft.vendor_card_code,
            "vendor_name": draft.vendor_name,
            "start_type": draft.start_type,
            "weight_loaded": float(draft.weight_loaded or 0),
            "net_weight_loaded": float(draft.net_weight_loaded or 0),
            "loaded_time": draft.loaded_time.isoformat() if draft.loaded_time else None,
            "weight_empty": float(draft.weight_empty or 0),
            "net_weight_empty": float(draft.net_weight_empty or 0),
            "empty_time": draft.empty_time.isoformat() if draft.empty_time else None,
            "product_weight": float(draft.product_weight or 0),
            "allocations": allocations,
            "batches": allocations,
            "farm_origin": primary_allocation.get("farm_origin", ""),
            "raw_material_type": primary_allocation.get("raw_material_type", ""),
            "contractor_name": primary_allocation.get("contractor_name", ""),
            "has_existing_inspections": draft.quality_inspections.exists(),
            "created_at": draft.created_at.isoformat(),
            "updated_at": draft.updated_at.isoformat(),
        })

    return JsonResponse({"success": True, "data": results})


# ── Virtual Scale Simulator APIs ───────────────────────────────────────────

@api_view(["POST"])
@require_scale_access
def scale_simulator_set_view(request):
    """
    Development & Testing API to manually set simulated scale weight and flags.
    Restricted to virtual scale devices so it never interferes with physical scale devices.
    """
    data = request.data or {}
    device_id = str(data.get("device_id") or "scale_virtual_001").strip()
    device_name = str(data.get("device_name") or "Virtual Scale Simulator").strip()
    location = str(data.get("location") or "Development / Testing Lab").strip()

    raw_weight = data.get("weight", 0.0)
    weight, err = _parse_decimal(raw_weight, "weight")
    if err:
        return JsonResponse({"success": False, "error": err}, status=400)

    is_stable = bool(data.get("is_stable", True))
    is_online = bool(data.get("is_online", True))
    error_msg = data.get("error")

    # Safety check: prevent overriding physical devices with simulator
    existing_device = ScaleDevice.objects.filter(device_id=device_id).first()
    if existing_device and existing_device.device_type != "virtual":
        return JsonResponse({
            "success": False,
            "error": f"Device '{device_id}' is registered as a physical '{existing_device.device_type}' device. Simulator cannot override physical hardware devices."
        }, status=400)

    # Ensure virtual device exists in DB
    device, _ = ScaleDevice.objects.get_or_create(
        device_id=device_id,
        defaults={
            "device_name": device_name,
            "device_type": "virtual",
            "location": location,
            "is_active": True,
            "last_seen": timezone.now() if is_online else None,
        }
    )

    if is_online:
        device.last_seen = timezone.now()
        device.save(update_fields=["last_seen"])

    result = scale_reader_service.record_virtual_reading(
        device_id=device_id,
        weight=weight,
        is_stable=is_stable,
        is_online=is_online,
        device_name=device.device_name,
        location=device.location,
        error=error_msg,
    )

    return JsonResponse({
        "success": True,
        "message": f"Virtual scale reading updated for '{device_id}'",
        "data": result,
    })


@api_view(["GET"])
@require_scale_access
def scale_simulator_status_view(request):
    """Returns virtual scale devices and their live simulation states."""
    virtual_devices = ScaleDevice.objects.filter(device_type="virtual")
    results = []
    for dev in virtual_devices:
        live = scale_reader_service.get_live_reading(dev.device_id)
        results.append({
            "device_id": dev.device_id,
            "device_name": dev.device_name,
            "location": dev.location,
            "live_state": live,
        })
    return JsonResponse({"success": True, "data": results})


# ── Receipts (إيصال الاستلام) ───────────────────────────────────────────────

@api_view(["GET", "POST"])
@require_scale_access
@audit_mutation(module=MODULE_SCALE, entity_type="ScaleReceipt", methods=("POST",))
def scale_receipts_collection(request):
    if request.method == "GET":
        queryset = ScaleReceipt.objects.select_related("created_by").prefetch_related("items")
        search = request.GET.get("search", "").strip()
        if search:
            queryset = queryset.filter(
                Q(receipt_number__icontains=search)
                | Q(vehicle_number__icontains=search)
                | Q(driver_name__icontains=search)
                | Q(supplier_name__icontains=search)
            )
        receipts = list(queryset.order_by("-created_at")[:100])
        return JsonResponse({"success": True, "data": ScaleReceiptSerializer(receipts, many=True).data})

    serializer = ScaleReceiptSerializer(data=request.data)
    if not serializer.is_valid():
        return JsonResponse({"success": False, "errors": serializer.errors}, status=400)

    receipt = serializer.save()
    receipt.created_by = request.user
    receipt.save(update_fields=["created_by"])
    return JsonResponse({"success": True, "data": ScaleReceiptSerializer(receipt).data}, status=201)


@api_view(["GET", "PUT", "DELETE"])
@require_scale_access
@audit_mutation(module=MODULE_SCALE, entity_type="ScaleReceipt")
def scale_receipt_detail(request, receipt_id):
    try:
        receipt = ScaleReceipt.objects.get(id=receipt_id)
    except ScaleReceipt.DoesNotExist:
        return JsonResponse({"success": False, "error": "Scale receipt not found"}, status=404)

    if request.method == "GET":
        return JsonResponse({"success": True, "data": ScaleReceiptSerializer(receipt).data})

    if request.method == "DELETE":
        receipt.delete()
        return JsonResponse({"success": True, "message": "Scale receipt deleted successfully"})

    serializer = ScaleReceiptSerializer(receipt, data=request.data, partial=True)
    if not serializer.is_valid():
        return JsonResponse({"success": False, "errors": serializer.errors}, status=400)

    updated = serializer.save()
    return JsonResponse({"success": True, "data": ScaleReceiptSerializer(updated).data})


@api_view(["GET", "POST"])
@require_scale_access
@audit_mutation(module=MODULE_SCALE, entity_type="ScaleEntryExitPermit", methods=("POST",))
def scale_entry_exit_permits_collection(request):
    if request.method == "GET":
        queryset = ScaleEntryExitPermit.objects.select_related("created_by").prefetch_related("items")
        permit_type = request.GET.get("permit_type", "").strip()
        if permit_type in ("entry", "exit"):
            queryset = queryset.filter(permit_type=permit_type)
        search = request.GET.get("search", "").strip()
        if search:
            queryset = queryset.filter(
                Q(permit_number__icontains=search)
                | Q(vehicle_number__icontains=search)
                | Q(driver_name__icontains=search)
                | Q(supplier_name__icontains=search)
                | Q(buyer_name__icontains=search)
            )
        permits = list(queryset.order_by("-created_at")[:100])
        return JsonResponse({"success": True, "data": ScaleEntryExitPermitSerializer(permits, many=True).data})

    serializer = ScaleEntryExitPermitSerializer(data=request.data)
    if not serializer.is_valid():
        return JsonResponse({"success": False, "errors": serializer.errors}, status=400)

    permit = serializer.save()
    permit.created_by = request.user
    permit.save(update_fields=["created_by"])
    return JsonResponse({"success": True, "data": ScaleEntryExitPermitSerializer(permit).data}, status=201)


@api_view(["GET", "PUT", "DELETE"])
@require_scale_access
@audit_mutation(module=MODULE_SCALE, entity_type="ScaleEntryExitPermit")
def scale_entry_exit_permit_detail(request, permit_id):
    try:
        permit = ScaleEntryExitPermit.objects.get(id=permit_id)
    except ScaleEntryExitPermit.DoesNotExist:
        return JsonResponse({"success": False, "error": "Entry/exit permit not found"}, status=404)

    if request.method == "GET":
        return JsonResponse({"success": True, "data": ScaleEntryExitPermitSerializer(permit).data})

    if request.method == "DELETE":
        permit.delete()
        return JsonResponse({"success": True, "message": "Entry/exit permit deleted successfully"})

    serializer = ScaleEntryExitPermitSerializer(permit, data=request.data, partial=True)
    if not serializer.is_valid():
        return JsonResponse({"success": False, "errors": serializer.errors}, status=400)

    updated = serializer.save()
    return JsonResponse({"success": True, "data": ScaleEntryExitPermitSerializer(updated).data})
