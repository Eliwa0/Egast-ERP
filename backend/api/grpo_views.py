from decimal import Decimal
from django.db.models import Prefetch, Q
from django.http import JsonResponse
from django.utils import timezone
from rest_framework.decorators import api_view

from .models import PendingQualityInspection, PurchaseGRPODraft
from .role_permissions import (
    MODULE_GRPO as PERMISSION_MODULE_GRPO,
    require_module_access,
)
from .services.purchase_grpo_service import PurchaseGRPODraftService
from .services.audit_service import audit_mutation, MODULE_GRPO, ACTION_CREATE


@api_view(["GET"])
@require_module_access(PERMISSION_MODULE_GRPO)
def list_pending_grpo_shipments(request):
    """
    Returns shipments/inspections eligible for GRPO creation.

    Eligibility rules (enforced strictly server-side):
    - Excludes inspections that already have a POSTED PurchaseGRPODraft.
    - Excludes rejected inspections.
    - Includes inspections with in-progress drafts (DRAFT, APPROVED_FOR_POSTING, POSTING_FAILED).
    - Includes inspections with no drafts yet.
    """
    search_query = str(request.query_params.get("search", "")).strip()

    active_drafts_prefetch = Prefetch(
        "grpo_drafts",
        queryset=PurchaseGRPODraft.objects.filter(
            status__in=PurchaseGRPODraft.ACTIVE_STATUSES
        ).order_by("-created_at"),
        to_attr="active_drafts_list",
    )

    queryset = (
        PendingQualityInspection.objects.exclude(
            grpo_drafts__status=PurchaseGRPODraft.POSTED
        )
        .exclude(status=PendingQualityInspection.REJECTED)
        .exclude(decision__iexact="Rejected")
        .prefetch_related(active_drafts_prefetch)
        .order_by("-created_at")
    )
    if search_query:
        queryset = queryset.filter(
            Q(batch_number__icontains=search_query)
            | Q(car_number__icontains=search_query)
            | Q(vendor_name__icontains=search_query)
            | Q(supplier_name__icontains=search_query)
            | Q(vendor_card_code__icontains=search_query)
            | Q(item_code__icontains=search_query)
            | Q(item_name__icontains=search_query)
        )

    queryset = queryset.distinct()

    seen_scale_draft_ids = set()
    shipments = []
    for ins in queryset:
        if ins.scale_draft_id:
            seen_scale_draft_ids.add(ins.scale_draft_id)
        active_draft = ins.active_drafts_list[0] if getattr(ins, "active_drafts_list", None) else None
        shipments.append({
            "id": ins.id,
            "inspection_id": ins.id,
            "source_type": "quality",
            "batch_number": ins.batch_number,
            "car_number": ins.car_number or "-",
            "vendor_card_code": ins.vendor_card_code or ins.farm_origin or "",
            "vendor_name": ins.vendor_name or ins.supplier_name or ins.vendor_card_code or "-",
            "supplier_name": ins.supplier_name or ins.vendor_name or "-",
            "farm_origin": ins.farm_origin or "-",
            "item_code": ins.item_code or "",
            "item_name": ins.item_name or ins.item_code or "-",
            "crop_name": ins.crop_name or "-",
            "quantity": float(ins.quantity or 0.0),
            "uom_code": ins.uom_code or "KG",
            "uom_name": ins.uom_name or ins.uom_code or "KG",
            "warehouse_code": ins.warehouse_code or "-",
            "inspection_date": ins.inspection_date.isoformat() if hasattr(ins.inspection_date, "isoformat") else (str(ins.inspection_date) if ins.inspection_date else None),
            "created_at": ins.created_at.isoformat() if hasattr(ins.created_at, "isoformat") else (str(ins.created_at) if ins.created_at else None),
            "status": ins.status,
            "decision": ins.decision,
            "scale_draft_id": ins.scale_draft_id,
            "has_active_draft": bool(active_draft),
            "grpo_draft_id": active_draft.id if active_draft else None,
            "grpo_draft_status": active_draft.status if active_draft else None,
            "is_manual": ins.inspector_name == "MANUAL",
        })

    # Direct completed ScaleDrafts eligible for GRPO (excludes only POSTED GRPO drafts, includes in-progress drafts)
    from scale.models import ScaleDraft
    scale_active_drafts_prefetch = Prefetch(
        "grpo_drafts",
        queryset=PurchaseGRPODraft.objects.filter(
            status__in=PurchaseGRPODraft.ACTIVE_STATUSES
        ).order_by("-created_at"),
        to_attr="active_drafts_list",
    )
    scale_qs = (
        ScaleDraft.objects.filter(
            is_closed=True,
            status__in=[ScaleDraft.STATUS_COMPLETED, ScaleDraft.STATUS_SENT_TO_QUALITY],
            product_weight__gt=0,
        )
        .exclude(grpo_drafts__status=PurchaseGRPODraft.POSTED)
        .exclude(id__in=seen_scale_draft_ids)
        .prefetch_related(scale_active_drafts_prefetch)
        .select_related("vehicle", "quotation")
        .order_by("-created_at")
    )
    if search_query:
        scale_qs = scale_qs.filter(
            Q(draft_number__icontains=search_query)
            | Q(vendor_name__icontains=search_query)
            | Q(vendor_card_code__icontains=search_query)
            | Q(item_code__icontains=search_query)
            | Q(item_name__icontains=search_query)
            | Q(direct_vehicle_number__icontains=search_query)
            | Q(vehicle__vehicle_number__icontains=search_query)
        )

    for sd in scale_qs:
        v_num = getattr(sd, "effective_vehicle_number", "")
        if not v_num or v_num == "بدون رقم":
            v_num = getattr(sd, "direct_vehicle_number", "") or "-"

        active_draft = sd.active_drafts_list[0] if getattr(sd, "active_drafts_list", None) else None

        shipments.append({
            "id": None,
            "inspection_id": None,
            "source_type": "scale",
            "scale_draft_id": sd.id,
            "batch_number": sd.draft_number or "",
            "car_number": v_num,
            "vendor_card_code": sd.vendor_card_code or "",
            "vendor_name": sd.vendor_name or sd.vendor_card_code or "-",
            "supplier_name": sd.vendor_name or "-",
            "farm_origin": "-",
            "item_code": sd.item_code or "",
            "item_name": sd.item_name or sd.item_code or "-",
            "crop_name": "-",
            "quantity": float(sd.product_weight or 0.0),
            "uom_code": "KG",
            "uom_name": "KG",
            "warehouse_code": "-",
            "inspection_date": None,
            "created_at": sd.created_at.isoformat() if hasattr(sd.created_at, "isoformat") else (str(sd.created_at) if sd.created_at else None),
            "status": sd.get_status_display(),
            "decision": "Certified",
            "has_active_draft": bool(active_draft),
            "grpo_draft_id": active_draft.id if active_draft else None,
            "grpo_draft_status": active_draft.status if active_draft else None,
            "is_manual": False,
            "quotation_id": sd.quotation_id,
            "quotation_number": (sd.quotation.sap_doc_num or sd.quotation.id) if sd.quotation_id else None,
            "quotation_sap_doc_entry": sd.quotation.sap_doc_entry if (sd.quotation_id and sd.quotation) else None,
            "quotation_line_index": sd.quotation_line_index if sd.quotation_id else None,
        })

    return JsonResponse({
        "success": True,
        "data": {
            "shipments": shipments,
            "count": len(shipments),
        },
    })


