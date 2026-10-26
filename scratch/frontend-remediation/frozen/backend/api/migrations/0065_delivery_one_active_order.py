"""Enforce the existing service rule under concurrency; never delete duplicates.

If operational data already has two active drafts, this migration fails rather
than picking a winner or changing document states. Resolve those explicitly.
"""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0064_quality_grade_category')]
    operations = [migrations.AddConstraint(
        model_name='deliverydraft',
        constraint=models.UniqueConstraint(fields=('sales_order_doc_entry',),
            condition=models.Q(status__in=['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'POSTING']),
            name='delivery_one_active_order'),
    )]
