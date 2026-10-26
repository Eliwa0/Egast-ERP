import React from 'react';
import QualityWizardLayout from '../components/quality/QualityWizardLayout';
import { SCALE_RECEIVING_STEPS } from '../config/qualityWorkflowSteps';
import { useAuth } from '../contexts/AuthContext';
import { useQualityWizardController } from '../hooks/useQualityWizardController';
import { useQualityWizardState } from '../hooks/useQualityWizardState';

const RECEIVING_WORKFLOW_CONFIG = {
  id: 'receiving',
  dynamicCriteria: true,
  inspectionStageCode: 'RECEIVING',
  validateMetadata({ metadata, t }) {
    const errors = {};
    if (!metadata.batch_number && !metadata.item_code) {
      errors.batch_number = t('quality.batchRequired') || 'Batch or Item is required';
    }
    if (!metadata.inspector_name) {
      errors.inspector_name = t('quality.inspectorRequired');
    }
    return errors;
  },
};

function ReceivingInspectionWizard() {
  const { user } = useAuth();
  const workflowState = useQualityWizardState(user);
  const workflowHandlers = useQualityWizardController({
    user,
    workflowConfig: RECEIVING_WORKFLOW_CONFIG,
    workflowState,
  });

  return (
    <QualityWizardLayout
      steps={SCALE_RECEIVING_STEPS}
      workflowConfig={RECEIVING_WORKFLOW_CONFIG}
      workflowState={workflowState}
      handlers={workflowHandlers}
    />
  );
}

export default ReceivingInspectionWizard;
