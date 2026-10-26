import React from 'react';
import { useI18n } from '../../../contexts/I18nContext';
import PageHeader from '../../../components/ui/PageHeader';
import ScaleGatePermitForm from '../components/ScaleGatePermitForm';

export function ScaleExitPermitPage() {
  const { t } = useI18n();

  return (
    <div className="scale-permit-page">
      <PageHeader
        eyebrow={t('scale.title')}
        title={t('scale.exitPermitTitle')}
        description={t('scale.exitPermitSubtitle')}
      />
      <ScaleGatePermitForm type="exit" />
    </div>
  );
}

export default ScaleExitPermitPage;