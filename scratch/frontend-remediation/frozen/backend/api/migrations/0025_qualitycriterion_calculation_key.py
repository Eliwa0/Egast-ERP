from django.db import migrations, models


RECEIVING_CALCULATION_KEYS = {
    "Acarus": "acarus",
    "Scale Insect": "scale_insect",
    "Spray Marks": "spray_marks",
    "Citrus Rust": "citrus_rust",
    "Thrips": "thrips",
    "Vegetable Defects": "vegetable_defects",
    "Gummosis": "gummosis",
    "Oil Spots": "oil_spots",
    "Sunburn": "sunburn",
    "Sooty Mold": "sooty_mold",
    "Mealybug": "mealybug",
    "Tearing": "tearing",
    "High Cut": "high_cut",
    "Bruises": "bruises",
    "Cuts": "cuts",
    "Under Size": "under_size",
    "Venting": "venting",
    "Fruit Fly": "fruit_fly",
    "Creasing": "creasing",
    "Fall Drop": "fall_drop",
    "Mutations": "mutations",
    "Navel Blight": "navel_blight",
    "Softness": "softness",
    "Molds": "molds",
    "Grade 1": "grade_1",
    "Grade 2": "grade_2",
}


def seed_receiving_calculation_keys(apps, schema_editor):
    InspectionStage = apps.get_model("api", "InspectionStage")
    QualityCriterion = apps.get_model("api", "QualityCriterion")

    receiving = InspectionStage.objects.filter(code="RECEIVING").first()
    if receiving is None:
        return

    for name_en, calculation_key in RECEIVING_CALCULATION_KEYS.items():
        QualityCriterion.objects.filter(
            inspection_stage=receiving,
            name_en=name_en,
            calculation_key="",
        ).update(calculation_key=calculation_key)


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0024_qualitycriterion_inspection_stage"),
    ]

    operations = [
        migrations.AddField(
            model_name="qualitycriterion",
            name="calculation_key",
            field=models.CharField(blank=True, db_index=True, max_length=80),
        ),
        migrations.RunPython(seed_receiving_calculation_keys, migrations.RunPython.noop),
    ]
