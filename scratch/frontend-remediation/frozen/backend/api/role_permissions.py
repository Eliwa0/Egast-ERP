from functools import wraps

from django.db.models import Q
from django.http import JsonResponse

from .models import UserModulePermission


MODULE_PRODUCTION = UserModulePermission.MODULE_PRODUCTION
MODULE_TRANSFER = UserModulePermission.MODULE_TRANSFER
MODULE_QUALITY = UserModulePermission.MODULE_QUALITY
MODULE_GRPO = UserModulePermission.MODULE_GRPO
MODULE_PURCHASE_QUOTATION = UserModulePermission.MODULE_PURCHASE_QUOTATION
MODULE_SCALE = UserModulePermission.MODULE_SCALE
MODULE_CUSTOMIZATION = UserModulePermission.MODULE_CUSTOMIZATION
MODULE_DELIVERY = UserModulePermission.MODULE_DELIVERY
MODULES = tuple(value for value, _label in UserModulePermission.MODULE_CHOICES)
MODULE_DEFINITIONS = tuple(
    {"key": value, "display_name": label}
    for value, label in UserModulePermission.MODULE_CHOICES
)
LEVEL_USER = UserModulePermission.LEVEL_USER
LEVEL_ADMIN = UserModulePermission.LEVEL_ADMIN


ROLE_ADMIN = "admin"
ROLE_SUPER_ADMIN = "super_admin"
ROLE_PRODUCTION_ADMIN = "production_admin"
ROLE_TRANSFER_ADMIN = "transfer_admin"
ROLE_QUALITY_ADMIN = "quality_admin"
ROLE_SCALE_ADMIN = "scale_admin"

ROLE_PRODUCTION_USER = "production_user"
ROLE_TRANSFER_USER = "transfer_user"
ROLE_QUALITY_USER = "quality_user"
ROLE_SCALE_OPERATOR = "scale_operator"

SUPER_ADMIN_ROLES = {ROLE_ADMIN, ROLE_SUPER_ADMIN}
PRODUCTION_USER_ROLES = {"production", "user", ROLE_PRODUCTION_USER}
TRANSFER_USER_ROLES = {"transfer", ROLE_TRANSFER_USER}
QUALITY_USER_ROLES = {"quality", ROLE_QUALITY_USER}
SCALE_USER_ROLES = {"scale_operator", "scale_user", "scale", ROLE_SCALE_OPERATOR}

PRODUCTION_ROLES = PRODUCTION_USER_ROLES | {ROLE_PRODUCTION_ADMIN} | SUPER_ADMIN_ROLES
TRANSFER_ROLES = TRANSFER_USER_ROLES | {ROLE_TRANSFER_ADMIN} | SUPER_ADMIN_ROLES
QUALITY_ROLES = QUALITY_USER_ROLES | {ROLE_QUALITY_ADMIN} | SUPER_ADMIN_ROLES
SCALE_ROLES = SCALE_USER_ROLES | {ROLE_SCALE_ADMIN} | SUPER_ADMIN_ROLES

ADMIN_ROLES = SUPER_ADMIN_ROLES | {
    ROLE_PRODUCTION_ADMIN,
    ROLE_TRANSFER_ADMIN,
    ROLE_QUALITY_ADMIN,
    ROLE_SCALE_ADMIN,
}

VALID_ROLES = (
    ROLE_ADMIN,
    ROLE_SUPER_ADMIN,
    ROLE_PRODUCTION_ADMIN,
    ROLE_TRANSFER_ADMIN,
    ROLE_QUALITY_ADMIN,
    ROLE_SCALE_ADMIN,
    ROLE_PRODUCTION_USER,
    ROLE_TRANSFER_USER,
    ROLE_QUALITY_USER,
    ROLE_SCALE_OPERATOR,
)


