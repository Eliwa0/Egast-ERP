"""Stages 4/5 mutate only local custody and append-only audit history."""
from django.db import IntegrityError, transaction
from django.db.models import F, Q
from api.models import PendingTransferRequest, PendingTransferBatchGuard, TransferPalletCustody, ShippingContainer, PhysicalTransferEvent, TransferWarehouseRule
from api.services.cache_service import sap_master_namespace
from api.services.audit_service import log_action, MODULE_TRANSFER, ACTION_UPDATE
from api.role_permissions import can_manage_transfer


class PhysicalTransferConflict(ValueError):
    pass


def company_scope():
    return sap_master_namespace('transfer-policy')


def identifier(value, field):
    if not isinstance(value, str):
        raise ValueError(f'{field} is required.')
    value = value.strip().upper()
    if not value or len(value) > 100 or any(not char.isprintable() for char in value):
        raise ValueError(f'{field} must be a valid identifier of at most 100 characters.')
    return value


def latest_posted_transfer(batch, *, lock=False):
    candidates = PendingTransferRequest.objects.filter(status='POSTED').filter(
        Q(batch_number__iexact=batch) | Q(lines__icontains=batch)).order_by(F('posted_at').desc(nulls_last=True), '-id')
    if lock:
        candidates = candidates.select_for_update()
    for row in candidates:
        numbers = [row.batch_number] + [line.get('batch_number') for line in (row.lines or []) if isinstance(line, dict)]
        if any(str(number or '').strip().upper() == batch for number in numbers):
            raw = row.raw_payload_json if isinstance(row.raw_payload_json, dict) else {}
            snapshot = raw.get('_transfer_policy')
            snapshot_scope = snapshot.get('company_scope') if isinstance(snapshot, dict) else None
            if snapshot_scope and snapshot_scope != company_scope():
                continue
            return row
    raise ValueError('Batch has no confirmed SAP transfer history.')


def loading_context(batch, pallet=None, *, lock=False):
    """Read the current local location; a newer posted move supersedes old hall custody."""
    source = latest_posted_transfer(batch, lock=lock)
    location = str(source.to_warehouse or '').strip()
    stage_parts = str(source.transfer_stage or '').split('_')
    state = f'STAGE_{stage_parts[1]}_COMPLETED' if len(stage_parts) > 1 and stage_parts[1] in ('1', '2', '3', '4') else 'TRANSFER_COMPLETED'
    if pallet:
        if pallet.state not in ('IN_SHIPPING_HALL', 'LOADED_TO_CONTAINER'):
            raise PhysicalTransferConflict('Batch physical state is not valid for loading.')
        if pallet.state == 'LOADED_TO_CONTAINER' or source.pk == pallet.source_transfer_id or not source.posted_at or source.posted_at <= pallet.updated_at:
            location, state = pallet.physical_location, pallet.state
    if not location:
        raise PhysicalTransferConflict('Batch current operational location is unavailable.')
    return source, location, state


def validate_arrival_source(batch, actor):
    row = latest_posted_transfer(batch)
    if row.transfer_stage != 'STAGE_3_FROM_FRIDGE' or not row.sap_doc_entry:
        raise PhysicalTransferConflict('Batch must complete Stage 3 before Shipping Hall arrival.')
    authorize_source(row, actor)
    if PendingTransferBatchGuard.objects.filter(normalized_batch_number=batch.replace(' ', '')).exists():
        raise PhysicalTransferConflict('Batch has an outstanding SAP transfer operation.')
    if hasattr(row, 'position_reconciliation') and row.position_reconciliation.status == 'PENDING':
        raise PhysicalTransferConflict('Stage 3 physical reconciliation must complete first.')
    return row


def authorize_source(row, actor):
    from api.views import _user_can_access_transfer_warehouse
    # Physical custody leaves the current Intermediate warehouse. Reuse its
    # existing departure grant, independently of the earlier SAP stage.
    if not _user_can_access_transfer_warehouse(actor, row.to_warehouse, 'FROM'):
        raise PermissionError('Transfer warehouse access required.')


def record_event(pallet, stage, source, actor, request):
    event = PhysicalTransferEvent.objects.create(pallet=pallet, stage=stage, state=pallet.state,
        source_location=source, destination_location=pallet.physical_location, container=pallet.container, actor=actor)
    audit = log_action(request=request, user=actor, action=ACTION_UPDATE, module=MODULE_TRANSFER,
        entity_type='TransferPalletCustody', entity_id=pallet.pk,
        description=f'Stage {stage}: {pallet.batch_number} → {pallet.state}',
        details={'stage': stage, 'batch_number': pallet.batch_number, 'physical_state': pallet.state,
                 'source_location': source, 'destination_location': pallet.physical_location,
                 'source_operation': f'PTR-{pallet.source_transfer_id}', 'movement_reference': str(event.reference),
                 'container_number': pallet.container.container_number if pallet.container_id else None,
                 'sap_posting': False})
    if audit is None:
        raise RuntimeError('Physical movement audit could not be recorded.')
    return event


