import json
from unittest.mock import patch
from django.contrib.auth.models import User
from django.http import JsonResponse
from django.db import transaction
from django.test import TestCase, TransactionTestCase, Client, RequestFactory
from django.utils import timezone
from api.models import AuditLog, UserProfile
from api.services.audit_service import (
    log_action,
    log_action_on_commit,
    audit_mutation,
    sanitize_details,
    MODULE_USERS,
    MODULE_AUTH,
    MODULE_TRANSFER,
    MODULE_COLD_STORAGE,
    ACTION_CREATE,
    ACTION_UPDATE,
    ACTION_DELETE,
    ACTION_LOGIN,
    ACTION_POST,
)


class AuditServiceUnitTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="test_admin", password="password123")
        UserProfile.objects.filter(user=self.user).update(role="admin")

    def test_sanitize_details_redacts_sensitive_keys(self):
        raw = {
            "username": "johndoe",
            "password": "supersecretpassword",
            "nested": {
                "access_token": "bearer xyz123",
                "safe_field": 42,
                "api_secret": "my-secret-key",
            },
            "list_of_dicts": [
                {"token": "tok1", "name": "item1"},
                {"sessionid": "sess_abc", "name": "item2"},
            ]
        }
        cleaned = sanitize_details(raw)
        self.assertEqual(cleaned["username"], "johndoe")
        self.assertEqual(cleaned["password"], "[REDACTED]")
        self.assertEqual(cleaned["nested"]["access_token"], "[REDACTED]")
        self.assertEqual(cleaned["nested"]["safe_field"], 42)
        self.assertEqual(cleaned["nested"]["api_secret"], "[REDACTED]")
        self.assertEqual(cleaned["list_of_dicts"][0]["token"], "[REDACTED]")
        self.assertEqual(cleaned["list_of_dicts"][0]["name"], "item1")
        self.assertEqual(cleaned["list_of_dicts"][1]["sessionid"], "[REDACTED]")
        self.assertEqual(cleaned["list_of_dicts"][1]["name"], "item2")

    def test_sanitize_details_redacts_arbitrarily_nested_collections(self):
        cleaned = sanitize_details({
            "items": [[{"credentials": {"password": "nope"}}]],
            "safe": ["value", 2],
        })
        self.assertEqual(
            cleaned["items"][0][0]["credentials"],
            "[REDACTED]",
        )
        self.assertEqual(cleaned["safe"], ["value", 2])

    def test_log_action_creates_record(self):
        log = log_action(
            user=self.user,
            action=ACTION_CREATE,
            module=MODULE_USERS,
            entity_type="User",
            entity_id="99",
            description="Created new user test_user",
            details={"username": "test_user", "password": "plainpassword"},
        )
        self.assertIsNotNone(log)
        self.assertEqual(log.user, self.user)
        self.assertEqual(log.username, "test_admin")
        self.assertEqual(log.action, ACTION_CREATE)
        self.assertEqual(log.module, MODULE_USERS)
        self.assertEqual(log.entity_type, "User")
        self.assertEqual(log.entity_id, "99")
        self.assertEqual(log.status, "SUCCESS")
        self.assertEqual(log.details.get("password"), "[REDACTED]")

    def test_log_action_fail_safe_on_error(self):
        # Even if AuditLog.objects.create raises an exception, log_action returns None without raising
        with patch.object(AuditLog.objects, "create", side_effect=Exception("Database down")):
            result = log_action(
                user=self.user,
                action=ACTION_LOGIN,
                module=MODULE_AUTH,
                description="Login attempt",
            )
            self.assertIsNone(result)

    def test_invalid_forwarded_ip_does_not_break_audit_write(self):
        request = RequestFactory().get("/", HTTP_X_FORWARDED_FOR="not-an-ip")
        request.user = self.user
        entry = log_action(request=request, action=ACTION_UPDATE, module=MODULE_USERS)
        self.assertIsNotNone(entry)
        self.assertIsNone(entry.ip_address)

    def test_audit_entry_is_immutable_and_append_only(self):
        entry = log_action(user=self.user, action=ACTION_CREATE, module=MODULE_USERS)
        entry.description = "changed"
        with self.assertRaises(TypeError):
            entry.save()
        with self.assertRaises(TypeError):
            entry.delete()

    def test_explicit_endpoint_wrapper_audits_and_sanitizes(self):
        @audit_mutation(module="FUTURE_MODULE", entity_type="FutureEntity")
        def endpoint(request, entity_id):
            return JsonResponse({"success": True})

        request = RequestFactory().post(
            "/future/7/",
            data=json.dumps({"nested": {"access_token": "secret", "value": 4}}),
            content_type="application/json",
        )
        request.user = self.user
        request.data = {"nested": {"access_token": "secret", "value": 4}}
        with self.captureOnCommitCallbacks(execute=True):
            endpoint(request, entity_id=7)
        entry = AuditLog.objects.get(module="FUTURE_MODULE")
        self.assertEqual(entry.entity_id, "7")
        self.assertEqual(entry.details["request"]["nested"]["access_token"], "[REDACTED]")
        self.assertEqual(entry.details["request"]["nested"]["value"], 4)

    def test_endpoint_wrapper_records_failed_outcome_without_duplicate_success(self):
        @audit_mutation(
            module=MODULE_TRANSFER,
            entity_type="TransferProbe",
            action=ACTION_POST,
            log_success=False,
        )
        def endpoint(request, transfer_id):
            return JsonResponse({"success": False}, status=409)

        request = RequestFactory().post("/transfer/3/", data={"token": "hidden"})
        request.user = self.user
        request.data = {"token": "hidden"}
        endpoint(request, transfer_id=3)

        entries = AuditLog.objects.filter(entity_type="TransferProbe")
        self.assertEqual(entries.count(), 1)
        self.assertEqual(entries.get().status, AuditLog.STATUS_FAILED)
        self.assertEqual(entries.get().details["request"]["token"], "[REDACTED]")