@api_view(["GET"])
@require_module_access(PERMISSION_MODULE_GRPO)
def list_completed_grpo_reviews(request):
    """
    Returns shipments/orders that have completed GRPO creation (status = POSTED).
    Source of truth: PurchaseGRPODraft with status=PurchaseGRPODraft.POSTED.
    Strictly excludes: DRAFT, PENDING_REVIEW, APPROVED_FOR_POSTING, POSTING_FAILED, CANCELLED.
    """
    search_query = str(request.query_params.get("search", "")).strip()

    queryset = (
        PurchaseGRPODraft.objects.filter(status=PurchaseGRPODraft.POSTED)
        .select_related("inspection", "created_by", "posted_by", "scale_draft")
        .order_by("-posted_at", "-created_at")
    )

    if search_query:
        search_filter = (
            Q(batch_number__icontains=search_query)
            | Q(vendor_name__icontains=search_query)
            | Q(vendor_card_code__icontains=search_query)
            | Q(item_name__icontains=search_query)
            | Q(item_code__icontains=search_query)
            | Q(sap_doc_entry__icontains=search_query)
            | Q(sap_doc_num__icontains=search_query)
            | Q(car_number__icontains=search_query)
            | Q(scale_draft__direct_vehicle_number__icontains=search_query)
            | Q(scale_draft__draft_number__icontains=search_query)
            | Q(inspection__car_number__icontains=search_query)
            | Q(inspection__batch_number__icontains=search_query)
            | Q(inspection__supplier_name__icontains=search_query)
            | Q(inspection__vendor_name__icontains=search_query)
            | Q(vendor_ref_no__icontains=search_query)
            | Q(journal_remark__icontains=search_query)
            | Q(inspection__vendor_ref_no__icontains=search_query)
            | Q(inspection__journal_remark__icontains=search_query)
        )
        if search_query.isdigit():
            search_filter |= Q(id=int(search_query)) | Q(inspection_id=int(search_query)) | Q(scale_draft_id=int(search_query))
        queryset = queryset.filter(search_filter)

    records = []
    for draft in queryset:
        ins = draft.inspection
        sd = draft.scale_draft
        car_number = draft.car_number or (ins.car_number if ins else "") or (sd.direct_vehicle_number if sd else "") or "-"
        records.append({
            "id": draft.id,
            "draft_id": draft.id,
            "inspection_id": ins.id if ins else None,
            "scale_draft_id": sd.id if sd else None,
            "batch_number": draft.batch_number or (ins.batch_number if ins else "-"),
            "car_number": car_number,
            "container_number": car_number,
            "container_quantity": getattr(draft, "container_quantity", 0) or 0,
            "vendor_card_code": draft.vendor_card_code or (ins.vendor_card_code if ins else "-"),
            "vendor_name": draft.vendor_name or (ins.vendor_name or ins.supplier_name if ins else "-"),
            "supplier_name": (ins.supplier_name if ins else draft.vendor_name) or "-",
            "farm_origin": (ins.farm_origin if ins else "-") or "-",
            "item_code": draft.item_code or (ins.item_code if ins else "-"),
            "item_name": draft.item_name or (ins.item_name if ins else "-"),
            "crop_name": (ins.crop_name if ins else "-") or "-",
            "quantity": float(draft.quantity or 0.0),
            "uom_code": draft.uom_code or (ins.uom_code if ins else "KG"),
            "uom_name": draft.uom_name or (ins.uom_name if ins else "KG"),
            "warehouse_code": draft.warehouse_code or (ins.warehouse_code if ins else "-"),
            "bin_code": draft.bin_code or "-",
            "unit_price": str(draft.unit_price) if draft.unit_price is not None else None,
            "tax_code": draft.tax_code or "-",
            "inspection_date": ins.inspection_date.isoformat() if (ins and ins.inspection_date and hasattr(ins.inspection_date, "isoformat")) else (str(ins.inspection_date) if ins and ins.inspection_date else None),
            "posting_date": draft.posting_date.isoformat() if (draft.posting_date and hasattr(draft.posting_date, "isoformat")) else (str(draft.posting_date) if draft.posting_date else None),
            "document_date": draft.document_date.isoformat() if (draft.document_date and hasattr(draft.document_date, "isoformat")) else (str(draft.document_date) if draft.document_date else None),
            "posted_at": draft.posted_at.isoformat() if (draft.posted_at and hasattr(draft.posted_at, "isoformat")) else (str(draft.posted_at) if draft.posted_at else None),
            "created_at": draft.created_at.isoformat() if (draft.created_at and hasattr(draft.created_at, "isoformat")) else (str(draft.created_at) if draft.created_at else None),
            "status": draft.status,
            "sap_doc_entry": draft.sap_doc_entry or "-",
            "sap_doc_num": draft.sap_doc_num or "-",
            "posted_by_username": draft.posted_by.username if draft.posted_by else None,
            "vendor_ref_no": draft.vendor_ref_no or (ins.vendor_ref_no if ins else "") or "-",
            "journal_remark": draft.journal_remark or (ins.journal_remark if ins else "") or "-",
            "is_manual": bool(ins and ins.inspector_name == "MANUAL"),
            "source_type": "scale" if sd else ("manual" if (ins and ins.inspector_name == "MANUAL") else "quality"),
        })

    return JsonResponse({
        "success": True,
        "data": {
            "records": records,
            "count": len(records),
        },
    })


