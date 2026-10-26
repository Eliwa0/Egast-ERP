"""Read-only report queries. Filter lines before aggregating or paging documents."""
from datetime import date, timezone
from django.db.models import Count, Sum, Value, F, CharField, Subquery, OuterRef
from django.db.models.functions import Coalesce, NullIf, TruncDate, Cast, Concat
from django.utils.html import escape
from api.models_delivery import DeliveryDraft, DeliveryDraftLine
from .workflow_pagination import workflow_page, workflow_bounds, workflow_metadata, numeric_identifier


def report_lines(params):
    drafts = DeliveryDraft.objects.filter(status='POSTED').exclude(sap_doc_entry='').exclude(sap_doc_num='')
    if params.get('document'):
        from django.db.models import Q
        number = numeric_identifier(params['document'], 'document')
        drafts = drafts.filter(Q(id=number) | Q(sap_doc_entry=str(number)) | Q(sap_doc_num=str(number)))
    lines = DeliveryDraftLine.objects.filter(draft__in=drafts).annotate(
        report_date=Coalesce(TruncDate('draft__posted_at', tzinfo=timezone.utc), F('draft__doc_date')),
        customer_key=Coalesce(NullIf('draft__customer_code', Value('')), F('draft__customer_name')),
    )
    for name, lookup in [('customer', 'customer_key'), ('salesOrder', 'draft__sales_order_doc_num'), ('item', 'item_code')]:
        if params.get(name):
            lines = lines.filter(**{lookup: params[name]})
    for name, lookup in [('dateFrom', 'report_date__gte'), ('dateTo', 'report_date__lte')]:
        if params.get(name):
            try:
                value = date.fromisoformat(params[name])
            except ValueError as error:
                raise ValueError(f'Invalid {name}; use YYYY-MM-DD.') from error
            lines = lines.filter(**{lookup: value})
    return lines


GROUPS = {
    'byCustomer': (F('customer_key'), Coalesce(NullIf('draft__customer_name', Value('')), NullIf('customer_key', Value('')), Value('—'))),
    'byItem': (F('item_code'), Coalesce(NullIf('item_description', Value('')), F('item_code'))),
    'bySalesOrder': (F('draft__sales_order_doc_num'), Concat(Value('#'), 'draft__sales_order_doc_num')),
    'byDate': (Cast('report_date', CharField()), Cast('report_date', CharField())),
}


def report_groups(lines, name):
    key, label = GROUPS[name]
    labels = lines.annotate(group_key=key, group_label=label).filter(group_key=OuterRef('group_key')).order_by(
        '-draft__created_at', '-draft_id', 'line_number', 'id').values('group_label')[:1]
    return lines.order_by().annotate(group_key=key).values('group_key').annotate(
        key=F('group_key'), label=Subquery(labels), quantity=Coalesce(Sum('delivery_quantity'), 0.0),
        deliveries=Count('draft_id', distinct=True), salesOrders=Count(NullIf('draft__sales_order_doc_num', Value('')), distinct=True),
    ).order_by('group_key')


def report_summary(lines):
    return lines.aggregate(deliveries=Count('draft_id', distinct=True), quantity=Coalesce(Sum('delivery_quantity'), 0.0),
        customers=Count('customer_key', distinct=True), salesOrders=Count('draft__sales_order_doc_num', distinct=True),
        items=Count('item_code', distinct=True))


def report_page(params, serialize):
    lines = report_lines(params)
    documents = DeliveryDraft.objects.filter(id__in=lines.values('draft_id')).prefetch_related('lines__batches').select_related(
        'created_by', 'reviewed_by', 'posted_by')
    page, pagination = workflow_page(documents, params, [])
    ids = [draft.id for draft in page]
    quantities = {row['draft_id']: row['quantity'] for row in lines.filter(draft_id__in=ids).order_by().values('draft_id').annotate(quantity=Sum('delivery_quantity'))}
    matching_items = {}
    for row in lines.filter(draft_id__in=ids).order_by('line_number', 'id').values('draft_id', 'item_code', 'item_description'):
        matching_items.setdefault(row['draft_id'], []).append(row['item_description'] or row['item_code'])
    details = [{'id': draft.id, 'draft': serialize(draft),
        'date': (draft.posted_at.date() if draft.posted_at else draft.doc_date).isoformat(),
        'items': ', '.join(matching_items[draft.id]), 'quantity': quantities[draft.id]} for draft in page]
    groups, group_pagination = {}, {}
    for name in GROUPS:
        query = report_groups(lines, name)
        # Group values are calculated over all filtered lines; only their display is paged.
        group_params = {'page_size': params.get('page_size', 25), 'offset': params.get('group_offset', 0)}
        size, offset = workflow_bounds(group_params)
        groups[name] = list(query[offset:offset + size])
        group_pagination[name] = workflow_metadata(group_params, query.count())
    return {'summary': report_summary(lines), 'details': details, **groups,
        'pagination': pagination, 'group_pagination': group_pagination}


def print_report_rows(params):
    """Generate complete printable rows on the server, never an unbounded document JSON list."""
    lines = report_lines(params).select_related('draft').order_by('-draft__created_at', '-draft_id', 'line_number', 'id')
    yield '<table data-report-part="details"><tbody>'
    previous, item_names, quantity, draft = None, [], 0, None
    def row(current, names, amount):
        cells = [f'#{current.sap_doc_num}', f'#{current.sales_order_doc_num}', current.customer_name or current.customer_code,
            ', '.join(names), f'{amount:,.3f}'.rstrip('0').rstrip('.'),
            (current.posted_at.date() if current.posted_at else current.doc_date).isoformat()]
        return '<tr>' + ''.join(f'<td>{escape(value)}</td>' for value in cells) + '</tr>'
    for line in lines.iterator(chunk_size=500):
        if previous is not None and previous != line.draft_id:
            yield row(draft, item_names, quantity)
            item_names, quantity = [], 0
        previous, draft = line.draft_id, line.draft
        item_names.append(line.item_description or line.item_code)
        quantity += line.delivery_quantity or 0
    if draft is not None:
        yield row(draft, item_names, quantity)
    yield '</tbody></table><table data-report-part="items"><tbody>'
    for group in report_groups(report_lines(params), 'byItem').iterator(chunk_size=500):
        amount = f'{group["quantity"]:,.3f}'.rstrip('0').rstrip('.')
        yield f'<tr><td>{escape(group["label"])}</td><td>{escape(amount)}</td></tr>'
    yield '</tbody></table>'
