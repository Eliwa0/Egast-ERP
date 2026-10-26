from django.db import DatabaseError
from django.core.exceptions import ObjectDoesNotExist
from rest_framework.decorators import api_view
from rest_framework.response import Response

from api.models import ShippingOperation, PendingReceiptBatch
from api.role_permissions import MODULE_TRANSFER, MODULE_DELIVERY, require_module_access, can_manage_transfer
from api.services import shipping_service as service
from api.services.delivery_posting_service import DeliveryStateError
from api.services.sap_service import SAPServiceLayer
from scale.models import ScaleItemElement
from scale.models import ScaleDraft


def manifest_dict(op, commercial=False):
    draft = op.scale_draft
    pallets = []
    manifest_pallets = list(op.pallets.select_related('pallet_element', 'box_element').order_by('id'))
    receipt_batches = {}
    for batch in PendingReceiptBatch.objects.filter(
            batch_number__in=[p.batch_number for p in manifest_pallets],
            pending_receipt__status='POSTED').select_related('pending_receipt').order_by('-id'):
        receipt_batches.setdefault((batch.batch_number, batch.pending_receipt.item_code), batch)
    for p in manifest_pallets:
        batch = receipt_batches.get((p.batch_number, p.item_code))
        row = {'item_code': p.item_code, 'item_name': p.item_name, 'pallet_count': 1,
               'batch_number': p.batch_number,
               'attributes': {key: getattr(batch, key, '') if batch else ''
                              for key in ('brand', 'size', 'category', 'packing', 'season', 'extra_specification')},
               'box_count': p.box_count, 'pallet_element_id': p.pallet_element_id,
               'box_element_id': p.box_element_id, 'pallet_type': p.pallet_element.name,
               'box_type': p.box_element.name, 'pallet_unit_weight': str(p.pallet_unit_weight),
               'box_unit_weight': str(p.box_unit_weight),
               'deduction_weight': str(p.pallet_unit_weight + p.box_count * p.box_unit_weight)}
        if commercial:
            row.update(batch.production_pallet if batch else {})
            row.update({'batch_number': p.batch_number, 'order_line_number': p.order_line_number,
                        'quantity': str(p.quantity), 'uom': p.uom, 'source_warehouse': p.source_warehouse,
                        'bin_code': p.bin_code, 'loaded': bool(p.loading_event_id)})
        pallets.append(row)
    result = {'id': op.pk, 'scale_draft_id': draft.pk, 'ticket_number': draft.draft_number,
              'sales_order_number': (op.order_snapshot or {}).get('doc_num'),
              'vehicle_number': draft.effective_vehicle_number, 'driver_name': draft.effective_driver_name,
              'container_number': op.container_number, 'status': op.status, 'revision': op.revision,
              'pallets': pallets, 'first_weight': str(draft.weight_empty),
              'gross_weight': str(draft.weight_loaded) if draft.weight_loaded is not None else None,
              'net_weight': str(draft.product_weight) if draft.product_weight is not None else None,
              'pallet_count': len(pallets), 'box_count': sum(row['box_count'] for row in pallets),
              'deduction_weight': str(sum((p.pallet_unit_weight + p.box_count * p.box_unit_weight for p in op.pallets.all()), service.Decimal(0)))}
    if commercial:
        result.update({'order': op.order_snapshot, 'sales_order_doc_entry': op.sales_order_doc_entry,
                       'delivery_id': op.delivery_id, 'delivery_status': op.delivery.status if op.delivery_id else None,
                       'delivery_sap_doc_num': op.delivery.sap_doc_num if op.delivery_id else None,
                       'containers': list(draft.containers.values_list('container_number', flat=True)) or [draft.container_number]})
    return result


def error_response(exc):
    if isinstance(exc, service.ShippingTransferPending):
        return Response({'error': str(exc), 'code': 'PENDING_SAP_TRANSFER',
                         'batch_number': exc.batch, 'pending_transfers': exc.transfers}, status=409)
    if isinstance(exc, PermissionError):
        return Response({'error': str(exc)}, status=403)
    if isinstance(exc, ObjectDoesNotExist):
        return Response({'error': 'Shipping operation or packaging element not found.'}, status=404)
    if isinstance(exc, (DatabaseError, RuntimeError)):
        return Response({'error': 'Shipping operation could not be saved. Previous state preserved.'}, status=503)
    return Response({'error': str(exc)}, status=400)


ERRORS = (ValueError, TypeError, KeyError, ObjectDoesNotExist, PermissionError, DatabaseError, RuntimeError, DeliveryStateError)


