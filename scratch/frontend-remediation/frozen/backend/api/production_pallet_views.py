from decimal import Decimal, InvalidOperation
from django.db import IntegrityError
from rest_framework.decorators import api_view
from rest_framework.response import Response
from api.models import ProductionPalletType
from api.role_permissions import MODULE_PRODUCTION, can_manage_production, require_module_access


def positive_weight(value):
    try:
        weight = Decimal(str(value))
        if not weight.is_finite() or weight <= 0 or weight > Decimal('99999999.999') or weight != weight.quantize(Decimal('0.001')):
            raise ValueError('Capacity must be positive, with at most three decimal places.')
        return weight
    except (InvalidOperation, TypeError):
        raise ValueError('Invalid pallet capacity.')


def validate_receipt_pallets(batches):
    types = {row.pk: row for row in ProductionPalletType.objects.filter(is_active=True)}
    if not types and not ProductionPalletType.objects.exists():
        return
    for index, batch in enumerate(batches):
        if batch.get('withoutPallet') is True:
            if batch.get('palletTypeId'):
                raise ValueError(f'Batch {index + 1}: cannot select a pallet type and no pallets together.')
            positive_weight(batch.get('quantity'))
            batch['palletTypeName'] = ''
            batch['palletCapacityKg'] = None
            continue
        try:
            pallet = types.get(int(batch.get('palletTypeId') or 0))
        except (ValueError, TypeError):
            pallet = None
        if not pallet:
            raise ValueError(f'Batch {index + 1}: choose an active production pallet type.')
        quantity = positive_weight(batch.get('quantity'))
        if quantity > pallet.capacity_kg:
            raise ValueError(f'Batch {index + 1}: {pallet.name} allows at most {pallet.capacity_kg} kg; received {quantity} kg.')
        batch['palletTypeName'] = pallet.name
        batch['palletCapacityKg'] = str(pallet.capacity_kg)


def serialize(row):
    return {'id': row.pk, 'name': row.name, 'capacity_kg': str(row.capacity_kg), 'is_active': row.is_active}


@api_view(['GET', 'POST', 'PATCH'])
@require_module_access(MODULE_PRODUCTION)
def pallet_types(request):
    if request.method == 'GET':
        rows = ProductionPalletType.objects.order_by('name')
        if request.query_params.get('all') != '1' or not can_manage_production(request.user):
            rows = rows.filter(is_active=True)
        return Response({'success': True, 'configured': ProductionPalletType.objects.exists(), 'types': [serialize(row) for row in rows]})
    if not can_manage_production(request.user):
        return Response({'error': 'Production admin access required.'}, status=403)
    try:
        if request.method == 'PATCH':
            row = ProductionPalletType.objects.get(pk=request.data.get('id'))
        else:
            row = ProductionPalletType()
        name = str(request.data.get('name', row.name) or '').strip()
        if not name or len(name) > 100:
            raise ValueError('Pallet name is required (maximum 100 characters).')
        row.name = name
        row.capacity_kg = positive_weight(request.data.get('capacity_kg', row.capacity_kg))
        active = request.data.get('is_active', row.is_active)
        if not isinstance(active, bool):
            raise ValueError('is_active must be a boolean.')
        row.is_active = active
        row.save()
        return Response({'success': True, 'type': serialize(row)}, status=201 if request.method == 'POST' else 200)
    except ProductionPalletType.DoesNotExist:
        return Response({'error': 'Pallet type not found.'}, status=404)
    except (ValueError, TypeError, IntegrityError) as exc:
        return Response({'error': 'Pallet name already exists.' if isinstance(exc, IntegrityError) else str(exc)}, status=400)
