from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0022_inspectionstage_item_code_prefix"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="inspectionstage",
            name="item_code_prefix",
        ),
    ]
