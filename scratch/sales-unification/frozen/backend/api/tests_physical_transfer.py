from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch
from django.contrib.auth.models import User
from django.db import close_old_connections, connection
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient
from api.models import PendingTransferRequest, TransferPalletCustody, ShippingContainer, PhysicalTransferEvent, AuditLog, UserProfile, TransferPolicyRevision
from api.services.physical_transfer_service import arrive, load, PhysicalTransferConflict


class PhysicalTransferFixture:
    def setup_fixture(self):
        self.actor = User.objects.create_user(username='physical-worker', password='test')
        UserProfile.objects.filter(user=self.actor).update(role='transfer', module_permissions_initialized=True)
        # Reuse the existing Intermediate departure grant; no new permission type.
        from api.models import UserModulePermission, TransferWarehouseRule
        UserModulePermission.objects.create(user=self.actor, module=UserModulePermission.MODULE_TRANSFER, level='USER')
        TransferWarehouseRule.objects.create(user=self.actor, warehouse_code='90214', direction='FROM', stage='STAGE_2_TO_FRIDGE', is_active=True)
        for source in ('90214', 'SHIPPING_HALL'):
            TransferWarehouseRule.objects.create(user=self.actor, warehouse_code=source, direction='FROM', stage='STAGE_5_TO_CONTAINER', is_active=True)
        self.source = PendingTransferRequest.objects.create(transfer_stage='STAGE_3_FROM_FRIDGE', status='POSTED',
            from_warehouse='20201', to_warehouse='90214', batch_number='PALLET-ONE', quantity=100,
            lines=[{'batch_number':'PALLET-ONE','item_code':'ITEM','quantity':100}], posted_at=timezone.now(),
            sap_doc_entry='123', sap_doc_num='456', created_by=self.actor)
        from api.services.persisted_transfer_policy_service import company_scope
        TransferPolicyRevision.objects.create(company_scope=company_scope(), stage_key='STAGE_3_FROM_FRIDGE', revision=1, state='ACTIVE',
            configuration={'enabled':True, 'route_pairs':[{'from_warehouse':'20201','to_warehouse':'90214'}]})
        sap = patch('requests.sessions.Session.request', side_effect=AssertionError('SAP HTTP is forbidden for physical operations'))
        sap.start(); self.addCleanup(sap.stop)