class AuditLogApiAccessTests(TestCase):
    def setUp(self):
        self.client = Client()
        # Admin user with user management permission
        self.admin_user = User.objects.create_user(username="superadmin", password="password123")
        UserProfile.objects.filter(user=self.admin_user).update(role="admin")

        # Regular operator user without user management permission
        self.operator_user = User.objects.create_user(username="operator1", password="password123")
        UserProfile.objects.filter(user=self.operator_user).update(role="production_user")

        # Seed some audit logs
        AuditLog.objects.create(
            user=self.admin_user,
            username="superadmin",
            action=ACTION_CREATE,
            module=MODULE_USERS,
            entity_type="User",
            entity_id="101",
            description="Created user operator1",
            details={"username": "operator1"},
        )
        AuditLog.objects.create(
            user=self.operator_user,
            username="operator1",
            action=ACTION_POST,
            module=MODULE_TRANSFER,
            entity_type="PendingTransferRequest",
            entity_id="55",
            description="Posted transfer PTR-55",
            details={"batch": "B123"},
        )

    def test_unauthenticated_access_denied(self):
        res = self.client.get("/api/audit-log/")
        self.assertEqual(res.status_code, 401)

    def test_unauthorized_access_denied(self):
        self.client.force_login(self.operator_user)
        res = self.client.get("/api/audit-log/")
        self.assertEqual(res.status_code, 403)

    def test_authorized_admin_access_allowed(self):
        self.client.force_login(self.admin_user)
        res = self.client.get("/api/audit-log/")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data["data"]["count"], 2)
        self.assertIn("results", data["data"])
        self.assertIn("available_modules", data["data"])
        self.assertIn("available_actions", data["data"])

    def test_read_only_methods_rejected(self):
        self.client.force_login(self.admin_user)
        # POST is not allowed
        res_post = self.client.post("/api/audit-log/", data={})
        self.assertEqual(res_post.status_code, 405)
        # DELETE is not allowed
        res_del = self.client.delete("/api/audit-log/")
        self.assertEqual(res_del.status_code, 405)
        # PUT is not allowed
        res_put = self.client.put("/api/audit-log/", data={})
        self.assertEqual(res_put.status_code, 405)

    def test_filter_by_module(self):
        self.client.force_login(self.admin_user)
        res = self.client.get("/api/audit-log/?module=TRANSFER")
        self.assertEqual(res.status_code, 200)
        data = res.json()["data"]
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["module"], "TRANSFER")

    def test_filter_by_action(self):
        self.client.force_login(self.admin_user)
        res = self.client.get("/api/audit-log/?action=CREATE")
        self.assertEqual(res.status_code, 200)
        data = res.json()["data"]
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["action"], "CREATE")

    def test_search_filter(self):
        self.client.force_login(self.admin_user)
        res = self.client.get("/api/audit-log/?search=PTR-55")
        self.assertEqual(res.status_code, 200)
        data = res.json()["data"]
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["entity_id"], "55")

    def test_detail_view(self):
        self.client.force_login(self.admin_user)
        first_log = AuditLog.objects.first()
        res = self.client.get(f"/api/audit-log/{first_log.id}/")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data["data"]["id"], first_log.id)
        self.assertEqual(data["data"]["username"], first_log.username)

    def test_future_module_and_action_values_are_returned_unchanged(self):
        AuditLog.objects.create(
            username="system",
            action="FUTURE_ACTION",
            module="FUTURE_MODULE",
            description="Future event",
        )
        self.client.force_login(self.admin_user)
        data = self.client.get(
            "/api/audit-log/?module=FUTURE_MODULE&action=FUTURE_ACTION"
        ).json()["data"]
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["module"], "FUTURE_MODULE")
        self.assertEqual(data["results"][0]["action"], "FUTURE_ACTION")

    def test_pagination_is_bounded_and_deterministic(self):
        for index in range(105):
            AuditLog.objects.create(
                username="system",
                action="PAGE",
                module="TEST",
                entity_id=str(index),
            )
        self.client.force_login(self.admin_user)
        data = self.client.get("/api/audit-log/?page_size=100&page=2").json()["data"]
        self.assertEqual(data["page_size"], 100)
        self.assertEqual(data["count"], 107)
        self.assertEqual(len(data["results"]), 7)

    def test_username_snapshot_survives_rename_and_delete(self):
        entry = AuditLog.objects.create(
            user=self.operator_user,
            username=self.operator_user.username,
            action=ACTION_UPDATE,
            module=MODULE_USERS,
        )
        self.operator_user.username = "renamed"
        self.operator_user.save(update_fields=["username"])
        self.operator_user.delete()
        entry.refresh_from_db()
        self.assertIsNone(entry.user_id)
        self.assertEqual(entry.username, "operator1")

    def test_create_user_mutation_creates_audit_log(self):
        self.client.force_login(self.admin_user)
        payload = {
            "username": "newaudituser",
            "password": "Password123!",
            "role": "production_user",
            "warehouse": "01",
        }
        res = self.client.post("/api/create-user/", data=json.dumps(payload), content_type="application/json")
        self.assertEqual(res.status_code, 200)
        created_user = User.objects.get(username="newaudituser")

        # Verify audit log was recorded
        audit = AuditLog.objects.filter(
            module=MODULE_USERS,
            action=ACTION_CREATE,
            entity_id=str(created_user.id)
        ).first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.username, "superadmin")
        self.assertEqual(audit.details.get("username"), "newaudituser")
        self.assertEqual(audit.details.get("role"), "production_user")
        # Ensure password was NOT logged
        self.assertNotIn("Password123!", str(audit.details))
        self.assertNotIn("password", audit.details)


class AuditTransactionTests(TransactionTestCase):
    reset_sequences = True

    def test_on_commit_event_is_not_written_after_rollback(self):
        try:
            with transaction.atomic():
                log_action_on_commit(
                    action=ACTION_UPDATE,
                    module=MODULE_TRANSFER,
                    entity_type="RollbackProbe",
                    entity_id="1",
                )
                raise ValueError("rollback")
        except ValueError:
            pass
        self.assertFalse(AuditLog.objects.filter(entity_type="RollbackProbe").exists())

    def test_on_commit_event_is_written_after_commit(self):
        with transaction.atomic():
            log_action_on_commit(
                action=ACTION_UPDATE,
                module=MODULE_TRANSFER,
                entity_type="CommitProbe",
                entity_id="1",
            )
            self.assertFalse(AuditLog.objects.filter(entity_type="CommitProbe").exists())
        self.assertTrue(AuditLog.objects.filter(entity_type="CommitProbe").exists())
