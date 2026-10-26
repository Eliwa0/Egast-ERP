from django.db import migrations


STAGES = [
    ("RECEIVING", "فحص الاستلام", "Receiving Inspection", 1),
    ("PRE_EXPORT", "فحص ما قبل التصدير", "Pre Export Inspection", 2),
]


def fix_stage_names(apps, schema_editor):
    InspectionStage = apps.get_model("api", "InspectionStage")
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


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0020_inspectionstage_itemcriteria_stage"),
    ]

    operations = [
        migrations.RunPython(fix_stage_names, migrations.RunPython.noop),
    ]
