from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient, APIRequestFactory

from api.services.master_data_search import query_rows, search_master_data


class MasterDataSearchTests(SimpleTestCase):
    def setUp(self):
        self.sap = Mock()
        self.cache_read = patch('api.services.master_data_search.cache_get', return_value=None)
        self.cache_write = patch('api.services.master_data_search.cache_set')
        self.cache_read.start()
        self.cache_write.start()
        self.addCleanup(self.cache_read.stop)
        self.addCleanup(self.cache_write.stop)

    def request(self, **params):
        from rest_framework.request import Request
        return Request(APIRequestFactory().get('/', params))

    def test_short_query_does_not_contact_sap(self):
        self.assertEqual(search_master_data(self.request(search='a'), self.sap, 'items'), [])
        self.sap._request.assert_not_called()

    def test_browse_warehouses_has_initial_options_and_bounded_offset(self):
        self.sap._request.return_value = {'value': [{'WarehouseCode': 'W26', 'WarehouseName': 'Storage', 'Inactive': 'tNO'}]}
        rows = search_master_data(self.request(initial=1, offset=25, limit=25), self.sap, 'warehouses')
        self.assertEqual(rows[0]['code'], 'W26')
        params = parse_qs(urlsplit(self.sap._request.call_args.args[1]).query)
        self.assertEqual(params['$top'], ['25'])
        self.assertEqual(params['$skip'], ['25'])
        self.assertNotIn('$filter', params)

    def test_initial_browse_retains_warehouse_access_and_bin_parent(self):
        self.sap._request.return_value = {'value': []}
        search_master_data(self.request(initial=1, search='W'), self.sap, 'warehouses', allowed_codes={'W1'})
        params = parse_qs(urlsplit(self.sap._request.call_args.args[1]).query)
        self.assertIn("WarehouseCode eq 'W1'", params['$filter'][0])
        search_master_data(self.request(initial=1), self.sap, 'bins', warehouse='W1')
        params = parse_qs(urlsplit(self.sap._request.call_args.args[1]).query)
        self.assertEqual(params['$filter'], ["Warehouse eq 'W1'"])

    def test_initial_flag_cannot_load_large_catalogs(self):
        for kind in ('items', 'scale-items', 'farms'):
            self.assertEqual(search_master_data(self.request(initial=1), self.sap, kind), [])
        self.sap._request.assert_not_called()

    def test_foreign_bins_are_not_returned_even_if_sap_ignores_warehouse_filter(self):
        self.sap._request.return_value = {'value': [
            {'BinCode': 'WH-P01', 'Warehouse': 'WH', 'AbsEntry': 10},
            {'BinCode': 'OTHER-P01', 'Warehouse': 'OTHER', 'AbsEntry': 11},
        ]}
        rows = search_master_data(self.request(search='P01'), self.sap, 'bins', warehouse='WH')
        self.assertEqual([row['absEntry'] for row in rows], [10])

    def test_search_escapes_odata_and_is_bounded_at_sap(self):
        self.sap._request.return_value = {'value': [{'ItemCode': f'I{i}', 'ItemName': 'Item', 'InventoryUOM': 'KG'} for i in range(80)]}
        rows = search_master_data(self.request(search="ab'&x", limit=3, item_group_code=7), self.sap, 'items')
        self.assertEqual(len(rows), 3)
        params = parse_qs(urlsplit(self.sap._request.call_args.args[1]).query)
        self.assertEqual(params['$top'], ['3'])
        self.assertIn("contains(ItemCode, 'ab''&x')", params['$filter'][0])
        self.assertIn('ItemsGroupCode eq 7', params['$filter'][0])
        self.assertEqual(rows[0]['uom_code'], 'KG')
        self.sap._request.assert_called_once()

    def test_pagination_stops_at_limit(self):
        self.sap._request.side_effect = [
            {'value': [{'id': 1}, {'id': 2}], '@odata.nextLink': 'Items?$skip=2'},
            {'value': [{'id': 3}, {'id': 4}], '@odata.nextLink': 'Items?$skip=4'},
        ]
        rows = query_rows(self.sap, 'Items', 'ItemCode', ["ItemCode ne ''"], 'ItemCode', 3)
        self.assertEqual(len(rows), 3)
        self.assertEqual(self.sap._request.call_count, 2)

    def test_exact_saved_item_and_scale_prefix(self):
        self.sap._request.return_value = {'value': [{'ItemCode': '2701', 'ItemName': 'Orange', 'ItemsGroupCode': 9}]}
        rows = search_master_data(self.request(item_code='2701', limit=1), self.sap, 'scale-items')
        params = parse_qs(urlsplit(self.sap._request.call_args.args[1]).query)
        self.assertIn("startswith(ItemCode, '27')", params['$filter'][0])
        self.assertIn("ItemCode eq '2701'", params['$filter'][0])
        self.assertEqual(rows[0]['item_group_code'], '9')

    def test_bin_lookup_preserves_parent_entry_and_status(self):
        self.sap._request.return_value = {'value': [{'BinCode': '20201-RA', 'Warehouse': '20201', 'AbsEntry': 142,
                                                     'Inactive': 'tNO', 'IsSystemBin': 'tNO'}]}
        rows = search_master_data(self.request(search='RA'), self.sap, 'bins', warehouse='20201')
        self.assertEqual(rows[0]['absEntry'], 142)
        self.assertEqual(rows[0]['warehouse'], '20201')
        self.assertFalse(rows[0]['inactive'])
        self.assertFalse(rows[0]['is_system_bin'])
        params = parse_qs(urlsplit(self.sap._request.call_args.args[1]).query)
        self.assertIn("Warehouse eq '20201'", params['$filter'][0])

    def test_bin_probe_returns_at_most_one_without_selecting_it(self):
        self.sap._request.return_value = {'value': [{'BinCode': 'A', 'Warehouse': 'WH', 'AbsEntry': 1}, {'BinCode': 'B'}]}
        rows = search_master_data(self.request(probe=1), self.sap, 'bins', warehouse='WH')
        self.assertEqual(len(rows), 1)
        self.assertEqual(parse_qs(urlsplit(self.sap._request.call_args.args[1]).query)['$top'], ['1'])

    def test_farm_group_scope_and_complete_selection_metadata(self):
        self.sap._request.side_effect = [
            {'value': [{'Code': 100, 'Name': 'موردين خام'}]},
            {'value': [{'CardCode': 'V1', 'CardName': 'Farm', 'Currency': 'USD', 'GroupCode': 100}]},
        ]
        rows = search_master_data(self.request(search='Fa'), self.sap, 'farms')
        self.assertEqual(rows[0]['currency'], 'USD')
        self.assertEqual(rows[0]['GroupName'], 'موردين خام')
        params = parse_qs(urlsplit(self.sap._request.call_args.args[1]).query)
        self.assertIn('GroupCode eq 100', params['$filter'][0])
        self.assertIn("CardType eq 'cSupplier'", params['$filter'][0])
        self.assertTrue(all(call.args[0] == 'GET' for call in self.sap._request.call_args_list))

    def test_invalid_group_and_empty_access_do_not_scan_catalog(self):
        with self.assertRaises(ValueError):
            search_master_data(self.request(search='ab', item_group_code="1 or 1"), self.sap, 'items')
        self.assertEqual(search_master_data(self.request(search='ab'), self.sap, 'warehouses', allowed_codes=[]), [])
        self.sap._request.assert_not_called()


class MasterDataLookupApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_superuser('lookup-admin', 'lookup@example.com', 'test')
        self.client = APIClient()
        self.client.force_login(self.user)
        self.client.force_authenticate(self.user)

    def test_warehouse_lookup_uses_real_api_contract_and_no_post(self):
        with patch('api.views.sap') as sap:
            sap._request.return_value = {'value': [{'WarehouseCode': '20201', 'WarehouseName': 'Cold', 'Inactive': 'tNO'}]}
            with patch('api.services.master_data_search.cache_get', return_value=None), patch('api.services.master_data_search.cache_set'):
                response = self.client.get('/api/warehouses/', {'lookup': 1, 'search': '202', 'limit': 1})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data['data']['warehouses'][0]['code'], '20201')
            sap.get_warehouses.assert_not_called()
            sap.create_stock_transfer.assert_not_called()

    def test_sap_failure_is_real_error_not_empty_success(self):
        with patch('api.views.sap') as sap, patch('api.services.master_data_search.cache_get', return_value=None):
            sap._request.return_value = {'error': {'message': 'Unavailable'}}
            response = self.client.get('/api/warehouses/', {'lookup': 1, 'search': 'zz'})
        self.assertEqual(response.status_code, 503)
        self.assertFalse(response.data['success'])

    def test_policy_options_permission_is_unchanged(self):
        ordinary = User.objects.create_user('lookup-ordinary', password='test')
        self.client.force_authenticate(ordinary)
        with patch('api.views.sap') as sap:
            response = self.client.get('/api/warehouses/', {'lookup': 1, 'policy_options': 'true', 'search': '202'})
            self.assertEqual(response.status_code, 403)
            sap._request.assert_not_called()

    def test_customer_lookup_filters_at_sap_and_returns_selection_details(self):
        with patch('api.customization_views.SAPServiceLayer') as factory, \
                patch('api.customization_views.cache_get_or_set', side_effect=lambda namespace, key, loader, ttl: loader()), \
                patch('api.customization_views._get_octg_terms_map', return_value={1: 'Cash'}), \
                patch('api.customization_views._get_payment_terms_details', return_value={1: {'NumberOfAdditionalDays': 3}}):
            sap = factory.return_value
            sap._request.return_value = {'value': [{'CardCode': 'C01', 'CardName': 'Buyer', 'Currency': 'USD',
                                                   'PriceListNum': 2, 'PayTermsGrpCode': 1, 'BPAddresses': []}]}
            response = self.client.get('/api/customization-delivery/customers/', {'lookup': 1, 'search': 'Buy', 'limit': 1})
        self.assertEqual(response.status_code, 200)
        parameters = parse_qs(urlsplit(sap._request.call_args.args[1]).query)
        self.assertIn("contains(CardName, 'Buy')", parameters['$filter'][0])
        self.assertEqual(parameters['$top'], ['1'])
        row = response.data['customers'][0]
        self.assertEqual(row['price_list_num'], 2)
        self.assertEqual(row['payment_terms_additional_days'], 3)
        self.assertIn('addresses', row)
        sap._request.assert_called_once()

    def test_lowercase_customer_code_finds_uppercase_sap_code(self):
        with patch('api.customization_views.SAPServiceLayer') as factory, \
                patch('api.customization_views.cache_get_or_set', side_effect=lambda namespace, key, loader, ttl: loader()), \
                patch('api.customization_views._get_octg_terms_map', return_value={}), \
                patch('api.customization_views._get_payment_terms_details', return_value={}):
            sap = factory.return_value

            def query_sap(method, endpoint, **kwargs):
                parameters = parse_qs(urlsplit(endpoint).query)
                condition = parameters['$filter'][0]
                # Reproduce SAP's case-sensitive substring matching.
                rows = [{'CardCode': 'CXACA003', 'CardName': 'Buyer', 'BPAddresses': []}] if "contains(CardCode, 'CX')" in condition else []
                self.assertIn("contains(CardName, 'cx')", condition)
                self.assertIn("Valid eq 'tYES'", condition)
                self.assertIn("Frozen eq 'tNO'", condition)
                self.assertEqual(parameters['$top'], ['25'])
                return {'value': rows}

            sap._request.side_effect = query_sap
            response = self.client.get('/api/customization-delivery/customers/', {'lookup': 1, 'search': 'cx', 'limit': 25})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['customers'][0]['card_code'], 'CXACA003')
        sap._request.assert_called_once()

    def test_user_search_is_bounded_and_permission_guard_remains(self):
        for i in range(4):
            User.objects.create_user(f'lookup-person-{i}')
        response = self.client.get('/api/admin/users/', {'lookup': 1, 'search': 'lookup-person', 'limit': 2})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['data']['users']), 2)
        self.client.force_authenticate(None)
        self.client.logout()
        self.assertIn(self.client.get('/api/admin/users/', {'lookup': 1, 'search': 'lookup'}).status_code, (401, 403))

    def test_initial_user_pages_apply_module_filter_before_offset(self):
        from api.models import UserModulePermission
        from api.role_permissions import MODULE_TRANSFER, LEVEL_USER, LEVEL_ADMIN
        for name, level in [('browse-a', LEVEL_ADMIN), ('browse-b', LEVEL_USER), ('browse-c', LEVEL_ADMIN), ('browse-d', LEVEL_USER)]:
            user = User.objects.create_user(name)
            user.userprofile.module_permissions_initialized = True
            user.userprofile.save(update_fields=['module_permissions_initialized'])
            UserModulePermission.objects.create(user=user, module=MODULE_TRANSFER, level=level)
        params = {'lookup': 1, 'initial': 1, 'browse': 1, 'module': 'transfer', 'level': 'USER', 'limit': 1}
        first = self.client.get('/api/admin/users/', params)
        second = self.client.get('/api/admin/users/', {**params, 'offset': 1})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.data['data']['users'][0]['username'], 'browse-b')
        self.assertEqual(first.data['data']['next_offset'], 1)
        self.assertEqual(second.data['data']['users'][0]['username'], 'browse-d')

    def test_customer_second_page_is_not_sliced_twice(self):
        with patch('api.customization_views.SAPServiceLayer') as factory, \
                patch('api.customization_views.cache_get_or_set', side_effect=lambda namespace, key, loader, ttl: loader()), \
                patch('api.customization_views._get_octg_terms_map', return_value={}), \
                patch('api.customization_views._get_payment_terms_details', return_value={}):
            sap = factory.return_value
            sap._request.return_value = {'value': [{'CardCode': 'C26', 'CardName': 'Buyer', 'Currency': 'USD', 'BPAddresses': []}]}
            response = self.client.get('/api/customization-delivery/customers/', {'lookup': 1, 'search': 'Buy', 'limit': 1, 'offset': 25})
        self.assertEqual(response.status_code, 200)
        params = parse_qs(urlsplit(sap._request.call_args.args[1]).query)
        self.assertEqual(params['$skip'], ['25'])
        self.assertEqual(params['$top'], ['1'])
        self.assertEqual(response.data['customers'][0]['card_code'], 'C26')
        self.assertEqual(response.data['next_offset'], 26)

    def test_item_second_page_preserves_price_list_and_uom(self):
        with patch('api.customization_views.SAPServiceLayer') as factory:
            sap = factory.return_value
            sap._request.return_value = {'value': [{'ItemCode': 'I26', 'ItemName': 'Fruit', 'SalesUnit': 'KG',
                'DefaultSalesUoMEntry': 7, 'ItemPrices': [{'PriceList': 2, 'Price': 12.5, 'Currency': 'USD'}]}]}
            response = self.client.get('/api/customization-delivery/items/', {'lookup': 1, 'search': 'Fruit', 'limit': 1, 'offset': 25, 'price_list': 2})
        self.assertEqual(response.status_code, 200)
        params = parse_qs(urlsplit(sap._request.call_args.args[1]).query)
        self.assertEqual(params['$skip'], ['25'])
        self.assertIn("SalesItem eq 'tYES'", params['$filter'][0])
        self.assertEqual(response.data['items'][0]['default_price'], 12.5)
        self.assertEqual(response.data['items'][0]['uom_entry'], 7)
        self.assertEqual(response.data['next_offset'], 26)

    def test_batch_second_page_keeps_inventory_and_warehouse_scope(self):
        with patch('api.services.sap_service.SAPServiceLayer') as factory:
            factory.return_value.execute_sql_query.return_value = {'value': [
                {'BatchNumber': f'PAL-{i:02}', 'WhsCode': 'WH', 'OnHandQty': 10, 'BinAbsEntry': i} for i in range(1, 5)
            ] + [{'BatchNumber': 'PAL-OTHER', 'WhsCode': 'OTHER', 'OnHandQty': 10}]}
            response = self.client.get('/api/customization-delivery/batches/', {'lookup': 1, 'search': 'PAL', 'item_code': 'ITEM', 'warehouse_code': 'WH', 'limit': 2, 'offset': 2})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['batch_number'] for row in response.data['batches']], ['PAL-03', 'PAL-04'])
        self.assertIsNone(response.data['next_offset'])

    def test_batch_lookup_uses_batch_search_and_preserves_available_inventory(self):
        with patch('api.services.sap_service.SAPServiceLayer') as factory:
            factory.return_value.execute_sql_query.return_value = {'value': [
                {'BatchNumber': 'PAL-01', 'WhsCode': 'WH', 'OnHandQty': 10, 'BinAbsEntry': 12},
                {'BatchNumber': 'PAL-02', 'WhsCode': 'WH', 'OnHandQty': 0},
                {'BatchNumber': 'OTHER', 'WhsCode': 'WH', 'OnHandQty': 20},
                {'BatchNumber': 'PAL-03', 'WhsCode': 'OTHER', 'OnHandQty': 20},
            ]}
            response = self.client.get('/api/customization-delivery/batches/', {'lookup': 1, 'search': 'PAL', 'item_code': 'ITEM', 'warehouse_code': 'WH'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['batch_number'] for row in response.data['batches']], ['PAL-01'])
        self.assertEqual(response.data['batches'][0]['bin_abs_entry'], 12)

    def test_batch_lookup_does_not_hide_sap_inventory_failure(self):
        with patch('api.services.sap_service.SAPServiceLayer') as factory:
            factory.return_value.execute_sql_query.return_value = {'error': {'message': 'Unavailable'}}
            response = self.client.get('/api/customization-delivery/batches/', {'lookup': 1, 'search': 'PAL', 'item_code': 'ITEM'})
        self.assertEqual(response.status_code, 503)
        self.assertFalse(response.data['success'])

    def test_legacy_scale_farm_lookup_still_uses_original_service_seam(self):
        with patch('scale.views.SAPServiceLayer') as factory, patch('scale.views.cache_get', return_value=None), \
                patch('scale.views.cache_set'), patch('scale.views._fetch_business_partners_by_group_names', return_value=[]):
            response = self.client.get('/api/scale/master-data/farms/')
        self.assertEqual(response.status_code, 200)
        factory.assert_called_once()
