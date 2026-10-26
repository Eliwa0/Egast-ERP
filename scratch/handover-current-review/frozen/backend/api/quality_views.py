from functools import wraps
import re
from django.core.exceptions import ObjectDoesNotExist
from django.http import JsonResponse
from django.utils import timezone
from django.db import transaction
from django.db.models.deletion import ProtectedError
from rest_framework.decorators import api_view
from .role_permissions import (
    MODULE_GRPO as PERMISSION_MODULE_GRPO,
    MODULE_PURCHASE_QUOTATION as PERMISSION_MODULE_PURCHASE_QUOTATION,
    MODULE_QUALITY as PERMISSION_MODULE_QUALITY,
    can_access_quality,
    can_manage_quality,
    require_module_access,
    require_module_admin,
    require_any_module_access,
)
from .services.audit_service import (
    audit_mutation,
    log_action,
    MODULE_QUALITY,
    MODULE_GRPO,
    ACTION_CREATE,
    ACTION_APPROVE,
    ACTION_REJECT,
    ACTION_DELETE,
    ACTION_POST,
    ACTION_CANCEL,
    ACTION_UPDATE,
)
from .models import InspectionStage, ItemQualityCriterion, PendingQualityInspection, PurchaseGRPODraft, QualityCategory, QualityCriterion, QualityItemSequence
from .quality_serializers import InspectionStageSerializer, ItemQualityCriterionSerializer, PurchaseGRPODraftSerializer, QualityCategorySerializer, QualityCriterionSerializer
from .services.purchase_grpo_service import PurchaseGRPODraftService, PurchaseGRPODraftValidationError
from .services.purchase_grpo_payload_builder import PurchaseGRPOPayloadBuilder
from .services.purchase_grpo_posting_service import (
    PurchaseGRPOPayloadValidationError,
    PurchaseGRPOPostingError,
    PurchaseGRPOPostingPreparationService,
    PurchaseGRPOPostingService,
    PurchaseGRPOPostingStateError,
)
from .services.cache_service import build_cache_key, cache_get, cache_get_or_set, cache_set, invalidate_cache_namespaces, sap_master_namespace


def _parse_optional_decimal(value, field_label):
    if value in (None, ""):
        return None, None
    try:
        from decimal import Decimal, InvalidOperation
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None, f"{field_label} must be a valid number."
    if not parsed.is_finite():
        return None, f"{field_label} must be a valid number."
    return parsed, None


def _normalize_optional_date(value):
    text = str(value or "").strip()
    return text or None

def require_quality_access(view_func):
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"success": False, "error": "Authentication required"}, status=401)
        if not can_access_quality(request.user):
            return JsonResponse({"success": False, "error": "Quality access required"}, status=403)
        return view_func(request, *args, **kwargs)
    wrapped.csrf_exempt = getattr(view_func, "csrf_exempt", False)
    return wrapped

def require_quality_admin_access(view_func):
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"success": False, "error": "Authentication required"}, status=401)
        if not can_manage_quality(request.user):
            return JsonResponse({"success": False, "error": "Quality admin access required"}, status=403)
        return view_func(request, *args, **kwargs)
    wrapped.csrf_exempt = getattr(view_func, "csrf_exempt", False)
    return wrapped


def _collect_related_delete_blockers(instance, labels=None):
    labels = labels or {}
    blockers = []
    for relation in instance._meta.related_objects:
        accessor = relation.get_accessor_name()
        if not accessor:
            continue
        try:
            related = getattr(instance, accessor, None)
        except ObjectDoesNotExist:
            continue
        if related is None:
            continue
        try:
            count = related.count()
        except AttributeError:
            count = 1 if related else 0
        if count:
            label = labels.get(accessor) or relation.related_model._meta.verbose_name_plural.title()
            blockers.append({"name": label, "count": count})
    return blockers


def _blocked_delete_response(entity_name, blockers):
    details = ", ".join(f"{item['name']} ({item['count']})" for item in blockers)
    return JsonResponse({
        "success": False,
        "error": f"Cannot delete {entity_name} because it is referenced by {details}. Deactivate it instead.",
        "references": blockers,
    }, status=400)

def _get_case_insensitive(row, key, default=None):
    if not row:
        return default
    if key in row:
        return row[key]
    if key.lower() in row:
        return row[key.lower()]
    if key.upper() in row:
        return row[key.upper()]
    title_key = key.title()
    if title_key in row:
        return row[title_key]
    for k in row.keys():
        if k.lower() == key.lower().replace("_", "") or k.lower().replace("_", "") == key.lower():
            return row[k]
    return default


def _get_item_uom_fields(row):
    uom_code = (
        _get_case_insensitive(row, "InventoryUOM")
        or _get_case_insensitive(row, "InvntryUom")
        or _get_case_insensitive(row, "InventoryUoM")
        or ""
    )
    uom_name = uom_code
    return str(uom_code or "").strip(), str(uom_name or "").strip()


QUALITY_ITEM_GROUP_PREFIXES = {
    "receiving": "27",
}

def _fetch_business_partners_by_group_names(sap_client, group_names, label):
    safe_filters = [f"Name eq '{name}'" for name in group_names]
    group_result = sap_client._request(
        "GET",
        "BusinessPartnerGroups?$select=Code,Name&$filter=" + " or ".join(safe_filters),
    )
    if group_result.get("error"):
        raise RuntimeError(str(group_result["error"]))

    group_name_by_code = {
        row.get("Code"): row.get("Name")
        for row in group_result.get("value", [])
        if row.get("Code") is not None
    }
    group_codes = list(group_name_by_code.keys())
    if not group_codes:
        return []

    group_filter = " or ".join(f"GroupCode eq {code}" for code in group_codes)
    rows = _fetch_all_sap_pages(
        sap_client,
        (
            "BusinessPartners?$select=CardCode,CardName,CardType,GroupCode,Currency"
            f"&$filter=({group_filter}) and CardType eq 'cSupplier'"
            "&$orderby=CardName"
        ),
        label,
    )
    for row in rows:
        row["GroupName"] = group_name_by_code.get(row.get("GroupCode"), "")
    return rows


def _fetch_all_sap_pages(sap_client, endpoint, label):
    rows = []
    seen_links = set()

    while endpoint:
        if endpoint in seen_links:
            raise RuntimeError(f"SAP {label} pagination repeated the same nextLink")
        seen_links.add(endpoint)

        result = sap_client._request("GET", endpoint)
        if result.get("error"):
            raise RuntimeError(str(result["error"]))

        rows.extend(result.get("value", []))
        endpoint = result.get("@odata.nextLink") or result.get("odata.nextLink")

    return rows


def _item_group_business_sort_key(group):
    import re
    group_name = str(group.get("ItmsGrpNam") or "")
    match = re.search(r"\d+", group_name)
    business_code = int(match.group(0)) if match else 999999999
    return business_code, group_name


def _looks_like_sap_code(value):
    text = str(value or "").strip()
    if not text:
        return False
    if text.isdigit():
        return True
    return bool(re.fullmatch(r"[A-Za-z0-9_.-]+", text))


def _quality_farm_display_name(ins):
    supplier_name = str(ins.supplier_name or "").strip()
    farm_origin = str(ins.farm_origin or "").strip()
    if supplier_name and not _looks_like_sap_code(supplier_name):
        return supplier_name
    if farm_origin and not _looks_like_sap_code(farm_origin):
        return farm_origin
    return supplier_name if supplier_name and supplier_name != farm_origin else ""


def _pending_quality_inspection_to_dict(ins):
    farm_display_name = _quality_farm_display_name(ins)
    return {
        "id": ins.id,
        "batch_number": ins.batch_number,
        "item_code": ins.item_code,
        "item_name": ins.item_name,
        "vendor_card_code": ins.vendor_card_code,
        "vendor_name": ins.vendor_name,
        "supplier_name": ins.supplier_name,
        "farm_origin_code": ins.farm_origin,
        "farm_origin_name": farm_display_name,
        "farm_display_name": farm_display_name,
        "farm_origin": ins.farm_origin,
        "inspector_name": ins.inspector_name,
        "data_clerk_name": ins.data_clerk_name,
        "contractor_name": ins.contractor_name,
        "car_number": ins.car_number,
        "crop_name": ins.crop_name,
        "raw_material_type": ins.raw_material_type,
        "inspection_date": ins.inspection_date.isoformat() if hasattr(ins.inspection_date, 'isoformat') else (str(ins.inspection_date) if ins.inspection_date else None),
        "posting_date": ins.posting_date.isoformat() if hasattr(ins.posting_date, 'isoformat') else (str(ins.posting_date) if ins.posting_date else None),
        "document_date": ins.document_date.isoformat() if hasattr(ins.document_date, 'isoformat') else (str(ins.document_date) if ins.document_date else None),
        "due_date": ins.due_date.isoformat() if hasattr(ins.due_date, 'isoformat') else (str(ins.due_date) if ins.due_date else None),
        "quantity": ins.quantity,
        "uom_code": ins.uom_code,
        "uom_name": ins.uom_name,
        "unit_price": str(ins.unit_price) if ins.unit_price is not None else "",
        "tax_code": ins.tax_code,
        "discount_percent": str(ins.discount_percent) if ins.discount_percent is not None else "",
        "grpo_comments": ins.grpo_comments,
        "batch_quantity": ins.batch_quantity,
        "manufacturing_date": ins.manufacturing_date.isoformat() if hasattr(ins.manufacturing_date, 'isoformat') else (str(ins.manufacturing_date) if ins.manufacturing_date else None),
        "admission_date": ins.admission_date.isoformat() if hasattr(ins.admission_date, 'isoformat') else (str(ins.admission_date) if ins.admission_date else None),
        "expiry_date": ins.expiry_date.isoformat() if hasattr(ins.expiry_date, 'isoformat') else (str(ins.expiry_date) if ins.expiry_date else None),
        "bin_abs_entry": ins.bin_abs_entry,
        "bin_code": ins.bin_code,
        "bin_quantity": ins.bin_quantity,
        "sample_size": ins.sample_size,
        "samples_data": ins.samples_data,
        "notes": ins.notes,
        "total_defects_count": ins.total_defects_count,
        "average_defects_per_sample": ins.average_defects_per_sample,
        "decision": ins.decision,
        "quarantine_violation": ins.quarantine_violation,
        "af_waste_total": ins.af_waste_total,
        "ag_quality_total": ins.ag_quality_total,
        "ah_grand_total": ins.ah_grand_total,
        "combined_bruises_cuts_percentage": ins.combined_bruises_cuts_percentage,
        "high_cut_percentage": ins.high_cut_percentage,
        "status": ins.status,
        "scale_draft_id": ins.scale_draft_id,
        "created_by": ins.created_by.username if ins.created_by else None,
        "reviewed_by": ins.reviewed_by.username if ins.reviewed_by else None,
        "rejection_reason": ins.rejection_reason,
        "sap_doc_entry": ins.sap_doc_entry,
        "sap_doc_num": ins.sap_doc_num,
        "sap_error": ins.sap_error,
        "created_at": ins.created_at.isoformat() if ins.created_at else None,
        "updated_at": ins.updated_at.isoformat() if ins.updated_at else None,
        "reviewed_at": ins.reviewed_at.isoformat() if ins.reviewed_at else None,
        "posted_at": ins.posted_at.isoformat() if ins.posted_at else None,
    }