class PhysicalTransferTests(PhysicalTransferFixture, TestCase):
    def setUp(self):
        self.setup_fixture()
        self.client = APIClient(); self.client.force_login(self.actor)

    def test_arrival_and_load_are_atomic_audited_local_operations(self):
        before = PendingTransferRequest.objects.values().get(pk=self.source.pk)
        arrival = self.client.post('/api/transfer/physical/arrival/', {'batch_number':'PALLET-ONE'})
        self.assertEqual(arrival.status_code,200,arrival.data)
        self.assertEqual(arrival.data['data']['pallet']['state'],'IN_SHIPPING_HALL')
        self.assertFalse(arrival.data['sap_posting'])
        loaded = self.client.post('/api/transfer/physical/load/', {'batch_number':'PALLET-ONE','source_warehouse':'SHIPPING_HALL','container_number':'CONT-A'})
        self.assertEqual(loaded.status_code,200,loaded.data)
        self.assertEqual(loaded.data['data']['pallet']['state'],'LOADED_TO_CONTAINER')
        self.assertEqual(PhysicalTransferEvent.objects.count(),2)
        self.assertEqual(AuditLog.objects.filter(entity_type='TransferPalletCustody').count(),2)
        self.assertEqual(PendingTransferRequest.objects.values().get(pk=self.source.pk),before)

    def test_duplicate_arrival_returns_409(self):
        arrive('PALLET-ONE',self.actor)
        response=self.client.post('/api/transfer/physical/arrival/',{'batch_number':'PALLET-ONE'})
        self.assertEqual(response.status_code,409)
        self.assertEqual(PhysicalTransferEvent.objects.count(),1)

    def test_duplicate_loading_and_second_container_return_409(self):
        arrive('PALLET-ONE',self.actor); load('PALLET-ONE','CONT-A',self.actor,source_warehouse='SHIPPING_HALL')
        for target in ['CONT-A','CONT-B']:
            response=self.client.post('/api/transfer/physical/load/',{'batch_number':'PALLET-ONE','source_warehouse':'SHIPPING_HALL','container_number':target})
            self.assertEqual(response.status_code,409)
        self.assertEqual(ShippingContainer.objects.count(),1)

    def test_no_hall_no_load_and_unknown_batch_rejected(self):
        response=self.client.post('/api/transfer/physical/load/',{'batch_number':'PALLET-ONE','source_warehouse':'SHIPPING_HALL','container_number':'CONT-A'})
        self.assertEqual(response.status_code,409)
        self.assertEqual(self.client.post('/api/transfer/physical/arrival/',{'batch_number':'UNKNOWN'}).status_code,400)
        self.assertFalse(TransferPalletCustody.objects.exists())

    def test_invalid_container_does_not_change_state(self):
        arrive('PALLET-ONE',self.actor)
        for value in ['', 'x'*101, 'BAD\nCONTAINER', None]:
            response=self.client.post('/api/transfer/physical/load/',{'batch_number':'PALLET-ONE','source_warehouse':'SHIPPING_HALL','container_number':value},format='json')
            self.assertEqual(response.status_code,400)
        self.assertEqual(TransferPalletCustody.objects.get().state,'IN_SHIPPING_HALL')
        self.assertFalse(ShippingContainer.objects.exists())

    def test_wrong_latest_stage_or_destination_rejected(self):
        for stage,destination,expected in [('STAGE_2_TO_FRIDGE','20201',409),('STAGE_3_FROM_FRIDGE','20205',403)]:
            self.source.transfer_stage=stage;self.source.to_warehouse=destination;self.source.save()
            self.assertEqual(self.client.post('/api/transfer/physical/arrival/',{'batch_number':'PALLET-ONE'}).status_code,expected)

    def test_transaction_failure_preserves_previous_state_and_history(self):
        with patch('api.services.physical_transfer_service.record_event', side_effect=RuntimeError('storage failed')):
            self.assertEqual(self.client.post('/api/transfer/physical/arrival/',{'batch_number':'PALLET-ONE'}).status_code,503)
        self.assertFalse(TransferPalletCustody.objects.exists())
        arrive('PALLET-ONE',self.actor)
        with patch('api.services.physical_transfer_service.log_action',return_value=None):
            self.assertEqual(self.client.post('/api/transfer/physical/load/',{'batch_number':'PALLET-ONE','source_warehouse':'SHIPPING_HALL','container_number':'CONT-A'}).status_code,503)
        self.assertEqual(TransferPalletCustody.objects.get().state,'IN_SHIPPING_HALL')
        self.assertEqual(PhysicalTransferEvent.objects.count(),1)
        self.assertFalse(ShippingContainer.objects.exists())

    def test_permissions_and_admin_review_unchanged(self):
        unauthorized=User.objects.create_user(username='no-transfer',password='test')
        self.client.force_login(unauthorized)
        self.assertEqual(self.client.post('/api/transfer/physical/arrival/',{'batch_number':'PALLET-ONE'}).status_code,403)
        self.client.force_login(self.actor)
        self.assertEqual(self.client.get('/api/transfer/physical/events/').status_code,403)
        admin=User.objects.create_user(username='admin',is_superuser=True)
        self.client.force_login(admin)
        arrive('PALLET-ONE',self.actor)
        self.assertEqual(self.client.get('/api/transfer/physical/events/').data['data']['events'][0]['stage'],4)

    def test_physical_stages_cannot_be_posted_as_sap_transfers(self):
        from api.services.transfer_service import TransferInventoryService, TransferValidationError
        service = TransferInventoryService(use_mock=False)
        for stage in ['STAGE_4_TO_SHIPPING_HALL', 'STAGE_5_TO_CONTAINER']:
            with self.assertRaisesRegex(TransferValidationError, 'Invalid transfer_stage'):
                service._validate_move_payload({'transfer_stage':stage,'from_warehouse':'90214','to_warehouse':'SHIPPING_HALL'})

    def test_nullable_legacy_metadata_and_later_stage2_move(self):
        self.source.raw_payload_json={'_transfer_policy':None};self.source.save()
        self.assertEqual(self.client.get('/api/transfer/physical/batches/PALLET-ONE/').status_code,200)
        PendingTransferRequest.objects.create(transfer_stage='STAGE_2_TO_FRIDGE',status='POSTED',from_warehouse='90214',
            to_warehouse='20201',batch_number='PALLET-ONE',posted_at=timezone.now(),sap_doc_entry='999')
        self.assertEqual(self.client.post('/api/transfer/physical/arrival/',{'batch_number':'PALLET-ONE'}).status_code,409)

    def test_worker_without_intermediate_departure_grant_is_denied(self):
        from api.models import TransferWarehouseRule
        TransferWarehouseRule.objects.filter(user=self.actor).update(is_active=False)
        self.assertEqual(self.client.post('/api/transfer/physical/arrival/',{'batch_number':'PALLET-ONE'}).status_code,403)
        self.assertFalse(TransferPalletCustody.objects.exists())

    def test_stage5_direct_warehouse_to_container_loading(self):
        # Stage 4 transferred batch to user-selected destination warehouse 20205
        from api.models import TransferWarehouseRule
        TransferWarehouseRule.objects.create(user=self.actor, warehouse_code='20205', direction='FROM', stage='STAGE_5_TO_CONTAINER', is_active=True)
        self.source.to_warehouse = '20205'
        self.source.transfer_stage = 'STAGE_4_TO_DESTINATION'
        self.source.save()

        # Stage 5 directly loads from warehouse 20205 to container CONT-STAGE5
        response = self.client.post('/api/transfer/physical/load/', {
            'batch_number': 'PALLET-ONE',
            'container_number': 'CONT-STAGE5',
            'source_warehouse': '20205',
        })
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['data']['pallet']['state'], 'LOADED_TO_CONTAINER')
        self.assertFalse(response.data['sap_posting'])
        pallet = TransferPalletCustody.objects.get(batch_number='PALLET-ONE')
        self.assertEqual(pallet.state, 'LOADED_TO_CONTAINER')
        self.assertEqual(pallet.container.container_number, 'CONT-STAGE5')
        self.assertEqual(pallet.physical_location, 'CONTAINER:CONT-STAGE5')

        # Event contains source location 20205 and stage 5
        event = PhysicalTransferEvent.objects.get(pallet=pallet, stage=5)
        self.assertEqual(event.source_location, '20205')
        self.assertEqual(event.destination_location, 'CONTAINER:CONT-STAGE5')

        # Duplicate loading is rejected with 409
        dup_response = self.client.post('/api/transfer/physical/load/', {
            'batch_number': 'PALLET-ONE',
            'container_number': 'CONT-STAGE5',
            'source_warehouse': '20205',
        })
        self.assertEqual(dup_response.status_code, 409)



