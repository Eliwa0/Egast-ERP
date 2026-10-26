from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0007_pendingreceiptbatch_season'),
    ]

    operations = [
        migrations.CreateModel(
            name='WarehouseAttributeRule',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('warehouse_code', models.CharField(db_index=True, max_length=20)),
                ('field_key', models.CharField(max_length=50)),
                ('allowed_values', models.JSONField(default=list)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'ordering': ['warehouse_code', 'field_key'],
                'unique_together': {('warehouse_code', 'field_key')},
            },
        ),
    ]
