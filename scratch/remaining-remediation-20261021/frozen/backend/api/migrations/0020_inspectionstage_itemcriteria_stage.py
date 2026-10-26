from django.db import migrations, models
import django.db.models.deletion


STAGES = [
    ("RECEIVING", "فحص الاستلام", "Receiving Inspection", 1),
    ("PRE_EXPORT", "فحص ما قبل التصدير", "Pre Export Inspection", 2),
]


def seed_stages_and_map_existing(apps, schema_editor):
    InspectionStage = apps.get_model("api", "InspectionStage")
    ItemQualityCriterion = apps.get_model("api", "ItemQualityCriterion")

    for code, name_ar, name_en, sort_order in STAGES:
        InspectionStage.objects.update_or_create(
            code=code,
            defaults={
                "name_ar": name_ar,
                "name_en": name_en,
                "sort_order": sort_order,
                "is_active": True,
            },
        )

    receiving = InspectionStage.objects.get(code="RECEIVING")
    ItemQualityCriterion.objects.filter(inspection_stage__isnull=True).update(inspection_stage=receiving)


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0019_seed_receiving_quality_criteria"),
    ]

    operations = [
        migrations.CreateModel(
            name="InspectionStage",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("code", models.CharField(db_index=True, max_length=40, unique=True)),
                ("name_ar", models.CharField(max_length=200)),
                ("name_en", models.CharField(max_length=200)),
                ("sort_order", models.IntegerField(db_index=True, default=0)),
                ("is_active", models.BooleanField(db_index=True, default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ["sort_order", "id"],
            },
        ),
        migrations.AddField(
            model_name="itemqualitycriterion",
            name="inspection_stage",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="item_criteria",
                to="api.inspectionstage",
            ),
        ),
        migrations.RenameField(
            model_name="itemqualitycriterion",
            old_name="criterion",
            new_name="quality_criterion",
        ),
        migrations.RunPython(seed_stages_and_map_existing, migrations.RunPython.noop),
        migrations.AlterUniqueTogether(
            name="itemqualitycriterion",
            unique_together={("item_code", "inspection_stage", "quality_criterion")},
        ),
        migrations.RemoveIndex(
            model_name="itemqualitycriterion",
            name="iqc_item_order_idx",
        ),
        migrations.AlterField(
            model_name="itemqualitycriterion",
            name="inspection_stage",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="item_criteria",
                to="api.inspectionstage",
            ),
        ),
        migrations.AddIndex(
            model_name="itemqualitycriterion",
            index=models.Index(
                fields=["item_code", "inspection_stage", "display_order"],
                name="iqc_item_stage_order_idx",
            ),
        ),
    ]
