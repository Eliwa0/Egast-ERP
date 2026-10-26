from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0012_pendingtransferrequest"),
    ]

    operations = [
        migrations.AlterField(
            model_name="userprofile",
            name="role",
            field=models.CharField(
                choices=[
                    ("admin", "Super Admin"),
                    ("super_admin", "Super Admin"),
                    ("production_admin", "Production Admin"),
                    ("transfer_admin", "Transfer Admin"),
                    ("production_user", "Production User"),
                    ("transfer_user", "Transfer User"),
                    ("production", "Production User (legacy)"),
                    ("transfer", "Transfer User (legacy)"),
                    ("user", "Production User (legacy)"),
                ],
                db_index=True,
                default="production_user",
                max_length=20,
            ),
        ),
    ]
