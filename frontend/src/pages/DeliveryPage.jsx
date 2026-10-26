import React, { useCallback } from 'react';
import { useI18n } from '../contexts/I18nContext';
import { fetchDeliveryDocuments } from '../services/customizationDeliveryService';
import SalesDocumentListPage from './SalesDocumentListPage';

// SAP Sales Orders (ORDR / RDR1) - read only.
export default function DeliveryPage() {
  const { t } = useI18n();

  const fetcher = useCallback((params) => fetchDeliveryDocuments(params), []);

  const statusOptions = [
    { code: 'O', label: t('customizationDelivery.status.open') },
    { code: 'C', label: t('customizationDelivery.status.closed') },
    { code: 'P', label: t('customizationDelivery.status.paid') },
    { code: 'D', label: t('customizationDelivery.status.delivered') },
  ];

  return (
    <SalesDocumentListPage
      title={t('customizationDelivery.deliveryTitle')}
      description={t('customizationDelivery.deliveryListSubtitle')}
      emptyTitle={t('customizationDelivery.noDocuments')}
      emptyMessage={t('customizationDelivery.noOrders')}
      dateColumnLabel={t('customizationDelivery.columns.orderDate')}
      primaryDateKey="order_date"
      secondaryDateKey="due_date"
      secondaryDateLabel={t('customizationDelivery.columns.dueDate')}
      fetcher={fetcher}
      detailPath={(entry) => `/customization-delivery/delivery/documents/${entry}`}
      statusOptions={statusOptions}
      actionLabel={t('customizationDelivery.workflow.deliver')}
    />
  );
}
