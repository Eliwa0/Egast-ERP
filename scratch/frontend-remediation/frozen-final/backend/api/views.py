import os
from .services.transfer_destination_bins import DestinationSAPBinError

import time

import datetime

import requests as _requests

from functools import wraps

from contextlib import contextmanager, nullcontext

from pathlib import Path



from django.contrib.auth import authenticate, login, logout

from django.contrib.auth.models import User

from django.db import connection, transaction, IntegrityError, OperationalError

from django.db.models import Max, Q, Sum

from django.http import JsonResponse

from django.views.decorators.csrf import csrf_exempt

from rest_framework.decorators import api_view

from rest_framework.response import Response

from rest_framework import status

from .models import (

    UserProfile, ProductionOrderAttributeRule, UserAttributeRule,

    WarehouseAttributeVisibilityRule, ProductionOrderVisibilityRule,

    BatchNumberReservation, PendingReceipt, PendingReceiptBatch,

    PostedBatchExtraReceipt, TransferWarehouseRule, PendingTransferRequest,
    PendingTransferBatchGuard,
    TransferPositionReconciliation, UserModulePermission,

)

from .services.sap_service import SAPServiceLayer, _append_live_receipt_trace

from .services.cache_service import (

    build_cache_key,

    cache_get,

    cache_set,

    sap_master_namespace,

)

from .services.audit_service import (
    audit_mutation,
    log_action,
    MODULE_AUTH,
    MODULE_USERS,
    MODULE_TRANSFER,
    MODULE_COLD_STORAGE,
    MODULE_PRODUCTION_RECEIPT,
    MODULE_RULES,
    ACTION_LOGIN,
    ACTION_LOGOUT,
    ACTION_CREATE,
    ACTION_UPDATE,
    ACTION_DELETE,
    ACTION_POST,
    ACTION_APPROVE,
    ACTION_REJECT,
    ACTION_CANCEL,
    ACTION_RESERVE,
    ACTION_RELEASE,
    ACTION_OCCUPY,
    ACTION_VACATE,
    ACTION_CONFIGURE,
    ACTION_RECONCILE,
)

from .services.transfer_service import (

    TransferBatchNotFound,

    TransferInventoryService,

    TransferValidationError,

    DefinitiveSAPPostingFailure,

    DestinationPositionConflict,

)

from .role_permissions import (

    ROLE_ADMIN,

    ROLE_PRODUCTION_USER,

    ROLE_TRANSFER_USER,

    MODULE_DEFINITIONS,

    MODULE_PRODUCTION as PERMISSION_MODULE_PRODUCTION,

    MODULE_TRANSFER as PERMISSION_MODULE_TRANSFER,

    MODULES,

    LEVEL_USER,

    LEVEL_ADMIN,

    VALID_ROLES,

    can_access_production,

    can_access_transfer,

    can_create_user_role,

    can_manage_production,

    can_manage_transfer,

    can_manage_user,

    can_manage_users,

    get_user_role,

    get_module_permissions,

    has_module_level,

    is_module_admin,

    is_super_admin,

    manageable_users_filter,

    normalize_role as normalize_user_role,

)

import json



sap = SAPServiceLayer()

transfer_service = TransferInventoryService(sap_client=sap)

_BATCH_NUMBER_LOCK_DIR = (

    Path(__file__).resolve().parents[1] / "runtime" / "batch_number_locks"

)

_MAX_BATCH_CONFLICT_RETRIES = 100



# SAP metadata option caches are backed by Django's configured cache backend.





def _cache_get(key, ttl=None):

    cached = cache_get(build_cache_key("sap:batch-udf-metadata", key))

    return cached, cached is not None





def _cache_set(key, data):

    cache_set(

        "sap:batch-udf-metadata",

        build_cache_key("sap:batch-udf-metadata", key),

        data,

        "batch_udf_metadata",

    )

    return data





def format_success_response(data, message=None):

    return Response({"success": True, "message": message, "data": data})





def format_error_response(error, status_code=status.HTTP_500_INTERNAL_SERVER_ERROR):

    return Response({"success": False, "error": str(error)}, status=status_code)





def _clean_value(value):

    if value is None:

        return None

    if isinstance(value, str):

        value = value.strip()

        if value in {"-1", "N/A", "n/a", "null", "None"}:

            return None

        return value or None

    if isinstance(value, (int, float)) and value == -1:

        return None

    return value





def _collect_item_udfs(item_data):

    udf_values = {}



    raw_udf = item_data.get("UDF")

    if isinstance(raw_udf, dict):

        udf_values.update(raw_udf)



    for key, value in item_data.items():

        if isinstance(key, str) and key.startswith("U_"):

            udf_values[key] = value



    return udf_values





def _pick_first_value(*sources):

    for source in sources:

        value = _clean_value(source)

        if value is not None:

            return value

    return ""





# ── auth helpers ──────────────────────────────────────────────────────────────



def _is_admin_user(user):

    return is_module_admin(user)





def _normalize_role(role):

    return normalize_user_role(role)





def _get_user_role(user):

    return get_user_role(user)





def _role_allowed(user, allowed_roles):

    normalized_allowed = {_normalize_role(role) for role in allowed_roles}
    checks = []
    if ROLE_ADMIN in normalized_allowed:
        checks.append(is_super_admin(user))
    if ROLE_PRODUCTION_USER in normalized_allowed:
        checks.append(can_access_production(user))
    if ROLE_TRANSFER_USER in normalized_allowed:
        checks.append(can_access_transfer(user))
    return any(checks)





