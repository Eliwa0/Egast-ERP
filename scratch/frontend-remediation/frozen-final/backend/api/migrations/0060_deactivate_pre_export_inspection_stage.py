from django.db import migrations


def deactivate_pre_export_stage(apps, schema_editor):
    InspectionStage = apps.get_model("api", "InspectionStage")
    InspectionStage.objects.filter(code="PRE_EXPORT").update(is_active=False)


def reverse_deactivate(apps, schema_editor):
    InspectionStage = apps.get_model("api", "InspectionStage")
    InspectionStage.objects.filter(code="PRE_EXPORT").update(is_active=True)


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0059_transfer_policy_revisions"),
    ]

    operations = [
        migrations.RunPython(deactivate_pre_export_stage, reverse_deactivate),
    ]
