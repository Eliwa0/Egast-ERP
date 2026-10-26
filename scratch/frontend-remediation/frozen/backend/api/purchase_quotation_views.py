from django.db.models import Q
from django.http import JsonResponse
from rest_framework.decorators import api_view

from .models_purchase_quotation import PurchaseQuotationDraft
from .role_permissions import (
    MODULE_PURCHASE_QUOTATION as PERMISSION_MODULE_PURCHASE_QUOTATION,
    require_module_access,
    require_module_admin,
)
from .services.audit_service import (
    audit_mutation,
    log_action,
    MODULE_PURCHASE_QUOTATION,
    ACTION_CREATE,
    ACTION_APPROVE,
    ACTION_POST,
    ACTION_CANCEL,
    ACTION_UPDATE,
)
from .services.cache_service import (
    build_cache_key,
    cache_get,
    cache_set,
    sap_master_namespace,
)
from .services.sap_service import SAPServiceLayer
from .services.purchase_quotation_service import (
    PurchaseQuotationDraftService,
    PurchaseQuotationDraftValidationError,
)
from .services.purchase_quotation_posting_service import (
    PurchaseQuotationPostingError,
    PurchaseQuotationPostingPreparationService,
    PurchaseQuotationPostingService,
    PurchaseQuotationPostingStateError,
)


def _serialize_draft(draft):
    return {
        "id": draft.id,
        "status": draft.status,
        "vehicle_number": draft.vehicle_number or "",
        "container_quantity": int(draft.container_quantity or 0),
        "vendor_card_code": draft.vendor_card_code or "",
        "vendor_name": draft.vendor_name or "",
        "contact_person_code": draft.contact_person_code,
        "vendor_ref_no": draft.vendor_ref_no or "",
        "currency": draft.currency or "EGP",
        "group_no": draft.group_no or "",
        "posting_date": draft.posting_date.isoformat() if draft.posting_date else None,
        "valid_until": draft.valid_until.isoformat() if draft.valid_until else None,
        "document_date": draft.document_date.isoformat() if draft.document_date else None,
        "required_date": draft.required_date.isoformat() if draft.required_date else None,
        "buyer_code": draft.buyer_code,
        "owner_code": draft.owner_code,
        "journal_remark": draft.journal_remark or "",
        "remarks": draft.remarks or "",
        "ship_to_address": draft.ship_to_address or "",
        "pay_to_address": draft.pay_to_address or "",
        "payment_terms_code": draft.payment_terms_code,
        "total_before_discount": str(draft.total_before_discount),
        "discount_percent": str(draft.discount_percent),
        "discount_amount": str(draft.discount_amount),
        "freight": str(draft.freight),
        "tax_total": str(draft.tax_total),
        "rounding": str(draft.rounding),
        "total_payment_due": str(draft.total_payment_due),
        "lines": draft.lines or [],
        "sap_doc_entry": draft.sap_doc_entry or "",
        "sap_doc_num": draft.sap_doc_num or "",
        "sap_error_message": draft.sap_error_message or "",
        "created_by": draft.created_by.username if draft.created_by else None,
        "posted_by": draft.posted_by.username if draft.posted_by else None,
        "created_at": draft.created_at.isoformat() if draft.created_at else None,
        "updated_at": draft.updated_at.isoformat() if draft.updated_at else None,
        "posted_at": draft.posted_at.isoformat() if draft.posted_at else None,
    }


@api_view(["GET"])
@require_module_access(PERMISSION_MODULE_PURCHASE_QUOTATION)
def list_purchase_quotation_drafts(request):
    """Returns active Purchase Quotation drafts and pending documents."""
    search_query = str(request.query_params.get("search", "")).strip()

    queryset = PurchaseQuotationDraft.objects.filter(
        status__in=PurchaseQuotationDraft.ACTIVE_STATUSES
    ).order_by("-updated_at", "-created_at")

    if search_query:
        search_filter = (
            Q(vendor_card_code__icontains=search_query)
            | Q(vendor_name__icontains=search_query)
            | Q(vendor_ref_no__icontains=search_query)
        )
        if search_query.isdigit():
            search_filter |= Q(id=int(search_query))
        queryset = queryset.filter(search_filter)

    drafts = [_serialize_draft(d) for d in queryset]
    return JsonResponse({
        "success": True,
        "data": {
            "drafts": drafts,
            "count": len(drafts),
        }
    })


