"""
Audit Log API Views.

Protected read-only views for querying the persistent activity history / audit log.
Restricted to users authorized to manage users (Super Admin, Production Admin, Transfer Admin).
"""
import datetime
from django.core.paginator import Paginator, EmptyPage
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from api.models import AuditLog
from api.views import _require_user_management


def _audit_log_to_dict(log: AuditLog) -> dict:
    """Format AuditLog instance for API response."""
    return {
        "id": log.id,
        "user_id": log.user_id,
        "username": log.username or (log.user.username if log.user else "System"),
        "action": log.action,
        "module": log.module,
        "entity_type": log.entity_type,
        "entity_id": log.entity_id,
        "description": log.description,
        "status": log.status,
        "details": log.details or {},
        "ip_address": log.ip_address or "",
        "created_at": log.created_at.isoformat() if log.created_at else None,
        "timestamp_display": log.created_at.strftime("%Y-%m-%d %H:%M:%S") if log.created_at else "",
    }


@api_view(["GET"])
def list_audit_logs(request):
    """
    GET /api/audit-log/
    Protected read-only list endpoint with search, filters, and pagination.
    """
    guard = _require_user_management(request)
    if guard:
        return guard

    qs = AuditLog.objects.all().select_related("user").order_by("-created_at")

    # 1. Search query (description, username, entity_id, entity_type, action, module)
    q = request.query_params.get("search") or request.query_params.get("q")
    if q:
        q = q.strip()
        qs = qs.filter(
            Q(description__icontains=q)
            | Q(username__icontains=q)
            | Q(entity_id__icontains=q)
            | Q(entity_type__icontains=q)
            | Q(action__icontains=q)
            | Q(module__icontains=q)
        )

    # 2. Module filter
    module = request.query_params.get("module")
    if module and module.upper() != "ALL":
        qs = qs.filter(module=module.upper())

    # 3. Action filter
    action = request.query_params.get("action")
    if action and action.upper() != "ALL":
        qs = qs.filter(action=action.upper())

    # 4. Status filter
    status_filter = request.query_params.get("status")
    if status_filter and status_filter.upper() != "ALL":
        qs = qs.filter(status=status_filter.upper())

    # 5. User filter (by username or user ID)
    user_param = request.query_params.get("user") or request.query_params.get("username")
    if user_param and user_param.upper() != "ALL":
        user_param = user_param.strip()
        if user_param.isdigit():
            qs = qs.filter(Q(user_id=int(user_param)) | Q(username__iexact=user_param))
        else:
            qs = qs.filter(username__iexact=user_param)

    # 6. Entity Type / ID filter
    entity_type = request.query_params.get("entity_type")
    if entity_type:
        qs = qs.filter(entity_type__iexact=entity_type.strip())

    entity_id = request.query_params.get("entity_id")
    if entity_id:
        qs = qs.filter(entity_id__icontains=entity_id.strip())

    # 7. Date range filter
    date_from = request.query_params.get("date_from") or request.query_params.get("from_date")
    if date_from:
        try:
            # Accepts YYYY-MM-DD
            dt_from = timezone.make_aware(
                datetime.datetime.strptime(date_from.strip(), "%Y-%m-%d"),
                timezone.get_current_timezone(),
            )
            # Set to beginning of the day in current timezone
            qs = qs.filter(created_at__gte=dt_from)
        except ValueError:
            pass

    date_to = request.query_params.get("date_to") or request.query_params.get("to_date")
    if date_to:
        try:
            # Accepts YYYY-MM-DD
            dt_to = timezone.make_aware(
                datetime.datetime.strptime(date_to.strip(), "%Y-%m-%d"),
                timezone.get_current_timezone(),
            )
            # Inclusive of the entire day: +23h 59m 59s
            dt_to_end = dt_to + datetime.timedelta(days=1, microseconds=-1)
            qs = qs.filter(created_at__lte=dt_to_end)
        except ValueError:
            pass

    # 8. Pagination
    try:
        page_size = int(request.query_params.get("page_size", 25))
    except (ValueError, TypeError):
        page_size = 25
    page_size = max(1, min(page_size, 100))

    paginator = Paginator(qs, page_size)
    try:
        page_num = int(request.query_params.get("page", 1))
    except (ValueError, TypeError):
        page_num = 1

    try:
        page_obj = paginator.page(page_num)
    except EmptyPage:
        page_obj = []

    results = [_audit_log_to_dict(log) for log in page_obj]

    # Available modules & actions for filter dropdowns
    available_modules = list(
        AuditLog.objects.order_by("module").values_list("module", flat=True).distinct()
    )
    available_actions = list(
        AuditLog.objects.order_by("action").values_list("action", flat=True).distinct()
    )

    return Response({
        "success": True,
        "data": {
            "results": results,
            "count": paginator.count,
            "page": page_num,
            "total_pages": paginator.num_pages,
            "page_size": page_size,
            "available_modules": available_modules,
            "available_actions": available_actions,
        }
    })


@api_view(["GET"])
def get_audit_log_detail(request, log_id):
    """
    GET /api/audit-log/<log_id>/
    Protected read-only detail endpoint.
    """
    guard = _require_user_management(request)
    if guard:
        return guard

    try:
        log = AuditLog.objects.select_related("user").get(pk=log_id)
    except AuditLog.DoesNotExist:
        return Response({"success": False, "error": "Audit log entry not found"}, status=status.HTTP_404_NOT_FOUND)

    return Response({
        "success": True,
        "data": _audit_log_to_dict(log),
    })
