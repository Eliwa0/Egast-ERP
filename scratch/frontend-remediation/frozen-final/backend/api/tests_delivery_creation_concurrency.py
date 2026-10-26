"""Two operators must not initialize two active drafts for one SAP order."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import Mock, patch

from django.contrib.auth.models import User
from django.db import close_old_connections
from django.db.models.query import QuerySet
from django.test import TransactionTestCase, skipUnlessDBFeature

from api.models_delivery import DeliveryDraft
from api.services.delivery_posting_service import DeliveryPostingService, DeliveryStateError


class DeliveryCreationConcurrencyTests(TransactionTestCase):
    @skipUnlessDBFeature('has_select_for_update')
    def test_same_order_initialization_has_one_winner(self):
        actor = User.objects.create_superuser('delivery-race', password='fixture')
        check = Barrier(2)
        original_first = QuerySet.first

        def simultaneous_active_check(query):
            value = original_first(query)
            if query.model is DeliveryDraft:
                # Force the actual two empty reads to overlap; do not fake their results.
                check.wait(timeout=8)
            return value

        def initialize(_):
            close_old_connections()
            try:
                sap = Mock(spec=['get_sales_order'])
                sap.get_sales_order.return_value = {'DocEntry': 77, 'DocNum': 88, 'CardCode': 'FIXTURE',
                    'DocDate': '2026-10-20', 'DocumentStatus': 'bost_Open', 'DocumentLines': [
                        {'LineNum': 0, 'ItemCode': 'FIXTURE', 'Quantity': 10, 'RemainingOpenQuantity': 10,
                         'WarehouseCode': 'FIXTURE'}]}
                try:
                    return ('created', DeliveryPostingService(sap).create_draft(actor, 77).pk)
                except DeliveryStateError:
                    return ('conflict', None)
            finally:
                close_old_connections()

        with patch.object(QuerySet, 'first', simultaneous_active_check):
            with ThreadPoolExecutor(max_workers=2) as pool:
                outcomes = list(pool.map(initialize, range(2)))
        self.assertEqual(sorted(value[0] for value in outcomes), ['conflict', 'created'])
        self.assertEqual(DeliveryDraft.objects.filter(sales_order_doc_entry=77).count(), 1)
        self.assertEqual(DeliveryDraft.objects.get(sales_order_doc_entry=77).lines.count(), 1)