@api_view(["POST"])
@require_module_access(PERMISSION_MODULE_PURCHASE_QUOTATION)
@audit_mutation(module=MODULE_PURCHASE_QUOTATION, entity_type="PurchaseQuotationDraft", action=ACTION_CREATE, log_success=False)
def create_purchase_quotation_draft(request):
    """Creates a new Purchase Quotation draft."""
    data = request.data if isinstance(request.data, dict) else {}
    service = PurchaseQuotationDraftService()

    try:
        draft = service.create_draft(data, user=request.user)
        log_action(
            request=request,
            user=request.user,
            action=ACTION_CREATE,
            module=MODULE_PURCHASE_QUOTATION,
            entity_type="PurchaseQuotationDraft",
            entity_id=str(draft.id),
            description=f"Created Purchase Quotation draft #{draft.id}",
            details={"vendor_card_code": draft.vendor_card_code, "vendor_name": draft.vendor_name},
        )
        return JsonResponse({
            "success": True,
            "data": {
                "draft": _serialize_draft(draft),
                "message": "Purchase Quotation draft created successfully.",
            }
        }, status=201)
    except PurchaseQuotationDraftValidationError as err:
        return JsonResponse({"success": False, "errors": err.errors}, status=400)
    except Exception as exc:
        return JsonResponse({"success": False, "error": str(exc)}, status=400)


@api_view(["GET", "PATCH"])
@require_module_access(PERMISSION_MODULE_PURCHASE_QUOTATION)
@audit_mutation(
    module=MODULE_PURCHASE_QUOTATION,
    entity_type="PurchaseQuotationDraft",
    action=ACTION_UPDATE,
    methods=("PATCH",),
)
def purchase_quotation_draft_detail(request, draft_id):
    """Fetches or updates a single Purchase Quotation draft."""
    try:
        draft = PurchaseQuotationDraft.objects.get(id=draft_id)
    except PurchaseQuotationDraft.DoesNotExist:
        return JsonResponse({"success": False, "error": "Purchase Quotation draft not found."}, status=404)

    service = PurchaseQuotationDraftService()

    if request.method == "GET":
        return JsonResponse({
            "success": True,
            "data": {
                "draft": _serialize_draft(draft),
            }
        })

    if request.method == "PATCH":
        data = request.data if isinstance(request.data, dict) else {}
        try:
            updated_draft = service.update_draft(draft, data, user=request.user)
            return JsonResponse({
                "success": True,
                "data": {
                    "draft": _serialize_draft(updated_draft),
                    "message": "Purchase Quotation draft updated successfully.",
                }
            })
        except PurchaseQuotationDraftValidationError as err:
            return JsonResponse({"success": False, "errors": err.errors}, status=400)
        except Exception as exc:
            return JsonResponse({"success": False, "error": str(exc)}, status=400)


@api_view(["POST"])
@require_module_admin(PERMISSION_MODULE_PURCHASE_QUOTATION)
@audit_mutation(module=MODULE_PURCHASE_QUOTATION, entity_type="PurchaseQuotationDraft", action=ACTION_APPROVE, log_success=False)
def approve_purchase_quotation_draft(request, draft_id):
    """Approves a Purchase Quotation draft for posting."""
    try:
        draft = PurchaseQuotationDraft.objects.get(id=draft_id)
    except PurchaseQuotationDraft.DoesNotExist:
        return JsonResponse({"success": False, "error": "Purchase Quotation draft not found."}, status=404)

    service = PurchaseQuotationDraftService()
    try:
        approved_draft = service.approve_for_posting(draft, user=request.user)
        log_action(
            request=request,
            user=request.user,
            action=ACTION_APPROVE,
            module=MODULE_PURCHASE_QUOTATION,
            entity_type="PurchaseQuotationDraft",
            entity_id=str(draft.id),
            description=f"Approved Purchase Quotation draft #{draft.id} for posting",
            details={"vendor_card_code": draft.vendor_card_code},
        )
        return JsonResponse({
            "success": True,
            "data": {
                "draft": _serialize_draft(approved_draft),
                "message": "Purchase Quotation approved for posting.",
            }
        })
    except PurchaseQuotationDraftValidationError as err:
        return JsonResponse({"success": False, "errors": err.errors}, status=400)
    except Exception as exc:
        return JsonResponse({"success": False, "error": str(exc)}, status=400)


