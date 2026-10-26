import os
from unittest.mock import Mock, patch

from django.test import SimpleTestCase, TestCase
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from api.models import TransferWarehouseRule, UserProfile
from api.services.cache_service import sap_master_namespace
from api.services.transfer_policy_service import (
    STAGE_1_TO_INTERMEDIATE as S1, STAGE_2_TO_FRIDGE as S2,
    STAGE_3_FROM_FRIDGE as S3, STAGE_4_TO_DESTINATION as S4,
    TransferPolicyError, TransferPolicyResolver,
    validate_master_data_boundary,
)
from api.services.transfer_service import TransferInventoryService, TransferValidationError


class TransferPolicyTests(TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {
            "TRANSFER_INTERMEDIATE_WAREHOUSES": "INT-A, INT-B",
            "TRANSFER_FRIDGE_WAREHOUSES": "COLD-A",
            "SAP_BASE_URL": "https://sap-a.example/b1s/v2", "SAP_COMPANY_DB": "COMPANY",
        })
        env.start()
        self.addCleanup(env.stop)
        self.sap = Mock()
        self.resolver = TransferPolicyResolver(self.sap)

    def payload(self, stage, source, destination, **extra):
        return {"transfer_stage": stage, "from_warehouse": source, "to_warehouse": destination,
                "lines": [{"item_code": "ITEM", "batch_number": "PALLET-X", "quantity": 10}], **extra}

    def test_current_stage_policies_and_legacy_source(self):
        config = self.resolver.resolve().config
        self.assertEqual(config["policy_source"], "legacy_deployment")
        self.assertEqual(list(config["stages"]), [S1, S2, S3, S4])
        first, second, third, fourth = [config["stages"][stage] for stage in (S1, S2, S3, S4)]
        self.assertEqual(first["destination_warehouses"], {"allowed": ["INT-A", "INT-B"]})
        self.assertEqual(first["destination_bin_policy"], "unused")
        self.assertEqual(second["source_warehouses"], {"allowed": ["INT-A", "INT-B"]})
        self.assertEqual(second["destination_position_policy"], "legacy_destination_layout")
        self.assertEqual(second["physical_effect"], "occupy_linked_destination")
        self.assertTrue(third["source_position_required"])
        self.assertEqual(third["source_bin_policy"], "required")
        self.assertEqual(third["destination_bin_policy"], "optional")
        self.assertEqual(third["destination_warehouses"], {"allowed": None})
        self.assertEqual(third["physical_effect"], "vacate_linked_source")
        self.assertEqual(third["quantity_policy"], "legacy_positive_available")
        self.sap.get_intermediate_warehouses.assert_not_called()
        self.assertNotIn("20202", repr(config))

    def test_policy_is_deterministic_and_not_shared(self):
        first = self.resolver.resolve().config
        self.assertEqual(first, self.resolver.resolve().config)
        first["stages"][S3]["enabled"] = False
        self.assertTrue(self.resolver.resolve().config["stages"][S3]["enabled"])

    def test_stage4_active_source_and_user_selected_destination_reach_sap_payload(self):
        from api.models_transfer_policy import TransferPolicyRevision
        from api.services.persisted_transfer_policy_service import company_scope
        TransferPolicyRevision.objects.create(company_scope=company_scope(), stage_key=S4,
            revision=1, state='ACTIVE', configuration={
                'enabled': True, 'route_pairs': [{'from_warehouse': '90214', 'to_warehouse': '20202'}],
                'source_bin_policy': 'unused', 'destination_bin_policy': 'unused',
                'allowed_source_bins': {}, 'allowed_destination_bins': {},
            })
        resolved = self.resolver.resolve()
        stage = resolved.config['stages'][S4]
        self.assertEqual(stage['ui']['source'], {'mode': 'codes', 'codes': ['90214']})
        self.assertEqual(stage['ui']['destination'], {'mode': 'all', 'exclude_source': True})
        payload = self.payload(S4, '90214', '20205', to_bin='20205-USER-BIN')
        resolved.validate_route(payload)
        for source, destination in [('90111', '20205'), ('90214', '90214')]:
            with self.assertRaises(TransferPolicyError):
                resolved.validate_route(self.payload(S4, source, destination))
        self.sap.create_stock_transfer.return_value = {'DocEntry': 10, 'DocNum': 20}
        service = TransferInventoryService(use_mock=False, sap_client=self.sap)
        with patch.object(service, '_get_bin_abs_entry', return_value=123):
            service._sap_move_inventory(payload)
        actual = self.sap.create_stock_transfer.call_args.args[0]
        self.assertEqual(actual['FromWarehouse'], '90214')
        line = actual['StockTransferLines'][0]
        self.assertEqual(line['FromWarehouseCode'], '90214')
        self.assertEqual(line['WarehouseCode'], '20205')
        self.assertEqual(line['StockTransferLinesBinAllocations'][0]['BinAbsEntry'], 123)
        plain = self.payload(S4, '90214', 'USER-DESTINATION')
        resolved.validate_route(plain)
        service._sap_move_inventory(plain)
        actual = self.sap.create_stock_transfer.call_args.args[0]
        self.assertEqual(actual['FromWarehouse'], '90214')
        self.assertEqual(actual['ToWarehouse'], 'USER-DESTINATION')
        line = actual['StockTransferLines'][0]
        self.assertEqual(line['FromWarehouseCode'], '90214')
        self.assertEqual(line['WarehouseCode'], 'USER-DESTINATION')
        self.assertNotIn('StockTransferLinesBinAllocations', line)

    def test_intermediate_discovery_only_when_legacy_setting_missing(self):
        self.sap.get_intermediate_warehouses.return_value = [
            {"code": "DISC", "inactive": False}, {"code": "OLD", "inactive": True},
        ]
        with patch.dict(os.environ, {"TRANSFER_INTERMEDIATE_WAREHOUSES": ""}):
            config = self.resolver.resolve().config
        self.assertEqual(config["intermediate_warehouses"], ["DISC"])
        self.assertFalse(config["intermediate_configured"])
        self.sap.get_intermediate_warehouses.assert_called_once_with()

    def test_missing_intermediate_preserves_skipped_membership_validation(self):
        self.sap.get_intermediate_warehouses.side_effect = RuntimeError("Offline")
        with patch.dict(os.environ, {"TRANSFER_INTERMEDIATE_WAREHOUSES": ""}):
            policy = self.resolver.resolve()
        policy.validate_route(self.payload(S1, "ANY", "ANY"))
        policy.validate_route(self.payload(S2, "ANY", "COLD-A", to_bin="BIN"))
        with self.assertRaisesRegex(TransferPolicyError, "cannot be the same"):
            policy.validate_route(self.payload(S2, "ANY", "ANY"))

    def test_missing_fridge_preserves_legacy_source_and_destination_fallback(self):
        with patch.dict(os.environ, {"TRANSFER_FRIDGE_WAREHOUSES": ""}):
            policy = self.resolver.resolve()
        policy.validate_route(self.payload(S2, "INT-A", "UNLISTED", to_bin="BIN"))
        policy.validate_route(self.payload(S3, "UNLISTED", "ANY"))

    def test_legacy_route_constraints_and_stage_validation(self):
        policy = self.resolver.resolve()
        policy.validate_route(self.payload(S1, "PROD", "INT-A"))
        policy.validate_route(self.payload(S2, "INT-A", "INT-B"))
        policy.validate_route(self.payload(S3, "COLD-A", "ANY"))
        for payload in [self.payload(S1, "INT-A", "INT-B"),
                        self.payload(S1, "PROD", "BAD"),
                        self.payload(S2, "PROD", "COLD-A", to_bin="BIN"),
                        self.payload(S2, "INT-A", "BAD", to_bin="BIN"),
                        self.payload(S3, "BAD", "ANY"), self.payload("BOTH", "PROD", "INT-A")]:
            with self.subTest(payload=payload), self.assertRaises(TransferPolicyError):
                policy.validate_route(payload)

    def test_explicit_pair_representation_cannot_expand_to_another_destination(self):
        policy = self.resolver.resolve()
        policy.config["stages"][S1]["route_pairs"] = [{"from_warehouse": "PROD", "to_warehouse": "INT-A"}]
        policy.validate_route(self.payload(S1, "PROD", "INT-A"))
        with self.assertRaisesRegex(TransferPolicyError, "route is not allowed"):
            policy.validate_route(self.payload(S1, "PROD", "INT-B"))
        policy.config["stages"][S1]["route_pairs"] = []
        with self.assertRaises(TransferPolicyError):
            policy.validate_route(self.payload(S1, "PROD", "INT-A"))

    def test_mock_discovery_never_calls_sap(self):
        with patch.dict(os.environ, {"TRANSFER_INTERMEDIATE_WAREHOUSES": ""}):
            policy = TransferPolicyResolver(self.sap, use_mock=True).resolve()
        self.assertEqual(policy.config["intermediate_warehouses"], [])
        self.sap.get_intermediate_warehouses.assert_not_called()

    def test_invalid_request_header_does_not_trigger_sap_discovery(self):
        service = TransferInventoryService(sap_client=self.sap)
        with patch.dict(os.environ, {"TRANSFER_INTERMEDIATE_WAREHOUSES": ""}):
            for payload in [{}, {"transfer_stage": "BOTH"}, {"transfer_stage": S1}]:
                with self.assertRaises(TransferValidationError):
                    service._validate_move_payload(payload)
        self.sap.get_intermediate_warehouses.assert_not_called()

    def test_validation_and_config_use_resolver(self):
        service = TransferInventoryService(sap_client=self.sap)
        self.assertEqual(service.get_transfer_config(), service.resolve_transfer_policy().config)
        with patch.object(service, "resolve_transfer_policy", wraps=service.resolve_transfer_policy) as resolve:
            cleaned = service._validate_move_payload(self.payload(S1, "PROD", "INT-A"))
        resolve.assert_called_once()
        self.assertEqual(cleaned["lines"][0]["batch_number"], "PALLET-X")
        with self.assertRaisesRegex(TransferValidationError, "source bin"):
            service._validate_move_payload(self.payload(S3, "COLD-A", "ANY"))

    def test_stage1_and_stage2_sap_payloads_unchanged(self):
        self.sap.create_stock_transfer.return_value = {"DocEntry": 1, "DocNum": 2}
        self.sap.get_bin_locations_by_warehouse.return_value = {"value": [{"BinCode": "BIN", "AbsEntry": 9}]}
        service = TransferInventoryService(sap_client=self.sap)
        first = self.payload(S1, "PROD", "INT-A", from_bin="IGNORED", to_bin="IGNORED")
        service.move_inventory(first)
        line = self.sap.create_stock_transfer.call_args.args[0]["StockTransferLines"][0]
        self.assertEqual(line, {"ItemCode": "ITEM", "Quantity": 10.0, "FromWarehouseCode": "PROD",
                                "WarehouseCode": "INT-A", "BatchNumbers": [{"BatchNumber": "PALLET-X", "Quantity": 10.0}]})
        with patch.object(service, "validate_stage2_destination_position"):
            service.move_inventory(self.payload(S2, "INT-A", "COLD-A", to_bin="BIN"))
        line = self.sap.create_stock_transfer.call_args.args[0]["StockTransferLines"][0]
        self.assertEqual(line["StockTransferLinesBinAllocations"], [{"BinAbsEntry": 9, "Quantity": 10.0,
            "AllowNegativeQuantity": "tNO", "BinActionType": "batToWarehouse", "BaseLineNumber": 0,
            "SerialAndBatchNumbersBaseLine": 0}])

    def test_stage3_sap_payload_unchanged_without_dock_destination(self):
        self.sap.get_warehouse_details.return_value = {'WarehouseCode': 'ANY', 'EnableBinLocations': 'tNO'}
        service = TransferInventoryService(sap_client=self.sap)
        self.sap.create_stock_transfer.return_value = {"DocEntry": 1, "DocNum": 2}
        self.sap.get_bin_locations_by_warehouse.return_value = {"value": [{"BinCode": "SOURCE-BIN", "AbsEntry": 8}]}
        service._sap_move_inventory(self.payload(S3, "COLD-A", "ANY", from_bin="SOURCE-BIN"))
        line = self.sap.create_stock_transfer.call_args.args[0]["StockTransferLines"][0]
        self.assertEqual(line["WarehouseCode"], "ANY")
        self.assertEqual(line["BatchNumbers"][0]["BatchNumber"], "PALLET-X")
        self.assertEqual(len(line["StockTransferLinesBinAllocations"]), 1)
        self.assertEqual(line["StockTransferLinesBinAllocations"][0]["BinActionType"], "batFromWarehouse")

    def test_master_data_boundary_is_pure_and_not_a_legacy_restriction(self):
        warehouse = {"WarehouseCode": "W", "Inactive": "tNO", "EnableBinLocations": "tYES"}
        bin_record = {"Warehouse": "W", "AbsEntry": 1, "BinCode": "B", "Inactive": "tNO", "IsSystemBin": "tNO"}
        validate_master_data_boundary(warehouse, bin_record, require_bin=True, physical=True)
        for bad_warehouse, bad_bin in [
            (None, None), ({**warehouse, "Inactive": "tYES"}, bin_record),
            (warehouse, None), (warehouse, {**bin_record, "Warehouse": "OTHER"}),
            (warehouse, {**bin_record, "Inactive": "tYES"}),
            (warehouse, {**bin_record, "IsSystemBin": "tYES"}),
            ({**warehouse, "EnableBinLocations": "tNO"}, bin_record),
        ]:
            with self.subTest(bin=bad_bin), self.assertRaises(TransferPolicyError):
                validate_master_data_boundary(bad_warehouse, bad_bin, require_bin=True, physical=True)

    def test_cache_and_policy_scope_isolate_same_company_on_different_endpoints(self):
        first = sap_master_namespace("bin-locations")
        first_policy = self.resolver.resolve().config["company_scope"]
        with patch.dict(os.environ, {"SAP_BASE_URL": "https://sap-b.example/b1s/v2"}):
            self.assertNotEqual(first, sap_master_namespace("bin-locations"))
            self.assertNotEqual(first_policy, self.resolver.resolve().config["company_scope"])
        with patch.dict(os.environ, {"SAP_BASE_URL": "https://sap-a.example/b1s/v2/"}):
            self.assertEqual(first, sap_master_namespace("bin-locations"))
        with patch.dict(os.environ, {"SAP_COMPANY_DB": "OTHER"}):
            self.assertNotEqual(first, sap_master_namespace("bin-locations"))


