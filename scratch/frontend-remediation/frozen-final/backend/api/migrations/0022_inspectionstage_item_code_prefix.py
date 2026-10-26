from django.db import migrations, models


STAGE_PREFIXES = {
    "RECEIVING": "27",
    "PRE_EXPORT": "111",
}


def seed_stage_prefixes(apps, schema_editor):
    InspectionStage = apps.get_model("api", "InspectionStage")
    for code, prefix in STAGE_PREFIXES.items():
        InspectionStage.objects.filter(code=code).update(item_code_prefix=prefix)


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0021_fix_inspection_stage_arabic_names"),
    ]

    operations = [
        migrations.AddField(
            model_name="inspectionstage",
            name="item_code_prefix",
            field=models.CharField(blank=True, db_index=True, max_length=40),
        ),
        migrations.RunPython(seed_stage_prefixes, migrations.RunPython.noop),
    ]
