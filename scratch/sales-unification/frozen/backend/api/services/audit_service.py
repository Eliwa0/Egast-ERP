"""
Central Audit Logging Service.

Provides a fail-safe, standardized API for recording meaningful state-changing
operations across all modules in the application (Auth, Users, Transfer, Cold Storage,
Quality, GRPO, Purchase Quotation, Scale, Production Receipts, and Rules).
"""
import logging
import ipaddress
from functools import wraps
from typing import Any, Dict, Iterable, Optional, Union
from django.contrib.auth.models import User
from django.http import HttpRequest
from django.db import transaction

from api.models import AuditLog

logger = logging.getLogger(__name__)

# Modules
MODULE_AUTH = "AUTH"
MODULE_USERS = "USERS"
MODULE_TRANSFER = "TRANSFER"
MODULE_COLD_STORAGE = "COLD_STORAGE"
MODULE_QUALITY = "QUALITY"
MODULE_GRPO = "GRPO"
MODULE_PURCHASE_QUOTATION = "PURCHASE_QUOTATION"
MODULE_SCALE = "SCALE"
MODULE_PRODUCTION_RECEIPT = "PRODUCTION_RECEIPT"
MODULE_PRODUCTION_ISSUE = "PRODUCTION_ISSUE"
MODULE_RULES = "RULES"
MODULE_CUSTOMIZATION = "CUSTOMIZATION"
MODULE_DELIVERY = "DELIVERY"


# Actions
ACTION_LOGIN = "LOGIN"
ACTION_LOGOUT = "LOGOUT"
ACTION_CREATE = "CREATE"
ACTION_UPDATE = "UPDATE"
ACTION_DELETE = "DELETE"
ACTION_POST = "POST"
ACTION_APPROVE = "APPROVE"
ACTION_REJECT = "REJECT"
ACTION_CANCEL = "CANCEL"
ACTION_RESERVE = "RESERVE"
ACTION_RELEASE = "RELEASE"
ACTION_OCCUPY = "OCCUPY"
ACTION_VACATE = "VACATE"
ACTION_CONFIGURE = "CONFIGURE"
ACTION_RECONCILE = "RECONCILE"
ACTION_WEIGH = "WEIGH"

HTTP_ACTIONS = {
    "POST": ACTION_CREATE,
    "PUT": ACTION_UPDATE,
    "PATCH": ACTION_UPDATE,
    "DELETE": ACTION_DELETE,
}

# Sensitive keys to redact
SENSITIVE_SUBSTRINGS = (
    "password",
    "token",
    "secret",
    "cookie",
    "session",
    "authorization",
    "csrftoken",
    "csrfmiddlewaretoken",
    "credit_card",
    "credential",
)


def _sanitize_value(key: str, val: Any) -> Any:
    """Recursively scrub values for sensitive keys."""
    key_lower = str(key).lower()
    if any(sub in key_lower for sub in SENSITIVE_SUBSTRINGS):
        return "[REDACTED]"

    if isinstance(val, dict):
        return {k: _sanitize_value(k, v) for k, v in val.items()}
    if isinstance(val, (list, tuple, set)):
        # Use an empty key here so a non-sensitive parent key does not prevent
        # sensitive keys deeper in arbitrarily nested lists from being found.
        return [_sanitize_value("", item) for item in val]
    return val


