import React, { useCallback } from 'react';
import { useI18n } from '../contexts/I18nContext';
import {
  fetchCustomizationDocuments,
} from '../services/customizationDeliveryService';
import SalesDocumentListPage from './SalesDocumentListPage';

// SAP Sales Quotations (OQUT / QUT1) - read only.
export default function CustomizationPage() {
  const { t } = useI18n();

  const fetcher = useCallback((params) => fetchCustomizationDocuments(params), []);

  const statusOptions = [
    { code: 'O', label: t('customizationDelivery.status.open') },
    { code: 'C', label: t('customizationDelivery.status.closed') },
    { code: 'P', label: t('customizationDelivery.status.paid') },
    { code: 'D', label: t('customizationDelivery.status.delivered') },
  ];

  return (
    <SalesDocumentListPage
      title={t('customizationDelivery.customizationTitle')}
      description={t('customizationDelivery.customizationListSubtitle')}
      emptyTitle={t('customizationDelivery.noDocuments')}
      emptyMessage={t('customizationDelivery.noQuotations')}
      dateColumnLabel={t('customizationDelivery.columns.quotationDate')}
      primaryDateKey="quotation_date"
      secondaryDateKey="valid_until"
      secondaryDateLabel={t('customizationDelivery.columns.validUntil')}
      fetcher={fetcher}
      detailPath={(entry) => `/customization-delivery/customization/documents/${entry}`}
      statusOptions={statusOptions}
      actionLabel={t('customizationDelivery.workflow.customize')}
    />
  );
}