@api_view(["POST"])
@require_module_admin(PERMISSION_MODULE_PURCHASE_QUOTATION)
def prepare_purchase_quotation_posting(request, draft_id):
    """Prepares and validates SAP payload preview for a Purchase Quotation."""
    try:
        draft = PurchaseQuotationDraft.objects.get(id=draft_id)
    except PurchaseQuotationDraft.DoesNotExist:
        return JsonResponse({"success": False, "error": "Purchase Quotation draft not found."}, status=404)

    verify_sap = request.query_params.get("verify_sap") == "1"
    prep_service = PurchaseQuotationPostingPreparationService()

    try:
        result = prep_service.prepare_preview(draft, verify_with_sap=verify_sap, user=request.user)
        return JsonResponse({"success": True, "data": result})
    except PurchaseQuotationPostingStateError as err:
        return JsonResponse({"success": False, "error": str(err)}, status=400)
    except Exception as exc:
        return JsonResponse({"success": False, "error": str(exc)}, status=400)


@api_view(["POST"])
@require_module_admin(PERMISSION_MODULE_PURCHASE_QUOTATION)
@audit_mutation(module=MODULE_PURCHASE_QUOTATION, entity_type="PurchaseQuotationDraft", action=ACTION_POST, log_success=False)
def post_purchase_quotation_to_sap(request, draft_id):
    """Executes SAP Service Layer posting for an approved Purchase Quotation."""
    try:
        draft = PurchaseQuotationDraft.objects.get(id=draft_id)
    except PurchaseQuotationDraft.DoesNotExist:
        return JsonResponse({"success": False, "error": "Purchase Quotation draft not found."}, status=404)

    prep_service = PurchaseQuotationPostingPreparationService()
    posting_service = PurchaseQuotationPostingService()

    try:
        preview = prep_service.prepare_preview(draft, verify_with_sap=False, user=request.user)
        payload = preview["payload"]
        posted_draft = posting_service.post(draft, payload, user=request.user)

        log_action(
            request=request,
            user=request.user,
            action=ACTION_POST,
            module=MODULE_PURCHASE_QUOTATION,
            entity_type="PurchaseQuotationDraft",
            entity_id=str(draft.id),
            description=f"Posted Purchase Quotation #{draft.id} to SAP (#{posted_draft.sap_doc_num})",
            details={"sap_doc_num": posted_draft.sap_doc_num, "sap_doc_entry": posted_draft.sap_doc_entry},
        )

        return JsonResponse({
            "success": True,
            "data": {
                "draft": _serialize_draft(posted_draft),
                "sap_doc_entry": posted_draft.sap_doc_entry,
                "sap_doc_num": posted_draft.sap_doc_num,
                "message": "Purchase Quotation posted to SAP Business One successfully.",
            }
        })
    except PurchaseQuotationPostingStateError as err:
        return JsonResponse({"success": False, "error": str(err)}, status=400)
    except PurchaseQuotationPostingError as err:
        return JsonResponse({
            "success": False,
            "error": str(err),
            "sap_response": err.response,
        }, status=400)
    except Exception as exc:
        return JsonResponse({"success": False, "error": str(exc)}, status=400)


@api_view(["POST"])
@require_module_admin(PERMISSION_MODULE_PURCHASE_QUOTATION)
@audit_mutation(module=MODULE_PURCHASE_QUOTATION, entity_type="PurchaseQuotationDraft", action=ACTION_CANCEL, log_success=False)
def cancel_purchase_quotation_draft(request, draft_id):
    """Cancels a Purchase Quotation draft."""
    try:
        draft = PurchaseQuotationDraft.objects.get(id=draft_id)
    except PurchaseQuotationDraft.DoesNotExist:
        return JsonResponse({"success": False, "error": "Purchase Quotation draft not found."}, status=404)

    reason = str(request.data.get("reason", "") if isinstance(request.data, dict) else "").strip()
    service = PurchaseQuotationDraftService()

    try:
        cancelled_draft = service.cancel_draft(draft, user=request.user, reason=reason)
        log_action(
            request=request,
            user=request.user,
            action=ACTION_CANCEL,
            module=MODULE_PURCHASE_QUOTATION,
            entity_type="PurchaseQuotationDraft",
            entity_id=str(draft.id),
            description=f"Cancelled Purchase Quotation draft #{draft.id}",
            details={"reason": reason},
        )
        return JsonResponse({
            "success": True,
            "data": {
                "draft": _serialize_draft(cancelled_draft),
                "message": "Purchase Quotation draft cancelled.",
            }
        })
    except Exception as exc:
        return JsonResponse({"success": False, "error": str(exc)}, status=400)


