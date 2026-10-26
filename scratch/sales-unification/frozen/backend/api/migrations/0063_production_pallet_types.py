from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0062_shipping_manifest_handoff')]
    operations = [migrations.CreateModel(name='ProductionPalletType', fields=[
        ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
        ('name', models.CharField(max_length=100, unique=True)),
        ('capacity_kg', models.DecimalField(decimal_places=3, max_digits=11)),
        ('is_active', models.BooleanField(default=True)),
    ])]