@api_view(["GET"])
@require_quality_access
def list_pending_inspections(request):
    status_filter = request.query_params.get("status", "PENDING_REVIEW")
    search_query = request.query_params.get("search", "")
    
    queryset = (
        PendingQualityInspection.objects.select_related("created_by", "reviewed_by")
        .exclude(inspector_name="MANUAL")
        .all()
    )
    if status_filter != "ALL":
        queryset = queryset.filter(status=status_filter)
    if search_query:
        queryset = queryset.filter(batch_number__icontains=search_query)
        
    return JsonResponse({
        "success": True,
        "data": {
            "inspections": [_pending_quality_inspection_to_dict(x) for x in queryset]
        }
    })

@api_view(["GET"])
@require_quality_access
def get_quality_inspection_detail(request, inspection_id):
    try:
        ins = PendingQualityInspection.objects.select_related("created_by", "reviewed_by").get(id=inspection_id)
        return JsonResponse({
            "success": True,
            "data": {
                "inspection": _pending_quality_inspection_to_dict(ins)
            }
        })
    except PendingQualityInspection.DoesNotExist:
        return JsonResponse({"success": False, "error": "Inspection report not found"}, status=404)


@api_view(["GET", "POST"])
@require_module_access(PERMISSION_MODULE_GRPO)
@audit_mutation(module=MODULE_GRPO, entity_type="PurchaseGRPODraft", methods=("POST",))
def purchase_grpo_draft_for_inspection(request, inspection_id):
    try:
        inspection = PendingQualityInspection.objects.get(id=inspection_id)
    except PendingQualityInspection.DoesNotExist:
        return JsonResponse({"success": False, "error": "Inspection report not found"}, status=404)

    service = PurchaseGRPODraftService()

    if request.method == "GET":
        draft = service.get_posted_draft(inspection) or service.get_active_draft(inspection)
        if draft:
            draft = service.ensure_draft_uom(draft)
        return JsonResponse({
            "success": True,
            "data": {
                "draft": PurchaseGRPODraftSerializer(draft).data if draft else None
            }
        })

    draft, created = service.get_or_create_draft_from_inspection(inspection, user=request.user)

    return JsonResponse({
        "success": True,
        "created": created,
        "data": {
            "draft": PurchaseGRPODraftSerializer(draft).data
        }
    }, status=201 if created else 200)


@api_view(["GET", "PUT", "PATCH"])
@require_module_access(PERMISSION_MODULE_GRPO)
@audit_mutation(module=MODULE_GRPO, entity_type="PurchaseGRPODraft", action=ACTION_UPDATE)
def purchase_grpo_draft_detail(request, draft_id):
    try:
        draft = PurchaseGRPODraft.objects.select_related(
            "inspection",
            "created_by",
            "updated_by",
            "cancelled_by",
        ).get(id=draft_id)
    except PurchaseGRPODraft.DoesNotExist:
        return JsonResponse({"success": False, "error": "Purchase GRPO draft not found"}, status=404)

    service = PurchaseGRPODraftService()
    draft = service.ensure_draft_batches(service.ensure_draft_uom(draft))

    if request.method == "GET":
        return JsonResponse({
            "success": True,
            "data": {
                "draft": PurchaseGRPODraftSerializer(draft).data
            }
        })

    serializer = PurchaseGRPODraftSerializer(draft, data=request.data, partial=True)
    if not serializer.is_valid():
        return JsonResponse({"success": False, "errors": serializer.errors}, status=400)

    inspection_updates = None
    if getattr(draft.inspection, "inspector_name", None) == "MANUAL":
        inspection_updates = {}
        if "car_number" in request.data:
            inspection_updates["car_number"] = str(request.data.get("car_number") or "").strip()
        elif "container_number" in request.data:
            inspection_updates["car_number"] = str(request.data.get("container_number") or "").strip()
        if "container_quantity" in request.data:
            try:
                inspection_updates["container_quantity"] = int(request.data.get("container_quantity") or 0)
            except (ValueError, TypeError):
                pass
        if "comments" in request.data:
            comments_value = str(request.data.get("comments") or "").strip()
            inspection_updates["notes"] = comments_value
            inspection_updates["grpo_comments"] = comments_value
        if "location" in request.data:
            inspection_updates["location"] = str(request.data.get("location") or "").strip()
        if "general" in request.data:
            inspection_updates["general"] = str(request.data.get("general") or "").strip()
        if "vendor_ref_no" in request.data:
            inspection_updates["vendor_ref_no"] = str(request.data.get("vendor_ref_no") or "").strip()
        if "journal_remark" in request.data:
            inspection_updates["journal_remark"] = str(request.data.get("journal_remark") or "").strip()
        if "unit_price" in request.data:
            inspection_updates["unit_price"] = serializer.validated_data.get("unit_price")
        if "tax_code" in request.data:
            inspection_updates["tax_code"] = serializer.validated_data.get("tax_code", "")

    batches_data = request.data.get("batches") if "batches" in request.data else None

    try:
        updated = service.update_draft(
            draft,
            serializer.validated_data,
            user=request.user,
            inspection_updates=inspection_updates,
            batches=batches_data,
        )
    except PurchaseGRPODraftValidationError as exc:
        return JsonResponse({"success": False, "errors": exc.errors}, status=400)
    except ValueError as exc:
        return JsonResponse({"success": False, "error": str(exc)}, status=400)

    return JsonResponse({
        "success": True,
        "data": {
            "draft": PurchaseGRPODraftSerializer(updated).data
        }
    })


@api_view(["POST"])
@require_module_admin(PERMISSION_MODULE_GRPO)
@audit_mutation(module=MODULE_GRPO, entity_type="PurchaseGRPODraft", action=ACTION_CANCEL, log_success=False)
def cancel_purchase_grpo_draft(request, draft_id):
    try:
        draft = PurchaseGRPODraft.objects.select_related("inspection").get(id=draft_id)
    except PurchaseGRPODraft.DoesNotExist:
        return JsonResponse({"success": False, "error": "Purchase GRPO draft not found"}, status=404)

    service = PurchaseGRPODraftService()
    try:
        cancelled = service.cancel_draft(
            draft,
            user=request.user,
            reason=request.data.get("reason", ""),
        )
    except ValueError as exc:
        return JsonResponse({"success": False, "error": str(exc)}, status=400)

    log_action(
        request=request,
        user=request.user,
        action=ACTION_CANCEL,
        module=MODULE_GRPO,
        entity_type="PurchaseGRPODraft",
        entity_id=str(draft.id),
        description=f"Cancelled GRPO draft #{draft.id}",
        details={"draft_id": draft.id, "reason": request.data.get("reason", "")},
    )
    return JsonResponse({
        "success": True,
        "data": {
            "draft": PurchaseGRPODraftSerializer(cancelled).data
        }
    })


@api_view(["POST"])
@require_module_admin(PERMISSION_MODULE_GRPO)
@audit_mutation(module=MODULE_GRPO, entity_type="PurchaseGRPODraft", action=ACTION_APPROVE, log_success=False)
def approve_purchase_grpo_draft_for_posting(request, draft_id):
    try:
        draft = PurchaseGRPODraft.objects.select_related("inspection").get(id=draft_id)
    except PurchaseGRPODraft.DoesNotExist:
        return JsonResponse({"success": False, "error": "Purchase GRPO draft not found"}, status=404)

    service = PurchaseGRPODraftService()
    try:
        approved = service.approve_for_posting(draft, user=request.user)
    except PurchaseGRPODraftValidationError as exc:
        return JsonResponse({"success": False, "errors": exc.errors}, status=400)
    except ValueError as exc:
        return JsonResponse({"success": False, "error": str(exc)}, status=400)

    data = PurchaseGRPODraftSerializer(approved).data
    log_action(
        request=request,
        user=request.user,
        action=ACTION_APPROVE,
        module=MODULE_GRPO,
        entity_type="PurchaseGRPODraft",
        entity_id=str(draft.id),
        description=f"Approved GRPO draft #{draft.id} for SAP posting",
        details={"vendor_card_code": draft.vendor_card_code, "item_code": draft.item_code},
    )
    return JsonResponse({
        "success": True,
        "data": {
            "draft": data
        }
    })


