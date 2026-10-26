from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0051_usermodulepermission"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="UserWarehouseAccess",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("warehouse_code", models.CharField(db_index=True, max_length=20)),
                ("warehouse_name", models.CharField(blank=True, max_length=100)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="warehouse_access_rules", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["user__username", "warehouse_code"]},
        ),
        migrations.AddConstraint(
            model_name="userwarehouseaccess",
            constraint=models.UniqueConstraint(fields=("user", "warehouse_code"), name="uniq_user_warehouse_access"),
        ),
    ]
