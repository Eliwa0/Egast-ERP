from django.db import migrations


PRE_EXPORT_CRITERIA = [
    ("PEST", "acarus", "\u0627\u0643\u0627\u0631\u0648\u0633", "Acarus", 1),
    ("PEST", "scale_insect", "\u062d\u0634\u0631\u0629 \u0642\u0634\u0631\u064a\u0629", "Scale Insect", 2),
    ("PEST", "spray_marks", "\u0623\u062b\u0627\u0631 \u0631\u0634", "Spray Marks", 3),
    ("PEST", "citrus_rust", "\u0635\u062f\u0623 \u0645\u0648\u0627\u0644\u062d", "Citrus Rust", 4),
    ("PEST", "thrips", "\u062a\u0631\u0628\u0633", "Thrips", 5),
    ("PEST", "vegetable_defects", "\u062e\u0636\u0627\u0631", "Vegetable Defects", 6),
    ("PEST", "gummosis", "\u062a\u0635\u0645\u063a", "Gummosis", 7),
    ("PEST", "oil_spots", "\u0628\u0642\u0639 \u0632\u064a\u062a\u064a\u0629", "Oil Spots", 8),
    ("PEST", "sunburn", "\u0644\u0633\u0639\u0629 \u0627\u0644\u0634\u0645\u0633", "Sunburn", 9),
    ("PEST", "sooty_mold", "\u0641\u0637\u0631 \u0647\u0628\u0627\u0628\u064a", "Sooty Mold", 10),
    ("PEST", "mealybug", "\u0628\u0642 \u062f\u0642\u064a\u0642\u0649", "Mealybug", 11),
    ("MECH", "tearing", "\u062a\u0646\u062a\u064a\u0634", "Tearing", 1),
    ("MECH", "high_cut", "\u0642\u0635 \u0639\u0627\u0644\u0649", "High Cut", 2),
    ("MECH", "bruises", "\u0643\u062f\u0645\u0627\u062a", "Bruises", 3),
    ("MECH", "cuts", "\u062c\u0631\u0648\u062d", "Cuts", 4),
    ("PHYS", "under_size", "\u0627\u0646\u062f\u0631", "Under Size", 1),
    ("PHYS", "venting", "\u062a\u0646\u0641\u064a\u0633", "Venting", 2),
    ("PHYS", "fruit_fly", "\u0630\u0628\u0627\u0628\u0629", "Fruit Fly", 3),
    ("PHYS", "creasing", "\u062a\u0628\u062d\u064a\u0631", "Creasing", 4),
    ("PHYS", "fall_drop", "\u0633\u0642\u0637", "Fall Drop", 5),
    ("PHYS", "mutations", "\u0637\u0641\u0631\u0627\u062a", "Mutations", 6),
    ("PHYS", "navel_blight", "\u0641\u062a\u0642 \u0633\u0631\u0629", "Navel Blight", 7),
    ("PHYS", "softness", "\u0644\u064a\u0648\u0646\u0647", "Softness", 8),
    ("PHYS", "molds", "\u0627\u0639\u0641\u0627\u0646", "Molds", 9),
    ("PHYS", "grade_1", "\u062f\u0631\u062c\u0629 \u0627\u0648\u0644\u0649", "Grade 1", 10),
    ("PHYS", "grade_2", "\u062f\u0631\u062c\u0629 \u062b\u0627\u0646\u064a\u0647", "Grade 2", 11),
]


def _next_qc_code(QualityCriterion):
    max_number = 0
    for code in QualityCriterion.objects.filter(code__startswith="QC").values_list("code", flat=True):
        suffix = str(code or "")[2:]
        if suffix.isdigit():
            max_number = max(max_number, int(suffix))

    while True:
        max_number += 1
        code = f"QC{max_number:04d}"
        if not QualityCriterion.objects.filter(code=code).exists():
            return code


def seed_pre_export_quality_criteria(apps, schema_editor):
    InspectionStage = apps.get_model("api", "InspectionStage")
    QualityCategory = apps.get_model("api", "QualityCategory")
    QualityCriterion = apps.get_model("api", "QualityCriterion")

    pre_export = InspectionStage.objects.filter(code="PRE_EXPORT").first()
    if pre_export is None:
        return

    categories = {
        category.code: category
        for category in QualityCategory.objects.filter(code__in=["PEST", "MECH", "PHYS"])
    }

    for category_code, calculation_key, name_ar, name_en, display_order in PRE_EXPORT_CRITERIA:
        category = categories.get(category_code)
        if category is None:
            continue

        if QualityCriterion.objects.filter(
            inspection_stage=pre_export,
            calculation_key=calculation_key,
        ).exists():
            continue

        QualityCriterion.objects.create(
            code=_next_qc_code(QualityCriterion),
            calculation_key=calculation_key,
            name_ar=name_ar,
            name_en=name_en,
            inspection_stage=pre_export,
            category=category,
            display_order=display_order,
            is_active=True,
        )


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0026_unique_quality_criterion_calc_key_per_stage"),
    ]

    operations = [
        migrations.RunPython(seed_pre_export_quality_criteria, migrations.RunPython.noop),
    ]