@api_view(["POST"])
@require_module_access(PERMISSION_MODULE_GRPO)
def prepare_purchase_grpo_posting(request, draft_id):
    try:
        draft = PurchaseGRPODraft.objects.select_related("inspection").get(id=draft_id)
    except PurchaseGRPODraft.DoesNotExist:
        return JsonResponse({"success": False, "error": "Purchase GRPO draft not found"}, status=404)

    verify_with_sap = str(request.query_params.get("verify_sap", "")).strip().lower() in {
        "1",
        "true",
        "yes",
    }
    service = PurchaseGRPOPostingPreparationService()
    try:
        preview = service.prepare_preview(draft, verify_with_sap=verify_with_sap, user=request.user)
    except PurchaseGRPOPostingStateError as exc:
        return JsonResponse({"success": False, "error": str(exc)}, status=400)
    except PurchaseGRPOPayloadValidationError as exc:
        return JsonResponse({"success": False, "errors": exc.errors}, status=400)

    return JsonResponse({
        "success": True,
        "data": preview
    })


@api_view(["POST"])
@require_module_access(PERMISSION_MODULE_GRPO)
@audit_mutation(module=MODULE_GRPO, entity_type="PurchaseGRPODraft", action=ACTION_POST, log_success=False)
def post_purchase_grpo_draft_to_sap(request, draft_id):
    try:
        draft = PurchaseGRPODraft.objects.select_related("inspection").get(id=draft_id)
    except PurchaseGRPODraft.DoesNotExist:
        return JsonResponse({"success": False, "error": "Purchase GRPO draft not found"}, status=404)

    if draft.status == PurchaseGRPODraft.POSTED:
        return JsonResponse({
            "success": False,
            "error": "Posted Purchase GRPO drafts cannot be posted to SAP again.",
            "data": {
                "draft": PurchaseGRPODraftSerializer(draft).data,
            },
        }, status=400)

    try:
        service = PurchaseGRPODraftService()
        service.ensure_draft_batches(draft)
        service.validate_draft_for_save(draft)
        if not draft.batch_quantity and draft.quantity:
            draft.batch_quantity = draft.quantity
        if not draft.bin_quantity and draft.quantity and (draft.bin_abs_entry or draft.bin_code):
            draft.bin_quantity = draft.quantity
        payload = PurchaseGRPOPayloadBuilder().build(draft)
        posted = PurchaseGRPOPostingService().post(draft, payload, user=request.user)
        log_action(
            request=request,
            user=request.user,
            action=ACTION_POST,
            module=MODULE_GRPO,
            entity_type="PurchaseGRPODraft",
            entity_id=str(draft.id),
            description=f"Posted GRPO draft #{draft.id} to SAP (#{draft.sap_doc_num})",
            details={
                "sap_doc_num": draft.sap_doc_num,
                "sap_doc_entry": draft.sap_doc_entry,
                "vendor_card_code": draft.vendor_card_code,
                "item_code": draft.item_code,
            },
        )
    except PurchaseGRPODraftValidationError as exc:
        return JsonResponse({"success": False, "errors": exc.errors}, status=400)
    except PurchaseGRPOPostingStateError as exc:
        return JsonResponse({"success": False, "error": str(exc)}, status=400)
    except PurchaseGRPOPayloadValidationError as exc:
        return JsonResponse({"success": False, "errors": exc.errors}, status=400)
    except PurchaseGRPOPostingError as exc:
        latest = PurchaseGRPODraft.objects.filter(id=draft_id).first()
        latest_data = PurchaseGRPODraftSerializer(latest).data if latest else None
        return JsonResponse({
            "success": False,
            "error": str(exc),
            "data": {
                "draft": latest_data,
                "sap_response": exc.response,
            }
        }, status=400)

    posted_data = PurchaseGRPODraftSerializer(posted).data
    return JsonResponse({
        "success": True,
        "data": {
            "draft": posted_data,
            "payload": posted.sap_payload_snapshot,
            "sap_response": posted.sap_response_snapshot,
            "sap_doc_entry": posted.sap_doc_entry,
            "sap_doc_num": posted.sap_doc_num,
        }
    })

def _generate_unique_batch_number(item_code):
    import re
    item_code_clean = str(item_code or "").strip().upper()
    if not item_code_clean:
        item_code_clean = "UNKNOWN"
        
    with transaction.atomic():
        seq_obj, created = QualityItemSequence.objects.select_for_update().get_or_create(
            item_code=item_code_clean,
            defaults={'last_sequence': 0}
        )
        
        max_seq = seq_obj.last_sequence
        prefix = f"{item_code_clean}-"
        
        # Check existing inspection batch numbers to ensure we do not conflict
        existing_batches = PendingQualityInspection.objects.filter(
            item_code=item_code_clean,
            batch_number__startswith=prefix
        ).values_list('batch_number', flat=True)
        
        pattern = re.compile(rf'^{re.escape(item_code_clean)}-(\d+)$')
        for b in existing_batches:
            m = pattern.match(b)
            if m:
                try:
                    val = int(m.group(1))
                    if val > max_seq:
                        max_seq = val
                except ValueError:
                    pass
                    
        next_seq = max_seq + 1
        seq_obj.last_sequence = next_seq
        seq_obj.save()
        
        # Format: <ItemCode>-<Sequence> (4-digit padded, e.g. APPLE-0001)
        return f"{item_code_clean}-{next_seq:04d}"

@api_view(["POST"])
@require_quality_access
@audit_mutation(module=MODULE_QUALITY, entity_type="PendingQualityInspection", action=ACTION_CREATE, log_success=False)
def create_quality_inspection(request):
    data = request.data
    
    metadata = data.get("metadata", {})
    samples_data = data.get("samples_data", [])
    sample_size = int(data.get("sample_size", len(samples_data)))
    try:
        total_quantity = float(metadata.get("quantity", 0.0) or 0.0)
    except (TypeError, ValueError):
        return JsonResponse({"success": False, "error": "Total Quantity must be a valid number."}, status=400)
    uom_code = str(metadata.get("uom_code") or metadata.get("uom") or "").strip()
    uom_name = str(metadata.get("uom_name") or uom_code or "").strip()
    raw_unit_price = metadata.get("unit_price", None)
    unit_price = None
    if raw_unit_price not in (None, ""):
        try:
            from decimal import Decimal, InvalidOperation
            unit_price = Decimal(str(raw_unit_price))
        except (InvalidOperation, TypeError, ValueError):
            return JsonResponse({"success": False, "error": "Unit Price must be a valid number."}, status=400)
        if not unit_price.is_finite():
            return JsonResponse({"success": False, "error": "Unit Price must be a valid number."}, status=400)
    discount_percent, discount_error = _parse_optional_decimal(metadata.get("discount_percent"), "Discount Percent")
    if discount_error:
        return JsonResponse({"success": False, "error": discount_error}, status=400)
    batch_quantity = total_quantity
    bin_selected = bool(str(metadata.get("bin_abs_entry") or metadata.get("bin_code") or "").strip())
    bin_quantity = total_quantity if bin_selected else 0.0
    
    from .services.sap_service import SAPServiceLayer
    from .services.quality_service import QualityInspectionService
    
    sap_client = SAPServiceLayer()
    service = QualityInspectionService(sap_client)
    
    metrics = service.calculate_inspection_metrics(sample_size, samples_data)
    
    # Parse inspection date safely
    insp_date = metadata.get("inspection_date")
    if not insp_date or insp_date == "":
        insp_date = timezone.now().date().isoformat()
    posting_date = _normalize_optional_date(metadata.get("posting_date"))
    document_date = _normalize_optional_date(metadata.get("document_date"))
    due_date = _normalize_optional_date(metadata.get("due_date"))

    raw_scale_draft_id = metadata.get("scale_draft_id") or data.get("scale_draft_id")
    scale_draft_id = None
    if raw_scale_draft_id not in (None, ""):
        try:
            scale_draft_id = int(raw_scale_draft_id)
        except (TypeError, ValueError):
            return JsonResponse({"success": False, "error": "Scale draft id must be a valid integer."}, status=400)
        if scale_draft_id <= 0:
            return JsonResponse({"success": False, "error": "Scale draft id must be a valid integer."}, status=400)

    def create_inspection_record(scale_draft=None):
        if scale_draft and scale_draft.draft_number:
            batch_number = scale_draft.draft_number
        else:
            # Auto-generate batch number if empty, null, or set to a placeholder
            batch_number = metadata.get("batch_number", "")
            if not batch_number or str(batch_number).strip().lower() == "pending..." or str(batch_number).strip().lower().startswith("pending"):
                batch_number = _generate_unique_batch_number(metadata.get("item_code", ""))

        return PendingQualityInspection.objects.create(
            batch_number=batch_number,
            item_code=metadata.get("item_code", ""),
            item_name=metadata.get("item_name", ""),
            vendor_card_code=metadata.get("vendor_card_code") or metadata.get("sap_vendor_code") or metadata.get("farm_origin", ""),
            vendor_name=metadata.get("vendor_name") or metadata.get("supplier_name", ""),
            supplier_name=metadata.get("supplier_name", ""),
            farm_origin=metadata.get("farm_origin", ""),
            inspector_name=metadata.get("inspector_name", ""),
            data_clerk_name=metadata.get("data_clerk_name", ""),
            contractor_name=metadata.get("contractor_name", ""),
            car_number=metadata.get("car_number", ""),
            crop_name=metadata.get("crop_name", ""),
            raw_material_type=metadata.get("raw_material_type", ""),
            inspection_date=insp_date,
            posting_date=posting_date,
            document_date=document_date,
            due_date=due_date,
            warehouse_code=metadata.get("warehouse_code", metadata.get("warehouse", "")),
            quantity=total_quantity,
            uom_code=uom_code,
            uom_name=uom_name,
            unit_price=unit_price,
            tax_code=metadata.get("tax_code", ""),
            discount_percent=discount_percent,
            grpo_comments=metadata.get("grpo_comments", ""),
            batch_quantity=batch_quantity,
            manufacturing_date=_normalize_optional_date(metadata.get("manufacturing_date")),
            admission_date=_normalize_optional_date(metadata.get("admission_date")),
            expiry_date=_normalize_optional_date(metadata.get("expiry_date")),
            bin_abs_entry=metadata.get("bin_abs_entry", ""),
            bin_code=metadata.get("bin_code", ""),
            bin_quantity=bin_quantity,
            sample_size=sample_size,
            samples_data=samples_data,
            notes=metadata.get("notes", ""),
            total_defects_count=metrics['sum_ah'],
            average_defects_per_sample=metrics['average_defects_per_sample'],
            decision=metrics['decision'],
            quarantine_violation=metrics['quarantine_violation'],
            af_waste_total=metrics['sum_af'],
            ag_quality_total=metrics['sum_ag'],
            ah_grand_total=metrics['sum_ah'],
            combined_bruises_cuts_percentage=metrics['combined_bruises_cuts_percentage'],
            high_cut_percentage=metrics['high_cut_percentage'],
            status=PendingQualityInspection.PENDING_REVIEW,
            created_by=request.user,
            scale_draft=scale_draft,
        )

    if scale_draft_id:
        from scale.models import ScaleDraft
        try:
            with transaction.atomic():
                scale_draft = ScaleDraft.objects.select_for_update().get(id=scale_draft_id)
                if (
                    not scale_draft.is_closed
                    or not scale_draft.product_weight
                    or scale_draft.product_weight <= 0
                    or scale_draft.status not in {ScaleDraft.STATUS_COMPLETED, ScaleDraft.STATUS_SENT_TO_QUALITY}
                ):
                    return JsonResponse({"success": False, "error": "Scale draft is not ready for quality inspection."}, status=400)
                if PendingQualityInspection.objects.filter(scale_draft=scale_draft).exists():
                    return JsonResponse({"success": False, "error": "Quality inspection already exists for this scale draft."}, status=400)
                ins = create_inspection_record(scale_draft=scale_draft)
        except ScaleDraft.DoesNotExist:
            return JsonResponse({"success": False, "error": "Scale draft not found."}, status=400)
    else:
        ins = create_inspection_record()
    
    log_action(
        request=request,
        user=request.user,
        action=ACTION_CREATE,
        module=MODULE_QUALITY,
        entity_type="PendingQualityInspection",
        entity_id=str(ins.id),
        description=f"Created quality inspection report #{ins.id} ({ins.item_code})",
        details={
            "batch_number": ins.batch_number,
            "item_code": ins.item_code,
            "stage": getattr(getattr(ins, "stage", None), "name_en", ""),
            "total_quantity": float(getattr(ins, "quantity", 0.0) or 0.0),
        },
    )
    return JsonResponse({
        "success": True,
        "data": {
            "inspection": _pending_quality_inspection_to_dict(ins)
        }
    })


