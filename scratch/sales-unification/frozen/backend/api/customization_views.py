import logging
import hashlib
import json
from typing import Any, Dict
from django.db import transaction
from django.db.models import Q, Count
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from api.models_customization import CustomizationDraft, CustomizationDraftLine
from api.role_permissions import (
    MODULE_CUSTOMIZATION,
    can_manage_module,
    require_module_access,
    require_module_admin,
)
from api.services.audit_service import (
    ACTION_APPROVE,
    ACTION_CREATE,
    ACTION_POST,
    ACTION_REJECT,
    ACTION_UPDATE,
    MODULE_CUSTOMIZATION as AUDIT_MODULE_CUSTOMIZATION,
    log_action,
)
from api.services.customization_service import (
    CustomizationPostingError,
    CustomizationService,
    CustomizationStateError,
)
from api.services.sap_service import SAPServiceLayer
from api.services.cache_service import build_cache_key, cache_get_or_set, sap_master_namespace

logger = logging.getLogger(__name__)


def _serialize_draft(draft: CustomizationDraft) -> Dict[str, Any]:
    lines = []
    total_qty = 0.0
    total_amount = 0.0
    for line in draft.lines.all():
        qty = float(line.customized_quantity if line.customized_quantity is not None else line.original_quantity or 0.0)
        price = float(line.customized_unit_price if line.customized_unit_price is not None else line.original_unit_price or 0.0)
        line_total = qty * price * (1 - float(line.discount_percent or 0) / 100)
        total_qty += qty
        total_amount += line_total
        tax_code = line.tax_code
        if not tax_code and draft.original_sap_snapshot:
            for sl in (draft.original_sap_snapshot.get("DocumentLines") or []):
                if sl.get("LineNum") == line.line_number or sl.get("ItemCode") == line.item_code:
                    tax_code = sl.get("VatGroup") or sl.get("TaxCode") or ""
                    break

        lines.append({
            "id": line.id,
            "line_number": line.line_number,
            "item_code": line.item_code,
            "item_description": line.item_description,
            "uom": line.uom,
            "uom_entry": line.uom_entry,
            "original_quantity": line.original_quantity,
            "customized_quantity": line.customized_quantity,
            "original_unit_price": str(line.original_unit_price),
            "customized_unit_price": str(line.customized_unit_price),
            "discount_percent": line.discount_percent,
            "tax_code": tax_code,
            "warehouse_code": line.warehouse_code,
            "cost_center_code": line.cost_center_code,
            "free_text": line.free_text,
            "u_specification": line.u_specification,
            "u_brand": line.u_brand,
            "u_size": line.u_size,
            "u_pallets": line.u_pallets,
            "u_packing": line.u_packing,
            "is_selected": line.is_selected,
            "line_total": round(line_total, 2),
        })

    return {
        "id": draft.id,
        "quotation_doc_entry": draft.quotation_doc_entry,
        "quotation_doc_num": draft.quotation_doc_num,
        "customer_code": draft.customer_code,
        "customer_name": draft.customer_name,
        "status": draft.status,
        "status_display": draft.get_status_display(),
        "currency": (draft.original_sap_snapshot or {}).get("DocCurrency") or draft.currency or "",
        "comments": draft.comments or "",
        "wrapping": draft.wrapping or "",
        "tax_date": draft.tax_date.isoformat() if hasattr(draft.tax_date, "isoformat") else (str(draft.tax_date) if getattr(draft, "tax_date", None) else None),
        "doc_rate": draft.doc_rate,
        "payment_group_code": draft.payment_group_code,
        "sales_person_code": draft.sales_person_code,
        "header_fields": draft.header_fields or {},
        "draft_payload": draft.draft_payload or {},
        "total_quantity": round(total_qty, 3),
        "total_amount": round(total_amount, 2),
        "created_by": draft.created_by.username if draft.created_by else None,
        "created_at": draft.created_at.isoformat() if draft.created_at else None,
        "updated_at": draft.updated_at.isoformat() if draft.updated_at else None,
        "internal_reviewed_by": draft.internal_reviewed_by.username if draft.internal_reviewed_by else None,
        "internal_reviewed_at": draft.internal_reviewed_at.isoformat() if draft.internal_reviewed_at else None,
        "internal_approval_notes": draft.internal_approval_notes,
        "internal_rejection_reason": draft.internal_rejection_reason,
        "customer_approval_type": draft.customer_approval_type,
        "customer_approval_type_display": draft.get_customer_approval_type_display() if draft.customer_approval_type else None,
        "customer_reference_number": draft.customer_reference_number,
        "customer_contact_person": draft.customer_contact_person,
        "customer_approval_notes": draft.customer_approval_notes,
        "customer_approval_recorded_by": draft.customer_approval_recorded_by.username if draft.customer_approval_recorded_by else None,
        "customer_approval_recorded_at": draft.customer_approval_recorded_at.isoformat() if draft.customer_approval_recorded_at else None,
        "sap_order_doc_entry": draft.sap_order_doc_entry,
        "sap_order_doc_num": draft.sap_order_doc_num,
        "order_posted_by": draft.order_posted_by.username if draft.order_posted_by else None,
        "order_posted_at": draft.order_posted_at.isoformat() if draft.order_posted_at else None,
        "sap_error": draft.sap_error,
        "is_local_creation": getattr(draft, "is_local_creation", True),
        "quotation_doc_date": draft.quotation_doc_date.isoformat() if hasattr(draft.quotation_doc_date, "isoformat") else (str(draft.quotation_doc_date) if getattr(draft, "quotation_doc_date", None) else None),
        "quotation_valid_until": draft.quotation_valid_until.isoformat() if hasattr(draft.quotation_valid_until, "isoformat") else (str(draft.quotation_valid_until) if getattr(draft, "quotation_valid_until", None) else None),
        "lines": lines,
    }


