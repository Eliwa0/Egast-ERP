import React from 'react';
import { useI18n } from '../contexts/I18nContext';
import './ProductionPalletCards.css';

export default function ProductionPalletCards({ types, value, onChange, disabled = false }) {
  const { lang } = useI18n(); const ar = lang === 'ar';
  const choices = [...types.map((type) => ({ value: String(type.id), name: type.name,
    detail: `${Number(type.capacity_kg).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')} ${ar ? 'كجم كحد أقصى' : 'kg maximum'}` })),
  { value: 'none', name: ar ? 'بدون بالتات' : 'No pallets', detail: ar ? 'تخطي اختيار النوع' : 'Skip pallet type' }];
  return <fieldset className="production-pallet-choices" disabled={disabled}>
    <legend>{ar ? 'نوع البالتة' : 'Pallet type'}</legend>
    <div className="production-pallet-choices__grid">{choices.map((choice) => <button type="button" key={choice.value}
      className={`production-pallet-choice${String(value) === choice.value ? ' production-pallet-choice--selected' : ''}`}
      aria-pressed={String(value) === choice.value} disabled={disabled} onClick={() => onChange(choice.value)}>
      <span aria-hidden="true">{choice.value === 'none' ? '↪' : '📦'}</span>
      <strong><bdi>{choice.name}</bdi></strong><small>{choice.detail}</small>
    </button>)}</div>
  </fieldset>;
}