@api_view(["POST"])
@require_module_access(PERMISSION_MODULE_GRPO)
@audit_mutation(module=MODULE_GRPO, entity_type="ManualReceivingRequest", action=ACTION_CREATE)
def create_manual_receiving_request(request):
    """
    Creates a manual receiving entry that feeds directly into the GRPO workflow.

    Workflow:
    1. Validates required incoming fields and positive quantity.
    2. Enforces batch uniqueness across active inspections and posted GRPOs.
    3. Creates a PendingQualityInspection record tagged with inspector_name="MANUAL".
       (This record is strictly excluded from Quality Review list views).
    4. Automatically initializes a PurchaseGRPODraft using PurchaseGRPODraftService.
    5. Returns the draft ID so the frontend can immediately navigate to /grpo/:draftId.
    """
    data = request.data if isinstance(request.data, dict) else {}

    car_number = str(data.get("car_number") or data.get("container_number") or "").strip()
    container_quantity_raw = data.get("container_quantity", 0)
    try:
        if isinstance(container_quantity_raw, float) and not container_quantity_raw.is_integer():
            return JsonResponse({"success": False, "error": "No. Packed must be a whole non-negative number."}, status=400)
        container_quantity = int(container_quantity_raw if container_quantity_raw is not None and container_quantity_raw != "" else 0)
        if container_quantity < 0:
            return JsonResponse({"success": False, "error": "No. Packed must be a whole non-negative number."}, status=400)
    except (ValueError, TypeError):
        return JsonResponse({"success": False, "error": "No. Packed must be a whole non-negative number."}, status=400)

    vendor_name = str(data.get("vendor_name", "")).strip()
    vendor_card_code = str(data.get("vendor_card_code", "")).strip()
    farm_origin = str(data.get("farm_origin", "")).strip() or vendor_card_code
    contractor_name = str(data.get("contractor_name", "")).strip()
    item_code = str(data.get("item_code", "")).strip()
    item_name = str(data.get("item_name", "")).strip() or item_code
    item_code = item_code or item_name
    raw_material_type = str(data.get("raw_material_type", "")).strip()
    batch_number = str(data.get("batch_number", "")).strip()
    warehouse_code = str(data.get("warehouse_code", "")).strip()
    bin_code = str(data.get("bin_code", "")).strip()
    bin_abs_entry = str(data.get("bin_abs_entry", "")).strip()
    scale_draft_id = data.get("scale_draft_id")
    uom_code = str(data.get("uom_code", "KG")).strip().upper() or "KG"
    uom_name = str(data.get("uom_name", uom_code)).strip() or uom_code
    notes = str(data.get("notes", "")).strip()
    location = str(data.get("location", "")).strip()
    general = str(data.get("general", "")).strip()
    vendor_ref_no = str(data.get("vendor_ref_no", "")).strip()
    journal_remark = str(data.get("journal_remark", "")).strip()
    tax_code = str(data.get("tax_code", "")).strip()

    unit_price = data.get("unit_price")
    if unit_price is not None and str(unit_price).strip() != "":
        try:
            unit_price = Decimal(str(unit_price).strip())
        except Exception:
            unit_price = None
    else:
        unit_price = None

    discount_percent = data.get("discount_percent")
    if discount_percent is not None and str(discount_percent).strip() != "":
        try:
            discount_percent = Decimal(str(discount_percent).strip())
        except Exception:
            discount_percent = Decimal("0")
    else:
        discount_percent = Decimal("0")

    if not car_number:
        return JsonResponse({"success": False, "error": "Vehicle / Container number is required."}, status=400)
    if not vendor_name:
        return JsonResponse({"success": False, "error": "Supplier / vendor name is required."}, status=400)
    if not item_name:
        return JsonResponse({"success": False, "error": "Item / material description is required."}, status=400)
    if not warehouse_code:
        return JsonResponse({"success": False, "error": "Destination warehouse is required."}, status=400)
    if not batch_number:
        return JsonResponse({"success": False, "error": "Batch / order number is required."}, status=400)

    try:
        qty = float(data.get("quantity", 0))
        if qty <= 0:
            raise ValueError()
    except (ValueError, TypeError):
        return JsonResponse({"success": False, "error": "Quantity must be a positive number greater than 0."}, status=400)

    # 1. Check if Batch Number already exists in SAP for this Item
    try:
        from .services.sap_service import SAPServiceLayer
        sap_client = SAPServiceLayer()
        safe_batch = batch_number.replace("'", "''")
        safe_item = item_code.replace("'", "''")

        # Query BatchNumberDetails
        endpoint_details = f"BatchNumberDetails?$filter=Batch eq '{safe_batch}' and ItemCode eq '{safe_item}'&$select=DocEntry,Batch,ItemCode"
        res_details = sap_client._request("GET", endpoint_details)
        if res_details and not res_details.get("error") and res_details.get("value"):
            return JsonResponse({
                "success": False,
                "error": f"Batch number already exists in SAP for this item."
            }, status=400)

        # Fallback check BatchNumbers
        endpoint_numbers = f"BatchNumbers?$filter=BatchNumber eq '{safe_batch}' and ItemCode eq '{safe_item}'&$select=BatchNumber,ItemCode"
        res_numbers = sap_client._request("GET", endpoint_numbers)
        if res_numbers and not res_numbers.get("error") and res_numbers.get("value"):
            return JsonResponse({
                "success": False,
                "error": f"Batch number already exists in SAP for this item."
            }, status=400)
    except Exception as sap_err:
        # In test environments where SAP is not running or mock is configured
        pass

    # 2. Check for duplicate active or pending inspection batch locally
    if PendingQualityInspection.objects.filter(
        batch_number=batch_number
    ).exclude(status=PendingQualityInspection.REJECTED).exists():
        return JsonResponse({
            "success": False,
            "error": f"A pending shipment with batch number '{batch_number}' already exists."
        }, status=400)

    if PurchaseGRPODraft.objects.filter(
        batch_number=batch_number,
        status=PurchaseGRPODraft.POSTED
    ).exists():
        return JsonResponse({
            "success": False,
            "error": f"A posted GRPO with batch number '{batch_number}' already exists."
        }, status=400)

    today = timezone.now().date()
    mfg_date = data.get("manufacturing_date") or today
    adm_date = data.get("admission_date") or today
    exp_date = data.get("expiry_date") or None

    inspection = PendingQualityInspection.objects.create(
        batch_number=batch_number,
        car_number=car_number,
        vendor_name=vendor_name,
        supplier_name=vendor_name,
        vendor_card_code=vendor_card_code,
        farm_origin=farm_origin,
        contractor_name=contractor_name,
        item_code=item_code,
        item_name=item_name,
        raw_material_type=raw_material_type,
        quantity=qty,
        batch_quantity=qty,
        container_quantity=container_quantity,
        uom_code=uom_code,
        uom_name=uom_name,
        warehouse_code=warehouse_code,
        bin_code=bin_code,
        bin_abs_entry=bin_abs_entry,
        bin_quantity=qty if bin_code else 0.0,
        scale_draft_id=scale_draft_id if scale_draft_id else None,
        notes=notes,
        grpo_comments=notes,
        location=location,
        general=general,
        vendor_ref_no=vendor_ref_no,
        journal_remark=journal_remark,
        unit_price=unit_price,
        tax_code=tax_code,
        discount_percent=discount_percent,
        inspector_name="MANUAL",
        data_clerk_name="MANUAL",
        decision="Accepted",
        status=PendingQualityInspection.PENDING_REVIEW,
        inspection_date=today,
        posting_date=today,
        document_date=today,
        due_date=today,
        manufacturing_date=mfg_date,
        admission_date=adm_date,
        expiry_date=exp_date,
        created_by=request.user if getattr(request.user, "is_authenticated", False) else None,
    )

    service = PurchaseGRPODraftService()
    draft, _ = service.get_or_create_draft_from_inspection(inspection, user=request.user)

    return JsonResponse({
        "success": True,
        "data": {
            "inspection_id": inspection.id,
            "draft_id": draft.id,
            "batch_number": inspection.batch_number,
            "is_manual": True,
            "message": "Manual receiving request created successfully.",
        }
    }, status=201)