def normalize_role(role):
    value = str(role or "").strip().lower()
    if value in {"admin", "administrator"}:
        return ROLE_ADMIN
    if value == ROLE_SUPER_ADMIN:
        return ROLE_SUPER_ADMIN
    if value in {"production_admin", "prod_admin"}:
        return ROLE_PRODUCTION_ADMIN
    if value in {"transfer_admin", "trans_admin"}:
        return ROLE_TRANSFER_ADMIN
    if value in {"quality_admin", "qa_admin"}:
        return ROLE_QUALITY_ADMIN
    if value in {"scale_admin"}:
        return ROLE_SCALE_ADMIN
    if value in {"quality_user", "qa_user", "quality"}:
        return ROLE_QUALITY_USER
    if value in {"scale_operator", "scale_user", "scale"}:
        return ROLE_SCALE_OPERATOR
    if value in TRANSFER_USER_ROLES:
        return ROLE_TRANSFER_USER
    if value in PRODUCTION_USER_ROLES or value == "":
        return ROLE_PRODUCTION_USER
    return ROLE_PRODUCTION_USER


def get_user_role(user):
    if not user or not user.is_authenticated:
        return ""
    if getattr(user, "is_superuser", False):
        return ROLE_ADMIN
    profile = getattr(user, "userprofile", None)
    return normalize_role(profile.role if profile else "")


def is_super_admin(user):
    return get_user_role(user) in SUPER_ADMIN_ROLES


def is_production_admin(user):
    return get_user_role(user) == ROLE_PRODUCTION_ADMIN


def is_transfer_admin(user):
    return get_user_role(user) == ROLE_TRANSFER_ADMIN


def is_quality_admin(user):
    return get_user_role(user) == ROLE_QUALITY_ADMIN


def is_scale_admin(user):
    return get_user_role(user) == ROLE_SCALE_ADMIN


def is_scale_operator(user):
    return get_user_role(user) == ROLE_SCALE_OPERATOR


def is_module_admin(user):
    return is_super_admin(user) or any(can_manage_module(user, module) for module in MODULES)


def _legacy_module_permissions(user):
    """Temporary compatibility for code/tests creating legacy-role users.

    The data migration creates explicit rows for every existing user. This
    fallback applies only when a user has no rows at all and can be removed
    after all external user-provisioning paths write assignments directly.
    """
    role = get_user_role(user)
    mapping = {
        ROLE_PRODUCTION_USER: {MODULE_PRODUCTION: LEVEL_USER},
        ROLE_PRODUCTION_ADMIN: {MODULE_PRODUCTION: LEVEL_ADMIN},
        ROLE_TRANSFER_USER: {MODULE_TRANSFER: LEVEL_USER},
        ROLE_TRANSFER_ADMIN: {MODULE_TRANSFER: LEVEL_ADMIN},
        ROLE_QUALITY_USER: {
            MODULE_QUALITY: LEVEL_USER,
            MODULE_GRPO: LEVEL_ADMIN,
            MODULE_PURCHASE_QUOTATION: LEVEL_ADMIN,
        },
        ROLE_QUALITY_ADMIN: {
            MODULE_QUALITY: LEVEL_ADMIN,
            MODULE_GRPO: LEVEL_ADMIN,
            MODULE_PURCHASE_QUOTATION: LEVEL_ADMIN,
        },
        ROLE_SCALE_OPERATOR: {MODULE_SCALE: LEVEL_USER},
        ROLE_SCALE_ADMIN: {MODULE_SCALE: LEVEL_ADMIN},
    }
    return mapping.get(role, {})


def get_module_permissions(user):
    if not user or not user.is_authenticated:
        return {}
    if is_super_admin(user):
        return {}
    rows = [(row.module, row.level) for row in user.module_permissions.all()]
    if rows:
        return dict(rows)
    profile = getattr(user, "userprofile", None)
    if profile is None:
        return {}
    if profile and profile.module_permissions_initialized:
        return {}
    return _legacy_module_permissions(user)


def can_access_module(user, module):
    if is_super_admin(user):
        return True
    return get_module_permissions(user).get(module) in {LEVEL_USER, LEVEL_ADMIN}


def can_manage_module(user, module):
    if is_super_admin(user):
        return True
    return get_module_permissions(user).get(module) == LEVEL_ADMIN


def has_module_level(user, module, level):
    """Return whether the user's resolved canonical assignment exactly matches a level."""
    if module not in MODULES or level not in {LEVEL_USER, LEVEL_ADMIN}:
        return False
    return get_module_permissions(user).get(module) == level


