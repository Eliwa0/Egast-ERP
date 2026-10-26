from django.db import migrations


RECEIVING_CRITERIA = [
    ("PEST", "acarus", "اكاروس", "Acarus", 1),
    ("PEST", "scale_insect", "حشرة قشرية", "Scale Insect", 2),
    ("PEST", "spray_marks", "أثار رش", "Spray Marks", 3),
    ("PEST", "citrus_rust", "صدأ موالح", "Citrus Rust", 4),
    ("PEST", "thrips", "تربس", "Thrips", 5),
    ("PEST", "vegetable_defects", "خضار", "Vegetable Defects", 6),
    ("PEST", "gummosis", "تصمغ", "Gummosis", 7),
    ("PEST", "oil_spots", "بقع زيتية", "Oil Spots", 8),
    ("PEST", "sunburn", "لسعة الشمس", "Sunburn", 9),
    ("PEST", "sooty_mold", "فطر هبابي", "Sooty Mold", 10),
    ("PEST", "mealybug", "بق دقيقى", "Mealybug", 11),
    ("MECH", "tearing", "تنتيش", "Tearing", 1),
    ("MECH", "high_cut", "قص عالى", "High Cut", 2),
    ("MECH", "bruises", "كدمات", "Bruises", 3),
    ("MECH", "cuts", "جروح", "Cuts", 4),
    ("PHYS", "under_size", "اندر", "Under Size", 1),
    ("PHYS", "venting", "تنفيس", "Venting", 2),
    ("PHYS", "fruit_fly", "ذبابة", "Fruit Fly", 3),
    ("PHYS", "creasing", "تبحير", "Creasing", 4),
    ("PHYS", "fall_drop", "سقط", "Fall Drop", 5),
    ("PHYS", "mutations", "طفرات", "Mutations", 6),
    ("PHYS", "navel_blight", "فتق سرة", "Navel Blight", 7),
    ("PHYS", "softness", "ليونه", "Softness", 8),
    ("PHYS", "molds", "اعفان", "Molds", 9),
    ("PHYS", "grade_1", "درجة اولى", "Grade 1", 10),
    ("PHYS", "grade_2", "درجة ثانيه", "Grade 2", 11),
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


def seed_receiving_quality_criteria(apps, schema_editor):
    QualityCategory = apps.get_model("api", "QualityCategory")
    QualityCriterion = apps.get_model("api", "QualityCriterion")

    categories = {
        category.code: category
        for category in QualityCategory.objects.filter(code__in=["PEST", "MECH", "PHYS"])
    }

    for category_code, _key, name_ar, name_en, display_order in RECEIVING_CRITERIA:
        category = categories.get(category_code)
        if category is None:
            continue

        existing = QualityCriterion.objects.filter(
            category=category,
            name_ar=name_ar,
            name_en=name_en,
        ).first()
        if existing:
            continue

        QualityCriterion.objects.create(
            code=_next_qc_code(QualityCriterion),
            name_ar=name_ar,
            name_en=name_en,
            category=category,
            display_order=display_order,
            is_active=True,
        )


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0018_qualitycategory_refactor_criterion_category"),
    ]

    operations = [
        migrations.RunPython(seed_receiving_quality_criteria, migrations.RunPython.noop),
    ]