def sanitize_details(details: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Sanitize dictionary metadata before storing in AuditLog.details."""
    if not isinstance(details, dict):
        return {}
    sanitized = {}
    for k, v in details.items():
        sanitized[k] = _sanitize_value(k, v)
    return sanitized


def get_client_ip(request: Optional[HttpRequest]) -> Optional[str]:
    """Safely extract client IP from HTTP headers."""
    if not request:
        return None
    x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    candidate = (
        x_forwarded_for.split(",")[0].strip()
        if x_forwarded_for
        else str(request.META.get("REMOTE_ADDR") or "").strip()
    )
    if not candidate:
        return None
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        logger.warning("Ignoring invalid audit client IP value")
        return None


def log_action(
    request: Optional[HttpRequest] = None,
    user: Optional[Union[User, Any]] = None,
    action: str = "",
    module: str = "",
    entity_type: str = "",
    entity_id: Union[str, int] = "",
    description: str = "",
    status: str = AuditLog.STATUS_SUCCESS,
    details: Optional[Dict[str, Any]] = None,
    ip_address: Optional[str] = None,
) -> Optional[AuditLog]:
    """
    Record an audit log entry.
    Fails safely: Any exception during audit writing is logged server-side
    and does NOT disrupt the caller's business transaction.
    """
    try:
        actor_user = user
        if actor_user is None and request and hasattr(request, "user") and request.user.is_authenticated:
            actor_user = request.user

        # Username snapshot
        if actor_user and hasattr(actor_user, "username") and actor_user.username:
            username_snapshot = actor_user.username
        elif isinstance(details, dict) and details.get("username"):
            username_snapshot = str(details.get("username"))
        else:
            username_snapshot = ""

        # IP Address
        client_ip = ip_address or get_client_ip(request)

        # Sanitize details
        clean_details = sanitize_details(details)

        # Ensure entity_id is string
        entity_id_str = str(entity_id or "") if entity_id is not None else ""

        # Normalize status
        log_status = status if status in {AuditLog.STATUS_SUCCESS, AuditLog.STATUS_FAILED, AuditLog.STATUS_WARNING} else AuditLog.STATUS_SUCCESS

        audit_entry = AuditLog.objects.create(
            user=actor_user if (actor_user and hasattr(actor_user, "pk") and actor_user.pk) else None,
            username=username_snapshot,
            action=str(action or "").upper(),
            module=str(module or "").upper(),
            entity_type=str(entity_type or ""),
            entity_id=entity_id_str,
            description=str(description or ""),
            status=log_status,
            details=clean_details,
            ip_address=client_ip,
        )
        return audit_entry

    except Exception as exc:
        # Fail safe: log exception but NEVER raise
        logger.exception("Failed to write audit log entry: %s", exc)
        return None


def log_action_on_commit(**event: Any) -> None:
    """Write a success event only after the surrounding transaction commits.

    Use this when the audited state change is performed inside ``atomic()``.
    A rollback therefore cannot leave behind a misleading success record.
    Failure events should be emitted with :func:`log_action` after the failed
    transaction has exited.
    """
    try:
        transaction.on_commit(lambda: log_action(**event))
    except Exception as exc:
        # Registration must be just as failure-safe as the eventual write.
        logger.exception("Failed to schedule audit log entry: %s", exc)


def audit_mutation(
    *,
    module: str,
    entity_type: str,
    action: Optional[str] = None,
    methods: Iterable[str] = ("POST", "PUT", "PATCH", "DELETE"),
    log_success: bool = True,
    log_failure: bool = True,
):
    """Explicitly audit a mutating API endpoint without global middleware.

    The decorator records authorized calls after the wrapped permission guard,
    captures sanitized request metadata, and derives entity identifiers from
    URL keyword arguments. Domain endpoints that need richer before/after data
    should continue to call ``log_action`` directly instead.
    """
    audited_methods = {str(method).upper() for method in methods}

    def decorator(view_func):
        @wraps(view_func)
        def wrapped(request, *args, **kwargs):
            method = str(getattr(request, "method", "")).upper()
            if method not in audited_methods:
                return view_func(request, *args, **kwargs)

            resolved_action = action or HTTP_ACTIONS.get(method, ACTION_UPDATE)
            entity_id = next(
                (value for key, value in kwargs.items() if key == "id" or key.endswith("_id")),
                "",
            )
            request_details = getattr(request, "data", {})
            base_event = {
                "request": request,
                "action": resolved_action,
                "module": module,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "details": {
                    "http_method": method,
                    "path": getattr(request, "path", ""),
                    "url_parameters": kwargs,
                    "request": request_details if isinstance(request_details, dict) else {},
                },
            }
            try:
                response = view_func(request, *args, **kwargs)
            except Exception as exc:
                if log_failure:
                    log_action(
                        **base_event,
                        description=f"{resolved_action} {entity_type} raised an exception",
                        status=AuditLog.STATUS_FAILED,
                        details={**base_event["details"], "error_type": type(exc).__name__},
                    )
                raise

            status_code = int(getattr(response, "status_code", 200))
            event = {
                **base_event,
                "description": f"{resolved_action} {entity_type}",
                "status": AuditLog.STATUS_SUCCESS if status_code < 400 else AuditLog.STATUS_FAILED,
                "details": {**base_event["details"], "http_status": status_code},
            }
            if status_code < 400 and log_success:
                log_action_on_commit(**event)
            elif status_code >= 400 and log_failure:
                log_action(**event)
            return response

        return wrapped

    return decorator