def _require_admin(request):

    if not request.user.is_authenticated:

        return JsonResponse({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return JsonResponse({"success": False, "error": "Admin only"}, status=403)

    return None





def _require_super_admin(request):

    if not request.user.is_authenticated:

        return JsonResponse({"success": False, "error": "Authentication required"}, status=401)

    if not is_super_admin(request.user):

        return JsonResponse({"success": False, "error": "Super Admin only"}, status=403)

    return None





def _require_user_management(request):

    if not request.user.is_authenticated:

        return JsonResponse({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_users(request.user):

        return JsonResponse({"success": False, "error": "User management access required"}, status=403)

    return None





def _require_production_admin(request):

    if not request.user.is_authenticated:

        return JsonResponse({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return JsonResponse({"success": False, "error": "Production admin access required"}, status=403)

    return None





def _require_transfer_admin(request):

    if not request.user.is_authenticated:

        return JsonResponse({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_transfer(request.user):

        return JsonResponse({"success": False, "error": "Transfer admin access required"}, status=403)

    return None





def _require_roles(request, allowed_roles, message="Permission denied"):

    if not request.user.is_authenticated:

        return JsonResponse({"success": False, "error": "Authentication required"}, status=401)

    if not _role_allowed(request.user, allowed_roles):

        return JsonResponse({"success": False, "error": message}, status=403)

    return None





def require_production_access(view_func):

    @wraps(view_func)

    def wrapped(request, *args, **kwargs):

        guard = _require_roles(

            request,

            {"admin", "production"},

            "Production access required",

        )

        if guard:

            return guard

        return view_func(request, *args, **kwargs)

    wrapped.csrf_exempt = getattr(view_func, "csrf_exempt", False)

    return wrapped





def require_transfer_access(view_func):

    @wraps(view_func)

    def wrapped(request, *args, **kwargs):

        guard = _require_roles(

            request,

            {"admin", "transfer"},

            "Transfer access required",

        )

        if guard:

            return guard

        return view_func(request, *args, **kwargs)

    wrapped.csrf_exempt = getattr(view_func, "csrf_exempt", False)

    return wrapped





def require_admin_access(view_func):

    @wraps(view_func)

    def wrapped(request, *args, **kwargs):

        guard = _require_admin(request)

        if guard:

            return guard

        return view_func(request, *args, **kwargs)

    wrapped.csrf_exempt = getattr(view_func, "csrf_exempt", False)

    return wrapped





def require_super_admin_access(view_func):

    @wraps(view_func)

    def wrapped(request, *args, **kwargs):

        guard = _require_super_admin(request)

        if guard:

            return guard

        return view_func(request, *args, **kwargs)

    wrapped.csrf_exempt = getattr(view_func, "csrf_exempt", False)

    return wrapped





def require_user_management_access(view_func):

    @wraps(view_func)

    def wrapped(request, *args, **kwargs):

        guard = _require_user_management(request)

        if guard:

            return guard

        return view_func(request, *args, **kwargs)

    wrapped.csrf_exempt = getattr(view_func, "csrf_exempt", False)

    return wrapped





def require_production_admin_access(view_func):

    @wraps(view_func)

    def wrapped(request, *args, **kwargs):

        guard = _require_production_admin(request)

        if guard:

            return guard

        return view_func(request, *args, **kwargs)

    wrapped.csrf_exempt = getattr(view_func, "csrf_exempt", False)

    return wrapped





def require_transfer_admin_access(view_func):

    @wraps(view_func)

    def wrapped(request, *args, **kwargs):

        guard = _require_transfer_admin(request)

        if guard:

            return guard

        return view_func(request, *args, **kwargs)

    wrapped.csrf_exempt = getattr(view_func, "csrf_exempt", False)

    return wrapped





def _user_to_dict(u):

    p = getattr(u, "userprofile", None)

    return {

        "id": u.id,

        "username": u.username,

        "role": _get_user_role(u),

        "module_permissions": get_module_permissions(u),

        "warehouse": p.warehouse if p else "",

        "is_active": u.is_active,

        "date_joined": u.date_joined.strftime("%Y-%m-%d") if u.date_joined else None,

    }





def _get_profile(user):

    try:

        return user.userprofile

    except UserProfile.DoesNotExist:

        return None





def _authenticated_actor(request):

    user = getattr(request, "user", None)

    if user and user.is_authenticated:

        return user

    return None





def _trace_rule_endpoint(request, endpoint, started_at=None, **extra):

    """Temporary production-rule tracing. Remove after the intermittent rules issue is found."""

    elapsed = ""

    if started_at is not None:

        elapsed = f" elapsed_ms={(time.perf_counter() - started_at) * 1000:.1f}"

    user = getattr(request, "user", None)

    username = user.username if user and user.is_authenticated else "anonymous"

    user_id = user.id if user and user.is_authenticated else None

    profile = _get_profile(user) if user and user.is_authenticated else None

    role = _get_user_role(user) if user and user.is_authenticated else ""

    profile_warehouse = profile.warehouse if profile else ""

    suffix = " ".join(f"{key}={value!r}" for key, value in extra.items())

    print(

        f"[RULE-TRACE][BE][{endpoint}]{elapsed} "

        f"user={username!r} user_id={user_id!r} role={role!r} "

        f"profile_warehouse={profile_warehouse!r} {suffix}"

    )





@csrf_exempt

@api_view(['POST'])

def login_view(request):

    username = request.data.get('username', '').strip()

    password = request.data.get('password', '')

    if not username or not password:

        return format_error_response('Username and password are required', status.HTTP_400_BAD_REQUEST)

    user = authenticate(request, username=username, password=password)

    if user is None:
        log_action(
            request=request,
            action=ACTION_LOGIN,
            module=MODULE_AUTH,
            entity_type="User",
            entity_id=username,
            status="FAILED",
            description=f"Failed login attempt for username: {username}",
            details={"attempted_username": username},
        )
        return format_error_response('Invalid username or password', status.HTTP_401_UNAUTHORIZED)

    login(request, user)

    profile = _get_profile(user)

    role = _get_user_role(user)

    warehouse = profile.warehouse if profile else ''

    log_action(
        request=request,
        user=user,
        action=ACTION_LOGIN,
        module=MODULE_AUTH,
        entity_type="User",
        entity_id=str(user.id),
        description=f"User {user.username} logged in successfully",
        details={"username": user.username, "role": role, "warehouse": warehouse},
    )

    return format_success_response(_user_to_dict(user))





@api_view(['GET'])

def me_view(request):

    actor = _authenticated_actor(request)

    if not actor:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    return format_success_response(_user_to_dict(actor))





@api_view(['POST'])

def logout_view(request):

    current_user = request.user if getattr(request, "user", None) and request.user.is_authenticated else None
    if current_user:
        log_action(
            request=request,
            user=current_user,
            action=ACTION_LOGOUT,
            module=MODULE_AUTH,
            entity_type="User",
            entity_id=str(current_user.id),
            description=f"User {current_user.username} logged out",
            details={"username": current_user.username},
        )

    logout(request)

    return format_success_response({'message': 'Logged out'})





@csrf_exempt

@api_view(['POST'])
@audit_mutation(module=MODULE_USERS, entity_type="User", action=ACTION_CREATE, log_success=False)
def create_user_view(request):

    import traceback



    # ── diagnostic logs (always print, even before touching request.user) ────

    print("[CREATE-USER] method=", request.method)

    print("[CREATE-USER] user=", request.user)

    print("[CREATE-USER] authenticated=", request.user.is_authenticated)

    print("[CREATE-USER] superuser=", getattr(request.user, 'is_superuser', False))

    print("[CREATE-USER] data=", request.data)

    try:

        _role = request.user.userprofile.role

    except Exception:

        _role = None

    print("[CREATE-USER] userprofile.role=", _role)



    # ── permission check ─────────────────────────────────────────────────────

    if not request.user.is_authenticated:

        print("[CREATE-USER] DENIED: not authenticated")

        return format_error_response('Authentication required', status.HTTP_401_UNAUTHORIZED)



    can_manage = can_manage_users(request.user)

    print("[CREATE-USER] can_manage_users=", can_manage)



    if not can_manage:

        print("[CREATE-USER] DENIED: no user management access")

        return format_error_response('Only admin users can create users', status.HTTP_403_FORBIDDEN)



    # ── validate payload ─────────────────────────────────────────────────────

    username = request.data.get('username', '').strip()

    password = request.data.get('password', '')

    warehouse = request.data.get('warehouse', '').strip()

    default_role = ROLE_PRODUCTION_USER if can_manage_production(request.user) else ROLE_TRANSFER_USER

    role = _normalize_role(request.data.get('role', default_role))

    raw_module_permissions = request.data.get('module_permissions', {})

    print(f"[CREATE-USER] payload username={username!r} warehouse={warehouse!r} role={role!r}")



    if not username or not password:

        return format_error_response('Username and password are required', status.HTTP_400_BAD_REQUEST)

    if role not in VALID_ROLES:

        return format_error_response('Invalid role', status.HTTP_400_BAD_REQUEST)

    if not can_create_user_role(request.user, role):

        return format_error_response('You cannot create users with this role', status.HTTP_403_FORBIDDEN)

    if User.objects.filter(username=username).exists():

        return format_error_response(f'Username "{username}" already exists', status.HTTP_400_BAD_REQUEST)

    if raw_module_permissions and not is_super_admin(request.user):

        return format_error_response('Only super admins can assign module permissions', status.HTTP_403_FORBIDDEN)

    if not isinstance(raw_module_permissions, dict):

        return format_error_response('module_permissions must be an object', status.HTTP_400_BAD_REQUEST)

    allowed_inline_modules = set(MODULES)

    if set(raw_module_permissions) - allowed_inline_modules:

        return format_error_response('Invalid inline module permission', status.HTTP_400_BAD_REQUEST)

    normalized_inline_permissions = {

        module: str(level).upper()

        for module, level in raw_module_permissions.items()

        if str(level).upper() in {LEVEL_USER, LEVEL_ADMIN}

    }

    if any(str(level).upper() not in {'', 'NONE', LEVEL_USER, LEVEL_ADMIN} for level in raw_module_permissions.values()):

        return format_error_response('Invalid module permission level', status.HTTP_400_BAD_REQUEST)



    # ── create ───────────────────────────────────────────────────────────────

    try:

        with transaction.atomic():

            new_user = User.objects.create_user(username=username, password=password)

            new_profile, _ = UserProfile.objects.get_or_create(user=new_user)

            new_profile.warehouse = warehouse

            new_profile.role = role

            new_profile.module_permissions_initialized = True

            new_profile.save()

            UserModulePermission.objects.bulk_create([
                UserModulePermission(user=new_user, module=module, level=level)
                for module, level in normalized_inline_permissions.items()
            ])

        print(f"[CREATE-USER] OK username={username} role={role} warehouse={warehouse}")

        log_action(
            request=request,
            user=request.user,
            action=ACTION_CREATE,
            module=MODULE_USERS,
            entity_type="User",
            entity_id=str(new_user.id),
            description=f"Created user {new_user.username} ({role})",
            details={"username": new_user.username, "role": role, "warehouse": warehouse},
        )

        return format_success_response(_user_to_dict(new_user))

    except Exception as exc:

        print(f"[CREATE-USER] EXCEPTION: {exc}")

        print(traceback.format_exc())

        return format_error_response(str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)





def _pick_from_aliases(item_data, udf_values, aliases):

    direct_candidates = [item_data.get(alias) for alias in aliases]

    udf_candidates = [

        value

        for key, value in udf_values.items()

        if any(alias.lower() in key.lower() for alias in aliases)

    ]

    return _pick_first_value(*direct_candidates, *udf_candidates)





def _build_batch_udf_payload(batch):

    field_map = {

        "size": "U_Size",

        "brand": "U_Brand",

        "uom": "U_UOM",

        "vendor": "U_vendor",

        "part": "U_Part",

        "category": "U_Category",

        "packing": "U_Packing",

        "season": "U_Season",

        "extraSpecification": "U_Specification",

        "number": "U_Number",

        "company": "U_Company",

    }



    udf_payload = {}

    for source_key, udf_key in field_map.items():

        value = _clean_value(batch.get(source_key))

        if value is not None:

            udf_payload[udf_key] = value



    return udf_payload





def _build_batch_standard_payload(batch):

    standard_payload = {}



    details_value = _clean_value(

        batch.get("details") or batch.get("Details") or batch.get("notes")

    )

    if details_value is not None:

        # SAP Service Layer exposes the saved value back as Notes on BatchNumbers.

        standard_payload["Notes"] = details_value



    return standard_payload





def _normalize_sap_date(value):

    cleaned = _clean_value(value)

    if cleaned is None:

        return None



    if isinstance(cleaned, str):

        text = cleaned.strip()

        if "T" in text:

            text = text.split("T", 1)[0]

        if " " in text:

            text = text.split(" ", 1)[0]

        return text



    return str(cleaned)





def _coerce_bool(value):

    if isinstance(value, bool):

        return value



    cleaned = _clean_value(value)

    if cleaned is None:

        return None



    if isinstance(cleaned, str):

        normalized = cleaned.lower()

        if normalized in {"1", "true", "yes", "y", "on"}:

            return True

        if normalized in {"0", "false", "no", "n", "off"}:

            return False



    return bool(cleaned)





def _get_production_order_number(receipt_data, production_order, fallback_doc_entry):

    return str(

        _pick_first_value(

            receipt_data.get("ProductionOrderNumber"),

            production_order.get("DocumentNumber"),

            production_order.get("ProductionOrderNumber"),

            production_order.get("DocNum"),

            fallback_doc_entry,

        )

    )





def _build_batch_number(batch_prefix, suffix):

    return f"{batch_prefix}-{suffix}"





def _manual_batch_suffix(order_num, batch_number):

    import re as _re

    order_str = str(order_num or "").strip()

    batch_text = str(batch_number or "").strip()

    if not order_str or not batch_text:

        return None

    match = _re.match(rf"^{_re.escape(order_str)}-(\d+)$", batch_text)

    return int(match.group(1)) if match else None





def _batch_number_exists_anywhere(batch_number):

    batch_text = str(batch_number or "").strip()

    if not batch_text:

        return False

    if PendingReceiptBatch.objects.filter(batch_number=batch_text).exists():

        return True

    if BatchNumberReservation.objects.filter(batch_number=batch_text).exists():

        return True

    try:

        safe_batch = batch_text.replace("'", "''")

        sql_code = "CODX_OBTN_BATCH_EXISTS"

        sql_text = (

            'SELECT TOP 1 "DistNumber" AS "BatchNumber" FROM "OBTN" '

            'WHERE "DistNumber" = :batchNumber'

        )

        sap.ensure_sql_query(sql_code, "OBTN exact batch number lookup", sql_text)

        result = sap.execute_sql_query(sql_code, f"batchNumber='{safe_batch}'")

        return bool(result.get("value"))

    except Exception:

        return False





def _extract_batch_number_suffix(batch_number, batch_prefix):

    cleaned_batch_number = _clean_value(batch_number)

    cleaned_prefix = _clean_value(batch_prefix)

    if cleaned_batch_number is None or cleaned_prefix is None:

        return None



    batch_number_text = str(cleaned_batch_number)

    prefix_text = f"{cleaned_prefix}-"

    if not batch_number_text.startswith(prefix_text):

        return None



    suffix_text = batch_number_text[len(prefix_text) :].strip()

    if not suffix_text.isdigit():

        return None



    return int(suffix_text)





def _get_existing_batch_numbers_for_order(batch_prefix, item_code=None):

    """

    Return all OBTN batch numbers that start with '{batch_prefix}-'.

    When item_code is supplied the SQL is scoped to that item so batches from

    unrelated items that share the same numeric prefix are excluded.

    """

    cleaned_prefix = _clean_value(batch_prefix)

    if cleaned_prefix is None:

        return []



    safe_prefix = str(cleaned_prefix).replace("'", "''")

    prefix_pattern = f"{safe_prefix}-%"



    if item_code:

        safe_item = str(item_code).replace("'", "''")

        sql_code = "CODX_ORDER_BATCH_NUMS_BY_ITEM"

        sql_text = (

            'SELECT "DistNumber" AS "BatchNumber" FROM "OBTN" '

            'WHERE "DistNumber" LIKE :batchPattern '

            'AND "ItemCode" = :itemCode'

        )

        sap.ensure_sql_query(sql_code, "Batch numbers by order prefix and item", sql_text)

        param = f"batchPattern='{prefix_pattern}';itemCode='{safe_item}'"

    else:

        sql_code = "CODX_ORDER_BATCH_NUMBERS"

        sql_text = (

            'SELECT "DistNumber" AS "BatchNumber" FROM "OBTN" '

            'WHERE "DistNumber" LIKE :batchPattern'

        )

        sap.ensure_sql_query(sql_code, "Batch numbers by production order prefix", sql_text)

        param = f"batchPattern='{prefix_pattern}'"



    result = sap.execute_sql_query(sql_code, param)

    if result.get("error"):

        raise Exception(result.get("error"))



    # Secondary Python-side guard: only rows that exactly match {prefix}-{digits}

    import re as _re

    exact = _re.compile(rf'^{_re.escape(str(cleaned_prefix))}-\d+$')

    return [

        row.get("BatchNumber")

        for row in result.get("value", [])

        if _clean_value(row.get("BatchNumber")) is not None

        and exact.match(str(row.get("BatchNumber", "")).strip())

    ]





def _get_next_batch_suffix_for_order(batch_prefix):

    highest_suffix = 0

    for batch_number in _get_existing_batch_numbers_for_order(batch_prefix):

        suffix = _extract_batch_number_suffix(batch_number, batch_prefix)

        if suffix is None:

            continue

        highest_suffix = max(highest_suffix, suffix)

    return highest_suffix + 1





def _obtn_next_n_hana(production_order_number, item_code):

    """

    Returns the next numeric suffix N for this production order's batch numbers.

    Uses BatchNumberDetails OData (substringof filter) — no custom SQL required.

    Returns 1 on any error (safe fallback).

    """

    print(f"[OBTN-DEBUG] BatchNumberDetails | order={production_order_number!r} item_code={item_code!r}")

    n = sap.get_next_batch_number_suffix(production_order_number)

    print(f"[OBTN-DEBUG] NextN={n}  →  next batch = '{production_order_number}-{n}'")

    return n





def _get_next_batch_from_obtn(production_order_number, item_code=None, auto_batch_count=1):

    """

    Return a list of `auto_batch_count` sequential batch numbers starting from

    the next available suffix in OBTN.



    Example (2 auto batches, max existing = 2):

        → ['112000024-3', '112000024-4']



    Falls back to ['{order}-1', '{order}-2', ...] on any HANA/SAP error.

    """

    fallback = [f"{production_order_number}-{i + 1}" for i in range(auto_batch_count)]

    try:

        next_n = _obtn_next_n_hana(production_order_number, item_code)

        result = [f"{production_order_number}-{next_n + i}" for i in range(auto_batch_count)]

        print(f"[OBTN-DEBUG] assigned batch(es): {result}")

        return result

    except Exception as exc:

        print(f"[OBTN-DEBUG] error — falling back to {fallback}: {exc}")

        return fallback





def _local_batch_max_suffix(order_num):

    """

    Return the highest batch suffix currently stored locally for order_num.



    Scans BOTH sources with strict regex ^ORDER-(\d+)$:

      - PendingReceiptBatch.batch_number  (all rows)

      - BatchNumberReservation.suffix     (ALL statuses, including CANCELLED)



    CANCELLED reservations are intentionally included: when a batch is deleted its

    reservation stays in the DB (UNIQUE constraint on batch_number), so including

    it in the max makes next_suffix skip over the deleted number instead of

    hitting a guaranteed UNIQUE violation on every retry attempt.

    """

    import re as _re

    order_str = str(order_num).strip()

    _pat      = _re.compile(rf'^{_re.escape(order_str)}-(\d+)$')

    prefix    = f"{order_str}-"



    print(f"[LOCAL-MAX] order_num={order_num!r} → order_str={order_str!r}, prefix={prefix!r}")



    raw_batch_numbers = list(

        PendingReceiptBatch.objects

        .filter(batch_number__startswith=prefix)

        .values_list("batch_number", flat=True)

    )

    print(f"[LOCAL-MAX] PendingReceiptBatch rows matching prefix: {raw_batch_numbers}")



    suffixes = []

    for b in raw_batch_numbers:

        s = str(b or "").strip()

        m = _pat.match(s)

        parsed = int(m.group(1)) if m else None

        print(f"[LOCAL-MAX]   batch_number={s!r} → regex match={bool(m)}, parsed suffix={parsed}")

        if parsed is not None:

            suffixes.append(parsed)

    pb_max = max(suffixes, default=0)

    print(f"[LOCAL-MAX] pb_max={pb_max}")



    # Include ALL reservations — even CANCELLED — so deleted batch numbers are

    # never reused.  The UNIQUE constraint on batch_number would prevent reuse

    # anyway; including CANCELLED here makes next_suffix skip over those rows

    # immediately instead of burning retries on guaranteed UNIQUE violations.

    res_max = (

        BatchNumberReservation.objects

        .filter(production_order_doc_num=order_str)

        .aggregate(m=Max("suffix"))["m"]

    ) or 0

    print(f"[LOCAL-MAX] res_max={res_max} (all statuses, incl. CANCELLED)")



    result = max(pb_max, res_max)

    print(f"[LOCAL-MAX] → returning {result}")

    return result





def _get_true_next_batch_suffix(order_num, item_code=None):

    """

    Compute the globally safe next batch suffix for order_num.



    Aggregates the max suffix from three independent sources and returns max+1:

      1. SAP OBTN table via SQL       — full batch master, includes historical/consumed batches

      2. SAP BatchNumberDetails OData — cross-check for in-flight batches

      3. Local DB                     — PendingReceiptBatch.batch_number + BatchNumberReservation



    Each source is independently guarded; a failure in one does not block the others.

    Strict regex ^ORDER-(\d+)$ ensures only exact matches are counted.

    """

    import re as _re

    order_str = str(order_num).strip()

    _pat      = _re.compile(rf'^{_re.escape(order_str)}-(\d+)$')



    def _parse(batch_str):

        m = _pat.match(str(batch_str or "").strip())

        return int(m.group(1)) if m else 0



    max_suffix = 0



    # ── 1. SAP OBTN table via SQL (most complete — includes all historical batches)

    try:

        obtn_batches = _get_existing_batch_numbers_for_order(order_str, item_code)

        obtn_max = max((_parse(b) for b in obtn_batches), default=0)

        max_suffix = max(max_suffix, obtn_max)

        print(f"[BATCH-SUFFIX] OBTN SQL: {len(obtn_batches)} row(s), max_suffix={obtn_max}")

    except Exception as exc:

        print(f"[BATCH-SUFFIX] OBTN SQL failed (skipping): {exc}")



    # ── 2. SAP BatchNumberDetails OData (catches batches in transit / with inventory)

    try:

        odata_next = sap.get_next_batch_number_suffix(order_str, item_code)  # returns max+1

        odata_max  = odata_next - 1

        max_suffix = max(max_suffix, odata_max)

        print(f"[BATCH-SUFFIX] OData BatchNumberDetails: next={odata_next}, max_suffix={odata_max}")

    except Exception as exc:

        print(f"[BATCH-SUFFIX] OData failed (skipping): {exc}")



    # ── 3. Local DB: PendingReceiptBatch.batch_number + BatchNumberReservation.suffix

    try:

        local_max = _local_batch_max_suffix(order_str)

        max_suffix = max(max_suffix, local_max)

        print(f"[BATCH-SUFFIX] Local DB: max_suffix={local_max}")

    except Exception as exc:

        print(f"[BATCH-SUFFIX] Local DB failed (skipping): {exc}")



    next_suffix = max_suffix + 1

    print(f"[BATCH-SUFFIX] order={order_str!r} → global_max={max_suffix} → next={next_suffix}")

    return next_suffix





def _is_batch_conflict_error(error_text):

    """Return True when SAP indicates a duplicate / already-existing batch number."""

    if not error_text:

        return False

    lower = str(error_text).lower()

    conflict_keywords = [

        "already exist",

        "already assigned",

        "distrib. no",

        "distribution number",

        "duplicate",

        "uniqueness",

        "serial/batch",

        "-5002",

    ]

    matched = [kw for kw in conflict_keywords if kw in lower]

    if matched:

        print(f"[BATCH-RETRY] conflict keywords matched: {matched}")

    return bool(matched)





def _is_concurrency_error(error_text):

    """Return True when SAP indicates an optimistic-lock / concurrent-modification conflict (-2039)."""

    if not error_text:

        return False

    lower = str(error_text).lower()

    concurrency_keywords = [

        "-2039",

        "another user",

        "another operation modified",

        "modified data",

    ]

    matched = [kw for kw in concurrency_keywords if kw in lower]

    if matched:

        print(f"[BATCH-RETRY] concurrency keywords matched: {matched}")

    return bool(matched)





def _get_suggested_batch_number_for_order(batch_prefix):

    return _build_batch_number(

        batch_prefix,

        _get_next_batch_suffix_for_order(batch_prefix),

    )





def _should_auto_assign_batch_number(batch, batch_prefix):

    auto_generated = _coerce_bool(batch.get("batchNumberAutoGenerated"))

    if auto_generated is not None:

        return auto_generated



    batch_number = _clean_value(batch.get("batchNumber"))

    if batch_number is None:

        return True



    return _extract_batch_number_suffix(batch_number, batch_prefix) is not None





def _assign_next_batch_numbers(batches, batch_prefix):

    next_suffix = _get_next_batch_suffix_for_order(batch_prefix)

    resolved_batches = []



    for batch in batches:

        updated_batch = dict(batch)

        if _should_auto_assign_batch_number(updated_batch, batch_prefix):

            updated_batch["batchNumber"] = _build_batch_number(

                batch_prefix,

                next_suffix,

            )

            next_suffix += 1

        resolved_batches.append(updated_batch)



    return resolved_batches





@contextmanager

def _batch_number_lock(batch_prefix, timeout_seconds=30, poll_interval=0.1):

    safe_name = "".join(

        character if character.isalnum() else "_"

        for character in str(_clean_value(batch_prefix) or "default")

    )

    lock_path = _BATCH_NUMBER_LOCK_DIR / f"{safe_name}.lock"

    lock_path.parent.mkdir(parents=True, exist_ok=True)



    started_at = time.time()

    file_descriptor = None



    while True:

        try:

            file_descriptor = os.open(

                str(lock_path),

                os.O_CREAT | os.O_EXCL | os.O_RDWR,

            )

            break

        except FileExistsError:

            if time.time() - started_at >= timeout_seconds:

                raise TimeoutError(

                    f"Timed out while waiting to allocate the next batch number for {batch_prefix}."

                )

            time.sleep(poll_interval)



    try:

        yield

    finally:

        if file_descriptor is not None:

            os.close(file_descriptor)

        try:

            lock_path.unlink()

        except FileNotFoundError:

            pass





def _normalize_udf_name(name):

    if not name:

        return ""

    normalized = name.strip()

    if normalized.startswith("U_"):

        normalized = normalized[2:]

    return normalized.lower()





def _get_latest_batch_for_item(item_code):

    endpoint = (

        "BatchNumbers"

        f"?$filter=ItemCode eq '{item_code}'"

        "&$orderby=AdmissionDate desc"

        "&$top=1"

    )

    result = sap._request("GET", endpoint)

    batches = result.get("value", [])

    return batches[0] if batches else {}





def _get_latest_obtn_row(item_code):

    sql_code = "CODX_OBTN_LATEST"

    sql_text = """

select top 1

    T0.[DistNumber] as [BatchNumber],

    T0.[U_Size] as [U_Size],

    T0.[U_Brand] as [U_Brand],

    T0.[U_UOM] as [U_UOM],

    T0.[U_vendor] as [U_vendor],

    T0.[U_Part] as [U_Part],

    T0.[U_Category] as [U_Category],

    T0.[U_Packing] as [U_Packing],

    T0.[U_Season] as [U_Season],

    T0.[U_Specification] as [U_Specification],

    T0.[U_Number] as [U_Number]

from [OBTN] T0

where T0.[ItemCode] = :itemCode

order by T0.[InDate] desc, T0.[DistNumber] desc

""".strip()



    sap.ensure_sql_query(sql_code, "Latest OBTN row by item", sql_text)

    safe_item_code = str(item_code).replace("'", "''")

    result = sap.execute_sql_query(sql_code, f"itemCode='{safe_item_code}'")

    rows = result.get("value", [])

    return rows[0] if rows else {}





def _get_obtn_udf_definitions():

    sql_code = "CODX_OBTN_UDFS"

    sql_text = """

select

    T0.[TableID] as [TableName],

    T0.[FieldID] as [FieldID],

    T0.[AliasID] as [AliasID],

    T0.[Descr] as [FieldDescription],

    T0.[Dflt] as [DefaultValue],

    T1.[FldValue] as [ValidValue],

    T1.[Descr] as [ValidDescription]

from [CUFD] T0

left join [UFD1] T1

    on T0.[TableID] = T1.[TableID]

    and T0.[FieldID] = T1.[FieldID]

where T0.[TableID] = 'OBTN'

order by T0.[FieldID], T1.[IndexID]

""".strip()



    sap.ensure_sql_query(sql_code, "OBTN UDF definitions", sql_text)

    result = sap.execute_sql_query(sql_code)

    return result.get("value", [])





def _get_ufd1_field_options():

    """Return UFD1 valid values for OBTN UDFs, keyed by logical field name."""

    alias_to_key = {

        "U_Size": "size",

        "U_Brand": "brand",

        "U_UOM": "uom",

        "U_vendor": "vendor",

        "U_Part": "part",

        "U_Category": "category",

        "U_Packing": "packing",

        "U_Season": "season",

        "U_Specification": "extra_specification",

        "U_Number": "number",

        "U_Company": "company",

    }

    rows = _get_obtn_udf_definitions()

    options = {}

    seen_map = {k: set() for k in alias_to_key.values()}

    for row in rows:

        alias_id = row.get("AliasID") or ""

        logical_key = alias_to_key.get(alias_id)

        if not logical_key:

            continue

        valid_value = _clean_value(row.get("ValidValue"))

        if not valid_value:

            continue

        if valid_value in seen_map[logical_key]:

            continue

        seen_map[logical_key].add(valid_value)

        description = _clean_value(row.get("ValidDescription")) or valid_value

        options.setdefault(logical_key, []).append({"value": valid_value, "description": description})

    return options





def _get_obtn_udf_options(item_code=None):

    column_map = {

        "size": "U_Size",

        "brand": "U_Brand",

        "uom": "U_UOM",

        "vendor": "U_vendor",

        "part": "U_Part",

        "category": "U_Category",

        "packing": "U_Packing",

        "season": "U_Season",

        "extra_specification": "U_Specification",

        "number": "U_Number",

        "company": "U_Company",

    }

    safe_item_code = str(item_code).replace("'", "''") if item_code is not None else None

    options = {}



    if safe_item_code:

        sql_code = "CODX_OBTN_OPT_ALL_ITEM"

        columns_sql = ",\n    ".join(

            [f"T0.[{column_name}] as [{column_name}]" for column_name in column_map.values()]

        )

        sql_text = f"""

select

    {columns_sql}

from [OBTN] T0

where T0.[ItemCode] = :itemCode

""".strip()



        sap.ensure_sql_query(sql_code, "OBTN options by item", sql_text)

        result = sap.execute_sql_query(sql_code, f"itemCode='{safe_item_code}'")



        seen_map = {field_key: set() for field_key in column_map.keys()}

        for row in result.get("value", []):

            for field_key, column_name in column_map.items():

                field_value = _clean_value(row.get(column_name))

                if field_value is None:

                    continue

                field_value = str(field_value)

                if field_value in seen_map[field_key]:

                    continue

                seen_map[field_key].add(field_value)

                options.setdefault(field_key, []).append(

                    {"value": field_value, "description": field_value}

                )



        for field_key, values in options.items():

            values.sort(key=lambda item: item["value"])



        return options



    sql_suffix = "ALL"



    for field_key, column_name in column_map.items():

        sql_code = f"CODX_OBTN_OPT_{field_key.upper()}_{sql_suffix}"

        where_parts = [

            f"T0.[{column_name}] is not null",

            f"ltrim(rtrim(T0.[{column_name}])) <> ''",

        ]



        sql_text = f"""

select distinct

    T0.[{column_name}] as [FieldValue]

from [OBTN] T0

where {" and ".join(where_parts)}

order by T0.[{column_name}]

""".strip()



        sap.ensure_sql_query(sql_code, f"OBTN {field_key} options", sql_text)

        result = sap.execute_sql_query(sql_code)



        values = []

        seen = set()

        for row in result.get("value", []):

            field_value = _clean_value(row.get("FieldValue"))

            if field_value is None:

                continue

            field_value = str(field_value)

            if field_value in seen:

                continue

            seen.add(field_value)

            values.append({"value": field_value, "description": field_value})



        if values:

            options[field_key] = values



    return options





def _merge_udf_options(primary_options, fallback_options):

    merged = {}

    all_keys = set(primary_options.keys()) | set(fallback_options.keys())



    for key in all_keys:

        seen = set()

        merged_values = []



        for source in (primary_options.get(key, []), fallback_options.get(key, [])):

            for option in source:

                option_value = _clean_value(option.get("value"))

                if not option_value or option_value in seen:

                    continue

                seen.add(option_value)

                merged_values.append(

                    {

                        "value": option_value,

                        "description": option.get("description") or option_value,

                    }

                )



        if merged_values:

            merged[key] = merged_values



    return merged





def _discover_batch_udf_table():

    udf_names = [

        "Size",

        "Brand",

        "UOM",

        "vendor",

        "Part",

        "Category",

        "Packing",

        "Specification",

        "Number",

    ]



    result = sap.search_user_fields_metadata_by_names(udf_names)

    fields = result.get("value", [])

    table_counts = {}

    for field in fields:

        table_name = field.get("TableName")

        if not table_name:

            continue

        table_counts[table_name] = table_counts.get(table_name, 0) + 1



    if not table_counts:

        return "OBTN", fields



    best_table = max(table_counts, key=table_counts.get)

    return best_table, fields







@api_view(["GET"])

def test_api(request):

    return format_success_response({"status": "ready"})





# ========== Inventory Transfer ==========

def _require_authenticated(request):

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    return None





TRANSFER_NO_RULES_MESSAGE = "No Transfer warehouse route is configured. Contact admin."

TRANSFER_SOURCE_SAP_AVAILABLE = "SAP_AVAILABLE"

TRANSFER_SOURCE_SAP_POSTED = "SAP_POSTED"

TRANSFER_SOURCE_LOCAL_PENDING = "LOCAL_PENDING_RECEIPT"

TRANSFER_SOURCE_LOCAL_POSTED = "LOCAL_POSTED_RECEIPT"

TRANSFER_SOURCE_PENDING_CHAIN = "PENDING_TRANSFER_CHAIN"

TRANSFER_SOURCE_NOT_FOUND = "NOT_FOUND"

TRANSFER_SOURCE_BLOCKED_MESSAGE = (

    "Cannot post transfer because source batch has not been posted to SAP yet."

)

TRANSFER_CHAIN_BLOCKED_MESSAGE = (

    "Cannot post transfer because an earlier transfer to the source warehouse is still pending SAP posting."

)

TRANSFER_RULE_DIRECTIONS = {

    TransferWarehouseRule.DIRECTION_FROM,

    TransferWarehouseRule.DIRECTION_TO,

    TransferWarehouseRule.DIRECTION_BOTH,

}

TRANSFER_RULE_STAGES = {

    TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE,

    TransferWarehouseRule.STAGE_2_TO_FRIDGE,

    TransferWarehouseRule.STAGE_3_FROM_FRIDGE,

    TransferWarehouseRule.STAGE_4_TO_DESTINATION,
    TransferWarehouseRule.STAGE_5_TO_CONTAINER,

    TransferWarehouseRule.STAGE_BOTH,

}





def _transfer_rule_to_dict(rule):

    return {

        "id": rule.id,

        "user": rule.user_id,

        "user_id": rule.user_id,

        "username": rule.user.username,

        "warehouse_code": rule.warehouse_code,

        "warehouse_name": rule.warehouse_name,

        "direction": rule.direction,

        "stage": rule.stage,

        "is_active": rule.is_active,

        "created_at": rule.created_at.isoformat() if rule.created_at else None,

        "updated_at": rule.updated_at.isoformat() if rule.updated_at else None,

    }





def _transfer_rule_matches(rule, direction, stage=None):

    direction_ok = rule.direction in (direction, TransferWarehouseRule.DIRECTION_BOTH)

    stage_ok = (

        not stage

        or rule.stage == stage

        or (rule.stage == TransferWarehouseRule.STAGE_BOTH and stage in {
            TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE,
            TransferWarehouseRule.STAGE_2_TO_FRIDGE,
        })

    )

    return direction_ok and stage_ok





def _active_transfer_rules_for_user(user):

    if not user or not user.is_authenticated:

        return TransferWarehouseRule.objects.none()

    return TransferWarehouseRule.objects.filter(user=user, is_active=True)





def _transfer_allowed_codes(user, direction, stage=None):
    if can_manage_transfer(user):
        return None
    rules = list(_active_transfer_rules_for_user(user))

    if can_manage_transfer(user) and not rules:

        return None

    return {

        r.warehouse_code

        for r in rules

        if _transfer_rule_matches(r, direction, stage)

    }





def _transfer_access_summary(user):
    if can_manage_transfer(user):
        return {"allow_all": True, "has_rules": False, "allowed_from": [], "allowed_to": [], "rules": [], "message": ""}
    rules = list(_active_transfer_rules_for_user(user))

    allow_all = can_manage_transfer(user) and not rules

    allowed_from = sorted({

        r.warehouse_code

        for r in rules

        if _transfer_rule_matches(r, TransferWarehouseRule.DIRECTION_FROM)

    })

    allowed_to = sorted({

        r.warehouse_code

        for r in rules

        if _transfer_rule_matches(r, TransferWarehouseRule.DIRECTION_TO)

    })

    return {

        "allow_all": allow_all,

        "has_rules": bool(rules),

        "allowed_from": allowed_from,

        "allowed_to": allowed_to,

        "rules": [_transfer_rule_to_dict(r) for r in rules],

        "message": "" if allow_all or rules else TRANSFER_NO_RULES_MESSAGE,

    }





def _filter_transfer_warehouses_for_user(user, warehouses, direction, stage=None):

    allowed_codes = _transfer_allowed_codes(user, direction, stage)

    if allowed_codes is None:

        return warehouses

    return [w for w in warehouses if w.get("code") in allowed_codes]





def _filter_transfer_warehouses_for_any_access(user, warehouses):
    if can_manage_transfer(user):
        return warehouses
    rules = list(_active_transfer_rules_for_user(user))

    if can_manage_transfer(user) and not rules:

        return warehouses

    allowed_codes = {r.warehouse_code for r in rules}

    return [w for w in warehouses if w.get("code") in allowed_codes]





def _user_can_access_transfer_warehouse(user, warehouse_code, direction, stage=None):

    code = str(warehouse_code or "").strip()

    if not code:

        return False

    allowed_codes = _transfer_allowed_codes(user, direction, stage)

    return True if allowed_codes is None else code in allowed_codes





def _transfer_rule_payload(data, partial=False):

    payload = {}



    if "user_id" in data or "user" in data:

        user_value = data.get("user_id", data.get("user"))

        try:

            payload["user"] = User.objects.get(pk=int(user_value))

        except (TypeError, ValueError, User.DoesNotExist):

            raise ValueError("Valid user_id is required")

    elif not partial:

        raise ValueError("user_id is required")



    if "warehouse_code" in data:

        warehouse_code = str(data.get("warehouse_code") or "").strip()

        if not warehouse_code:

            raise ValueError("warehouse_code is required")

        payload["warehouse_code"] = warehouse_code

    elif not partial:

        raise ValueError("warehouse_code is required")



    if "warehouse_name" in data:

        payload["warehouse_name"] = str(data.get("warehouse_name") or "").strip()

    elif not partial:

        payload["warehouse_name"] = ""



    if "direction" in data:

        direction = str(data.get("direction") or "").strip().upper()

        if direction not in TRANSFER_RULE_DIRECTIONS:

            raise ValueError("direction must be FROM, TO, or BOTH")

        payload["direction"] = direction

    elif not partial:

        raise ValueError("direction is required")



    if "stage" in data:

        stage_value = str(data.get("stage") or "").strip().upper()

        if stage_value not in TRANSFER_RULE_STAGES:

            raise ValueError(

                "stage must be STAGE_1_TO_INTERMEDIATE, STAGE_2_TO_FRIDGE, STAGE_3_FROM_FRIDGE, STAGE_4_TO_DESTINATION, STAGE_5_TO_CONTAINER, or BOTH"

            )

        payload["stage"] = stage_value

    elif not partial:

        payload["stage"] = TransferWarehouseRule.STAGE_BOTH



    if "is_active" in data:

        payload["is_active"] = _coerce_bool(data.get("is_active"))

    elif not partial:

        payload["is_active"] = True



    if payload.get('stage') == TransferWarehouseRule.STAGE_5_TO_CONTAINER and payload.get('direction', 'FROM') != 'FROM':
        raise ValueError('Stage 5 supports Allowed From Warehouses only.')
    return payload





@api_view(["GET", "POST"])
@audit_mutation(module=MODULE_RULES, entity_type="TransferWarehouseRule", methods=("POST",))
def transfer_warehouse_access_rules(request):

    guard = _require_transfer_admin(request)

    if guard:

        return guard



    if request.method == "GET":

        qs = TransferWarehouseRule.objects.select_related("user").order_by(

            "user__username", "warehouse_code", "direction", "stage"

        )

        eligible_user_ids = [
            user.id for user in User.objects.prefetch_related("module_permissions")
            if has_module_level(user, PERMISSION_MODULE_TRANSFER, LEVEL_USER)
        ]
        qs = qs.filter(user_id__in=eligible_user_ids)

        user_id = request.query_params.get("user_id")

        if user_id:

            qs = qs.filter(user_id=user_id)



        return format_success_response({

            "rules": [_transfer_rule_to_dict(r) for r in qs],

            "access": _transfer_access_summary(request.user),

        })



    guard = _require_transfer_admin(request)

    if guard:

        return guard



    try:

        payload = _transfer_rule_payload(request.data)

        if not has_module_level(payload["user"], PERMISSION_MODULE_TRANSFER, LEVEL_USER):

            return format_error_response("User is not eligible for Transfer User Rules", status.HTTP_400_BAD_REQUEST)

        unique = {

            "user": payload["user"],

            "warehouse_code": payload["warehouse_code"],

            "direction": payload["direction"],

            "stage": payload["stage"],

        }

        defaults = {

            "warehouse_name": payload.get("warehouse_name", ""),

            "is_active": payload.get("is_active", True),

        }

        rule, created = TransferWarehouseRule.objects.update_or_create(

            **unique,

            defaults=defaults,

        )

        response_status = status.HTTP_201_CREATED if created else status.HTTP_200_OK

        return Response(

            {"success": True, "data": {"rule": _transfer_rule_to_dict(rule)}},

            status=response_status,

        )

    except ValueError as exc:

        return format_error_response(str(exc), status.HTTP_400_BAD_REQUEST)

    except Exception as exc:

        return format_error_response(str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)





@api_view(["GET"])

def transfer_my_warehouse_access(request):

    guard = _require_roles(request, {"admin", "transfer"}, "Transfer access required")

    if guard:

        return guard

    return format_success_response({"access": _transfer_access_summary(request.user)})





@api_view(["PUT", "PATCH", "DELETE"])
@audit_mutation(module=MODULE_RULES, entity_type="TransferWarehouseRule")
def transfer_warehouse_access_rule_detail(request, rule_id):

    guard = _require_transfer_admin(request)

    if guard:

        return guard



    try:

        rule = TransferWarehouseRule.objects.select_related("user").get(pk=rule_id)

    except TransferWarehouseRule.DoesNotExist:

        return format_error_response("Transfer warehouse rule not found", status.HTTP_404_NOT_FOUND)



    if request.method == "DELETE":

        if not can_manage_user(request.user, rule.user):

            return format_error_response("Cannot manage this user", status.HTTP_403_FORBIDDEN)

        rule.delete()

        return format_success_response({"deleted": rule_id})



    try:

        payload = _transfer_rule_payload(request.data, partial=(request.method == "PATCH"))

        if "user" in payload and not can_manage_user(request.user, payload["user"]):

            return format_error_response("Cannot manage this user", status.HTTP_403_FORBIDDEN)

        if "user" not in payload and not can_manage_user(request.user, rule.user):

            return format_error_response("Cannot manage this user", status.HTTP_403_FORBIDDEN)

        for field, value in payload.items():

            setattr(rule, field, value)

        if rule.stage == TransferWarehouseRule.STAGE_5_TO_CONTAINER and rule.direction != 'FROM':
            raise ValueError('Stage 5 supports Allowed From Warehouses only.')
        rule.save()

        return format_success_response({"rule": _transfer_rule_to_dict(rule)})

    except ValueError as exc:

        return format_error_response(str(exc), status.HTTP_400_BAD_REQUEST)

    except Exception as exc:

        return format_error_response(str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)





def _normalize_transfer_batch_number(batch_number):

    return str(batch_number or "").strip().replace(" ", "").upper()


class ActiveTransferBatchConflict(TransferValidationError):
    pass


def _active_transfer_batch_keys(payload):
    raw_payload = _transfer_payload_for_storage(payload)
    source_warehouse = str(raw_payload.get("from_warehouse") or "").strip().upper()
    transfer_stage = str(raw_payload.get("transfer_stage") or "").strip()
    batch_numbers = {
        _normalize_transfer_batch_number(raw_payload.get("batch_number")),
    }
    batch_numbers.update(
        _normalize_transfer_batch_number(
            line.get("batch_number") or line.get("batchNumber")
        )
        for line in (raw_payload.get("lines") or [])
    )
    return {
        (batch_number, source_warehouse, transfer_stage)
        for batch_number in batch_numbers
        if batch_number and source_warehouse and transfer_stage
    }


def _replace_active_transfer_batch_guards(pending, payload):
    pending.active_batch_guards.all().delete()
    if pending.status not in [
        PendingTransferRequest.PENDING,
        PendingTransferRequest.FAILED,
        PendingTransferRequest.POSTING,
    ]:
        return

    guards = [
        PendingTransferBatchGuard(
            transfer=pending,
            normalized_batch_number=batch_number,
            normalized_from_warehouse=source_warehouse,
            transfer_stage=transfer_stage,
        )
        for batch_number, source_warehouse, transfer_stage in _active_transfer_batch_keys(payload)
    ]
    if not guards:
        return

    try:
        with transaction.atomic():
            PendingTransferBatchGuard.objects.bulk_create(guards)
    except IntegrityError as exc:
        raise ActiveTransferBatchConflict(
            "One or more batches already have an active pending transfer "
            "for this source warehouse and transfer stage."
        ) from exc





def _find_active_pending_transfer_for_batch(

    batch_number,

    from_warehouse=None,

    transfer_stage=None,

    exclude_transfer_id=None,

):

    normalized = _normalize_transfer_batch_number(batch_number)

    source_whs = str(from_warehouse or "").strip()

    stage = str(transfer_stage or "").strip()

    if not normalized or not source_whs or not stage:

        return None



    qs = PendingTransferRequest.objects.filter(

        status=PendingTransferRequest.PENDING,

        from_warehouse__iexact=source_whs,

        transfer_stage=stage,

    )

    if exclude_transfer_id is not None:

        qs = qs.exclude(id=exclude_transfer_id)



    for pending in qs.only("id", "batch_number", "lines"):

        pending_batches = {

            _normalize_transfer_batch_number(pending.batch_number),

        }

        pending_batches.update(

            _normalize_transfer_batch_number(

                line.get("batch_number") or line.get("batchNumber")

            )

            for line in (pending.lines or [])

        )

        if normalized in pending_batches:

            return pending

    return None





def _find_local_receipt_batch_for_transfer(batch_number, from_warehouse=None, from_bin=None):

    normalized = _normalize_transfer_batch_number(batch_number)

    if not normalized:

        return None



    qs = (

        PendingReceiptBatch.objects

        .select_related("pending_receipt")

        .filter(batch_number__iexact=normalized)

        .exclude(pending_receipt__status=PendingReceipt.REJECTED)

    )



    source_whs = str(from_warehouse or "").strip()

    if source_whs:

        qs = qs.filter(pending_receipt__warehouse_code__iexact=source_whs)



    source_bin = str(from_bin or "").strip()

    if source_bin:

        qs = qs.filter(

            Q(bin_location__iexact=source_bin) |

            Q(bin_abs_entry__iexact=source_bin)

        )



    return qs.order_by("-pending_receipt__created_at", "-id").first()





def _decorate_sap_transfer_batch(batch):

    decorated = dict(batch or {})

    decorated.update({

        "source_type": "sap",

        "availability_status": TRANSFER_SOURCE_SAP_AVAILABLE,

        "source_status_label": "SAP available",

        "source_message": "SAP available",

        "can_post_to_sap": True,

        "receipt_status": "",

        "pending_receipt_id": None,

        "pending_receipt_batch_id": None,

    })

    local = PendingReceiptBatch.objects.filter(
        batch_number=decorated.get('batch_number'),
        pending_receipt__item_code=decorated.get('item_code'),
    ).exclude(pending_receipt__status=PendingReceipt.REJECTED).order_by('-id').first()
    if local:
        decorated.update(local.production_pallet)
    return decorated





def _local_receipt_batch_to_transfer_batch(local_batch, requested_from_warehouse=None, requested_from_bin=None):

    receipt = local_batch.pending_receipt

    receipt_posted = receipt.status == PendingReceipt.POSTED

    source_status = (

        TRANSFER_SOURCE_LOCAL_POSTED

        if receipt_posted

        else TRANSFER_SOURCE_LOCAL_PENDING

    )

    source_label = (

        "Waiting for SAP availability"

        if receipt_posted

        else "Local pending receipt"

    )

    source_message = (

        "Receipt is posted, but source batch is not available in SAP at this warehouse yet."

        if receipt_posted

        else "Pending receipt - not posted to SAP yet"

    )



    return {

        "item_code": receipt.item_code or "",

        "item_name": receipt.item_name or receipt.item_code or "",

        "batch_number": local_batch.batch_number,

        "batch_abs_entry": None,

        "available_quantity": float(local_batch.quantity or 0),

        "uom": local_batch.uom_label or receipt.uom_label or "",

        "expiry_date": None,

        "from_warehouse": requested_from_warehouse or receipt.warehouse_code or "",

        "from_bin": requested_from_bin or local_batch.bin_location or "",

        "mock": False,

        "source_type": "local_receipt",

        "availability_status": source_status,

        "source_status_label": source_label,

        "source_message": source_message,

        "can_post_to_sap": False,

        "receipt_status": receipt.status,

        "pending_receipt_id": receipt.id,

        "pending_receipt_batch_id": local_batch.id,

        **local_batch.production_pallet,

    }





def _find_pending_transfer_chain_source(batch_number, from_warehouse=None):

    normalized = _normalize_transfer_batch_number(batch_number)

    source_whs = str(from_warehouse or "").strip()

    if not normalized or not source_whs:

        return None



    qs = (

        PendingTransferRequest.objects

        .filter(

            status=PendingTransferRequest.PENDING,

            to_warehouse__iexact=source_whs,

        )

        .order_by("-created_at", "-id")

    )



    for pending in qs:

        for line in pending.lines or []:

            line_batch = _normalize_transfer_batch_number(

                line.get("batch_number") or line.get("batchNumber")

            )

            if line_batch == normalized:

                return pending, line

    return None





def _pending_transfer_chain_to_transfer_batch(chain_source, requested_from_warehouse=None):

    pending, line = chain_source

    batch_number = (

        line.get("batch_number")

        or line.get("batchNumber")

        or pending.batch_number

    )

    local = PendingReceiptBatch.objects.filter(batch_number=batch_number,
        pending_receipt__item_code=line.get('item_code') or line.get('itemCode') or pending.item_code,
    ).exclude(pending_receipt__status=PendingReceipt.REJECTED).order_by('-id').first()
    return {
        **(local.production_pallet if local else {}),

        "item_code": line.get("item_code") or line.get("itemCode") or pending.item_code or "",

        "item_name": line.get("item_name") or line.get("itemName") or pending.item_name or "",

        "batch_number": _normalize_transfer_batch_number(batch_number),

        "batch_abs_entry": None,

        "available_quantity": float(line.get("quantity") or pending.quantity or 0),

        "uom": line.get("uom") or "",

        "expiry_date": None,

        "from_warehouse": requested_from_warehouse or pending.to_warehouse or "",

        "from_bin": "",

        "mock": False,

        "source_type": "pending_transfer_chain",

        "availability_status": TRANSFER_SOURCE_PENDING_CHAIN,

        "source_status_label": "Pending transfer chain",

        "source_message": (

            "Earlier transfer to this source warehouse is pending SAP posting."

        ),

        "can_post_to_sap": False,

        "receipt_status": "",

        "pending_receipt_id": None,

        "pending_receipt_batch_id": None,

        "source_transfer_id": pending.id,

        "source_transfer_status": pending.status,

    }





def _lookup_transfer_batch_source(batch_number, from_warehouse=None, from_bin=None):

    """

    Look up a batch in order of precedence:

    1. SAP (if warehouse specified)

    2. Local pending receipts (with status != REJECTED)

    3. Pending transfer chain (if warehouse specified)

    

    IMPORTANT: Relaxed validation ONLY bypasses intermediate-stage warehouse 

    availability checks. The batch itself MUST exist in SAP, local receipts, 

    or the pending chain. Completely unknown/invalid batches are NEVER allowed.

    

    Raises TransferBatchNotFound if batch doesn't exist anywhere.

    """

    normalized = _normalize_transfer_batch_number(batch_number)

    if not normalized:

        raise TransferBatchNotFound("Batch number cannot be empty.")

    

    # ── Strategy 1: Try SAP lookup first ────────────────────────────────────

    try:

        sap_batch = transfer_service.get_batch_details(

            normalized,

            from_warehouse=from_warehouse,

            from_bin=from_bin,

        )

        if sap_batch:

            return _decorate_sap_transfer_batch(sap_batch)

    except TransferBatchNotFound:

        # Not in SAP; try fallbacks

        pass

    except Exception as sap_error:

        # SAP connection error, not "batch not found"

        # Log but continue to fallbacks

        print(f"[TRANSFER-BATCH] SAP lookup error: {sap_error}")

    

    # ── Strategy 2: Try local pending receipts ──────────────────────────────

    local_batch = _find_local_receipt_batch_for_transfer(

        normalized,

        from_warehouse=from_warehouse,

        from_bin=from_bin,

    )

    if local_batch:

        return _local_receipt_batch_to_transfer_batch(

            local_batch,

            requested_from_warehouse=from_warehouse,

            requested_from_bin=from_bin,

        )

    

    # ── Strategy 3: Try pending transfer chain ──────────────────────────────

    chain_source = _find_pending_transfer_chain_source(

        normalized,

        from_warehouse=from_warehouse,

    )

    if chain_source:

        return _pending_transfer_chain_to_transfer_batch(

            chain_source,

            requested_from_warehouse=from_warehouse,

        )

    

    # ── No valid source found ────────────────────────────────────────────────

    raise TransferBatchNotFound(

        f"Batch {normalized} not found in SAP or local receipts."

    )





def _annotate_transfer_payload_sources(payload, exclude_transfer_id=None):

    raw_payload = _transfer_payload_for_storage(payload)

    transfer_stage = str(raw_payload.get("transfer_stage") or "").strip()

    from_warehouse = str(raw_payload.get("from_warehouse") or "").strip()

    from_bin = str(raw_payload.get("from_bin") or "").strip()

    lines = raw_payload.get("lines") or []

    annotated_lines = []

    has_local_only_line = False

    

    # ── Check for duplicate batches in current operation ────────────────────

    seen_batches = {}

    for index, line in enumerate(lines, start=1):

        batch_number = (

            line.get("batch_number")

            or line.get("batchNumber")

            or ""

        )

        normalized = _normalize_transfer_batch_number(batch_number)

        if normalized in seen_batches:

            raise TransferValidationError(

                f"Batch {normalized} already added to this transfer. Duplicate batches are not allowed."

            )

        seen_batches[normalized] = index



    for index, line in enumerate(lines, start=1):

        line_copy = dict(line or {})

        batch_number = (

            line_copy.get("batch_number")

            or line_copy.get("batchNumber")

            or ""

        )

        active_transfer = _find_active_pending_transfer_for_batch(

            batch_number,

            from_warehouse=from_warehouse,

            transfer_stage=transfer_stage,

            exclude_transfer_id=exclude_transfer_id,

        )

        if active_transfer:

            normalized = _normalize_transfer_batch_number(batch_number)

            raise TransferValidationError(

                f"Batch {normalized} already has an active pending transfer "

                f"for this source warehouse and transfer stage."

            )

        batch_source = _lookup_transfer_batch_source(

            batch_number,

            from_warehouse=from_warehouse,

            from_bin=from_bin,

        )



        try:

            requested_qty = float(line_copy.get("quantity") or 0)

        except (TypeError, ValueError):

            raise TransferValidationError(f"Line {index}: quantity must be a valid number")



        source_qty = float(batch_source.get("available_quantity") or 0)

        if requested_qty <= 0:

            raise TransferValidationError(f"Line {index}: quantity must be greater than 0")

        if requested_qty - source_qty > 0.0001:

            if batch_source.get("can_post_to_sap"):

                raise TransferValidationError(

                    f"Line {index}: requested quantity exceeds SAP available quantity."

                )

            raise TransferValidationError(

                f"Line {index}: requested quantity exceeds local receipt batch quantity."

            )



        if not batch_source.get("can_post_to_sap"):

            has_local_only_line = True



        line_copy["item_code"] = (

            line_copy.get("item_code")

            or line_copy.get("itemCode")

            or batch_source.get("item_code")

            or ""

        )

        line_copy["item_name"] = (

            line_copy.get("item_name")

            or line_copy.get("itemName")

            or batch_source.get("item_name")

            or ""

        )

        line_copy["batch_number"] = (

            batch_source.get("batch_number")

            or _normalize_transfer_batch_number(batch_number)

        )

        line_copy["quantity"] = requested_qty

        line_copy["uom"] = line_copy.get("uom") or batch_source.get("uom") or ""

        line_copy["source_type"] = batch_source.get("source_type")

        line_copy["availability_status"] = batch_source.get("availability_status")

        line_copy["source_status_label"] = batch_source.get("source_status_label")

        line_copy["source_message"] = batch_source.get("source_message")

        line_copy["can_post_to_sap"] = bool(batch_source.get("can_post_to_sap"))

        line_copy["receipt_status"] = batch_source.get("receipt_status") or ""

        line_copy["pending_receipt_id"] = batch_source.get("pending_receipt_id")

        line_copy["pending_receipt_batch_id"] = batch_source.get("pending_receipt_batch_id")

        line_copy["source_transfer_id"] = batch_source.get("source_transfer_id")

        line_copy["source_transfer_status"] = batch_source.get("source_transfer_status") or ""

        annotated_lines.append(line_copy)



    raw_payload["lines"] = annotated_lines

    return raw_payload, has_local_only_line





def _assert_transfer_payload_sap_available(payload, allow_reserved_outbound=True):
    transfer_service._validate_move_payload(payload, allow_reserved_outbound=allow_reserved_outbound, stored_contract=True)

    from_warehouse = str(payload.get("from_warehouse") or "").strip()

    from_bin = str(payload.get("from_bin") or "").strip()

    lines = payload.get("lines") or []



    for index, line in enumerate(lines, start=1):

        batch_number = line.get("batch_number") or line.get("batchNumber") or ""

        try:

            requested_qty = float(line.get("quantity") or 0)

        except (TypeError, ValueError):

            raise TransferValidationError(f"Line {index}: quantity must be a valid number")



        try:

            sap_batch = transfer_service.get_batch_details(

                batch_number,

                from_warehouse=from_warehouse,

                from_bin=from_bin,

            )

        except TransferBatchNotFound:

            local_batch = _find_local_receipt_batch_for_transfer(

                batch_number,

                from_warehouse=from_warehouse,

                from_bin=from_bin,

            )

            if local_batch:

                raise TransferValidationError(TRANSFER_SOURCE_BLOCKED_MESSAGE)

            chain_source = _find_pending_transfer_chain_source(

                batch_number,

                from_warehouse=from_warehouse,

            )

            if chain_source:

                raise TransferValidationError(TRANSFER_CHAIN_BLOCKED_MESSAGE)

            raise TransferValidationError(

                f"Cannot post transfer because source batch {batch_number} was not found in SAP."

            )



        available_qty = float((sap_batch or {}).get("available_quantity") or 0)

        if requested_qty - available_qty > 0.0001:

            raise TransferValidationError(

                f"Cannot post transfer because source batch {batch_number} has only "

                f"{available_qty:g} available in SAP."

            )










@api_view(["GET"])

def transfer_warehouses(request):

    guard = _require_roles(request, {"admin", "transfer"}, "Transfer access required")

    if guard:

        return guard



    from .services.master_data_search import is_lookup, lookup_response
    if is_lookup(request):
        access = _transfer_access_summary(request.user)
        allowed = None if access.get("allow_all") else set(access.get("allowed_from", [])) | set(access.get("allowed_to", []))
        return lookup_response(request, sap, "warehouses", "warehouses", allowed_codes=allowed)

    try:

        warehouses = transfer_service.get_destination_warehouses()

        warehouses = _filter_transfer_warehouses_for_any_access(request.user, warehouses)

        return Response({

            "success": True,

            "warehouses": warehouses,

            "access": _transfer_access_summary(request.user),

        })

    except NotImplementedError as exc:

        return Response({"success": False, "error": str(exc)}, status=501)

    except Exception as exc:

        return format_error_response(exc)





@api_view(["GET"])

def transfer_batch_details(request, batch_number):

    guard = _require_roles(request, {"admin", "transfer"}, "Transfer access required")

    if guard:

        return guard



    try:

        from_warehouse = request.query_params.get("from_warehouse")

        from_bin = request.query_params.get("from_bin")

        transfer_stage = request.query_params.get("transfer_stage")

        if from_warehouse and not _user_can_access_transfer_warehouse(

            request.user,

            from_warehouse,

            TransferWarehouseRule.DIRECTION_FROM,

            transfer_stage,

        ):

            return Response(

                {

                    "success": False,

                    "error": TRANSFER_NO_RULES_MESSAGE,

                },

                status=status.HTTP_403_FORBIDDEN,

            )

        active_transfer = _find_active_pending_transfer_for_batch(

            batch_number,

            from_warehouse=from_warehouse,

            transfer_stage=transfer_stage,

        )

        if active_transfer:

            return Response(

                {

                    "success": False,

                    "error": (

                        f"Batch {_normalize_transfer_batch_number(batch_number)} "

                        "already has an active pending transfer for this route."

                    ),

                },

                status=status.HTTP_404_NOT_FOUND,

            )

        batch = _lookup_transfer_batch_source(

            batch_number,

            from_warehouse=from_warehouse,

            from_bin=from_bin,

        )

        return Response({"success": True, "batch": batch})

    except TransferBatchNotFound as exc:

        return Response(

            {"success": False, "error": str(exc)},

            status=status.HTTP_404_NOT_FOUND,

        )

    except NotImplementedError as exc:

        return Response({"success": False, "error": str(exc)}, status=501)

    except Exception as exc:

        return Response(

            {"success": False, "error": f"SAP batch lookup failed: {exc}"},

            status=status.HTTP_400_BAD_REQUEST,

        )





@api_view(["GET"])

def transfer_intermediate_warehouses(request):

    guard = _require_roles(request, {"admin", "transfer"}, "Transfer access required")

    if guard:

        return guard



    result = sap.get_warehouses()



    rows = (

        result.get("value", [])

        if isinstance(result, dict)

        else []

    )



    keywords = [

        "stock-in-transit",

        "transit",

        "تحت النقل",

        "وسيط",

    ]



    warehouses = []



    for w in rows:

        code = w.get("WarehouseCode")

        name = w.get("WarehouseName") or ""



        if not code or not name:

            continue



        normalized_name = name.lower()



        if any(

            k.lower() in normalized_name

            for k in keywords

        ):

            warehouses.append({

                "code": code,

                "name": name,

            })



    warehouses = _filter_transfer_warehouses_for_any_access(request.user, warehouses)

    return Response(warehouses)





def _transfer_payload_for_storage(payload):

    return json.loads(json.dumps(payload, default=str))





def _pending_transfer_line_summary(lines):

    first_line = lines[0] if lines else {}

    total_qty = 0.0

    for line in lines:

        try:

            total_qty += float(line.get("quantity") or 0)

        except (TypeError, ValueError):

            pass

    return {

        "item_code": str(first_line.get("item_code") or first_line.get("itemCode") or "").strip(),

        "item_name": str(first_line.get("item_name") or first_line.get("itemName") or "").strip(),

        "batch_number": str(first_line.get("batch_number") or first_line.get("batchNumber") or "").strip(),

        "quantity": total_qty,

    }





def _transfer_line_with_source_status(line, batch_source):

    line_copy = dict(line or {})

    line_copy["item_code"] = (

        line_copy.get("item_code")

        or line_copy.get("itemCode")

        or batch_source.get("item_code")

        or ""

    )

    line_copy["item_name"] = (

        line_copy.get("item_name")

        or line_copy.get("itemName")

        or batch_source.get("item_name")

        or ""

    )

    line_copy["batch_number"] = (

        batch_source.get("batch_number")

        or line_copy.get("batch_number")

        or line_copy.get("batchNumber")

        or ""

    )

    line_copy["uom"] = line_copy.get("uom") or batch_source.get("uom") or ""

    line_copy["available_quantity"] = batch_source.get("available_quantity")

    line_copy["availability_status"] = batch_source.get("availability_status")

    line_copy["source_type"] = batch_source.get("source_type")

    line_copy["source_status_label"] = batch_source.get("source_status_label")

    line_copy["source_message"] = batch_source.get("source_message")

    line_copy["can_post_to_sap"] = bool(batch_source.get("can_post_to_sap"))

    line_copy["receipt_status"] = batch_source.get("receipt_status") or ""

    line_copy["pending_receipt_id"] = batch_source.get("pending_receipt_id")

    line_copy["pending_receipt_batch_id"] = batch_source.get("pending_receipt_batch_id")

    line_copy["source_transfer_id"] = batch_source.get("source_transfer_id")

    line_copy["source_transfer_status"] = batch_source.get("source_transfer_status") or ""

    return line_copy





def _pending_transfer_lines_for_display(t, refresh_sources=True):

    lines = [dict(line or {}) for line in (t.lines or [])]



    if t.status == PendingTransferRequest.POSTED:

        posted_lines = []

        for line in lines:

            line_copy = dict(line or {})

            line_copy["availability_status"] = TRANSFER_SOURCE_SAP_POSTED

            line_copy["source_type"] = "sap"

            line_copy["source_status_label"] = "Posted / SAP posted"

            line_copy["source_message"] = ""

            line_copy["can_post_to_sap"] = True

            posted_lines.append(line_copy)

        return posted_lines



    display_lines = []

    for line in lines:

        current_status = str(line.get("availability_status") or "").strip()

        current_can_post = line.get("can_post_to_sap")

        if not refresh_sources:

            display_lines.append(line)

            continue



        should_refresh = (

            current_status in {

                TRANSFER_SOURCE_LOCAL_PENDING,

                TRANSFER_SOURCE_LOCAL_POSTED,

                TRANSFER_SOURCE_PENDING_CHAIN,

                TRANSFER_SOURCE_NOT_FOUND,

            }

            or current_can_post is False

        )



        if not should_refresh:

            display_lines.append(line)

            continue



        batch_number = line.get("batch_number") or line.get("batchNumber") or ""

        try:

            sap_batch = transfer_service.get_batch_details(

                batch_number,

                from_warehouse=t.from_warehouse,

                from_bin=t.from_bin,

            )

            display_lines.append(

                _transfer_line_with_source_status(

                    line,

                    _decorate_sap_transfer_batch(sap_batch),

                )

            )

            continue

        except TransferBatchNotFound:

            pass

        except Exception:

            pass



        local_batch = _find_local_receipt_batch_for_transfer(

            batch_number,

            from_warehouse=t.from_warehouse,

            from_bin=t.from_bin,

        )

        if local_batch:

            display_lines.append(

                _transfer_line_with_source_status(

                    line,

                    _local_receipt_batch_to_transfer_batch(

                        local_batch,

                        requested_from_warehouse=t.from_warehouse,

                        requested_from_bin=t.from_bin,

                    ),

                )

            )

            continue



        chain_source = _find_pending_transfer_chain_source(

            batch_number,

            from_warehouse=t.from_warehouse,

        )

        if chain_source:

            display_lines.append(

                _transfer_line_with_source_status(

                    line,

                    _pending_transfer_chain_to_transfer_batch(

                        chain_source,

                        requested_from_warehouse=t.from_warehouse,

                    ),

                )

            )

            continue



        line_copy = dict(line or {})

        line_copy["availability_status"] = TRANSFER_SOURCE_NOT_FOUND

        line_copy["source_type"] = "not_found"

        line_copy["source_status_label"] = "Not found"

        line_copy["source_message"] = "Source batch was not found in SAP or local receipts."

        line_copy["can_post_to_sap"] = False

        display_lines.append(line_copy)



    return display_lines





def _position_reconciliation_to_dict(t):
    try:
        reconciliation = t.position_reconciliation
    except TransferPositionReconciliation.DoesNotExist:
        return None

    source_position = reconciliation.source_position
    destination_position = reconciliation.destination_position
    return {
        "status": reconciliation.status,
        "sap_doc_entry": reconciliation.sap_doc_entry,
        "sap_doc_num": reconciliation.sap_doc_num,
        "source_position_id": reconciliation.source_position_id,
        "source_position_code": reconciliation.source_position_code,
        "source_current_state": source_position.status if source_position else "MISSING",
        "expected_source_state": reconciliation.expected_source_state,
        "source_completed": reconciliation.source_completed,
        "destination_position_id": reconciliation.destination_position_id,
        "destination_position_code": reconciliation.destination_position_code,
        "destination_current_state": destination_position.status if destination_position else "MISSING",
        "expected_destination_state": reconciliation.expected_destination_state,
        "destination_completed": reconciliation.destination_completed,
        "failure_reason": reconciliation.failure_reason,
        "attempt_count": reconciliation.attempt_count,
        "created_at": reconciliation.created_at.isoformat() if reconciliation.created_at else None,
        "last_attempt_at": reconciliation.last_attempt_at.isoformat() if reconciliation.last_attempt_at else None,
        "completed_at": reconciliation.completed_at.isoformat() if reconciliation.completed_at else None,
    }


def _pending_transfer_to_dict(t, refresh_sources=True):

    return {

        "id": t.id,

        "transfer_stage": t.transfer_stage,

        "from_warehouse": t.from_warehouse,

        "from_bin": t.from_bin,

        "to_warehouse": t.to_warehouse,

        "to_bin": t.to_bin,

        "destination_type": t.destination_type,

        "item_code": t.item_code,

        "item_name": t.item_name,

        "batch_number": t.batch_number,

        "quantity": t.quantity,

        "lines": _pending_transfer_lines_for_display(t, refresh_sources=refresh_sources),

        "status": t.status,

        "created_by": t.created_by.username if t.created_by else None,

        "posted_by": t.posted_by.username if t.posted_by else None,

        "sap_doc_entry": t.sap_doc_entry,

        "sap_doc_num": t.sap_doc_num,

        "error_message": t.error_message,

        "created_at": t.created_at.isoformat() if t.created_at else None,

        "updated_at": t.updated_at.isoformat() if t.updated_at else None,

        "posted_at": t.posted_at.isoformat() if t.posted_at else None,

        "raw_payload_json": t.raw_payload_json or {},
        "pallet_position_id": t.pallet_position_id,
        "pallet_position_code": t.pallet_position_code or "",
        "source_pallet_position_id": t.source_pallet_position_id,
        "source_pallet_position_code": t.source_pallet_position_code or "",
        "position_reconciliation": _position_reconciliation_to_dict(t),
    }





def _create_pending_transfer_request(actor, payload):
    raw_payload = _transfer_payload_for_storage(payload)
    raw_payload.pop("_transfer_policy", None)
    lines = raw_payload.get("lines") or []
    summary = _pending_transfer_line_summary(lines)
    pallet_pos_id = raw_payload.get("pallet_position_id") or raw_payload.get("position_id")
    source_pallet_pos_id = raw_payload.get("source_pallet_position_id") or raw_payload.get("source_position_id") or raw_payload.get("from_position_id")

    transfer_stage = str(raw_payload.get("transfer_stage") or "").strip()
    if pallet_pos_id and transfer_stage != TransferWarehouseRule.STAGE_2_TO_FRIDGE:
        raise TransferValidationError("Destination pallet position is only valid for Stage 2.")
    if source_pallet_pos_id and transfer_stage != TransferWarehouseRule.STAGE_3_FROM_FRIDGE:
        raise TransferValidationError("Source pallet position is only valid for Stage 3.")

    with transaction.atomic():
        pending = PendingTransferRequest.objects.create(
            transfer_stage=str(raw_payload.get("transfer_stage") or "").strip(),
            from_warehouse=str(raw_payload.get("from_warehouse") or "").strip(),
            from_bin=str(raw_payload.get("from_bin") or "").strip(),
            to_warehouse=str(raw_payload.get("to_warehouse") or "").strip(),
            to_bin=str(raw_payload.get("to_bin") or "").strip(),
            destination_type=str(raw_payload.get("destination_type") or raw_payload.get("to_destination_type") or "").strip(),
            item_code=summary["item_code"],
            item_name=summary["item_name"],
            batch_number=summary["batch_number"],
            quantity=summary["quantity"],
            lines=lines,
            raw_payload_json=raw_payload,
            status=PendingTransferRequest.PENDING,
            created_by=actor,
        )
        _replace_active_transfer_batch_guards(pending, raw_payload)
        if pallet_pos_id:
            transfer_service.reserve_pallet_position_for_transfer(pending, pallet_pos_id, user=actor)
        if source_pallet_pos_id:
            transfer_service.reserve_source_pallet_position_for_transfer(pending, source_pallet_pos_id, user=actor)
        return pending


def _create_pending_transfer_request_with_retry(actor, payload):
    """Retry SQLite's database-wide writer lock; PostgreSQL uses the unique key directly."""
    attempts = 6 if connection.vendor == "sqlite" else 1
    for attempt in range(attempts):
        try:
            return _create_pending_transfer_request(actor, payload)
        except OperationalError as exc:
            is_sqlite_lock = connection.vendor == "sqlite" and "locked" in str(exc).lower()
            if not is_sqlite_lock or attempt == attempts - 1:
                raise
            time.sleep(0.05 * (attempt + 1))





def _update_pending_transfer_request(pending, payload):

    raw_payload = _transfer_payload_for_storage(payload)
    raw_payload.pop("_transfer_policy", None)

    lines = raw_payload.get("lines") or []

    summary = _pending_transfer_line_summary(lines)



    with transaction.atomic():
        pending.transfer_stage = str(raw_payload.get("transfer_stage") or "").strip()

        pending.from_warehouse = str(raw_payload.get("from_warehouse") or "").strip()

        pending.from_bin = str(raw_payload.get("from_bin") or "").strip()

        pending.to_warehouse = str(raw_payload.get("to_warehouse") or "").strip()

        pending.to_bin = str(raw_payload.get("to_bin") or "").strip()

        pending.destination_type = str(

        raw_payload.get("destination_type") or raw_payload.get("to_destination_type") or ""

        ).strip()

        pending.item_code = summary["item_code"]

        pending.item_name = summary["item_name"]

        pending.batch_number = summary["batch_number"]

        pending.quantity = summary["quantity"]

        pending.lines = lines

        pending.raw_payload_json = raw_payload

        pending.save()
        _replace_active_transfer_batch_guards(pending, raw_payload)

    return pending





def _editable_pending_transfer_payload(pending, data):

    payload = _transfer_payload_for_storage(pending.raw_payload_json or {})

    if not payload:

        payload = {

            "transfer_stage": pending.transfer_stage,

            "from_warehouse": pending.from_warehouse,

            "from_bin": pending.from_bin,

            "to_warehouse": pending.to_warehouse,

            "to_bin": pending.to_bin,

            "destination_type": pending.destination_type,

            "lines": pending.lines or [],

        }



    scalar_fields = {

        "from_warehouse",

        "from_bin",

        "to_warehouse",

        "to_bin",

        "destination_type",

    }

    for field in scalar_fields:

        if field in data:

            payload[field] = str(data.get(field) or "").strip()



    lines = payload.get("lines") or []

    if not isinstance(lines, list):

        raise TransferValidationError("Transfer lines are invalid.")



    if "batch_number" in data:

        submitted_batch = str(data.get("batch_number") or "").strip()

        current_batch = str(pending.batch_number or "").strip()

        if submitted_batch != current_batch:

            raise TransferValidationError("Batch number cannot be edited.")



    if "quantity" in data:

        if len(lines) != 1:

            raise TransferValidationError("Quantity can only be edited for single-line transfers.")

        try:

            qty = float(data.get("quantity"))

        except (TypeError, ValueError):

            raise TransferValidationError("Quantity must be a valid number.")

        if qty <= 0:

            raise TransferValidationError("Quantity must be greater than 0.")

        lines[0]["quantity"] = qty



    payload["lines"] = lines

    return payload





@api_view(["POST"])
@audit_mutation(module=MODULE_TRANSFER, entity_type="PendingTransferRequest", action=ACTION_CREATE, log_success=False)
def transfer_move(request):

    guard = _require_roles(request, {"admin", "transfer"}, "Transfer access required")

    if guard:

        return guard



    try:

        transfer_stage = str(request.data.get("transfer_stage") or "").strip()

        from_warehouse = str(request.data.get("from_warehouse") or "").strip()

        to_warehouse = str(request.data.get("to_warehouse") or "").strip()

        if not _user_can_access_transfer_warehouse(

            request.user,

            from_warehouse,

            TransferWarehouseRule.DIRECTION_FROM,

            transfer_stage,

        ):

            return Response(

                {

                    "success": False,

                    "error": "From warehouse is not assigned to your user.",

                },

                status=status.HTTP_403_FORBIDDEN,

            )

        if not _user_can_access_transfer_warehouse(

            request.user,

            to_warehouse,

            TransferWarehouseRule.DIRECTION_TO,

            transfer_stage,

        ):

            return Response(

                {

                    "success": False,

                    "error": "To warehouse is not assigned to your user.",

                },

                status=status.HTTP_403_FORBIDDEN,

            )

        transfer_service._validate_move_payload(request.data)

        transfer_payload, has_local_only_line = _annotate_transfer_payload_sources(request.data)

        pending = _create_pending_transfer_request_with_retry(request.user, transfer_payload)

        log_action(
            request=request,
            user=request.user,
            action=ACTION_CREATE,
            module=MODULE_TRANSFER,
            entity_type="PendingTransferRequest",
            entity_id=str(pending.id),
            description=f"Created transfer request PTR-{pending.id} ({pending.transfer_stage})",
            details={
                "transfer_stage": pending.transfer_stage,
                "from_warehouse": pending.from_warehouse,
                "from_bin": pending.from_bin,
                "to_warehouse": pending.to_warehouse,
                "to_bin": pending.to_bin,
                "item_code": pending.item_code,
                "batch_number": pending.batch_number,
                "quantity": float(pending.quantity) if pending.quantity else 0.0,
                "source_pallet_position": pending.source_pallet_position_code,
                "target_pallet_position": pending.pallet_position_code,
            },
        )

        return Response({

            "success": True,

            "pending": True,

            "pending_transfer_id": pending.id,

            "status": pending.status,

            "message": (

                "Transfer request submitted. Pending receipt - not posted to SAP yet."

                if has_local_only_line

                else "Transfer submitted for admin review."

            ),

        })

    except (DestinationPositionConflict, ActiveTransferBatchConflict) as exc:
        err_msg = str(exc)
        return Response(
            {"success": False, "error": err_msg, "detail": err_msg},
            status=status.HTTP_409_CONFLICT,
        )

    except TransferValidationError as exc:
        err_msg = str(exc)
        is_conflict = any(k in err_msg.lower() for k in [
            "conflict", "already reserved", "expected occupied", "reserved_outbound", "expected available"
        ])
        status_code = status.HTTP_409_CONFLICT if is_conflict else status.HTTP_400_BAD_REQUEST
        return Response(
            {"success": False, "error": err_msg, "detail": err_msg},
            status=status_code,
        )

    except NotImplementedError as exc:

        return Response({"success": False, "error": str(exc)}, status=501)

    except Exception as exc:

        return format_error_response(exc)





@api_view(["GET"])

def list_pending_transfers(request):

    if not request.user.is_authenticated:

        return JsonResponse({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_transfer(request.user):

        return JsonResponse({"success": False, "error": "Transfer admin access required"}, status=403)



    qs = PendingTransferRequest.objects.select_related(
        "created_by",
        "posted_by",
        "position_reconciliation__source_position",
        "position_reconciliation__destination_position",
    )



    status_value = str(request.query_params.get("status") or "").strip().upper()

    if status_value and status_value != "ALL":

        qs = qs.filter(status=status_value)



    stage = str(request.query_params.get("transfer_stage") or "").strip()

    if stage:

        qs = qs.filter(transfer_stage=stage)



    search = str(request.query_params.get("search") or "").strip()

    if search:

        qs = qs.filter(

            Q(batch_number__icontains=search) |

            Q(item_code__icontains=search) |

            Q(item_name__icontains=search) |

            Q(from_warehouse__icontains=search) |

            Q(to_warehouse__icontains=search) |

            Q(created_by__username__icontains=search)

        )



    refresh_sources = str(

        request.query_params.get("refresh_sources") or "true"

    ).strip().lower() not in {"0", "false", "no", "off"}



    transfers = qs.all()

    return format_success_response({

        "transfers": [

            _pending_transfer_to_dict(t, refresh_sources=refresh_sources)

            for t in transfers

        ],

        "count": transfers.count(),

    })





@api_view(["GET", "PATCH", "DELETE"])
@audit_mutation(
    module=MODULE_TRANSFER,
    entity_type="PendingTransferRequest",
    action=ACTION_UPDATE,
    methods=("PATCH",),
)
@audit_mutation(
    module=MODULE_TRANSFER,
    entity_type="PendingTransferRequest",
    action=ACTION_CANCEL,
    methods=("DELETE",),
    log_success=False,
)
def get_pending_transfer_detail(request, transfer_id):

    if not request.user.is_authenticated:

        return JsonResponse({"success": False, "error": "Authentication required"}, status=401)

    if not can_access_transfer(request.user):

        return JsonResponse({"success": False, "error": "Transfer access required"}, status=403)



    try:

        transfer = PendingTransferRequest.objects.select_related("created_by", "posted_by").get(id=transfer_id)

    except PendingTransferRequest.DoesNotExist:

        return format_error_response("Pending transfer not found", status.HTTP_404_NOT_FOUND)



    if request.method == "DELETE":
        if transfer.status not in [PendingTransferRequest.PENDING, PendingTransferRequest.FAILED]:
            return format_error_response(
                "Only Pending or Failed transfers can be deleted.",
                status.HTTP_400_BAD_REQUEST,
            )

        if transfer.pallet_position_id:
            try:
                transfer_service.release_pallet_position_for_transfer(transfer, user=request.user)
            except Exception as exc:
                return format_error_response(str(exc), status.HTTP_400_BAD_REQUEST)

        if transfer.source_pallet_position_id:
            try:
                transfer_service.release_source_pallet_position_for_transfer(transfer, user=request.user)
            except Exception as exc:
                return format_error_response(str(exc), status.HTTP_400_BAD_REQUEST)

        transfer_id_str = str(transfer.id)
        tr_stage = transfer.transfer_stage
        from_wh = transfer.from_warehouse
        to_wh = transfer.to_warehouse
        batch_num = transfer.batch_number

        transfer.delete()

        log_action(
            request=request,
            user=request.user,
            action=ACTION_CANCEL,
            module=MODULE_TRANSFER,
            entity_type="PendingTransferRequest",
            entity_id=transfer_id_str,
            description=f"Cancelled transfer request PTR-{transfer_id_str}",
            details={
                "transfer_stage": tr_stage,
                "from_warehouse": from_wh,
                "to_warehouse": to_wh,
                "batch_number": batch_num,
            },
        )

        return format_success_response(
            {"deleted_transfer_id": transfer_id},
            "Transfer request deleted.",
        )



    if request.method == "PATCH":

        if transfer.status not in [PendingTransferRequest.PENDING, PendingTransferRequest.FAILED]:

            return format_error_response(

                "Only Pending or Failed transfers can be edited.",

                status.HTTP_400_BAD_REQUEST,

            )



        try:

            payload = _editable_pending_transfer_payload(transfer, request.data)

            transfer_stage = str(payload.get("transfer_stage") or "").strip()

            from_warehouse = str(payload.get("from_warehouse") or "").strip()

            to_warehouse = str(payload.get("to_warehouse") or "").strip()

            if not _user_can_access_transfer_warehouse(

                request.user,

                from_warehouse,

                TransferWarehouseRule.DIRECTION_FROM,

                transfer_stage,

            ):

                return format_error_response(

                    "From warehouse is not assigned to your user.",

                    status.HTTP_403_FORBIDDEN,

                )

            if not _user_can_access_transfer_warehouse(

                request.user,

                to_warehouse,

                TransferWarehouseRule.DIRECTION_TO,

                transfer_stage,

            ):

                return format_error_response(

                    "To warehouse is not assigned to your user.",

                    status.HTTP_403_FORBIDDEN,

                )

            transfer_service._validate_move_payload(payload, stored_contract=True)

            payload, _ = _annotate_transfer_payload_sources(

                payload,

                exclude_transfer_id=transfer.id,

            )

            transfer = _update_pending_transfer_request(transfer, payload)

            return format_success_response(

                {"transfer": _pending_transfer_to_dict(transfer)},

                "Transfer request updated.",

            )

        except (DestinationPositionConflict, ActiveTransferBatchConflict) as exc:

            return format_error_response(str(exc), status.HTTP_409_CONFLICT)

        except TransferValidationError as exc:

            return format_error_response(str(exc), status.HTTP_400_BAD_REQUEST)

        except Exception as exc:

            return format_error_response(str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)



    return format_success_response({"transfer": _pending_transfer_to_dict(transfer)})





class PendingTransferPostingConflict(Exception):
    """Raised when a pending transfer cannot be claimed for SAP posting."""


class SAPPostingConfirmedLocalError(Exception):
    """SAP succeeded; a later local persistence/finalization step failed."""

    def __init__(self, transfer_id, sap_doc_entry, sap_doc_num, cause):
        super().__init__(str(cause))
        self.transfer_id = transfer_id
        self.sap_doc_entry = str(sap_doc_entry or "")
        self.sap_doc_num = str(sap_doc_num or "")


def _claim_pending_transfer_for_posting(pending_id, actor):
    """Atomically claim one postable transfer without holding a lock during SAP I/O."""
    with transaction.atomic():
        pending = PendingTransferRequest.objects.select_for_update().get(id=pending_id)

        if pending.status == PendingTransferRequest.POSTED:
            raise PendingTransferPostingConflict(
                "This transfer has already been posted to SAP."
            )
        if pending.status == PendingTransferRequest.POSTING:
            raise PendingTransferPostingConflict(
                "This transfer is already being posted to SAP."
            )
        if pending.status not in [PendingTransferRequest.PENDING, PendingTransferRequest.FAILED]:
            raise PendingTransferPostingConflict("This transfer is not available for posting.")

        if not pending.active_batch_guards.exists():
            _replace_active_transfer_batch_guards(pending, pending.raw_payload_json or {})

        claimed = PendingTransferRequest.objects.filter(
            id=pending.id,
            status=pending.status,
        ).update(
            status=PendingTransferRequest.POSTING,
            posted_by=actor,
            error_message="",
        )
        if claimed != 1:
            raise PendingTransferPostingConflict(
                "This transfer is already being posted to SAP."
            )

        pending.refresh_from_db()
        return pending


def _create_position_reconciliation_intent(pending):
    if not pending.pallet_position_id and not pending.source_pallet_position_id:
        return None

    reconciliation, _ = TransferPositionReconciliation.objects.update_or_create(
        transfer=pending,
        defaults={
            "sap_doc_entry": pending.sap_doc_entry,
            "sap_doc_num": pending.sap_doc_num,
            "source_position_id": pending.source_pallet_position_id,
            "source_position_code": pending.source_pallet_position_code or "",
            "destination_position_id": pending.pallet_position_id,
            "destination_position_code": pending.pallet_position_code or "",
            "expected_source_state": "AVAILABLE" if pending.source_pallet_position_id else "",
            "expected_destination_state": "OCCUPIED" if pending.pallet_position_id else "",
            "source_completed": not bool(pending.source_pallet_position_id),
            "destination_completed": not bool(pending.pallet_position_id),
            "status": TransferPositionReconciliation.PENDING,
            "failure_reason": "",
            "completed_at": None,
        },
    )
    return reconciliation


def _reconcile_transfer_positions(transfer_id, actor=None):
    """Repair local physical state after confirmed SAP success; never calls SAP."""
    with transaction.atomic():
        reconciliation = (
            TransferPositionReconciliation.objects
            .select_for_update()
            .get(transfer_id=transfer_id)
        )
        transfer = PendingTransferRequest.objects.select_for_update().get(id=transfer_id)

        if transfer.status != PendingTransferRequest.POSTED:
            raise TransferValidationError(
                "Position reconciliation is only allowed after confirmed SAP posting."
            )
        if not transfer.sap_doc_entry and not transfer.sap_doc_num:
            raise TransferValidationError(
                "Position reconciliation requires confirmed SAP document identifiers."
            )
        if reconciliation.status == TransferPositionReconciliation.COMPLETED:
            return reconciliation

        reconciliation.attempt_count += 1
        reconciliation.last_attempt_at = datetime.datetime.now(tz=datetime.timezone.utc)
        reconciliation.save(update_fields=["attempt_count", "last_attempt_at", "updated_at"])
        destination_needed = not reconciliation.destination_completed and bool(reconciliation.destination_position_id)
        source_needed = not reconciliation.source_completed and bool(reconciliation.source_position_id)

    failures = []
    destination_completed = not destination_needed
    source_completed = not source_needed

    if destination_needed:
        try:
            # A savepoint contains genuine database exceptions so the later
            # durable failure update always runs on a usable connection.
            with transaction.atomic():
                transfer_service.occupy_pallet_position_for_transfer(transfer, user=actor)
            destination_completed = True
        except Exception as exc:
            failures.append(f"Destination position: {exc}")

    if source_needed:
        try:
            with transaction.atomic():
                transfer_service.vacate_source_pallet_position_for_transfer(transfer, user=actor)
            source_completed = True
        except Exception as exc:
            failures.append(f"Source position: {exc}")

    with transaction.atomic():
        reconciliation = TransferPositionReconciliation.objects.select_for_update().get(
            transfer_id=transfer_id
        )
        transfer = PendingTransferRequest.objects.select_for_update().get(id=transfer_id)
        if destination_completed:
            reconciliation.destination_completed = True
        if source_completed:
            reconciliation.source_completed = True
        reconciliation.failure_reason = " | ".join(failures)
        if reconciliation.source_completed and reconciliation.destination_completed:
            reconciliation.status = TransferPositionReconciliation.COMPLETED
            reconciliation.completed_at = reconciliation.last_attempt_at
            if transfer.error_message.startswith("[POSITION-RECONCILIATION]"):
                transfer.error_message = ""
        else:
            reconciliation.status = TransferPositionReconciliation.PENDING
            transfer.error_message = (
                "[POSITION-RECONCILIATION] SAP posted successfully; local physical-position "
                f"finalization requires reconciliation: {reconciliation.failure_reason}"
            )

        reconciliation.save()
        transfer.save(update_fields=["error_message", "updated_at"])
        return reconciliation


def _post_pending_transfer_record(pending, actor):
    if pending.transfer_stage == TransferWarehouseRule.STAGE_3_FROM_FRIDGE and not transfer_service.use_mock:
        from .services.transfer_destination_bins import validate_destination_bin
        validate_destination_bin(transfer_service.sap_client, pending.raw_payload_json or {})

    transfer_service.validate_stage2_destination_position(
        {
            "transfer_stage": pending.transfer_stage,
            "to_warehouse": pending.to_warehouse,
            "to_bin": pending.to_bin,
        },
        position_id=pending.pallet_position_id,
        expected_transfer_reference=(f"PTR-{pending.id}" if pending.pallet_position_id else None),
    )

    pending = _claim_pending_transfer_for_posting(pending.id, actor)

    payload = pending.raw_payload_json or {}

    _assert_transfer_payload_sap_available(payload)

    if pending.source_pallet_position_id:
        from .models_cold_storage import ColdStoragePalletPosition
        source_position = ColdStoragePalletPosition.objects.get(id=pending.source_pallet_position_id)
        if source_position.status == ColdStoragePalletPosition.OCCUPIED:
            # A definitive earlier rejection released the physical position.
            # Reclaim it before retrying SAP; an ambiguous outcome stays reserved.
            transfer_service.reserve_source_pallet_position_for_transfer(
                pending, source_position.id, user=actor,
            )

    result = transfer_service.move_inventory(payload)

    now = datetime.datetime.now(tz=datetime.timezone.utc)
    sap_doc_entry = str(result.get("sap_doc_entry") or "")
    sap_doc_num = str(result.get("sap_doc_num") or "")

    # Commit confirmed SAP success independently of all subsequent local
    # reconciliation work. Nothing after this boundary may downgrade POSTED.
    try:
        with transaction.atomic():
            pending = PendingTransferRequest.objects.select_for_update().get(id=pending.id)
            pending.status = PendingTransferRequest.POSTED
            pending.posted_by = actor
            pending.posted_at = now
            pending.sap_doc_entry = sap_doc_entry
            pending.sap_doc_num = sap_doc_num
            pending.error_message = ""
            pending.save()
            pending.active_batch_guards.all().delete()

        reconciliation = _create_position_reconciliation_intent(pending)

        if reconciliation:
            _reconcile_transfer_positions(pending.id, actor=actor)
            pending.refresh_from_db()
    except Exception as exc:
        raise SAPPostingConfirmedLocalError(
            pending.id, sap_doc_entry, sap_doc_num, exc
        ) from exc

    return pending


def _recover_confirmed_sap_posting(exc, actor):
    """Persist the irreversible SAP-success fact without retrying SAP."""
    with transaction.atomic():
        pending = PendingTransferRequest.objects.select_for_update().get(id=exc.transfer_id)
        pending.status = PendingTransferRequest.POSTED
        pending.posted_by = actor
        pending.posted_at = pending.posted_at or datetime.datetime.now(tz=datetime.timezone.utc)
        pending.sap_doc_entry = exc.sap_doc_entry
        pending.sap_doc_num = exc.sap_doc_num
        pending.error_message = (
            "[POSITION-RECONCILIATION] SAP posted successfully; local finalization "
            f"requires reconciliation: {exc}"
        )
        pending.save()
        pending.active_batch_guards.all().delete()

    reconciliation = _create_position_reconciliation_intent(pending)
    if reconciliation:
        reconciliation.failure_reason = str(exc)
        reconciliation.status = TransferPositionReconciliation.PENDING
        reconciliation.save(update_fields=["failure_reason", "status", "updated_at"])
    return pending





def _mark_pending_transfer_failed(pending, actor, error_text, definitive=False):
    """Fail posting; release Stage 3 only when SAP explicitly rejected it.

    A timeout/transport error can mean SAP committed without a response, so its
    source stays RESERVED_OUTBOUND for investigation. Confirmed SAP success is
    handled separately as POSTED with position reconciliation.
    """
    original = pending
    with transaction.atomic():
        pending = PendingTransferRequest.objects.select_for_update().get(id=pending.id)
        if pending.status == PendingTransferRequest.POSTED:
            original.refresh_from_db()
            return original
        if definitive and pending.source_pallet_position_id:
            from .models_cold_storage import ColdStoragePalletPosition
            position = ColdStoragePalletPosition.objects.select_for_update().get(
                id=pending.source_pallet_position_id,
            )
            if position.status == ColdStoragePalletPosition.RESERVED_OUTBOUND:
                if position.reservation_reference != f"OUTBOUND: PTR-{pending.id}":
                    raise TransferValidationError(
                        "Source position reservation belongs to another transfer."
                    )
                # Keep the pending transfer's position snapshot for a safe retry.
                # The model release preserves batch and transfer metadata.
                ColdStoragePalletPosition.release_outbound_reservation(
                    position_id=position.id, user=actor,
                )
        pending.status = PendingTransferRequest.FAILED
        pending.posted_by = actor
        pending.error_message = error_text
        pending.save()
        if not pending.active_batch_guards.exists():
            _replace_active_transfer_batch_guards(pending, pending.raw_payload_json or {})
        original.refresh_from_db()
        return original





def _pending_transfer_batch_numbers(pending):

    batches = {

        _normalize_transfer_batch_number(pending.batch_number),

    }

    batches.update(

        _normalize_transfer_batch_number(

            line.get("batch_number") or line.get("batchNumber")

        )

        for line in (pending.lines or [])

    )

    return {batch for batch in batches if batch}





def _pending_transfer_explicit_dependency_ids(pending):

    dependency_ids = set()

    for line in pending.lines or []:

        value = line.get("source_transfer_id") or line.get("sourceTransferId")

        try:

            dependency_ids.add(int(value))

        except (TypeError, ValueError):

            continue

    return dependency_ids





def _selected_transfer_dependencies(selected):

    by_id = {pending.id: pending for pending in selected}

    dependencies = {pending.id: set() for pending in selected}

    external_dependencies = {pending.id: set() for pending in selected}



    for pending in selected:

        explicit_ids = _pending_transfer_explicit_dependency_ids(pending)

        for dependency_id in explicit_ids:

            if dependency_id in by_id:

                dependencies[pending.id].add(dependency_id)

            else:

                external_dependencies[pending.id].add(dependency_id)



        if explicit_ids:

            continue



        pending_batches = _pending_transfer_batch_numbers(pending)

        source_whs = str(pending.from_warehouse or "").strip().lower()

        if not pending_batches or not source_whs:

            continue

        for candidate in selected:

            if candidate.id == pending.id:

                continue

            destination_whs = str(candidate.to_warehouse or "").strip().lower()

            if destination_whs != source_whs:

                continue

            if pending_batches & _pending_transfer_batch_numbers(candidate):

                dependencies[pending.id].add(candidate.id)



    return dependencies, external_dependencies





def _ordered_selected_transfers(selected, dependencies):

    by_id = {pending.id: pending for pending in selected}

    remaining = {transfer_id: set(values) for transfer_id, values in dependencies.items()}

    ordered = []



    while remaining:

        ready = sorted(

            (

                transfer_id

                for transfer_id, dependency_ids in remaining.items()

                if not dependency_ids

            ),

            key=lambda transfer_id: (

                by_id[transfer_id].created_at,

                transfer_id,

            ),

        )

        if not ready:

            break

        for transfer_id in ready:

            ordered.append(by_id[transfer_id])

            remaining.pop(transfer_id)

        for dependency_ids in remaining.values():

            dependency_ids.difference_update(ready)



    cyclic_ids = set(remaining)

    return ordered, cyclic_ids





@api_view(["POST"])
@audit_mutation(module=MODULE_TRANSFER, entity_type="PendingTransferRequestBulk", action=ACTION_POST)
def post_selected_pending_transfers(request):

    if not request.user.is_authenticated:

        return JsonResponse({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_transfer(request.user):

        return JsonResponse({"success": False, "error": "Transfer admin access required"}, status=403)



    raw_ids = request.data.get("transfer_ids") or []

    if not isinstance(raw_ids, list):

        return format_error_response("transfer_ids must be a list.", status.HTTP_400_BAD_REQUEST)

    try:

        transfer_ids = list(dict.fromkeys(int(value) for value in raw_ids))

    except (TypeError, ValueError):

        return format_error_response("transfer_ids must contain valid IDs.", status.HTTP_400_BAD_REQUEST)

    if not transfer_ids:

        return format_error_response("Select at least one transfer.", status.HTTP_400_BAD_REQUEST)



    selected = list(

        PendingTransferRequest.objects

        .filter(

            id__in=transfer_ids,

            status__in=[PendingTransferRequest.PENDING, PendingTransferRequest.FAILED],

        )

        .order_by("created_at", "id")

    )

    selected_ids = {pending.id for pending in selected}

    missing_ids = [transfer_id for transfer_id in transfer_ids if transfer_id not in selected_ids]

    if missing_ids:

        return format_error_response(

            f"Transfers are missing or not postable: {', '.join(map(str, missing_ids))}.",

            status.HTTP_400_BAD_REQUEST,

        )



    dependencies, external_dependencies = _selected_transfer_dependencies(selected)

    ordered, cyclic_ids = _ordered_selected_transfers(selected, dependencies)

    outcomes = {}

    results = []



    for pending in ordered:

        failed_dependencies = [

            dependency_id

            for dependency_id in dependencies[pending.id]

            if outcomes.get(dependency_id) != "POSTED"

        ]

        unresolved_external = []

        if external_dependencies[pending.id]:

            posted_external_ids = set(

                PendingTransferRequest.objects.filter(

                    id__in=external_dependencies[pending.id],

                    status=PendingTransferRequest.POSTED,

                ).values_list("id", flat=True)

            )

            unresolved_external = sorted(

                external_dependencies[pending.id] - posted_external_ids

            )



        if failed_dependencies or unresolved_external:

            blocked_by = failed_dependencies + unresolved_external

            outcomes[pending.id] = "SKIPPED"

            results.append({

                "id": pending.id,

                "status": "SKIPPED",

                "blocked_by": blocked_by,

                "error": (

                    "Not processed because prerequisite transfer(s) "

                    f"{', '.join(map(str, blocked_by))} did not post successfully."

                ),

            })

            continue



        try:

            pending = _post_pending_transfer_record(pending, request.user)

            outcomes[pending.id] = "POSTED"

            results.append({

                "id": pending.id,

                "status": "POSTED",

                "transfer": _pending_transfer_to_dict(pending),

            })

        except SAPPostingConfirmedLocalError as exc:
            pending = _recover_confirmed_sap_posting(exc, request.user)
            outcomes[pending.id] = "POSTED"
            results.append({
                "id": pending.id,
                "status": "POSTED",
                "warning": (
                    "SAP posting succeeded, but local finalization requires reconciliation: "
                    f"{exc}"
                ),
                "transfer": _pending_transfer_to_dict(pending),
            })

        except PendingTransferPostingConflict as exc:

            outcomes[pending.id] = "SKIPPED"

            results.append({

                "id": pending.id,

                "status": "SKIPPED",

                "error": str(exc),

            })

        except DestinationSAPBinError as exc:
            outcomes[pending.id] = 'SKIPPED'
            results.append({'id': pending.id, 'status': 'SKIPPED', 'error': str(exc)})

        except Exception as exc:

            error_text = str(exc)
            pending.refresh_from_db()
            if pending.status == PendingTransferRequest.POSTED:
                outcomes[pending.id] = "POSTED"
                results.append({
                    "id": pending.id,
                    "status": "POSTED",
                    "warning": (
                        "SAP posting succeeded, but local finalization requires reconciliation: "
                        f"{error_text}"
                    ),
                    "transfer": _pending_transfer_to_dict(pending),
                })
            else:
                pending = _mark_pending_transfer_failed(
                    pending, request.user, error_text,
                    definitive=isinstance(exc, DefinitiveSAPPostingFailure),
                )
                outcomes[pending.id] = "FAILED"
                results.append({
                    "id": pending.id,
                    "status": "FAILED",
                    "error": error_text,
                    "transfer": _pending_transfer_to_dict(pending),
                })



    for transfer_id in sorted(cyclic_ids):

        outcomes[transfer_id] = "SKIPPED"

        results.append({

            "id": transfer_id,

            "status": "SKIPPED",

            "blocked_by": sorted(dependencies[transfer_id]),

            "error": "Not processed because the selected transfers contain a dependency cycle.",

        })



    return format_success_response({

        "results": results,

        "posted_count": sum(result["status"] == "POSTED" for result in results),

        "failed_count": sum(result["status"] == "FAILED" for result in results),

        "skipped_count": sum(result["status"] == "SKIPPED" for result in results),

    })





@api_view(["POST"])
@audit_mutation(module=MODULE_TRANSFER, entity_type="PendingTransferRequest", action=ACTION_POST, log_success=False)
def post_pending_transfer(request, transfer_id):

    if not request.user.is_authenticated:

        return JsonResponse({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_transfer(request.user):

        return JsonResponse({"success": False, "error": "Transfer admin access required"}, status=403)



    try:

        pending = PendingTransferRequest.objects.get(id=transfer_id)

    except PendingTransferRequest.DoesNotExist:

        return format_error_response("Pending transfer not found", status.HTTP_404_NOT_FOUND)



    if pending.status == PendingTransferRequest.POSTED:

        return format_error_response("This transfer has already been posted to SAP.", status.HTTP_400_BAD_REQUEST)



    try:

        pending = _post_pending_transfer_record(pending, request.user)

        log_action(
            request=request,
            user=request.user,
            action=ACTION_POST,
            module=MODULE_TRANSFER,
            entity_type="PendingTransferRequest",
            entity_id=str(pending.id),
            description=f"Posted transfer PTR-{pending.id} to SAP (#{pending.sap_doc_num})",
            details={
                "sap_doc_num": pending.sap_doc_num,
                "sap_doc_entry": pending.sap_doc_entry,
                "from_warehouse": pending.from_warehouse,
                "to_warehouse": pending.to_warehouse,
                "batch_number": pending.batch_number,
                "quantity": float(pending.quantity) if pending.quantity else 0.0,
            },
        )

        return format_success_response(

            _pending_transfer_to_dict(pending),

            "Transfer posted to SAP.",

        )

    except SAPPostingConfirmedLocalError as exc:
        pending = _recover_confirmed_sap_posting(exc, request.user)
        return format_success_response(
            _pending_transfer_to_dict(pending),
            "SAP posting succeeded; local finalization requires reconciliation.",
        )

    except PendingTransferPostingConflict as exc:

        return format_error_response(str(exc), status.HTTP_409_CONFLICT)

    except DestinationPositionConflict as exc:

        return format_error_response(str(exc), status.HTTP_409_CONFLICT)

    except DestinationSAPBinError as exc:
        return format_error_response(str(exc), status.HTTP_400_BAD_REQUEST)

    except Exception as exc:

        error_text = str(exc)
        definitive_failure = isinstance(exc, DefinitiveSAPPostingFailure)

        pending.refresh_from_db()
        if pending.status == PendingTransferRequest.POSTED:
            return format_success_response(
                _pending_transfer_to_dict(pending),
                "SAP posting succeeded; local finalization requires reconciliation.",
            )

        log_action(
            request=request,
            user=request.user,
            action=ACTION_POST,
            module=MODULE_TRANSFER,
            entity_type="PendingTransferRequest",
            entity_id=str(pending.id),
            status="FAILED",
            description=f"Failed posting transfer PTR-{pending.id} to SAP: {error_text}",
            details={"error": error_text},
        )

    pending = _mark_pending_transfer_failed(
        pending, request.user, error_text,
        definitive=definitive_failure,
    )

    return Response(

        {

            "success": False,

            "error": error_text,

            "data": {"transfer": _pending_transfer_to_dict(pending)},

        },

        status=status.HTTP_400_BAD_REQUEST,

    )


@api_view(["POST"])
@audit_mutation(
    module=MODULE_TRANSFER,
    entity_type="TransferPositionReconciliation",
    action=ACTION_RECONCILE,
    log_success=False,
    log_failure=False,
)
def reconcile_pending_transfer_positions(request, transfer_id):
    """Retry local physical-position finalization after confirmed SAP success."""
    if not request.user.is_authenticated:
        return JsonResponse({"success": False, "error": "Authentication required"}, status=401)
    if not can_manage_transfer(request.user):
        return JsonResponse({"success": False, "error": "Transfer admin access required"}, status=403)

    try:
        reconciliation = _reconcile_transfer_positions(transfer_id, actor=request.user)
    except PendingTransferRequest.DoesNotExist:
        log_action(
            request=request,
            user=request.user,
            action=ACTION_RECONCILE,
            module=MODULE_TRANSFER,
            entity_type="TransferPositionReconciliation",
            entity_id=str(transfer_id),
            status="FAILED",
            description=f"Manual position reconciliation failed for PTR-{transfer_id}",
            details={"reconciliation_status": "TRANSFER_NOT_FOUND"},
        )
        return format_error_response("Pending transfer not found", status.HTTP_404_NOT_FOUND)
    except TransferPositionReconciliation.DoesNotExist:
        log_action(
            request=request,
            user=request.user,
            action=ACTION_RECONCILE,
            module=MODULE_TRANSFER,
            entity_type="TransferPositionReconciliation",
            entity_id=str(transfer_id),
            status="FAILED",
            description=f"Manual position reconciliation failed for PTR-{transfer_id}",
            details={"reconciliation_status": "NOT_RECORDED"},
        )
        return format_error_response(
            "No position reconciliation is recorded for this transfer.",
            status.HTTP_404_NOT_FOUND,
        )
    except TransferValidationError as exc:
        log_action(
            request=request,
            user=request.user,
            action=ACTION_RECONCILE,
            module=MODULE_TRANSFER,
            entity_type="TransferPositionReconciliation",
            entity_id=str(transfer_id),
            status="FAILED",
            description=f"Manual position reconciliation rejected for PTR-{transfer_id}",
            details={"reconciliation_status": "INELIGIBLE"},
        )
        return format_error_response(str(exc), status.HTTP_409_CONFLICT)

    transfer = PendingTransferRequest.objects.get(id=transfer_id)
    audit_status = "SUCCESS" if reconciliation.status == TransferPositionReconciliation.COMPLETED else "WARNING"
    log_action(
        request=request,
        user=request.user,
        action=ACTION_RECONCILE,
        module=MODULE_TRANSFER,
        entity_type="TransferPositionReconciliation",
        entity_id=str(transfer_id),
        status=audit_status,
        description=f"Manual position reconciliation for PTR-{transfer_id}: {reconciliation.status}",
        details={
            "reconciliation_status": reconciliation.status,
            "source_completed": reconciliation.source_completed,
            "destination_completed": reconciliation.destination_completed,
            "attempt_count": reconciliation.attempt_count,
            "sap_doc_entry": reconciliation.sap_doc_entry,
            "sap_doc_num": reconciliation.sap_doc_num,
        },
    )
    if reconciliation.status != TransferPositionReconciliation.COMPLETED:
        return Response(
            {
                "success": False,
                "error": reconciliation.failure_reason,
                "data": {"transfer": _pending_transfer_to_dict(transfer)},
            },
            status=status.HTTP_409_CONFLICT,
        )

    return format_success_response(
        _pending_transfer_to_dict(transfer),
        "Physical positions reconciled successfully.",
    )





# ========== Production Orders ==========

_STATUS_NAMES = {

    "R": "Released",

    "L": "Planned",

    "P": "Planned",

    "C": "Closed",

    "X": "Cancelled",

}





@api_view(["GET"])

def get_open_production_orders(request):

    try:

        rows = sap.get_open_production_orders()

        orders = []

        for row in rows:

            planned = row.get("PlannedQty") or 0

            # completedQty may come aliased or as CmpltQty depending on SAP version

            completed = row.get("completedQty") or row.get("CmpltQty") or 0

            # remainingQty: use SQL-computed value if present, else compute in Python

            remaining = row.get("remainingQty")

            if remaining is None:

                remaining = planned - completed

            raw_status = row.get("Status") or ""

            orders.append({

                "docEntry": row.get("DocEntry"),

                "orderNumber": row.get("orderNumber") or row.get("DocNum"),

                "itemCode": row.get("ItemCode"),

                "itemName": row.get("itemName") or row.get("ProdName"),

                "plannedQty": planned,

                "completedQty": completed,

                "remainingQty": remaining,

                "warehouse": row.get("Warehouse"),

                "location": row.get("location") or row.get("OcrCode"),

                "postDate": row.get("PostDate"),

                "dueDate": row.get("DueDate"),

                "status": raw_status,

                "statusName": row.get("statusName") or _STATUS_NAMES.get(raw_status, raw_status or "Unknown"),

            })



        print(f"[OPEN-ORDERS] count={len(orders)}")

        if orders:

            print(f"[OPEN-ORDERS] first3={json.dumps(orders[:3], default=str)}")

        return format_success_response({"count": len(orders), "orders": orders})

    except Exception as e:

        import traceback

        print(f"[OPEN-ORDERS] EXCEPTION type={type(e).__name__} msg={e}")

        print(f"[OPEN-ORDERS] TRACEBACK:\n{traceback.format_exc()}")

        return format_error_response(e)





@api_view(["GET"])

def get_production_orders(request):

    try:

        status_filter = request.query_params.get("status")

        result = sap.get_production_orders(status_filter)

        orders = result.get("value", result)

        return format_success_response(

            {"count": len(orders) if isinstance(orders, list) else 0, "orders": orders}

        )

    except Exception as e:

        return format_error_response(e)





@api_view(["GET"])

def get_production_order_by_number(request, doc_number):

    try:

        search_fields = ["DocumentNumber", "DocNum", "AbsoluteEntry"]

        for field in search_fields:

            endpoint = f"ProductionOrders?$filter={field} eq {doc_number}"

            result = sap._request("GET", endpoint)

            orders = result.get("value", [])

            if orders and len(orders) > 0:

                return format_success_response(

                    {"order": orders[0], "matched_by": field}

                )

        return format_error_response(

            f"Production Order {doc_number} not found", status.HTTP_404_NOT_FOUND

        )

    except Exception as e:

        return format_error_response(e)





@api_view(["GET"])

def get_production_order(request, doc_entry):

    try:

        result = sap.get_production_order(doc_entry)
        if isinstance(result, dict) and "ProductionOrderLines" in result:
            lines = result.get("ProductionOrderLines") or []
            item_codes = list({str(l.get("ItemNo") or "").strip() for l in lines if l.get("ItemNo")})
            if item_codes:
                flags_map = sap.get_item_tracking_flags_bulk(item_codes)
                for l in lines:
                    code = str(l.get("ItemNo") or "").strip()
                    flags = flags_map.get(code, {})
                    l["ManageBatchNumbers"] = "tYES" if flags.get("manage_batches") else "tNO"
                    l["ManageSerialNumbers"] = "tYES" if flags.get("manage_serials") else "tNO"

        return format_success_response({"order": result})

    except Exception as e:

        return format_error_response(e)





@api_view(["POST"])
@audit_mutation(module=MODULE_PRODUCTION_RECEIPT, entity_type="ProductionOrder", action=ACTION_UPDATE)
def close_production_order(request, doc_entry):

    try:

        result = sap.close_production_order(doc_entry)

        return format_success_response(

            result, f"Production order {doc_entry} closed successfully"

        )

    except Exception as e:

        return format_error_response(e)





# ========== Receipts ==========

@api_view(["GET"])

def get_receipts(request):

    try:

        from_date = request.query_params.get("from_date")

        to_date = request.query_params.get("to_date")

        result = sap.get_receipts(from_date, to_date)

        receipts = result.get("value", result)

        return format_success_response(

            {

                "count": len(receipts) if isinstance(receipts, list) else 0,

                "receipts": receipts,

            }

        )

    except Exception as e:

        return format_error_response(e)





@api_view(["POST"])
@audit_mutation(module=MODULE_PRODUCTION_RECEIPT, entity_type="ProductionReceipt", action=ACTION_POST)
def create_receipt_legacy(request):

    """إنشاء استلام إنتاج جديد وإرساله لـ SAP"""

    try:

        receipt_data = request.data



        # تجهيز الـ payload لـ SAP

        sap_payload = {

            "ProductionOrder": receipt_data.get("ProductionOrderEntry"),

            "Series": receipt_data.get("Series"),

            "DocumentDate": receipt_data.get("DocumentDate"),

            "PostingDate": receipt_data.get("PostingDate"),

            "Warehouse": receipt_data.get("Warehouse"),

            "Remarks": receipt_data.get("Remarks", ""),

            "JournalRemarks": "Receipt from Production",

            "DocumentLines": [],

            "BinAllocations": [],

        }



        # إضافة سطور الاستلام والـ Bin Allocations

        for i, batch in enumerate(receipt_data.get("Batches", [])):

            # سطر الاستلام

            line = {

                "LineNum": i,

                "ItemCode": receipt_data.get("ItemCode") or receipt_data.get("ItemNo"),

                "Quantity": float(batch.get("quantity", 0)),

                "WarehouseCode": receipt_data.get("Warehouse"),

            }



            # إضافة Batch Number إذا كان موجود

            if batch.get("batchNumber"):

                line["BatchNumbers"] = [

                    {

                        "BatchNumber": batch.get("batchNumber"),

                        "Quantity": float(batch.get("quantity", 0)),

                    }

                ]



            sap_payload["DocumentLines"].append(line)



            # إضافة Bin Allocation

            bin_code = batch.get("binLocationCode") or batch.get("binLocation")

            if bin_code:

                sap_payload["BinAllocations"].append(

                    {

                        "LineNum": i,

                        "BinCode": bin_code,  # استخدام BinCode مباشرة

                        "Quantity": float(batch.get("quantity", 0)),

                        "AllowNegativeQuantity": "tNO",

                    }

                )





        # إرسال إلى SAP Service Layer

        result = sap.create_receipt_from_production(sap_payload)

        print(f"📥 SAP Response: {result}")



        # التحقق من نجاح العملية

        if result.get("error"):

            return format_error_response(

                result.get("error"), status.HTTP_400_BAD_REQUEST

            )



        return format_success_response(result, "Receipt created successfully in SAP")



    except Exception as e:

        print(f"❌ Error: {str(e)}")

        return format_error_response(str(e), status.HTTP_500_INTERNAL_SERVER_ERROR)





# ========== Inventory ==========

@api_view(["GET"])

def get_item_stock(request, item_code):

    try:

        result = sap.get_item_stock(item_code)

        return format_success_response(result)

    except Exception as e:

        return format_error_response(e)





@api_view(["GET"])

def get_low_stock_items(request):

    try:

        threshold = request.query_params.get("threshold", 10)

        result = sap.get_low_stock_items(int(threshold))

        items = result.get("value", result)

        return format_success_response(

            {"count": len(items) if isinstance(items, list) else 0, "items": items}

        )

    except Exception as e:

        return format_error_response(e)





# ========== Item Information ==========

@api_view(["GET"])

def get_item_name_only(request, item_code):

    try:

        item_name = sap.get_item_name(item_code)

        return format_success_response({"item_code": item_code, "item_name": item_name})

    except Exception as e:

        return format_error_response(e)





@api_view(["GET"])

def get_item_details_api(request, item_code):

    try:

        result = sap.get_item_details(item_code)

        if result.get("success"):

            return format_success_response(result)

        return format_error_response(result.get("error", "Unknown error"))

    except Exception as e:

        return format_error_response(e)





# ========== Warehouses & Bin Locations ==========

@api_view(["GET"])

def get_warehouses(request):

    """جلب قائمة المخازن من SAP"""

    policy_options = request.query_params.get("policy_options") == "true"
    if policy_options and not can_manage_transfer(request.user):
        return Response({"error": "Transfer Admin access required."}, status=403)
    from .services.master_data_search import is_lookup, lookup_response
    if is_lookup(request):
        return lookup_response(request, sap, "warehouses", "warehouses", wrapped=True)
    cache_key = (build_cache_key(sap_master_namespace("warehouses"), "policy-options")
                 if policy_options else build_cache_key(sap_master_namespace("warehouses")))

    cached = cache_get(cache_key)

    if cached is not None:

        return format_success_response(cached)



    try:

        result = sap.get_warehouses()



        if isinstance(result, dict) and result.get("error"):

            if policy_options:
                return Response({"error": "SAP warehouse master data is unavailable."}, status=503)
            return format_success_response({"warehouses": []})



        warehouses = result.get("value", [])

        payload = {

            "warehouses": [

                {"code": w.get("WarehouseCode"), "name": w.get("WarehouseName"),
                 **({"inactive": (False if w.get("Inactive") in ["tNO", False] else True if w.get("Inactive") in ["tYES", True] else None)} if policy_options else {})}

                for w in warehouses

            ]

        }

        cache_set(sap_master_namespace("warehouses"), cache_key, payload, "sap_warehouses")

        return format_success_response(payload)

    except Exception as e:
        if policy_options:
            return Response({"error": "SAP warehouse master data is unavailable."}, status=503)
        return format_error_response(e)





@api_view(["GET"])

def get_tax_codes(request):

    """

    Fetch valid Tax Codes from SAP. Purchase/Input remains the default for GRPO;
    ``?category=sales`` returns Sales/Output codes for sales documents.

    Returns:

      - TaxCode (string, e.g. "XM")

      - VatPercent (float, e.g. 14.0)

      - TaxType (string, "InputTax" or "OutputTax")

      - IsLiable (string, "Y" / "N")

      - TaxName (string, e.g. "VAT14")

    """

    category = str(request.query_params.get("category") or "purchase").strip().lower()
    if category not in {"purchase", "sales"}:
        return format_error_response("category must be either 'purchase' or 'sales'.", status.HTTP_400_BAD_REQUEST)

    namespace = sap_master_namespace("tax-codes")
    cache_key = build_cache_key(namespace, category)

    cached = cache_get(cache_key)

    if cached is not None:

        return format_success_response(cached)



    try:

        result = sap.get_tax_codes(category=category)

        if isinstance(result, dict) and result.get("error"):

            return format_success_response({"tax_codes": []})



        raw_rows = result.get("value", []) if isinstance(result, dict) else []

        tax_codes = []

        for row in raw_rows:

            code = row.get("Code")

            if not code:

                continue

            name = row.get("Name") or code

            lines = row.get("VatGroups_Lines") or []

            rate = float(lines[0].get("Rate", 0.0)) if lines else 0.0

            is_liable = "Y" if rate > 0 else "N"



            tax_codes.append({

                "TaxCode": str(code).strip(),

                "TaxName": str(name).strip(),

                "VatPercent": rate,

                "TaxType": "OutputTax" if category == "sales" else "InputTax",

                "IsLiable": is_liable,

                "code": str(code).strip(),

                "name": str(name).strip(),

                "rate": rate,

            })



        payload = {"tax_codes": tax_codes}

        cache_set(namespace, cache_key, payload, "sap_tax_codes")

        return format_success_response(payload)

    except Exception as e:

        return format_error_response(e)





# (Duplicate get_bin_locations_by_warehouse removed; see active implementation below)

    

   



# ========== Production Order Details ==========

@api_view(["GET"])

def get_production_order_warehouse(request, doc_entry):

    """جلب المخزن المرتبط بأمر الإنتاج"""

    try:

        result = sap.get_production_order(doc_entry)

        warehouse_code = result.get("Warehouse") or result.get("WarehouseCode")



        if not warehouse_code and result.get("ProductionOrderLines"):

            first_line = result["ProductionOrderLines"][0]

            warehouse_code = first_line.get("Warehouse") or first_line.get(

                "WarehouseCode"

            )



        warehouse_name = warehouse_code

        if warehouse_code:

            try:

                warehouses_result = sap.get_warehouses()

                warehouses = warehouses_result.get("value", [])

                for w in warehouses:

                    if w.get("WarehouseCode") == warehouse_code:

                        warehouse_name = w.get("WarehouseName")

                        break

            except Exception:

                pass



        return format_success_response(

            {

                "warehouse_code": warehouse_code,

                "warehouse_name": warehouse_name or warehouse_code or "غير محدد",

            }

        )

    except Exception as e:

        return format_error_response(e)





@api_view(["GET"])

def get_distribution_rule(request, doc_entry):

    """جلب Distr. Rule كامل (جميع القواعد متسلسلة)"""

    try:

        result = sap.get_production_order(doc_entry)

        rule1 = result.get("DistributionRule", "")

        rule2 = result.get("DistributionRule2", "")

        rule3 = result.get("DistributionRule3", "")



        # تسلسل القواعد مع فواصل منقوطة

        parts = [p for p in [rule1, rule2, rule3] if p and p.strip()]

        full_rule = " ; ".join(parts) if parts else "Standard"



        return format_success_response({"rule": full_rule})

    except Exception as e:

        return format_success_response({"rule": "Standard"})





@api_view(["GET"])

def get_production_order_location(request, doc_entry):

    """جلب الـ Location من DistributionRule فقط"""

    try:

        result = sap.get_production_order(doc_entry)

        location = result.get("DistributionRule", "")

        if not location:

            location = "غير محدد"

        return format_success_response({"location": location})

    except Exception as e:

        return format_success_response({"location": "غير محدد"})





@api_view(["GET"])

def get_production_order_general(request, doc_entry):

    """جلب الـ General من DistributionRule2 فقط"""

    try:

        result = sap.get_production_order(doc_entry)

        general = result.get("DistributionRule2", "")

        if not general:

            general = "لا توجد ملاحظات"

        return format_success_response({"general": general})

    except Exception as e:

        return format_success_response({"general": "لا توجد ملاحظات"})





@api_view(["GET"])

def get_production_lines(request):

    """جلب خطوط الإنتاج"""

    try:

        result = sap._request("GET", "ProductionLines?$top=100")

        lines = result.get("value", [])

        if lines:

            return format_success_response(

                {

                    "lines": [

                        {"code": l.get("LineCode"), "name": l.get("LineName")}

                        for l in lines

                    ]

                }

            )

        return format_success_response(

            {

                "lines": [

                    {"code": "LINE-A", "name": "Production Line A"},

                    {"code": "LINE-B", "name": "Production Line B"},

                ]

            }

        )

    except Exception as e:

        return format_success_response(

            {

                "lines": [

                    {"code": "LINE-A", "name": "Production Line A"},

                    {"code": "LINE-B", "name": "Production Line B"},

                ]

            }

        )





# ========== Series & Accounts ==========

@api_view(["GET"])

def get_series_list(request):

    """جلب قائمة الـ Series من SAP"""

    try:

        result = sap.get_series_list()

        series_list = result.get("value", [])

        return format_success_response(

            {

                "series": [

                    {"code": s.get("Series"), "name": s.get("SeriesName")}

                    for s in series_list

                ]

            }

        )

    except Exception as e:

        return format_error_response(e)





@api_view(["GET"])

def get_account_codes(request):

    """جلب حسابات المخزون من SAP"""

    try:

        result = sap.get_account_codes()

        accounts = result.get("value", [])

        return format_success_response(

            {

                "accounts": [

                    {"code": a.get("Code"), "name": a.get("Name")}

                    for a in accounts[:20]

                ]

            }

        )

    except Exception as e:

        return format_error_response(e)





@api_view(["GET"])

def get_production_order_start_date(request, doc_entry):

    """جلب تاريخ البدء من أمر الإنتاج"""

    try:

        # جلب البيانات كاملة

        result = sap.get_production_order(doc_entry)



        # جرب كل الحقول اللي ممكن تحتوي على تاريخ البدء

        start_date = result.get("StartDate")

        if not start_date:

            start_date = result.get("StartDate")

        if not start_date:

            start_date = result.get("PostingDate")

        if not start_date:

            start_date = result.get("DocumentDate")



        print(f"📅 Raw start_date: {start_date}")  # للتشخيص



        if start_date:

            # تنظيف التاريخ

            if "T" in start_date:

                start_date = start_date.split("T")[0]

            # تنسيق DD/MM/YYYY

            parts = start_date.split("-")

            if len(parts) == 3:

                formatted_date = f"{parts[2]}/{parts[1]}/{parts[0]}"

            else:

                formatted_date = start_date

        else:

            formatted_date = "غير محدد"



        return format_success_response(

            {

                "start_date": formatted_date,

                "raw_date": result.get("StartDate"),  # للتصحيح

            }

        )

    except Exception as e:

        print(f"Error: {e}")

        return format_success_response({"start_date": "غير محدد"})





@api_view(["GET"])

def get_next_receipt_number(request):

    try:

        number = sap.get_next_receipt_number()

        return format_success_response({"next_number": number})

    except Exception as e:

        return format_error_response(e)





@api_view(["GET"])

def get_next_batch_number_for_order(request, production_order_number):

    """Return the suggested next batch number for a given production order (HANA OBTN)."""

    try:

        item_code = request.query_params.get("item_code") or None

        print(f"[OBTN-DEBUG] suggest endpoint | order={production_order_number!r} item_code={item_code!r}")

        numbers = _get_next_batch_from_obtn(production_order_number, item_code, auto_batch_count=1)

        suggested = numbers[0]

        print(f"[OBTN-DEBUG] suggested={suggested!r}")

        return format_success_response({"suggested_batch_number": suggested})

    except Exception as e:

        print(f"[OBTN-DEBUG] suggest endpoint error: {e}")

        return format_error_response(e)





@api_view(["GET"])

def get_bin_locations_by_warehouse(request, warehouse_code):
    if request.query_params.get('transfer_destination') == 'true':
        from .services.transfer_destination_bins import destination_bin_options
        try:
            return format_success_response(destination_bin_options(sap, warehouse_code))
        except ValueError as exc:
            return Response({'error': str(exc)}, status=503)

    """جلب Bin Locations حسب المخزن من SAP - للـ Dropdown مع Pagination كامل"""

    from .services.master_data_search import is_lookup, lookup_response
    if is_lookup(request):
        return lookup_response(request, sap, "bins", "locations", wrapped=True, warehouse=warehouse_code)

    cache_key = build_cache_key(sap_master_namespace("bin-locations"), warehouse_code)

    cached = cache_get(cache_key)

    if cached is not None:

        return format_success_response(cached)



    try:

        from .services.bin_discovery_service import get_bin_discovery_service



        service = get_bin_discovery_service(sap_client=sap)

        raw_bins = service.discover_bin_locations(warehouse_code)



        formatted_locations = []

        for loc in raw_bins:

            formatted_locations.append(

                {

                    "code": loc.get("BinCode", ""),

                    "name": loc.get("Description")

                    or loc.get("BinName")

                    or loc.get("BinCode", ""),

                    "absEntry": loc.get("AbsEntry", ""),

                    "description": loc.get("Description", "") or "",

                    "sublevel1": loc.get("Sublevel1"),

                    "sublevel2": loc.get("Sublevel2"),

                    "sublevel3": loc.get("Sublevel3"),

                    "sublevel4": loc.get("Sublevel4"),

                    "inactive": loc.get("Inactive") in ["tYES", True],

                    "is_system_bin": loc.get("IsSystemBin") in ["tYES", True]

                    or loc.get("SystemBin") in ["tYES", True]

                    or "SYSTEM" in str(loc.get("BinCode", "")).upper(),

                }

            )



        print(

            f"[BIN-LOCATIONS] Found {len(formatted_locations)} bin locations for warehouse {warehouse_code}"

        )



        payload = {"warehouse_code": warehouse_code, "locations": formatted_locations}

        cache_set(

            sap_master_namespace("bin-locations"), cache_key, payload, "sap_bin_locations"

        )

        return format_success_response(payload)

    except Exception as e:

        print(f"Error: {e}")

        return format_success_response(

            {"warehouse_code": warehouse_code, "locations": []}

        )





def _require_cold_storage_read(request, warehouse_code):
    if not request.user.is_authenticated:
        return JsonResponse({"success": False, "error": "Authentication required"}, status=401)
    if not can_access_transfer(request.user):
        return JsonResponse({"success": False, "error": "Transfer access required"}, status=403)
    if can_manage_transfer(request.user):
        return None
    allowed = (
        _user_can_access_transfer_warehouse(request.user, warehouse_code, TransferWarehouseRule.DIRECTION_TO, TransferWarehouseRule.STAGE_2_TO_FRIDGE)
        or _user_can_access_transfer_warehouse(request.user, warehouse_code, TransferWarehouseRule.DIRECTION_FROM, TransferWarehouseRule.STAGE_3_FROM_FRIDGE)
    )
    if not allowed:
        return JsonResponse({"success": False, "error": "Cold storage stage access required"}, status=403)
    return None


@api_view(["GET"])

def get_cold_storage_hierarchy(request, warehouse_code):

    """

    Dynamic SAP Cold Storage & Bin Hierarchy Discovery endpoint.

    GET /api/cold-storage/<warehouse_code>/hierarchy/

    Optional query param: ?refresh=true to invalidate cache.

    """

    guard = _require_cold_storage_read(request, warehouse_code)
    if guard:
        return guard

    try:

        force_refresh = request.query_params.get("refresh", "").lower() in (

            "true",

            "1",

            "yes",

        )

        from .services.bin_discovery_service import get_bin_discovery_service



        service = get_bin_discovery_service(sap_client=sap)

        data = service.get_warehouse_hierarchy(

            warehouse_code, force_refresh=force_refresh

        )

        return format_success_response(data)

    except Exception as e:

        logger.exception("Failed to get cold storage hierarchy for %s", warehouse_code)

        return format_error_response(e)


@api_view(["GET"])
def get_cold_storage_layout(request, warehouse_code):
    """
    Dynamic SAP Cold Storage Physical Layout & Pallet Positions endpoint.
    GET /api/cold-storage/<warehouse_code>/layout/
    Optional query param: ?refresh=true
    """
    guard = _require_cold_storage_read(request, warehouse_code)
    if guard:
        return guard

    try:
        force_refresh = request.query_params.get("refresh", "").lower() in (
            "true",
            "1",
            "yes",
        )
        from .services.cold_storage_layout_service import get_cold_storage_layout_service

        service = get_cold_storage_layout_service()
        data = service.get_warehouse_layout(warehouse_code, force_refresh=force_refresh)
        return format_success_response(data)
    except Exception as e:
        logger.exception("Failed to get cold storage layout for %s", warehouse_code)
        return format_error_response(e)


@api_view(["GET"])
def get_cold_storage_bin_positions(request, abs_entry):
    """
    Get physical pallet positions and occupancy for an SAP Bin AbsEntry.
    GET /api/cold-storage/bin/<abs_entry>/positions/
    """
    if not request.user.is_authenticated:
        return JsonResponse({"success": False, "error": "Authentication required"}, status=401)
    if not can_access_transfer(request.user):
        return JsonResponse({"success": False, "error": "Transfer access required"}, status=403)
    from .models_cold_storage import ColdStorageBinLayout
    warehouse_code = ColdStorageBinLayout.objects.filter(sap_bin_abs_entry=abs_entry).values_list('warehouse_code', flat=True).first()
    if not warehouse_code:
        return format_error_response('Cold storage bin not found', status_code=status.HTTP_404_NOT_FOUND)
    guard = _require_cold_storage_read(request, warehouse_code)
    if guard:
        return guard

    try:
        from .services.cold_storage_layout_service import get_cold_storage_layout_service

        service = get_cold_storage_layout_service()
        data = service.get_bin_positions(abs_entry)
        return format_success_response(data)
    except ValueError as ve:
        return format_error_response(ve, status_code=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        logger.exception("Failed to get positions for bin abs_entry %s", abs_entry)
        return format_error_response(e)


@api_view(["POST"])
@audit_mutation(module=MODULE_COLD_STORAGE, entity_type="ColdStoragePalletPosition", action=ACTION_RESERVE, log_success=False)
def reserve_cold_storage_position(request, position_id):
    """
    Concurrency-safe atomic reservation of a physical pallet position.
    POST /api/cold-storage/positions/<position_id>/reserve/
    Body: { "reference": "...", "transfer_reference": "..." }
    """
    try:
        from .services.cold_storage_layout_service import get_cold_storage_layout_service

        service = get_cold_storage_layout_service()
        user = request.user if request.user.is_authenticated else None
        data_in = request.data if isinstance(request.data, dict) else {}
        reference = data_in.get("reference", "")
        transfer_reference = data_in.get("transfer_reference", "")
        data = service.reserve_position(
            position_id=position_id,
            user=user,
            reference=reference,
            transfer_reference=transfer_reference,
        )
        log_action(
            request=request,
            user=user,
            action=ACTION_RESERVE,
            module=MODULE_COLD_STORAGE,
            entity_type="ColdStoragePalletPosition",
            entity_id=str(position_id),
            description=f"Reserved pallet position #{position_id}",
            details={"reference": reference, "transfer_reference": transfer_reference},
        )
        return format_success_response(data)
    except ValueError as ve:
        # 409 Conflict: already reserved, occupied, or non-allocatable
        return format_error_response(ve, status_code=status.HTTP_409_CONFLICT)
    except Exception as e:
        logger.exception("Failed to reserve position %s", position_id)
        return format_error_response(e)


@api_view(["POST"])
@audit_mutation(module=MODULE_COLD_STORAGE, entity_type="ColdStoragePalletPosition", action=ACTION_RELEASE, log_success=False)
def release_cold_storage_position(request, position_id):
    """
    Concurrency-safe release of a physical pallet position reservation.
    POST /api/cold-storage/positions/<position_id>/release/
    """
    try:
        from .services.cold_storage_layout_service import get_cold_storage_layout_service

        service = get_cold_storage_layout_service()
        user = request.user if request.user.is_authenticated else None
        data = service.release_position(position_id=position_id, user=user)
        log_action(
            request=request,
            user=user,
            action=ACTION_RELEASE,
            module=MODULE_COLD_STORAGE,
            entity_type="ColdStoragePalletPosition",
            entity_id=str(position_id),
            description=f"Released pallet position #{position_id}",
            details={},
        )
        return format_success_response(data)
    except ValueError as ve:
        return format_error_response(ve, status_code=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        logger.exception("Failed to release position %s", position_id)
        return format_error_response(e)


@api_view(["POST"])
@audit_mutation(module=MODULE_COLD_STORAGE, entity_type="ColdStoragePalletPosition", action=ACTION_OCCUPY, log_success=False)
def occupy_cold_storage_position(request, position_id):
    """
    Concurrency-safe transition of a position to OCCUPIED.
    POST /api/cold-storage/positions/<position_id>/occupy/
    Body: { "batch_number": "...", "reference": "...", "transfer_reference": "..." }
    """
    try:
        from .services.cold_storage_layout_service import get_cold_storage_layout_service

        service = get_cold_storage_layout_service()
        user = request.user if request.user.is_authenticated else None
        data_in = request.data if isinstance(request.data, dict) else {}
        batch_number = data_in.get("batch_number", "")
        reference = data_in.get("reference", "")
        transfer_reference = data_in.get("transfer_reference", "")
        data = service.occupy_position(
            position_id=position_id,
            user=user,
            batch_number=batch_number,
            reference=reference,
            transfer_reference=transfer_reference,
        )
        log_action(
            request=request,
            user=user,
            action=ACTION_OCCUPY,
            module=MODULE_COLD_STORAGE,
            entity_type="ColdStoragePalletPosition",
            entity_id=str(position_id),
            description=f"Occupied pallet position #{position_id}",
            details={"batch_number": batch_number, "reference": reference, "transfer_reference": transfer_reference},
        )
        return format_success_response(data)
    except ValueError as ve:
        return format_error_response(ve, status_code=status.HTTP_409_CONFLICT)
    except Exception as e:
        logger.exception("Failed to occupy position %s", position_id)
        return format_error_response(e)


@api_view(["POST"])
@audit_mutation(module=MODULE_COLD_STORAGE, entity_type="ColdStoragePalletPosition", action=ACTION_VACATE, log_success=False)
def vacate_cold_storage_position(request, position_id):
    """
    Concurrency-safe transition of an OCCUPIED position back to AVAILABLE.
    POST /api/cold-storage/positions/<position_id>/vacate/
    """
    try:
        from .services.cold_storage_layout_service import get_cold_storage_layout_service

        service = get_cold_storage_layout_service()
        user = request.user if request.user.is_authenticated else None
        data = service.vacate_position(position_id=position_id, user=user)
        log_action(
            request=request,
            user=user,
            action=ACTION_VACATE,
            module=MODULE_COLD_STORAGE,
            entity_type="ColdStoragePalletPosition",
            entity_id=str(position_id),
            description=f"Vacated pallet position #{position_id}",
            details={},
        )
        return format_success_response(data)
    except ValueError as ve:
        return format_error_response(ve, status_code=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        logger.exception("Failed to vacate position %s", position_id)
        return format_error_response(e)


@api_view(["POST"])
@audit_mutation(module=MODULE_COLD_STORAGE, entity_type="ColdStorageBinLayout", action=ACTION_CONFIGURE, log_success=False)
def configure_cold_storage_bin(request, abs_entry):
    """
    Explicitly configure capacity, allocation_type, or channel_type for a SAP Bin.
    POST /api/cold-storage/bin/<abs_entry>/configure/
    Body: { "capacity": 17, "allocation_type": "ALLOCATABLE", "channel_type": "STANDARD", "notes": "" }
    """
    try:
        from .services.cold_storage_layout_service import get_cold_storage_layout_service

        service = get_cold_storage_layout_service()
        data_in = request.data if isinstance(request.data, dict) else {}
        capacity = data_in.get("capacity")
        allocation_type = data_in.get("allocation_type")
        channel_type = data_in.get("channel_type")
        notes = data_in.get("notes", "")
        layout = service.configure_bin(
            sap_bin_abs_entry=abs_entry,
            capacity=capacity,
            allocation_type=allocation_type,
            channel_type=channel_type,
            notes=notes,
        )
        log_action(
            request=request,
            user=request.user,
            action=ACTION_CONFIGURE,
            module=MODULE_COLD_STORAGE,
            entity_type="ColdStorageBinLayout",
            entity_id=str(abs_entry),
            description=f"Configured cold storage bin {layout.bin_code}",
            details={"capacity": capacity, "allocation_type": allocation_type, "channel_type": channel_type},
        )
        return format_success_response({
            "sap_bin_abs_entry": layout.sap_bin_abs_entry,
            "bin_code": layout.bin_code,
            "warehouse_code": layout.warehouse_code,
            "allocation_type": layout.allocation_type,
            "capacity": layout.capacity,
            "capacity_source": layout.capacity_source,
            "channel_type": layout.channel_type,
            "notes": layout.notes,
        })
    except ValueError as ve:
        return format_error_response(ve, status_code=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        logger.exception("Failed to configure bin %s", abs_entry)
        return format_error_response(e)


@api_view(["POST"])
def preview_cold_storage_allocation(request):
    """
    Preview deterministic sequential pallet placement for a chosen Rack + Level without committing.
    POST /api/cold-storage/allocate-preview/
    """
    try:
        from .services.cold_storage_layout_service import get_cold_storage_layout_service
        service = get_cold_storage_layout_service()
        data_in = request.data if isinstance(request.data, dict) else {}
        warehouse_code = data_in.get("warehouse_code", "")
        abs_entry = data_in.get("abs_entry") or data_in.get("sap_bin_abs_entry")
        if abs_entry:
            abs_entry = int(abs_entry)
        bin_code = data_in.get("bin_code")
        sublevel1 = data_in.get("sublevel1")
        sublevel2 = data_in.get("sublevel2")
        sublevel3 = data_in.get("sublevel3")
        sublevel4 = data_in.get("sublevel4")
        pallet_count = int(data_in.get("pallet_count", 1) or 1)
        batches = data_in.get("batches")

        result = service.preview_sequential_allocation(
            warehouse_code=warehouse_code,
            sap_bin_abs_entry=abs_entry,
            bin_code=bin_code,
            sublevel1=sublevel1,
            sublevel2=sublevel2,
            sublevel3=sublevel3,
            sublevel4=sublevel4,
            pallet_count=pallet_count,
            batches=batches,
        )
        return format_success_response(result)
    except ValueError as ve:
        return format_error_response(ve, status_code=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        logger.exception("Failed to preview sequential allocation")
        return format_error_response(e)


@api_view(["POST"])
def allocate_cold_storage_sequential(request):
    """
    Execute deterministic, concurrency-safe sequential pallet placement for a chosen Rack + Level.
    POST /api/cold-storage/allocate-sequential/
    """
    try:
        from .services.cold_storage_layout_service import get_cold_storage_layout_service, InsufficientCapacityError
        service = get_cold_storage_layout_service()
        user = request.user if request.user.is_authenticated else None
        data_in = request.data if isinstance(request.data, dict) else {}
        warehouse_code = data_in.get("warehouse_code", "")
        abs_entry = data_in.get("abs_entry") or data_in.get("sap_bin_abs_entry")
        if abs_entry:
            abs_entry = int(abs_entry)
        bin_code = data_in.get("bin_code")
        sublevel1 = data_in.get("sublevel1")
        sublevel2 = data_in.get("sublevel2")
        sublevel3 = data_in.get("sublevel3")
        sublevel4 = data_in.get("sublevel4")
        pallet_count = int(data_in.get("pallet_count", 1) or 1)
        batches = data_in.get("batches")
        reference = data_in.get("reference", "")
        allow_partial = bool(data_in.get("allow_partial", False))
        mode = str(data_in.get("mode", "OCCUPY")).upper()

        result = service.allocate_sequentially(
            warehouse_code=warehouse_code,
            sap_bin_abs_entry=abs_entry,
            bin_code=bin_code,
            sublevel1=sublevel1,
            sublevel2=sublevel2,
            sublevel3=sublevel3,
            sublevel4=sublevel4,
            pallet_count=pallet_count,
            batches=batches,
            user=user,
            reference=reference,
            allow_partial=allow_partial,
            mode=mode,
        )
        return format_success_response(result)
    except InsufficientCapacityError as ice:
        return Response(
            {
                "success": False,
                "error": str(ice),
                "code": "INSUFFICIENT_CAPACITY",
                "available": ice.available,
                "required": ice.required,
                "shortage": ice.shortage,
                "bin_code": ice.bin_code,
                "sap_bin_abs_entry": ice.sap_bin_abs_entry,
            },
            status=status.HTTP_409_CONFLICT,
        )
    except ValueError as ve:
        return format_error_response(ve, status_code=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        logger.exception("Failed to allocate cold storage sequentially")
        return format_error_response(e)






def _cached_global_obtn_options():

    data, hit = _cache_get("global_obtn_options")

    if hit:

        return data

    data = _get_obtn_udf_options()

    return _cache_set("global_obtn_options", data)





def _cached_ufd1_options():

    data, hit = _cache_get("ufd1_options")

    if hit:

        return data

    data = _get_ufd1_field_options()

    return _cache_set("ufd1_options", data)





@api_view(["GET"])

def get_item_batch_attributes(request, item_code):

    """جلب خصائص الباتش الخاصة بالصنف من SAP"""

    minimal = str(request.query_params.get("minimal", "")).strip().lower() in {

        "1",

        "true",

        "yes",

    }

    try:

        # جلب بيانات الصنف كاملة

        endpoint = f"Items('{item_code}')"

        result = sap._request("GET", endpoint)

        udf_values = _collect_item_udfs(result)



        latest_batch = _get_latest_batch_for_item(item_code)



        latest_obtn_row = _get_latest_obtn_row(item_code)



        item_field_options = _get_obtn_udf_options(item_code)



        global_field_options = _cached_global_obtn_options()



        ufd1_options = _cached_ufd1_options()



        field_options = _merge_udf_options(

            _merge_udf_options(item_field_options, global_field_options),

            ufd1_options,

        )



        # جلب وحدات القياس

        uom_endpoint = f"Items('{item_code}')/UoMs"

        uom_result = sap._request("GET", uom_endpoint)



        # جلب الموردين (محاولة بطرق مختلفة)

        vendors = []



        # طريقة 1: Preferred Vendors

        try:

            vendor_endpoint = f"Items('{item_code}')/ItemPreferredVendors"

            vendor_result = sap._request("GET", vendor_endpoint)

            if vendor_result.get("value"):

                vendors = [

                    {"code": v.get("VendorCode"), "name": v.get("VendorName")}

                    for v in vendor_result.get("value", [])

                ]

        except:

            pass



        # طريقة 2: Item Suppliers

        if not vendors:

            try:

                supplier_endpoint = f"Items('{item_code}')/ItemSuppliers"

                supplier_result = sap._request("GET", supplier_endpoint)

                if supplier_result.get("value"):

                    vendors = [

                        {"code": s.get("SupplierCode"), "name": s.get("SupplierName")}

                        for s in supplier_result.get("value", [])

                    ]

            except:

                pass



        default_vendor_code = _pick_first_value(

            result.get("PreferredVendor"),

            result.get("DefaultVendor"),

            result.get("CardCode"),

            udf_values.get("U_Vendor"),

            udf_values.get("U_VendorCode"),

            udf_values.get("U_Supplier"),

        )

        default_vendor_name = _pick_first_value(

            result.get("VendorName"),

            udf_values.get("U_VendorName"),

            udf_values.get("U_SupplierName"),

        )



        if default_vendor_code and not any(

            v.get("code") == default_vendor_code for v in vendors

        ):

            vendors.insert(

                0,

                {

                    "code": default_vendor_code,

                    "name": default_vendor_name or default_vendor_code,

                },

            )



        latest_batch_vendor = _pick_first_value(

            latest_obtn_row.get("U_vendor"),

            latest_batch.get("U_vendor"),

            latest_batch.get("VendorCode"),

        )

        if latest_batch_vendor and not any(

            v.get("code") == latest_batch_vendor for v in vendors

        ):

            vendors.insert(0, {"code": latest_batch_vendor, "name": latest_batch_vendor})



        uom_value = _pick_first_value(

            result.get("InventoryUOM"),

            result.get("InventoryUoM"),

            result.get("SalesUnit"),

            result.get("PurchaseUnit"),

            result.get("UoMCode"),

            udf_values.get("U_UOM"),

            udf_values.get("U_UoM"),

            latest_obtn_row.get("U_UOM"),

            latest_batch.get("U_UOM"),

        )

        uom_name_value = _pick_first_value(

            result.get("UoMName"),

            result.get("InventoryUOM"),

            result.get("InventoryUoM"),

            uom_result.get("Name"),

            udf_values.get("U_UOMName"),

            udf_values.get("U_UoMName"),

        )



        # استخراج البيانات من الحقول الصحيحة في SAP

        batch_attributes = {

            "uom": uom_value or "PCS",

            "uom_name": uom_name_value or "Piece",

            "size": _pick_first_value(

                latest_obtn_row.get("U_Size"),

                latest_batch.get("U_Size"),

                udf_values.get("U_Size"),

                _pick_from_aliases(

                    result,

                    udf_values,

                    ["Size", "ItemLength", "Length", "Dimension"],

                ),

            ),

            "brand": _pick_first_value(

                latest_obtn_row.get("U_Brand"),

                latest_batch.get("U_Brand"),

                udf_values.get("U_Brand"),

                _pick_from_aliases(

                    result, udf_values, ["Brand", "Manufacturer", "Firm"]

                ),

            ),

            "part_number": _pick_first_value(

                latest_obtn_row.get("U_Part"),

                latest_batch.get("U_Part"),

                udf_values.get("U_Part"),

                _pick_from_aliases(

                    result,

                    udf_values,

                    ["PartNumber", "Catalog", "Model", "PartNo"],

                ),

            ),

            "category": _pick_first_value(

                latest_obtn_row.get("U_Category"),

                latest_batch.get("U_Category"),

                udf_values.get("U_Category"),

            ),

            "packing": _pick_first_value(

                latest_obtn_row.get("U_Packing"),

                latest_batch.get("U_Packing"),

                udf_values.get("U_Packing"),

                _pick_from_aliases(

                    result, udf_values, ["Packing", "Package", "Pack", "Pkg"]

                ),

            ),

            "season": _pick_first_value(

                latest_obtn_row.get("U_Season"),

                latest_obtn_row.get("Season"),

                latest_batch.get("U_Season"),

                latest_batch.get("Season"),

                udf_values.get("U_Season"),

                udf_values.get("Season"),

            ),

            "extra_specification": _pick_first_value(

                latest_obtn_row.get("U_Specification"),

                latest_batch.get("U_Specification"),

                udf_values.get("U_Specification"),

                udf_values.get("U_ExtraSpecification"),

                _pick_from_aliases(

                    result,

                    udf_values,

                    ["ExtraSpecification", "Specification", "Spec"],

                ),

            ),

            "weight": _pick_from_aliases(result, udf_values, ["ItemWeight", "Weight"]),

            "width": _pick_from_aliases(result, udf_values, ["ItemWidth", "Width"]),

            "height": _pick_from_aliases(result, udf_values, ["ItemHeight", "Height"]),

            "model": _pick_from_aliases(result, udf_values, ["Model", "U_Model"]),

            "series": _pick_from_aliases(result, udf_values, ["Series", "U_Series"]),

            "vendors": vendors,

            "number": _pick_first_value(

                latest_obtn_row.get("U_Number"), latest_batch.get("U_Number")

            ),

            "field_options": field_options,

            # الحقول الإضافية من UDF

            "custom_fields": udf_values,

            "latest_batch_fields": {

                "batch_number": latest_obtn_row.get("BatchNumber") or latest_batch.get("BatchNumber"),

                "size": latest_obtn_row.get("U_Size") or latest_batch.get("U_Size"),

                "brand": latest_obtn_row.get("U_Brand") or latest_batch.get("U_Brand"),

                "uom": latest_obtn_row.get("U_UOM") or latest_batch.get("U_UOM"),

                "vendor": latest_obtn_row.get("U_vendor") or latest_batch.get("U_vendor"),

                "part": latest_obtn_row.get("U_Part") or latest_batch.get("U_Part"),

                "category": latest_obtn_row.get("U_Category") or latest_batch.get("U_Category"),

                "packing": latest_obtn_row.get("U_Packing") or latest_batch.get("U_Packing"),

                "season": latest_obtn_row.get("U_Season") or latest_obtn_row.get("Season") or latest_batch.get("U_Season") or latest_batch.get("Season"),

                "extra_specification": latest_obtn_row.get("U_Specification") or latest_batch.get("U_Specification"),

                "number": latest_obtn_row.get("U_Number") or latest_batch.get("U_Number"),

            },

        }





        return format_success_response(batch_attributes)

    except Exception as e:

        return format_error_response(str(e))





@api_view(["GET"])

def get_batch_details_by_number(request, batch_number):

    """جلب بيانات باتش موجود من SAP"""

    try:

        endpoint = f"BatchNumbers?$filter=BatchNumber eq '{batch_number}'"

        result = sap._request("GET", endpoint)

        batches = result.get("value", [])



        if batches:

            batch = batches[0]

            return format_success_response(

                {

                    "batch_number": batch.get("BatchNumber"),

                    "quantity": batch.get("Quantity", 0),

                    "bin_location": batch.get("BinLocation", ""),

                    "expiration_date": batch.get("ExpirationDate", ""),

                    "mfr_date": batch.get("ManufacturingDate", ""),

                    "admission_date": batch.get("AdmissionDate", ""),

                    "details": batch.get("Notes") or batch.get("Details", ""),

                    "uom": batch.get("UoMCode", ""),

                    "vendor": batch.get("VendorCode", ""),

                    "part_number": batch.get("PartNumber", ""),

                    "extra_specification": batch.get("ExtraSpecification", ""),

                    "size": batch.get("U_Size", ""),

                    "brand": batch.get("U_Brand", ""),

                    "udf_uom": batch.get("U_UOM", ""),

                    "udf_vendor": batch.get("U_vendor", ""),

                    "udf_part": batch.get("U_Part", ""),

                    "udf_category": batch.get("U_Category", ""),

                    "udf_packing": batch.get("U_Packing", ""),

                    "udf_season": batch.get("U_Season", "") or batch.get("Season", ""),

                    "udf_extra_specification": batch.get("U_Specification", ""),

                    "udf_number": batch.get("U_Number", ""),

                }

            )

        return format_success_response(None)

    except Exception as e:

        return format_error_response(e)





@api_view(["GET"])

def get_batch_udf_metadata(request):

    """Load Serial/Batch Number Object UDF definitions from SAP (cached 30 min)."""

    cached, hit = _cache_get("batch_udf_metadata")

    if hit:

        return format_success_response(cached)

    try:

        aliases = {

            "size": "size",

            "brand": "brand",

            "uom": "uom",

            "vendor": "vendor",

            "part": "part",

            "category": "category",

            "packing": "packing",

            "season": "season",

            "specification": "extra_specification",

            "extraspecification": "extra_specification",

            "number": "number",

        }



        mapped_fields = {}

        result = sap.get_user_fields_metadata("OBTN")

        fields = result.get("value", [])



        for field in fields:

            field_name = field.get("Name") or ""

            field_id = field.get("FieldID")

            normalized_name = _normalize_udf_name(field_name)

            logical_key = aliases.get(normalized_name)

            if logical_key is None or field_id is None:

                continue



            field_instance = sap._request(

                "GET",

                f"UserFieldsMD(TableName='OBTN',FieldID={field_id})",

            )



            mapped_fields[logical_key] = {

                "name": field_name,

                "description": field_instance.get("Description")

                or field.get("Description")

                or field_name,

                "default_value": field_instance.get("DefaultValue")

                or field.get("DefaultValue")

                or "",

                "type": field_instance.get("Type") or field.get("Type"),

                "edit_size": field_instance.get("EditSize") or field.get("EditSize"),

                "linked_table": field_instance.get("LinkedTable"),

                "linked_system_object": field_instance.get("LinkedSystemObject"),

                "valid_values": [

                    {

                        "value": value.get("Value"),

                        "description": value.get("Description") or value.get("Value"),

                    }

                    for value in field_instance.get("ValidValuesMD", [])

                    if _clean_value(value.get("Value")) is not None

                ],

            }



        result = {"fields": mapped_fields, "table_name": "OBTN"}

        _cache_set("batch_udf_metadata", result)

        return format_success_response(result)

    except Exception as e:

        return format_error_response(e)





@api_view(["GET"])

def debug_item_full(request, item_code):

    """جلب بيانات الصنف كاملة من SAP للتشخيص"""

    try:

        endpoint = f"Items('{item_code}')"

        result = sap._request("GET", endpoint)



        # جلب كل الحقول اللي ممكن تكون فيها البيانات

        all_fields = {

            "ItemCode": result.get("ItemCode"),

            "ItemName": result.get("ItemName"),

            "Brand": result.get("Brand"),

            "UoMName": result.get("UoMName"),

            "SalesUnit": result.get("SalesUnit"),

            "PurchaseUnit": result.get("PurchaseUnit"),

            "ItemLength": result.get("ItemLength"),

            "ItemWidth": result.get("ItemWidth"),

            "ItemHeight": result.get("ItemHeight"),

            "ItemWeight": result.get("ItemWeight"),

            "Category": result.get("Category"),

            "PartNumber": result.get("PartNumber"),

            "Packing": result.get("Packing"),

            "Manufacturer": result.get("Manufacturer"),

            "Model": result.get("Model"),

            "Series": result.get("Series"),

            "UserFields": result.get("UDF", {}),  # الحقول الإضافية

        }



        return Response(

            {

                "success": True,

                "item_code": item_code,

                "data": result,

                "extracted_fields": all_fields,

            }

        )

    except Exception as e:

        return Response({"success": False, "error": str(e)})





@api_view(["POST"])
@audit_mutation(module=MODULE_PRODUCTION_RECEIPT, entity_type="ProductionReceipt", action=ACTION_POST)
def create_receipt(request):

    """Create a receipt from production and send it to SAP."""

    try:

        receipt_data = request.data



        doc_entry = receipt_data.get("ProductionOrderEntry") or receipt_data.get("BaseEntry")

        quantity = float(receipt_data.get("Quantity") or 0)

        warehouse = receipt_data.get("Warehouse")

        posting_date = _normalize_sap_date(

            receipt_data.get("PostingDate") or receipt_data.get("DocumentDate")

        )

        batches = receipt_data.get("Batches") or []



        if not doc_entry:

            return format_error_response(

                "Production order DocEntry is required",

                status.HTTP_400_BAD_REQUEST,

            )



        if quantity <= 0:

            return format_error_response(

                "Quantity must be greater than zero",

                status.HTTP_400_BAD_REQUEST,

            )



        production_order = sap.get_production_order(int(doc_entry))

        order_status = production_order.get("ProductionOrderStatus") or production_order.get("Status")



        if order_status in {"boposCancelled", "boposClosed"}:

            return format_error_response(

                f"Production order status does not allow new receipts ({order_status}).",

                status.HTTP_400_BAD_REQUEST,

            )





        # issue_summary = _get_issue_for_production_summary(doc_entry)

        # issued_quantity = issue_summary["issued_quantity"]

        # if issued_quantity <= 0:

        #     issued_quantity = _get_production_order_issued_quantity(production_order)



        # if issued_quantity <= 0:

        #     return format_error_response(

        #         "Cannot create Receipt from Production because the work order has no issued component quantity yet. Run Issue for Production first.",

        #         status.HTTP_400_BAD_REQUEST,

        #     )



        costing_code = receipt_data.get("CostingCode") or receipt_data.get("Location")

        costing_code2 = receipt_data.get("CostingCode2") or receipt_data.get("General")

        base_type = receipt_data.get("BaseType")

        base_entry = receipt_data.get("BaseEntry")

        base_line = receipt_data.get("BaseLine")

        is_production_linked = True

        if base_type is not None:

            is_production_linked = str(base_type).strip() == "202"



        item_code = production_order.get("ItemNo") or production_order.get("ItemCode")

        if not item_code:

            return format_error_response(

                "Could not determine ItemCode from production order",

                status.HTTP_400_BAD_REQUEST,

            )



        if is_production_linked:

            base_document_line = {

                "BaseType": 202,

                "BaseEntry": int(base_entry or doc_entry),

                "TransactionType": receipt_data.get("TransactionType")

                or "botrntComplete",

            }

        else:

            item_stock = sap.get_item_stock(item_code)

            if item_stock.get("error"):

                return format_error_response(

                    item_stock.get("error"),

                    status.HTTP_400_BAD_REQUEST,

                )



            inventory_account = None

            for item_warehouse in item_stock.get("ItemWarehouseInfoCollection") or []:

                item_warehouse_code = item_warehouse.get("WarehouseCode")

                if str(item_warehouse_code or "").strip() != str(warehouse or "").strip():

                    continue

                inventory_account = item_warehouse.get("InventoryAccount")

                break



            if not inventory_account and warehouse and posting_date:

                advanced_gl_account = sap.get_advanced_gl_account(

                    item_code,

                    warehouse,

                    posting_date,

                    account_type="iatInventory",

                )

                if advanced_gl_account.get("error"):

                    return format_error_response(

                        advanced_gl_account.get("error"),

                        status.HTTP_400_BAD_REQUEST,

                    )

                inventory_account = advanced_gl_account.get("AccountCode")



            if not inventory_account:

                return format_error_response(

                    f"Missing SAP inventory account for item {item_code} and warehouse {warehouse}. Checked ItemWarehouseInfoCollection[].InventoryAccount and CompanyService_GetAdvancedGLAccount(...).AccountCode.",

                    status.HTTP_400_BAD_REQUEST,

                )



            base_document_line = {

                "ItemCode": item_code,

                "AccountCode": inventory_account,

            }



            if base_type is not None:

                base_document_line["BaseType"] = int(base_type)

            if base_entry is not None:

                base_document_line["BaseEntry"] = int(base_entry)

            if base_line is not None:

                base_document_line["BaseLine"] = int(base_line)

        if warehouse:

            base_document_line["WarehouseCode"] = warehouse

        if costing_code:

            base_document_line["CostingCode"] = costing_code

        if costing_code2:

            base_document_line["CostingCode2"] = costing_code2



        production_order_number = receipt_data.get("ProductionOrderNumber") or str(doc_entry)



        # ── Pre-validate batch quantities ONCE before any retry ────────────────

        if batches:

            total_batch_qty = 0.0

            for index, batch in enumerate(batches):

                batch_qty = float(batch.get("quantity") or 0)

                if batch_qty <= 0:

                    return format_error_response(

                        f"Batch row {index + 1} has invalid quantity",

                        status.HTTP_400_BAD_REQUEST,

                    )

                if not batch.get("autoGenerated") and not _clean_value(batch.get("batchNumber")):

                    return format_error_response(

                        f"Batch row {index + 1} is missing batch number",

                        status.HTTP_400_BAD_REQUEST,

                    )

                total_batch_qty += batch_qty



            if abs(total_batch_qty - quantity) > 0.0001:

                return format_error_response(

                    "Total batch quantity must equal receipt quantity",

                    status.HTTP_400_BAD_REQUEST,

                )



        # ── Diagnose exactly what the frontend sent ───────────────────────────

        print(f"[BATCH-DIAG] production_order_number={production_order_number!r}  item_code={item_code!r}")

        for _i, _b in enumerate(batches or []):

            _ag = _b.get("autoGenerated")

            print(

                f"[BATCH-DIAG] batch[{_i}]  batchNumber={_b.get('batchNumber')!r}"

                f"  autoGenerated={_ag!r}  type={type(_ag).__name__}"

            )



        # Count how many batches need an OBTN-derived number.

        # Normalise: treat string "true"/"1"/"yes" as truthy so JSON quirks don't break us.

        def _is_auto(batch_item):

            v = batch_item.get("autoGenerated")

            if isinstance(v, bool):

                return v

            if isinstance(v, str):

                return v.strip().lower() in ("true", "1", "yes")

            return bool(v)



        auto_batch_count = sum(1 for b in batches if _is_auto(b)) if batches else 0

        print(f"[BATCH-DIAG] auto_batch_count={auto_batch_count}  total_batches={len(batches or [])}")



        # ── Retry loop ────────────────────────────────────────────────────────

        # Two distinct behaviours:

        #   autoGenerated → fresh OBTN number on every attempt; retry on batch

        #                   conflict OR -2039 concurrency error.

        #   manual batch  → keep the user's batch number on every attempt;

        #                   retry only on -2039; a duplicate is a real error.

        has_auto = auto_batch_count > 0

        last_error = None



        for attempt in range(_MAX_BATCH_CONFLICT_RETRIES):

            if attempt > 0:

                # Refresh production order from SAP to reset any optimistic lock.

                print(

                    f"[BATCH-RETRY] attempt {attempt + 1}/{_MAX_BATCH_CONFLICT_RETRIES}"

                    f" — refreshing production order from SAP"

                )

                try:

                    sap.get_production_order(doc_entry)

                    print(f"[BATCH-RETRY] production order refreshed OK")

                except Exception as _refresh_exc:

                    print(f"[BATCH-RETRY] production order refresh failed (non-fatal): {_refresh_exc}")



            # For autoGenerated batches: always read OBTN fresh so a concurrent

            # save that grabbed the previous number is automatically skipped.

            obtn_numbers = (

                _get_next_batch_from_obtn(production_order_number, item_code, auto_batch_count)

                if has_auto

                else []

            )

            if has_auto:

                print(f"[BATCH-RETRY] attempt={attempt + 1}  obtn_numbers={obtn_numbers}")



            obtn_index = 0

            document_lines = []

            bin_allocations = []

            assigned_batch_numbers = []



            if batches:

                for index, batch in enumerate(batches):

                    batch_qty = float(batch.get("quantity") or 0)



                    if _is_auto(batch):

                        # Auto: use next number from OBTN (changes on every retry)

                        batch_number = obtn_numbers[obtn_index]

                        obtn_index += 1

                    else:

                        # Manual: always keep the user's original batch number

                        batch_number = batch.get("batchNumber")



                    print(

                        f"[BATCH-DEBUG] attempt={attempt + 1} batch[{index}]"

                        f" → {batch_number!r}  auto={_is_auto(batch)}"

                    )

                    assigned_batch_numbers.append(batch_number)



                    batch_row = {"BatchNumber": batch_number, "Quantity": batch_qty}



                    manufacturing_date = _normalize_sap_date(

                        batch.get("mfrDate") or batch.get("ManufacturingDate")

                    )

                    admission_date = _normalize_sap_date(

                        batch.get("admissionDate")

                        or batch.get("AddmisionDate")

                        or batch.get("AdmissionDate")

                    )

                    if manufacturing_date:

                        batch_row["ManufacturingDate"] = manufacturing_date

                    if admission_date:

                        batch_row["AddmisionDate"] = admission_date



                    batch_row.update(_build_batch_standard_payload(batch))

                    udf_payload = _build_batch_udf_payload(batch)

                    batch_row.update(udf_payload)



                    document_line = {

                        **base_document_line,

                        "Quantity": batch_qty,

                        "BatchNumbers": [batch_row],

                    }

                    bin_abs_entry = batch.get("binAbsEntry")

                    if bin_abs_entry not in (None, ""):

                        document_line["DocumentLinesBinAllocations"] = [

                            {

                                "BinAbsEntry": int(bin_abs_entry),

                                "Quantity": float(batch_qty),

                                "AllowNegativeQuantity": "tNO",

                                "SerialAndBatchNumbersBaseLine": 0,

                                "BaseLineNumber": index,

                            }

                        ]

                    document_lines.append(document_line)



            else:

                document_lines.append({**base_document_line, "Quantity": quantity})



            first_batch_number = (

                _clean_value(assigned_batch_numbers[0]) if assigned_batch_numbers else "NO-BATCH"

            ) or "NO-BATCH"

            comments_marker = receipt_data.get("Comments") or (

                f"Receipt from Production Order {production_order_number} | "

                f"LIVE-TEST-{first_batch_number}-{int(time.time() * 1000)}"

            )



            if attempt == 0:

                _append_live_receipt_trace(

                    "ui_request",

                    {

                        "production_order_entry": int(doc_entry),

                        "comments_marker": comments_marker,

                        "request_data": receipt_data,

                    },

                )



            sap_payload = {

                "ProductionOrder": int(doc_entry),

                "Series": receipt_data.get("Series"),

                "DocumentDate": posting_date,

                "PostingDate": posting_date,

                "Warehouse": warehouse,

                "Comments": comments_marker,

                "Remarks": receipt_data.get(

                    "Remarks",

                    f"Receipt from Production Order {production_order_number}",

                ),

                "JournalRemarks": "Receipt from Production",

                "DocumentLines": document_lines,

                "BinAllocations": bin_allocations,

            }

            sap_payload = {k: v for k, v in sap_payload.items() if v is not None}



            print(f"[BATCH-RETRY] attempt={attempt + 1} assigned={assigned_batch_numbers}")

            result = sap.create_receipt_from_production(sap_payload)



            if not result.get("error"):

                result["AssignedBatchNumbers"] = assigned_batch_numbers

                print(f"[RECEIPT-CONFIRM] ✓ SAP save succeeded on attempt {attempt + 1}")

                print(f"[RECEIPT-CONFIRM] final_batch_numbers={assigned_batch_numbers}")

                return format_success_response(result, "Receipt created successfully in SAP")



            error_text = result.get("error", "")

            is_conflict     = _is_batch_conflict_error(error_text)

            is_concurrency  = _is_concurrency_error(error_text)

            print(

                f"[BATCH-RETRY] attempt={attempt + 1} error={error_text!r}"

                f"  conflict={is_conflict}  concurrency={is_concurrency}  has_auto={has_auto}"

            )



            if has_auto and (is_conflict or is_concurrency):

                # Auto batch: grab the next available number from OBTN and retry.

                print(f"[BATCH-RETRY] → auto batch conflict/concurrency — retrying with fresh OBTN number")

                last_error = error_text

                continue



            if not has_auto and is_concurrency:

                # Manual batch: the batch number is fixed; just retry the POST

                # after refreshing the production order (already done at top of loop).

                print(f"[BATCH-RETRY] → manual batch concurrency — retrying with same batch number")

                last_error = error_text

                continue



            # Any other error is a real problem — surface it immediately.

            print(f"[BATCH-RETRY] → non-retryable error — aborting")

            return format_error_response(error_text, status.HTTP_400_BAD_REQUEST)



        return format_error_response(

            f"Failed to create receipt after {_MAX_BATCH_CONFLICT_RETRIES} attempts. Last error: {last_error}",

            status.HTTP_409_CONFLICT,

        )



    except Exception as e:

        print(f"Error: {str(e)}")

        return format_error_response(str(e), status.HTTP_500_INTERNAL_SERVER_ERROR)



@api_view(["GET"])

def debug_item_udf(request, item_code):

    """تشخيص الـ UDFs للصنف"""

    try:

        endpoint = f"Items('{item_code}')"

        result = sap._request("GET", endpoint)



        udf = result.get("UDF", {})



        return Response(

            {

                "success": True,

                "item_code": item_code,

                "udf_fields": udf,

                "all_udf_keys": list(udf.keys()),

            }

        )

    except Exception as e:

        return Response({"success": False, "error": str(e)})



@api_view(["GET"])

def get_all_uoms(request):

    """جلب كل وحدات القياس من SAP"""

    cache_key = build_cache_key(sap_master_namespace("uoms"))

    cached = cache_get(cache_key)

    if cached is not None:

        return format_success_response(cached)



    try:

        result = sap.get_all_uoms()



        if not isinstance(result, dict):

            return format_error_response(f"Unexpected result type: {type(result)}")



        if result.get("error"):

            return format_error_response(f"SAP error: {result.get('error')}")



        rows = result.get("value", [])



        uoms = []

        for row in rows:

            entry = row.get("AbsEntry")

            name = row.get("Name")

            if entry is None or not name:

                continue

            uoms.append({"value": str(entry), "label": str(name)})



        payload = {"uoms": uoms}

        cache_set(sap_master_namespace("uoms"), cache_key, payload, "sap_uoms")

        return format_success_response(payload)

    except Exception as e:

        return format_error_response(str(e))





@api_view(["GET"])

def get_uom_options(request):

    """UOM display cards — uses UnitOfMeasurements OData (same source as get_all_uoms, known to work)."""

    cache_key = build_cache_key(sap_master_namespace("uom-options"))

    cached = cache_get(cache_key)

    if cached is not None:

        return Response(cached)



    import traceback as _tb



    EXT_SELECT   = "AbsEntry,Code,Name,Weight1,Weight1Unit,Volume,VolUnit,Length1,Len1Unit"

    BASIC_SELECT = "AbsEntry,Code,Name"



    def _fetch(select_fields):

        if not sap.session_id:

            sap.login()

        headers = {

            "Cookie": f"B1SESSION={sap.session_id}",

            "Prefer": "odata.maxpagesize=500",

        }

        url = f"{sap.base_url}/UnitOfMeasurements?$select={select_fields}&$orderby=AbsEntry"

        all_rows = []

        while url:

            resp = sap._http_request('GET', url, headers=headers, verify=sap.verify_ssl, timeout=30)

            if resp.status_code == 401:

                sap.login()

                headers["Cookie"] = f"B1SESSION={sap.session_id}"

                resp = sap._http_request('GET', url, headers=headers, verify=sap.verify_ssl, timeout=30)

            if resp.status_code != 200:

                raise Exception(f"UnitOfMeasurements HTTP {resp.status_code}: {resp.text[:400]}")

            data = resp.json()

            if data.get("error"):

                raise Exception(f"UnitOfMeasurements OData error: {data['error']}")

            all_rows.extend(data.get("value", []))

            nxt = data.get("odata.nextLink") or data.get("@odata.nextLink")

            url = (nxt if nxt and nxt.startswith("http") else

                   f"{sap.base_url}/{nxt}" if nxt else None)

        return all_rows



    try:

        rows = []

        used_ext = False



        # Try extended fields first; fall back to 3 core fields

        try:

            rows = _fetch(EXT_SELECT)

            used_ext = True

            print(f"[UOM-OPTIONS] extended OData OK  rows={len(rows)}")

        except Exception as ext_err:

            print(f"[UOM-OPTIONS] extended OData failed ({ext_err}) — trying basic")

            rows = _fetch(BASIC_SELECT)

            print(f"[UOM-OPTIONS] basic OData OK  rows={len(rows)}")



        print("[UOM-OPTIONS] rows_count=", len(rows))

        print("[UOM-OPTIONS] first3=", rows[:3])



        if not rows:

            raise Exception("UnitOfMeasurements returned 0 rows — check SAP UOM configuration")



        uoms = []

        for row in rows:

            entry = row.get("AbsEntry")

            name  = _clean_value(row.get("Name"))

            code  = _clean_value(row.get("Code"))

            if entry is None or not name:

                continue

            uoms.append({

                "value":      str(entry),

                "label":      name,

                "code":       code or name,

                "weight1":    row.get("Weight1")     if used_ext else None,

                "weightUnit": _clean_value(row.get("Weight1Unit")) if used_ext else None,

                "volume":     row.get("Volume")      if used_ext else None,

                "volUnit":    _clean_value(row.get("VolUnit"))     if used_ext else None,

                "length1":    row.get("Length1")     if used_ext else None,

                "lengthUnit": _clean_value(row.get("Len1Unit"))    if used_ext else None,

            })



        print(f"[UOM-OPTIONS] returning {len(uoms)} UOMs  used_ext={used_ext}")

        payload = {"uoms": uoms}

        cache_set(

            sap_master_namespace("uom-options"), cache_key, payload, "sap_uom_options"

        )

        return Response(payload)



    except Exception as e:

        print(f"[UOM-OPTIONS] EXCEPTION: {e}\n{_tb.format_exc()}")

        return Response({"error": str(e)}, status=500)





@api_view(["GET"])

def get_company_options(request):

    """Distinct U_Company values from OBTN batch table — for Company cards in batch wizard."""

    cache_key = build_cache_key(sap_master_namespace("company-options"))

    cached = cache_get(cache_key)

    if cached is not None:

        return Response(cached)



    import traceback as _tb



    SQL_CODE = "CODX_COMPANY_V1"

    SQL_TEXT = (

        'SELECT DISTINCT '

        'T0."U_Company" AS "value", '

        'T0."U_Company" AS "label" '

        'FROM "OBTN" T0 '

        'WHERE T0."U_Company" IS NOT NULL '

        'AND T0."U_Company" <> \'\' '

        'ORDER BY T0."U_Company"'

    )



    try:

        ensure_result = sap.ensure_sql_query(SQL_CODE, "Company options from OBTN", SQL_TEXT)

        print("[COMPANY-OPTIONS] ensure_result=", ensure_result)

        if ensure_result and ensure_result.get("error"):

            print(f"[COMPANY-OPTIONS] ensure failed — returning empty: {ensure_result.get('error')}")

            return Response({"companies": []})



        if not sap.session_id:

            sap.login()

        headers = {"Cookie": f"B1SESSION={sap.session_id}"}

        url = f"{sap.base_url}/SQLQueries('{SQL_CODE}')/List"



        resp = sap._http_request('POST', url, json={}, headers=headers, verify=sap.verify_ssl, timeout=30)

        if resp.status_code == 401:

            sap.login()

            headers["Cookie"] = f"B1SESSION={sap.session_id}"

            resp = sap._http_request('POST', url, json={}, headers=headers, verify=sap.verify_ssl, timeout=30)

        if resp.status_code not in (200, 201):

            print(f"[COMPANY-OPTIONS] HTTP {resp.status_code} — returning empty")

            return Response({"companies": []})



        data = resp.json()

        if data.get("error"):

            print(f"[COMPANY-OPTIONS] query error — returning empty: {data['error']}")

            return Response({"companies": []})



        rows = data.get("value", [])

        print(f"[COMPANY-OPTIONS] rows={len(rows)} first3={rows[:3]}")



        companies = [{"value": r["value"], "label": r["label"]} for r in rows if r.get("value")]

        payload = {"companies": companies}

        cache_set(

            sap_master_namespace("company-options"), cache_key, payload, "sap_company_options"

        )

        return Response(payload)



    except Exception as e:

        print(f"[COMPANY-OPTIONS] EXCEPTION: {e}\n{_tb.format_exc()}")

        return Response({"companies": []})





# ── Production Order Attribute Rules ─────────────────────────────────────────

# These endpoints are purely additive. No existing endpoint or SAP logic is

# changed. If no rules are configured, the wizard behaves identically to before.



@api_view(["GET"])

def get_production_order_attribute_rules(request, doc_entry):

    """Return allowed-value rules for one order. Empty dict = no rules = wizard shows all options."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    try:

        rules = {r.field_key: r.allowed_values

                 for r in ProductionOrderAttributeRule.objects.filter(doc_entry=doc_entry)}

        return format_success_response({"rules": rules, "doc_entry": doc_entry})

    except Exception:

        # Fail-safe: return empty rules so the wizard is never broken

        return format_success_response({"rules": {}, "doc_entry": doc_entry})





@api_view(["GET"])

def admin_list_attribute_rules(request):

    """List all configured orders + their rules. Admin only."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return Response({"success": False, "error": "Admin only"}, status=403)

    try:

        grouped = {}

        for r in ProductionOrderAttributeRule.objects.all().order_by("doc_entry", "field_key"):

            k = r.doc_entry

            if k not in grouped:

                grouped[k] = {

                    "doc_entry": r.doc_entry,

                    "doc_num": r.doc_num,

                    "item_code": r.item_code,

                    "item_name": r.item_name,

                    "rules": {},

                }

            grouped[k]["rules"][r.field_key] = r.allowed_values

        return format_success_response({"orders": list(grouped.values())})

    except Exception as e:

        return format_error_response(str(e))





@api_view(["POST"])
@audit_mutation(module=MODULE_RULES, entity_type="ProductionOrderAttributeRule", action=ACTION_UPDATE)
def save_order_attribute_rules(request):

    """Upsert rules for a production order. Empty allowed_values deletes that field's rule. Admin only."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return Response({"success": False, "error": "Admin only"}, status=403)

    try:

        from django.db import transaction

        body = request.data

        doc_entry = int(body["doc_entry"])

        rules_input = body.get("rules", {})  # {field_key: [values]}

        meta = {

            "doc_num":   body.get("doc_num"),

            "item_code": body.get("item_code", ""),

            "item_name": body.get("item_name", ""),

        }

        saved, deleted = 0, 0

        with transaction.atomic():

            for field_key, allowed_values in rules_input.items():

                field_key = str(field_key).strip()

                if not field_key:

                    continue

                if not allowed_values:

                    deleted += ProductionOrderAttributeRule.objects.filter(

                        doc_entry=doc_entry, field_key=field_key

                    ).delete()[0]

                else:

                    ProductionOrderAttributeRule.objects.update_or_create(

                        doc_entry=doc_entry,

                        field_key=field_key,

                        defaults={"allowed_values": list(allowed_values), **meta},

                    )

                    saved += 1

        return format_success_response({"saved": saved, "deleted": deleted})

    except (KeyError, ValueError, TypeError) as e:

        return Response({"success": False, "error": str(e)}, status=400)

    except Exception as e:

        return format_error_response(str(e))





@api_view(["DELETE"])
@audit_mutation(module=MODULE_RULES, entity_type="ProductionOrderAttributeRule")
def delete_order_attribute_rules(request, doc_entry):

    """Delete ALL rules for a production order. Admin only."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return Response({"success": False, "error": "Admin only"}, status=403)

    try:

        count, _ = ProductionOrderAttributeRule.objects.filter(doc_entry=doc_entry).delete()

        return format_success_response({"deleted": count, "doc_entry": doc_entry})

    except Exception as e:

        return format_error_response(str(e))





# ── Admin: User management ───────────────────────────────────────────────────



@api_view(["GET"])

def admin_list_users(request):

    """List users manageable by the current admin."""

    guard = _require_user_management(request)

    if guard:

        return guard

    from django.contrib.auth.models import User as DjangoUser

    module = str(request.query_params.get("module") or "").strip()
    level = str(request.query_params.get("level") or "").strip().upper()
    if bool(module) != bool(level) or (module and (module not in MODULES or level not in {LEVEL_USER, LEVEL_ADMIN})):
        return Response({"success": False, "error": "Invalid module permission filter"}, status=400)

    qs = (

        DjangoUser.objects

        .select_related("userprofile")

        .prefetch_related("module_permissions")

        .filter(Q() if module else manageable_users_filter(request.user))

        .order_by("username")

    )

    from .services.master_data_search import is_lookup, lookup_parameters, lookup_offset
    lookup = is_lookup(request)
    if lookup:
        try:
            query, code, bound = lookup_parameters(request)
            offset = lookup_offset(request)
        except ValueError as exc:
            return Response({"success": False, "error": str(exc)}, status=400)
        if not code and len(query) < 2 and request.query_params.get("initial") != "1":
            return format_success_response({"users": []})
        if request.query_params.get("initial") == "1" and request.query_params.get("browse") != "1":
            bound = 1
        if code:
            if not code.isdigit():
                return format_success_response({"users": []})
            qs = qs.filter(pk=int(code))
        else:
            qs = qs.filter(Q(username__icontains=query) | Q(first_name__icontains=query) | Q(last_name__icontains=query))
    if lookup:
        users = []
        eligible_seen = 0
        for candidate in qs.iterator(chunk_size=50):
            if module and not has_module_level(candidate, module, level):
                continue
            eligible_seen += 1
            if eligible_seen <= offset:
                continue
            users.append(candidate)
            if len(users) >= bound:
                break
    else:
        users = list(qs)
        if module:
            users = [user for user in users if has_module_level(user, module, level)]
    return format_success_response({"users": [_user_to_dict(u) for u in users],
                                    **({"next_offset": offset + len(users) if len(users) == bound else None} if lookup else {})})


@api_view(["GET"])
def admin_module_permission_modules(request):
    guard = _require_super_admin(request)
    if guard:
        return guard
    return format_success_response({"modules": list(MODULE_DEFINITIONS)})


@api_view(["GET", "PUT"])
def admin_user_module_permissions(request, user_id):
    guard = _require_super_admin(request)
    if guard:
        return guard
    if request.user.id == user_id and request.method == "PUT":
        return Response(
            {"success": False, "error": "You cannot change your own module permissions"},
            status=403,
        )
    try:
        target = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return Response({"success": False, "error": "User not found"}, status=404)

    if request.method == "GET":
        return format_success_response({
            "user": _user_to_dict(target),
            "modules": list(MODULE_DEFINITIONS),
        })

    raw_permissions = request.data.get("permissions")
    if not isinstance(raw_permissions, dict):
        return Response({"success": False, "error": "permissions must be an object"}, status=400)
    unknown = set(raw_permissions) - set(MODULES)
    invalid_levels = {
        str(level).upper() for level in raw_permissions.values()
        if str(level).upper() not in {"", "NONE", LEVEL_USER, LEVEL_ADMIN}
    }
    if unknown or invalid_levels:
        return Response({"success": False, "error": "Invalid module or permission level"}, status=400)

    old_permissions = get_module_permissions(target)
    normalized = {
        module: str(level).upper()
        for module, level in raw_permissions.items()
        if str(level).upper() in {LEVEL_USER, LEVEL_ADMIN}
    }
    with transaction.atomic():
        UserModulePermission.objects.filter(user=target).delete()
        UserModulePermission.objects.bulk_create([
            UserModulePermission(user=target, module=module, level=level)
            for module, level in normalized.items()
        ])
        profile, _created = UserProfile.objects.get_or_create(user=target)
        if not profile.module_permissions_initialized:
            profile.module_permissions_initialized = True
            profile.save(update_fields=["module_permissions_initialized"])

    for module in MODULES:
        old_level = old_permissions.get(module)
        new_level = normalized.get(module)
        if old_level == new_level:
            continue
        action = (
            "MODULE_PERMISSION_GRANTED" if old_level is None
            else "MODULE_PERMISSION_REVOKED" if new_level is None
            else "MODULE_PERMISSION_LEVEL_CHANGED"
        )
        log_action(
            request=request,
            user=request.user,
            action=action,
            module=MODULE_USERS,
            entity_type="UserModulePermission",
            entity_id=str(target.id),
            description=f"Changed {module} permission for {target.username}",
            details={
                "affected_user_id": target.id,
                "affected_username": target.username,
                "module": module,
                "old_level": old_level or "NO_ACCESS",
                "new_level": new_level or "NO_ACCESS",
            },
        )

    return format_success_response({
        "user": _user_to_dict(target),
        "permissions": normalized,
    })





@api_view(["PATCH"])
@audit_mutation(module=MODULE_USERS, entity_type="User", action=ACTION_UPDATE, log_success=False)
def admin_update_user(request, user_id):

    """Update username, role, warehouse, is_active for a manageable user."""

    guard = _require_user_management(request)

    if guard:

        return guard

    from django.contrib.auth.models import User as DjangoUser

    try:

        u = DjangoUser.objects.select_related("userprofile").get(pk=user_id)

    except DjangoUser.DoesNotExist:

        return Response({"success": False, "error": "User not found"}, status=404)



    if not can_manage_user(request.user, u):

        return Response({"success": False, "error": "Cannot manage this user"}, status=403)

    raw_module_permissions = request.data.get("module_permissions")
    if raw_module_permissions is not None:
        if not is_super_admin(request.user):
            return Response({"success": False, "error": "Only super admins can assign module permissions"}, status=403)
        if not isinstance(raw_module_permissions, dict):
            return Response({"success": False, "error": "module_permissions must be an object"}, status=400)
        allowed_inline_modules = set(MODULES)
        if set(raw_module_permissions) - allowed_inline_modules:
            return Response({"success": False, "error": "Invalid inline module permission"}, status=400)
        if any(str(level).upper() not in {"", "NONE", LEVEL_USER, LEVEL_ADMIN} for level in raw_module_permissions.values()):
            return Response({"success": False, "error": "Invalid module permission level"}, status=400)



    if u.id == request.user.id and request.data.get("is_active") is False:

        return Response({"success": False, "error": "Cannot disable your own account"}, status=400)



    # Validate warehouse vs role (compute effective values before touching the DB)

    from .models import UserProfile

    _p = getattr(u, "userprofile", None)

    effective_role = _normalize_role(request.data.get("role", _p.role if _p else ROLE_PRODUCTION_USER))

    if effective_role not in VALID_ROLES:

        return Response({"success": False, "error": "Invalid role"}, status=400)

    if not can_create_user_role(request.user, effective_role):

        return Response({"success": False, "error": "Cannot assign this role"}, status=403)

    if "username" in request.data:

        new_username = str(request.data["username"]).strip()

        if not new_username:

            return Response({"success": False, "error": "Username cannot be empty"}, status=400)

        if DjangoUser.objects.exclude(pk=user_id).filter(username=new_username).exists():

            return Response({"success": False, "error": "Username already taken"}, status=400)

        u.username = new_username



    if "is_active" in request.data:

        u.is_active = bool(request.data["is_active"])



    before_data = {
        "username": u.username,
        "is_active": u.is_active,
        "role": getattr(getattr(u, "userprofile", None), "role", ""),
        "warehouse": getattr(getattr(u, "userprofile", None), "warehouse", ""),
    }

    with transaction.atomic():
        u.save()

        p = getattr(u, "userprofile", None)
        profile_changed = False
        if p is None:
            p = UserProfile(user=u)

        if "role" in request.data:
            p.role = effective_role
            profile_changed = True

        if "warehouse" in request.data:
            p.warehouse = str(request.data["warehouse"]).strip()
            profile_changed = True

        if raw_module_permissions is not None and not p.module_permissions_initialized:
            p.module_permissions_initialized = True
            profile_changed = True

        if profile_changed or p.pk is None:
            p.save()

        if raw_module_permissions is not None:
            for module, level in raw_module_permissions.items():
                normalized_level = str(level).upper()
                if normalized_level in {LEVEL_USER, LEVEL_ADMIN}:
                    UserModulePermission.objects.update_or_create(
                        user=u, module=module, defaults={"level": normalized_level}
                    )
                else:
                    UserModulePermission.objects.filter(user=u, module=module).delete()

    after_data = {
        "username": u.username,
        "is_active": u.is_active,
        "role": p.role,
        "warehouse": p.warehouse,
    }

    log_action(
        request=request,
        user=request.user,
        action=ACTION_UPDATE,
        module=MODULE_USERS,
        entity_type="User",
        entity_id=str(u.id),
        description=f"Updated user {u.username}",
        details={"username": u.username, "before": before_data, "after": after_data},
    )

    return format_success_response(_user_to_dict(u))





@api_view(["POST"])
@audit_mutation(module=MODULE_USERS, entity_type="User", action=ACTION_UPDATE, log_success=False)
def admin_reset_password(request, user_id):

    """Reset a manageable user's password."""

    guard = _require_user_management(request)

    if guard:

        return guard

    password = str(request.data.get("password", "")).strip()

    if not password:

        return Response({"success": False, "error": "Password is required"}, status=400)

    if len(password) < 4:

        return Response({"success": False, "error": "Password must be at least 4 characters"}, status=400)

    from django.contrib.auth.models import User as DjangoUser

    try:

        u = DjangoUser.objects.get(pk=user_id)

    except DjangoUser.DoesNotExist:

        return Response({"success": False, "error": "User not found"}, status=404)

    if not can_manage_user(request.user, u):

        return Response({"success": False, "error": "Cannot manage this user"}, status=403)

    u.set_password(password)

    u.save()

    log_action(
        request=request,
        user=request.user,
        action=ACTION_UPDATE,
        module=MODULE_USERS,
        entity_type="User",
        entity_id=str(u.id),
        description=f"Reset password for user {u.username}",
        details={"username": u.username},
    )

    return format_success_response({"message": "Password updated successfully"})





@api_view(["POST"])
@audit_mutation(module=MODULE_USERS, entity_type="User", action=ACTION_UPDATE, log_success=False)
def admin_set_user_active(request, user_id):

    """Enable or disable a manageable user account."""

    guard = _require_user_management(request)

    if guard:

        return guard

    if "is_active" not in request.data:

        return Response({"success": False, "error": "is_active field required"}, status=400)

    from django.contrib.auth.models import User as DjangoUser

    try:

        u = DjangoUser.objects.select_related("userprofile").get(pk=user_id)

    except DjangoUser.DoesNotExist:

        return Response({"success": False, "error": "User not found"}, status=404)

    if not can_manage_user(request.user, u):

        return Response({"success": False, "error": "Cannot manage this user"}, status=403)

    if u.id == request.user.id and not bool(request.data["is_active"]):

        return Response({"success": False, "error": "Cannot disable your own account"}, status=400)

    prev_active = u.is_active
    u.is_active = bool(request.data["is_active"])
    u.save()

    log_action(
        request=request,
        user=request.user,
        action=ACTION_UPDATE,
        module=MODULE_USERS,
        entity_type="User",
        entity_id=str(u.id),
        description=f"{'Activated' if u.is_active else 'Disabled'} account for user {u.username}",
        details={"username": u.username, "before": {"is_active": prev_active}, "after": {"is_active": u.is_active}},
    )

    return format_success_response(_user_to_dict(u))





@api_view(["DELETE"])
@audit_mutation(module=MODULE_USERS, entity_type="User", action=ACTION_DELETE, log_success=False)
def admin_delete_user(request, user_id):

    """Permanently delete a manageable user. Blocked if user has attribute rules."""

    guard = _require_user_management(request)

    if guard:

        return guard

    from django.contrib.auth.models import User as DjangoUser

    try:

        u = DjangoUser.objects.select_related("userprofile").get(pk=user_id)

    except DjangoUser.DoesNotExist:

        return Response({"success": False, "error": "User not found"}, status=404)

    if not can_manage_user(request.user, u):

        return Response({"success": False, "error": "Cannot manage this user"}, status=403)

    if u.id == request.user.id:

        return Response({"success": False, "error": "Cannot delete your own account"}, status=400)

    from .models import UserAttributeRule

    rule_count = UserAttributeRule.objects.filter(user=u).count()

    if rule_count > 0:

        return Response({

            "success": False,

            "error": f"Cannot delete: user has {rule_count} attribute rule(s). Disable instead.",

        }, status=400)

    username = u.username
    user_role = getattr(getattr(u, "userprofile", None), "role", "")

    u.delete()

    log_action(
        request=request,
        user=request.user,
        action=ACTION_DELETE,
        module=MODULE_USERS,
        entity_type="User",
        entity_id=str(user_id),
        description=f"Deleted user {username}",
        details={"username": username, "role": user_role},
    )

    return format_success_response({"message": f"User '{username}' deleted"})





# ── User Attribute Rules ──────────────────────────────────────────────────────



@api_view(["GET"])

def get_my_user_attribute_rules(request):

    """Returns attribute rules for the current user. Always returns 200 with empty dict on error."""

    started_at = time.perf_counter()

    _trace_rule_endpoint(request, "user-attribute-rules/me:start")

    if not request.user.is_authenticated:

        _trace_rule_endpoint(

            request,

            "user-attribute-rules/me:end",

            started_at,

            authenticated=False,

            rules_count=0,

            returned_empty=True,

        )

        return Response({"success": True, "data": {"rules": {}}})

    try:

        from .models import UserAttributeRule

        rules = {r.field_key: r.allowed_values

                 for r in UserAttributeRule.objects.filter(user=request.user)}

        _trace_rule_endpoint(

            request,

            "user-attribute-rules/me:end",

            started_at,

            authenticated=True,

            rules_count=len(rules),

            value_count=sum(len(v or []) for v in rules.values()),

            returned_empty=(len(rules) == 0),

        )

        return format_success_response({"rules": rules})

    except Exception as exc:

        _trace_rule_endpoint(

            request,

            "user-attribute-rules/me:error",

            started_at,

            error=str(exc),

            rules_count=0,

            returned_empty=True,

        )

        return Response({"success": True, "data": {"rules": {}}})





@api_view(["GET"])

def admin_list_user_attribute_rules(request):

    """List all users + their rules. Admin only."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return Response({"success": False, "error": "Admin only"}, status=403)

    from .models import UserAttributeRule

    grouped = {}

    eligible_users = [
        user for user in User.objects.prefetch_related("module_permissions")
        if has_module_level(user, PERMISSION_MODULE_PRODUCTION, LEVEL_USER)
    ]

    qs = (

        UserAttributeRule.objects

        .select_related("user")

        .filter(user__in=eligible_users)

        .order_by("user__username", "field_key")

    )

    for r in qs:

        uid = str(r.user_id)

        if uid not in grouped:

            grouped[uid] = {"user_id": r.user_id, "username": r.user.username, "rules": {}}

        grouped[uid]["rules"][r.field_key] = r.allowed_values

    return format_success_response({"users": list(grouped.values())})





@api_view(["POST"])
@audit_mutation(module=MODULE_RULES, entity_type="UserAttributeRule", action=ACTION_UPDATE)
def admin_set_user_attribute_rules(request):

    """Upsert attribute rules for a user. Empty allowed_values deletes that field's rule. Admin only."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return Response({"success": False, "error": "Admin only"}, status=403)

    from .models import UserAttributeRule

    from django.contrib.auth.models import User as DjangoUser

    from django.db import transaction

    try:

        body = request.data

        user_id = int(body["user_id"])

        rules_input = body.get("rules", {})

        target_user = DjangoUser.objects.get(pk=user_id)

        if not has_module_level(target_user, PERMISSION_MODULE_PRODUCTION, LEVEL_USER):

            return Response({"success": False, "error": "User is not eligible for Production User Rules"}, status=400)

        saved, deleted = 0, 0

        with transaction.atomic():

            for field_key, allowed_values in rules_input.items():

                field_key = str(field_key).strip()

                if not field_key:

                    continue

                if not allowed_values:

                    deleted += UserAttributeRule.objects.filter(

                        user=target_user, field_key=field_key

                    ).delete()[0]

                else:

                    UserAttributeRule.objects.update_or_create(

                        user=target_user, field_key=field_key,

                        defaults={"allowed_values": list(allowed_values)},

                    )

                    saved += 1

        return format_success_response({"saved": saved, "deleted": deleted, "user_id": user_id})

    except DjangoUser.DoesNotExist:

        return Response({"success": False, "error": "User not found"}, status=404)

    except (KeyError, ValueError, TypeError) as e:

        return Response({"success": False, "error": str(e)}, status=400)

    except Exception as e:

        return format_error_response(str(e))





@api_view(["DELETE"])
@audit_mutation(module=MODULE_RULES, entity_type="UserAttributeRule")
def admin_delete_user_attribute_rules(request, user_id):

    """Delete ALL attribute rules for a user. Admin only."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return Response({"success": False, "error": "Admin only"}, status=403)

    from .models import UserAttributeRule

    try:

        target_user = User.objects.get(pk=user_id)

    except User.DoesNotExist:

        return Response({"success": False, "error": "User not found"}, status=404)

    if not can_manage_user(request.user, target_user):

        return Response({"success": False, "error": "Cannot manage this user"}, status=403)

    count, _ = UserAttributeRule.objects.filter(user_id=user_id).delete()

    return format_success_response({"deleted": count, "user_id": user_id})





# ── Warehouse Attribute Visibility Rules ──────────────────────────────────────



@api_view(["GET"])

def get_warehouse_attribute_visibility_rules(request, warehouse_code):

    """Returns hidden_fields list for a warehouse. Always 200 with [] on error."""

    started_at = time.perf_counter()

    _trace_rule_endpoint(

        request,

        "warehouse-attribute-visibility-rules:start",

        warehouse=warehouse_code,

    )

    if not request.user.is_authenticated:

        _trace_rule_endpoint(

            request,

            "warehouse-attribute-visibility-rules:end",

            started_at,

            authenticated=False,

            warehouse=warehouse_code,

            hidden_fields_count=0,

            returned_empty=True,

        )

        return Response({"success": True, "data": {"hidden_fields": []}})

    try:

        from .models import WarehouseAttributeVisibilityRule

        rule = WarehouseAttributeVisibilityRule.objects.filter(

            warehouse_code=warehouse_code

        ).first()

        hidden_fields = rule.hidden_fields if rule else []

        _trace_rule_endpoint(

            request,

            "warehouse-attribute-visibility-rules:end",

            started_at,

            authenticated=True,

            warehouse=warehouse_code,

            rule_exists=bool(rule),

            hidden_fields_count=len(hidden_fields),

            returned_empty=(len(hidden_fields) == 0),

        )

        return format_success_response({"hidden_fields": hidden_fields})

    except Exception as exc:

        _trace_rule_endpoint(

            request,

            "warehouse-attribute-visibility-rules:error",

            started_at,

            warehouse=warehouse_code,

            error=str(exc),

            hidden_fields_count=0,

            returned_empty=True,

        )

        return Response({"success": True, "data": {"hidden_fields": []}})





@api_view(["GET"])

def admin_list_warehouse_visibility_rules(request):

    """List all warehouse visibility rules. Admin only."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return Response({"success": False, "error": "Admin only"}, status=403)

    from .models import WarehouseAttributeVisibilityRule

    rules = list(WarehouseAttributeVisibilityRule.objects.values(

        "id", "warehouse_code", "hidden_fields", "created_at", "updated_at"

    ))

    return format_success_response({"rules": rules})





@api_view(["POST"])
@audit_mutation(module=MODULE_RULES, entity_type="WarehouseVisibilityRule", action=ACTION_UPDATE)
def admin_set_warehouse_visibility_rule(request):

    """Upsert hidden_fields for a warehouse. Admin only."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return Response({"success": False, "error": "Admin only"}, status=403)

    from .models import WarehouseAttributeVisibilityRule

    try:

        body = request.data

        warehouse_code = str(body["warehouse_code"]).strip()

        hidden_fields = list(body.get("hidden_fields", []))

        if not warehouse_code:

            return Response({"success": False, "error": "warehouse_code required"}, status=400)

        rule, created = WarehouseAttributeVisibilityRule.objects.update_or_create(

            warehouse_code=warehouse_code,

            defaults={"hidden_fields": hidden_fields},

        )

        return format_success_response({

            "id": rule.id, "warehouse_code": rule.warehouse_code,

            "hidden_fields": rule.hidden_fields, "created": created,

        })

    except (KeyError, ValueError, TypeError) as e:

        return Response({"success": False, "error": str(e)}, status=400)

    except Exception as e:

        return format_error_response(str(e))





@api_view(["DELETE"])
@audit_mutation(module=MODULE_RULES, entity_type="WarehouseVisibilityRule")
def admin_delete_warehouse_visibility_rule(request, rule_id):

    """Delete a warehouse visibility rule by id. Admin only."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return Response({"success": False, "error": "Admin only"}, status=403)

    from .models import WarehouseAttributeVisibilityRule

    try:

        WarehouseAttributeVisibilityRule.objects.get(pk=rule_id).delete()

        return format_success_response({"deleted": 1})

    except WarehouseAttributeVisibilityRule.DoesNotExist:

        return Response({"success": False, "error": "Rule not found"}, status=404)





@api_view(["DELETE"])
@audit_mutation(module=MODULE_RULES, entity_type="WarehouseVisibilityRule")
def admin_delete_warehouse_visibility_rule_by_code(request, warehouse_code):

    """Delete warehouse visibility rule by warehouse_code. Admin only."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return Response({"success": False, "error": "Admin only"}, status=403)

    from .models import WarehouseAttributeVisibilityRule

    count, _ = WarehouseAttributeVisibilityRule.objects.filter(warehouse_code=warehouse_code).delete()

    return format_success_response({"deleted": count, "warehouse_code": warehouse_code})





# ── Warehouse Attribute Rules (value filtering, mirrors UserAttributeRule) ────



@api_view(["GET"])

def get_warehouse_attribute_rules(request, warehouse_code):

    """Returns attribute rules (allowed values) for a warehouse. Always 200 with empty dict on error."""

    started_at = time.perf_counter()

    _trace_rule_endpoint(

        request,

        "warehouse-attribute-rules:start",

        warehouse=warehouse_code,

    )

    if not request.user.is_authenticated:

        _trace_rule_endpoint(

            request,

            "warehouse-attribute-rules:end",

            started_at,

            authenticated=False,

            warehouse=warehouse_code,

            rules_count=0,

            returned_empty=True,

        )

        return Response({"success": True, "data": {"rules": {}}})

    try:

        from .models import WarehouseAttributeRule

        rules = {r.field_key: r.allowed_values

                 for r in WarehouseAttributeRule.objects.filter(warehouse_code=warehouse_code)}

        _trace_rule_endpoint(

            request,

            "warehouse-attribute-rules:end",

            started_at,

            authenticated=True,

            warehouse=warehouse_code,

            rules_count=len(rules),

            value_count=sum(len(v or []) for v in rules.values()),

            returned_empty=(len(rules) == 0),

        )

        return format_success_response({"rules": rules})

    except Exception as exc:

        _trace_rule_endpoint(

            request,

            "warehouse-attribute-rules:error",

            started_at,

            warehouse=warehouse_code,

            error=str(exc),

            rules_count=0,

            returned_empty=True,

        )

        return Response({"success": True, "data": {"rules": {}}})





@api_view(["GET"])

def admin_list_warehouse_attribute_rules(request):

    """List all warehouses with their attribute rules. Admin only."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return Response({"success": False, "error": "Admin only"}, status=403)

    from .models import WarehouseAttributeRule

    grouped = {}

    for r in WarehouseAttributeRule.objects.order_by("warehouse_code", "field_key"):

        wc = r.warehouse_code

        if wc not in grouped:

            grouped[wc] = {"warehouse_code": wc, "rules": {}}

        grouped[wc]["rules"][r.field_key] = r.allowed_values

    return format_success_response({"warehouses": list(grouped.values())})





@api_view(["POST"])
@audit_mutation(module=MODULE_RULES, entity_type="WarehouseAttributeRule", action=ACTION_UPDATE)
def admin_set_warehouse_attribute_rules(request):

    """Upsert attribute rules for a warehouse. Empty allowed_values deletes that field's rule. Admin only."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return Response({"success": False, "error": "Admin only"}, status=403)

    from .models import WarehouseAttributeRule

    from django.db import transaction

    try:

        body = request.data

        warehouse_code = str(body["warehouse_code"]).strip()

        rules_input = body.get("rules", {})

        if not warehouse_code:

            return Response({"success": False, "error": "warehouse_code required"}, status=400)

        saved, deleted = 0, 0

        with transaction.atomic():

            for field_key, allowed_values in rules_input.items():

                field_key = str(field_key).strip()

                if not field_key:

                    continue

                if not allowed_values:

                    deleted += WarehouseAttributeRule.objects.filter(

                        warehouse_code=warehouse_code, field_key=field_key

                    ).delete()[0]

                else:

                    WarehouseAttributeRule.objects.update_or_create(

                        warehouse_code=warehouse_code, field_key=field_key,

                        defaults={"allowed_values": list(allowed_values)},

                    )

                    saved += 1

        return format_success_response({"saved": saved, "deleted": deleted, "warehouse_code": warehouse_code})

    except (KeyError, ValueError, TypeError) as e:

        return Response({"success": False, "error": str(e)}, status=400)

    except Exception as e:

        return format_error_response(str(e))





@api_view(["DELETE"])
@audit_mutation(module=MODULE_RULES, entity_type="WarehouseAttributeRule")
def admin_delete_warehouse_attribute_rules(request, warehouse_code):

    """Delete ALL attribute rules for a warehouse. Admin only."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return Response({"success": False, "error": "Admin only"}, status=403)

    from .models import WarehouseAttributeRule

    count, _ = WarehouseAttributeRule.objects.filter(warehouse_code=warehouse_code).delete()

    return format_success_response({"deleted": count, "warehouse_code": warehouse_code})





# ── Order Attribute Visibility Rules ──────────────────────────────────────────



@api_view(["GET"])

def get_order_attribute_visibility(request, doc_entry):

    """Returns hidden_fields for a production order. Always 200 with [] on error."""

    started_at = time.perf_counter()

    _trace_rule_endpoint(

        request,

        "order-attribute-visibility:start",

        doc_entry=doc_entry,

    )

    if not request.user.is_authenticated:

        _trace_rule_endpoint(

            request,

            "order-attribute-visibility:end",

            started_at,

            authenticated=False,

            doc_entry=doc_entry,

            hidden_fields_count=0,

            returned_empty=True,

        )

        return Response({"success": True, "data": {"hidden_fields": []}})

    try:

        from .models import OrderAttributeVisibilityRule

        rule = OrderAttributeVisibilityRule.objects.filter(doc_entry=doc_entry).first()

        hidden_fields = rule.hidden_fields if rule else []

        _trace_rule_endpoint(

            request,

            "order-attribute-visibility:end",

            started_at,

            authenticated=True,

            doc_entry=doc_entry,

            rule_exists=bool(rule),

            hidden_fields_count=len(hidden_fields),

            returned_empty=(len(hidden_fields) == 0),

        )

        return format_success_response({"hidden_fields": hidden_fields})

    except Exception as exc:

        _trace_rule_endpoint(

            request,

            "order-attribute-visibility:error",

            started_at,

            doc_entry=doc_entry,

            error=str(exc),

            hidden_fields_count=0,

            returned_empty=True,

        )

        return Response({"success": True, "data": {"hidden_fields": []}})





@api_view(["GET"])

def admin_list_order_attribute_visibility(request):

    """List all orders with visibility rules. Admin only."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return Response({"success": False, "error": "Admin only"}, status=403)

    from .models import OrderAttributeVisibilityRule

    orders = list(OrderAttributeVisibilityRule.objects.values(

        "id", "doc_entry", "doc_num", "item_code", "item_name", "hidden_fields"

    ))

    return format_success_response({"orders": orders})





@api_view(["POST"])
@audit_mutation(module=MODULE_RULES, entity_type="ProductionOrderVisibilityRule", action=ACTION_UPDATE)
def admin_set_order_attribute_visibility(request):

    """Upsert hidden_fields for a production order. Admin only."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return Response({"success": False, "error": "Admin only"}, status=403)

    from .models import OrderAttributeVisibilityRule

    try:

        body = request.data

        doc_entry = int(body["doc_entry"])

        hidden_fields = list(body.get("hidden_fields", []))

        rule, created = OrderAttributeVisibilityRule.objects.update_or_create(

            doc_entry=doc_entry,

            defaults={

                "doc_num":   body.get("doc_num"),

                "item_code": str(body.get("item_code", "")),

                "item_name": str(body.get("item_name", "")),

                "hidden_fields": hidden_fields,

            },

        )

        return format_success_response({

            "id": rule.id, "doc_entry": rule.doc_entry,

            "hidden_fields": rule.hidden_fields, "created": created,

        })

    except (KeyError, ValueError, TypeError) as e:

        return Response({"success": False, "error": str(e)}, status=400)

    except Exception as e:

        return format_error_response(str(e))





@api_view(["DELETE"])
@audit_mutation(module=MODULE_RULES, entity_type="ProductionOrderVisibilityRule")
def admin_delete_order_attribute_visibility(request, doc_entry):

    """Delete the visibility rule for a production order. Admin only."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return Response({"success": False, "error": "Admin only"}, status=403)

    from .models import OrderAttributeVisibilityRule

    count, _ = OrderAttributeVisibilityRule.objects.filter(doc_entry=doc_entry).delete()

    return format_success_response({"deleted": count, "doc_entry": doc_entry})





# ── User Attribute Visibility Rules ───────────────────────────────────────────



@api_view(["GET"])

def get_my_user_attribute_visibility(request):

    """Returns hidden_fields for the current user. Always 200 with [] on error."""

    if not request.user.is_authenticated:

        return Response({"success": True, "data": {"hidden_fields": []}})

    try:

        from .models import UserAttributeVisibilityRule

        rule = UserAttributeVisibilityRule.objects.filter(user=request.user).first()

        return format_success_response({"hidden_fields": rule.hidden_fields if rule else []})

    except Exception:

        return Response({"success": True, "data": {"hidden_fields": []}})





@api_view(["GET"])

def admin_list_user_attribute_visibility(request):

    """List all users with visibility rules. Admin only."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return Response({"success": False, "error": "Admin only"}, status=403)

    from .models import UserAttributeVisibilityRule

    eligible_users = [
        user for user in User.objects.prefetch_related("module_permissions")
        if has_module_level(user, PERMISSION_MODULE_PRODUCTION, LEVEL_USER)
    ]

    rules = [

        {"user_id": r.user_id, "username": r.user.username, "hidden_fields": r.hidden_fields}

        for r in (

            UserAttributeVisibilityRule.objects

            .select_related("user")

            .filter(user__in=eligible_users)

            .order_by("user__username")

        )

    ]

    return format_success_response({"users": rules})





@api_view(["POST"])
@audit_mutation(module=MODULE_RULES, entity_type="UserAttributeVisibility", action=ACTION_UPDATE)
def admin_set_user_attribute_visibility(request):

    """Upsert hidden_fields for a user. Admin only."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return Response({"success": False, "error": "Admin only"}, status=403)

    from .models import UserAttributeVisibilityRule

    from django.contrib.auth.models import User as DjangoUser

    try:

        body = request.data

        user_id = int(body["user_id"])

        hidden_fields = list(body.get("hidden_fields", []))

        target_user = DjangoUser.objects.get(pk=user_id)

        if not has_module_level(target_user, PERMISSION_MODULE_PRODUCTION, LEVEL_USER):

            return Response({"success": False, "error": "User is not eligible for Production User Rules"}, status=400)

        rule, created = UserAttributeVisibilityRule.objects.update_or_create(

            user=target_user,

            defaults={"hidden_fields": hidden_fields},

        )

        return format_success_response({

            "user_id": user_id, "hidden_fields": rule.hidden_fields, "created": created,

        })

    except DjangoUser.DoesNotExist:

        return Response({"success": False, "error": "User not found"}, status=404)

    except (KeyError, ValueError, TypeError) as e:

        return Response({"success": False, "error": str(e)}, status=400)

    except Exception as e:

        return format_error_response(str(e))





@api_view(["DELETE"])
@audit_mutation(module=MODULE_RULES, entity_type="UserAttributeVisibility")
def admin_delete_user_attribute_visibility(request, user_id):

    """Delete the visibility rule for a user. Admin only."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return Response({"success": False, "error": "Admin only"}, status=403)

    from .models import UserAttributeVisibilityRule

    try:

        target_user = User.objects.get(pk=user_id)

    except User.DoesNotExist:

        return Response({"success": False, "error": "User not found"}, status=404)

    if not can_manage_user(request.user, target_user):

        return Response({"success": False, "error": "Cannot manage this user"}, status=403)

    count, _ = UserAttributeVisibilityRule.objects.filter(user_id=user_id).delete()

    return format_success_response({"deleted": count, "user_id": user_id})





# ── Production Order Visibility Rules ────────────────────────────────────────



@api_view(["GET"])

def admin_list_order_visibility_rules(request):

    """List all visibility rules for a given warehouse. Admin only.

    GET /admin/production-order-visibility-rules/?warehouse_code=XX"""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return Response({"success": False, "error": "Admin only"}, status=403)

    warehouse_code = request.query_params.get("warehouse_code", "").strip()

    qs = ProductionOrderVisibilityRule.objects.all()

    if warehouse_code:

        qs = qs.filter(warehouse_code=warehouse_code)

    rules = [

        {

            "id": r.id,

            "warehouse_code": r.warehouse_code,

            "production_order_doc_num": r.production_order_doc_num,

            "production_order_doc_entry": r.production_order_doc_entry,

            "item_code": r.item_code,

            "item_name": r.item_name,

            "is_hidden": r.is_hidden,

        }

        for r in qs

    ]

    return format_success_response({"rules": rules})





@api_view(["POST"])
@audit_mutation(module=MODULE_RULES, entity_type="ProductionOrderVisibilityRuleBulk", action=ACTION_UPDATE)
def admin_bulk_update_order_visibility(request):

    """Upsert visibility rules for a list of orders in a warehouse. Admin only.

    Body: { warehouse_code, orders: [{doc_num, doc_entry, item_code, item_name, is_hidden}] }"""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)

    if not can_manage_production(request.user):

        return Response({"success": False, "error": "Admin only"}, status=403)

    warehouse_code = (request.data.get("warehouse_code") or "").strip()

    if not warehouse_code:

        return Response({"success": False, "error": "warehouse_code is required"}, status=400)

    orders = request.data.get("orders") or []

    updated = 0

    for o in orders:

        doc_num = str(o.get("doc_num") or "").strip()

        if not doc_num:

            continue

        ProductionOrderVisibilityRule.objects.update_or_create(

            warehouse_code=warehouse_code,

            production_order_doc_num=doc_num,

            defaults={

                "production_order_doc_entry": o.get("doc_entry") or 0,

                "item_code": o.get("item_code") or "",

                "item_name": o.get("item_name") or "",

                "is_hidden": bool(o.get("is_hidden", False)),

                "created_by": request.user,

            },

        )

        updated += 1

    return format_success_response({"updated": updated})





# ── Pending Receipt Review flow ───────────────────────────────────────────────



def _today_iso():

    return datetime.date.today().isoformat()





def _pending_receipt_to_dict(r, include_batches=False):

    d = {

        "id": r.id,

        "production_order_doc_entry": r.production_order_doc_entry,

        "production_order_doc_num":   r.production_order_doc_num,

        "item_code":        r.item_code,

        "item_name":        r.item_name,

        "item_description": r.item_name,   # explicit alias used by Receipt Review

        "warehouse_code": r.warehouse_code,

        "warehouse_name": r.warehouse_name,

        "uom_entry":    r.uom_entry,

        "uom_label":    r.uom_label,

        "unit_count":   r.unit_count,

        "final_quantity": r.final_quantity,

        "status":       r.status,

        "created_by":   r.created_by.username if r.created_by else None,

        "reviewed_by":  r.reviewed_by.username if r.reviewed_by else None,

        "sap_document_number": r.sap_document_number,

        "sap_order_number":    r.sap_order_number,

        "sap_error":    r.sap_error,

        "is_over_receipt":       r.is_over_receipt,

        "over_receipt_quantity": r.over_receipt_quantity,

        "over_receipt_warning":  r.over_receipt_warning,

        "sap_remaining_at_submit":         r.sap_remaining_at_submit,

        "local_pending_quantity_at_submit": r.local_pending_quantity_at_submit,

        "available_quantity_at_submit":     r.available_quantity_at_submit,

        "requested_quantity": r.requested_quantity,

        "rejection_reason": r.rejection_reason,

        "created_at":  r.created_at.isoformat() if r.created_at else None,

        "updated_at":  r.updated_at.isoformat() if r.updated_at else None,

        "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,

        "posted_at":   r.posted_at.isoformat() if r.posted_at else None,

    }

    if include_batches:

        d["batches"] = [

            {

                "id": b.id,

                "batch_number":  b.batch_number,

                "quantity":      b.quantity,

                "unit_count":    b.unit_count,

                "uom_entry":     b.uom_entry,

                "uom_label":     b.uom_label,

                "bin_location":  b.bin_location,

                "bin_abs_entry": b.bin_abs_entry,

                "admission_date": b.admission_date,

                "mfr_date":      b.mfr_date,

                "brand":    b.brand,

                "size":     b.size,

                "category": b.category,

                "packing":  b.packing,

                "season":   b.season,

                "company":  b.company,

                "vendor":   b.vendor,

                "part":     b.part,

                "number":   b.number,

                "details":  b.details,

                "extra_specification": b.extra_specification,

                "reservation_id":     b.batch_reservation_id,

                **b.production_pallet,

            }

            for b in r.batches.all()

        ]

    return d





@api_view(["POST"])
@audit_mutation(module=MODULE_PRODUCTION_RECEIPT, entity_type="BatchNumberReservation", action=ACTION_RESERVE)
def reserve_next_batch_number(request):

    """Reserve the next batch number for a production order.

    Takes both SAP and local reservations into account to prevent duplicates."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)



    order_num = str(request.data.get("production_order_doc_num", "")).strip()

    doc_entry = request.data.get("production_order_doc_entry")

    item_code = str(request.data.get("item_code", "")).strip()



    if not order_num or not doc_entry:

        return Response(

            {"success": False, "error": "production_order_doc_num and production_order_doc_entry are required"},

            status=400,

        )



    # Compute the globally safe starting suffix (SAP OBTN + OData + local DB)

    sap_next_suffix = _get_true_next_batch_suffix(order_num, item_code)



    max_retries = 5

    for attempt in range(max_retries):

        try:

            with transaction.atomic():

                local_max   = _local_batch_max_suffix(order_num)

                next_suffix = max(sap_next_suffix, local_max + 1)

                batch_number = f"{order_num}-{next_suffix}"



                reservation = BatchNumberReservation.objects.create(

                    production_order_doc_entry=int(doc_entry),

                    production_order_doc_num=order_num,

                    item_code=item_code,

                    suffix=next_suffix,

                    batch_number=batch_number,

                    status=BatchNumberReservation.RESERVED,

                    reserved_by=request.user,

                )

                print(f"[RESERVE] attempt={attempt + 1} → {batch_number} (id={reservation.id})")

                return format_success_response({

                    "batch_number":   batch_number,

                    "reservation_id": reservation.id,

                    "suffix":         next_suffix,

                })



        except IntegrityError as e:

            print(f"[RESERVE] IntegrityError attempt {attempt + 1}: {e}")

            continue



    return format_error_response(

        f"Failed to reserve batch number after {max_retries} attempts.",

        status.HTTP_409_CONFLICT,

    )





@api_view(["POST"])
@audit_mutation(module=MODULE_PRODUCTION_RECEIPT, entity_type="PendingReceipt", action=ACTION_CREATE, log_success=False)
def create_pending_receipt(request):

    """Save a receipt for admin review. Does NOT post to SAP."""

    actor = _authenticated_actor(request)

    if not actor:

        return Response({"success": False, "error": "Authentication required"}, status=401)



    try:

        data = request.data

        doc_entry  = data.get("ProductionOrderEntry") or data.get("BaseEntry")

        order_num  = str(data.get("ProductionOrderNumber", "")).strip()

        quantity   = float(data.get("Quantity") or 0)

        warehouse_code = str(data.get("Warehouse") or "").strip()

        batches    = data.get("Batches") or []

        uom_entry  = str(data.get("UomEntry") or "").strip()

        uom_label  = str(data.get("UomLabel") or "").strip()

        unit_count = int(data.get("UnitCount") or 0)
        from .production_pallet_views import validate_receipt_pallets
        try:
            validate_receipt_pallets(batches)
        except ValueError as exc:
            return format_error_response(str(exc), status.HTTP_400_BAD_REQUEST)



        if not doc_entry:

            return format_error_response("ProductionOrderEntry is required", status.HTTP_400_BAD_REQUEST)

        if quantity <= 0:

            return format_error_response("Quantity must be greater than zero", status.HTTP_400_BAD_REQUEST)

        if unit_count < 0:

            return format_error_response("UnitCount cannot be negative", status.HTTP_400_BAD_REQUEST)

        for i, batch in enumerate(batches):

            batch_qty = float(batch.get("quantity") or 0)

            batch_units = int(batch.get("unitCount") or batch.get("unit_count") or 0)

            if batch_qty < 0:

                return format_error_response(

                    f"Batch {i + 1} quantity cannot be negative",

                    status.HTTP_400_BAD_REQUEST,

                )

            if batch_units < 0:

                return format_error_response(

                    f"Batch {i + 1} unit count cannot be negative",

                    status.HTTP_400_BAD_REQUEST,

                )



        # Fetch production order to get item info + SAP remaining qty

        production_order = sap.get_production_order(int(doc_entry))

        item_code = production_order.get("ItemNo") or production_order.get("ItemCode") or ""

        item_name = production_order.get("ItemDescription") or production_order.get("ItemName") or ""



        planned_qty   = float(production_order.get("PlannedQuantity")

                              or production_order.get("PlannedQty") or 0)

        completed_qty = float(production_order.get("CompletedQuantity")

                              or production_order.get("CmpltQty") or 0)

        sap_remaining = planned_qty - completed_qty



        # Local pending quantity for same order (already in review, not yet posted)

        local_pending = (

            PendingReceipt.objects

            .filter(

                production_order_doc_num=order_num,

                status=PendingReceipt.PENDING_REVIEW,

            )

            .aggregate(t=Sum("final_quantity"))["t"]

        ) or 0.0



        available_qty = sap_remaining - local_pending

        is_over   = quantity > available_qty

        over_qty  = max(0.0, quantity - available_qty) if is_over else 0.0

        over_warn = ""

        if is_over:

            lbl = uom_label or "units"

            over_warn = (

                f"Requested quantity exceeds available quantity by "

                f"{over_qty:.2f} {lbl}."

            )



        # Warehouse name lookup (best-effort)

        warehouse_name = warehouse_code

        try:

            for w in (sap.get_warehouses().get("value", [])):

                if w.get("WarehouseCode") == warehouse_code:

                    warehouse_name = w.get("WarehouseName") or warehouse_code

                    break

        except Exception:

            pass



        # ── Pre-reserve batch numbers — each in its own isolated atomic block.

        # Reservations are committed one at a time so a UNIQUE conflict on one

        # suffix only rolls back that single savepoint; we retry with the next

        # free suffix.  Sequential reservations within the same request work

        # correctly because local_max is re-queried after each committed row.

        sap_next_suffix = _get_true_next_batch_suffix(order_num, item_code)



        pre_reservations = []   # (batch_index, batch_number, reservation_or_None)

        for i, batch in enumerate(batches):

            auto_generated = batch.get("autoGenerated", True)

            if not auto_generated:

                manual_batch_number = str(batch.get("batchNumber") or "").strip()

                if not manual_batch_number:

                    return format_error_response(

                        f"Batch number is required for manual batch {i + 1}.",

                        status.HTTP_400_BAD_REQUEST,

                    )

                if _batch_number_exists_anywhere(manual_batch_number):

                    return format_error_response("Batch number already exists.", status.HTTP_409_CONFLICT)



                manual_suffix = _manual_batch_suffix(order_num, manual_batch_number)

                reservation = None

                if manual_suffix is not None:

                    try:

                        with transaction.atomic():

                            reservation = BatchNumberReservation.objects.create(

                                production_order_doc_entry=int(doc_entry),

                                production_order_doc_num=order_num,

                                item_code=item_code,

                                suffix=manual_suffix,

                                batch_number=manual_batch_number,

                                status=BatchNumberReservation.PENDING_REVIEW,

                                reserved_by=actor,

                            )

                    except IntegrityError:

                        return format_error_response("Batch number already exists.", status.HTTP_409_CONFLICT)

                pre_reservations.append((i, manual_batch_number, reservation))

                continue



            reservation = None

            for attempt in range(_MAX_BATCH_CONFLICT_RETRIES):

                try:

                    with transaction.atomic():

                        local_max    = _local_batch_max_suffix(order_num)

                        next_suffix  = max(sap_next_suffix, local_max + 1)

                        batch_number = f"{order_num}-{next_suffix}"

                        reservation  = BatchNumberReservation.objects.create(

                            production_order_doc_entry=int(doc_entry),

                            production_order_doc_num=order_num,

                            item_code=item_code,

                            suffix=next_suffix,

                            batch_number=batch_number,

                            status=BatchNumberReservation.PENDING_REVIEW,

                            reserved_by=actor,

                            # pending_receipt linked below after PendingReceipt is created

                        )

                        print(f"[CREATE-PENDING] batch {i+1}/{len(batches)}: reserved {batch_number} (suffix={next_suffix}, attempt={attempt+1})")

                        break

                except IntegrityError:

                    print(f"[CREATE-PENDING] batch {i+1}: suffix conflict on attempt {attempt+1}, retrying…")

                    continue



            if reservation is None:

                ids_to_cancel = [r[2].id for r in pre_reservations if r[2] is not None]

                if ids_to_cancel:

                    BatchNumberReservation.objects.filter(id__in=ids_to_cancel).update(

                        status=BatchNumberReservation.CANCELLED,

                        cancelled_at=datetime.datetime.now(tz=datetime.timezone.utc),

                    )

                return format_error_response(

                    f"Could not reserve a unique batch number for batch {i + 1} "

                    f"after {_MAX_BATCH_CONFLICT_RETRIES} attempts. Please retry.",

                    status.HTTP_409_CONFLICT,

                )



            pre_reservations.append((i, batch_number, reservation))



        # ── Create PendingReceipt + PendingReceiptBatch in one clean transaction.

        with transaction.atomic():

            pending = PendingReceipt.objects.create(

                production_order_doc_entry=int(doc_entry),

                production_order_doc_num=order_num,

                item_code=item_code,

                item_name=item_name,

                warehouse_code=warehouse_code,

                warehouse_name=warehouse_name,

                uom_entry=uom_entry,

                uom_label=uom_label,

                unit_count=unit_count,

                final_quantity=quantity,

                status=PendingReceipt.PENDING_REVIEW,

                created_by=actor,

                sap_order_number=order_num,

                raw_payload_json=data,

                sap_remaining_at_submit=sap_remaining,

                local_pending_quantity_at_submit=local_pending,

                available_quantity_at_submit=available_qty,

                requested_quantity=quantity,

                is_over_receipt=is_over,

                over_receipt_quantity=over_qty,

                over_receipt_warning=over_warn,

            )



            # Link pre-made reservations to the newly created PendingReceipt

            res_ids = [r[2].id for r in pre_reservations if r[2] is not None]

            if res_ids:

                BatchNumberReservation.objects.filter(id__in=res_ids).update(pending_receipt=pending)



            saved_batches = []

            for i, batch in enumerate(batches):

                _, batch_number, reservation = pre_reservations[i]

                PendingReceiptBatch.objects.create(

                    pending_receipt=pending,

                    batch_reservation=reservation,

                    batch_number=batch_number,

                    quantity=float(batch.get("quantity") or 0),

                    unit_count=int(batch.get("unitCount") or batch.get("unit_count") or 0),

                    uom_entry=uom_entry,

                    uom_label=uom_label,

                    bin_location=str(batch.get("binLocationCode") or batch.get("binLocation") or ""),

                    bin_abs_entry=str(batch.get("binAbsEntry") or ""),

                    admission_date=str(batch.get("admissionDate") or ""),

                    mfr_date=str(batch.get("mfrDate") or ""),

                    brand=str(batch.get("brand") or ""),

                    size=str(batch.get("size") or ""),

                    category=str(batch.get("category") or ""),

                    packing=str(batch.get("packing") or ""),

                    season=str(batch.get("season") or batch.get("U_Season") or batch.get("Season") or ""),

                    company=str(batch.get("company") or ""),

                    vendor=str(batch.get("vendor") or ""),

                    part=str(batch.get("part") or ""),

                    number=str(batch.get("number") or ""),

                    details=str(batch.get("details") or ""),

                    extra_specification=str(batch.get("extraSpecification") or ""),

                    raw_batch_json=batch,

                )

                saved_batches.append({"index": i, "batch_number": batch_number})



        log_action(
            request=request,
            user=request.user,
            action=ACTION_CREATE,
            module=MODULE_PRODUCTION_RECEIPT,
            entity_type="PendingReceipt",
            entity_id=str(pending.id),
            description=f"Created production receipt #{pending.id} for order {pending.production_order_doc_num}",
            details={
                "order_number": pending.production_order_doc_num,
                "item_code": pending.item_code,
                "warehouse_code": pending.warehouse_code,
                "final_quantity": float(pending.final_quantity or 0.0),
            },
        )
        return format_success_response(

            {

                "pending_receipt_id": pending.id,

                "is_over_receipt":    is_over,

                "over_receipt_warning": over_warn,

                "batches": saved_batches,

            },

            "Receipt submitted for review",

        )



    except Exception as e:

        import traceback

        print(f"[PENDING-RECEIPT] ERROR: {e}\n{traceback.format_exc()}")

        return format_error_response(str(e), status.HTTP_500_INTERNAL_SERVER_ERROR)





@api_view(["GET"])

def list_pending_receipts(request):

    """List pending receipts. Admins see all; regular users see only their own."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)



    include_batches = request.query_params.get("include_batches", "").lower() in ("1", "true", "yes")

    qs = PendingReceipt.objects.select_related("created_by", "reviewed_by")

    if include_batches:

        qs = qs.prefetch_related("batches")



    if not can_manage_production(request.user):
        qs = qs.filter(created_by=request.user)



    receipts = qs.all()

    return format_success_response({

        "receipts": [_pending_receipt_to_dict(r, include_batches=include_batches) for r in receipts],

        "count": receipts.count(),

    })





@api_view(["GET"])

def get_pending_receipt_detail(request, receipt_id):

    """Get a single pending receipt. Admins can access any; regular users only their own."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)



    try:

        r = (

            PendingReceipt.objects

            .prefetch_related("batches")

            .select_related("created_by", "reviewed_by")

            .get(id=receipt_id)

        )

    except PendingReceipt.DoesNotExist:

        return format_error_response("Pending receipt not found", status.HTTP_404_NOT_FOUND)



    if not can_manage_production(request.user) and r.created_by_id != request.user.id:

        return format_error_response("Pending receipt not found", status.HTTP_404_NOT_FOUND)



    return format_success_response({"receipt": _pending_receipt_to_dict(r, include_batches=True)})





@api_view(["POST"])
@audit_mutation(module=MODULE_PRODUCTION_RECEIPT, entity_type="PendingReceipt", action=ACTION_POST, log_success=False)
def approve_post_pending_receipt(request, receipt_id):

    """Approve and post a pending receipt to SAP. Admin only."""

    guard = _require_production_admin(request)

    if guard:

        return guard



    try:

        pending = (

            PendingReceipt.objects

            .prefetch_related("batches", "batch_reservations")

            .get(id=receipt_id)

        )

    except PendingReceipt.DoesNotExist:

        return format_error_response("Pending receipt not found", status.HTTP_404_NOT_FOUND)



    if pending.status == PendingReceipt.POSTED:

        return format_error_response("This receipt has already been posted to SAP.", status.HTTP_400_BAD_REQUEST)

    if pending.status == PendingReceipt.REJECTED:

        return format_error_response("This receipt has been rejected and cannot be posted.", status.HTTP_400_BAD_REQUEST)



    raw = pending.raw_payload_json or {}

    doc_entry  = pending.production_order_doc_entry

    order_num  = pending.production_order_doc_num

    warehouse  = pending.warehouse_code

    quantity   = pending.final_quantity

    posting_date = _today_iso()



    # ── Get production order from SAP ────────────────────────────────────────

    try:

        production_order = sap.get_production_order(int(doc_entry))

    except Exception as e:

        return format_error_response(f"Could not fetch production order from SAP: {e}", status.HTTP_502_BAD_GATEWAY)



    order_status = production_order.get("ProductionOrderStatus") or production_order.get("Status")

    if order_status in {"boposCancelled", "boposClosed"}:

        return format_error_response(

            f"Production order status does not allow new receipts ({order_status}).",

            status.HTTP_400_BAD_REQUEST,

        )



    item_code = production_order.get("ItemNo") or production_order.get("ItemCode") or ""

    costing_code  = raw.get("CostingCode") or raw.get("Location")

    costing_code2 = raw.get("CostingCode2") or raw.get("General")



    # ── Build base_document_line (always production-linked: BaseType=202) ────

    base_document_line = {

        "BaseType":        202,

        "BaseEntry":       int(doc_entry),

        "TransactionType": raw.get("TransactionType") or "botrntComplete",

    }

    if warehouse:

        base_document_line["WarehouseCode"] = warehouse

    if costing_code:

        base_document_line["CostingCode"] = costing_code

    if costing_code2:

        base_document_line["CostingCode2"] = costing_code2



    # ── Build document_lines from stored PendingReceiptBatch records ─────────

    stored_batches = list(

        pending.batches.all().order_by("id")

    )



    # Sync header totals from batches before validation (catches stale header data)

    if stored_batches:

        _sync_pending_receipt_totals(pending)

        pending.refresh_from_db()

        quantity = pending.final_quantity



    # Pre-validate (header now reflects batch totals — mismatch = real data corruption)

    total_batch_qty = sum(float(b.quantity) for b in stored_batches)

    if stored_batches and abs(total_batch_qty - quantity) > 0.0001:

        return format_error_response(

            f"Stored batch quantity ({total_batch_qty}) does not match receipt quantity ({quantity}).",

            status.HTTP_400_BAD_REQUEST,

        )



    comments_marker = raw.get("Comments") or (

        f"Receipt from Production Order {order_num} | APPROVED-{int(time.time())}"

    )



    # ── Retry loop (only for -2039 concurrency, not batch conflicts) ─────────

    last_error = None

    for attempt in range(_MAX_BATCH_CONFLICT_RETRIES):

        if attempt > 0:

            print(f"[APPROVE-POST] attempt {attempt + 1} — refreshing production order")

            try:

                sap.get_production_order(doc_entry)

            except Exception:

                pass



        document_lines = []

        assigned_batch_numbers = []



        for index, b in enumerate(stored_batches):

            batch_qty    = float(b.quantity)

            batch_number = b.batch_number



            batch_row = {"BatchNumber": batch_number, "Quantity": batch_qty}



            mfr_date  = _normalize_sap_date(b.mfr_date)

            adm_date  = _normalize_sap_date(b.admission_date)

            if mfr_date:

                batch_row["ManufacturingDate"] = mfr_date

            if adm_date:

                batch_row["AddmisionDate"] = adm_date



            # Standard payload (Details → Notes)

            if b.details:

                batch_row["Notes"] = b.details



            # UDF payload — same mapping as _build_batch_udf_payload

            udf_map = {

                "U_Size":          b.size,

                "U_Brand":         b.brand,

                "U_UOM":           b.uom_entry,

                "U_vendor":        b.vendor,

                "U_Part":          b.part,

                "U_Category":      b.category,

                "U_Packing":       b.packing,

                "U_Season":        b.season,

                "U_Specification": b.extra_specification,

                "U_Number":        b.number,

                "U_Company":       b.company,

            }

            for udf_key, udf_val in udf_map.items():

                cleaned = _clean_value(udf_val)

                if cleaned is not None:

                    batch_row[udf_key] = cleaned



            document_line = {**base_document_line, "Quantity": batch_qty, "BatchNumbers": [batch_row]}



            if b.bin_abs_entry not in (None, ""):

                document_line["DocumentLinesBinAllocations"] = [

                    {

                        "BinAbsEntry":                  int(b.bin_abs_entry),

                        "Quantity":                     float(batch_qty),

                        "AllowNegativeQuantity":        "tNO",

                        "SerialAndBatchNumbersBaseLine": 0,

                        "BaseLineNumber":               index,

                    }

                ]



            document_lines.append(document_line)

            assigned_batch_numbers.append(batch_number)



        sap_payload = {k: v for k, v in {

            "ProductionOrder": int(doc_entry),

            "Series":          raw.get("Series"),

            "DocumentDate":    posting_date,

            "PostingDate":     posting_date,

            "Warehouse":       warehouse,

            "Comments":        comments_marker,

            "Remarks":         raw.get("Remarks") or f"Receipt from Production Order {order_num}",

            "JournalRemarks":  "Receipt from Production",

            "DocumentLines":   document_lines,

            "BinAllocations":  [],

        }.items() if v is not None}



        print(f"[APPROVE-POST] attempt={attempt + 1}  batches={assigned_batch_numbers}")

        result = sap.create_receipt_from_production(sap_payload)



        if not result.get("error"):

            # ── Success ──────────────────────────────────────────────────────

            now = datetime.datetime.now(tz=datetime.timezone.utc)

            sap_doc_num = str(result.get("DocNum") or result.get("DocumentNumber") or "")

            with transaction.atomic():

                pending.status              = PendingReceipt.POSTED

                pending.reviewed_by         = request.user

                pending.reviewed_at         = now

                pending.posted_at           = now

                pending.sap_document_number = sap_doc_num

                pending.sap_error           = ""

                pending.save()



                BatchNumberReservation.objects.filter(

                    pending_receipt=pending,

                    status=BatchNumberReservation.PENDING_REVIEW,

                ).update(

                    status=BatchNumberReservation.POSTED,

                    posted_at=now,

                )



            result["AssignedBatchNumbers"] = assigned_batch_numbers

            log_action(
                request=request,
                user=request.user,
                action=ACTION_POST,
                module=MODULE_PRODUCTION_RECEIPT,
                entity_type="PendingReceipt",
                entity_id=str(pending.id),
                description=f"Posted production receipt #{pending.id} to SAP (#{sap_doc_num})",
                details={
                    "sap_receipt_doc_num": sap_doc_num,
                    "order_number": pending.production_order_doc_num,
                    "item_code": pending.item_code,
                    "warehouse_code": pending.warehouse_code,
                },
            )

            return format_success_response(result, "Receipt posted to SAP successfully.")



        error_text = result.get("error", "")

        is_concurrency = _is_concurrency_error(error_text)

        print(f"[APPROVE-POST] attempt={attempt + 1} error={error_text!r} concurrency={is_concurrency}")



        if is_concurrency:

            last_error = error_text

            continue



        # Non-retryable — mark as FAILED

        _mark_pending_failed(pending, request.user, error_text)

        return format_error_response(error_text, status.HTTP_400_BAD_REQUEST)



    # All retries exhausted

    _mark_pending_failed(pending, request.user, last_error or "Max retries reached")

    return format_error_response(

        f"Failed to post after {_MAX_BATCH_CONFLICT_RETRIES} attempts. Last error: {last_error}",

        status.HTTP_409_CONFLICT,

    )





@api_view(["PATCH"])
@audit_mutation(module=MODULE_PRODUCTION_RECEIPT, entity_type="PendingReceiptBatchBulk", action=ACTION_UPDATE)
def bulk_update_pending_receipt_batches(request):

    """Bulk-update attributes on multiple PendingReceiptBatch rows.

    Admins can update any non-POSTED batch; regular users only their own."""

    guard = _require_production_admin(request)

    if guard:

        return guard



    batch_ids = request.data.get("batch_ids", [])

    updates   = request.data.get("updates", {})



    if not batch_ids:

        return format_error_response("batch_ids is required.", status.HTTP_400_BAD_REQUEST)

    if not updates:

        return format_error_response("updates is required.", status.HTTP_400_BAD_REQUEST)



    invalid = set(updates.keys()) - _BATCH_EDITABLE_FIELDS

    if invalid:

        return format_error_response(

            f"Fields not allowed for bulk edit: {sorted(invalid)}",

            status.HTTP_400_BAD_REQUEST,

        )



    # Type-coerce integer and float fields

    clean = {}

    for field, value in updates.items():

        if field in _BATCH_INT_FIELDS:

            try:

                value = int(value) if value not in (None, "") else 0

            except (TypeError, ValueError):

                value = 0

        elif field in _BATCH_FLOAT_FIELDS:

            try:

                value = float(value) if value not in (None, "") else 0.0

            except (TypeError, ValueError):

                value = 0.0

        if field in (_BATCH_INT_FIELDS | _BATCH_FLOAT_FIELDS) and value < 0:

            return format_error_response(

                f"{field} cannot be negative.",

                status.HTTP_400_BAD_REQUEST,

            )

        clean[field] = value



    with transaction.atomic():

        affected_qs = PendingReceiptBatch.objects.filter(

            id__in=batch_ids,

            pending_receipt__status__in=[

                PendingReceipt.PENDING_REVIEW,

                PendingReceipt.FAILED,

                PendingReceipt.REJECTED,

            ],

        )



        affected_batch_ids = list(affected_qs.values_list("id", flat=True))

        affected_receipt_ids = set(

            affected_qs.values_list("pending_receipt_id", flat=True)

        )

        updated_count = affected_qs.update(**clean)



        # Sync receipt headers when any totals-affecting field was updated

        if updated_count > 0 and set(clean.keys()) & _BATCH_TOTALS_FIELDS:

            for rid in affected_receipt_ids:

                try:

                    _sync_pending_receipt_totals(PendingReceipt.objects.get(id=rid))

                except PendingReceipt.DoesNotExist:

                    pass

        if updated_count > 0:

            for batch in PendingReceiptBatch.objects.filter(id__in=affected_batch_ids).select_related("pending_receipt"):

                _sync_pending_transfers_for_receipt_batch(batch)



    return format_success_response(

        {"updated_count": updated_count},

        f"Updated {updated_count} batch(es).",

    )





@api_view(["POST"])
@audit_mutation(module=MODULE_PRODUCTION_RECEIPT, entity_type="PostedBatchExtraReceipt", action=ACTION_POST)
def post_extra_quantity(request, receipt_id):

    """Post extra units on an already-POSTED batch using the SAME batch number.

    No new batch reservation is created. Quantity = extra_unit_count × (original qty / original units)."""

    guard = _require_production_admin(request)

    if guard:

        return guard



    batch_id       = request.data.get("batch_id")

    raw_unit_count = request.data.get("extra_unit_count")



    if raw_unit_count is None:

        return format_error_response("extra_unit_count is required.", status.HTTP_400_BAD_REQUEST)

    try:

        extra_unit_count = float(raw_unit_count)

    except (TypeError, ValueError):

        return format_error_response("extra_unit_count must be a number.", status.HTTP_400_BAD_REQUEST)

    if extra_unit_count <= 0:

        return format_error_response("extra_unit_count must be greater than zero.", status.HTTP_400_BAD_REQUEST)



    try:

        pending = PendingReceipt.objects.prefetch_related("batches").get(id=receipt_id)

    except PendingReceipt.DoesNotExist:

        return format_error_response("Pending receipt not found.", status.HTTP_404_NOT_FOUND)

    if pending.status != PendingReceipt.POSTED:

        return format_error_response("Only POSTED receipts can have extra quantity added.", status.HTTP_400_BAD_REQUEST)



    # Select the specified batch or fall back to first

    if batch_id:

        try:

            b = pending.batches.get(id=int(batch_id))

        except PendingReceiptBatch.DoesNotExist:

            return format_error_response("Batch not found in this receipt.", status.HTTP_404_NOT_FOUND)

    else:

        b = pending.batches.order_by("id").first()

    if not b:

        return format_error_response("No batch data found for this receipt.", status.HTTP_400_BAD_REQUEST)



    # Compute extra quantity using UOM factor derived from the original batch

    # factor = original_quantity / original_unit_count  (e.g. 1250kg per Jumbo Bag)

    if b.unit_count and b.unit_count > 0:

        uom_factor = float(b.quantity) / float(b.unit_count)

    else:

        uom_factor = 1.0  # 1:1 fallback when unit_count is unknown

    extra_quantity = extra_unit_count * uom_factor



    print(f"[POST-EXTRA] batch={b.batch_number} units={extra_unit_count} "

          f"factor={uom_factor} qty={extra_quantity}")



    doc_entry    = pending.production_order_doc_entry

    order_num    = pending.production_order_doc_num

    warehouse    = pending.warehouse_code

    raw          = pending.raw_payload_json or {}

    posting_date = _today_iso()



    try:

        production_order = sap.get_production_order(int(doc_entry))

    except Exception as e:

        return format_error_response(f"Could not fetch production order: {e}", status.HTTP_502_BAD_GATEWAY)



    order_status = production_order.get("ProductionOrderStatus") or production_order.get("Status")

    if order_status in {"boposCancelled", "boposClosed"}:

        return format_error_response(

            f"Production order is {order_status} and cannot receive more receipts.",

            status.HTTP_400_BAD_REQUEST,

        )



    costing_code  = raw.get("CostingCode") or raw.get("Location")

    costing_code2 = raw.get("CostingCode2") or raw.get("General")



    # ── Use the EXISTING batch number — never create a new reservation ────────

    existing_batch_number = b.batch_number



    base_doc_line = {

        "BaseType": 202, "BaseEntry": int(doc_entry),

        "TransactionType": raw.get("TransactionType") or "botrntComplete",

    }

    if warehouse:     base_doc_line["WarehouseCode"] = warehouse

    if costing_code:  base_doc_line["CostingCode"]   = costing_code

    if costing_code2: base_doc_line["CostingCode2"]  = costing_code2



    batch_row = {"BatchNumber": existing_batch_number, "Quantity": extra_quantity}

    mfr_date = _normalize_sap_date(b.mfr_date)

    adm_date = _normalize_sap_date(b.admission_date)

    if mfr_date: batch_row["ManufacturingDate"] = mfr_date

    if adm_date: batch_row["AddmisionDate"]     = adm_date

    if b.details: batch_row["Notes"]            = b.details



    udf_map = {

        "U_Size": b.size, "U_Brand": b.brand, "U_UOM": b.uom_entry,

        "U_vendor": b.vendor, "U_Part": b.part, "U_Category": b.category,

        "U_Packing": b.packing, "U_Specification": b.extra_specification,

        "U_Season": b.season, "U_Number": b.number, "U_Company": b.company,

    }

    for udf_key, udf_val in udf_map.items():

        cleaned = _clean_value(udf_val)

        if cleaned is not None:

            batch_row[udf_key] = cleaned



    document_line = {**base_doc_line, "Quantity": extra_quantity, "BatchNumbers": [batch_row]}

    if b.bin_abs_entry not in (None, ""):

        document_line["DocumentLinesBinAllocations"] = [{

            "BinAbsEntry": int(b.bin_abs_entry), "Quantity": float(extra_quantity),

            "AllowNegativeQuantity": "tNO", "SerialAndBatchNumbersBaseLine": 0, "BaseLineNumber": 0,

        }]



    sap_payload = {k: v for k, v in {

        "ProductionOrder": int(doc_entry),

        "Series":          raw.get("Series"),

        "DocumentDate":    posting_date,

        "PostingDate":     posting_date,

        "Warehouse":       warehouse,

        "Comments":        f"Extra Receipt from Production Order {order_num} | EXTRA-{int(time.time())}",

        "Remarks":         f"Extra Receipt from Production Order {order_num}",

        "JournalRemarks":  "Receipt from Production",

        "DocumentLines":   [document_line],

        "BinAllocations":  [],

    }.items() if v is not None}



    last_error = None

    for attempt in range(_MAX_BATCH_CONFLICT_RETRIES):

        if attempt > 0:

            try:

                sap.get_production_order(doc_entry)

            except Exception:

                pass



        print(f"[POST-EXTRA] attempt={attempt + 1} batch={existing_batch_number} qty={extra_quantity}")

        result = sap.create_receipt_from_production(sap_payload)



        if not result.get("error"):

            sap_doc_num = str(result.get("DocNum") or result.get("DocumentNumber") or "")



            # Audit record

            PostedBatchExtraReceipt.objects.create(

                original_pending_receipt=pending,

                original_batch=b,

                batch_number=existing_batch_number,

                extra_unit_count=int(extra_unit_count),

                extra_quantity=extra_quantity,

                uom_entry=b.uom_entry,

                uom_label=b.uom_label,

                sap_document_number=sap_doc_num,

                created_by=request.user,

            )



            # Update batch totals to reflect the newly posted extra quantity

            b.unit_count = int(b.unit_count or 0) + int(extra_unit_count)

            b.quantity   = float(b.quantity or 0) + extra_quantity

            b.save(update_fields=["unit_count", "quantity"])



            # Sync receipt header from updated batch totals

            _sync_pending_receipt_totals(pending)

            pending.refresh_from_db()



            return format_success_response(

                {

                    "batch_number":         existing_batch_number,

                    "extra_unit_count":     int(extra_unit_count),

                    "extra_quantity":       extra_quantity,

                    "new_batch_unit_count": b.unit_count,

                    "new_batch_quantity":   b.quantity,

                    "sap_document_number":  sap_doc_num,

                },

                f"Extra {int(extra_unit_count)} units ({extra_quantity}) posted on batch {existing_batch_number}.",

            )



        error_text     = result.get("error", "")

        is_concurrency = _is_concurrency_error(error_text)

        print(f"[POST-EXTRA] attempt={attempt + 1} error={error_text!r} concurrency={is_concurrency}")



        if is_concurrency:

            last_error = error_text

            continue



        return format_error_response(error_text, status.HTTP_400_BAD_REQUEST)



    return format_error_response(

        f"Failed to post extra after {_MAX_BATCH_CONFLICT_RETRIES} attempts. Last error: {last_error}",

        status.HTTP_409_CONFLICT,

    )





@api_view(["POST"])
@audit_mutation(module=MODULE_PRODUCTION_RECEIPT, entity_type="PendingReceipt", action=ACTION_UPDATE)
def change_pending_receipt_order(request, receipt_id):

    """Change the production order for a Pending/Failed receipt.

    Admins can change any; regular users only their own Pending/Failed receipts."""

    guard = _require_production_admin(request)

    if guard:

        return guard



    new_doc_entry = request.data.get("new_doc_entry")

    if not new_doc_entry:

        return format_error_response("new_doc_entry is required.", status.HTTP_400_BAD_REQUEST)

    try:

        new_doc_entry = int(new_doc_entry)

    except (TypeError, ValueError):

        return format_error_response("new_doc_entry must be a number.", status.HTTP_400_BAD_REQUEST)



    try:

        pending = PendingReceipt.objects.prefetch_related("batches", "batch_reservations").get(id=receipt_id)

    except PendingReceipt.DoesNotExist:

        return format_error_response("Pending receipt not found.", status.HTTP_404_NOT_FOUND)



    if pending.status not in [PendingReceipt.PENDING_REVIEW, PendingReceipt.FAILED]:

        return format_error_response(

            "Only Pending or Failed receipts can have their order changed.",

            status.HTTP_400_BAD_REQUEST,

        )



    try:

        new_order = sap.get_production_order(new_doc_entry)

    except Exception as e:

        return format_error_response(f"Could not fetch production order: {e}", status.HTTP_502_BAD_GATEWAY)



    sap_order_num = (

        new_order.get("DocNum") or new_order.get("docNum") or

        new_order.get("OrderNum") or new_order.get("OrderNumber") or

        str(new_order.get("DocEntry") or "")

    )

    new_order_num = str(

        sap_order_num or request.data.get("new_production_order_doc_num") or ""

    ).strip()

    new_item_code = str(

        new_order.get("ItemNo") or new_order.get("ItemCode") or new_order.get("itemCode") or

        request.data.get("new_item_code") or ""

    )

    new_item_name = str(

        new_order.get("ItemDescription") or new_order.get("ItemName") or new_order.get("itemName") or

        request.data.get("new_item_name") or ""

    )



    if not new_order_num:

        return format_error_response(

            "Could not determine order number from SAP response. "

            "Pass new_production_order_doc_num in the request body as a fallback.",

            status.HTTP_502_BAD_GATEWAY,

        )



    old_batches = list(pending.batches.order_by("id"))

    previous_batch_numbers = {batch.id: batch.batch_number for batch in old_batches}



    # Compute the globally safe starting suffix (SAP OBTN + OData + local DB)

    sap_next_suffix = _get_true_next_batch_suffix(new_order_num, new_item_code)



    # Reserve a new batch number for each existing batch

    new_reservations = []

    for _i in range(len(old_batches)):

        reservation = None

        for attempt in range(_MAX_BATCH_CONFLICT_RETRIES):

            try:

                with transaction.atomic():

                    local_max     = _local_batch_max_suffix(new_order_num)

                    next_suffix   = max(sap_next_suffix, local_max + 1)

                    new_batch_num = f"{new_order_num}-{next_suffix}"

                    reservation = BatchNumberReservation.objects.create(

                        production_order_doc_entry=new_doc_entry,

                        production_order_doc_num=new_order_num,

                        item_code=new_item_code,

                        suffix=next_suffix,

                        batch_number=new_batch_num,

                        status=BatchNumberReservation.PENDING_REVIEW,

                        reserved_by=request.user,

                        pending_receipt=pending,

                    )

                    break

            except IntegrityError:

                sap_next_suffix += 1

                continue

        if reservation is None:

            BatchNumberReservation.objects.filter(id__in=[r.id for r in new_reservations]).delete()

            return format_error_response(

                "Failed to reserve batch numbers for the new order.",

                status.HTTP_409_CONFLICT,

            )

        new_reservations.append(reservation)



    now = datetime.datetime.now(tz=datetime.timezone.utc)

    with transaction.atomic():

        pending.batch_reservations.filter(

            status__in=[BatchNumberReservation.PENDING_REVIEW, BatchNumberReservation.FAILED],

        ).exclude(id__in=[r.id for r in new_reservations]).update(

            status=BatchNumberReservation.CANCELLED, cancelled_at=now,

        )

        for batch, new_res in zip(old_batches, new_reservations):

            batch.batch_number    = new_res.batch_number

            batch.batch_reservation = new_res

            batch.save(update_fields=["batch_number", "batch_reservation"])

        pending.production_order_doc_entry = new_doc_entry

        pending.production_order_doc_num   = new_order_num

        pending.item_code  = new_item_code

        pending.item_name  = new_item_name

        pending.status     = PendingReceipt.PENDING_REVIEW

        pending.sap_error  = ""

        pending.save()

        for batch in old_batches:

            _sync_pending_transfers_for_receipt_batch(

                batch,

                previous_batch_number=previous_batch_numbers.get(batch.id),

            )



    return format_success_response(

        {

            "new_order_number":  new_order_num,

            "new_item_code":     new_item_code,

            "new_batch_numbers": [r.batch_number for r in new_reservations],

        },

        "Production order changed successfully.",

    )





def _mark_pending_failed(pending, reviewer, error_text):

    now = datetime.datetime.now(tz=datetime.timezone.utc)

    with transaction.atomic():

        pending.status      = PendingReceipt.FAILED

        pending.reviewed_by = reviewer

        pending.reviewed_at = now

        pending.sap_error   = str(error_text)

        pending.save()

        BatchNumberReservation.objects.filter(

            pending_receipt=pending,

            status=BatchNumberReservation.PENDING_REVIEW,

        ).update(status=BatchNumberReservation.FAILED)





@api_view(["POST"])
@audit_mutation(module=MODULE_PRODUCTION_RECEIPT, entity_type="PendingReceipt", action=ACTION_REJECT, log_success=False)
def reject_pending_receipt(request, receipt_id):

    """Reject a pending receipt and cancel its batch number reservations. Admin only."""

    guard = _require_production_admin(request)

    if guard:

        return guard



    try:

        pending = PendingReceipt.objects.get(id=receipt_id)

    except PendingReceipt.DoesNotExist:

        return format_error_response("Pending receipt not found", status.HTTP_404_NOT_FOUND)



    if pending.status == PendingReceipt.POSTED:

        return format_error_response("Cannot reject a receipt that has already been posted.", status.HTTP_400_BAD_REQUEST)



    reason = str(request.data.get("reason") or "").strip()

    now = datetime.datetime.now(tz=datetime.timezone.utc)



    with transaction.atomic():

        pending.status           = PendingReceipt.REJECTED

        pending.reviewed_by      = request.user

        pending.reviewed_at      = now

        pending.rejection_reason = reason

        pending.save()



        BatchNumberReservation.objects.filter(

            pending_receipt=pending,

            status__in=[BatchNumberReservation.RESERVED, BatchNumberReservation.PENDING_REVIEW],

        ).update(

            status=BatchNumberReservation.CANCELLED,

            cancelled_at=now,

        )



    log_action(
        request=request,
        user=request.user,
        action=ACTION_REJECT,
        module=MODULE_PRODUCTION_RECEIPT,
        entity_type="PendingReceipt",
        entity_id=str(pending.id),
        description=f"Rejected production receipt #{pending.id}",
        details={"order_number": pending.production_order_doc_num, "item_code": pending.item_code, "reason": reason},
    )

    return format_success_response(

        {"id": pending.id, "status": pending.status},

        "Receipt rejected.",

    )





_BATCH_EDITABLE_FIELDS = {

    "brand", "size", "category", "packing", "season", "company", "vendor",

    "part", "number", "details", "extra_specification",

    "bin_location", "bin_abs_entry",

    "admission_date", "mfr_date",

    "uom_entry", "uom_label",

    "unit_count", "quantity",

}

_BATCH_INT_FIELDS   = {"unit_count"}

_BATCH_FLOAT_FIELDS = {"quantity"}



# Fields whose change should trigger a receipt-header sync

_BATCH_TOTALS_FIELDS = {"unit_count", "quantity", "uom_entry", "uom_label"}





def _sync_pending_receipt_totals(receipt):

    """Re-aggregate batch totals onto the receipt header.

    Batches are the source of truth — the header is derived."""

    batches = list(receipt.batches.all())

    total_qty   = sum(float(b.quantity   or 0) for b in batches)

    total_units = sum(int(b.unit_count   or 0) for b in batches)



    receipt.final_quantity = total_qty

    receipt.unit_count     = total_units



    if len(batches) == 1:

        receipt.uom_entry = batches[0].uom_entry or receipt.uom_entry

        receipt.uom_label = batches[0].uom_label or receipt.uom_label



    receipt.save(update_fields=["final_quantity", "unit_count", "uom_entry", "uom_label", "updated_at"])





def _same_database_id(value, expected):

    try:

        return int(value) == int(expected)

    except (TypeError, ValueError):

        return False





def _transfer_line_matches_receipt_batch(

    line,

    transfer,

    batch,

    previous_batch_number=None,

    payload=None,

):

    receipt = batch.pending_receipt

    line = line or {}

    payload = payload or {}



    if _same_database_id(line.get("pending_receipt_batch_id"), batch.id):

        return True



    line_receipt_id = line.get("pending_receipt_id")

    if line_receipt_id and not _same_database_id(line_receipt_id, receipt.id):

        return False



    candidate_batch_numbers = {

        _normalize_transfer_batch_number(batch.batch_number),

    }

    if previous_batch_number:

        candidate_batch_numbers.add(_normalize_transfer_batch_number(previous_batch_number))

    line_batch_number = _normalize_transfer_batch_number(

        line.get("batch_number") or line.get("batchNumber")

    )

    if not line_batch_number or line_batch_number not in candidate_batch_numbers:

        return False



    source_type = str(line.get("source_type") or "").strip().lower()

    availability_status = str(line.get("availability_status") or "").strip()

    if source_type == "sap" or availability_status == TRANSFER_SOURCE_SAP_AVAILABLE:

        return False

    if line.get("can_post_to_sap") is True:

        return False



    if line_receipt_id and _same_database_id(line_receipt_id, receipt.id):

        return True

    if source_type == "local_receipt" or availability_status in {

        TRANSFER_SOURCE_LOCAL_PENDING,

        TRANSFER_SOURCE_LOCAL_POSTED,

    }:

        return True



    line_item = str(

        line.get("item_code")

        or line.get("itemCode")

        or transfer.item_code

        or ""

    ).strip()

    receipt_item = str(receipt.item_code or "").strip()

    if receipt_item and line_item and line_item != receipt_item:

        return False



    line_warehouse = str(

        line.get("from_warehouse")

        or line.get("fromWarehouse")

        or payload.get("from_warehouse")

        or payload.get("fromWarehouse")

        or transfer.from_warehouse

        or ""

    ).strip()

    receipt_warehouse = str(receipt.warehouse_code or "").strip()

    if receipt_warehouse and line_warehouse and line_warehouse.lower() != receipt_warehouse.lower():

        return False



    return bool(line_item and line_warehouse)





def _sync_transfer_line_from_receipt_batch(line, batch):

    receipt = batch.pending_receipt

    source = _local_receipt_batch_to_transfer_batch(batch)

    line_copy = dict(line or {})

    item_code = source.get("item_code") or ""

    item_name = source.get("item_name") or ""

    batch_number = source.get("batch_number") or ""

    quantity = float(batch.quantity or 0)

    uom_label = batch.uom_label or receipt.uom_label or ""

    uom_entry = batch.uom_entry or receipt.uom_entry or ""



    line_copy.update({

        "item_code": item_code,

        "item_name": item_name,

        "batch_number": batch_number,

        "quantity": quantity,

        "uom": uom_label,

        "uom_entry": uom_entry,

        "brand": batch.brand or "",

        "size": batch.size or "",

        "from_warehouse": source.get("from_warehouse") or "",

        "from_bin": source.get("from_bin") or "",

        "available_quantity": source.get("available_quantity"),

        "source_type": source.get("source_type"),

        "availability_status": source.get("availability_status"),

        "source_status_label": source.get("source_status_label"),

        "source_message": source.get("source_message"),

        "can_post_to_sap": bool(source.get("can_post_to_sap")),

        "receipt_status": source.get("receipt_status") or "",

        "pending_receipt_id": receipt.id,

        "pending_receipt_batch_id": batch.id,

    })

    if "itemCode" in line_copy:

        line_copy["itemCode"] = item_code

    if "itemName" in line_copy:

        line_copy["itemName"] = item_name

    if "batchNumber" in line_copy:

        line_copy["batchNumber"] = batch_number

    return line_copy





def _sync_transfer_lines_for_receipt_batch(

    lines,

    transfer,

    batch,

    previous_batch_number=None,

    payload=None,

):

    changed = False

    synced_lines = []

    for line in lines or []:

        line_copy = dict(line or {})

        if _transfer_line_matches_receipt_batch(

            line_copy,

            transfer,

            batch,

            previous_batch_number=previous_batch_number,

            payload=payload,

        ):

            synced_lines.append(_sync_transfer_line_from_receipt_batch(line_copy, batch))

            changed = True

        else:

            synced_lines.append(line_copy)

    return synced_lines, changed





def _sync_pending_transfers_for_receipt_batch(batch, previous_batch_number=None):

    """Keep pending transfer snapshots aligned with edited local receipt batches."""

    try:

        fresh_batch = PendingReceiptBatch.objects.select_related("pending_receipt").get(id=batch.id)

    except PendingReceiptBatch.DoesNotExist:

        return 0



    receipt = fresh_batch.pending_receipt

    if receipt.status == PendingReceipt.REJECTED:

        return 0



    updated_count = 0

    for transfer in PendingTransferRequest.objects.filter(status=PendingTransferRequest.PENDING):

        changed = False



        synced_lines, lines_changed = _sync_transfer_lines_for_receipt_batch(

            transfer.lines or [],

            transfer,

            fresh_batch,

            previous_batch_number=previous_batch_number,

            payload=transfer.raw_payload_json or {},

        )

        if lines_changed:

            transfer.lines = synced_lines

            changed = True



        raw_payload = transfer.raw_payload_json or {}

        if isinstance(raw_payload, dict):

            payload_copy = _transfer_payload_for_storage(raw_payload)

            payload_lines, payload_lines_changed = _sync_transfer_lines_for_receipt_batch(

                payload_copy.get("lines") or [],

                transfer,

                fresh_batch,

                previous_batch_number=previous_batch_number,

                payload=payload_copy,

            )

            if payload_lines_changed:

                payload_copy["lines"] = payload_lines

                payload_copy["from_warehouse"] = receipt.warehouse_code or payload_copy.get("from_warehouse") or ""

                if payload_copy.get("from_bin") or transfer.from_bin:

                    payload_copy["from_bin"] = fresh_batch.bin_location or ""

                transfer.raw_payload_json = payload_copy

                changed = True



        if not changed:

            continue



        summary = _pending_transfer_line_summary(transfer.lines or [])

        transfer.item_code = summary["item_code"]

        transfer.item_name = summary["item_name"]

        transfer.batch_number = summary["batch_number"]

        transfer.quantity = summary["quantity"]

        transfer.from_warehouse = receipt.warehouse_code or transfer.from_warehouse

        if transfer.from_bin:

            transfer.from_bin = fresh_batch.bin_location or ""

        transfer.save(update_fields=[

            "item_code",

            "item_name",

            "batch_number",

            "quantity",

            "from_warehouse",

            "from_bin",

            "lines",

            "raw_payload_json",

            "updated_at",

        ])

        updated_count += 1



    print(f"[TRANSFER-SYNC] receipt_batch={fresh_batch.id} pending_transfers_updated={updated_count}")

    return updated_count





@api_view(["PATCH"])
@audit_mutation(module=MODULE_PRODUCTION_RECEIPT, entity_type="PendingReceiptBatch", action=ACTION_UPDATE)
def update_pending_receipt_batch(request, receipt_id, batch_id):

    """Edit a single batch row. Admins can edit any non-POSTED batch;

    regular users can edit only their own Pending/Failed batches."""

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)



    try:

        pending = PendingReceipt.objects.get(id=receipt_id)

    except PendingReceipt.DoesNotExist:

        return format_error_response("Pending receipt not found", status.HTTP_404_NOT_FOUND)



    if not can_manage_production(request.user) and pending.created_by_id != request.user.id:

        return format_error_response("Pending receipt not found", status.HTTP_404_NOT_FOUND)



    if pending.status == PendingReceipt.POSTED:

        return format_error_response("Cannot edit a receipt that has already been posted.", status.HTTP_400_BAD_REQUEST)



    try:

        batch = PendingReceiptBatch.objects.get(id=batch_id, pending_receipt=pending)

    except PendingReceiptBatch.DoesNotExist:

        return format_error_response("Batch not found", status.HTTP_404_NOT_FOUND)



    previous_batch_number = batch.batch_number

    updated = []

    for field, value in request.data.items():

        if field in _BATCH_EDITABLE_FIELDS:

            if field in _BATCH_INT_FIELDS:

                try:

                    value = int(value) if value not in (None, "") else 0

                except (TypeError, ValueError):

                    value = 0

            elif field in _BATCH_FLOAT_FIELDS:

                try:

                    value = float(value) if value not in (None, "") else 0.0

                except (TypeError, ValueError):

                    value = 0.0

            if field in (_BATCH_INT_FIELDS | _BATCH_FLOAT_FIELDS) and value < 0:

                return format_error_response(

                    f"{field} cannot be negative.",

                    status.HTTP_400_BAD_REQUEST,

                )

            setattr(batch, field, value)

            updated.append(field)



    if updated:

        with transaction.atomic():

            batch.save(update_fields=updated)

            # Keep receipt header in sync if any totals-affecting field changed

            if set(updated) & _BATCH_TOTALS_FIELDS:

                _sync_pending_receipt_totals(pending)

            _sync_pending_transfers_for_receipt_batch(

                batch,

                previous_batch_number=previous_batch_number,

            )



    return format_success_response({

        "id": batch.id,

        "batch_number":  batch.batch_number,

        "quantity":      batch.quantity,

        "unit_count":    batch.unit_count,

        "uom_entry":     batch.uom_entry,

        "uom_label":     batch.uom_label,

        "receipt_final_quantity": pending.final_quantity,

        "receipt_unit_count":     pending.unit_count,

        "bin_location":  batch.bin_location,

        "bin_abs_entry": batch.bin_abs_entry,

        "admission_date": batch.admission_date,

        "mfr_date":      batch.mfr_date,

        "brand":    batch.brand,

        "size":     batch.size,

        "category": batch.category,

        "packing":  batch.packing,

        "season":   batch.season,

        "company":  batch.company,

        "vendor":   batch.vendor,

        "part":     batch.part,

        "number":   batch.number,

        "details":  batch.details,

        "extra_specification": batch.extra_specification,

        "reservation_id": batch.batch_reservation_id,

        "updated_fields": updated,

    }, "Batch updated.")





@api_view(["DELETE"])
@audit_mutation(module=MODULE_PRODUCTION_RECEIPT, entity_type="PendingReceiptBatch")
def delete_pending_receipt_batch(request, receipt_id, batch_id):

    """Delete a single PendingReceiptBatch row.

    - Admin: any PENDING_REVIEW or FAILED batch.

    - Normal user: only batches within their own receipt, same statuses.

    - POSTED batches cannot be deleted.

    - If this was the last batch in the receipt the receipt is also deleted.

    """

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)



    try:

        pending = PendingReceipt.objects.get(id=receipt_id)

    except PendingReceipt.DoesNotExist:

        return format_error_response("Pending receipt not found", status.HTTP_404_NOT_FOUND)



    if not can_manage_production(request.user) and pending.created_by_id != request.user.id:

        return format_error_response("Pending receipt not found", status.HTTP_404_NOT_FOUND)



    if pending.status == PendingReceipt.POSTED:

        return format_error_response("Cannot delete batches from a posted receipt.", status.HTTP_400_BAD_REQUEST)



    try:

        batch = PendingReceiptBatch.objects.get(id=batch_id, pending_receipt=pending)

    except PendingReceiptBatch.DoesNotExist:

        return format_error_response("Batch not found", status.HTTP_404_NOT_FOUND)



    with transaction.atomic():

        # Cancel the batch number reservation so the number can be reused

        if batch.batch_reservation_id:

            BatchNumberReservation.objects.filter(

                id=batch.batch_reservation_id,

                status__in=[BatchNumberReservation.RESERVED, BatchNumberReservation.PENDING_REVIEW],

            ).update(

                status=BatchNumberReservation.CANCELLED,

                cancelled_at=datetime.datetime.now(tz=datetime.timezone.utc),

            )



        batch.delete()



        remaining = pending.batches.count()

        if remaining == 0:

            pending.delete()

            return format_success_response(

                {"deleted_batch_id": batch_id, "receipt_deleted": True},

                "Batch deleted. Receipt had no remaining batches and was also removed.",

            )



        _sync_pending_receipt_totals(pending)



    return format_success_response(

        {"deleted_batch_id": batch_id, "receipt_deleted": False},

        "Batch deleted.",

    )





@api_view(["POST"])
@audit_mutation(module=MODULE_PRODUCTION_RECEIPT, entity_type="PendingReceiptBatch", action=ACTION_CREATE)
def duplicate_pending_receipt_batch(request, receipt_id, batch_id):

    """Duplicate a single PendingReceiptBatch as a brand-new standalone PendingReceipt.



    Each duplicate gets its own receipt so that Post / Delete / selection act

    on exactly one batch — there is no shared receipt that would affect sibling

    duplicates.

    """

    if not request.user.is_authenticated:

        return Response({"success": False, "error": "Authentication required"}, status=401)



    try:

        pending = PendingReceipt.objects.get(id=receipt_id)

    except PendingReceipt.DoesNotExist:

        return format_error_response("Pending receipt not found", status.HTTP_404_NOT_FOUND)



    if not can_manage_production(request.user) and pending.created_by_id != request.user.id:

        return format_error_response("Pending receipt not found", status.HTTP_404_NOT_FOUND)



    if pending.status == PendingReceipt.POSTED:

        return format_error_response("Cannot duplicate batches from a posted receipt.", status.HTTP_400_BAD_REQUEST)



    try:

        source = PendingReceiptBatch.objects.get(id=batch_id, pending_receipt=pending)

    except PendingReceiptBatch.DoesNotExist:

        return format_error_response("Batch not found", status.HTTP_404_NOT_FOUND)



    order_num = str(pending.production_order_doc_num or "").strip()

    item_code = str(pending.item_code or "").strip()



    # ── Reserve new batch number (same retry pattern as create_pending_receipt)

    sap_next_suffix = _get_true_next_batch_suffix(order_num, item_code)

    reservation = None

    for attempt in range(_MAX_BATCH_CONFLICT_RETRIES):

        try:

            with transaction.atomic():

                local_max     = _local_batch_max_suffix(order_num)

                next_suffix   = max(sap_next_suffix, local_max + 1)

                new_batch_num = f"{order_num}-{next_suffix}"

                reservation   = BatchNumberReservation.objects.create(

                    production_order_doc_entry=pending.production_order_doc_entry,

                    production_order_doc_num=order_num,

                    item_code=item_code,

                    suffix=next_suffix,

                    batch_number=new_batch_num,

                    status=BatchNumberReservation.PENDING_REVIEW,

                    reserved_by=request.user,

                    # pending_receipt linked below after new receipt is created

                )

                break

        except IntegrityError:

            sap_next_suffix += 1

            continue



    if reservation is None:

        return format_error_response(

            "Failed to reserve a new batch number after several attempts.",

            status.HTTP_409_CONFLICT,

        )



    # ── Create a new independent PendingReceipt + one batch

    with transaction.atomic():

        new_receipt = PendingReceipt.objects.create(

            production_order_doc_entry=pending.production_order_doc_entry,

            production_order_doc_num=pending.production_order_doc_num,

            item_code=pending.item_code,

            item_name=pending.item_name,

            warehouse_code=pending.warehouse_code,

            warehouse_name=pending.warehouse_name,

            uom_entry=source.uom_entry or pending.uom_entry,

            uom_label=source.uom_label or pending.uom_label,

            unit_count=source.unit_count,

            final_quantity=source.quantity,

            status=PendingReceipt.PENDING_REVIEW,

            created_by=request.user,

            sap_order_number=pending.sap_order_number,

        )



        BatchNumberReservation.objects.filter(id=reservation.id).update(

            pending_receipt=new_receipt

        )



        PendingReceiptBatch.objects.create(

            pending_receipt=new_receipt,

            batch_reservation=reservation,

            batch_number=new_batch_num,

            quantity=source.quantity,

            unit_count=source.unit_count,

            uom_entry=source.uom_entry,

            uom_label=source.uom_label,

            bin_location=source.bin_location,

            bin_abs_entry=source.bin_abs_entry,

            admission_date=source.admission_date,

            mfr_date=source.mfr_date,

            brand=source.brand,

            size=source.size,

            category=source.category,

            packing=source.packing,

            season=source.season,

            company=source.company,

            vendor=source.vendor,

            part=source.part,

            number=source.number,

            details=source.details,

            extra_specification=source.extra_specification,

            raw_batch_json=source.raw_batch_json,

        )



    return format_success_response(

        _pending_receipt_to_dict(new_receipt, include_batches=True),

        "Batch duplicated as new receipt.",

    )

