from django.db.models import Q


def workflow_bounds(params):
    try:
        size = min(50, max(1, int(params.get('page_size', 25))))
        offset = max(0, min(1000000, int(params.get('offset', 0))))
    except (ValueError, TypeError):
        size, offset = 25, 0
    return size, offset


def workflow_metadata(params, count):
    size, offset = workflow_bounds(params)
    return {'offset': offset, 'page_size': size, 'total': count, 'has_more': offset + size < count}


def workflow_queryset(queryset, params, fields):
    search = str(params.get('search') or '').strip()[:150]
    if search:
        condition = Q()
        for field in fields:
            condition |= Q(**{f'{field}__icontains': search})
        queryset = queryset.filter(condition).distinct()
    queryset = queryset.order_by(*(queryset.query.order_by or queryset.model._meta.ordering), '-pk')
    return queryset


def workflow_page(queryset, params, fields):
    queryset = workflow_queryset(queryset, params, fields)
    size, offset = workflow_bounds(params)
    count = queryset.count()
    return queryset[offset:offset + size], workflow_metadata(params, count)


def numeric_identifier(value, name):
    if value is not None and (not str(value).isascii() or not str(value).isdigit()):
        raise ValueError(f'Invalid {name}; a numeric document identifier is required.')
    if value is None:
        return None
    if len(str(value)) > 19 or int(value) > 9223372036854775807:
        raise ValueError(f'Invalid {name}; document identifier is out of range.')
    return int(value)
