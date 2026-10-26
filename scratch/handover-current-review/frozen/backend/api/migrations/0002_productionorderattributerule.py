from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='ProductionOrderAttributeRule',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('doc_entry', models.IntegerField(db_index=True)),
                ('doc_num', models.IntegerField(blank=True, null=True)),
                ('item_code', models.CharField(blank=True, max_length=100)),
                ('item_name', models.CharField(blank=True, max_length=200)),
                ('field_key', models.CharField(max_length=50)),
                ('allowed_values', models.JSONField(default=list)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'ordering': ['doc_entry', 'field_key'],
                'unique_together': {('doc_entry', 'field_key')},
            },
        ),
    ]
