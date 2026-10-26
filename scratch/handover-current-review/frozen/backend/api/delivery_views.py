import logging
from typing import Any, Dict
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from api.models_delivery import DeliveryDraft, DeliveryDraftLine, DeliveryDraftBatch
from api.models import PendingReceiptBatch
from api.role_permissions import (
    MODULE_DELIVERY,
    MODULE_CUSTOMIZATION,
    can_manage_module,
    require_module_access,
    require_module_admin,
)
from api.services.audit_service import (
    ACTION_APPROVE,
    ACTION_CREATE,
    ACTION_POST,
    ACTION_RECONCILE,
    ACTION_REJECT,
    ACTION_UPDATE,
    MODULE_DELIVERY as AUDIT_MODULE_DELIVERY,
    log_action,
)
from api.services.delivery_posting_service import (
    DeliveryPostingError,
    DeliveryPostingService,
    DeliveryStateError,
)

logger = logging.getLogger(__name__)


@api_view(['GET'])
@require_module_access(MODULE_DELIVERY)
def delivery_review_report(request):
    from django.http import StreamingHttpResponse
    from .services.delivery_review_report import report_page, report_lines, report_groups, print_report_rows
    from .services.workflow_pagination import workflow_bounds, workflow_metadata
    try:
        field = request.query_params.get('field')
        if field:
            group = {'customers': 'byCustomer', 'items': 'byItem', 'salesOrders': 'bySalesOrder'}.get(field)
            if not group:
                raise ValueError('Invalid report lookup field.')
            # Lookup options come from all posted documents, independent of visible pages.
            query = report_groups(report_lines({}), group)
            search = request.query_params.get('search', '').strip()[:150]
            if search:
                query = query.filter(Q(key__icontains=search) | Q(label__icontains=search))
            size, offset = workflow_bounds({'page_size': request.query_params.get('limit', 25), 'offset': request.query_params.get('offset', 0)})
            count = query.count()
            metadata = workflow_metadata({'page_size': size, 'offset': offset}, count)
            return Response({'options': list(query[offset:offset + size]), 'has_more': metadata['has_more'], 'next_offset': offset + size if metadata['has_more'] else None})
        report_lines(request.query_params)  # Validate before starting a streaming response.
        if request.query_params.get('output') == 'print':
            return StreamingHttpResponse(print_report_rows(request.query_params), content_type='text/html; charset=utf-8')
        return Response({'success': True, 'report': report_page(request.query_params, _serialize_delivery_draft)})
    except ValueError as error:
        return Response({'success': False, 'error': str(error)}, status=400)


def _serialize_delivery_draft(draft: DeliveryDraft) -> Dict[str, Any]:
    from api.shipping_views import manifest_dict
    shipment = getattr(draft, 'shipping_operation', None)
    lines = []
    for line in draft.lines.all():
        batches = [
            {
                "id": b.id,
                "batch_number": b.batch_number,
                "quantity": b.quantity,
                "bin_abs_entry": b.bin_abs_entry,
                "bin_code": b.bin_code,
            }
            for b in line.batches.all()
        ]
        lines.append({
            "id": line.id,
            "line_number": line.line_number,
            "item_code": line.item_code,
            "item_description": line.item_description,
            "uom": line.uom,
            "order_quantity": line.order_quantity,
            "open_quantity_at_draft": line.open_quantity_at_draft,
            "delivery_quantity": line.delivery_quantity,
            "warehouse_code": line.warehouse_code,
            "cost_center_code": getattr(line, "cost_center_code", ""),
            "cost_center_code2": getattr(line, "cost_center_code2", ""),
            "batches": batches,
        })

    return {
        'shipping_manifest': manifest_dict(shipment, commercial=True) if shipment else None,
        "id": draft.id,
        "sales_order_doc_entry": draft.sales_order_doc_entry,
        "sales_order_doc_num": draft.sales_order_doc_num,
        "customer_code": draft.customer_code,
        "customer_name": draft.customer_name,
        "status": draft.status,
        "status_display": draft.get_status_display(),
        "doc_date": draft.doc_date.isoformat() if hasattr(draft.doc_date, "isoformat") else (str(draft.doc_date) if draft.doc_date else None),
        "doc_due_date": draft.doc_due_date.isoformat() if hasattr(draft.doc_due_date, "isoformat") else (str(draft.doc_due_date) if draft.doc_due_date else None),
        "comments": draft.comments,
        "cost_center_1": getattr(draft, "cost_center_1", ""),
        "cost_center_2": getattr(draft, "cost_center_2", ""),
        "cost_center_3": getattr(draft, "cost_center_3", ""),
        "sap_doc_entry": draft.sap_doc_entry,
        "sap_doc_num": draft.sap_doc_num,
        "created_by": draft.created_by.username if draft.created_by else None,
        "created_at": draft.created_at.isoformat() if draft.created_at else None,
        "updated_at": draft.updated_at.isoformat() if draft.updated_at else None,
        "reviewed_by": draft.reviewed_by.username if draft.reviewed_by else None,
        "reviewed_at": draft.reviewed_at.isoformat() if draft.reviewed_at else None,
        "rejection_reason": draft.rejection_reason,
        "posted_by": draft.posted_by.username if draft.posted_by else None,
        "posted_at": draft.posted_at.isoformat() if draft.posted_at else None,
        "sap_error": draft.sap_error,
        "lines": lines,
    }


