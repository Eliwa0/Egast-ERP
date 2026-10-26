from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0005_postedbatchextrareceipt'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='ProductionOrderVisibilityRule',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('warehouse_code', models.CharField(db_index=True, max_length=20)),
                ('production_order_doc_num', models.CharField(db_index=True, max_length=50)),
                ('production_order_doc_entry', models.IntegerField()),
                ('item_code', models.CharField(blank=True, max_length=100)),
                ('item_name', models.CharField(blank=True, max_length=200)),
                ('is_hidden', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='order_visibility_rules',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['warehouse_code', 'production_order_doc_num'],
                'unique_together': {('warehouse_code', 'production_order_doc_num')},
            },
        ),
    ]