@api_view(["GET", "POST"])
@require_module_access(PERMISSION_MODULE_GRPO)
@audit_mutation(module=MODULE_GRPO, entity_type="PurchaseGRPODraft", action=ACTION_CREATE, methods=("POST",))
def create_or_get_scale_draft_grpo(request, scale_draft_id):
    from scale.models import ScaleDraft
    from .quality_serializers import PurchaseGRPODraftSerializer

    try:
        scale_draft = ScaleDraft.objects.get(id=scale_draft_id)
    except ScaleDraft.DoesNotExist:
        return JsonResponse({"success": False, "error": "Scale draft not found."}, status=404)

    service = PurchaseGRPODraftService()

    if request.method == "GET":
        draft = service.get_posted_draft_for_scale(scale_draft) or service.get_active_draft_for_scale(scale_draft)
        if draft:
            draft = service.ensure_draft_uom(draft)
        return JsonResponse({
            "success": True,
            "data": {
                "draft": PurchaseGRPODraftSerializer(draft).data if draft else None,
            },
        })

    try:
        res = service.get_or_create_draft_from_scale(scale_draft, user=request.user)
    except ValueError as exc:
        return JsonResponse({"success": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return JsonResponse({"success": False, "error": str(exc)}, status=400)

    draft, created = res
    draft_data = PurchaseGRPODraftSerializer(draft).data
    return JsonResponse({
        "success": True,
        "created": created,
        "data": {
            **draft_data,
            "draft": draft_data,
        },
    }, status=201 if created else 200)
