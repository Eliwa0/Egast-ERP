from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0016_qualityitemsequence"),
    ]

    operations = [
        migrations.CreateModel(
            name="QualityCriterion",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("code", models.CharField(db_index=True, max_length=80, unique=True)),
                ("name_ar", models.CharField(max_length=200)),
                ("name_en", models.CharField(max_length=200)),
                ("category", models.CharField(db_index=True, max_length=80)),
                ("display_order", models.IntegerField(db_index=True, default=0)),
                ("is_active", models.BooleanField(db_index=True, default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ["display_order", "id"],
            },
        ),
        migrations.CreateModel(
            name="ItemQualityCriterion",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("item_code", models.CharField(db_index=True, max_length=100)),
                ("display_order", models.IntegerField(db_index=True, default=0)),
                ("is_required", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "criterion",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="item_mappings",
                        to="api.qualitycriterion",
                    ),
                ),
            ],
            options={
                "ordering": ["display_order", "id"],
                "unique_together": {("item_code", "criterion")},
            },
        ),
        migrations.AddIndex(
            model_name="itemqualitycriterion",
            index=models.Index(fields=["item_code", "display_order"], name="iqc_item_order_idx"),
        ),
    ]
