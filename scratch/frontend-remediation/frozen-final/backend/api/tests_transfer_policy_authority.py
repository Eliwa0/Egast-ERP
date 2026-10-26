"""Historical policy domain services; the removed public API is tested separately."""
import os
from copy import deepcopy
from unittest.mock import Mock, patch
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient
from api.models import TransferWarehouseRule
from api.models_transfer_policy import TransferPolicyRevision
from api.models_cold_storage import ColdStorageBinLayout
from api.services.transfer_policy_service import TransferPolicyResolver, STAGE_1_TO_INTERMEDIATE as S1, STAGE_2_TO_FRIDGE as S2, STAGE_3_FROM_FRIDGE as S3
from api.services.persisted_transfer_policy_service import company_scope, normalize_configuration, validate_configuration, change_policy

class TransferPolicyAuthorityTests(TestCase):
    def setUp(self):
        env=patch.dict(os.environ,{'SAP_BASE_URL':'https://policy.test/b1s/v2','SAP_COMPANY_DB':'COMPANY',
            'TRANSFER_INTERMEDIATE_WAREHOUSES':'LEGACY','TRANSFER_FRIDGE_WAREHOUSES':'LEGACY-COLD'})
        env.start();self.addCleanup(env.stop)
        self.actor=User.objects.create_superuser('policy-authority','policy@example.com','test')
        self.client=APIClient();self.client.force_login(self.actor);self.client.force_authenticate(self.actor)
        self.sap=Mock()
        self.sap.get_warehouse_details.side_effect=lambda code:{'WarehouseCode':code,'Inactive':'tNO',
            'EnableBinLocations':'tYES' if code in ('20201','20202') else 'tNO','DefaultBinEnforced':'tNO'}
        self.sap.get_bin_locations_by_warehouse.side_effect=lambda code:{'value':[{'Warehouse':code,
            'BinCode':'20201-F01-R01-C01-RA' if code=='20201' else 'ADMIN-SELECTED',
            'AbsEntry':142 if code=='20201' else 77,'Inactive':'tNO','IsSystemBin':'tNO'}]}

    def row(self,stage,state='DRAFT',revision=1,**extra):
        routes={S1:('20203','90214'),S2:('90214','20201'),S3:('20201','20202')}
        source,destination=routes[stage]
        config=normalize_configuration(stage,{'route_pairs':[{'from_warehouse':source,'to_warehouse':destination}],**extra}, legacy_stage2_bins=True)
        if stage==S2: config['route_pairs'][0]['destination_type']='fridge'
        return TransferPolicyRevision.objects.create(company_scope=company_scope(),stage_key=stage,state=state,
            revision=revision,configuration=config,created_by=self.actor,updated_by=self.actor)

    def effective(self):
        return TransferPolicyResolver(sap_client=self.sap).resolve(administration=True).config

    def test_independent_active_draft_and_incomplete_draft_display_as_persisted(self):
        active=self.row(S1,'ACTIVE',3)
        second=self.row(S2,allowed_destination_bins={'20201':[{'bin_code':'20201-F01-R01-C01-RA','abs_entry':142}]})
        third=self.row(S3)
        before=list(TransferPolicyRevision.objects.values())
        result=self.effective()
        for row in (active,second,third):
            stage=result['stages'][row.stage_key]
            self.assertEqual(stage['policy_source'],'persisted_policy')
            self.assertEqual(stage['state'],row.state)
            self.assertEqual(stage['revision'],row.revision)
            self.assertEqual(stage['route_pairs'],row.configuration['route_pairs'])
            self.assertEqual(stage['allowed_destination_bins'],{} if row.stage_key == S2 else row.configuration['allowed_destination_bins'])
            self.assertNotIn('LEGACY',repr(stage))
        _, errors=validate_configuration(third.stage_key,third.configuration,self.sap)
        self.assertTrue(errors)
        with self.assertRaises(ValueError):
            change_policy(third,self.actor,self.sap,state='ACTIVE')
        self.assertEqual(list(TransferPolicyRevision.objects.values()),before)
        self.assertEqual(TransferWarehouseRule.objects.count(),0)
        self.sap.create_stock_transfer.assert_not_called()

    def test_active_precedes_newer_draft_and_draft_precedes_disabled(self):
        active=self.row(S1,'ACTIVE',3);self.row(S1,'DRAFT',4)
        draft=self.row(S2,'DRAFT',1);self.row(S2,'DISABLED',2)
        result=self.effective()['stages']
        self.assertEqual(result[S1]['policy_id'],active.pk)
        self.assertEqual(result[S2]['policy_id'],draft.pk)

    def test_legacy_only_when_stage_has_no_saved_revision(self):
        self.row(S1,'DISABLED')
        result=self.effective()['stages']
        self.assertEqual(result[S1]['policy_source'],'persisted_policy')
        self.assertEqual(result[S1]['state'],'DISABLED')
        for stage in (S2,S3):self.assertEqual(result[stage]['policy_source'],'legacy_deployment')

    def test_foreign_company_draft_cannot_override_this_company(self):
        row=self.row(S2);row.company_scope='OTHER';row.save()
        self.assertEqual(self.effective()['stages'][S2]['policy_source'],'legacy_deployment')

    def test_new_draft_defaults_have_no_warehouse_or_bin_mapping(self):
        for stage in (S1,S2,S3):
            default=normalize_configuration(stage,{'route_pairs':[]})
            self.assertEqual(default['route_pairs'],[])
            self.assertEqual(default['allowed_source_bins'],{})
            self.assertEqual(default['allowed_destination_bins'],{})
        self.assertEqual(TransferPolicyRevision.objects.count(),0)

    def test_explicit_shipping_bin_is_saved_only_to_draft(self):
        row=self.row(S3);before=deepcopy(row.configuration)
        config=deepcopy(before);config['allowed_destination_bins']={'20202':[{'bin_code':'ADMIN-SELECTED','abs_entry':77}]}
        change_policy(row,self.actor,self.sap,configuration=config)
        row.refresh_from_db();self.assertEqual(row.state,'DRAFT')
        self.assertEqual(row.configuration['allowed_destination_bins'],config['allowed_destination_bins'])
        self.assertEqual(row.configuration['route_pairs'],before['route_pairs'])
        self.assertEqual(self.effective()['stages'][S3]['allowed_destination_bins'],config['allowed_destination_bins'])
        self.sap.create_stock_transfer.assert_not_called()

    def test_stage2_valid_existing_mapping_remains_activatable(self):
        ColdStorageBinLayout.objects.create(warehouse_code='20201',bin_code='20201-F01-R01-C01-RA',sap_bin_abs_entry=142,capacity=2,allocation_type='ALLOCATABLE')
        row=self.row(S2,destination_physical_purpose='cold_storage',allowed_destination_bins={'20201':[{'bin_code':'20201-F01-R01-C01-RA','abs_entry':142}]})
        _, errors=validate_configuration(row.stage_key,row.configuration,self.sap)
        self.assertEqual(errors,[])
        row.refresh_from_db();self.assertEqual(row.state,'DRAFT')
        active, errors=change_policy(row,self.actor,self.sap,state='ACTIVE')
        self.assertEqual(active.state,'ACTIVE')
        self.assertEqual(errors,[])

    def test_administration_does_not_change_execution_resolver_or_stored_contract(self):
        self.row(S1,'ACTIVE',3);self.row(S2);self.row(S3)
        resolver=TransferPolicyResolver(self.sap)
        before=deepcopy(resolver.resolve().config)
        self.effective()
        after=resolver.resolve().config
        self.assertEqual(after,before)
        self.assertEqual(after['stages'][S1]['revision'],3)
        self.assertEqual(after['stages'][S2]['policy_source'],'legacy_deployment')
        self.assertEqual(after['stages'][S3]['policy_source'],'legacy_deployment')
