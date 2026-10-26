export const isDefinitiveQuotationRejection = data =>
  data?.state === 'REJECTED' && data?.is_ambiguous === false;