@api_view(["POST"])
@require_quality_admin_access
@audit_mutation(module=MODULE_QUALITY, entity_type="PendingQualityInspection", action=ACTION_APPROVE, log_success=False)
def approve_post_quality_inspection(request, inspection_id):
    try:
        ins = PendingQualityInspection.objects.get(id=inspection_id)
    except PendingQualityInspection.DoesNotExist:
        return JsonResponse({"success": False, "error": "Inspection report not found"}, status=404)
        
    if ins.status == PendingQualityInspection.POSTED:
        return JsonResponse({"success": False, "error": "This inspection report has already been posted to SAP"}, status=400)
    if ins.status == PendingQualityInspection.REJECTED:
        return JsonResponse({"success": False, "error": "This inspection report has been rejected and cannot be posted"}, status=400)
        
    target_warehouse = request.data.get("target_warehouse")
    
    from .services.sap_service import SAPServiceLayer
    from .services.quality_service import QualityInspectionService
    
    sap_client = SAPServiceLayer()
    service = QualityInspectionService(sap_client)
    
    try:
        service.post_inspection_to_sap(ins, target_warehouse=target_warehouse)
        ins.reviewed_by = request.user
        ins.reviewed_at = timezone.now()
        ins.save()
        log_action(
            request=request,
            user=request.user,
            action=ACTION_APPROVE,
            module=MODULE_QUALITY,
            entity_type="PendingQualityInspection",
            entity_id=str(ins.id),
            description=f"Approved quality inspection #{ins.id} and posted to SAP (#{ins.sap_doc_num})",
            details={
                "batch_number": ins.batch_number,
                "item_code": ins.item_code,
                "sap_doc_num": ins.sap_doc_num,
                "target_warehouse": target_warehouse,
            },
        )
        return JsonResponse({
            "success": True,
            "data": {
                "inspection": _pending_quality_inspection_to_dict(ins)
            }
        })
    except Exception as e:
        ins.sap_error = str(e)
        ins.status = PendingQualityInspection.FAILED
        ins.save()
        return JsonResponse({"success": False, "error": f"Failed posting to SAP: {e}"}, status=400)

@api_view(["POST"])
@require_quality_admin_access
@audit_mutation(module=MODULE_QUALITY, entity_type="PendingQualityInspection", action=ACTION_REJECT, log_success=False)
def reject_quality_inspection(request, inspection_id):
    try:
        ins = PendingQualityInspection.objects.get(id=inspection_id)
    except PendingQualityInspection.DoesNotExist:
        return JsonResponse({"success": False, "error": "Inspection report not found"}, status=404)
        
    reason = request.data.get("reason", "")
    ins.status = PendingQualityInspection.REJECTED
    ins.rejection_reason = reason
    ins.reviewed_by = request.user
    ins.reviewed_at = timezone.now()
    ins.save()
    
    log_action(
        request=request,
        user=request.user,
        action=ACTION_REJECT,
        module=MODULE_QUALITY,
        entity_type="PendingQualityInspection",
        entity_id=str(ins.id),
        description=f"Rejected quality inspection #{ins.id}",
        details={"batch_number": ins.batch_number, "reason": reason},
    )

    return JsonResponse({
        "success": True,
        "data": {
            "inspection": _pending_quality_inspection_to_dict(ins)
        }
    })


def _delete_quality_inspection_with_grpo_drafts(ins):
    drafts_qs = PurchaseGRPODraft.objects.select_for_update().filter(inspection=ins)
    if drafts_qs.filter(status=PurchaseGRPODraft.POSTED).exists():
        return False, "Inspection report cannot be deleted because its linked Purchase GRPO has already been posted to SAP."

    drafts_qs.exclude(status=PurchaseGRPODraft.POSTED).delete()
    ins.delete()
    return True, None


@api_view(["DELETE", "POST"])
@require_quality_admin_access
@audit_mutation(module=MODULE_QUALITY, entity_type="PendingQualityInspection", action=ACTION_DELETE, log_success=False)
def delete_quality_inspection(request, inspection_id):
    try:
        with transaction.atomic():
            ins = PendingQualityInspection.objects.select_for_update().get(id=inspection_id)
            if ins.status == PendingQualityInspection.POSTED:
                return JsonResponse({"success": False, "error": "Posted inspections cannot be deleted."}, status=400)

            deleted, error = _delete_quality_inspection_with_grpo_drafts(ins)
            if not deleted:
                return JsonResponse({"success": False, "error": error}, status=400)

        log_action(
            request=request,
            user=request.user,
            action=ACTION_DELETE,
            module=MODULE_QUALITY,
            entity_type="PendingQualityInspection",
            entity_id=str(inspection_id),
            description=f"Deleted quality inspection report #{inspection_id}",
            details={},
        )
        return JsonResponse({"success": True, "message": "Inspection report deleted successfully"})
    except PendingQualityInspection.DoesNotExist:
        return JsonResponse({"success": False, "error": "Inspection report not found"}, status=404)
    except ProtectedError:
        return JsonResponse({
            "success": False,
            "error": "Inspection report cannot be deleted because it is referenced by related records.",
        }, status=400)
    except Exception as e:
        return JsonResponse({"success": False, "error": str(e)}, status=500)

@api_view(["POST"])
@require_quality_admin_access
@audit_mutation(module=MODULE_QUALITY, entity_type="PendingQualityInspectionBulk", action=ACTION_APPROVE)
def approve_quality_inspection_bulk(request):
    ids = request.data.get("ids", [])
    if not isinstance(ids, list):
        return JsonResponse({"success": False, "error": "Invalid IDs format"}, status=400)
        
    success_count = 0
    failed_count = 0
    skipped_count = 0
    errors = []
    
    target_warehouse = request.data.get("target_warehouse")
    
    from .services.sap_service import SAPServiceLayer
    from .services.quality_service import QualityInspectionService
    
    sap_client = SAPServiceLayer()
    service = QualityInspectionService(sap_client)
    
    for inspection_id in ids:
        try:
            ins = PendingQualityInspection.objects.get(id=inspection_id)
        except PendingQualityInspection.DoesNotExist:
            skipped_count += 1
            errors.append(f"Inspection #{inspection_id} not found")
            continue
            
        if ins.status == PendingQualityInspection.POSTED:
            skipped_count += 1
            continue
        if ins.status == PendingQualityInspection.REJECTED:
            skipped_count += 1
            errors.append(f"Inspection #{inspection_id} is rejected")
            continue
            
        try:
            service.post_inspection_to_sap(ins, target_warehouse=target_warehouse)
            ins.reviewed_by = request.user
            ins.reviewed_at = timezone.now()
            ins.save()
            success_count += 1
        except Exception as e:
            ins.sap_error = str(e)
            ins.save()
            failed_count += 1
            errors.append(f"Inspection #{inspection_id} failed: {str(e)}")
            
    return JsonResponse({
        "success": True,
        "success_count": success_count,
        "failed_count": failed_count,
        "skipped_count": skipped_count,
        "errors": errors
    })