def arrive(batch_number, actor, request=None):
    batch = identifier(batch_number, 'batch_number')
    try:
        with transaction.atomic():
            source = validate_arrival_source(batch, actor)
            # Serialize arrivals sharing the same SAP source, with a unique pallet key as a second guard.
            PendingTransferRequest.objects.select_for_update().get(pk=source.pk)
            if TransferPalletCustody.objects.filter(company_scope=company_scope(), batch_number=batch).exists():
                raise PhysicalTransferConflict('Batch already arrived at Shipping Hall or was loaded.')
            pallet = TransferPalletCustody.objects.create(company_scope=company_scope(), batch_number=batch,
                state='IN_SHIPPING_HALL', physical_location='SHIPPING_HALL', source_transfer=source, updated_by=actor)
            event = record_event(pallet, 4, source.to_warehouse, actor, request)
            return pallet, event
    except IntegrityError as exc:
        raise PhysicalTransferConflict('Concurrent or duplicate Shipping Hall arrival.') from exc


def load(batch_number, container_number, actor, request=None, source_warehouse=None):
    batch = identifier(batch_number, 'batch_number')
    container_number = identifier(container_number, 'container_number')
    source_wh = str(source_warehouse or '').strip().upper() if source_warehouse else None
    if not source_wh:
        raise ValueError('Stage 5 source warehouse is required.')
    if not can_manage_transfer(actor) and not TransferWarehouseRule.objects.filter(user=actor, is_active=True,
            stage=TransferWarehouseRule.STAGE_5_TO_CONTAINER, direction='FROM', warehouse_code=source_wh).exists():
        raise PermissionError('Stage 5 source warehouse is not allowed by your loading rules.')
    try:
        with transaction.atomic():
            pallet = TransferPalletCustody.objects.select_for_update().filter(company_scope=company_scope(), batch_number=batch).first()
            source, location, _state = loading_context(batch, pallet, lock=True)
            # The source-row lock serializes first-time loads; recheck custody after waiting.
            pallet = TransferPalletCustody.objects.select_for_update().filter(company_scope=company_scope(), batch_number=batch).first()
            if pallet and (pallet.state == 'LOADED_TO_CONTAINER' or pallet.container_id):
                raise PhysicalTransferConflict('Batch is already loaded; duplicate loading is not allowed.')
            if PendingTransferBatchGuard.objects.filter(normalized_batch_number=batch.replace(' ', '')).exists():
                raise PhysicalTransferConflict('Batch has an outstanding SAP transfer operation.')
            if hasattr(source, 'position_reconciliation') and source.position_reconciliation.status == 'PENDING':
                raise PhysicalTransferConflict('Batch physical reconciliation must complete first.')
            if source_wh and source_wh != location.strip().upper():
                raise PhysicalTransferConflict(
                    f'Batch is currently in warehouse/location {location}. Select {location} or complete Stage 4 first.')
            source_location = source_wh
            if not pallet:
                container, _ = ShippingContainer.objects.get_or_create(company_scope=company_scope(), container_number=container_number,
                    defaults={'created_by': actor})
                pallet = TransferPalletCustody.objects.create(
                    company_scope=company_scope(),
                    batch_number=batch,
                    state='LOADED_TO_CONTAINER',
                    physical_location=f'CONTAINER:{container_number}',
                    source_transfer=source,
                    container=container,
                    updated_by=actor
                )
                event = record_event(pallet, 5, source_location, actor, request)
                return pallet, event

            container, _ = ShippingContainer.objects.get_or_create(company_scope=company_scope(), container_number=container_number,
                defaults={'created_by': actor})
            pallet.state = 'LOADED_TO_CONTAINER'
            pallet.physical_location = f'CONTAINER:{container_number}'
            pallet.container = container
            pallet.updated_by = actor
            pallet.source_transfer = source
            pallet.save(update_fields=['state', 'physical_location', 'container', 'updated_by', 'updated_at', 'source_transfer'])
            event = record_event(pallet, 5, source_location, actor, request)
            return pallet, event
    except IntegrityError as exc:
        raise PhysicalTransferConflict('Concurrent or duplicate container loading.') from exc
