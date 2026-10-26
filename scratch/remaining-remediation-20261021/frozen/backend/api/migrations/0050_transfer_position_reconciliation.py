from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0049_active_transfer_batch_guard"),
    ]

    operations = [
        migrations.CreateModel(
            name="TransferPositionReconciliation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("sap_doc_entry", models.CharField(blank=True, max_length=50)),
                ("sap_doc_num", models.CharField(blank=True, max_length=50)),
                ("source_position_code", models.CharField(blank=True, max_length=100)),
                ("destination_position_code", models.CharField(blank=True, max_length=100)),
                ("expected_source_state", models.CharField(blank=True, max_length=20)),
                ("expected_destination_state", models.CharField(blank=True, max_length=20)),
                ("source_completed", models.BooleanField(default=False)),
                ("destination_completed", models.BooleanField(default=False)),
                ("status", models.CharField(choices=[("PENDING", "Pending reconciliation"), ("COMPLETED", "Completed")], db_index=True, default="PENDING", max_length=20)),
                ("failure_reason", models.TextField(blank=True)),
                ("attempt_count", models.PositiveIntegerField(default=0)),
                ("last_attempt_at", models.DateTimeField(blank=True, null=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("destination_position", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="destination_reconciliations", to="api.coldstoragepalletposition")),
                ("source_position", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="source_reconciliations", to="api.coldstoragepalletposition")),
                ("transfer", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="position_reconciliation", to="api.pendingtransferrequest")),
            ],
            options={
                "ordering": ["status", "created_at"],
                "indexes": [models.Index(fields=["status", "created_at"], name="tpr_status_created_idx")],
            },
        ),
    ]