class PhysicalTransferConcurrencyTests(PhysicalTransferFixture, TransactionTestCase):
    def setUp(self):
        if connection.vendor!='postgresql': self.skipTest('Requires PostgreSQL row locking; run on isolated PostgreSQL test database.')
        self.setup_fixture()

    def concurrent_requests(self,path,payloads):
        barrier=Barrier(2)
        def run(payload):
            close_old_connections()
            try:
                client=APIClient();client.force_login(User.objects.get(pk=self.actor.pk));barrier.wait(timeout=10)
                return client.post(path,payload).status_code
            finally: close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as pool:
            return sorted(pool.map(run,payloads))

    def test_concurrent_arrival(self):
        self.assertEqual(self.concurrent_requests('/api/transfer/physical/arrival/',[{'batch_number':'PALLET-ONE'}]*2),[200,409])
        self.assertEqual(PhysicalTransferEvent.objects.count(),1)

    def test_concurrent_two_container_loading(self):
        arrive('PALLET-ONE',self.actor)
        self.assertEqual(self.concurrent_requests('/api/transfer/physical/load/',[
            {'batch_number':'PALLET-ONE','source_warehouse':'SHIPPING_HALL','container_number':'CONT-A'}, {'batch_number':'PALLET-ONE','source_warehouse':'SHIPPING_HALL','container_number':'CONT-B'}]),[200,409])
        self.assertEqual(PhysicalTransferEvent.objects.filter(stage=5).count(),1)
        self.assertEqual(ShippingContainer.objects.count(),1)
