from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("scale", "0007_alter_scalepermit_options_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="ScaleDraftNumberSequence",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("item_code", models.CharField(db_index=True, max_length=100, unique=True, verbose_name="كود الصنف")),
                ("last_number", models.PositiveIntegerField(default=0, verbose_name="آخر رقم تسلسلي")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="تاريخ آخر تحديث")),
            ],
            options={
                "verbose_name": "تسلسل رقم مسودة الميزان",
                "verbose_name_plural": "تسلسلات أرقام مسودات الميزان",
            },
        ),
    ]
