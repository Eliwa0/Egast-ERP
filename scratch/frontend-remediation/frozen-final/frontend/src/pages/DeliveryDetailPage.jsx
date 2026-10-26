import React, { useCallback } from 'react';
import { useI18n } from '../contexts/I18nContext';
import { fetchDeliveryDocument, fetchSalesOrderDocument } from '../services/customizationDeliveryService';
import DeliveryWorkflowPanel from '../components/delivery/DeliveryWorkflowPanel';
import SalesDocumentDetailPage from './SalesDocumentDetailPage';

export default function DeliveryDetailPage({ orderViewOnly = false }) {
  const { t, lang } = useI18n();

  const fetcher = useCallback((entry) => orderViewOnly ? fetchSalesOrderDocument(entry) : fetchDeliveryDocument(entry), [orderViewOnly]);

  return (
    <SalesDocumentDetailPage
      title={orderViewOnly ? t('customizationDelivery.salesOrderDocument') : (lang === 'ar' ? 'مركز تنفيذ أمر البيع والتسليم' : 'Sales Order Fulfillment Center')}
      backPath="/customization-delivery/orders"
      fetcher={fetcher}
      dateFields={[
        { field: 'order_date', labelKey: 'orderDate' },
        { field: 'due_date', labelKey: 'dueDate' },
        { field: 'document_date', labelKey: 'documentDate' },
      ]}
      renderWorkflow={orderViewOnly ? undefined : ({ document, onRefresh }) => (
        <DeliveryWorkflowPanel order={document} onRefresh={onRefresh} />
      )}
    />
  );
}