@api_view(["POST"])
@require_quality_admin_access
@audit_mutation(module=MODULE_QUALITY, entity_type="PendingQualityInspectionBulk", action=ACTION_DELETE)
def delete_quality_inspection_bulk(request):
    ids = request.data.get("ids", [])
    if not isinstance(ids, list):
        return JsonResponse({"success": False, "error": "Invalid IDs format"}, status=400)
        
    success_count = 0
    failed_count = 0
    skipped_count = 0
    errors = []
    
    for inspection_id in ids:
        try:
            with transaction.atomic():
                ins = PendingQualityInspection.objects.select_for_update().get(id=inspection_id)

                if ins.status == PendingQualityInspection.POSTED:
                    skipped_count += 1
                    errors.append(f"Inspection #{inspection_id} is already posted to SAP")
                    continue

                deleted, error = _delete_quality_inspection_with_grpo_drafts(ins)
                if not deleted:
                    skipped_count += 1
                    errors.append(f"Inspection #{inspection_id}: {error}")
                    continue

                success_count += 1
        except PendingQualityInspection.DoesNotExist:
            skipped_count += 1
            errors.append(f"Inspection #{inspection_id} not found")
            continue
        except Exception as e:
            failed_count += 1
            errors.append(f"Inspection #{inspection_id} failed to delete: {str(e)}")
            
    return JsonResponse({
        "success": True,
        "success_count": success_count,
        "failed_count": failed_count,
        "skipped_count": skipped_count,
        "errors": errors
    })

@api_view(["GET"])
@require_any_module_access(PERMISSION_MODULE_QUALITY, PERMISSION_MODULE_GRPO)
def get_quality_batch_details(request, batch_number):
    requested_batch = str(batch_number or "").strip()
    normalized_batch = requested_batch.replace(" ", "").upper()
    
    local_match_found = False
    parent_receipt_status = None
    sap_lookup_executed = False

    try:
        # 1. Search in local pending receipt batches first
        from .models import PendingReceiptBatch
        local_batches = (
            PendingReceiptBatch.objects
            .filter(batch_number__iexact=normalized_batch)
            .select_related('pending_receipt')
            .order_by('-id')
        )
        
        if local_batches.exists():
            local_match_found = True
            local_b = local_batches[0]
            parent_receipt_status = local_b.pending_receipt.status if local_b.pending_receipt else None
            
            item_code = local_b.pending_receipt.item_code if local_b.pending_receipt else ""
            item_name = local_b.pending_receipt.item_name if local_b.pending_receipt else ""
            uom_code = local_b.uom_entry or (local_b.pending_receipt.uom_entry if local_b.pending_receipt else "")
            uom_name = local_b.uom_label or (local_b.pending_receipt.uom_label if local_b.pending_receipt else "") or uom_code
            
            if not item_name and item_code:
                try:
                    inspect_match = PendingQualityInspection.objects.filter(item_code=item_code).exclude(item_name="").exclude(item_name__isnull=True).order_by("-id").first()
                    if inspect_match:
                        item_name = inspect_match.item_name
                except Exception:
                    pass
            
            if item_code and (not item_name or not uom_code):
                try:
                    from .services.sap_service import SAPServiceLayer
                    sap_client = SAPServiceLayer()
                    item_res = sap_client._request("GET", f"Items('{item_code}')")
                    item_name = item_name or item_res.get("ItemName", "")
                    fallback_uom_code, fallback_uom_name = _get_item_uom_fields(item_res)
                    uom_code = uom_code or fallback_uom_code
                    uom_name = uom_name or fallback_uom_name
                except Exception:
                    pass
            
            return JsonResponse({
                "success": True,
                "batch": {
                    "batch_number": local_b.batch_number,
                    "item_code": item_code,
                    "item_name": item_name,
                    "quantity": local_b.quantity,
                    "warehouse": local_b.pending_receipt.warehouse_code if local_b.pending_receipt else "",
                    "uom_code": uom_code,
                    "uom_name": uom_name,
                    "supplier_name": local_b.vendor or "",
                    "farm_origin": local_b.brand or "",
                    "crop_name": item_name,
                    "raw_material_type": local_b.category or "",
                    "batch_quantity": local_b.quantity,
                    "manufacturing_date": local_b.mfr_date or "",
                    "admission_date": local_b.admission_date or "",
                    "expiry_date": "",
                    "bin_abs_entry": local_b.bin_abs_entry or "",
                    "bin_code": local_b.bin_location or "",
                    "bin_quantity": local_b.quantity if local_b.bin_abs_entry or local_b.bin_location else 0,
                }
            })
            
    except Exception:
        pass

    # 2. If local lookup did not find anything, fallback to SAP
    try:
        sap_lookup_executed = True
        from .services.sap_service import SAPServiceLayer
        sap_client = SAPServiceLayer()
        safe_batch = requested_batch.replace("'", "''")
        endpoint = f"BatchNumbers?$filter=BatchNumber eq '{safe_batch}'"
        result = sap_client._request("GET", endpoint)
        batches = result.get("value", [])
        
        if batches:
            batch = batches[0]
            item_code = batch.get("ItemCode", "")
            item_name = batch.get("ItemDescription", "")
            uom_code = batch.get("UoMCode") or batch.get("U_UOM") or ""
            uom_name = uom_code
            if item_code and (not item_name or not uom_code):
                try:
                    item_res = sap_client._request("GET", f"Items('{item_code}')")
                    item_name = item_name or item_res.get("ItemName", "")
                    fallback_uom_code, fallback_uom_name = _get_item_uom_fields(item_res)
                    uom_code = uom_code or fallback_uom_code
                    uom_name = fallback_uom_name or uom_name
                except Exception:
                    pass
                    
            return JsonResponse({
                "success": True,
                "batch": {
                    "batch_number": batch.get("BatchNumber"),
                    "item_code": item_code,
                    "item_name": item_name,
                    "quantity": batch.get("Quantity", 0),
                    "warehouse": batch.get("Warehouse", ""),
                    "uom_code": uom_code,
                    "uom_name": uom_name,
                    "supplier_name": batch.get("VendorCode") or batch.get("U_vendor") or "",
                    "farm_origin": batch.get("U_Brand") or "",
                    "crop_name": item_name,
                    "raw_material_type": batch.get("U_Category") or "",
                    "batch_quantity": batch.get("Quantity", 0),
                    "manufacturing_date": batch.get("ManufacturingDate") or "",
                    "admission_date": batch.get("AddmisionDate") or batch.get("AdmissionDate") or "",
                    "expiry_date": batch.get("ExpiryDate") or "",
                    "bin_abs_entry": batch.get("BinAbsEntry") or "",
                    "bin_code": batch.get("BinCode") or "",
                    "bin_quantity": batch.get("Quantity", 0) if batch.get("BinAbsEntry") or batch.get("BinCode") else 0,
                }
            })
    except Exception:
        pass

    return JsonResponse({"success": True, "batch": None})


@api_view(["GET"])
@require_any_module_access(PERMISSION_MODULE_QUALITY, PERMISSION_MODULE_GRPO, PERMISSION_MODULE_PURCHASE_QUOTATION)
def list_quality_item_groups(request):
    """Return the SAP item groups assigned to the requested Quality workflow."""
    workflow = request.query_params.get("workflow", "").strip().lower()
    group_prefix = QUALITY_ITEM_GROUP_PREFIXES.get(workflow)
    if not group_prefix:
        return JsonResponse(
            {
                "success": False,
                "item_groups": [],
                "error": "workflow must be 'receiving'",
            },
            status=400,
        )

    try:
        cache_key = build_cache_key("sap:item-groups", workflow)

        def load_groups():
            from .services.sap_service import SAPServiceLayer
            sap_client = SAPServiceLayer()

            item_group_rows = _fetch_all_sap_pages(
                sap_client,
                f"ItemGroups?$select=Number,GroupName&$filter=contains(GroupName, '{group_prefix}')",
                "ItemGroups",
            )
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

                if group_prefix and group_prefix not in normalized_group_name:
                    continue
                groups.append({"ItmsGrpCod": group_code, "ItmsGrpNam": normalized_group_name})

            groups.sort(key=_item_group_business_sort_key)
            return groups

        cached_groups = cache_get(cache_key)
        groups = cached_groups if cached_groups else None
        if groups is None:
            groups = load_groups()
            if groups:
                cache_set("sap:item-groups", cache_key, groups, "sap_item_groups")
        return JsonResponse({"success": True, "item_groups": groups})
    except Exception as e:
        return JsonResponse({"success": False, "item_groups": [], "error": str(e)}, status=500)


@api_view(["GET"])
@require_any_module_access(PERMISSION_MODULE_QUALITY, PERMISSION_MODULE_GRPO, PERMISSION_MODULE_PURCHASE_QUOTATION)
def list_quality_contractors(request):
    from api.services.master_data_search import is_lookup, lookup_response
    if is_lookup(request):
        from api.services.sap_service import SAPServiceLayer
        return lookup_response(request, SAPServiceLayer(), "contractors", "contractors")
    cache_key = build_cache_key("sap:contractors", "quality")
    cached_contractors = cache_get(cache_key)
    if cached_contractors is not None:
        return JsonResponse({"success": True, "contractors": cached_contractors})

    try:
        from .services.sap_service import SAPServiceLayer
        sap_client = SAPServiceLayer()

        rows = _fetch_business_partners_by_group_names(
            sap_client,
            ["مقاول عمال"],
            "quality contractors",
        )
        contractors = []
        for row in rows:
            contractor_code = _get_case_insensitive(row, "CardCode")
            contractor_name = _get_case_insensitive(row, "CardName") or contractor_code
            if contractor_code:
                contractors.append({
                    "contractorCode": contractor_code,
                    "contractorName": contractor_name,
                })
        cache_set("sap:contractors", cache_key, contractors, "sap_contractors")
        return JsonResponse({"success": True, "contractors": contractors})
    except Exception as e:
        return JsonResponse({"success": False, "contractors": [], "error": str(e)})


