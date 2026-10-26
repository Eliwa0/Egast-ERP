from django.db import DatabaseError
from rest_framework.decorators import api_view
from rest_framework.response import Response
from api.models import TransferPalletCustody, PhysicalTransferEvent, TransferWarehouseRule
from api.role_permissions import can_manage_transfer
from api.services.physical_transfer_service import arrive, load, identifier, loading_context, PhysicalTransferConflict, company_scope


def pallet_dict(pallet):
    return {'batch_number': pallet.batch_number, 'state': pallet.state, 'physical_location': pallet.physical_location,
            'container_number': pallet.container.container_number if pallet.container_id else None,
            'source_operation': f'PTR-{pallet.source_transfer_id}', 'updated_at': pallet.updated_at.isoformat()}


def event_dict(event):
    return {'id': event.pk, 'reference': str(event.reference), 'stage': event.stage, 'state': event.state,
            'batch_number': event.pallet.batch_number, 'source_location': event.source_location,
            'destination_location': event.destination_location,
            'container_number': event.container.container_number if event.container_id else None,
            'actor': event.actor.username if event.actor_id else None, 'created_at': event.created_at.isoformat(),
            'source_operation': f'PTR-{event.pallet.source_transfer_id}'}


@api_view(['GET'])
def physical_batch(request, batch_number):
    try:
        if not can_manage_transfer(request.user) and not TransferWarehouseRule.objects.filter(user=request.user, is_active=True,
                stage=TransferWarehouseRule.STAGE_5_TO_CONTAINER, direction='FROM').exists():
            raise PermissionError('Stage 5 loading rules are required.')
        batch = identifier(batch_number, 'batch_number')
        pallet = TransferPalletCustody.objects.select_related('container', 'source_transfer').filter(company_scope=company_scope(), batch_number=batch).first()
        source, location, state = loading_context(batch, pallet)
        return Response({'data': {'pallet': pallet_dict(pallet) if pallet else None,
            'current_location': location, 'current_state': state, 'source_operation': f'PTR-{source.pk}'}})
    except PermissionError as exc:
        return Response({'error': str(exc)}, status=403)
    except ValueError as exc:
        return Response({'error': str(exc)}, status=400)


@api_view(['POST'])
def physical_move(request, operation):
    try:
        if operation == 'arrival':
            pallet, event = arrive(request.data.get('batch_number'), request.user, request)
        else:
            pallet, event = load(
                request.data.get('batch_number'),
                request.data.get('container_number'),
                request.user,
                request,
                source_warehouse=request.data.get('source_warehouse')
            )
        return Response({'data': {'pallet': pallet_dict(pallet), 'event': event_dict(event)}, 'sap_posting': False})
    except PermissionError as exc:
        return Response({'error': str(exc)}, status=403)
    except PhysicalTransferConflict as exc:
        return Response({'error': str(exc)}, status=409)
    except ValueError as exc:
        return Response({'error': str(exc)}, status=400)
    except (DatabaseError, RuntimeError):
        return Response({'error': 'Physical movement could not be saved. Previous state was preserved.'}, status=503)


@api_view(['GET'])
def physical_review(request):
    try:
        offset = max(0, int(request.query_params.get('offset', 0)))
    except (ValueError, TypeError):
        return Response({'error': 'Invalid offset.'}, status=400)
    rows = PhysicalTransferEvent.objects.filter(pallet__company_scope=company_scope()).select_related('pallet', 'container', 'actor')
    count = rows.count()
    return Response({'data': {'events': [event_dict(row) for row in rows[offset:offset + 50]],
                             'count': count, 'next_offset': offset + 50 if offset + 50 < count else None}})