@api_view(["GET", "POST"])
@require_module_access(MODULE_CUSTOMIZATION)
def list_or_create_customization_drafts(request):
    """
    GET: List CustomizationDrafts with optional filtering by status, search, or quotation_doc_entry.
    POST: Initialize a new CustomizationDraft from an existing SAP Sales Quotation, OR save/submit a local workflow draft.
    """
    service = CustomizationService()

    if request.method == "GET":
        from .services.workflow_pagination import numeric_identifier
        try:
            for name in ['id', 'quotation_doc_entry', 'quotation', 'order_number']:
                if request.query_params.get(name):
                    numeric_identifier(request.query_params[name], name)
            for name in ['draft_ids', 'order_entries']:
                for value in request.query_params.get(name, '').split(','):
                    if value:
                        numeric_identifier(value, name)
        except ValueError as error:
            return Response({'success': False, 'error': str(error)}, status=400)
        include_external = request.query_params.get("include_external") == "true"
        if include_external:
            qs = CustomizationDraft.objects.all().prefetch_related("lines").select_related(
                "created_by", "internal_reviewed_by", "customer_approval_recorded_by", "order_posted_by"
            )
        else:
            qs = CustomizationDraft.objects.filter(is_local_creation=True).prefetch_related("lines").select_related(
                "created_by", "internal_reviewed_by", "customer_approval_recorded_by", "order_posted_by"
            )
        status_filter = request.query_params.get("status")
        if status_filter:
            status_val = status_filter.strip()
            if status_val == "DRAFT":
                qs = qs.filter(status=CustomizationDraft.STATUS_DRAFT)
            elif status_val == 'REJECTED':
                qs = qs.filter(status__in=['INTERNAL_REJECTED', 'CUSTOMER_REJECTED'])
            elif status_val == "READY_FOR_ORDER":
                # Strictly return drafts ready for order conversion that haven't been posted to SAP yet
                qs = qs.filter(
                    Q(status=CustomizationDraft.STATUS_READY_FOR_ORDER) &
                    (Q(sap_order_doc_num="") | Q(sap_order_doc_num__isnull=True))
                )
            else:
                qs = qs.filter(status=status_val)

        quotation_entry = request.query_params.get("quotation_doc_entry")
        if quotation_entry:
            qs = qs.filter(quotation_doc_entry=quotation_entry)
        if request.query_params.get('id'):
            qs = qs.filter(id=request.query_params['id'])
        quotation = request.query_params.get('quotation')
        if quotation:
            condition = Q(quotation_doc_num=quotation)
            if quotation.isdigit():
                condition |= Q(quotation_doc_entry=int(quotation)) | Q(id=int(quotation))
            qs = qs.filter(condition)
        if request.query_params.get('order_number'):
            qs = qs.filter(sap_order_doc_num=request.query_params['order_number'])
        if request.query_params.get('draft_ids'):
            ids = request.query_params['draft_ids'].split(',')[:50]
            qs = qs.filter(id__in=[int(value) for value in ids if value.isdigit()])
        if request.query_params.get('order_entries'):
            qs = qs.filter(sap_order_doc_entry__in=request.query_params['order_entries'].split(',')[:50])

        search = request.query_params.get("search")
        if search:
            s = search.strip()
            qs = qs.filter(
                Q(quotation_doc_num__icontains=s) |
                Q(quotation_doc_entry__icontains=s) |
                Q(customer_code__icontains=s) |
                Q(customer_name__icontains=s) |
                Q(sap_order_doc_num__icontains=s) |
                Q(lines__item_code__icontains=s) |
                Q(lines__item_description__icontains=s) |
                Q(id__icontains=s)
            )

        from .services.workflow_pagination import workflow_page
        tab_groups = {
            'IN_REVIEW': ['DRAFT', 'PENDING_INTERNAL_REVIEW', 'INTERNAL_REJECTED'],
            'APPROVED': ['INTERNAL_APPROVED', 'WAITING_CUSTOMER_APPROVAL'],
            'READY': ['READY_FOR_ORDER', 'ORDER_POSTING'], 'ORDERED': ['ORDER_POSTED'],
        }
        counts = {row['status']: row['n'] for row in qs.order_by().values('status').annotate(n=Count('id', distinct=True))}
        workflow_counts = {'all': sum(counts.values()), 'inReview': sum(counts.get(s, 0) for s in tab_groups['IN_REVIEW']),
            'approved': sum(counts.get(s, 0) for s in tab_groups['APPROVED']),
            'ready': sum(counts.get(s, 0) for s in tab_groups['READY']), 'ordered': counts.get('ORDER_POSTED', 0)}
        if request.query_params.get('tab') in tab_groups:
            qs = qs.filter(status__in=tab_groups[request.query_params['tab']])
        rows, pagination = workflow_page(qs, request.query_params, ['customer_code', 'customer_name', 'quotation_doc_num', 'quotation_doc_entry', 'sap_order_doc_num', 'id', 'lines__item_code', 'lines__item_description'])
        drafts = [_serialize_draft(d) for d in rows]
        return Response({"success": True, "drafts": drafts, 'pagination': pagination, 'workflow_counts': workflow_counts})

    # POST - Create or Save draft
    data = request.data if isinstance(request.data, dict) else {}
    if data.get("customer_code") or data.get("CardCode"):
        action = data.get("action", "")
        # If user explicitly requested save_draft, save locally without SAP posting
        if action == "save_draft":
            try:
                draft = service.save_or_update_draft(
                    user=request.user,
                    draft_id=data.get("draft_id") or data.get("id"),
                    customer_code=data.get("customer_code") or data.get("CardCode"),
                    customer_name=data.get("customer_name") or data.get("CardName") or "",
                    doc_date=data.get("doc_date") or data.get("DocDate"),
                    doc_due_date=data.get("doc_due_date") or data.get("DocDueDate"),
                    comments=data.get("comments") or data.get("Comments") or "",
                    lines_data=data.get("lines") or [],
                    currency=data.get("currency") or data.get("DocCurrency"),
                    payment_group_code=data.get("payment_group_code") or data.get("PaymentGroupCode"),
                    sales_person_code=data.get("sales_person_code") or data.get("SalesPersonCode"),
                    wrapping=data.get("wrapping") or data.get("U_Wrapping"),
                    tax_date=data.get("tax_date") or data.get("TaxDate"),
                    doc_rate=data.get("exchange_rate") or data.get("DocRate"),
                    header_fields=data.get("header_fields") or {},
                    submit=False,
                )
                log_action(
                    request=request,
                    action=ACTION_CREATE,
                    module=AUDIT_MODULE_CUSTOMIZATION,
                    entity_type="CustomizationDraft",
                    entity_id=draft.id,
                    description=f"Saved Sales Quotation Draft #{draft.id} (Customer: {draft.customer_code})",
                )
                return Response({
                    "success": True,
                    "draft": _serialize_draft(draft),
                    "message": f"Draft #{draft.id} saved successfully.",
                }, status=status.HTTP_201_CREATED)
            except (CustomizationStateError, ValueError) as exc:
                return Response({"success": False, "error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            except Exception as exc:
                logger.exception("Error saving Sales Quotation Draft")
                return Response({"success": False, "error": f"Failed to save draft: {str(exc)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # Direct SAP Quotation Creation (SAP-First)
        customer_code = data.get("customer_code") or data.get("CardCode")
        customer_name = data.get("customer_name") or data.get("CardName") or ""
        doc_date = data.get("doc_date") or data.get("DocDate")
        doc_due_date = data.get("doc_due_date") or data.get("DocDueDate")
        tax_date = data.get("tax_date") or data.get("TaxDate")
        doc_rate = data.get("exchange_rate") or data.get("DocRate")
        comments = data.get("comments") or data.get("Comments") or ""
        currency = data.get("currency") or data.get("DocCurrency") or data.get("DocCur")
        payment_group_code = data.get("payment_group_code") or data.get("PaymentGroupCode")
        sales_person_code = data.get("sales_person_code") or data.get("SalesPersonCode")
        wrapping = data.get("wrapping") or data.get("U_Wrapping")
        lines = data.get("lines") or []
        header_fields = data.get("header_fields") or {}

        if not lines:
            return Response({"success": False, "error": "At least one item line is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            draft_id = data.get("draft_id") or data.get("id")
            if draft_id:
                with transaction.atomic():
                    existing = CustomizationDraft.objects.select_for_update().filter(id=draft_id).first()
                    if existing and existing.quotation_doc_entry:
                        return Response({
                            "success": True,
                            "draft": _serialize_draft(existing),
                            "quotation_doc_entry": existing.quotation_doc_entry,
                            "quotation_doc_num": existing.quotation_doc_num,
                            "message": f"Sales Quotation #{existing.quotation_doc_num} is already created in SAP.",
                        }, status=status.HTTP_200_OK)
                    if existing:
                        draft = service.post_quotation_to_sap(draft=existing, user=request.user)
                        log_action(
                            request=request,
                            action=ACTION_CREATE,
                            module=AUDIT_MODULE_CUSTOMIZATION,
                            entity_type="CustomizationDraft",
                            entity_id=draft.id,
                            description=f"Created Sales Quotation #{draft.quotation_doc_num} in SAP for Draft #{draft.id}",
                        )
                        return Response({
                            "success": True,
                            "draft": _serialize_draft(draft),
                            "quotation_doc_entry": draft.quotation_doc_entry,
                            "quotation_doc_num": draft.quotation_doc_num,
                            "message": f"Sales Quotation #{draft.quotation_doc_num} created successfully in SAP Business One.",
                        }, status=status.HTTP_201_CREATED)

            draft = service.create_quotation_and_draft(
                user=request.user,
                customer_code=customer_code,
                customer_name=customer_name,
                doc_date=doc_date,
                doc_due_date=doc_due_date,
                comments=comments,
                lines_data=lines,
                currency=currency,
                payment_group_code=payment_group_code,
                sales_person_code=sales_person_code,
                wrapping=wrapping,
                tax_date=tax_date,
                doc_rate=doc_rate,
                header_fields=header_fields,
            )
            log_action(
                request=request,
                action=ACTION_CREATE,
                module=AUDIT_MODULE_CUSTOMIZATION,
                entity_type="CustomizationDraft",
                entity_id=draft.id,
                description=f"Created Sales Quotation #{draft.quotation_doc_num} directly in SAP Business One for Customer {draft.customer_code}",
            )
            return Response({
                "success": True,
                "draft": _serialize_draft(draft),
                "quotation_doc_entry": draft.quotation_doc_entry,
                "quotation_doc_num": draft.quotation_doc_num,
                "message": f"Sales Quotation #{draft.quotation_doc_num} created successfully in SAP Business One.",
            }, status=status.HTTP_201_CREATED)
        except (CustomizationStateError, ValueError) as exc:
            return Response({"success": False, "error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except CustomizationPostingError as exc:
            return Response({"success": False, "error": exc.message, "sap_response": exc.sap_response, "is_ambiguous": exc.is_ambiguous}, status=status.HTTP_502_BAD_GATEWAY)
        except Exception as exc:
            logger.exception("Unexpected error creating sales quotation in SAP")
            return Response({"success": False, "error": f"Internal error: {str(exc)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    quotation_doc_entry = data.get("quotation_doc_entry")
    if not quotation_doc_entry:
        return Response({"success": False, "error": "Customer code or quotation_doc_entry is required."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        quotation_entry_int = int(quotation_doc_entry)
    except (ValueError, TypeError):
        return Response({"success": False, "error": "Invalid quotation_doc_entry."}, status=status.HTTP_400_BAD_REQUEST)

    lines_data = data.get("lines")
    try:
        draft = service.create_draft(
            user=request.user,
            quotation_doc_entry=quotation_entry_int,
            lines_data=lines_data,
        )
        log_action(
            request=request,
            action=ACTION_CREATE,
            module=AUDIT_MODULE_CUSTOMIZATION,
            entity_type="CustomizationDraft",
            entity_id=draft.id,
            description=f"Created Customization Draft #{draft.id} for Quotation #{draft.quotation_doc_num}",
        )
        return Response({"success": True, "draft": _serialize_draft(draft)}, status=status.HTTP_201_CREATED)
    except (CustomizationStateError, ValueError) as exc:
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as exc:
        logger.exception("Error creating Customization Draft")
        return Response({"success": False, "error": f"Failed to initialize customization: {str(exc)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["GET", "PUT", "DELETE"])
@require_module_access(MODULE_CUSTOMIZATION)
def customization_draft_detail(request, draft_id):
    """
    GET: Retrieve full CustomizationDraft details.
    PUT: Update line customizations while in editable status.
    DELETE: Delete draft while in DRAFT or REJECTED status.
    """
    draft = get_object_or_404(
        CustomizationDraft.objects.prefetch_related("lines").select_related(
            "created_by", "internal_reviewed_by", "customer_approval_recorded_by", "order_posted_by"
        ),
        id=draft_id,
    )

    if request.method == "GET":
        return Response({"success": True, "draft": _serialize_draft(draft)})

    if request.method == "DELETE":
        if draft.status not in [CustomizationDraft.STATUS_DRAFT, CustomizationDraft.STATUS_INTERNAL_REJECTED]:
            return Response({"success": False, "error": f"Cannot delete draft in status '{draft.status}'."}, status=status.HTTP_400_BAD_REQUEST)
        draft_id_val = draft.id
        draft.delete()
        log_action(
            request=request,
            action=ACTION_DELETE if "ACTION_DELETE" in dir() else ACTION_UPDATE,
            module=AUDIT_MODULE_CUSTOMIZATION,
            entity_type="CustomizationDraft",
            entity_id=draft_id_val,
            description=f"Deleted Customization Draft #{draft_id_val}",
        )
        return Response({"success": True, "message": "Draft deleted successfully."})

    # PUT
    data = request.data if isinstance(request.data, dict) else {}
    lines_data = data.get("lines")
    if lines_data is None or not isinstance(lines_data, list):
        return Response({"success": False, "error": "lines list is required."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        service = CustomizationService()
        updated_draft = service.update_draft(draft=draft, lines_data=lines_data, user=request.user)
        log_action(
            request=request,
            action=ACTION_UPDATE,
            module=AUDIT_MODULE_CUSTOMIZATION,
            entity_type="CustomizationDraft",
            entity_id=updated_draft.id,
            description=f"Updated line customizations for Draft #{updated_draft.id}",
        )
        return Response({"success": True, "draft": _serialize_draft(updated_draft)})
    except (CustomizationStateError, ValueError) as exc:
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["POST"])
@require_module_access(MODULE_CUSTOMIZATION)
def submit_customization_draft(request, draft_id):
    """Submit customization draft for internal manager review."""
    draft = get_object_or_404(CustomizationDraft, id=draft_id)
    try:
        service = CustomizationService()
        updated = service.submit_for_internal_review(draft=draft, user=request.user)
        log_action(
            request=request,
            action=ACTION_UPDATE,
            module=AUDIT_MODULE_CUSTOMIZATION,
            entity_type="CustomizationDraft",
            entity_id=updated.id,
            description=f"Submitted Customization Draft #{updated.id} for internal review",
        )
        return Response({"success": True, "draft": _serialize_draft(updated)})
    except (CustomizationStateError, ValueError) as exc:
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["POST"])
@require_module_admin(MODULE_CUSTOMIZATION)
def approve_customization_draft(request, draft_id):
    """Manager approves customization draft and posts to SAP if not yet created."""
    draft = get_object_or_404(CustomizationDraft, id=draft_id)
    data = request.data if isinstance(request.data, dict) else {}
    notes = data.get("notes", "")

    try:
        service = CustomizationService()
        updated = service.approve_internal_review(draft=draft, user=request.user, notes=notes)
        doc_info = f" (Quotation #{updated.quotation_doc_num})" if updated.quotation_doc_num else ""
        log_action(
            request=request,
            action=ACTION_APPROVE,
            module=AUDIT_MODULE_CUSTOMIZATION,
            entity_type="CustomizationDraft",
            entity_id=updated.id,
            description=f"Approved Customization Draft #{updated.id} internally{doc_info}",
        )
        return Response({
            "success": True,
            "draft": _serialize_draft(updated),
            "message": f"Sales Quotation Draft #{updated.id} approved internally.",
        })
    except (CustomizationStateError, ValueError) as exc:
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except CustomizationPostingError as exc:
        return Response({"success": False, "error": exc.message, "sap_response": exc.sap_response, "is_ambiguous": exc.is_ambiguous}, status=status.HTTP_502_BAD_GATEWAY)
    except Exception as exc:
        logger.exception("Error approving customization draft")
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["POST"])
@require_module_admin(MODULE_CUSTOMIZATION)
def reject_customization_draft(request, draft_id):
    """Manager rejects customization draft."""
    draft = get_object_or_404(CustomizationDraft, id=draft_id)
    data = request.data if isinstance(request.data, dict) else {}
    reason = data.get("reason", "")

    try:
        service = CustomizationService()
        updated = service.reject_internal_review(draft=draft, user=request.user, reason=reason)
        log_action(
            request=request,
            action=ACTION_REJECT,
            module=AUDIT_MODULE_CUSTOMIZATION,
            entity_type="CustomizationDraft",
            entity_id=updated.id,
            description=f"Rejected Customization Draft #{updated.id}: {reason}",
        )
        return Response({"success": True, "draft": _serialize_draft(updated)})
    except (CustomizationStateError, ValueError) as exc:
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["POST"])
@require_module_access(MODULE_CUSTOMIZATION)
def patch_quotation_to_sap(request, draft_id):
    """
    Executes same-quotation update via PATCH /b1s/v1/Quotations(<DocEntry>).
    Performs pre-flight external change detection before dispatching.
    """
    draft = get_object_or_404(CustomizationDraft, id=draft_id)
    try:
        service = CustomizationService()
        updated = service.patch_sap_quotation(draft=draft, user=request.user)
        log_action(
            request=request,
            action=ACTION_UPDATE,
            module=AUDIT_MODULE_CUSTOMIZATION,
            entity_type="CustomizationDraft",
            entity_id=updated.id,
            description=f"Successfully synchronized Customization Draft #{updated.id} to SAP Quotation #{updated.quotation_doc_num}",
        )
        return Response({"success": True, "draft": _serialize_draft(updated)})
    except (CustomizationStateError, ValueError) as exc:
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except CustomizationPostingError as exc:
        return Response({"success": False, "error": exc.message, "sap_response": exc.sap_response, "is_ambiguous": exc.is_ambiguous}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(["POST"])
@require_module_access(MODULE_CUSTOMIZATION)
def record_customer_approval(request, draft_id):
    """
    Customer Approval Gate: Employee records customer's PO / signed document / email confirmation.
    """
    draft = get_object_or_404(CustomizationDraft, id=draft_id)
    data = request.data if isinstance(request.data, dict) else {}

    approval_type = data.get("approval_type", "")
    reference_number = data.get("reference_number", "")
    contact_person = data.get("contact_person", "")
    notes = data.get("notes", "")

    try:
        service = CustomizationService()
        updated = service.record_customer_approval(
            draft=draft,
            user=request.user,
            approval_type=approval_type,
            reference_number=reference_number,
            contact_person=contact_person,
            notes=notes,
        )
        doc_info = f" - Created SAP Sales Quotation #{updated.quotation_doc_num} (DocEntry: {updated.quotation_doc_entry})" if updated.quotation_doc_num else ""
        log_action(
            request=request,
            action=ACTION_APPROVE,
            module=AUDIT_MODULE_CUSTOMIZATION,
            entity_type="CustomizationDraft",
            entity_id=updated.id,
            description=f"Recorded Customer Approval for Draft #{updated.id} ({approval_type}: {reference_number}){doc_info}",
        )
        return Response({
            "success": True,
            "draft": _serialize_draft(updated),
            "message": f"Customer approval recorded successfully.{f' Sales Quotation #{updated.quotation_doc_num} created in SAP.' if updated.quotation_doc_num else ''}",
        })
    except (CustomizationStateError, ValueError) as exc:
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except CustomizationPostingError as exc:
        return Response({"success": False, "error": exc.message, "sap_response": exc.sap_response, "is_ambiguous": exc.is_ambiguous}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(["POST"])
@require_module_access(MODULE_CUSTOMIZATION)
def create_sales_order(request, draft_id):
    """
    Explicit action to generate native SAP Sales Order (ORDR) with BaseType: 23 linkage.
    """
    draft = get_object_or_404(CustomizationDraft, id=draft_id)
    data = request.data if isinstance(request.data, dict) else {}
    doc_due_date = data.get("doc_due_date")

    try:
        service = CustomizationService()
        updated = service.post_sales_order_to_sap(
            draft=draft,
            user=request.user,
            doc_due_date=doc_due_date,
            customer_reference_number=data.get("customer_reference_number") or data.get("reference_number"),
        )
        log_action(
            request=request,
            action=ACTION_POST,
            module=AUDIT_MODULE_CUSTOMIZATION,
            entity_type="CustomizationDraft",
            entity_id=updated.id,
            description=f"Created SAP Sales Order #{updated.sap_order_doc_num} from Customization Draft #{updated.id}",
        )
        return Response({"success": True, "draft": _serialize_draft(updated)})
    except (CustomizationStateError, ValueError) as exc:
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except CustomizationPostingError as exc:
        return Response({"success": False, "error": exc.message, "sap_response": exc.sap_response, "is_ambiguous": exc.is_ambiguous}, status=status.HTTP_502_BAD_GATEWAY)

@api_view(['GET'])
@require_module_access(MODULE_CUSTOMIZATION)
def quotation_posting_status(request, request_key):
    from .services.sales_posting_journal import SalesPostingJournal
    service = CustomizationService()
    journal = SalesPostingJournal(request.user, service.sap_client, 'Quotations', request_key)
    record = journal.scope().filter(entity_id=request_key).order_by('-id').first()
    if not record:
        return Response({'state': 'NOT_STARTED'})
    if not record.details.get('request'):
        return Response({'state': 'VERIFYING', 'error': 'Verify this existing draft through its quotation review workflow.'}, status=202)
    try:
        draft = service.create_quotation_and_draft(user=request.user, request_key=request_key, **record.details['request'])
        return Response({'state': 'CONFIRMED', 'success': True, 'draft': _serialize_draft(draft),
                         'quotation_doc_entry': draft.quotation_doc_entry, 'quotation_doc_num': draft.quotation_doc_num})
    except CustomizationPostingError as error:
        return Response({'state': 'VERIFYING' if error.is_ambiguous else 'REJECTED', 'error': str(error), 'is_ambiguous': error.is_ambiguous}, status=202 if error.is_ambiguous else 502)


_OCTG_TERMS_CACHE = {}
_PAYMENT_TERMS_DETAILS_CACHE = {}

def _get_octg_terms_map(sap):
    global _OCTG_TERMS_CACHE
    if not _OCTG_TERMS_CACHE:
        try:
            sql = 'SELECT T0."GroupNum", T0."PymntGroup" FROM "OCTG" T0 ORDER BY T0."GroupNum"'
            sap.ensure_sql_query("GET_OCTG_TERMS", "Get Payment Terms", sql)
            res = sap.execute_sql_query("GET_OCTG_TERMS")
            for row in res.get("value", []):
                _OCTG_TERMS_CACHE[row.get("GroupNum")] = row.get("PymntGroup")
        except Exception as exc:
            logger.warning(f"Error fetching OCTG terms: {exc}")
    return _OCTG_TERMS_CACHE


def _get_payment_terms_details(sap):
    global _PAYMENT_TERMS_DETAILS_CACHE
    if not _PAYMENT_TERMS_DETAILS_CACHE:
        result = sap._request(
            "GET",
            "PaymentTermsTypes?$select=GroupNumber,PaymentTermsGroupName,NumberOfAdditionalMonths,NumberOfAdditionalDays&$top=200",
        )
        for row in result.get("value", []) if isinstance(result, dict) else []:
            group_number = row.get("GroupNumber")
            if group_number is not None:
                _PAYMENT_TERMS_DETAILS_CACHE[group_number] = row
    return _PAYMENT_TERMS_DETAILS_CACHE


@api_view(["POST"])
@require_module_access(MODULE_CUSTOMIZATION)
def create_sales_quotation_and_draft(request):
    """
    Direct SAP Creation (SAP-First) Entry Point:
    Takes customer, dates, comments, lines -> posts directly to SAP Sales Quotations -> saves local CustomizationDraft (STATUS_READY_FOR_ORDER).
    """
    data = request.data if isinstance(request.data, dict) else {}
    customer_code = data.get("customer_code") or data.get("CardCode")
    customer_name = data.get("customer_name") or data.get("CardName") or ""
    doc_date = data.get("doc_date") or data.get("DocDate")
    doc_due_date = data.get("doc_due_date") or data.get("DocDueDate")
    tax_date = data.get("tax_date") or data.get("TaxDate")
    doc_rate = data.get("exchange_rate") or data.get("DocRate")
    comments = data.get("comments") or data.get("Comments") or ""
    currency = data.get("currency") or data.get("DocCurrency") or data.get("DocCur")
    payment_group_code = data.get("payment_group_code") or data.get("PaymentGroupCode")
    sales_person_code = data.get("sales_person_code") or data.get("SalesPersonCode")
    wrapping = data.get("wrapping") or data.get("U_Wrapping")
    lines = data.get("lines") or []
    header_fields = data.get("header_fields") or {}

    if not customer_code:
        return Response({"success": False, "error": "Customer code is required."}, status=status.HTTP_400_BAD_REQUEST)
    if not lines:
        return Response({"success": False, "error": "At least one item line is required."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        service = CustomizationService()
        draft_id = data.get("draft_id") or data.get("id")

        if draft_id:
            with transaction.atomic():
                existing = CustomizationDraft.objects.select_for_update().filter(id=draft_id).first()
                if existing and existing.quotation_doc_entry:
                    return Response({
                        "success": True,
                        "draft": _serialize_draft(existing),
                        "quotation_doc_entry": existing.quotation_doc_entry,
                        "quotation_doc_num": existing.quotation_doc_num,
                        "message": f"Sales Quotation #{existing.quotation_doc_num} is already created in SAP.",
                    }, status=status.HTTP_200_OK)
                if existing:
                    draft = service.post_quotation_to_sap(draft=existing, user=request.user)
                    log_action(
                        request=request,
                        action=ACTION_CREATE,
                        module=AUDIT_MODULE_CUSTOMIZATION,
                        entity_type="CustomizationDraft",
                        entity_id=draft.id,
                        description=f"Created Sales Quotation #{draft.quotation_doc_num} in SAP for Draft #{draft.id}",
                    )
                    return Response({
                        "success": True,
                        "draft": _serialize_draft(draft),
                        "quotation_doc_entry": draft.quotation_doc_entry,
                        "quotation_doc_num": draft.quotation_doc_num,
                        "message": f"Sales Quotation #{draft.quotation_doc_num} created successfully in SAP Business One.",
                    }, status=status.HTTP_201_CREATED)

        draft = service.create_quotation_and_draft(
            user=request.user,
            customer_code=customer_code,
            customer_name=customer_name,
            doc_date=doc_date,
            doc_due_date=doc_due_date,
            comments=comments,
            lines_data=lines,
            currency=currency,
            payment_group_code=payment_group_code,
            sales_person_code=sales_person_code,
            wrapping=wrapping,
            tax_date=tax_date,
            doc_rate=doc_rate,
            header_fields=header_fields,
            request_key=data.get('request_key') or hashlib.sha256(json.dumps(data, sort_keys=True, default=str).encode()).hexdigest(),
        )
        log_action(
            request=request,
            action=ACTION_CREATE,
            module=AUDIT_MODULE_CUSTOMIZATION,
            entity_type="CustomizationDraft",
            entity_id=draft.id,
            description=f"Created Sales Quotation #{draft.quotation_doc_num} directly in SAP Business One for Customer {draft.customer_code}",
        )
        return Response({
            "success": True,
            "draft": _serialize_draft(draft),
            "quotation_doc_entry": draft.quotation_doc_entry,
            "quotation_doc_num": draft.quotation_doc_num,
            "message": f"Sales Quotation #{draft.quotation_doc_num} created successfully in SAP Business One.",
        }, status=status.HTTP_201_CREATED)
    except (CustomizationStateError, ValueError) as exc:
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except CustomizationPostingError as exc:
        return Response({"success": False, "error": exc.message, "sap_response": exc.sap_response, "is_ambiguous": exc.is_ambiguous}, status=status.HTTP_502_BAD_GATEWAY)
    except Exception as exc:
        logger.exception("Unexpected error creating sales quotation in SAP")
        return Response({"success": False, "error": f"Internal error: {str(exc)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["GET"])
@require_module_access(MODULE_CUSTOMIZATION)
def list_sales_customers(request):
    """
    Search or list active customers from SAP BusinessPartners (CardType eq 'cCustomer').
    Filters out inactive/frozen and NULL/blank name records.
    Supports server-side search, pagination, and returns currency, price list, payment terms, and contact persons.
    """
    from .services.master_data_search import is_lookup, lookup_parameters, lookup_offset, literal
    lookup = is_lookup(request)
    search = request.query_params.get("search", "").strip()
    exact_code = ""
    if lookup:
        try:
            search, exact_code, lookup_limit = lookup_parameters(request)
            lookup_skip = lookup_offset(request)
        except ValueError as exc:
            return Response({"success": False, "error": str(exc)}, status=400)
        if not exact_code and len(search) < 2:
            return Response({"success": True, "customers": []})
    try:
        page = max(1, int(request.query_params.get("page", 1)))
    except (ValueError, TypeError):
        page = 1
    try:
        page_size = min(max(1, int(request.query_params.get("page_size", 5000))), 5000)
    except (ValueError, TypeError):
        page_size = 50
    if lookup:
        page_size, page = lookup_limit, 1
    skip = (page - 1) * page_size
    if lookup:
        skip = lookup_skip

    try:
        sap = SAPServiceLayer()
        namespace = sap_master_namespace("sales-customers")
        cache_key = build_cache_key(namespace, "lookup-code-case-v2", search, exact_code, page_size, skip) if lookup else build_cache_key(namespace)

        def load_all_customers():
            endpoint = (
                "BusinessPartners?$select=CardCode,CardName,CardType,Currency,PriceListNum,"
                "PayTermsGrpCode,SalesPersonCode,BPAddresses,ShipToDefault,BilltoDefault"
                "&$filter=CardType eq 'cCustomer' and Valid eq 'tYES' and Frozen eq 'tNO'"
                "&$orderby=CardCode asc"
            )
            if lookup:
                from urllib.parse import parse_qsl, urlencode
                # SAP contains() is case-sensitive and this Service Layer rejects
                # tolower(). Keep the original text for names/mixed-case codes,
                # and include uppercase codes so typing cx finds CX customers.
                code_queries = list(dict.fromkeys([search, search.upper(), search.lower()]))
                clauses = [f"contains(CardCode, {literal(query)})" for query in code_queries]
                clauses.append(f"contains(CardName, {literal(search)})")
                condition = f"CardCode eq {literal(exact_code)}" if exact_code else "(" + " or ".join(clauses) + ")"
                entity, parameters = endpoint.split("?", 1)
                parameters = dict(parse_qsl(parameters))
                parameters["$filter"] += f" and {condition}"
                parameters["$top"] = page_size
                parameters["$skip"] = skip
                endpoint = entity + "?" + urlencode(parameters)
            rows = []
            seen = set()
            headers = {"Prefer": "odata.maxpagesize=1000"}
            while endpoint:
                if endpoint in seen:
                    raise RuntimeError("SAP customer pagination returned a repeated nextLink.")
                seen.add(endpoint)
                result = sap._request("GET", endpoint, headers=headers)
                if not isinstance(result, dict) or result.get("error"):
                    error = result.get("error", {}) if isinstance(result, dict) else {}
                    message = error.get("message") if isinstance(error, dict) else str(error)
                    raise RuntimeError(message or "SAP customer query failed.")
                rows.extend(result.get("value") or [])
                if lookup and len(rows) >= page_size:
                    rows = rows[:page_size]
                    break
                next_link = result.get("odata.nextLink") or result.get("@odata.nextLink")
                if next_link and next_link.startswith("http"):
                    endpoint = next_link.split("/b1s/v2/")[-1]
                else:
                    endpoint = str(next_link or "").lstrip("/") or None

            octg_terms = _get_octg_terms_map(sap)
            payment_terms_details = _get_payment_terms_details(sap)

            normalized = []
            for c in rows:
                card_code = c.get("CardCode")
                card_name = (c.get("CardName") or "").strip()
                if not card_name:
                    continue

                pay_terms_code = c.get("PayTermsGrpCode")
                pay_terms_name = octg_terms.get(pay_terms_code, f"Terms {pay_terms_code}" if pay_terms_code is not None else None)
                terms_detail = payment_terms_details.get(pay_terms_code, {})

                normalized.append({
                    "card_code": card_code,
                    "card_name": card_name,
                    "currency": c.get("Currency", "EGP"),
                    "price_list_num": c.get("PriceListNum", 1),
                    "payment_group_code": pay_terms_code,
                    "payment_terms_name": pay_terms_name,
                    "payment_terms_additional_days": terms_detail.get("NumberOfAdditionalDays", 0),
                    "payment_terms_additional_months": terms_detail.get("NumberOfAdditionalMonths", 0),
                    "sales_person_code": c.get("SalesPersonCode"),
                    "ship_to_default": c.get("ShipToDefault") or "",
                    "bill_to_default": c.get("BilltoDefault") or "",
                    "addresses": [
                        {
                            "name": address.get("AddressName") or "",
                            "type": address.get("AddressType"),
                            "street": address.get("Street") or "",
                            "block": address.get("Block") or "",
                            "city": address.get("City") or "",
                            "zip_code": address.get("ZipCode") or "",
                            "county": address.get("County") or "",
                            "country": address.get("Country") or "",
                            "full_address": ", ".join(filter(None, [
                                address.get("Street"), address.get("Block"), address.get("City"),
                                address.get("ZipCode"), address.get("County"), address.get("Country"),
                            ])),
                        }
                        for address in (c.get("BPAddresses") or [])
                        if address.get("AddressName")
                    ],
                })
            return normalized

        all_customers = cache_get_or_set(namespace, cache_key, load_all_customers, "sap_customers")
        if not isinstance(all_customers, list):
            raise RuntimeError("SAP customer master data response was invalid.")

        if search and not lookup:
            needle = search.casefold()
            filtered_customers = [
                customer for customer in all_customers
                if needle in str(customer.get("card_code") or "").casefold()
                or needle in str(customer.get("card_name") or "").casefold()
            ]
        else:
            filtered_customers = all_customers
        customers = filtered_customers[:page_size] if lookup else filtered_customers[skip:skip + page_size]

        return Response({
            "success": True,
            "customers": customers,
            "page": page,
            "page_size": page_size,
            "has_more": skip + page_size < len(filtered_customers),
            **({"next_offset": skip + len(customers) if len(customers) == page_size else None} if lookup else {}),
        })
    except Exception as exc:
        logger.exception("Error fetching customers from SAP")
        return Response(
            {"success": False, "error": "Unable to load customers from SAP."},
            status=status.HTTP_502_BAD_GATEWAY,
        )


@api_view(["GET"])
@require_module_access(MODULE_CUSTOMIZATION)
def list_sales_items(request):
    """
    Search or list sellable inventory items from SAP.
    Enforces SalesItem eq 'tYES', Valid eq 'tYES', Frozen eq 'tNO'.
    Supports server-side search, pagination, and derives unit price from customer's price list.
    """
    from .services.master_data_search import is_lookup, lookup_parameters, lookup_offset
    if is_lookup(request):
        try:
            query, code, bound = lookup_parameters(request)
            lookup_skip = lookup_offset(request)
        except ValueError as exc:
            return Response({"success": False, "error": str(exc)}, status=400)
        if not code and len(query) < 2:
            return Response({"success": True, "items": []})
    search = request.query_params.get("search", "").strip()
    price_list = request.query_params.get("price_list")
    try:
        page = max(1, int(request.query_params.get("page", 1)))
    except (ValueError, TypeError):
        page = 1
    try:
        page_size = min(max(1, int(request.query_params.get("page_size", 50))), 100)
    except (ValueError, TypeError):
        page_size = 50
    if is_lookup(request):
        page_size, page = bound, 1
    skip = (page - 1) * page_size
    if is_lookup(request):
        skip = lookup_skip

    try:
        sap = SAPServiceLayer()

        filters = ["SalesItem eq 'tYES'", "Valid eq 'tYES'", "Frozen eq 'tNO'"]
        if is_lookup(request) and code:
            filters.append("ItemCode eq '" + code.replace("'", "''") + "'")
        elif search:
            safe_search = search.replace("'", "''")
            filters.append(f"(contains(ItemCode, '{safe_search}') or contains(ItemName, '{safe_search}'))")

        filter_str = " and ".join(filters)
        endpoint = (
            f"Items?$select=ItemCode,ItemName,SalesUnit,InventoryUOM,ItemsGroupCode,DefaultWarehouse,ItemPrices,UoMGroupEntry,DefaultSalesUoMEntry,SalesVATGroup"
            f"&$filter={filter_str}&$orderby=ItemCode asc&$skip={skip}&$top={page_size}"
        )
        if is_lookup(request):
            from urllib.parse import urlencode
            endpoint = "Items?" + urlencode({"$select": "ItemCode,ItemName,SalesUnit,InventoryUOM,ItemsGroupCode,DefaultWarehouse,ItemPrices,UoMGroupEntry,DefaultSalesUoMEntry,SalesVATGroup",
                                             "$filter": filter_str, "$orderby": "ItemCode asc", "$skip": skip, "$top": page_size})

        result = sap._request("GET", endpoint)
        if result.get("error"):
            raise RuntimeError("SAP item search failed")
        raw_items = result.get("value") or []

        items = []
        for it in raw_items:
            item_code = it.get("ItemCode")
            item_name = it.get("ItemName") or item_code
            sales_uom = it.get("SalesUnit") or it.get("InventoryUOM") or "PCS"
            uom_entry = it.get("DefaultSalesUoMEntry")
            prices = it.get("ItemPrices") or []

            # Derive unit price based on target price list
            unit_price = 0.0
            price_cur = None
            target_list_num = int(price_list) if price_list not in (None, "") else 1

            for p in prices:
                if p.get("PriceList") == target_list_num:
                    p_val = p.get("Price")
                    if p_val not in (None, "", 0, 0.0):
                        unit_price = float(p_val)
                        price_cur = p.get("Currency")
                    break

            items.append({
                "item_code": item_code,
                "item_name": item_name,
                "sales_unit": sales_uom,
                "uom": sales_uom,
                "inventory_uom": it.get("InventoryUOM") or sales_uom,
                "uom_entry": uom_entry,
                "default_warehouse": it.get("DefaultWarehouse") or "",
                "default_price": unit_price,
                "price_currency": price_cur,
                "sales_vat_group": it.get("SalesVATGroup") or "",
                "prices": [
                    {"price_list": p.get("PriceList"), "price": p.get("Price"), "currency": p.get("Currency")}
                    for p in prices
                    if p.get("Price") not in (None, "", 0, 0.0)
                ],
                "items_group_code": it.get("ItemsGroupCode"),
                "sell_item": True,
                "valid": True,
                "frozen": False,
            })

        return Response({
            "success": True,
            "items": items,
            "page": page,
            "page_size": page_size,
            "has_more": len(raw_items) >= page_size,
            **({"next_offset": skip + len(items) if len(raw_items) >= page_size else None} if is_lookup(request) else {}),
        })
    except Exception as exc:
        logger.warning(f"Error fetching items from SAP: {exc}")
        return Response({"success": True, "items": [], "page": page, "page_size": page_size, "has_more": False})


@api_view(["GET"])
@require_module_access(MODULE_CUSTOMIZATION)
def sales_quotation_metadata(request):
    """Return the live SAP UDF definitions used by the quotation wizard."""
    try:
        namespace = sap_master_namespace("sales-quotation-metadata-v2")
        cache_key = build_cache_key(namespace)

        def loader():
            sap = SAPServiceLayer()

            def field(table_name, field_id):
                return sap._request("GET", f"UserFieldsMD(TableName='{table_name}',FieldID={field_id})")

            def normalized(meta):
                return {
                    "name": f"U_{meta.get('Name')}",
                    "description": meta.get("Description") or meta.get("Name"),
                    "type": meta.get("Type"),
                    "mandatory": meta.get("Mandatory") == "tYES",
                    "default": meta.get("DefaultValue"),
                    "max_length": meta.get("EditSize"),
                    "options": [
                        {"value": row.get("Value"), "label": row.get("Description") or row.get("Value")}
                        for row in (meta.get("ValidValuesMD") or [])
                    ],
                }

            return {
                "success": True,
                "line_fields": {
                    "brand": normalized(field("QUT1", 11)),
                    "size": normalized(field("QUT1", 6)),
                    "pallets": normalized(field("QUT1", 7)),
                    "container_no": normalized(field("QUT1", 8)),
                    "packed": normalized(field("QUT1", 9)),
                    "defect": normalized(field("QUT1", 10)),
                },
                "header_fields": {
                    "incoterms": normalized(field("OQUT", 1)),
                    "notify": normalized(field("OQUT", 3)),
                    "shipping_line": normalized(field("OQUT", 5)),
                    "pol": normalized(field("OQUT", 6)),
                    "pod": normalized(field("OQUT", 7)),
                    "container_count": normalized(field("OQUT", 28)),
                    "lc_number": normalized(field("OQUT", 42)),
                    "dhl": normalized(field("OQUT", 43)),
                    "contract_no": normalized(field("OQUT", 44)),
                    "etd": normalized(field("OQUT", 45)),
                    "eta": normalized(field("OQUT", 46)),
                    "week_no": normalized(field("OQUT", 48)),
                    "header_uom": normalized(field("OQUT", 54)),
                },
                "system_fields": {
                    "shipping_types": [
                        {"value": row.get("Code"), "label": row.get("Name") or str(row.get("Code"))}
                        for row in (sap._request("GET", "ShippingTypes?$select=Code,Name&$orderby=Code").get("value") or [])
                    ],
                },
            }

        payload = cache_get_or_set(namespace, cache_key, loader, "sap_quotation_metadata")
        return Response(payload)
    except Exception as exc:
        logger.exception("Error fetching Sales Quotation UDF metadata from SAP")
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(["GET"])
@require_module_access(MODULE_CUSTOMIZATION)
def sales_quotation_context(request):
    """Return SAP-derived document context that depends on currency and posting date."""
    currency = str(request.query_params.get("currency") or "").strip()
    doc_date = str(request.query_params.get("date") or "").strip()
    if not currency or not doc_date:
        return Response({"success": False, "error": "currency and date are required."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        sap = SAPServiceLayer()
        local_currency_result = sap._request("GET", "CompanyService_GetAdminInfo")
        local_currency = str(local_currency_result.get("LocalCurrency") or "EGP")
        if currency == local_currency:
            exchange_rate = 1.0
        else:
            rate_result = sap._request("POST", "SBOBobService_GetCurrencyRate", {"Currency": currency, "Date": doc_date})
            if isinstance(rate_result, dict) and rate_result.get("error"):
                raise ValueError(rate_result["error"].get("message") or "SAP exchange rate is unavailable.")
            exchange_rate = float(rate_result)
        return Response({
            "success": True,
            "currency": currency,
            "local_currency": local_currency,
            "date": doc_date,
            "exchange_rate": exchange_rate,
        })
    except Exception as exc:
        logger.warning("Error loading SAP quotation context: %s", exc)
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

