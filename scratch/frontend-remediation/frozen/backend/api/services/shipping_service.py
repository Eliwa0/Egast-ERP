"""Outbound handoff; SAP delivery posting remains in the existing delivery service."""
from collections import defaultdict
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone

from api.models import ShippingOperation, ShippingPallet, ColdStorageBinLayout, TransferWarehouseRule, PendingTransferBatchGuard, PendingReceiptBatch
from api.role_permissions import can_manage_transfer
from api.services.audit_service import log_action, ACTION_UPDATE, MODULE_TRANSFER
from api.services.physical_transfer_service import company_scope, identifier, latest_posted_transfer, load
from api.services.sap_service import SAPServiceLayer
from api.services.delivery_posting_service import DeliveryPostingService, calculate_line_open_quantity
from scale.models import ScaleDraftElement, ScaleItemElement


def number(value, label):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError(f'{label}: invalid number.')
    if not result.is_finite() or result <= 0:
        raise ValueError(f'{label}: must be positive.')
    return result


def audit(operation, actor, action, request=None):
    if log_action(user=actor, request=request, action=ACTION_UPDATE, module=MODULE_TRANSFER,
                  entity_type='ShippingOperation', entity_id=str(operation.pk), description=action,
                  details={'revision': operation.revision, 'status': operation.status}) is None:
        raise RuntimeError('Shipping audit could not be recorded.')


def create_for_scale(draft):
    if draft.start_type == 'empty' and draft.truck_type == 'container' and not draft.quotation_id:
        return ShippingOperation.objects.get_or_create(scale_draft=draft, defaults={
            'company_scope': company_scope(), 'container_number': draft.container_number,
        })[0]


def order_detail(entry, sap=None):
    order = (sap or SAPServiceLayer()).get_sales_order(int(entry))
    if not order or order.get('error') or order.get('DocumentStatus') == 'bost_Close':
        raise ValueError('Sales order unavailable or closed.')
    return {'doc_entry': int(order['DocEntry']), 'doc_num': str(order.get('DocNum', entry)),
            'customer_code': order.get('CardCode', ''), 'customer_name': order.get('CardName', ''),
            'lines': [{'line_number': int(line['LineNum']), 'item_code': line.get('ItemCode', ''),
                       'item_name': line.get('ItemDescription', ''),
                       'uom': line.get('UoMCode') or line.get('UomCode') or line.get('MeasureUnit') or '',
                       'open_quantity': calculate_line_open_quantity(line)}
                      for line in order.get('DocumentLines', []) if calculate_line_open_quantity(line) > 0]}


class ShippingTransferPending(ValueError):
    def __init__(self, batch, transfers):
        self.batch = batch
        self.transfers = transfers
        super().__init__('Batch has an outstanding SAP transfer operation.')


def source_details(batch, actor):
    batch = identifier(batch, 'batch_number')
    source = latest_posted_transfer(batch)
    warehouse = source.to_warehouse
    if not can_manage_transfer(actor) and not TransferWarehouseRule.objects.filter(user=actor, is_active=True,
            stage=TransferWarehouseRule.STAGE_5_TO_CONTAINER, direction='FROM', warehouse_code=warehouse).exists():
        raise PermissionError('Stage 5 loading rules do not allow this source warehouse.')
    pending = list(PendingTransferBatchGuard.objects.filter(normalized_batch_number=batch.replace(' ', '')).values('transfer_id', 'transfer_stage', 'transfer__status'))
    if pending:
        raise ShippingTransferPending(batch, pending)
    rows = [line for line in source.lines or [] if isinstance(line, dict) and
            str(line.get('batch_number', '')).strip().upper() == batch]
    line = rows[0] if rows else {'item_code': source.item_code, 'quantity': source.quantity}
    layout = ColdStorageBinLayout.objects.filter(warehouse_code=warehouse, bin_code=source.to_bin).first()
    receipt_batch = PendingReceiptBatch.objects.filter(batch_number=batch,
        pending_receipt__item_code=line.get('item_code', source.item_code),
        pending_receipt__status='POSTED').order_by('-id').first()
    return {'batch_number': batch, 'item_code': line.get('item_code', source.item_code),
            'quantity': str(line.get('quantity', source.quantity)), 'source_warehouse': warehouse,
            'bin_code': source.to_bin or '', 'bin_abs_entry': layout.sap_bin_abs_entry if layout else None,
            **(receipt_batch.production_pallet if receipt_batch else {})}


