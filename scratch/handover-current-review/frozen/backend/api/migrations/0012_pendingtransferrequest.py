from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0011_safe_query_indexes'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='PendingTransferRequest',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('transfer_stage', models.CharField(db_index=True, max_length=40)),
                ('from_warehouse', models.CharField(db_index=True, max_length=20)),
                ('from_bin', models.CharField(blank=True, max_length=100)),
                ('to_warehouse', models.CharField(db_index=True, max_length=20)),
                ('to_bin', models.CharField(blank=True, max_length=100)),
                ('destination_type', models.CharField(blank=True, max_length=40)),
                ('item_code', models.CharField(blank=True, max_length=100)),
                ('item_name', models.CharField(blank=True, max_length=200)),
                ('batch_number', models.CharField(blank=True, db_index=True, max_length=100)),
                ('quantity', models.FloatField(default=0)),
                ('lines', models.JSONField(default=list)),
                ('raw_payload_json', models.JSONField(default=dict)),
                ('status', models.CharField(choices=[('PENDING', 'Pending'), ('POSTED', 'Posted'), ('FAILED', 'Failed')], db_index=True, default='PENDING', max_length=20)),
                ('sap_doc_entry', models.CharField(blank=True, max_length=50)),
                ('sap_doc_num', models.CharField(blank=True, max_length=50)),
                ('error_message', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('posted_at', models.DateTimeField(blank=True, null=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='pending_transfer_requests', to=settings.AUTH_USER_MODEL)),
                ('posted_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='posted_transfer_requests', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='pendingtransferrequest',
            index=models.Index(fields=['status', 'created_at'], name='ptr_status_created_idx'),
        ),
        migrations.AddIndex(
            model_name='pendingtransferrequest',
            index=models.Index(fields=['created_by', 'status'], name='ptr_creator_status_idx'),
        ),
        migrations.AddIndex(
            model_name='pendingtransferrequest',
            index=models.Index(fields=['from_warehouse', 'status'], name='ptr_from_wh_status_idx'),
        ),
        migrations.AddIndex(
            model_name='pendingtransferrequest',
            index=models.Index(fields=['to_warehouse', 'status'], name='ptr_to_wh_status_idx'),
        ),
        migrations.AddIndex(
            model_name='pendingtransferrequest',
            index=models.Index(fields=['transfer_stage', 'status'], name='ptr_stage_status_idx'),
        ),
    ]
