import React, { useCallback } from 'react';
import { useI18n } from '../contexts/I18nContext';
import { fetchCustomizationDocument } from '../services/customizationDeliveryService';
import CustomizationWorkflowPanel from '../components/customization/CustomizationWorkflowPanel';
import SalesDocumentDetailPage from './SalesDocumentDetailPage';

export default function CustomizationDetailPage() {
  const { t } = useI18n();

  const fetcher = useCallback((entry) => fetchCustomizationDocument(entry), []);

  return (
    <SalesDocumentDetailPage
      title={t('customizationDelivery.quotationsTitle')}
      backPath="/customization-delivery/quotations"
      fetcher={fetcher}
      dateFields={[
        { field: 'quotation_date', labelKey: 'quotationDate' },
        { field: 'valid_until', labelKey: 'validUntil' },
        { field: 'document_date', labelKey: 'documentDate' },
      ]}
      renderWorkflow={({ document, onRefresh }) => (
        <CustomizationWorkflowPanel quotation={document} onRefresh={onRefresh} />
      )}
    />
  );
}
