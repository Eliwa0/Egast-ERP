from django.db.models import Q


ROLE_ADMIN = "admin"
ROLE_SUPER_ADMIN = "super_admin"
ROLE_PRODUCTION_ADMIN = "production_admin"
ROLE_TRANSFER_ADMIN = "transfer_admin"
ROLE_PRODUCTION_USER = "production_user"
ROLE_TRANSFER_USER = "transfer_user"

SUPER_ADMIN_ROLES = {ROLE_ADMIN, ROLE_SUPER_ADMIN}
PRODUCTION_USER_ROLES = {"production", "user", ROLE_PRODUCTION_USER}
TRANSFER_USER_ROLES = {"transfer", ROLE_TRANSFER_USER}
PRODUCTION_ROLES = PRODUCTION_USER_ROLES | {ROLE_PRODUCTION_ADMIN} | SUPER_ADMIN_ROLES
TRANSFER_ROLES = TRANSFER_USER_ROLES | {ROLE_TRANSFER_ADMIN} | SUPER_ADMIN_ROLES
ADMIN_ROLES = SUPER_ADMIN_ROLES | {ROLE_PRODUCTION_ADMIN, ROLE_TRANSFER_ADMIN}
VALID_ROLES = (
    ROLE_ADMIN,
    ROLE_SUPER_ADMIN,
    ROLE_PRODUCTION_ADMIN,
    ROLE_TRANSFER_ADMIN,
    ROLE_PRODUCTION_USER,
    ROLE_TRANSFER_USER,
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


def is_module_admin(user):
    return get_user_role(user) in ADMIN_ROLES


def can_manage_production(user):
    return is_super_admin(user) or is_production_admin(user)


def can_manage_transfer(user):
    return is_super_admin(user) or is_transfer_admin(user)


def can_access_production(user):
    return get_user_role(user) in PRODUCTION_ROLES


def can_access_transfer(user):
    return get_user_role(user) in TRANSFER_ROLES


def can_manage_users(user):
    return is_super_admin(user) or is_production_admin(user) or is_transfer_admin(user)


def is_production_user_role(role):
    return normalize_role(role) == ROLE_PRODUCTION_USER


def is_transfer_user_role(role):
    return normalize_role(role) == ROLE_TRANSFER_USER


def can_create_user_role(actor, target_role):
    role = normalize_role(target_role)
    if is_super_admin(actor):
        return role in set(VALID_ROLES)
    if is_production_admin(actor):
        return role == ROLE_PRODUCTION_USER
    if is_transfer_admin(actor):
        return role == ROLE_TRANSFER_USER
    return False


def can_manage_user(actor, target_user):
    if is_super_admin(actor):
        return True
    target_role = get_user_role(target_user)
    if is_production_admin(actor):
        return target_role == ROLE_PRODUCTION_USER
    if is_transfer_admin(actor):
        return target_role == ROLE_TRANSFER_USER
    return False


def manageable_users_filter(actor):
    if is_super_admin(actor):
        return Q()
    if is_production_admin(actor):
        return Q(is_superuser=False, userprofile__role__in=PRODUCTION_USER_ROLES)
    if is_transfer_admin(actor):
        return Q(is_superuser=False, userprofile__role__in=TRANSFER_USER_ROLES)
    return Q(pk__isnull=True)