def require_module_access(module):
    def decorator(view_func):
        @wraps(view_func)
        def wrapped(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return JsonResponse({"success": False, "error": "Authentication required"}, status=401)
            if not can_access_module(request.user, module):
                return JsonResponse({"success": False, "error": "Module access required"}, status=403)
            return view_func(request, *args, **kwargs)
        wrapped.csrf_exempt = getattr(view_func, "csrf_exempt", False)
        return wrapped
    return decorator


def require_module_admin(module):
    def decorator(view_func):
        @wraps(view_func)
        def wrapped(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return JsonResponse({"success": False, "error": "Authentication required"}, status=401)
            if not can_manage_module(request.user, module):
                return JsonResponse({"success": False, "error": "Module admin access required"}, status=403)
            return view_func(request, *args, **kwargs)
        wrapped.csrf_exempt = getattr(view_func, "csrf_exempt", False)
        return wrapped
    return decorator


def require_any_module_access(*modules):
    def decorator(view_func):
        @wraps(view_func)
        def wrapped(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return JsonResponse({"success": False, "error": "Authentication required"}, status=401)
            if not any(can_access_module(request.user, module) for module in modules):
                return JsonResponse({"success": False, "error": "Module access required"}, status=403)
            return view_func(request, *args, **kwargs)
        wrapped.csrf_exempt = getattr(view_func, "csrf_exempt", False)
        return wrapped
    return decorator


def can_manage_production(user):
    return can_manage_module(user, MODULE_PRODUCTION)


def can_manage_transfer(user):
    return can_manage_module(user, MODULE_TRANSFER)


def can_manage_quality(user):
    return can_manage_module(user, MODULE_QUALITY)


def can_manage_scale(user):
    return can_manage_module(user, MODULE_SCALE)


def can_access_production(user):
    return can_access_module(user, MODULE_PRODUCTION)


def can_access_transfer(user):
    return can_access_module(user, MODULE_TRANSFER)


def can_access_quality(user):
    return can_access_module(user, MODULE_QUALITY)


def can_access_scale(user):
    return can_access_module(user, MODULE_SCALE)


def can_access_grpo(user):
    return can_access_module(user, MODULE_GRPO)


def can_manage_grpo(user):
    return can_manage_module(user, MODULE_GRPO)


def can_access_purchase_quotation(user):
    return can_access_module(user, MODULE_PURCHASE_QUOTATION)


def can_manage_purchase_quotation(user):
    return can_manage_module(user, MODULE_PURCHASE_QUOTATION)


def can_access_customization(user):
    return can_access_module(user, MODULE_CUSTOMIZATION)


def can_manage_customization(user):
    return can_manage_module(user, MODULE_CUSTOMIZATION)


def can_access_delivery(user):
    return can_access_module(user, MODULE_DELIVERY)


def can_manage_delivery(user):
    return can_manage_module(user, MODULE_DELIVERY)


def can_manage_users(user):
    return (
        is_super_admin(user)
        or can_manage_production(user)
        or can_manage_transfer(user)
    )


def is_production_user_role(role):
    return normalize_role(role) == ROLE_PRODUCTION_USER


def is_transfer_user_role(role):
    return normalize_role(role) == ROLE_TRANSFER_USER


def is_quality_user_role(role):
    return normalize_role(role) == ROLE_QUALITY_USER


def is_scale_user_role(role):
    return normalize_role(role) == ROLE_SCALE_OPERATOR


def can_create_user_role(actor, target_role):
    role = normalize_role(target_role)
    if is_super_admin(actor):
        return role in set(VALID_ROLES)
    if can_manage_production(actor):
        return role == ROLE_PRODUCTION_USER
    if can_manage_transfer(actor):
        return role == ROLE_TRANSFER_USER
    return False


def can_manage_user(actor, target_user):
    if is_super_admin(actor):
        return True
    target_role = get_user_role(target_user)
    if can_manage_production(actor):
        return target_role == ROLE_PRODUCTION_USER
    if can_manage_transfer(actor):
        return target_role == ROLE_TRANSFER_USER
    return False


def manageable_users_filter(actor):
    if is_super_admin(actor):
        return Q()
    if can_manage_production(actor):
        return Q(is_superuser=False, userprofile__role__in=PRODUCTION_USER_ROLES)
    if can_manage_transfer(actor):
        return Q(is_superuser=False, userprofile__role__in=TRANSFER_USER_ROLES)
    return Q(pk__isnull=True)
