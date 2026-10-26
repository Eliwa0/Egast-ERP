import React from 'react';

export function VehicleStep({ children }) {
  return <>{children}</>;
}

export function FarmStep(props) {
  return <StepSection {...props} />;
}

function StepSection({ children, ...props }) {
  return <section {...props}>{children}</section>;
}

export function OperationStep(props) {
  return <StepSection {...props} />;
}

export function InspectionStep(props) {
  return <StepSection {...props} />;
}

export function SamplesStep(props) {
  return <StepSection {...props} />;
}

export function ReviewStep({ children, ...props }) {
  return <div {...props}>{children}</div>;
}

export function CompleteStep(props) {
  return <StepSection {...props} />;
}
