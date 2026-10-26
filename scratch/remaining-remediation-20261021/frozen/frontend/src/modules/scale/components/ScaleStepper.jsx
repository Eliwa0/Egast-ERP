import React from 'react';
import { useI18n } from '../../../contexts/I18nContext';

export function ScaleStepper({
  steps,
  currentStep = 0,
  maxReachedStep = currentStep,
  onStepClick,
}) {
  const { t } = useI18n();

  return (
    <div className="wizard-stepbar-wrap enterprise-stepper" role="list" aria-label="Weighing steps">
      {steps.map((item, index) => {
        const isComplete = index < currentStep;
        const isActive = index === currentStep;
        const canOpen = index <= maxReachedStep;
        const classes = [
          'wizard-step',
          isActive ? 'active' : '',
          isComplete ? 'complete' : '',
          !canOpen ? 'locked' : '',
        ]
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
              <span className="wizard-step__circle">{isComplete ? '✓' : index + 1}</span>
              <span className="wizard-step__label">{item.labelKey ? t(item.labelKey) : item.label}</span>
            </button>
            {index < steps.length - 1 && <span className="wizard-stepbar-connector" aria-hidden="true" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default ScaleStepper;
