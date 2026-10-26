"""Record the already-existing Stage 4/5 choices; no permission or data changes."""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0065_delivery_one_active_order')]
    operations = [migrations.AlterField(
        model_name='transferwarehouserule', name='stage',
        field=models.CharField(choices=[
            ('STAGE_1_TO_INTERMEDIATE', 'Stage 1 to Intermediate'),
            ('STAGE_2_TO_FRIDGE', 'Stage 2 to Fridge'),
            ('STAGE_3_FROM_FRIDGE', 'Stage 3 from Fridge'),
            ('STAGE_4_TO_DESTINATION', 'Stage 4 to Destination'),
            ('STAGE_5_TO_CONTAINER', 'Stage 5 warehouse to Container'),
            ('BOTH', 'Both'),
        ], default='BOTH', max_length=30),
    )]