@api_view(["GET"])
@require_module_access(PERMISSION_MODULE_PURCHASE_QUOTATION)
def list_completed_purchase_quotations(request):
    """Returns completed/posted Purchase Quotations log."""
    search_query = str(request.query_params.get("search", "")).strip()

    queryset = PurchaseQuotationDraft.objects.filter(
        status=PurchaseQuotationDraft.POSTED
    ).order_by("-posted_at", "-created_at")

    if search_query:
        search_filter = (
            Q(vendor_card_code__icontains=search_query)
            | Q(vendor_name__icontains=search_query)
            | Q(sap_doc_entry__icontains=search_query)
            | Q(sap_doc_num__icontains=search_query)
        )
        if search_query.isdigit():
            search_filter |= Q(id=int(search_query))
        queryset = queryset.filter(search_filter)

    records = [_serialize_draft(d) for d in queryset]
    return JsonResponse({
        "success": True,
        "data": {
            "records": records,
            "count": len(records),
        }
    })


@api_view(["GET"])
@require_module_access(PERMISSION_MODULE_PURCHASE_QUOTATION)
def list_warehouse_locations(request):
    """Fetch warehouse locations (table OLOC) from SAP Service Layer."""
    cache_key = build_cache_key(sap_master_namespace("warehouse-locations"))
    cached = cache_get(cache_key)
    if cached is not None:
        return JsonResponse(
            {"success": True, "locations": cached, "data": {"locations": cached}}
        )

    try:
        sap = SAPServiceLayer()
        res = sap.get_warehouse_locations()
        raw_locs = res.get("value", []) if isinstance(res, dict) else []
        rows = []
        for loc in raw_locs:
            code = loc.get("Code")
            name = loc.get("Name") or ""
            if code is not None:
                rows.append({
                    "code": int(code),
                    "name": str(name).strip(),
                })
        rows.sort(key=lambda x: x["code"])
    except Exception as exc:
        return JsonResponse({"success": False, "locations": [], "error": str(exc)}, status=500)

    cache_set(
        sap_master_namespace("warehouse-locations"), cache_key, rows, "sap_warehouse_locations"
    )
    return JsonResponse({"success": True, "locations": rows, "data": {"locations": rows}})


@api_view(["GET"])
@require_module_access(PERMISSION_MODULE_PURCHASE_QUOTATION)
def list_currencies(request):
    """Fetch active SAP currencies from Service Layer."""
    cache_key = build_cache_key(sap_master_namespace("currencies"))
    cached = cache_get(cache_key)
    if cached is not None:
        return JsonResponse({
            "success": True,
            "currencies": cached,
            "data": {
                "currencies": cached,
                "count": len(cached),
            },
        })

    try:
        sap = SAPServiceLayer()
        res = sap.get_currencies()
        raw_currs = res.get("value", []) if isinstance(res, dict) else []
        rows = []
        for curr in raw_currs:
            code = curr.get("Code")
            if code:
                rows.append({
                    "code": str(code).strip(),
                    "name": str(curr.get("Name") or "").strip(),
                    "documents_code": str(curr.get("DocumentsCode") or curr.get("Code") or "").strip(),
                    "international_description": str(curr.get("InternationalDescription") or "").strip(),
                })
        rows.sort(key=lambda x: x["code"])
    except Exception as exc:
        return JsonResponse({"success": False, "currencies": [], "error": str(exc)}, status=500)

    cache_set(sap_master_namespace("currencies"), cache_key, rows, "sap_currencies")
    return JsonResponse({
        "success": True,
        "currencies": rows,
        "data": {
            "currencies": rows,
            "count": len(rows),
        },
    })