@api_view(["GET"])
@require_any_module_access(PERMISSION_MODULE_QUALITY, PERMISSION_MODULE_GRPO, PERMISSION_MODULE_PURCHASE_QUOTATION)
def list_quality_farms(request):
    from api.services.master_data_search import is_lookup, lookup_response
    if is_lookup(request):
        from api.services.sap_service import SAPServiceLayer
        return lookup_response(request, SAPServiceLayer(), "farms", "farms")
    cache_key = build_cache_key("sap:farms", "quality", "currency-v2")
    cached_farms = cache_get(cache_key)
    if cached_farms is not None:
        return JsonResponse({"success": True, "farms": cached_farms})

    try:
        from .services.sap_service import SAPServiceLayer
        sap_client = SAPServiceLayer()

        sql_code = "CODX_QUALITY_FARMS"
        sql_text = """
SELECT
    T0."CardCode",
    T0."CardName",
    T0."Currency"
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
                "quality farms",
            )

        farms = []
        for row in rows:
            farm_code = _get_case_insensitive(row, "CardCode")
            farm_name = _get_case_insensitive(row, "CardName") or farm_code
            group_name = _get_case_insensitive(row, "GroupName") or ""
            currency = _get_case_insensitive(row, "Currency") or ""
            if farm_code:
                farms.append({
                    "farmCode": farm_code,
                    "farmName": farm_name,
                    "GroupName": group_name,
                    "currency": currency,
                })
        cache_set("sap:farms", cache_key, farms, "sap_farms")
        return JsonResponse({"success": True, "farms": farms})
    except Exception as e:
        return JsonResponse({"success": False, "farms": [], "error": str(e)})


@api_view(["GET"])
@require_any_module_access(PERMISSION_MODULE_QUALITY, PERMISSION_MODULE_GRPO, PERMISSION_MODULE_PURCHASE_QUOTATION)
def list_quality_items(request):
    from api.services.master_data_search import is_lookup, lookup_response
    if is_lookup(request):
        from api.services.sap_service import SAPServiceLayer
        return lookup_response(request, SAPServiceLayer(), "items", "items")
    search_query = request.query_params.get("search", "").strip()
    item_group_code = request.query_params.get("item_group_code", "").strip()

    if item_group_code:
        try:
            group_code = int(item_group_code)
        except (TypeError, ValueError):
            return JsonResponse({"success": False, "items": [], "error": "Invalid item_group_code"}, status=400)

        cache_key = build_cache_key("sap:items", "group", group_code, "inventory-uom-v3", search=search_query)
        cached_items = cache_get(cache_key)
        if cached_items is not None:
            return JsonResponse({"success": True, "items": cached_items})

        try:
            from .services.sap_service import SAPServiceLayer
            sap_client = SAPServiceLayer()
            filters = [f"ItemsGroupCode eq {group_code}"]
            if search_query:
                safe_search = search_query.replace("'", "''")
                filters.append(f"(contains(ItemCode, '{safe_search}') or contains(ItemName, '{safe_search}'))")
            endpoint = (
                "Items?$select=ItemCode,ItemName,ItemsGroupCode,InventoryUOM"
                f"&$filter={' and '.join(filters)}&$orderby=ItemName"
            )
            rows = _fetch_all_sap_pages(sap_client, endpoint, "Items")
            items = []
            for item in rows:
                item_code = _get_case_insensitive(item, "ItemCode")
                if not item_code:
                    continue
                uom_code, uom_name = _get_item_uom_fields(item)
                items.append({
                    "item_code": item_code,
                    "item_name": _get_case_insensitive(item, "ItemName") or item_code,
                    "farm_origin": _get_case_insensitive(item, "U_Brand") or "",
                    "raw_material_type": _get_case_insensitive(item, "U_Category") or "",
                    "uom_code": uom_code,
                    "uom_name": uom_name,
                })
            items.sort(key=lambda item: str(item["item_name"] or "").strip())
            cache_set("sap:items", cache_key, items, "sap_items")
            return JsonResponse({"success": True, "items": items})
        except Exception as exc:
            return JsonResponse({"success": False, "items": [], "error": str(exc)}, status=500)
    
    # If search query is provided, search SAP items catalog
    if search_query:
        cache_key = build_cache_key("sap:items", "search", "inventory-uom-v3", search=search_query)
        cached_items = cache_get(cache_key)
        if cached_items is not None:
            return JsonResponse({"success": True, "items": cached_items})

        try:
            from .services.sap_service import SAPServiceLayer
            sap_client = SAPServiceLayer()
            safe_search = search_query.replace("'", "''")
            endpoint = f"Items?$select=ItemCode,ItemName,InventoryUOM&$filter=(contains(ItemCode, '{safe_search}') or contains(ItemName, '{safe_search}'))&$top=50"
            items = _fetch_all_sap_pages(sap_client, endpoint, "Items")
            data = []
            for item in items:
                item_code = _get_case_insensitive(item, "ItemCode") or _get_case_insensitive(item, "item_code")
                item_name = _get_case_insensitive(item, "ItemName") or _get_case_insensitive(item, "item_name") or item_code
                farm_origin = _get_case_insensitive(item, "U_Brand") or _get_case_insensitive(item, "farm_origin") or ""
                raw_material_type = _get_case_insensitive(item, "U_Category") or _get_case_insensitive(item, "raw_material_type") or ""
                uom_code, uom_name = _get_item_uom_fields(item)
                data.append({
                    "item_code": item_code,
                    "item_name": item_name,
                    "farm_origin": farm_origin,
                    "raw_material_type": raw_material_type,
                    "uom_code": uom_code,
                    "uom_name": uom_name
                })
            cache_set("sap:items", cache_key, data, "sap_items")
            return JsonResponse({"success": True, "items": data})
        except Exception:
            return JsonResponse({"success": True, "items": []})
            
    # Default: get items from open production orders
    cache_key = build_cache_key("sap:items", "open-production-orders", "uom-v1")
    cached_items = cache_get(cache_key)
    if cached_items is not None:
        return JsonResponse({"success": True, "items": cached_items})

    try:
        from .services.sap_service import SAPServiceLayer
        sap_client = SAPServiceLayer()
        rows = sap_client.get_open_production_orders()
        items = []
        seen = set()
        for row in rows:
            item_code = _get_case_insensitive(row, "item_code") or _get_case_insensitive(row, "ItemCode")
            item_name = _get_case_insensitive(row, "item_name") or _get_case_insensitive(row, "ItemName") or item_code
            if not item_code or item_code in seen:
                continue
            seen.add(item_code)
            farm_origin = _get_case_insensitive(row, "farm_origin") or _get_case_insensitive(row, "U_Brand") or ""
            raw_material_type = _get_case_insensitive(row, "raw_material_type") or _get_case_insensitive(row, "U_Category") or ""
            uom_code, uom_name = _get_item_uom_fields(row)
            
            items.append({
                "item_code": item_code,
                "item_name": item_name,
                "farm_origin": farm_origin,
                "raw_material_type": raw_material_type,
                "uom_code": uom_code,
                "uom_name": uom_name
            })
            
        cache_set("sap:items", cache_key, items, "sap_items")
        return JsonResponse({"success": True, "items": items})
    except Exception:
        # Fallback to local PendingReceiptBatch unique items
        try:
            from .models import PendingReceiptBatch, PendingReceipt
            # Build helper name_map from previous inspections and receipts
            name_map = {}
            local_inspections = PendingQualityInspection.objects.exclude(item_name="").exclude(item_name__isnull=True).values("item_code", "item_name")
            for ins in local_inspections:
                code = ins["item_code"]
                if code and code not in name_map:
                    name_map[code] = ins["item_name"]
            
            local_receipts = PendingReceipt.objects.exclude(item_name="").exclude(item_name__isnull=True).values("item_code", "item_name")
            for rec in local_receipts:
                code = rec["item_code"]
                if code and code not in name_map:
                    name_map[code] = rec["item_name"]

            local_batches = PendingReceiptBatch.objects.select_related('pending_receipt').all().order_by('-id')[:200]
            seen = set()
            items = []
            for b in local_batches:
                if not b.pending_receipt:
                    continue
                code = b.pending_receipt.item_code
                if not code or code in seen:
                    continue
                seen.add(code)
                
                descr_name = name_map.get(code) or b.pending_receipt.item_name or code
                items.append({
                    "item_code": code,
                    "item_name": descr_name,
                    "farm_origin": b.brand or "",
                    "raw_material_type": b.category or "",
                    "uom_code": b.uom_entry or b.pending_receipt.uom_entry or "",
                    "uom_name": b.uom_label or b.pending_receipt.uom_label or b.uom_entry or b.pending_receipt.uom_entry or ""
                })
            return JsonResponse({"success": True, "items": items})
        except Exception:
            return JsonResponse({"success": True, "items": []})


@api_view(["GET"])
@require_any_module_access(PERMISSION_MODULE_QUALITY, PERMISSION_MODULE_GRPO, PERMISSION_MODULE_PURCHASE_QUOTATION)
def list_quality_cost_centers(request):
    """
    Returns valid SAP Cost Centers / Profit Centers (table OPRC).
    Filters by dimension if requested:
      ?dimension=1 -> Location (Dimension 1)
      ?dimension=2 -> General (Dimension 2)
    Only returns active cost centers.

    Caching: SAP master data is cached in the central shared Redis cache
    (API cache_service) under a per-company, per-dimension key. Dimension 1 and
    Dimension 2 use separate keys and never depend on each other. Successful SAP
    responses populate the cache; a SAP failure never overwrites a previously
    cached (last-known-good) result with empty data.
    """
    dimension = request.query_params.get("dimension", "").strip()
    if dimension and dimension not in {"1", "2"}:
        return JsonResponse({"success": False, "cost_centers": [], "error": "dimension must be 1 or 2"}, status=400)

    namespace = sap_master_namespace("cost-centers")
    cache_key = build_cache_key(namespace, dimension or "all")
    cached = cache_get(cache_key)
    if cached is not None:
        cost_centers = [c for c in cached if str(c.get("dimension")) == str(dimension)] if dimension else cached
        return JsonResponse({"success": True, "cost_centers": cost_centers})

    try:
        from .services.sap_service import SAPServiceLayer
        sap_client = SAPServiceLayer()
        result = sap_client.get_profit_centers(dimension=int(dimension) if dimension else None)
        if isinstance(result, dict) and result.get("error"):
            return JsonResponse({"success": False, "cost_centers": [], "error": str(result["error"])}, status=502)

        raw_rows = result.get("value", []) if isinstance(result, dict) else (result if isinstance(result, list) else [])
        rows = []
        for r in raw_rows:
            code = _get_case_insensitive(r, "CenterCode")
            name = _get_case_insensitive(r, "CenterName") or code
            dim = _get_case_insensitive(r, "InWhichDimension")
            active = _get_case_insensitive(r, "Active")

            if active not in ("tYES", True, "Y", "yes", "tYes"):
                continue
            if not code:
                continue

            rows.append({
                "code": str(code).strip(),
                "name": str(name).strip(),
                "dimension": int(dim) if dim is not None else 1,
            })
        rows.sort(key=lambda c: (c["code"]))
        cache_set(namespace, cache_key, rows, "sap_cost_centers")
        return JsonResponse({"success": True, "cost_centers": rows})
    except Exception as exc:
        return JsonResponse({"success": False, "cost_centers": [], "error": str(exc)}, status=500)


@api_view(["GET", "POST"])
@require_quality_admin_access
@audit_mutation(module=MODULE_QUALITY, entity_type="QualityCategory", methods=("POST",))
def quality_categories_collection(request):
    if request.method == "GET":
        search_query = request.query_params.get("search", "").strip()
        active_only = request.query_params.get("active", "").strip().lower() in {"1", "true", "yes"}
        cache_key = build_cache_key("quality:categories", search=search_query, active=active_only)
        cached_categories = cache_get(cache_key)
        if cached_categories is not None:
            return JsonResponse({"success": True, "categories": cached_categories})

        queryset = QualityCategory.objects.all()
        if active_only:
            queryset = queryset.filter(is_active=True)
        if search_query:
            from django.db.models import Q
            queryset = queryset.filter(
                Q(code__icontains=search_query)
                | Q(name_ar__icontains=search_query)
                | Q(name_en__icontains=search_query)
            )
        serializer = QualityCategorySerializer(queryset, many=True)
        categories = serializer.data
        cache_set("quality:categories", cache_key, categories, "quality_categories")
        return JsonResponse({"success": True, "categories": categories})

    serializer = QualityCategorySerializer(data=request.data)
    if serializer.is_valid():
        category = serializer.save()
        invalidate_cache_namespaces(
            "quality:categories",
            "quality:criteria",
            "quality:inspection-criteria",
            "quality:item-criteria",
        )
        return JsonResponse({"success": True, "category": QualityCategorySerializer(category).data}, status=201)
    return JsonResponse({"success": False, "errors": serializer.errors}, status=400)


@api_view(["PUT"])
@require_quality_admin_access
@audit_mutation(module=MODULE_QUALITY, entity_type="QualityCategory", action=ACTION_UPDATE)
def quality_category_detail(request, category_id):
    try:
        category = QualityCategory.objects.get(id=category_id)
    except QualityCategory.DoesNotExist:
        return JsonResponse({"success": False, "error": "Quality category not found."}, status=404)

    serializer = QualityCategorySerializer(category, data=request.data)
    if serializer.is_valid():
        updated = serializer.save()
        invalidate_cache_namespaces(
            "quality:categories",
            "quality:criteria",
            "quality:inspection-criteria",
            "quality:item-criteria",
        )
        return JsonResponse({"success": True, "category": QualityCategorySerializer(updated).data})
    return JsonResponse({"success": False, "errors": serializer.errors}, status=400)


@api_view(["GET", "POST"])
@require_quality_admin_access
@audit_mutation(module=MODULE_QUALITY, entity_type="QualityCriterion", methods=("POST",))
def quality_criteria_collection(request):
    if request.method == "GET":
        search_query = request.query_params.get("search", "").strip()
        inspection_stage = request.query_params.get("inspection_stage", "").strip()
        active_only = request.query_params.get("active", "").strip().lower() in {"1", "true", "yes"}
        grouped = request.query_params.get("grouped", "").strip().lower() in {"1", "true", "yes"}
        cache_key = build_cache_key(
            "quality:criteria",
            search=search_query,
            inspection_stage=inspection_stage,
            active=active_only,
            grouped=grouped,
        )
        cached_result = cache_get(cache_key)
        if cached_result is not None:
            return JsonResponse({"success": True, **cached_result})

        queryset = QualityCriterion.objects.select_related("inspection_stage", "category").all()
        if active_only:
            queryset = queryset.filter(is_active=True)
        if inspection_stage:
            if inspection_stage.isdigit():
                queryset = queryset.filter(inspection_stage_id=int(inspection_stage))
            else:
                queryset = queryset.filter(inspection_stage__code__iexact=inspection_stage)
        if search_query:
            from django.db.models import Q
            queryset = queryset.filter(
                Q(code__icontains=search_query)
                | Q(name_ar__icontains=search_query)
                | Q(name_en__icontains=search_query)
                | Q(inspection_stage__code__icontains=search_query)
                | Q(inspection_stage__name_ar__icontains=search_query)
                | Q(inspection_stage__name_en__icontains=search_query)
                | Q(category__code__icontains=search_query)
                | Q(category__name_ar__icontains=search_query)
                | Q(category__name_en__icontains=search_query)
            )
        if grouped:
            category_queryset = QualityCategory.objects.prefetch_related("criteria").all()
            categories = []
            for category in category_queryset:
                category_criteria = queryset.filter(category=category)
                categories.append({
                    "category": QualityCategorySerializer(category).data,
                    "criteria": QualityCriterionSerializer(category_criteria, many=True).data,
                })
            cache_set("quality:criteria", cache_key, {"categories": categories}, "quality_criteria")
            return JsonResponse({"success": True, "categories": categories})
        serializer = QualityCriterionSerializer(queryset, many=True)
        criteria = serializer.data
        cache_set("quality:criteria", cache_key, {"criteria": criteria}, "quality_criteria")
        return JsonResponse({"success": True, "criteria": criteria})

    serializer = QualityCriterionSerializer(data=request.data)
    if serializer.is_valid():
        criterion = serializer.save()
        invalidate_cache_namespaces(
            "quality:criteria",
            "quality:inspection-criteria",
            "quality:item-criteria",
        )
        return JsonResponse({"success": True, "criterion": QualityCriterionSerializer(criterion).data}, status=201)
    return JsonResponse({"success": False, "errors": serializer.errors}, status=400)


@api_view(["GET"])
@require_quality_access
def inspection_quality_criteria(request):
    inspection_stage = request.query_params.get("inspection_stage", "").strip()
    if not inspection_stage:
        return JsonResponse({"success": False, "error": "inspection_stage is required."}, status=400)
    item_code = request.query_params.get("item_code", "").strip()

    stage_filter = {"id": int(inspection_stage)} if inspection_stage.isdigit() else {"code__iexact": inspection_stage}
    try:
        stage = InspectionStage.objects.get(**stage_filter)
    except InspectionStage.DoesNotExist:
        return JsonResponse({"success": False, "error": "Inspection stage not found."}, status=404)

    cache_key = build_cache_key("quality:inspection-criteria", stage.code, item_code or "stage-all")
    cached_result = cache_get(cache_key)
    if cached_result is not None:
        return JsonResponse({"success": True, **cached_result})

    criteria = QualityCriterion.objects.select_related("category").filter(
        inspection_stage=stage,
        is_active=True,
    ).exclude(
        calculation_key="",
    )
    if item_code:
        criteria = criteria.filter(
            item_mappings__item_code=item_code,
            item_mappings__inspection_stage=stage,
        ).order_by(
            "category__sort_order",
            "category_id",
            "item_mappings__display_order",
            "display_order",
            "id",
        )
    else:
        criteria = criteria.order_by("category__sort_order", "category_id", "display_order", "id")

    categories = []
    category_index = {}
    for criterion in criteria:
        category = criterion.category
        category_id = category.id
        if category_id not in category_index:
            category_index[category_id] = len(categories)
            categories.append({
                "category": QualityCategorySerializer(category).data,
                "criteria": [],
            })
        categories[category_index[category_id]]["criteria"].append(QualityCriterionSerializer(criterion).data)

    result = {
        "inspection_stage": InspectionStageSerializer(stage).data,
        "categories": categories,
    }
    cache_set("quality:inspection-criteria", cache_key, result, "inspection_quality_criteria")

    return JsonResponse({"success": True, **result})


@api_view(["GET", "POST"])
@require_quality_admin_access
@audit_mutation(module=MODULE_QUALITY, entity_type="InspectionStage", methods=("POST",))
def inspection_stages_collection(request):
    if request.method == "GET":
        search_query = request.query_params.get("search", "").strip()
        active_only = request.query_params.get("active", "").strip().lower() in {"1", "true", "yes"}
        cache_key = build_cache_key("quality:inspection-stages", search=search_query, active=active_only)
        cached_stages = cache_get(cache_key)
        if cached_stages is not None:
            return JsonResponse({"success": True, "stages": cached_stages})

        queryset = InspectionStage.objects.all()
        if active_only:
            queryset = queryset.filter(is_active=True)
        if search_query:
            from django.db.models import Q
            queryset = queryset.filter(
                Q(code__icontains=search_query)
                | Q(name_ar__icontains=search_query)
                | Q(name_en__icontains=search_query)
            )
        serializer = InspectionStageSerializer(queryset, many=True)
        stages = serializer.data
        cache_set("quality:inspection-stages", cache_key, stages, "inspection_stages")
        return JsonResponse({"success": True, "stages": stages})

    serializer = InspectionStageSerializer(data=request.data)
    if serializer.is_valid():
        stage = serializer.save()
        invalidate_cache_namespaces(
            "quality:inspection-stages",
            "quality:criteria",
            "quality:inspection-criteria",
            "quality:item-criteria",
        )
        return JsonResponse({"success": True, "stage": InspectionStageSerializer(stage).data}, status=201)
    return JsonResponse({"success": False, "errors": serializer.errors}, status=400)


@api_view(["PUT", "DELETE"])
@require_quality_admin_access
@audit_mutation(module=MODULE_QUALITY, entity_type="InspectionStage")
def inspection_stage_detail(request, stage_id):
    try:
        stage = InspectionStage.objects.get(id=stage_id)
    except InspectionStage.DoesNotExist:
        return JsonResponse({"success": False, "error": "Inspection stage not found."}, status=404)

    if request.method == "DELETE":
        blockers = _collect_related_delete_blockers(stage, {
            "criteria": "Quality Criteria",
            "item_criteria": "Item Criteria Mapping",
        })
        if blockers:
            return _blocked_delete_response("inspection stage", blockers)
        try:
            stage.delete()
        except ProtectedError:
            blockers = _collect_related_delete_blockers(stage, {
                "criteria": "Quality Criteria",
                "item_criteria": "Item Criteria Mapping",
            })
            if blockers:
                return _blocked_delete_response("inspection stage", blockers)
            return JsonResponse({
                "success": False,
                "error": "Cannot delete inspection stage because related records exist. Deactivate it instead.",
            }, status=400)
        invalidate_cache_namespaces(
            "quality:inspection-stages",
            "quality:criteria",
            "quality:inspection-criteria",
            "quality:item-criteria",
        )
        return JsonResponse({"success": True, "message": "Inspection stage deleted."})

    serializer = InspectionStageSerializer(stage, data=request.data)
    if serializer.is_valid():
        updated = serializer.save()
        invalidate_cache_namespaces(
            "quality:inspection-stages",
            "quality:criteria",
            "quality:inspection-criteria",
            "quality:item-criteria",
        )
        return JsonResponse({"success": True, "stage": InspectionStageSerializer(updated).data})
    return JsonResponse({"success": False, "errors": serializer.errors}, status=400)


@api_view(["PUT", "DELETE"])
@require_quality_admin_access
@audit_mutation(module=MODULE_QUALITY, entity_type="QualityCriterion")
def quality_criterion_detail(request, criterion_id):
    try:
        criterion = QualityCriterion.objects.select_related("inspection_stage", "category").get(id=criterion_id)
    except QualityCriterion.DoesNotExist:
        return JsonResponse({"success": False, "error": "Quality criterion not found."}, status=404)

    if request.method == "DELETE":
        criterion.delete()
        invalidate_cache_namespaces(
            "quality:criteria",
            "quality:inspection-criteria",
            "quality:item-criteria",
        )
        return JsonResponse({"success": True, "message": "Quality criterion deleted."})

    serializer = QualityCriterionSerializer(criterion, data=request.data)
    if serializer.is_valid():
        updated = serializer.save()
        invalidate_cache_namespaces(
            "quality:criteria",
            "quality:inspection-criteria",
            "quality:item-criteria",
        )
        return JsonResponse({"success": True, "criterion": QualityCriterionSerializer(updated).data})
    return JsonResponse({"success": False, "errors": serializer.errors}, status=400)


@api_view(["GET", "POST"])
@require_quality_admin_access
@audit_mutation(module=MODULE_QUALITY, entity_type="ItemQualityCriterion", methods=("POST",))
def item_quality_criteria_collection(request):
    if request.method == "GET":
        item_code = request.query_params.get("item_code", "").strip()
        inspection_stage = request.query_params.get("inspection_stage", "").strip()
        cache_key = build_cache_key(
            "quality:item-criteria",
            item_code=item_code,
            inspection_stage=inspection_stage,
        )
        cached_mappings = cache_get(cache_key)
        if cached_mappings is not None:
            return JsonResponse({"success": True, "item_criteria": cached_mappings})

        queryset = ItemQualityCriterion.objects.select_related(
            "inspection_stage",
            "quality_criterion",
            "quality_criterion__inspection_stage",
            "quality_criterion__category",
        ).all()
        if item_code:
            queryset = queryset.filter(item_code=item_code)
        if inspection_stage:
            if inspection_stage.isdigit():
                queryset = queryset.filter(inspection_stage_id=int(inspection_stage))
            else:
                queryset = queryset.filter(inspection_stage__code__iexact=inspection_stage)
        serializer = ItemQualityCriterionSerializer(queryset, many=True)
        mappings = serializer.data
        cache_set("quality:item-criteria", cache_key, mappings, "item_quality_criteria")
        return JsonResponse({"success": True, "item_criteria": mappings})

    item_code = str(request.data.get("item_code", "")).strip()
    inspection_stage_id = request.data.get("inspection_stage")
    criterion_ids = request.data.get("criterion_ids")
    if isinstance(criterion_ids, list):
        if not item_code:
            return JsonResponse({"success": False, "errors": {"item_code": ["Item code is required."]}}, status=400)
        if not inspection_stage_id:
            return JsonResponse({"success": False, "errors": {"inspection_stage": ["Inspection stage is required."]}}, status=400)
        try:
            inspection_stage = InspectionStage.objects.get(id=int(inspection_stage_id))
        except (TypeError, ValueError, InspectionStage.DoesNotExist):
            return JsonResponse({"success": False, "errors": {"inspection_stage": ["Invalid inspection stage."]}}, status=400)

        existing = {
            mapping.quality_criterion_id: mapping
            for mapping in ItemQualityCriterion.objects.filter(item_code=item_code, inspection_stage=inspection_stage)
        }
        desired_ids = []
        for value in criterion_ids:
            try:
                desired_ids.append(int(value))
            except (TypeError, ValueError):
                return JsonResponse({"success": False, "errors": {"criterion_ids": ["Invalid criterion id."]}}, status=400)
        desired_set = set(desired_ids)
        existing_ids = set(existing.keys())
        allowed_ids = set(QualityCriterion.objects.filter(
            id__in=desired_set,
            inspection_stage=inspection_stage,
        ).values_list("id", flat=True))
        found_ids = allowed_ids | (desired_set & existing_ids)
        missing_ids = desired_set - found_ids
        if missing_ids:
            return JsonResponse({"success": False, "errors": {"criterion_ids": [f"Unknown or invalid criterion ids for this inspection stage: {sorted(missing_ids)}"]}}, status=400)

        with transaction.atomic():
            ItemQualityCriterion.objects.filter(
                item_code=item_code,
                inspection_stage=inspection_stage,
            ).exclude(quality_criterion_id__in=desired_set).delete()
            for index, criterion_id in enumerate(desired_ids):
                mapping = existing.get(criterion_id)
                if mapping:
                    mapping.display_order = index
                    mapping.save(update_fields=["display_order"])
                else:
                    ItemQualityCriterion.objects.create(
                        item_code=item_code,
                        inspection_stage=inspection_stage,
                        quality_criterion_id=criterion_id,
                        display_order=index,
                        is_required=True,
                    )
        queryset = ItemQualityCriterion.objects.select_related(
            "inspection_stage",
            "quality_criterion",
            "quality_criterion__inspection_stage",
            "quality_criterion__category",
        ).filter(item_code=item_code, inspection_stage=inspection_stage)
        serializer = ItemQualityCriterionSerializer(queryset, many=True)
        invalidate_cache_namespaces(
            "quality:item-criteria",
            "quality:inspection-criteria",
        )
        return JsonResponse({"success": True, "item_criteria": serializer.data})

    serializer = ItemQualityCriterionSerializer(data=request.data)
    if serializer.is_valid():
        mapping = serializer.save()
        invalidate_cache_namespaces(
            "quality:item-criteria",
            "quality:inspection-criteria",
        )
        return JsonResponse({"success": True, "item_criterion": ItemQualityCriterionSerializer(mapping).data}, status=201)
    return JsonResponse({"success": False, "errors": serializer.errors}, status=400)


@api_view(["DELETE"])
@require_quality_admin_access
@audit_mutation(module=MODULE_QUALITY, entity_type="ItemQualityCriterion")
def item_quality_criterion_detail(request, mapping_id):
    try:
        mapping = ItemQualityCriterion.objects.get(id=mapping_id)
    except ItemQualityCriterion.DoesNotExist:
        return JsonResponse({"success": False, "error": "Item quality criterion mapping not found."}, status=404)
    mapping.delete()
    invalidate_cache_namespaces(
        "quality:item-criteria",
        "quality:inspection-criteria",
    )
    return JsonResponse({"success": True, "message": "Item quality criterion mapping deleted."})