@transaction.atomic
def save_manifest(pk, data, actor, request=None):
    op = ShippingOperation.objects.select_for_update().get(pk=pk, company_scope=company_scope())
    if op.status not in ('WAITING', 'LOADING') or op.scale_draft.is_closed or op.scale_draft.is_certified_locked:
        raise ValueError('Manifest is locked. Reopen it before editing.')
    if int(data.get('revision', -1)) != op.revision:
        raise ValueError('Manifest changed. Refresh before saving.')
    order = order_detail(data.get('sales_order_doc_entry'))
    if op.submitted_at and order['doc_entry'] != op.sales_order_doc_entry:
        raise ValueError('The order cannot change after loading.')
    containers = list(op.scale_draft.containers.values_list('container_number', flat=True))
    if op.scale_draft.container_number:
        containers.append(op.scale_draft.container_number)
    container = identifier(data.get('container_number'), 'container_number')
    if container not in {str(value).strip().upper() for value in containers}:
        raise ValueError('Container must match the container recorded at the first weight.')
    rows = data.get('pallets')
    if not isinstance(rows, list) or not rows or len(rows) > 200:
        raise ValueError('Provide between 1 and 200 pallet rows.')
    previous = {p.batch_number: p for p in op.pallets.select_related('loading_event')}
    lines = {line['line_number']: line for line in order['lines']}
    seen, totals, prepared = set(), defaultdict(Decimal), []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('Each pallet must be a valid manifest row.')
        batch = identifier(row.get('batch_number'), 'batch_number')
        if batch in seen:
            raise ValueError('Duplicate pallet batch.')
        seen.add(batch)
        line_num = int(row.get('order_line_number', -1))
        line = lines.get(line_num)
        source = source_details(batch, actor)
        if not line or line['item_code'] != source['item_code']:
            raise ValueError('Pallet item must match the selected sales order line.')
        qty = number(row.get('quantity'), 'Quantity')
        if qty != number(source['quantity'], 'Source quantity'):
            raise ValueError('A pallet must use its full recorded source quantity; partial pallet loading is not supported.')
        count = number(row.get('box_count'), 'Box count')
        if count != count.to_integral_value() or count > 100000:
            raise ValueError('Box count must be a positive whole number.')
        pallet_element = ScaleItemElement.objects.get(pk=row.get('pallet_element_id'), is_active=True)
        box_element = ScaleItemElement.objects.get(pk=row.get('box_element_id'), is_active=True)
        if pallet_element.weight < 0 or box_element.weight < 0:
            raise ValueError('Packaging weights cannot be negative.')
        prior = previous.get(batch)
        if prior and prior.loading_event_id and (prior.order_line_number != line_num or
                prior.source_warehouse != source['source_warehouse'] or prior.quantity != qty or container != op.container_number):
            raise ValueError('Loaded pallet identity, quantity and container cannot change.')
        totals[line_num] += qty
        prepared.append((batch, dict(order_line_number=line_num, item_code=line['item_code'], item_name=line['item_name'],
            quantity=qty, uom=line['uom'], source_warehouse=source['source_warehouse'], bin_code=source['bin_code'],
            bin_abs_entry=source['bin_abs_entry'], pallet_element=pallet_element, box_element=box_element,
            box_count=int(count), pallet_unit_weight=pallet_element.weight, box_unit_weight=box_element.weight)))
    if any(p.loading_event_id and batch not in seen for batch, p in previous.items()):
        raise ValueError('Loaded pallets cannot be removed from the manifest.')
    for line_num, qty in totals.items():
        if qty > Decimal(str(lines[line_num]['open_quantity'])):
            raise ValueError('Manifest quantity exceeds the sales order open quantity.')
    op.pallets.exclude(batch_number__in=seen).delete()
    for batch, fields in prepared:
        ShippingPallet.objects.update_or_create(operation=op, batch_number=batch, defaults=fields)
    op.sales_order_doc_entry, op.order_snapshot, op.container_number = order['doc_entry'], order, container
    op.status = 'LOADING'
    op.revision += 1
    op.save()
    audit(op, actor, 'Saved loading manifest', request)
    return op


@transaction.atomic
def submit_manifest(pk, revision, actor, request=None):
    op = ShippingOperation.objects.select_for_update().get(pk=pk, company_scope=company_scope())
    if op.status != 'LOADING' or op.revision != int(revision) or not op.pallets.exists():
        raise ValueError('Save the current loading manifest before submitting.')
    # Refresh open quantities and packaging just before freezing the manifest.
    rows = [{'batch_number': p.batch_number, 'order_line_number': p.order_line_number, 'quantity': str(p.quantity),
             'box_count': p.box_count, 'pallet_element_id': p.pallet_element_id, 'box_element_id': p.box_element_id}
            for p in op.pallets.all()]
    op = save_manifest(pk, {'revision': op.revision, 'sales_order_doc_entry': op.sales_order_doc_entry,
                          'container_number': op.container_number, 'pallets': rows}, actor, request)
    op.scale_draft.draft_elements.filter(stage='loaded').delete()
    for pallet in op.pallets.all():
        if not pallet.loading_event_id:
            _, event = load(pallet.batch_number, op.container_number, actor, request, source_warehouse=pallet.source_warehouse)
            pallet.loading_event = event
            pallet.save(update_fields=['loading_event'])
        for element, count, weight in [(pallet.pallet_element, 1, pallet.pallet_unit_weight),
                                      (pallet.box_element, pallet.box_count, pallet.box_unit_weight)]:
            ScaleDraftElement.objects.create(draft=op.scale_draft, stage='loaded', action='remove',
                item_element=element, count=count, unit_weight=weight)
    op.status, op.submitted_at, op.submitted_by = 'READY', timezone.now(), actor
    op.revision += 1
    op.save()
    audit(op, actor, 'Submitted loading manifest to scale', request)
    return op


