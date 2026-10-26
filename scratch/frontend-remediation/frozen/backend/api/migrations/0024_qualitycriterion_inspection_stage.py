from django.db import migrations, models
import django.db.models.deletion


def assign_receiving_stage(apps, schema_editor):
    InspectionStage = apps.get_model("api", "InspectionStage")
    QualityCriterion = apps.get_model("api", "QualityCriterion")

    receiving, _ = InspectionStage.objects.get_or_create(
        code="RECEIVING",
        defaults={
            "name_ar": "فحص الاستلام",
            "name_en": "Receiving Inspection",
            "sort_order": 1,
            "is_active": True,
        },
    )
    QualityCriterion.objects.filter(inspection_stage__isnull=True).update(inspection_stage=receiving)


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0023_remove_inspectionstage_item_code_prefix"),
    ]

    operations = [
        migrations.AddField(
            model_name="qualitycriterion",
            name="inspection_stage",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="criteria",
                to="api.inspectionstage",
            ),
        ),
        migrations.RunPython(assign_receiving_stage, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="qualitycriterion",
            name="inspection_stage",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="criteria",
                to="api.inspectionstage",
            ),
        ),
    ]
