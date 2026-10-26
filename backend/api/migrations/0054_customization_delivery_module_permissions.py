"""Add the Customization and Delivery module permission keys.

Two independent additions are required here:

1. `AlterField` on `UserModulePermission.module` so the stored `choices` include
   the new `customization` and `delivery` keys. Django stores the choices in the
   migration state, so the field definition must be brought forward or the model
   and the migration history diverge. No column type changes - `max_length` stays
   at 40 and no new column is added.

2. `RunPython` granting `USER` level on both new keys.

Why the data step is needed
---------------------------
Permission resolution is fail-closed: `can_access_module` only succeeds when an
explicit `UserModulePermission` row exists for that user and module
(`api/role_permissions.py`). Adding a choice alone would therefore leave every
existing account with no access to the new module.

Grant policy
------------
* Level `USER` only. The module is strictly read-only in this phase, so `USER` is
  the correct and sufficient level; nothing is granted that can write to SAP.
* Only accounts that already hold at least one module permission row are
  touched. Accounts with zero rows are in an explicit no-access state and are
  deliberately left alone rather than being given partial access.
* Super admins need no rows; `is_super_admin` short-circuits every permission
  check.

The reverse operation is a no-op on purpose: rolling back must not delete rows
that an administrator may have since changed level on.
"""

from django.db import migrations, models

NEW_MODULES = ("customization", "delivery")
GRANTED_LEVEL = "USER"


def grant_customization_delivery(apps, schema_editor):
    Permission = apps.get_model("api", "UserModulePermission")

    users_with_any_permission = (
        Permission.objects.values_list("user_id", flat=True).distinct()
    )

    existing = set(
        Permission.objects.filter(module__in=NEW_MODULES).values_list(
            "user_id", "module"
        )
    )

    rows = [
        Permission(user_id=user_id, module=module, level=GRANTED_LEVEL)
        for user_id in users_with_any_permission
        for module in NEW_MODULES
        if (user_id, module) not in existing
    ]

    if rows:
        Permission.objects.bulk_create(rows, ignore_conflicts=True)


class Migration(migrations.Migration):
    dependencies = [("api", "0053_pendingissue_pendingissueline_and_more")]

    operations = [
        migrations.AlterField(
            model_name="usermodulepermission",
            name="module",
            field=models.CharField(
                choices=[
                    ("production", "Production"),
                    ("transfer", "Transfer"),
                    ("quality", "Quality"),
                    ("grpo", "GRPO / Shipping & Receiving"),
                    ("purchase_quotation", "Purchase Quotation"),
                    ("scale", "Scale"),
                    ("customization", "Customization"),
                    ("delivery", "Delivery"),
                ],
                max_length=40,
            ),
        ),
        migrations.RunPython(grant_customization_delivery, migrations.RunPython.noop),
    ]
