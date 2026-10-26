"""Warehouse-level Stage 2 policy with transaction-selected SAP bin/position."""
from copy import deepcopy
from unittest.mock import Mock, patch
from django.test import TestCase
from api.tests_transfer_stage2_destination_integrity import Stage2DestinationPositionIntegrityTests as Integrity
from api.models_transfer_policy import TransferPolicyRevision
from api.models import PendingTransferRequest
from api.models_cold_storage import ColdStoragePalletPosition
from api.services.transfer_policy_service import TransferPolicyResolver, STAGE_2_TO_FRIDGE as S2, TransferPolicyError
from api.services.persisted_transfer_policy_service import create_draft, change_policy, company_scope, effective_stage, capture_contract, resolve_contract, SNAPSHOT_KEY, normalize_configuration

class Stage2PolicyPositionTests(TestCase):
    _layout=Integrity._layout
    _payload=Integrity._payload
    _post_move=Integrity._post_move

    def setUp(self):
        Integrity.setUp(self)
        self.sap=Mock()
        self.sap.get_warehouse_details.side_effect=lambda code:{'WarehouseCode':code,'Inactive':'tNO',
            'EnableBinLocations':'tYES' if code=='20201' else 'tNO','DefaultBinEnforced':'tNO'}
        self.sap.get_bin_locations_by_warehouse.side_effect=lambda code:{'value':[
            {'BinCode':layout.bin_code,'AbsEntry':layout.sap_bin_abs_entry,'Warehouse':code,'Inactive':'tNO','IsSystemBin':'tNO'}
            for layout in (self.layout,self.other_bin_layout) if layout.warehouse_code==code]}
        self.resolver=TransferPolicyResolver(self.sap)
        self.config={'route_pairs':[{'from_warehouse':'90214','to_warehouse':'20201'}, {'from_warehouse':'90214','to_warehouse':'90215'}]}
        self.row,errors=create_draft(S2,self.config,self.admin,self.sap)
        self.assertEqual(errors,[])
        self.row,_=change_policy(self.row,self.admin,self.sap,state='ACTIVE')
        resolver_patch=patch('api.services.transfer_service.TransferInventoryService._policy_resolver',return_value=self.resolver)
        resolver_patch.start();self.addCleanup(resolver_patch.stop)

    def test_policy_has_no_fixed_destination_or_default_position(self):
        stage=self.resolver.resolve().config['stages'][S2]
        self.assertEqual(stage['allowed_destination_bins'],{})
        self.assertEqual(stage['ui']['destination_selection_policy'],'transaction_position')
        self.assertEqual(stage['ui']['destination_position_required_types'],['fridge'])
        self.assertNotIn('pallet_position_id',stage)
        self.assertEqual(stage['physical_effect'],'occupy_linked_destination')

    def test_selected_second_bin_and_position_are_reserved_without_first_bin_override(self):
        response=self._post_move(to_bin=self.other_bin_layout.bin_code,pallet_position_id=self.other_bin_position.pk)
        self.assertEqual(response.status_code,200,response.data)
        pending=PendingTransferRequest.objects.get(pk=response.data['pending_transfer_id'])
        self.other_bin_position.refresh_from_db();self.position.refresh_from_db()
        self.assertEqual(pending.pallet_position_id,self.other_bin_position.pk)
        self.assertEqual(pending.raw_payload_json['to_bin'],self.other_bin_layout.bin_code)
        self.assertEqual(self.other_bin_position.status,ColdStoragePalletPosition.RESERVED)
        self.assertEqual(self.position.status,ColdStoragePalletPosition.AVAILABLE)

    def test_actual_position_is_still_required(self):
        response=self._post_move(pallet_position_id=None)
        self.assertEqual(response.status_code,409,response.data)
        self.assertRegex(response.data["error"], r"(?i)physical.*position")
        self.assertEqual(PendingTransferRequest.objects.count(),0)

    def test_selected_position_must_match_bin(self):
        Integrity.test_wrong_bin_returns_409_without_pending_or_mutation(self)

    def test_selected_position_must_match_warehouse(self):
        Integrity.test_wrong_warehouse_returns_409_without_pending_or_mutation(self)

    def test_occupied_position_is_unavailable(self):
        self.other_bin_position.status=ColdStoragePalletPosition.OCCUPIED;self.other_bin_position.save()
        response=self._post_move(to_bin=self.other_bin_layout.bin_code,pallet_position_id=self.other_bin_position.pk)
        self.assertEqual(response.status_code,400,response.data)
        self.assertIn("OCCUPIED",response.data["error"])
        self.assertEqual(PendingTransferRequest.objects.count(),0)

    def test_second_transfer_cannot_reserve_same_position(self):
        first=self._post_move();self.assertEqual(first.status_code,200,first.data)
        self.mock_lookup.return_value={**self.mock_lookup.return_value,'batch_number':'BATCH-002'}
        second=self._post_move(lines=[{'item_code':'ITEM-001','batch_number':'BATCH-002','quantity':10}])
        self.assertEqual(second.status_code,400,second.data)
        self.assertIn("RESERVED",second.data["error"])
        self.assertEqual(PendingTransferRequest.objects.count(),1)

    def test_nonphysical_stage2_route_remains_supported(self):
        Integrity.test_non_cold_storage_destination_without_position_still_works(self)

    def legacy_row(self):
        self.row.state='DISABLED';self.row.save()
        config=normalize_configuration(S2,{**self.config,'allowed_destination_bins':{'20201':[{'bin_code':self.layout.bin_code,'abs_entry':142}]}},legacy_stage2_bins=True)
        for pair in config['route_pairs']:pair['destination_type']='fridge' if pair['to_warehouse']=='20201' else 'intermediate'
        config['destination_physical_purpose']='cold_storage';config['source_physical_purpose']='none'
        return TransferPolicyRevision.objects.create(company_scope=company_scope(),stage_key=S2,revision=2,state='ACTIVE',configuration=config)

    def test_old_revision_not_mutated_or_applied_to_new_movements(self):
        legacy=self.legacy_row();before=deepcopy(legacy.configuration)
        stage=self.resolver.resolve().config['stages'][S2];self.assertEqual(stage['allowed_destination_bins'],{})
        payload=self._payload(to_bin=self.other_bin_layout.bin_code,pallet_position_id=self.other_bin_position.pk)
        stored=capture_contract(payload,self.resolver)
        resolve_contract(stored,self.resolver).validate_route(stored)
        legacy.refresh_from_db();self.assertEqual(legacy.configuration,before)
        self.assertEqual(stored[SNAPSHOT_KEY]['stages'][S2]['allowed_destination_bins'],{})

    def test_historical_pending_contract_keeps_its_original_bin_restriction(self):
        legacy=self.legacy_row();baseline=self.resolver.resolve(include_persisted=False).config['stages'][S2]
        stage=effective_stage(legacy,baseline,legacy_stage2_bins=True)
        payload=self._payload();payload[SNAPSHOT_KEY]={'company_scope':company_scope(),'policy_version':1,'stages':{S2:stage},'intermediate_warehouses':[],'fridge_warehouses':[]}
        original=deepcopy(payload)
        resolved=resolve_contract(payload,self.resolver);resolved.validate_route(payload)
        with self.assertRaises(TransferPolicyError):resolved.validate_route({**payload,'to_bin':self.other_bin_layout.bin_code,'pallet_position_id':self.other_bin_position.pk})
        self.assertEqual(payload,original)