def operations():
    return ShippingOperation.objects.filter(company_scope=service.company_scope()).exclude(
        scale_draft__status='CANCELLED').select_related('scale_draft', 'delivery').order_by('-id')


@api_view(['GET'])
@require_module_access(MODULE_TRANSFER)
def shipping_list(request):
    try:
        offset = max(0, int(request.query_params.get('offset', 0)))
        rows = operations()
        return Response({'operations': [manifest_dict(op, True) for op in rows[offset:offset + 50]],
                         'count': rows.count(), 'next_offset': offset + 50 if rows.count() > offset + 50 else None})
    except ERRORS as exc:
        return error_response(exc)


@api_view(['POST'])
@require_module_access(MODULE_TRANSFER)
def shipping_discover(request):
    # Adopt only open outbound empty-container tickets; historical weighings stay untouched.
    for draft in ScaleDraft.objects.filter(start_type='empty', truck_type='container',
            status='SECOND_WEIGHT_PENDING', is_closed=False, quotation__isnull=True,
            shipping_operation__isnull=True):
        service.create_for_scale(draft)
    return Response({'success': True})


@api_view(['GET', 'PUT'])
@require_module_access(MODULE_TRANSFER)
def shipping_detail(request, pk):
    try:
        op = operations().get(pk=pk) if request.method == 'GET' else service.save_manifest(pk, request.data, request.user, request)
        return Response({'operation': manifest_dict(op, True)})
    except ERRORS as exc:
        return error_response(exc)


@api_view(['POST'])
@require_module_access(MODULE_TRANSFER)
def shipping_action(request, pk, action):
    try:
        if action == 'reopen' and not can_manage_transfer(request.user):
            raise PermissionError('Transfer administrator is required to reopen a submitted manifest.')
        fn = service.reopen_manifest if action == 'reopen' else service.submit_manifest
        op = fn(pk, request.data.get('revision', -1), request.user, request)
        return Response({'operation': manifest_dict(op, True)})
    except ERRORS as exc:
        return error_response(exc)


@api_view(['GET'])
@require_module_access(MODULE_TRANSFER)
def shipping_source(request, batch):
    try:
        return Response({'source': service.source_details(batch, request.user)})
    except ERRORS as exc:
        return error_response(exc)


@api_view(['GET'])
@require_module_access(MODULE_TRANSFER)
def shipping_elements(request):
    return Response({'elements': [{'id': e.pk, 'name': e.name, 'weight': str(e.weight), 'item_code': e.item_code}
                                 for e in ScaleItemElement.objects.filter(is_active=True)]})


@api_view(['GET'])
@require_module_access(MODULE_TRANSFER)
def shipping_order(request, entry):
    try:
        return Response({'order': service.order_detail(entry)})
    except ERRORS as exc:
        return error_response(exc)


@api_view(['GET'])
@require_module_access(MODULE_TRANSFER)
def shipping_orders(request):
    try:
        offset = max(0, int(request.query_params.get('offset', 0)))
        response = SAPServiceLayer().get_sales_orders(document_status='bost_Open', top=50, skip=offset)
        if not isinstance(response, dict) or response.get('error'):
            raise ValueError('Sales orders could not be loaded.')
        return Response({'orders': [{'doc_entry': row['DocEntry'], 'doc_num': row.get('DocNum'),
                         'customer_name': row.get('CardName', '')} for row in response.get('value', [])],
                         'next_offset': offset + 50 if response.get('odata.nextLink') or response.get('@odata.nextLink') else None})
    except ERRORS as exc:
        return error_response(exc)


@api_view(['GET'])
@require_module_access(MODULE_DELIVERY)
def shipping_delivery_list(request):
    try:
        offset = max(0, int(request.query_params.get('offset', 0)))
        rows = operations().filter(status__in=['WEIGHED', 'DELIVERY_CREATED'])
        return Response({'operations': [manifest_dict(op, True) for op in rows[offset:offset + 50]],
                         'next_offset': offset + 50 if rows.count() > offset + 50 else None})
    except ERRORS as exc:
        return error_response(exc)


@api_view(['POST'])
@require_module_access(MODULE_DELIVERY)
def shipping_create_delivery(request, pk):
    try:
        draft = service.create_delivery(pk, request.user, request)
        return Response({'delivery_id': draft.pk, 'sales_order_doc_entry': draft.sales_order_doc_entry})
    except ERRORS as exc:
        return error_response(exc)
