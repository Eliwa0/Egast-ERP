import os
from copy import deepcopy
from unittest.mock import Mock, patch

from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from api.models import TransferPolicyRevision, UserProfile, PendingTransferRequest, AuditLog
from api.services.transfer_policy_service import TransferPolicyResolver, TransferPolicyError, STAGE_1_TO_INTERMEDIATE as S1, STAGE_2_TO_FRIDGE as S2, STAGE_3_FROM_FRIDGE as S3, STAGE_4_TO_DESTINATION as S4
from api.services.persisted_transfer_policy_service import (
    company_scope, create_draft, change_policy, validate_configuration,
    capture_contract, resolve_contract, SNAPSHOT_KEY,
)
from api.services.transfer_service import TransferInventoryService, TransferValidationError


class PersistedTransferPolicyTests(TestCase):
    def test_historical_stage1_domain_validates_without_technical_fields(self):
        self.warehouses['A']['EnableBinLocations'] = 'tYES'
        self.warehouses['B']['EnableBinLocations'] = 'tYES'
        row, errors = create_draft(S1, self.config(), self.admin, self.sap)
        self.assertEqual(errors, [])
        self.assertEqual(row.configuration['physical_effect'], 'none')
        self.assertEqual(row.configuration['quantity_policy'], 'legacy_positive_available')
        self.assertFalse(row.configuration['source_position_required'])
        active, errors = change_policy(row, self.admin, self.sap, state='ACTIVE')
        self.assertEqual(active.state, 'ACTIVE')
        self.assertEqual(errors, [])
        self.sap.create_stock_transfer.assert_not_called()

    def test_stage1_and_stage2_operational_metadata_is_server_owned(self):
        for stage in (S1, S2):
            config = self.config(physical_effect="", quantity_policy=None, source_position_required=None,
                                 source_bin_policy="required", destination_position_policy="")
            checked, errors = validate_configuration(stage, config, self.sap, activation=True)
            baseline = TransferPolicyResolver(use_mock=True).resolve(include_persisted=False).config["stages"][stage]
            for field in ("physical_effect", "quantity_policy", "source_position_required", "source_bin_policy", "destination_position_policy"):
                self.assertEqual(checked[field], baseline[field])
            self.assertEqual(errors, [])

    def test_stage2_warehouse_route_derives_supported_nonphysical_behavior(self):
        row = self.active(S2)
        self.assertEqual(row.configuration["route_pairs"][0]["destination_type"], "intermediate")
        self.assertEqual(row.configuration["destination_physical_purpose"], "none")
        self.assertEqual(row.configuration["physical_effect"], "occupy_linked_destination")
        self.resolver.resolve().validate_route(self.payload(stage=S2, destination_type="intermediate"))

    def test_stage2_invalid_explicit_destination_type_is_validation_error(self):
        for value in (None, [], {}, "unknown"):
            with self.subTest(value=value), self.assertRaises(TransferPolicyError):
                validate_configuration(S2, {"route_pairs": [{"from_warehouse": "A", "to_warehouse": "B", "destination_type": value}]}, self.sap)

    def test_stage2_cold_storage_route_needs_no_fixed_bin_or_manual_internal_settings(self):
        self.physical_layout()
        config = self.config(allowed_destination_bins={"B": [{"bin_code": "EXPLICIT"}]})
        row, errors = create_draft(S2, config, self.admin, self.sap)
        self.assertEqual(errors, [])
        self.assertEqual(row.configuration["route_pairs"][0]["destination_type"], "fridge")
        self.assertEqual(row.configuration["destination_physical_purpose"], "cold_storage")
        self.assertEqual(row.configuration["allowed_destination_bins"], {})
        active, errors = change_policy(row, self.admin, self.sap, state="ACTIVE")
        self.assertEqual(active.state, "ACTIVE")
        self.assertEqual(errors, [])
        self.sap.create_stock_transfer.assert_not_called()

    def setUp(self):
        from django.core.cache import cache
        cache.clear()
        env = patch.dict(os.environ, {"SAP_BASE_URL": "https://sap-a.test/b1s/v2", "SAP_COMPANY_DB": "A", "TRANSFER_INTERMEDIATE_WAREHOUSES": "LEGACY", "TRANSFER_FRIDGE_WAREHOUSES": "COLD"})
        env.start()
        self.addCleanup(env.stop)
        self.admin = User.objects.create_user("policy-admin")
        self.user = User.objects.create_user("policy-user")
        UserProfile.objects.filter(user=self.admin).update(role="transfer_admin")
        UserProfile.objects.filter(user=self.user).update(role="transfer_user")
        self.sap = Mock()
        self.warehouses = {code: {"WarehouseCode": code, "Inactive": "tNO", "EnableBinLocations": "tNO", "DefaultBinEnforced": "tNO", "DefaultBin": None} for code in ("A", "B", "D", "20201", "20202")}
        self.sap.get_warehouse_details.side_effect = lambda code: deepcopy(self.warehouses.get(code))
        self.bin = {"BinCode": "EXPLICIT", "AbsEntry": 7, "Warehouse": "B", "Inactive": "tNO", "IsSystemBin": "tNO"}
        self.sap.get_bin_locations_by_warehouse.return_value = {"value": [self.bin]}
        self.resolver = TransferPolicyResolver(self.sap)
        self.client = APIClient()
        self.client.force_login(self.admin)

    def config(self, **extra):
        return {"route_pairs": [{"from_warehouse": "A", "to_warehouse": "B"}], **extra}

    def draft(self, stage=S1, **extra):
        return create_draft(stage, self.config(**extra), self.admin, self.sap)[0]

    def active(self, stage=S1, **extra):
        return change_policy(self.draft(stage, **extra), self.admin, self.sap, state="ACTIVE")[0]

    def payload(self, destination="B", stage=S1, **extra):
        return {"transfer_stage": stage, "from_warehouse": "A", "to_warehouse": destination,
                "lines": [{"item_code": "I", "batch_number": "PALLET", "quantity": 1}], **extra}

    def test_draft_and_disabled_do_not_override_legacy(self):
        row = self.draft()
        self.assertEqual(row.state, "DRAFT")
        self.assertEqual(self.resolver.resolve().config["policy_source"], "legacy_deployment")
        change_policy(row, self.admin, self.sap, state="DISABLED")
        self.assertEqual(self.resolver.resolve().config["policy_source"], "legacy_deployment")

    def test_active_route_overrides_legacy_for_selected_stage_only(self):
        self.active()
        policy = self.resolver.resolve()
        policy.validate_route(self.payload())
        with self.assertRaises(TransferPolicyError):
            policy.validate_route(self.payload("D"))
        self.assertEqual(policy.config["stage_sources"][S2], "legacy_deployment")
        self.assertEqual(policy.config["stage_sources"][S3], "legacy_deployment")

    def test_enabled_false_metadata_does_not_gate_runtime_execution(self):
        self.active(enabled=False)
        self.resolver.resolve().validate_route(self.payload())

    def test_company_and_endpoint_isolation(self):
        self.active()
        for env in ({'SAP_COMPANY_DB': 'OTHER'}, {'SAP_BASE_URL': 'https://sap-b.test/b1s/v2'}):
            with self.subTest(env=env), patch.dict(os.environ, env):
                self.assertEqual(self.resolver.resolve().config['policy_source'], 'legacy_deployment')
                self.assertFalse(TransferPolicyRevision.objects.filter(company_scope=company_scope()).exists())
                self.assertEqual(self.client.get('/api/transfer/policies/').status_code, 404)

    def test_revision_replaces_active_without_mutating_previous_config(self):
        first = self.active()
        second = self.active(label="New label")
        first.refresh_from_db()
        self.assertEqual(first.state, "DISABLED")
        self.assertEqual(second.revision, 2)
        self.assertNotEqual(first.configuration["label"], second.configuration["label"])
        self.assertEqual(TransferPolicyRevision.objects.filter(state="ACTIVE").count(), 1)

    def test_database_prevents_two_active_revisions(self):
        self.active()
        with self.assertRaises(IntegrityError), transaction.atomic():
            TransferPolicyRevision.objects.create(company_scope=company_scope(), stage_key=S1, revision=2, state="ACTIVE")

    def test_stale_admin_edit_rejected(self):
        row = self.draft()
        stale = TransferPolicyRevision.objects.get(pk=row.pk)
        change_policy(row, self.admin, self.sap, configuration=self.config(label="Changed"))
        with self.assertRaisesMessage(TransferPolicyError, "concurrently"):
            change_policy(stale, self.admin, self.sap, state="ACTIVE")

    def test_active_configuration_immutable(self):
        with self.assertRaisesMessage(TransferPolicyError, "drafts"):
            change_policy(self.active(), self.admin, self.sap, configuration=self.config())

    def test_warehouse_nonexistent_inactive_and_wrong_exact_code(self):
        for record in (None, {**self.warehouses["B"], "Inactive": "tYES"}, {**self.warehouses["B"], "WarehouseCode": "WRONG"}):
            with self.subTest(record=record):
                self.warehouses["B"] = record
                with self.assertRaises(TransferPolicyError):
                    self.draft()

    def test_stage_both_and_unknown_rejected(self):
        for stage in ("BOTH", "STAGE_4", ""):
            with self.subTest(stage=stage), self.assertRaises(TransferPolicyError):
                self.draft(stage)

    def test_invalid_routes_and_fields_rejected(self):
        for config in ({"route_pairs": None}, {"route_pairs": [{"from_warehouse": "A", "to_warehouse": "A"}]}, {"route_pairs": [{"from_warehouse": "A"}]}, self.config(secret="no"), self.config(enabled="true")):
            with self.subTest(config=config), self.assertRaises(TransferPolicyError):
                create_draft(S1, config, self.admin, self.sap)

    def test_missing_routes_draft_cannot_activate(self):
        row, errors = create_draft(S1, {"route_pairs": []}, self.admin, self.sap)
        self.assertTrue(errors)
        with self.assertRaises(TransferPolicyError):
            change_policy(row, self.admin, self.sap, state="ACTIVE")

    def bin_config(self):
        self.warehouses["B"]["EnableBinLocations"] = "tYES"
        return self.config(destination_bin_policy="required", allowed_destination_bins={"B": [{"bin_code": "EXPLICIT", "abs_entry": 7}]})

    def test_bin_validation_nonexistent_parent_inactive_system_absentry(self):
        config = self.bin_config()
        for row in (None, {**self.bin, "Warehouse": "D"}, {**self.bin, "Inactive": "tYES"}, {**self.bin, "IsSystemBin": "tYES"}, {**self.bin, "AbsEntry": 8}):
            with self.subTest(row=row):
                self.sap.get_bin_locations_by_warehouse.return_value = {"value": [row] if row else []}
                with self.assertRaises(TransferPolicyError):
                    validate_configuration(S1, config, self.sap)

    def test_bin_disabled_warehouse_and_enforced_default_rejected(self):
        config = self.bin_config()
        self.warehouses["B"]["EnableBinLocations"] = "tNO"
        with self.assertRaises(TransferPolicyError):
            validate_configuration(S1, config, self.sap)
        self.warehouses["B"].update(EnableBinLocations="tYES", DefaultBinEnforced="tYES", DefaultBin=99)
        with self.assertRaises(TransferPolicyError):
            validate_configuration(S1, config, self.sap)

    def test_partial_failed_sap_lookup_cannot_validate(self):
        config = self.bin_config()
        self.sap.get_bin_locations_by_warehouse.return_value = {"error": "timeout", "value": [self.bin]}
        with self.assertRaises(TransferPolicyError):
            validate_configuration(S1, config, self.sap)

    def test_no_bin_defaults_or_names_inferred(self):
        self.warehouses["20202"].update(EnableBinLocations="tYES", WarehouseName="Shipping Dock", DefaultBin=7)
        config = {"route_pairs": [{"from_warehouse": "20201", "to_warehouse": "20202"}], "destination_bin_policy": "required", "quantity_policy": "whole_pallet", "physical_effect": "source_vacate_destination_arrival"}
        row, errors = create_draft(S3, config, self.admin, self.sap)
        self.assertTrue(errors)
        self.assertEqual(row.configuration["allowed_destination_bins"], {})
        with self.assertRaises(TransferPolicyError):
            change_policy(row, self.admin, self.sap, state="ACTIVE")
        self.assertEqual(self.resolver.resolve().config["stage_sources"][S3], "legacy_deployment")

    def test_stage2_explicit_nonphysical_intermediate_route(self):
        self.active(S2, route_pairs=[{"from_warehouse": "A", "to_warehouse": "B", "destination_type": "intermediate"}])
        self.resolver.resolve().validate_route(self.payload(stage=S2, destination_type="intermediate"))
        with self.assertRaises(TransferPolicyError):
            self.resolver.resolve().validate_route(self.payload(stage=S2, destination_type="fridge"))

    def test_stage3_missing_physical_source_stays_draft(self):
        row = self.draft(S3)
        with self.assertRaises(TransferPolicyError):
            change_policy(row, self.admin, self.sap, state="ACTIVE")

    def test_new_snapshot_preserved_across_policy_change_and_disable(self):
        first = self.active()
        stored = capture_contract(self.payload(), self.resolver)
        snapshot = deepcopy(stored[SNAPSHOT_KEY])
        self.active(route_pairs=[{"from_warehouse": "A", "to_warehouse": "D"}])
        resolve_contract(stored, self.resolver).validate_route(stored)
        self.assertEqual(stored[SNAPSHOT_KEY], snapshot)
        self.assertEqual(stored[SNAPSHOT_KEY]["stages"][S1]["revision"], first.revision)

    def test_old_unsnapshotted_request_uses_legacy_even_with_active_policy(self):
        self.active()
        old = self.payload("LEGACY")
        resolve_contract(old, self.resolver).validate_route(old)
        with self.assertRaises(TransferPolicyError):
            self.resolver.resolve().validate_route(old)

    def test_stale_live_warehouse_rejected_without_sap_post(self):
        self.active()
        stored = capture_contract(self.payload(), self.resolver)
        self.warehouses["B"]["Inactive"] = "tYES"
        service = TransferInventoryService(use_mock=False, sap_client=self.sap)
        with self.assertRaises(TransferValidationError):
            service.move_inventory(stored)
        self.sap.create_stock_transfer.assert_not_called()

    def test_snapshot_company_switch_and_tampering_rejected(self):
        self.active()
        stored = capture_contract(self.payload(), self.resolver)
        with patch.dict(os.environ, {"SAP_COMPANY_DB": "OTHER"}), self.assertRaises(TransferPolicyError):
            resolve_contract(stored, self.resolver)
        stored[SNAPSHOT_KEY]["stages"][S1]["route_pairs"][0]["to_warehouse"] = "D"
        with self.assertRaises(TransferPolicyError):
            resolve_contract(stored, self.resolver)

    def test_caller_cannot_inject_snapshot_on_creation(self):
        forged = {**self.payload(), SNAPSHOT_KEY: {"secret": "forged"}}
        self.assertNotIn(SNAPSHOT_KEY, capture_contract(forged, self.resolver))

    def test_pending_creation_and_update_strip_retired_policy_snapshot(self):
        from api import views
        self.active()
        service = TransferInventoryService(use_mock=False, sap_client=self.sap)
        with patch.object(views, 'transfer_service', service):
            pending = views._create_pending_transfer_request(self.admin, self.payload(**{SNAPSHOT_KEY: {'forged': True}}))
            self.assertNotIn(SNAPSHOT_KEY, pending.raw_payload_json)
            self.active(route_pairs=[{'from_warehouse': 'A', 'to_warehouse': 'D'}])
            views._update_pending_transfer_request(pending, self.payload(**{SNAPSHOT_KEY: {'forged': True}}))
            pending.refresh_from_db()
            self.assertNotIn(SNAPSHOT_KEY, pending.raw_payload_json)
            self.assertEqual(pending.to_warehouse, 'B')

    def test_removed_policy_api_is_unavailable_to_regular_users(self):
        row = self.draft()
        before = list(TransferPolicyRevision.objects.values())
        self.client.force_login(self.user)
        for method, url, body in (('get','/api/transfer/policies/',None), ('get','/api/transfer/policies/effective/',None), ('post','/api/transfer/policies/',{'stage_key':S1,'configuration':self.config()}), ('patch',f'/api/transfer/policies/{row.pk}/',{'configuration':self.config()}), ('post',f'/api/transfer/policies/{row.pk}/activate/',{}), ('post',f'/api/transfer/policies/{row.pk}/disable/',{})):
            with self.subTest(method=method,url=url):
                response = getattr(self.client,method)(url,body,format='json') if body is not None else self.client.get(url)
                self.assertEqual(response.status_code,404)
        self.assertEqual(list(TransferPolicyRevision.objects.values()),before)

    def test_removed_admin_api_cannot_mutate_or_audit_historical_revisions(self):
        row = self.draft()
        before = list(TransferPolicyRevision.objects.values())
        audits = AuditLog.objects.count()
        superuser = User.objects.create_superuser('policy-super','s@test','pw')
        for actor in (self.admin,superuser):
            self.client.force_login(actor)
            for url in ('/api/transfer/policies/',f'/api/transfer/policies/{row.pk}/activate/',f'/api/transfer/policies/{row.pk}/disable/'):
                self.assertEqual(self.client.post(url,{},format='json').status_code,404)
        self.assertEqual(list(TransferPolicyRevision.objects.values()),before)
        self.assertEqual(AuditLog.objects.count(),audits)
        self.sap.create_stock_transfer.assert_not_called()

    def test_policy_does_not_grant_user_warehouse_access(self):
        self.active()
        self.client.force_login(self.user)
        with patch("api.views._create_pending_transfer_request_with_retry") as create:
            self.assertEqual(self.client.post("/api/transfer/move/", self.payload(), format="json").status_code, 403)
            create.assert_not_called()

    def test_activation_sap_unavailable_fails_closed(self):
        row = self.draft()
        self.sap.get_warehouse_details.side_effect = RuntimeError("offline")
        with self.assertRaises(TransferPolicyError):
            change_policy(row, self.admin, self.sap, state="ACTIVE")
        row.refresh_from_db()
        self.assertEqual(row.state, "DRAFT")

    def physical_layout(self, warehouse="B"):
        from api.models_cold_storage import ColdStorageBinLayout
        self.warehouses[warehouse]["EnableBinLocations"] = "tYES"
        self.bin["Warehouse"] = warehouse
        return ColdStorageBinLayout.objects.create(warehouse_code=warehouse, bin_code="EXPLICIT", sap_bin_abs_entry=7, capacity=2, allocation_type="ALLOCATABLE")

    def test_stage2_physical_route_activates_without_pinning_destination_bin(self):
        self.physical_layout()
        self.active(S2, route_pairs=[{"from_warehouse": "A", "to_warehouse": "B", "destination_type": "fridge"}])
        policy = self.resolver.resolve()
        policy.validate_route(self.payload(stage=S2, destination_type="fridge", to_bin="USER-SELECTED", pallet_position_id=1))
        with self.assertRaises(TransferPolicyError):
            policy.validate_route(self.payload(stage=S2, destination_type="fridge", to_bin=""))
        self.assertEqual(policy.config["stages"][S2]["allowed_destination_bins"], {})

    def test_stage3_existing_source_vacate_capability_can_be_configured(self):
        self.physical_layout("A")
        self.active(S3, source_physical_purpose="cold_storage", allowed_source_bins={"A": [{"bin_code": "EXPLICIT", "abs_entry": 7}]})
        payload = self.payload(stage=S3, from_bin="EXPLICIT")
        self.resolver.resolve().validate_route(payload)
        self.assertEqual(self.resolver.resolve().config["stages"][S3]["physical_effect"], "vacate_linked_source")

    def test_no_fixed_stage2_bin_required_when_physical_layout_exists(self):
        self.physical_layout()
        row = self.draft(S2)
        active, errors = change_policy(row, self.admin, self.sap, state="ACTIVE")
        self.assertEqual(errors, [])
        self.assertEqual(active.configuration["allowed_destination_bins"], {})

    def test_stage2_activation_requires_warehouse_physical_layout(self):
        self.warehouses["B"]["EnableBinLocations"] = "tYES"
        row = self.draft(S2)
        with self.assertRaisesMessage(TransferPolicyError, "physical layout"):
            change_policy(row, self.admin, self.sap, state="ACTIVE")

    def test_stale_bin_identity_rejected_under_saved_revision(self):
        self.physical_layout("A")
        self.active(S3, source_physical_purpose="cold_storage", allowed_source_bins={"A": [{"bin_code": "EXPLICIT"}]})
        stored = capture_contract(self.payload(stage=S3, from_bin="EXPLICIT"), self.resolver)
        self.bin["AbsEntry"] = 8
        with self.assertRaisesMessage(TransferPolicyError, "AbsEntry"):
            resolve_contract(stored, self.resolver)
        self.sap.create_stock_transfer.assert_not_called()

    def test_stage1_cannot_activate_bin_allocation_it_does_not_post(self):
        config = self.bin_config()
        row, _ = create_draft(S1, config, self.admin, self.sap)
        with self.assertRaisesMessage(TransferPolicyError, "does not post"):
            change_policy(row, self.admin, self.sap, state="ACTIVE")

    def test_foreign_policy_detail_and_activation_are_hidden(self):
        row = self.draft()
        with patch.dict(os.environ, {"SAP_BASE_URL": "https://other.test/b1s/v2"}):
            self.assertEqual(self.client.get(f"/api/transfer/policies/{row.pk}/").status_code, 404)
            self.assertEqual(self.client.post(f"/api/transfer/policies/{row.pk}/activate/", {}, format="json").status_code, 404)

    def test_posted_snapshot_cannot_repost_after_policy_change(self):
        from api import views
        self.active()
        service = TransferInventoryService(use_mock=False, sap_client=self.sap)
        with patch.object(views, "transfer_service", service):
            pending = views._create_pending_transfer_request(self.admin, self.payload())
            pending.status = PendingTransferRequest.POSTED
            pending.sap_doc_entry = 10
            pending.save()
            self.active(route_pairs=[{"from_warehouse": "A", "to_warehouse": "D"}])
            response = self.client.post(f"/api/admin/pending-transfers/{pending.pk}/post/", {}, format="json")
            self.assertEqual(response.status_code, 400)
            self.sap.create_stock_transfer.assert_not_called()

    def test_runtime_ignores_retired_snapshots_but_preserves_user_selected_route(self):
        with patch.dict(os.environ, {'TRANSFER_INTERMEDIATE_WAREHOUSES': 'B'}):
            self.active()
            stored = capture_contract(self.payload(),self.resolver)
            self.active(route_pairs=[{'from_warehouse':'A','to_warehouse':'D'}])
            self.sap.create_stock_transfer.return_value={'DocEntry':10,'DocNum':20}
            result=TransferInventoryService(use_mock=False,sap_client=self.sap).move_inventory(stored)
        self.assertTrue(result['success'])
        self.assertEqual(self.sap.create_stock_transfer.call_args.args[0]['ToWarehouse'],'B')
        self.assertEqual(self.sap.create_stock_transfer.call_count,1)

    def test_unknown_sap_safety_flags_fail_closed(self):
        for field in ("Inactive", "EnableBinLocations"):
            original = self.warehouses["B"][field]
            self.warehouses["B"][field] = "unknown"
            with self.subTest(field=field), self.assertRaises(TransferPolicyError):
                self.draft()
            self.warehouses["B"][field] = original

    def test_snapshot_stores_selected_intent_only(self):
        self.active()
        snapshot = capture_contract(self.payload(), self.resolver)[SNAPSHOT_KEY]
        self.assertEqual(list(snapshot["stages"]), [S1])
        self.assertNotIn("intermediate_candidates", snapshot)

    def test_removed_effective_form_endpoint_does_not_seed_revisions(self):
        before = list(TransferPolicyRevision.objects.values())
        with patch('api.models_transfer_policy.TransferPolicyRevision.objects.create',side_effect=AssertionError('Removed endpoint seeded data')):
            response=self.client.get('/api/transfer/policies/effective/')
        self.assertEqual(response.status_code,404)
        self.assertEqual(list(TransferPolicyRevision.objects.values()),before)
        self.sap.get_warehouse_details.assert_not_called()

    def test_historical_stage4_service_preserves_explicit_sources_and_destination(self):
        for code in ('90214','90215'):
            self.warehouses[code]={**self.warehouses['A'],'WarehouseCode':code}
            row, errors=create_draft(S4,{'intermediate_warehouse':code},self.admin,self.sap)
            self.assertNotIn('route_pairs',row.configuration)
            active,errors=change_policy(row,self.admin,self.sap,state='ACTIVE')
            self.assertEqual(errors,[])
            stage=self.resolver.resolve(administration=True).config['stages'][S4]
            self.assertEqual(stage['ui']['source']['codes'],[code])
            self.assertEqual(stage['ui']['destination']['mode'],'all')
            self.sap.create_stock_transfer.return_value={'DocEntry':1,'DocNum':2}
            payload={**self.payload(),'transfer_stage':S4,'from_warehouse':code,'to_warehouse':'B'}
            TransferInventoryService(use_mock=False,sap_client=self.sap)._sap_move_inventory(payload)
            line=self.sap.create_stock_transfer.call_args.args[0]['StockTransferLines'][0]
            self.assertEqual(line['FromWarehouseCode'],code)
            self.assertEqual(line['WarehouseCode'],'B')

    def test_stage4_missing_or_invalid_intermediate_cannot_activate(self):
        for configuration in ({}, {'intermediate_warehouse': 'UNKNOWN'}, {'intermediate_warehouse': ' A '}):
            with self.subTest(configuration=configuration), self.assertRaises(TransferPolicyError):
                validate_configuration(S4, configuration, self.sap, activation=True)

    def test_historical_stage4_multi_source_data_is_not_guessed_or_rewritten(self):
        row=TransferPolicyRevision.objects.create(company_scope=company_scope(),stage_key=S4,revision=1,state='DISABLED',configuration={'route_pairs':[{'from_warehouse':'A','to_warehouse':'B'},{'from_warehouse':'D','to_warehouse':'B'}]})
        before=deepcopy(row.configuration)
        checked,errors=validate_configuration(S4,row.configuration,self.sap)
        self.assertEqual(checked['intermediate_warehouse'],'')
        self.assertNotIn('route_pairs',checked)
        self.assertTrue(errors)
        row.refresh_from_db()
        self.assertEqual(row.configuration,before)
        self.assertEqual(self.client.get(f'/api/transfer/policies/{row.pk}/').status_code,404)

    def test_historical_domain_readiness_is_fresh_without_mutating_revision(self):
        row=self.draft()
        before=deepcopy(row.configuration),row.updated_at
        checked,errors=validate_configuration(row.stage_key,row.configuration,self.sap)
        self.assertEqual(errors,[])
        self.assertEqual(checked,row.configuration)
        self.sap.get_warehouse_details.assert_called()
        row.refresh_from_db()
        self.assertEqual((row.configuration,row.updated_at),before)

    def test_historical_validation_distinguishes_invalid_metadata_and_unavailable_sap(self):
        row=self.draft()
        self.warehouses['B']['Inactive']='tYES'
        with self.assertRaises(TransferPolicyError):
            validate_configuration(row.stage_key,row.configuration,self.sap)
        self.sap.get_warehouse_details.side_effect=RuntimeError('not exposed')
        with self.assertRaises(TransferPolicyError) as caught:
            validate_configuration(row.stage_key,row.configuration,self.sap)
        self.assertNotIn('not exposed',str(caught.exception))
        row.refresh_from_db()
        self.assertEqual(row.state,'DRAFT')

    def test_historical_stage3_incomplete_draft_cannot_activate(self):
        self.warehouses['20202']['EnableBinLocations']='tYES'
        config={'route_pairs':[{'from_warehouse':'20201','to_warehouse':'20202'}],'destination_bin_policy':'required'}
        row,errors=create_draft(S3,config,self.admin,self.sap)
        self.assertTrue(errors)
        self.assertEqual(row.configuration['allowed_destination_bins'],{})
        with self.assertRaises(TransferPolicyError):
            change_policy(row,self.admin,self.sap,state='ACTIVE')
        row.refresh_from_db()
        self.assertEqual(row.state,'DRAFT')
        self.assertEqual(self.resolver.resolve().config['stage_sources'][S3],'legacy_deployment')

    def test_historical_domain_lifecycle_keeps_immutable_history(self):
        row=self.draft()
        row,errors=change_policy(row,self.admin,self.sap,configuration=self.config(label='Admin edited'))
        active,errors=change_policy(row,self.admin,self.sap,state='ACTIVE')
        with self.assertRaises(TransferPolicyError):
            change_policy(active,self.admin,self.sap,configuration=self.config(label='Illegal'))
        replacement=self.active(label='Replacement')
        self.assertEqual(replacement.revision,2)
        row.refresh_from_db()
        self.assertEqual(row.state,'DISABLED')
        self.assertEqual(row.configuration['label'],'Admin edited')
        change_policy(replacement,self.admin,self.sap,state='DISABLED')
        self.assertEqual(self.resolver.resolve().config['policy_source'],'legacy_deployment')

    def test_historical_domain_unavailable_and_stale_edit_fail_closed(self):
        row=self.draft()
        original=self.sap.get_warehouse_details.side_effect
        self.sap.get_warehouse_details.side_effect=RuntimeError('offline')
        with self.assertRaises(TransferPolicyError):
            change_policy(row,self.admin,self.sap,state='ACTIVE')
        self.sap.get_warehouse_details.side_effect=original
        stale=TransferPolicyRevision.objects.get(pk=row.pk)
        change_policy(row,self.admin,self.sap,configuration=self.config(label='Updated'))
        with self.assertRaisesMessage(TransferPolicyError,'concurrently'):
            change_policy(stale,self.admin,self.sap,state='ACTIVE')

    def test_policy_warehouse_options_admin_guard_and_active_flags(self):
        rows = [{"WarehouseCode": "ACTIVE", "WarehouseName": "Active", "Inactive": "tNO"},
                {"WarehouseCode": "INACTIVE", "WarehouseName": "Inactive", "Inactive": "tYES"},
                {"WarehouseCode": "UNKNOWN", "WarehouseName": "Unknown"}]
        with patch("api.views.sap.get_warehouses", return_value={"value": rows}):
            response = self.client.get("/api/warehouses/?policy_options=true")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["inactive"] for row in response.data["data"]["warehouses"]], [False, True, None])
        self.client.force_login(self.user)
        self.assertEqual(self.client.get("/api/warehouses/?policy_options=true").status_code, 403)

    def test_policy_warehouse_failure_is_not_cached_as_success(self):
        with patch("api.views.sap.get_warehouses", side_effect=[{"error": "offline"}, {"value": [{"WarehouseCode": "RECOVERED", "Inactive": "tNO"}]}]):
            first = self.client.get("/api/warehouses/?policy_options=true")
            second = self.client.get("/api/warehouses/?policy_options=true")
        self.assertEqual(first.status_code, 503)
        self.assertEqual(second.data["data"]["warehouses"][0]["code"], "RECOVERED")
        from django.core.cache import cache
        cache.clear()
        with patch("api.views.sap.get_warehouses", side_effect=RuntimeError("Sensitive internal diagnostic")):
            unavailable = self.client.get("/api/warehouses/?policy_options=true")
        self.assertEqual(unavailable.status_code, 503)
        self.assertNotIn("Sensitive", str(unavailable.data))

    def test_removed_policy_endpoint_remains_removed_for_super_admin(self):
        actor=User.objects.create_superuser('feedback-super','s@test','pw')
        self.client.force_login(actor)
        self.assertEqual(self.client.get('/api/transfer/policies/effective/').status_code,404)
        self.assertEqual(TransferPolicyRevision.objects.count(),0)
