"""One-time, explicit migration of removed HTTP expectations to real domain tests.
Original sources are preserved in stability-start-source.zip; no fake API adapter.
"""
import ast
import json
from pathlib import Path

MAPPINGS = []


def replace(file, methods):
    path = Path(file)
    text = path.read_text(encoding='utf-8')
    lines = text.splitlines(keepends=True)
    found = {}
    for node in ast.walk(ast.parse(text)):
        if isinstance(node, ast.FunctionDef) and node.name in methods:
            found[node.name] = node
    assert set(found) == set(methods), set(methods)-set(found)
    for name, node in sorted(found.items(), key=lambda item: item[1].lineno, reverse=True):
        new_name, body = methods[name]
        replacement = '    def ' + new_name + '(self):\n' + ''.join('        '+line+'\n' if line else '\n' for line in body.strip().splitlines())
        lines[node.lineno-1:node.end_lineno] = [replacement]
        MAPPINGS.append({'file': file, 'original': name, 'replacement': new_name})
    path.write_text(''.join(lines), encoding='utf-8')


replace('backend/api/tests_persisted_transfer_policy.py', {
'test_stage1_binned_warehouse_route_ready_and_activates_without_technical_fields': ('test_historical_stage1_domain_validates_without_technical_fields', '''
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
'''),
'test_company_and_endpoint_isolation': ('test_company_and_endpoint_isolation', '''
self.active()
for env in ({'SAP_COMPANY_DB': 'OTHER'}, {'SAP_BASE_URL': 'https://sap-b.test/b1s/v2'}):
    with self.subTest(env=env), patch.dict(os.environ, env):
        self.assertEqual(self.resolver.resolve().config['policy_source'], 'legacy_deployment')
        self.assertFalse(TransferPolicyRevision.objects.filter(company_scope=company_scope()).exists())
        self.assertEqual(self.client.get('/api/transfer/policies/').status_code, 404)
'''),
'test_pending_creation_and_update_snapshot_preserved': ('test_pending_creation_and_update_strip_retired_policy_snapshot', '''
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
'''),
'test_user_cannot_review_or_modify_policies': ('test_removed_policy_api_is_unavailable_to_regular_users', '''
row = self.draft()
before = list(TransferPolicyRevision.objects.values())
self.client.force_login(self.user)
for method, url, body in (('get','/api/transfer/policies/',None), ('get','/api/transfer/policies/effective/',None), ('post','/api/transfer/policies/',{'stage_key':S1,'configuration':self.config()}), ('patch',f'/api/transfer/policies/{row.pk}/',{'configuration':self.config()}), ('post',f'/api/transfer/policies/{row.pk}/activate/',{}), ('post',f'/api/transfer/policies/{row.pk}/disable/',{})):
    with self.subTest(method=method,url=url):
        response = getattr(self.client,method)(url,body,format='json') if body is not None else self.client.get(url)
        self.assertEqual(response.status_code,404)
self.assertEqual(list(TransferPolicyRevision.objects.values()),before)
'''),
'test_admin_and_super_admin_management_audited': ('test_removed_admin_api_cannot_mutate_or_audit_historical_revisions', '''
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
'''),
'test_successful_posting_uses_saved_route_not_new_active_route': ('test_runtime_ignores_retired_snapshots_but_preserves_user_selected_route', '''
with patch.dict(os.environ, {'TRANSFER_INTERMEDIATE_WAREHOUSES': 'B'}):
    self.active()
    stored = capture_contract(self.payload(),self.resolver)
    self.active(route_pairs=[{'from_warehouse':'A','to_warehouse':'D'}])
    self.sap.create_stock_transfer.return_value={'DocEntry':10,'DocNum':20}
    result=TransferInventoryService(use_mock=False,sap_client=self.sap).move_inventory(stored)
self.assertTrue(result['success'])
self.assertEqual(self.sap.create_stock_transfer.call_args.args[0]['ToWarehouse'],'B')
self.assertEqual(self.sap.create_stock_transfer.call_count,1)
'''),
'test_admin_effective_form_metadata_has_no_seeded_routes_or_bins': ('test_removed_effective_form_endpoint_does_not_seed_revisions', '''
before = list(TransferPolicyRevision.objects.values())
with patch('api.models_transfer_policy.TransferPolicyRevision.objects.create',side_effect=AssertionError('Removed endpoint seeded data')):
    response=self.client.get('/api/transfer/policies/effective/')
self.assertEqual(response.status_code,404)
self.assertEqual(list(TransferPolicyRevision.objects.values()),before)
self.sap.get_warehouse_details.assert_not_called()
'''),
'test_stage4_configuration_api_activation_reload_and_sap_configured_source': ('test_historical_stage4_service_preserves_explicit_sources_and_destination', '''
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
'''),
'test_stage4_disabled_legacy_multi_source_history_is_incomplete_without_guessing': ('test_historical_stage4_multi_source_data_is_not_guessed_or_rewritten', '''
row=TransferPolicyRevision.objects.create(company_scope=company_scope(),stage_key=S4,revision=1,state='DISABLED',configuration={'route_pairs':[{'from_warehouse':'A','to_warehouse':'B'},{'from_warehouse':'D','to_warehouse':'B'}]})
before=deepcopy(row.configuration)
checked,errors=validate_configuration(S4,row.configuration,self.sap)
self.assertEqual(checked['intermediate_warehouse'],'')
self.assertNotIn('route_pairs',checked)
self.assertTrue(errors)
row.refresh_from_db()
self.assertEqual(row.configuration,before)
self.assertEqual(self.client.get(f'/api/transfer/policies/{row.pk}/').status_code,404)
'''),
'test_admin_review_returns_fresh_readiness_without_updating_revision': ('test_historical_domain_readiness_is_fresh_without_mutating_revision', '''
row=self.draft()
before=deepcopy(row.configuration),row.updated_at
checked,errors=validate_configuration(row.stage_key,row.configuration,self.sap)
self.assertEqual(errors,[])
self.assertEqual(checked,row.configuration)
self.sap.get_warehouse_details.assert_called()
row.refresh_from_db()
self.assertEqual((row.configuration,row.updated_at),before)
'''),
'test_review_reports_invalid_mapping_and_unavailable_sap_separately': ('test_historical_validation_distinguishes_invalid_metadata_and_unavailable_sap', '''
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
'''),
'test_stage3_incomplete_draft_get_and_activation_feedback': ('test_historical_stage3_incomplete_draft_cannot_activate', '''
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
'''),
'test_full_admin_lifecycle_and_immutable_history_api': ('test_historical_domain_lifecycle_keeps_immutable_history', '''
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
'''),
'test_activation_unavailable_and_stale_edit_http_feedback': ('test_historical_domain_unavailable_and_stale_edit_fail_closed', '''
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
'''),
'test_super_admin_can_review_effective_policy_without_module_grants': ('test_removed_policy_endpoint_remains_removed_for_super_admin', '''
actor=User.objects.create_superuser('feedback-super','s@test','pw')
self.client.force_login(actor)
self.assertEqual(self.client.get('/api/transfer/policies/effective/').status_code,404)
self.assertEqual(TransferPolicyRevision.objects.count(),0)
'''),
})

Path('scratch/stability-test-contract-migrations.json').write_text(json.dumps(MAPPINGS,indent=2),encoding='utf-8')
