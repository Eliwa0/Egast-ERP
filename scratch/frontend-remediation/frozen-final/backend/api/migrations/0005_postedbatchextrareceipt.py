import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0004_pendingreceipt_batchnumberreservation_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='PostedBatchExtraReceipt',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('batch_number', models.CharField(max_length=100)),
                ('extra_unit_count', models.IntegerField(default=0)),
                ('extra_quantity', models.FloatField(default=0)),
                ('uom_entry', models.CharField(blank=True, max_length=20)),
                ('uom_label', models.CharField(blank=True, max_length=100)),
                ('sap_document_number', models.CharField(blank=True, max_length=50)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name='extra_receipts', to=settings.AUTH_USER_MODEL)),
                ('original_batch', models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name='extra_receipts', to='api.pendingreceiptbatch')),
                ('original_pending_receipt', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='extra_receipts', to='api.pendingreceipt')),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]
