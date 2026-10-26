from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('api', '0002_productionorderattributerule'),
    ]

    operations = [
        migrations.CreateModel(
            name='UserAttributeRule',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('field_key', models.CharField(max_length=50)),
                ('allowed_values', models.JSONField(default=list)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='attribute_rules',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['user', 'field_key'],
                'unique_together': {('user', 'field_key')},
            },
        ),
        migrations.CreateModel(
            name='WarehouseAttributeVisibilityRule',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('warehouse_code', models.CharField(db_index=True, max_length=20, unique=True)),
                ('hidden_fields', models.JSONField(default=list)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
        ),
    ]
