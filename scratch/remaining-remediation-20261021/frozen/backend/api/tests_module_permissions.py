import json
from importlib import import_module

from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from django.apps import apps
from django.test import TestCase
from unittest.mock import patch

from api.models import (
    AuditLog,
    PendingQualityInspection,
    PendingReceipt,
    PendingReceiptBatch,
    PurchaseGRPODraft,
    UserAttributeRule,
    UserModulePermission,
)
from api.role_permissions import (
    LEVEL_ADMIN,
    LEVEL_USER,
    MODULE_GRPO,
    MODULE_PRODUCTION,
    MODULE_PURCHASE_QUOTATION,
    MODULE_QUALITY,
    MODULE_SCALE,
    MODULE_TRANSFER,
    can_access_module,
    can_manage_module,
    get_module_permissions,
)


class ModulePermissionArchitectureTests(TestCase):
    def make_user(self, username, assignments=None, role="production_user"):
        user = User.objects.create_user(username=username, password="password123")
        user.userprofile.role = role
        user.userprofile.save(update_fields=["role"])
        for module, level in (assignments or {}).items():
            UserModulePermission.objects.create(user=user, module=module, level=level)
        return user

    def test_no_access_user_admin_and_super_admin_semantics(self):
        isolated = self.make_user("isolated", {MODULE_TRANSFER: LEVEL_USER})
        self.assertFalse(can_access_module(isolated, MODULE_PRODUCTION))
        self.assertFalse(can_manage_module(isolated, MODULE_PRODUCTION))
        self.assertTrue(can_access_module(isolated, MODULE_TRANSFER))
        self.assertFalse(can_manage_module(isolated, MODULE_TRANSFER))

        manager = self.make_user("manager", {MODULE_TRANSFER: LEVEL_ADMIN})
        self.assertTrue(can_access_module(manager, MODULE_TRANSFER))
        self.assertTrue(can_manage_module(manager, MODULE_TRANSFER))
        self.assertFalse(can_access_module(manager, MODULE_SCALE))

        super_admin = User.objects.create_superuser("root", password="password123")
        self.assertEqual(get_module_permissions(super_admin), {})
        self.assertFalse(UserModulePermission.objects.filter(user=super_admin).exists())
        for module in (
            MODULE_PRODUCTION, MODULE_TRANSFER, MODULE_QUALITY,
            MODULE_GRPO, MODULE_PURCHASE_QUOTATION, MODULE_SCALE,
        ):
            self.assertTrue(can_access_module(super_admin, module))
            self.assertTrue(can_manage_module(super_admin, module))

    def test_database_prevents_duplicate_assignment(self):
        user = self.make_user("duplicate", {MODULE_SCALE: LEVEL_USER})
        with self.assertRaises(IntegrityError), transaction.atomic():
            UserModulePermission.objects.create(
                user=user, module=MODULE_SCALE, level=LEVEL_ADMIN
            )

    def test_legacy_role_compatibility_when_no_explicit_rows_exist(self):
        user = self.make_user("legacy_quality", role="quality_user")
        self.assertTrue(can_access_module(user, MODULE_QUALITY))
        self.assertFalse(can_manage_module(user, MODULE_QUALITY))
        self.assertTrue(can_manage_module(user, MODULE_GRPO))
        self.assertTrue(can_manage_module(user, MODULE_PURCHASE_QUOTATION))
        self.assertFalse(can_access_module(user, MODULE_TRANSFER))

    def test_data_migration_materializes_legacy_permissions(self):
        quality_user = self.make_user("migration_quality", role="quality_user")
        UserModulePermission.objects.filter(user=quality_user).delete()
        migration = import_module("api.migrations.0051_usermodulepermission")
        migration.migrate_legacy_roles(apps, None)
        assignments = dict(
            UserModulePermission.objects.filter(user=quality_user).values_list("module", "level")
        )
        self.assertEqual(assignments[MODULE_QUALITY], LEVEL_USER)
        self.assertEqual(assignments[MODULE_GRPO], LEVEL_ADMIN)
        self.assertEqual(assignments[MODULE_PURCHASE_QUOTATION], LEVEL_ADMIN)

    def test_representative_module_user_access_is_isolated(self):
        cases = (
            (MODULE_PRODUCTION, "/api/user-attribute-rules/me/"),
            (MODULE_TRANSFER, "/api/transfer/warehouse-access/me/"),
            (MODULE_QUALITY, "/api/quality/inspections/"),
            (MODULE_GRPO, "/api/grpo/pending-shipments/"),
            (MODULE_PURCHASE_QUOTATION, "/api/purchase-quotations/drafts/"),
            (MODULE_SCALE, "/api/scale/live-weight/"),
        )
        for module, endpoint in cases:
            with self.subTest(module=module):
                user = self.make_user(f"user_{module}", {module: LEVEL_USER})
                self.client.force_login(user)
                response = self.client.get(endpoint)
                self.assertNotIn(response.status_code, {401, 403})
                self.client.logout()

                outsider = self.make_user(
                    f"outsider_{module}", {MODULE_SCALE if module != MODULE_SCALE else MODULE_TRANSFER: LEVEL_USER}
                )
                self.client.force_login(outsider)
                self.assertEqual(self.client.get(endpoint).status_code, 403)
                self.client.logout()

    def test_transfer_user_without_account_warehouse_assignment_is_not_blocked(self):
        user = self.make_user("transfer_without_account_warehouse", {MODULE_TRANSFER: LEVEL_USER})
        self.client.force_login(user)

        response = self.client.get("/api/transfer/warehouse-access/me/")

        self.assertEqual(response.status_code, 200)
        self.assertNotContains(
            response,
            "No warehouses assigned to your user. Contact admin.",
        )

    def test_login_returns_explicit_permissions_instead_of_leaking_legacy_role_access(self):
        user = self.make_user(
            "transfer_login_contract",
            {MODULE_TRANSFER: LEVEL_USER},
            role="production_user",
        )
        user.userprofile.module_permissions_initialized = True
        user.userprofile.save(update_fields=["module_permissions_initialized"])

        response = self.client.post(
            "/api/login/",
            data={"username": user.username, "password": "password123"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.data["data"]
        self.assertEqual(payload["module_permissions"], {MODULE_TRANSFER: LEVEL_USER})
        self.assertNotIn(MODULE_PRODUCTION, payload["module_permissions"])

    def test_module_users_cannot_call_admin_actions(self):
        grpo_user = self.make_user("grpo_user", {MODULE_GRPO: LEVEL_USER})
        self.client.force_login(grpo_user)
        self.assertEqual(
            self.client.post("/api/quality/grpo-drafts/999/approve-for-posting/").status_code,
            403,
        )
        self.client.logout()

        pq_user = self.make_user("pq_user", {MODULE_PURCHASE_QUOTATION: LEVEL_USER})
        self.client.force_login(pq_user)
        self.assertEqual(
            self.client.post("/api/purchase-quotations/999/approve/").status_code,
            403,
        )

    def test_user_and_admin_levels_for_every_module_admin_boundary(self):
        cases = (
            (MODULE_PRODUCTION, "get", "/api/admin/attribute-rules/"),
            (MODULE_TRANSFER, "get", "/api/admin/reports/reserved-outbound-positions/"),
            (MODULE_QUALITY, "get", "/api/quality/categories/"),
            (MODULE_GRPO, "post", "/api/quality/grpo-drafts/999/approve-for-posting/"),
            (MODULE_PURCHASE_QUOTATION, "post", "/api/purchase-quotations/999/approve/"),
            (MODULE_SCALE, "post", "/api/scale/devices/"),
        )
        for module, method, endpoint in cases:
            with self.subTest(module=module, level=LEVEL_USER):
                user = self.make_user(f"boundary_user_{module}", {module: LEVEL_USER})
                self.client.force_login(user)
                response = getattr(self.client, method)(endpoint, data={})
                self.assertEqual(response.status_code, 403)
                self.client.logout()
            with self.subTest(module=module, level=LEVEL_ADMIN):
                admin = self.make_user(f"boundary_admin_{module}", {module: LEVEL_ADMIN})
                self.client.force_login(admin)
                response = getattr(self.client, method)(endpoint, data={})
                self.assertNotIn(response.status_code, {401, 403})
                self.client.logout()

    def test_module_admin_cannot_manage_permissions(self):
        manager = self.make_user("module_manager", {MODULE_TRANSFER: LEVEL_ADMIN})
        target = self.make_user("target", {MODULE_TRANSFER: LEVEL_USER})
        self.client.force_login(manager)
        response = self.client.put(
            f"/api/admin/users/{target.id}/module-permissions/",
            data=json.dumps({"permissions": {MODULE_SCALE: LEVEL_ADMIN}}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_super_admin_can_assign_change_and_revoke_with_audit_events(self):
        admin = User.objects.create_superuser("permission_admin", password="password123")
        target = self.make_user("permission_target", {MODULE_PRODUCTION: LEVEL_USER})
        self.client.force_login(admin)

        endpoint = f"/api/admin/users/{target.id}/module-permissions/"
        assigned = self.client.put(
            endpoint,
            data=json.dumps({"permissions": {
                MODULE_PRODUCTION: LEVEL_ADMIN,
                MODULE_TRANSFER: LEVEL_USER,
            }}),
            content_type="application/json",
        )
        self.assertEqual(assigned.status_code, 200)
        target.refresh_from_db()
        self.assertTrue(can_manage_module(target, MODULE_PRODUCTION))
        self.assertTrue(can_access_module(target, MODULE_TRANSFER))

        revoked = self.client.put(
            endpoint,
            data=json.dumps({"permissions": {MODULE_TRANSFER: LEVEL_ADMIN}}),
            content_type="application/json",
        )
        self.assertEqual(revoked.status_code, 200)
        self.assertFalse(can_access_module(target, MODULE_PRODUCTION))
        self.assertTrue(can_manage_module(target, MODULE_TRANSFER))
        actions = set(AuditLog.objects.filter(entity_id=str(target.id)).values_list("action", flat=True))
        self.assertIn("MODULE_PERMISSION_GRANTED", actions)
        self.assertIn("MODULE_PERMISSION_REVOKED", actions)
        self.assertIn("MODULE_PERMISSION_LEVEL_CHANGED", actions)

    def test_super_admin_cannot_change_own_assignments(self):
        admin = User.objects.create_superuser("self_admin", password="password123")
        self.client.force_login(admin)
        response = self.client.put(
            f"/api/admin/users/{admin.id}/module-permissions/",
            data=json.dumps({"permissions": {}}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_users_list_serializes_existing_permission_states_without_errors(self):
        admin = User.objects.create_superuser("users_list_admin", password="password123")

        no_access = self.make_user("users_list_no_access", role="production_user")
        no_access.userprofile.module_permissions_initialized = True
        no_access.userprofile.save(update_fields=["module_permissions_initialized"])

        module_user = self.make_user(
            "users_list_module_user", {MODULE_TRANSFER: LEVEL_USER}
        )
        module_admin = self.make_user(
            "users_list_module_admin", {MODULE_SCALE: LEVEL_ADMIN}
        )
        legacy = self.make_user("users_list_legacy", role="production_user")
        malformed = self.make_user("users_list_malformed", role="unknown_role")
        malformed.userprofile.module_permissions_initialized = True
        malformed.userprofile.save(update_fields=["module_permissions_initialized"])
        without_profile = self.make_user("users_list_without_profile")
        without_profile.userprofile.delete()

        self.client.force_login(admin)
        response = self.client.get("/api/admin/users/")

        self.assertEqual(response.status_code, 200)
        users = {
            item["username"]: item
            for item in response.json()["data"]["users"]
        }
        self.assertEqual(users[no_access.username]["module_permissions"], {})
        self.assertEqual(
            users[module_user.username]["module_permissions"],
            {MODULE_TRANSFER: LEVEL_USER},
        )
        self.assertEqual(
            users[module_admin.username]["module_permissions"],
            {MODULE_SCALE: LEVEL_ADMIN},
        )
        self.assertEqual(
            users[legacy.username]["module_permissions"],
            {MODULE_PRODUCTION: LEVEL_USER},
        )
        self.assertEqual(users[malformed.username]["module_permissions"], {})
        self.assertEqual(users[without_profile.username]["module_permissions"], {})


class GRPOModulePermissionRegressionTests(TestCase):
    def make_user(self, username, assignments=None, role="production_user"):
        user = User.objects.create_user(username=username, password="password123")
        user.userprofile.role = role
        user.userprofile.save(update_fields=["role"])
        for module, level in (assignments or {}).items():
            UserModulePermission.objects.create(user=user, module=module, level=level)
        return user

    def make_valid_draft(self, suffix):
        inspection = PendingQualityInspection.objects.create(
            batch_number=f"B-GRPO-PERM-{suffix}",
            item_code="RAW-GRPO-001",
            item_name="GRPO permission item",
            quantity=10,
            vendor_card_code="V-GRPO-001",
            vendor_name="GRPO permission vendor",
            warehouse_code="WH-01",
            bin_abs_entry="123",
            bin_code="BIN-A1",
            manufacturing_date="2026-09-01",
            admission_date="2026-09-02",
            posting_date="2026-09-02",
            document_date="2026-09-02",
            due_date="2026-09-09",
            unit_price=5,
            tax_code="V1",
        )
        return PurchaseGRPODraft.objects.create(
            inspection=inspection,
            vendor_card_code=inspection.vendor_card_code,
            vendor_name=inspection.vendor_name,
            item_code=inspection.item_code,
            item_name=inspection.item_name,
            quantity=inspection.quantity,
            warehouse_code=inspection.warehouse_code,
            bin_abs_entry=inspection.bin_abs_entry,
            bin_code=inspection.bin_code,
            batch_number=inspection.batch_number,
            batch_quantity=inspection.quantity,
            bin_quantity=inspection.quantity,
            posting_date=inspection.posting_date,
            document_date=inspection.document_date,
            due_date=inspection.due_date,
            unit_price=inspection.unit_price,
            tax_code=inspection.tax_code,
            uom_code="KG",
            uom_name="KG",
            manufacturing_date=inspection.manufacturing_date,
            admission_date=inspection.admission_date,
        )

    def test_grpo_user_can_save_draft(self):
        user = self.make_user("grpo_save_user", {MODULE_GRPO: LEVEL_USER})
        draft = self.make_valid_draft("USER")
        self.client.force_login(user)

        response = self.client.patch(
            f"/api/quality/grpo-drafts/{draft.id}/",
            json.dumps({"comments": "saved by GRPO user"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        draft.refresh_from_db()
        self.assertEqual(draft.comments, "saved by GRPO user")

    def test_grpo_admin_can_approve_draft(self):
        admin = self.make_user("grpo_approve_admin", {MODULE_GRPO: LEVEL_ADMIN})
        draft = self.make_valid_draft("ADMIN")
        self.client.force_login(admin)

        response = self.client.post(
            f"/api/quality/grpo-drafts/{draft.id}/approve-for-posting/"
        )

        self.assertEqual(response.status_code, 200)
        draft.refresh_from_db()
        self.assertEqual(draft.status, PurchaseGRPODraft.APPROVED_FOR_POSTING)

    def test_super_admin_has_full_grpo_access(self):
        admin = User.objects.create_superuser("grpo_super_admin", password="password123")
        draft = self.make_valid_draft("SUPER")
        self.client.force_login(admin)
        self.assertEqual(
            self.client.patch(
                f"/api/quality/grpo-drafts/{draft.id}/",
                json.dumps({"comments": "saved by super admin"}),
                content_type="application/json",
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.post(
                f"/api/quality/grpo-drafts/{draft.id}/approve-for-posting/"
            ).status_code,
            200,
        )

    def test_user_without_grpo_access_is_rejected(self):
        user = self.make_user("grpo_outsider", {MODULE_TRANSFER: LEVEL_USER})
        draft = self.make_valid_draft("OUTSIDER")
        self.client.force_login(user)

        response = self.client.patch(
            f"/api/quality/grpo-drafts/{draft.id}/",
            json.dumps({"comments": "must not save"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)

    def test_legacy_quality_admin_can_still_approve_grpo(self):
        legacy_admin = self.make_user("legacy_grpo_admin", role="quality_admin")
        draft = self.make_valid_draft("LEGACY")
        self.client.force_login(legacy_admin)

        response = self.client.post(
            f"/api/quality/grpo-drafts/{draft.id}/approve-for-posting/"
        )

        self.assertEqual(response.status_code, 200)


class ProductionUserRulesEligibilityTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser("rules_selector_admin", password="password123")
        self.client.force_login(self.admin)

    def make_user(self, username, permissions, role="production_user", initialized=True):
        user = User.objects.create_user(username=username, password="password123")
        user.userprofile.role = role
        user.userprofile.module_permissions_initialized = initialized
        user.userprofile.save(update_fields=["role", "module_permissions_initialized"])
        UserModulePermission.objects.bulk_create([
            UserModulePermission(user=user, module=module, level=level)
            for module, level in permissions.items()
        ])
        return user

    def test_production_user_selector_returns_only_exact_production_user_level(self):
        production_user = self.make_user("selector_production_user", {MODULE_PRODUCTION: LEVEL_USER})
        production_and_transfer_admin = self.make_user(
            "selector_production_and_transfer_admin",
            {MODULE_PRODUCTION: LEVEL_USER, MODULE_TRANSFER: LEVEL_ADMIN},
        )
        excluded = [
            self.make_user("selector_production_admin", {MODULE_PRODUCTION: LEVEL_ADMIN}),
            self.make_user("selector_transfer_user", {MODULE_TRANSFER: LEVEL_USER}),
            self.make_user("selector_transfer_admin", {MODULE_TRANSFER: LEVEL_ADMIN}),
            self.make_user("selector_grpo_user", {MODULE_GRPO: LEVEL_USER}),
            self.make_user("selector_grpo_admin", {MODULE_GRPO: LEVEL_ADMIN}),
            self.make_user("selector_quotation_user", {MODULE_PURCHASE_QUOTATION: LEVEL_USER}),
            self.make_user("selector_scale_user", {MODULE_SCALE: LEVEL_USER}),
            User.objects.create_superuser("selector_super_admin", password="password123"),
        ]

        response = self.client.get("/api/admin/users/?module=production&level=USER")

        self.assertEqual(response.status_code, 200)
        returned_ids = {item["id"] for item in response.data["data"]["users"]}
        self.assertEqual(returned_ids, {production_user.id, production_and_transfer_admin.id})
        self.assertTrue(returned_ids.isdisjoint({user.id for user in excluded}))

    def test_explicit_transfer_admin_overrides_legacy_production_role_in_selector(self):
        transfer_admin = self.make_user(
            "selector_legacy_label_transfer_admin",
            {MODULE_TRANSFER: LEVEL_ADMIN},
            role="production_user",
        )
        transfer_user = self.make_user(
            "selector_transfer_user_exact_level",
            {MODULE_TRANSFER: LEVEL_USER},
            role="production_user",
        )

        production_response = self.client.get("/api/admin/users/?module=production&level=USER")
        transfer_response = self.client.get("/api/admin/users/?module=transfer&level=USER")

        self.assertNotIn(transfer_admin.id, {item["id"] for item in production_response.data["data"]["users"]})
        self.assertNotIn(transfer_admin.id, {item["id"] for item in transfer_response.data["data"]["users"]})
        self.assertIn(transfer_user.id, {item["id"] for item in transfer_response.data["data"]["users"]})

    def test_legacy_uninitialized_production_user_keeps_existing_fallback(self):
        legacy_user = self.make_user("selector_legacy_production", {}, initialized=False)

        response = self.client.get("/api/admin/users/?module=production&level=USER")

        self.assertIn(legacy_user.id, {item["id"] for item in response.data["data"]["users"]})

    def test_ineligible_target_cannot_receive_or_surface_production_user_rules(self):
        transfer_admin = self.make_user(
            "rules_ineligible_transfer_admin",
            {MODULE_TRANSFER: LEVEL_ADMIN},
        )
        UserAttributeRule.objects.create(
            user=transfer_admin,
            field_key="size",
            allowed_values=["XL"],
        )

        list_response = self.client.get("/api/admin/user-attribute-rules/")
        save_response = self.client.post(
            "/api/admin/user-attribute-rules/set/",
            data=json.dumps({"user_id": transfer_admin.id, "rules": {"size": ["L"]}}),
            content_type="application/json",
        )

        self.assertEqual(list_response.status_code, 200)
        self.assertNotIn(transfer_admin.id, {item["user_id"] for item in list_response.data["data"]["users"]})
        self.assertEqual(save_response.status_code, 400)
        self.assertEqual(
            UserAttributeRule.objects.get(user=transfer_admin, field_key="size").allowed_values,
            ["XL"],
        )

    def test_valid_production_user_rules_still_save_and_load(self):
        production_user = self.make_user("rules_valid_production_user", {MODULE_PRODUCTION: LEVEL_USER})

        save_response = self.client.post(
            "/api/admin/user-attribute-rules/set/",
            data=json.dumps({"user_id": production_user.id, "rules": {"size": ["L"]}}),
            content_type="application/json",
        )
        list_response = self.client.get("/api/admin/user-attribute-rules/")

        self.assertEqual(save_response.status_code, 200)
        returned_ids = {item["user_id"] for item in list_response.data["data"]["users"]}
        self.assertIn(production_user.id, returned_ids)


class ProductionUserPermissionTests(TestCase):
    def make_production_user(self, username, level=LEVEL_USER):
        user = User.objects.create_user(username=username, password="password123")
        user.userprofile.role = "production_user"
        user.userprofile.module_permissions_initialized = True
        user.userprofile.save(update_fields=["role", "module_permissions_initialized"])
        UserModulePermission.objects.create(user=user, module=MODULE_PRODUCTION, level=level)
        return user

    def make_receipt(self, owner, suffix):
        receipt = PendingReceipt.objects.create(
            production_order_doc_entry=suffix,
            production_order_doc_num=str(suffix),
            item_code="FG-001",
            warehouse_code="WH-01",
            status=PendingReceipt.PENDING_REVIEW,
            created_by=owner,
        )
        batch = PendingReceiptBatch.objects.create(
            pending_receipt=receipt,
            batch_number=f"{suffix}-1",
            quantity=1,
            unit_count=1,
        )
        return receipt, batch

    def test_production_user_review_is_owner_scoped_and_own_detail_is_allowed(self):
        user = self.make_production_user("production_owner")
        other = self.make_production_user("production_other")
        own, _own_batch = self.make_receipt(user, 1001)
        foreign, _foreign_batch = self.make_receipt(other, 1002)
        self.client.force_login(user)

        response = self.client.get("/api/admin/pending-receipts/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [item["id"] for item in response.json()["data"]["receipts"]],
            [own.id],
        )
        self.assertEqual(
            self.client.get(f"/api/admin/pending-receipts/{own.id}/").status_code,
            200,
        )
        self.assertEqual(
            self.client.get(f"/api/admin/pending-receipts/{foreign.id}/").status_code,
            404,
        )

    def test_production_user_can_edit_own_batch_but_not_another_users_batch(self):
        user = self.make_production_user("production_editor")
        other = self.make_production_user("production_foreign_owner")
        own, own_batch = self.make_receipt(user, 1101)
        foreign, foreign_batch = self.make_receipt(other, 1102)
        self.client.force_login(user)

        own_response = self.client.patch(
            f"/api/admin/pending-receipts/{own.id}/batches/{own_batch.id}/",
            data=json.dumps({"unit_count": 7}),
            content_type="application/json",
        )
        self.assertEqual(own_response.status_code, 200)
        own_batch.refresh_from_db()
        self.assertEqual(own_batch.unit_count, 7)

        foreign_response = self.client.patch(
            f"/api/admin/pending-receipts/{foreign.id}/batches/{foreign_batch.id}/",
            data=json.dumps({"unit_count": 9}),
            content_type="application/json",
        )
        self.assertEqual(foreign_response.status_code, 404)
        foreign_batch.refresh_from_db()
        self.assertEqual(foreign_batch.unit_count, 1)

    def test_production_user_direct_sap_post_is_forbidden(self):
        user = self.make_production_user("production_no_post")
        receipt, _batch = self.make_receipt(user, 1201)
        self.client.force_login(user)

        response = self.client.post(
            f"/api/admin/pending-receipts/{receipt.id}/approve-post/"
        )
        self.assertEqual(response.status_code, 403)

    def test_production_admin_and_super_admin_retain_cross_owner_access(self):
        owner = self.make_production_user("production_record_owner")
        receipt, _batch = self.make_receipt(owner, 1301)
        production_admin = self.make_production_user("production_module_admin", LEVEL_ADMIN)
        super_admin = User.objects.create_superuser("production_super_admin", password="password123")

        for actor in (production_admin, super_admin):
            with self.subTest(actor=actor.username):
                self.client.force_login(actor)
                self.assertEqual(
                    self.client.get(f"/api/admin/pending-receipts/{receipt.id}/").status_code,
                    200,
                )


class InlineUserModulePermissionTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser("inline_permissions_admin", password="password123")
        self.client.force_login(self.admin)

    def create_user(self, username, permissions):
        return self.client.post(
            "/api/create-user/",
            data=json.dumps({
                "username": username,
                "password": "password123",
                "role": "quality_user",
                "warehouse": "",
                "module_permissions": permissions,
            }),
            content_type="application/json",
        )

    def test_create_super_admin_does_not_create_module_permission_rows(self):
        response = self.client.post(
            "/api/create-user/",
            data=json.dumps({
                "username": "global_super_admin",
                "password": "password123",
                "role": "admin",
                "warehouse": "",
                "module_permissions": {},
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        created = User.objects.get(username="global_super_admin")
        self.assertFalse(UserModulePermission.objects.filter(user=created).exists())
        for module in (
            MODULE_PRODUCTION, MODULE_TRANSFER, MODULE_QUALITY,
            MODULE_GRPO, MODULE_PURCHASE_QUOTATION, MODULE_SCALE,
        ):
            self.assertTrue(can_access_module(created, module))
            self.assertTrue(can_manage_module(created, module))

    def test_create_production_module_user_without_warehouse(self):
        response = self.client.post(
            "/api/create-user/",
            data=json.dumps({
                "username": "production_without_warehouse",
                "password": "password123",
                "role": "production_user",
                "module_permissions": {MODULE_PRODUCTION: LEVEL_USER},
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        created = User.objects.get(username="production_without_warehouse")
        self.assertEqual(get_module_permissions(created), {MODULE_PRODUCTION: LEVEL_USER})

    def test_create_supports_each_grpo_and_purchase_quotation_level(self):
        cases = (
            ("grpo_user", {MODULE_GRPO: LEVEL_USER}),
            ("grpo_admin", {MODULE_GRPO: LEVEL_ADMIN}),
            ("quotation_user", {MODULE_PURCHASE_QUOTATION: LEVEL_USER}),
            ("quotation_admin", {MODULE_PURCHASE_QUOTATION: LEVEL_ADMIN}),
        )
        for username, permissions in cases:
            with self.subTest(username=username):
                response = self.create_user(username, permissions)
                self.assertEqual(response.status_code, 200)
                user = User.objects.get(username=username)
                self.assertEqual(get_module_permissions(user), permissions)

    def test_create_stores_both_modules_independently_and_supports_no_access(self):
        response = self.create_user("both_inline", {
            MODULE_GRPO: LEVEL_USER,
            MODULE_PURCHASE_QUOTATION: LEVEL_ADMIN,
        })
        self.assertEqual(response.status_code, 200)
        both = User.objects.get(username="both_inline")
        self.assertTrue(can_access_module(both, MODULE_GRPO))
        self.assertFalse(can_manage_module(both, MODULE_GRPO))
        self.assertTrue(can_manage_module(both, MODULE_PURCHASE_QUOTATION))

        response = self.create_user("neither_inline", {
            MODULE_GRPO: "",
            MODULE_PURCHASE_QUOTATION: "NONE",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(get_module_permissions(User.objects.get(username="neither_inline")), {})

    def test_editing_each_inline_permission_preserves_the_other_and_unrelated_modules(self):
        target = User.objects.create_user("inline_edit_target", password="password123")
        target.userprofile.role = "quality_user"
        target.userprofile.module_permissions_initialized = True
        target.userprofile.save(update_fields=["role", "module_permissions_initialized"])
        for module, level in {
            MODULE_GRPO: LEVEL_USER,
            MODULE_PURCHASE_QUOTATION: LEVEL_ADMIN,
            MODULE_TRANSFER: LEVEL_USER,
        }.items():
            UserModulePermission.objects.create(user=target, module=module, level=level)

        response = self.client.patch(
            f"/api/admin/users/{target.id}/",
            data=json.dumps({"module_permissions": {MODULE_GRPO: LEVEL_ADMIN}}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        target.refresh_from_db()
        self.assertEqual(get_module_permissions(target), {
            MODULE_GRPO: LEVEL_ADMIN,
            MODULE_PURCHASE_QUOTATION: LEVEL_ADMIN,
            MODULE_TRANSFER: LEVEL_USER,
        })

        response = self.client.patch(
            f"/api/admin/users/{target.id}/",
            data=json.dumps({"module_permissions": {MODULE_PURCHASE_QUOTATION: "NONE"}}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        target.refresh_from_db()
        self.assertEqual(get_module_permissions(target), {
            MODULE_GRPO: LEVEL_ADMIN,
            MODULE_TRANSFER: LEVEL_USER,
        })

    @patch("api.views.UserModulePermission.objects.bulk_create", side_effect=RuntimeError("permission write failed"))
    def test_create_is_atomic_when_permission_write_fails(self, _bulk_create):
        response = self.create_user("rolled_back_inline", {MODULE_GRPO: LEVEL_USER})
        self.assertEqual(response.status_code, 500)
        self.assertFalse(User.objects.filter(username="rolled_back_inline").exists())