@transaction.atomic
def reopen_manifest(pk, revision, actor, request=None):
    op = ShippingOperation.objects.select_for_update().get(pk=pk, company_scope=company_scope())
    if op.status != 'READY' or op.revision != int(revision) or op.scale_draft.is_certified_locked:
        raise ValueError('Only an unweighed submitted manifest can be reopened.')
    op.status = 'LOADING'
    op.revision += 1
    op.save()
    audit(op, actor, 'Reopened manifest; second weight blocked', request)
    return op


@transaction.atomic
def create_delivery(pk, actor, request=None, sap=None):
    op = ShippingOperation.objects.select_for_update().select_related('scale_draft').get(pk=pk, company_scope=company_scope())
    if op.delivery_id:
        return op.delivery
    if op.status != 'WEIGHED' or not op.scale_draft.is_certified_locked or not op.scale_draft.product_weight or op.scale_draft.product_weight <= 0:
        raise ValueError('A certified positive second weight is required.')
    grouped = {}
    for pallet in op.pallets.all():
        line = grouped.setdefault(pallet.order_line_number, {'line_number': pallet.order_line_number,
            'warehouse_code': pallet.source_warehouse, 'delivery_quantity': Decimal(0), 'batches': []})
        if line['warehouse_code'] != pallet.source_warehouse:
            raise ValueError('A delivery line must use one source warehouse.')
        line['delivery_quantity'] += pallet.quantity
        line['batches'].append({'batch_number': pallet.batch_number, 'quantity': float(pallet.quantity),
                               'bin_code': pallet.bin_code, 'bin_abs_entry': pallet.bin_abs_entry})
    for line in grouped.values():
        line['delivery_quantity'] = float(line['delivery_quantity'])
    draft = DeliveryPostingService(sap_client=sap).create_draft(actor, op.sales_order_doc_entry,
        lines_data=list(grouped.values()), doc_date=timezone.localdate(),
        comments=f'Shipping #{op.pk}; scale {op.scale_draft.draft_number}; container {op.container_number}; net {op.scale_draft.product_weight} kg')
    op.delivery, op.status = draft, 'DELIVERY_CREATED'
    op.save()
    audit(op, actor, 'Created delivery draft from certified manifest', request)
    return draft


def assert_delivery_manifest(draft, overrides=None):
    """Certified cargo stays fixed; delivery users may still set dates and costing."""
    op = ShippingOperation.objects.filter(delivery=draft).select_related('scale_draft').first()
    if not op:
        return
    if not op.scale_draft.is_certified_locked or op.status != 'DELIVERY_CREATED':
        raise ValueError('Delivery requires a certified shipping manifest.')
    expected = {}
    for p in op.pallets.all():
        row = expected.setdefault(p.order_line_number, {'quantity': Decimal(0), 'warehouse': p.source_warehouse, 'batches': []})
        row['quantity'] += p.quantity
        row['batches'].append((p.batch_number, p.quantity, p.bin_code, p.bin_abs_entry))
    updates = {int(row.get('line_number', row.get('LineNum'))): row for row in overrides or []}
    def batch_key(row):
        return (str(row['batch_number']).strip(), Decimal(str(row['quantity'])).quantize(Decimal('0.000001')),
                str(row.get('bin_code') or '').strip(), int(row['bin_abs_entry']) if row.get('bin_abs_entry') else None)
    for line in draft.lines.all():
        change = updates.get(line.line_number, {})
        wanted = expected.get(line.line_number, {'quantity': Decimal(0), 'warehouse': line.warehouse_code, 'batches': []})
        quantity = Decimal(str(change.get('delivery_quantity', line.delivery_quantity)))
        warehouse = str(change.get('warehouse_code', line.warehouse_code)).strip()
        batches = change.get('batches', list(line.batches.values('batch_number', 'quantity', 'bin_code', 'bin_abs_entry')))
        if not quantity.is_finite() or abs(quantity - wanted['quantity']) > Decimal('0.000001') or warehouse != wanted['warehouse']:
            raise ValueError('Certified shipping quantities and source warehouse cannot be edited in Delivery.')
        actual = sorted(batch_key(row) for row in batches)
        wanted_batches = sorted((batch, qty.quantize(Decimal('0.000001')), code, entry) for batch, qty, code, entry in wanted['batches'])
        if actual != wanted_batches:
            raise ValueError('Certified shipping batch and bin allocations cannot be edited in Delivery.')
