import React from 'react';
import { useI18n } from '../../context/I18nContext';

export default function WizardStepper({
  steps,
  currentStep,
  maxReachedStep = currentStep,
  doneStep,
  receiptPosted = false,
  onStepClick,
  mini = false,
}) {
  const { t } = useI18n();
  const finalStep = doneStep ?? steps.length - 1;
  const wrapClass = mini ? 'mini-wizard-wrap' : 'wizard-stepbar-wrap';
  const stepClass = mini ? 'mini-wizard-step' : 'wizard-step';
  const circleClass = mini ? 'mini-wizard-step__circle' : 'wizard-step__circle';
  const labelClass = mini ? 'mini-wizard-step__label' : 'wizard-step__label';
  const connectorClass = mini ? 'mini-wizard-connector' : 'wizard-stepbar-connector';

  return (
    <div className={`${wrapClass} enterprise-stepper${mini ? ' enterprise-stepper--mini' : ''}`} role="list" aria-label={mini ? 'Batch steps' : 'Receipt steps'}>
      {steps.map((item, index) => {
        const isComplete = receiptPosted ? index <= finalStep : index < currentStep;
        const isActive = index === currentStep;
        const canOpen = index <= maxReachedStep || (receiptPosted && index <= finalStep);
        const classes = [stepClass, isActive ? 'active' : '', isComplete ? 'complete' : '', !canOpen ? 'locked' : '']
          .filter(Boolean)
          .join(' ');

        return (
          <React.Fragment key={item.label || item.labelKey || index}>
            <button
              type="button"
              className={classes}
              onClick={() => canOpen && onStepClick?.(index)}
              disabled={!canOpen}
              aria-current={isActive ? 'step' : undefined}
              role="listitem"
            >
              <span className={circleClass}>{isComplete ? 'OK' : item.icon || index + 1}</span>
              <span className={labelClass}>{item.labelKey ? t(item.labelKey) : item.label}</span>
            </button>
            {index < steps.length - 1 && <span className={connectorClass} aria-hidden="true" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}
