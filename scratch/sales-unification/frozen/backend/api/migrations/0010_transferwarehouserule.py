from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0009_orderattributevisibilityrule_userattributevisibilityrule'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='TransferWarehouseRule',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('warehouse_code', models.CharField(db_index=True, max_length=20)),
                ('warehouse_name', models.CharField(blank=True, max_length=100)),
                ('direction', models.CharField(choices=[('FROM', 'From'), ('TO', 'To'), ('BOTH', 'Both')], max_length=10)),
                ('stage', models.CharField(choices=[('STAGE_1_TO_INTERMEDIATE', 'Stage 1 to Intermediate'), ('STAGE_2_TO_FRIDGE', 'Stage 2 to Fridge'), ('BOTH', 'Both')], default='BOTH', max_length=30)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='transfer_warehouse_rules', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['user__username', 'warehouse_code', 'direction', 'stage'],
                'unique_together': {('user', 'warehouse_code', 'direction', 'stage')},
            },
        ),
    ]
