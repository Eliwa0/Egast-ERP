from django.db import migrations, models
import django.db.models.deletion


MODULES = (
    "production",
    "transfer",
    "quality",
    "grpo",
    "purchase_quotation",
    "scale",
)


def migrate_legacy_roles(apps, schema_editor):
    User = apps.get_model("auth", "User")
    UserProfile = apps.get_model("api", "UserProfile")
    Permission = apps.get_model("api", "UserModulePermission")

    mapping = {
        "production_user": (("production", "USER"),),
        "production": (("production", "USER"),),
        "user": (("production", "USER"),),
        "production_admin": (("production", "ADMIN"),),
        "transfer_user": (("transfer", "USER"),),
        "transfer": (("transfer", "USER"),),
        "transfer_admin": (("transfer", "ADMIN"),),
        "quality_user": (
            ("quality", "USER"),
            ("grpo", "ADMIN"),
            ("purchase_quotation", "ADMIN"),
        ),
        "quality": (
            ("quality", "USER"),
            ("grpo", "ADMIN"),
            ("purchase_quotation", "ADMIN"),
        ),
        "quality_admin": (
            ("quality", "ADMIN"),
            ("grpo", "ADMIN"),
            ("purchase_quotation", "ADMIN"),
        ),
        "scale_operator": (("scale", "USER"),),
        "scale": (("scale", "USER"),),
        "scale_user": (("scale", "USER"),),
        "scale_admin": (("scale", "ADMIN"),),
    }

    profiles = {p.user_id: p.role for p in UserProfile.objects.all()}
    rows = []
    for user in User.objects.all():
        role = str(profiles.get(user.id, "") or "").strip().lower()
        assignments = (
            tuple((module, "ADMIN") for module in MODULES)
            if user.is_superuser or role in {"admin", "super_admin", "administrator"}
            else mapping.get(role, ())
        )
        rows.extend(
            Permission(user_id=user.id, module=module, level=level)
            for module, level in assignments
        )
    Permission.objects.bulk_create(rows, ignore_conflicts=True)
    UserProfile.objects.update(module_permissions_initialized=True)


class Migration(migrations.Migration):
    dependencies = [("api", "0050_transfer_position_reconciliation")]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="module_permissions_initialized",
            field=models.BooleanField(default=False),
        ),
        migrations.CreateModel(
            name="UserModulePermission",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("module", models.CharField(choices=[("production", "Production"), ("transfer", "Transfer"), ("quality", "Quality"), ("grpo", "GRPO / Shipping & Receiving"), ("purchase_quotation", "Purchase Quotation"), ("scale", "Scale")], max_length=40)),
                ("level", models.CharField(choices=[("USER", "User"), ("ADMIN", "Admin")], max_length=10)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="module_permissions", to="auth.user")),
            ],
            options={"ordering": ["user_id", "module"]},
        ),
        migrations.AddConstraint(
            model_name="usermodulepermission",
            constraint=models.UniqueConstraint(fields=("user", "module"), name="unique_user_module_permission"),
        ),
        migrations.RunPython(migrate_legacy_roles, migrations.RunPython.noop),
    ]
