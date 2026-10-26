from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0046_pendingtransferrequest_source_pallet_position_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="pendingtransferrequest",
            name="status",
            field=models.CharField(
                choices=[
                    ("PENDING", "Pending"),
                    ("POSTING", "Posting"),
                    ("POSTED", "Posted"),
                    ("FAILED", "Failed"),
                ],
                db_index=True,
                default="PENDING",
                max_length=20,
            ),
        ),
    ]
