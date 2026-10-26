from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0025_qualitycriterion_calculation_key"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="qualitycriterion",
            constraint=models.UniqueConstraint(
                fields=("inspection_stage", "calculation_key"),
                condition=~models.Q(calculation_key=""),
                name="unique_quality_criterion_calc_key_per_stage",
            ),
        ),
    ]