@api_view(['GET'])
@require_module_access(MODULE_DELIVERY)
def posted_delivery_document(request, doc_entry):
    from .services.sap_service import SAPServiceLayer
    from .services.sales_document_normalizer import normalize_delivery_header, normalize_sales_line, sap_local_currency
    sap = SAPServiceLayer()
    result = sap._request('GET', f'DeliveryNotes({doc_entry})')
    if not isinstance(result, dict) or result.get('error') or not result.get('DocEntry'):
        return Response({'error': 'Unable to read the posted Delivery document.'}, status=502)
    try:
        local_currency = sap_local_currency(sap)
    except ValueError as exc:
        return Response({'error': str(exc)}, status=502)
    document = normalize_delivery_header(result, local_currency)
    document['lines'] = [normalize_sales_line(line, result.get('DocCurrency'), local_currency) for line in result.get('DocumentLines', [])]
    document['remarks'] = result.get('Comments') or ''
    return Response({'success': True, 'document': document})


@api_view(["GET", "POST"])
@require_module_access(MODULE_DELIVERY)
def list_or_create_delivery_drafts(request):
    """
    GET: List DeliveryDrafts with optional filtering by status, search, or sales_order_doc_entry.
    POST: Initialize a new DeliveryDraft from an open SAP Sales Order.
    """
    service = DeliveryPostingService()

    if request.method == "GET":
        from .services.workflow_pagination import numeric_identifier
        try:
            for name in ['document', 'sales_order_doc_entry']:
                if request.query_params.get(name):
                    numeric_identifier(request.query_params[name], name)
        except ValueError as error:
            return Response({'success': False, 'error': str(error)}, status=400)
        qs = DeliveryDraft.objects.all().prefetch_related("lines__batches").select_related(
            "created_by", "reviewed_by", "posted_by", "shipping_operation__scale_draft", "shipping_operation__delivery"
        )
        status_filter = request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter.strip())

        so_entry = request.query_params.get("sales_order_doc_entry")
        if so_entry:
            qs = qs.filter(sales_order_doc_entry=so_entry)
        document = request.query_params.get('document')
        if document:
            qs = qs.filter(Q(sap_doc_num=document) | Q(sap_doc_entry=document) | Q(id=document))

        search = request.query_params.get("search")
        if search:
            s = search.strip()
            qs = qs.filter(
                Q(sales_order_doc_num__icontains=s) |
                Q(customer_code__icontains=s) |
                Q(customer_name__icontains=s) |
                Q(lines__item_code__icontains=s) |
                Q(lines__item_description__icontains=s) |
                Q(sap_doc_num__icontains=s)
            )

        from .services.workflow_pagination import workflow_page
        rows, pagination = workflow_page(qs, request.query_params, ['customer_code', 'customer_name', 'sales_order_doc_num', 'sap_doc_num', 'lines__item_code', 'lines__item_description'])
        drafts = [_serialize_delivery_draft(d) for d in rows]
        return Response({"success": True, "drafts": drafts, 'pagination': pagination})

    # POST - Create draft
    data = request.data if isinstance(request.data, dict) else {}
    so_doc_entry = data.get("sales_order_doc_entry")
    if not so_doc_entry:
        return Response({"success": False, "error": "sales_order_doc_entry is required."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        so_entry_int = int(so_doc_entry)
    except (ValueError, TypeError):
        return Response({"success": False, "error": "Invalid sales_order_doc_entry."}, status=status.HTTP_400_BAD_REQUEST)

    lines_data = data.get("lines")
    doc_date = data.get("doc_date")
    doc_due_date = data.get("doc_due_date")
    comments = data.get("comments", "")
    cost_center_1 = data.get("cost_center_1")
    cost_center_2 = data.get("cost_center_2")
    cost_center_3 = data.get("cost_center_3")

    try:
        draft = service.create_draft(
            user=request.user,
            sales_order_doc_entry=so_entry_int,
            lines_data=lines_data,
            doc_date=doc_date,
            doc_due_date=doc_due_date,
            comments=comments,
            cost_center_1=cost_center_1,
            cost_center_2=cost_center_2,
            cost_center_3=cost_center_3,
        )
        log_action(
            request=request,
            action=ACTION_CREATE,
            module=AUDIT_MODULE_DELIVERY,
            entity_type="DeliveryDraft",
            entity_id=draft.id,
            description=f"Created Delivery Draft #{draft.id} for Sales Order #{draft.sales_order_doc_num}",
        )
        return Response({"success": True, "draft": _serialize_delivery_draft(draft)}, status=status.HTTP_201_CREATED)
    except (DeliveryStateError, ValueError) as exc:
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as exc:
        logger.exception("Error creating Delivery Draft")
        return Response({"success": False, "error": f"Failed to initialize delivery draft: {str(exc)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["GET", "PUT"])
@require_module_access(MODULE_DELIVERY)
def delivery_draft_detail(request, draft_id):
    """
    GET: Retrieve full DeliveryDraft details including lines and batches.
    PUT: Update delivery quantities and batch allocations.
    """
    draft = get_object_or_404(
        DeliveryDraft.objects.prefetch_related("lines__batches").select_related(
            "created_by", "reviewed_by", "posted_by", "shipping_operation__scale_draft", "shipping_operation__delivery"
        ),
        id=draft_id,
    )

    if request.method == "GET":
        return Response({"success": True, "draft": _serialize_delivery_draft(draft)})

    # PUT
    data = request.data if isinstance(request.data, dict) else {}
    lines_data = data.get("lines")
    if lines_data is None or not isinstance(lines_data, list):
        return Response({"success": False, "error": "lines list is required."}, status=status.HTTP_400_BAD_REQUEST)

    comments = data.get("comments")
    doc_date = data.get("doc_date")
    doc_due_date = data.get("doc_due_date")
    cost_center_1 = data.get("cost_center_1")
    cost_center_2 = data.get("cost_center_2")
    cost_center_3 = data.get("cost_center_3")

    try:
        service = DeliveryPostingService()
        updated_draft = service.update_draft(
            draft=draft,
            lines_data=lines_data,
            user=request.user,
            comments=comments,
            doc_date=doc_date,
            doc_due_date=doc_due_date,
            cost_center_1=cost_center_1,
            cost_center_2=cost_center_2,
            cost_center_3=cost_center_3,
        )
        log_action(
            request=request,
            action=ACTION_UPDATE,
            module=AUDIT_MODULE_DELIVERY,
            entity_type="DeliveryDraft",
            entity_id=updated_draft.id,
            description=f"Updated line allocations for Delivery Draft #{updated_draft.id}",
        )
        return Response({"success": True, "draft": _serialize_delivery_draft(updated_draft)})
    except (DeliveryStateError, ValueError) as exc:
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["POST"])
@require_module_access(MODULE_DELIVERY)
def submit_delivery_draft(request, draft_id):
    """Submit delivery draft for manager review."""
    draft = get_object_or_404(DeliveryDraft, id=draft_id)
    try:
        service = DeliveryPostingService()
        updated = service.submit_for_review(draft=draft, user=request.user)
        log_action(
            request=request,
            action=ACTION_UPDATE,
            module=AUDIT_MODULE_DELIVERY,
            entity_type="DeliveryDraft",
            entity_id=updated.id,
            description=f"Submitted Delivery Draft #{updated.id} for review",
        )
        return Response({"success": True, "draft": _serialize_delivery_draft(updated)})
    except (DeliveryStateError, ValueError) as exc:
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["POST"])
@require_module_admin(MODULE_DELIVERY)
def approve_delivery_draft(request, draft_id):
    """Manager approves delivery draft for SAP posting."""
    draft = get_object_or_404(DeliveryDraft, id=draft_id)
    try:
        service = DeliveryPostingService()
        updated = service.approve_review(draft=draft, user=request.user)
        log_action(
            request=request,
            action=ACTION_APPROVE,
            module=AUDIT_MODULE_DELIVERY,
            entity_type="DeliveryDraft",
            entity_id=updated.id,
            description=f"Approved Delivery Draft #{updated.id} for posting",
        )
        return Response({"success": True, "draft": _serialize_delivery_draft(updated)})
    except (DeliveryStateError, ValueError) as exc:
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["POST"])
@require_module_admin(MODULE_DELIVERY)
def reject_delivery_draft(request, draft_id):
    """Manager rejects delivery draft."""
    draft = get_object_or_404(DeliveryDraft, id=draft_id)
    data = request.data if isinstance(request.data, dict) else {}
    reason = data.get("reason", "")

    try:
        service = DeliveryPostingService()
        updated = service.reject_review(draft=draft, user=request.user, reason=reason)
        log_action(
            request=request,
            action=ACTION_REJECT,
            module=AUDIT_MODULE_DELIVERY,
            entity_type="DeliveryDraft",
            entity_id=updated.id,
            description=f"Rejected Delivery Draft #{updated.id}: {reason}",
        )
        return Response({"success": True, "draft": _serialize_delivery_draft(updated)})
    except (DeliveryStateError, ValueError) as exc:
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["POST"])
@require_module_admin(MODULE_DELIVERY)
def post_delivery_to_sap(request, draft_id):
    """
    Posts native SAP Delivery Note (ODLN) with BaseType: 17 linkage.
    Re-verifies live OpenQty at post time.
    """
    draft = get_object_or_404(DeliveryDraft, id=draft_id)
    try:
        service = DeliveryPostingService()
        updated = service.post_delivery_to_sap(draft=draft, user=request.user)
        log_action(
            request=request,
            action=ACTION_POST,
            module=AUDIT_MODULE_DELIVERY,
            entity_type="DeliveryDraft",
            entity_id=updated.id,
            description=f"Posted SAP Delivery Note #{updated.sap_doc_num} from Draft #{updated.id}",
        )
        return Response({"success": True, "draft": _serialize_delivery_draft(updated)})
    except (DeliveryStateError, ValueError) as exc:
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except DeliveryPostingError as exc:
        return Response({"success": False, "error": exc.message, "sap_response": exc.sap_response}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(["POST"])
@require_module_access(MODULE_DELIVERY)
def reconcile_delivery_draft(request, draft_id):
    """Reconciles a failed/posting delivery draft against SAP."""
    draft = get_object_or_404(DeliveryDraft, id=draft_id)
    try:
        service = DeliveryPostingService()
        updated = service.reconcile_delivery(draft=draft)
        log_action(
            request=request,
            action=ACTION_RECONCILE,
            module=AUDIT_MODULE_DELIVERY,
            entity_type="DeliveryDraft",
            entity_id=updated.id,
            description=f"Reconciled Delivery Draft #{updated.id} against SAP",
        )
        return Response({"success": True, "draft": _serialize_delivery_draft(updated)})
    except Exception as exc:
        logger.exception("Error reconciling Delivery Draft")
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(["GET"])
@require_module_access(MODULE_DELIVERY)
def list_eligible_delivery_orders(request):
    return _workflow_orders_response(request)


@api_view(["GET"])
@require_module_access(MODULE_CUSTOMIZATION)
def list_workflow_sales_orders(request):
    """Sales Order cards for the Customization module, without Delivery rights."""
    return _workflow_orders_response(request)


def _workflow_orders_response(request):
    """
    Layer 3 Entry Point:
    Returns CARDS representing Sales Orders created through our workflow that still have RemainingOpenQuantity > 0.
    """
    from api.models_customization import CustomizationDraft
    from api.services.sap_service import SAPServiceLayer

    # Fetch all customization drafts that posted a sales order
    order_drafts = CustomizationDraft.objects.filter(
        status=CustomizationDraft.STATUS_ORDER_POSTED
    ).exclude(sap_order_doc_entry="").order_by("-updated_at")
    if request.query_params.get('draft_ids'):
        ids = request.query_params['draft_ids'].split(',')[:50]
        order_drafts = order_drafts.filter(id__in=[int(value) for value in ids if value.isdigit()])
    from .services.workflow_pagination import workflow_queryset, workflow_bounds, workflow_metadata, numeric_identifier
    try:
        for name in ['id', 'order_number']:
            if request.query_params.get(name):
                numeric_identifier(request.query_params[name], name)
        for value in request.query_params.get('draft_ids', '').split(','):
            if value:
                numeric_identifier(value, 'draft_ids')
    except ValueError as error:
        return Response({'success': False, 'error': str(error)}, status=400)
    if request.query_params.get('local_only') == 'true':
        order_drafts = order_drafts.filter(is_local_creation=True).exclude(sap_order_doc_num='').order_by('-created_at')
    if request.query_params.get('id'):
        order_drafts = order_drafts.filter(id=request.query_params['id'])
    if request.query_params.get('order_number'):
        order_drafts = order_drafts.filter(sap_order_doc_num=request.query_params['order_number'])
    order_drafts = workflow_queryset(order_drafts, request.query_params,
        ['customer_code', 'customer_name', 'sap_order_doc_num', 'quotation_doc_num', 'quotation_doc_entry', 'lines__item_code', 'lines__item_description'])

    sap_client = SAPServiceLayer()
    from .services.workflow_order_reads import read_candidate_orders
    order_drafts = list(order_drafts.prefetch_related('lines'))
    entries = [int(draft.sap_order_doc_entry) for draft in order_drafts]
    # Even a single screen can contain dozens of candidates. Batch these reads;
    # retain per-document fallback and full-set counts/eligibility below.
    candidate_orders = read_candidate_orders(sap_client, entries) if len(entries) > 1 else {}
    deliveries_by_order = {}
    for delivery in DeliveryDraft.objects.filter(sales_order_doc_entry__in=entries).prefetch_related('lines').order_by('-posted_at', '-id'):
        deliveries_by_order.setdefault(delivery.sales_order_doc_entry, []).append(delivery)
    cards = []

    for draft in order_drafts:
        doc_entry = int(draft.sap_order_doc_entry)
        doc_num = draft.sap_order_doc_num or str(doc_entry)

        total_ordered = 0.0
        total_open = 0.0
        items_list = []
        sap_error = None
        order_data = {}
        local_currency = None

        try:
            order_data = candidate_orders.get(doc_entry)
            if order_data is None:
                order_data = sap_client.get_sales_order(doc_entry)
            if isinstance(order_data, dict) and not order_data.get("error"):
                from .services.sales_document_normalizer import sap_local_currency
                if order_data.get("DocCurrency"):
                    local_currency = sap_local_currency(sap_client)
                doc_lines = order_data.get("DocumentLines") or []
                for l in doc_lines:
                    q = float(l.get("Quantity") or 0.0)
                    rem = float(l.get("RemainingOpenQuantity") if l.get("RemainingOpenQuantity") is not None else l.get("OpenQuantity", q))
                    total_ordered += q
                    total_open += rem
                    desc = l.get("ItemDescription") or l.get("ItemCode") or ""
                    if desc:
                        items_list.append(desc)
                doc_status = order_data.get("DocumentStatus", "bost_Open")
                if doc_status == "bost_Close":
                    total_open = 0.0
            else:
                sap_error = str(order_data.get("error") if isinstance(order_data, dict) else "Order not found in SAP")
        except Exception as exc:
            sap_error = str(exc)

        # Fallback if SAP read failed: calculate from draft lines and posted deliveries
        if total_ordered == 0.0:
            for line in draft.lines.all():
                if not line.is_selected:
                    continue
                total_ordered += float(line.customized_quantity)
                items_list.append(line.item_description or line.item_code)
            # Check posted deliveries for this order
            posted_lines = [line for delivery in deliveries_by_order.get(doc_entry, [])
                if delivery.status == DeliveryDraft.STATUS_POSTED for line in delivery.lines.all()]
            delivered_qty = sum(float(pl.delivery_quantity) for pl in posted_lines)
            total_open = max(0.0, total_ordered - delivered_qty)

        total_delivered = max(0.0, total_ordered - total_open)
        has_remaining = total_open > 0.0001

        # Extract order metadata from SAP or draft fallback
        order_date_raw = order_data.get("DocDate") if isinstance(order_data, dict) else None
        order_date = str(order_date_raw).split("T")[0] if order_date_raw else (draft.updated_at.strftime("%Y-%m-%d") if draft.updated_at else "")
        currency = (order_data.get("DocCurrency") if isinstance(order_data, dict) else None) or draft.currency or ""
        from .services.sales_document_normalizer import normalize_delivery_header, sap_local_currency
        sap_total = normalize_delivery_header(order_data, local_currency)["total_amount"] if isinstance(order_data, dict) and order_data.get("DocCurrency") else None
        doc_total = float(sap_total) if sap_total is not None else sum(
            float(line.customized_quantity or 0) * float(line.customized_unit_price or 0)
            * (1 - float(line.discount_percent or 0) / 100)
            for line in draft.lines.all() if line.is_selected
        )

        # Check posted deliveries for this order
        related_deliveries = deliveries_by_order.get(doc_entry, [])
        posted_deliveries_qs = [delivery for delivery in related_deliveries if delivery.status == DeliveryDraft.STATUS_POSTED]
        posted_deliveries_count = len(posted_deliveries_qs)
        posted_deliveries = [
            {
                "id": pd.id,
                "sap_doc_num": pd.sap_doc_num,
                "sap_doc_entry": pd.sap_doc_entry,
                "doc_date": pd.doc_date.isoformat() if hasattr(pd.doc_date, "isoformat") else str(pd.doc_date or ""),
            }
            for pd in posted_deliveries_qs[:10]
        ]

        # Check for in-flight delivery drafts
        active_draft = max((delivery for delivery in related_deliveries
            if delivery.status not in [DeliveryDraft.STATUS_POSTED, DeliveryDraft.STATUS_REJECTED]),
            key=lambda delivery: (delivery.created_at, delivery.id), default=None)

        cards.append({
            "customization_draft_id": draft.id,
            "sales_order_doc_entry": doc_entry,
            "sales_order_doc_num": doc_num,
            "quotation_doc_num": draft.quotation_doc_num,
            "customer_code": draft.customer_code,
            "customer_name": draft.customer_name,
            "order_date": order_date,
            "currency": currency,
            "doc_total": round(doc_total, 2),
            "ordered_quantity": round(total_ordered, 2),
            "delivered_quantity": round(total_delivered, 2),
            "remaining_open_quantity": round(total_open, 2),
            "has_remaining": has_remaining,
            "items_summary": ", ".join(items_list[:3]) + (f" (+{len(items_list)-3} more)" if len(items_list) > 3 else ""),
            "active_delivery_draft_id": active_draft.id if active_draft else None,
            "active_delivery_status": active_draft.status if active_draft else None,
            "deliveries_count": posted_deliveries_count,
            "posted_deliveries": posted_deliveries,
            "sap_error": sap_error,
        })

    # Support filtering: ?filter=active (default) or ?filter=all or ?filter=completed
    req_filter = request.query_params.get("filter", "active").lower()
    if req_filter == "active":
        filtered_cards = [c for c in cards if c["has_remaining"]]
    elif req_filter == "completed":
        filtered_cards = [c for c in cards if not c["has_remaining"]]
    else:
        filtered_cards = cards

    delivery_status = request.query_params.get('delivery_status', 'ALL')
    if delivery_status != 'ALL':
        def status_for(card):
            if card['delivered_quantity'] >= card['ordered_quantity'] and card['ordered_quantity'] > 0:
                return 'FULLY_DELIVERED'
            return 'PARTIAL' if card['delivered_quantity'] > 0 else 'NOT_DELIVERED'
        filtered_cards = [card for card in filtered_cards if status_for(card) == delivery_status]
    size, offset = workflow_bounds(request.query_params)
    pagination = workflow_metadata(request.query_params, len(filtered_cards))

    return Response({
        "success": True,
        "orders": filtered_cards[offset:offset + size],
        'pagination': pagination,
        "counts": {
            "total": len(cards),
            "active": len([c for c in cards if c["has_remaining"]]),
            "completed": len([c for c in cards if not c["has_remaining"]]),
        }
        , 'counts_scope': 'full_candidate_dataset'
    })


@api_view(["GET"])
@require_module_access(MODULE_DELIVERY)
def list_available_batches(request):
    """
    Fetch in-stock batches from SAP Business One for a given item and optional warehouse.
    Uses SAP SQL query CD_BATCHES_BY_ITEM (with fallback to CD_BATCHES_OBTQ).
    Filters out any batches with OnHandQty <= 0.
    """
    item_code = request.query_params.get("item_code", "").strip()
    warehouse_code = request.query_params.get("warehouse_code", "").strip()

    if not item_code:
        return Response(
            {"success": False, "error": "item_code query parameter is required", "batches": []},
            status=status.HTTP_400_BAD_REQUEST,
        )

    from .services.master_data_search import is_lookup, lookup_parameters, lookup_offset
    lookup = is_lookup(request)
    if lookup:
        try:
            query, exact_code, bound = lookup_parameters(request)
            offset = lookup_offset(request)
        except ValueError as exc:
            return Response({"success": False, "error": str(exc)}, status=400)
        if not exact_code and len(query) < 2:
            return Response({"success": True, "batches": []})

    try:
        from api.services.sap_service import SAPServiceLayer
        sap = SAPServiceLayer()

        clean_code = item_code.replace("'", "''")
        param_str = f"itemCode='{clean_code}'"
        rows = []

        try:
            result = sap.execute_sql_query("CD_BATCHES_BY_ITEM", param_str)
            if lookup and (not isinstance(result, dict) or result.get("error")):
                raise RuntimeError("Bin inventory query failed")
            rows = result.get("value") or []
        except Exception as q_exc:
            logger.info(f"CD_BATCHES_BY_ITEM execute notice: {q_exc}")

        # If no rows from bin query, fallback to OBTQ query
        if not rows:
            try:
                result_obtq = sap.execute_sql_query("CD_BATCHES_OBTQ", param_str)
                if lookup and (not isinstance(result_obtq, dict) or result_obtq.get("error")):
                    raise RuntimeError("Batch inventory query failed")
                rows = result_obtq.get("value") or []
            except Exception as q2_exc:
                if lookup:
                    raise
                logger.info(f"CD_BATCHES_OBTQ execute notice: {q2_exc}")

        batches = []
        for r in rows:
            row_whs = str(r.get("WhsCode") or "").strip()
            if warehouse_code and row_whs != warehouse_code:
                continue

            on_hand = float(r.get("OnHandQty") or 0.0)
            if on_hand <= 0:
                continue

            batch_number = str(r.get("BatchNumber") or "").strip()
            if lookup and (batch_number != exact_code if exact_code else query.casefold() not in batch_number.casefold()):
                continue
            batches.append({
                "item_code": r.get("ItemCode") or item_code,
                "batch_number": str(r.get("BatchNumber") or "").strip(),
                "warehouse_code": row_whs,
                "on_hand_qty": on_hand,
                "bin_abs_entry": r.get("BinAbsEntry"),
                "bin_code": r.get("BinCode") or "",
            })

        selected = batches[offset:offset + bound] if lookup else batches
        receipt_batches = {}
        for batch in PendingReceiptBatch.objects.filter(
                batch_number__in=[row['batch_number'] for row in selected],
                pending_receipt__status='POSTED').select_related('pending_receipt').order_by('-id'):
            receipt_batches.setdefault((batch.batch_number, batch.pending_receipt.item_code), batch)
        for row in selected:
            batch = receipt_batches.get((row['batch_number'], row['item_code']))
            if batch:
                row.update(batch.production_pallet)
        return Response({"success": True, "batches": selected,
                         **({"next_offset": offset + len(selected) if offset + len(selected) < len(batches) else None} if lookup else {})})
    except Exception as exc:
        logger.warning(f"Error fetching batches for item {item_code}: {exc}")
        if lookup:
            return Response({"success": False, "error": "Unable to search batch inventory."}, status=503)
        return Response({"success": True, "batches": []})

