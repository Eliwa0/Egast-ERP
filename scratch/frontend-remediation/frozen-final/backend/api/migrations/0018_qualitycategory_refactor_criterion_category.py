from django.db import migrations, models
import django.db.models.deletion
import re


SEED_CATEGORIES = [
    ("PEST", "الآفات الزراعية", "Agricultural Pests", 1),
    ("MECH", "العيوب الميكانيكية", "Mechanical Defects", 2),
    ("PHYS", "العيوب الفسيولوجية", "Physiological Defects", 3),
]


def _category_code_from_text(value):
    raw = str(value or "").strip()
    if not raw:
        return "PHYS"

    normalized = raw.upper()
    known = {
        "PEST": "PEST",
        "PESTS": "PEST",
        "AGRICULTURAL PESTS": "PEST",
        "MECH": "MECH",
        "MECHANICAL": "MECH",
        "MECHANICAL DEFECTS": "MECH",
        "PHYS": "PHYS",
        "PHYSIOLOGICAL": "PHYS",
        "PHYSIOLOGICAL DEFECTS": "PHYS",
        "الآفات الزراعية": "PEST",
        "العيوب الميكانيكية": "MECH",
        "العيوب الفسيولوجية": "PHYS",
    }
    if normalized in known:
        return known[normalized]
    if raw in known:
        return known[raw]

    code = re.sub(r"[^A-Z0-9]+", "_", normalized).strip("_")
    return (code or "PHYS")[:40]


def seed_and_map_categories(apps, schema_editor):
    QualityCategory = apps.get_model("api", "QualityCategory")
    QualityCriterion = apps.get_model("api", "QualityCriterion")

    for code, name_ar, name_en, sort_order in SEED_CATEGORIES:
        QualityCategory.objects.update_or_create(
            code=code,
            defaults={
                "name_ar": name_ar,
                "name_en": name_en,
                "sort_order": sort_order,
                "is_active": True,
            },
        )

    next_sort_order = 100
    for criterion in QualityCriterion.objects.all():
        old_category = str(getattr(criterion, "category", "") or "").strip()
        code = _category_code_from_text(old_category)
        category = QualityCategory.objects.filter(code=code).first()
        if category is None:
            label = old_category or code
            category = QualityCategory.objects.create(
                code=code,
                name_ar=label,
                name_en=label,
                sort_order=next_sort_order,
                is_active=True,
            )
            next_sort_order += 1
        criterion.category_ref = category
        criterion.save(update_fields=["category_ref"])


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0017_qualitycriterion_itemqualitycriterion"),
    ]

    operations = [
        migrations.CreateModel(
            name="QualityCategory",
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
                "verbose_name_plural": "Quality categories",
                "ordering": ["sort_order", "id"],
            },
        ),
        migrations.AddField(
            model_name="qualitycriterion",
            name="category_ref",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="criteria",
                to="api.qualitycategory",
            ),
        ),
        migrations.RunPython(seed_and_map_categories, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name="qualitycriterion",
            name="category",
        ),
        migrations.RenameField(
            model_name="qualitycriterion",
            old_name="category_ref",
            new_name="category",
        ),
        migrations.AlterField(
            model_name="qualitycriterion",
            name="category",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="criteria",
                to="api.qualitycategory",
            ),
        ),
        migrations.AlterField(
            model_name="qualitycriterion",
            name="name_en",
            field=models.CharField(blank=True, max_length=200),
        ),
    ]
