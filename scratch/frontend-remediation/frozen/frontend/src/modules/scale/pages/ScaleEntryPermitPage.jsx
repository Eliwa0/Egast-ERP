import React from 'react';
import { useI18n } from '../../../contexts/I18nContext';
import PageHeader from '../../../components/ui/PageHeader';
import ScaleGatePermitForm from '../components/ScaleGatePermitForm';

export function ScaleEntryPermitPage() {
  const { t } = useI18n();

  return (
    <div className="scale-permit-page">
      <PageHeader
        eyebrow={t('scale.title')}
        title={t('scale.entryPermitTitle')}
        description={t('scale.entryPermitSubtitle')}
      />
      <ScaleGatePermitForm type="entry" />
    </div>
  );
}

export default ScaleEntryPermitPage;