from functools import wraps

from django.http import HttpResponse, JsonResponse
from rest_framework.decorators import api_view

from api.role_permissions import can_manage_scale
from .services.deployment_service import (
    DeploymentError,
    create_deployment,
)


def require_scale_admin(view_func):
    """Authentication + Scale-management permission gate.

    Mirrors the existing `require_scale_admin_access` decorator used by the
    Scale Management views (scale/views.py) - 401 when anonymous, 403 when the
    user cannot manage scales. Only scale_admin / super_admin pass.
    """
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"success": False, "error": "Authentication required"}, status=401)
        if not can_manage_scale(request.user):
            return JsonResponse({"success": False, "error": "Scale admin access required"}, status=403)
        return view_func(request, *args, **kwargs)
    return wrapped


@api_view(["GET"])
@require_scale_admin
def scale_agent_deploy_view(request):
    """Download a deployment ZIP for the Scale Agent.

    GET /scale-management/deploy/          -> package with all active local scales
    GET /scale-management/deploy/?scale_id=SCALE-01 -> package for one scale

    Returns application/zip or a JSON error (never HTTP 500 for input errors).
    """
    scale_id = (request.GET.get("scale_id") or "").strip() or None

    try:
        zip_bytes, filename = create_deployment(scale_id=scale_id)
    except DeploymentError as exc:
        return JsonResponse({"success": False, "error": str(exc)}, status=exc.status_code)

    response = HttpResponse(zip_bytes, content_type="application/zip")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response