class TransferPolicyAuthorizationTests(TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {"TRANSFER_INTERMEDIATE_WAREHOUSES": "INT", "TRANSFER_FRIDGE_WAREHOUSES": "COLD"})
        env.start()
        self.addCleanup(env.stop)
        self.user = User.objects.create_user(username="policy-user", password="password")
        UserProfile.objects.filter(user=self.user).update(role="transfer")
        self.client = APIClient()
        self.client.force_login(self.user)

    def test_policy_acceptance_does_not_grant_user_access(self):
        payload = {"transfer_stage": S1, "from_warehouse": "PROD", "to_warehouse": "INT",
                   "lines": [{"item_code": "I", "batch_number": "X", "quantity": 1}]}
        TransferPolicyResolver(use_mock=True).resolve().validate_route(payload)
        with patch("api.views._create_pending_transfer_request_with_retry") as create:
            self.assertEqual(self.client.post('/api/transfer/move/', payload, format='json').status_code, 403)
            create.assert_not_called()

    def test_user_grants_do_not_bypass_operational_policy(self):
        for warehouse in ("PROD", "BAD"):
            TransferWarehouseRule.objects.create(user=self.user, warehouse_code=warehouse, direction="BOTH", stage=S1)
        payload = {"transfer_stage": S1, "from_warehouse": "PROD", "to_warehouse": "BAD"}
        with patch("api.views._create_pending_transfer_request_with_retry") as create:
            self.assertEqual(self.client.post('/api/transfer/move/', payload, format='json').status_code, 400)
            create.assert_not_called()

    def test_removed_frontend_config_endpoint_does_not_expose_policy(self):
        response = self.client.get('/api/transfer/config/')
        self.assertEqual(response.status_code, 404)
