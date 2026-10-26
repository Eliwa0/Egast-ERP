import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import { canAccessCustomization, canAccessDelivery } from '../utils/roles';
import PageHeader from '../components/ui/PageHeader';
import '../styles/pages/customization-delivery-landing.css';

export default function CustomizationDeliveryPage() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const { user } = useAuth();

  const operations = [
    {
      path: '/customization-delivery/quotations',
      icon: '🧾',
      stepNumber: lang === 'ar' ? 'المرحلة ١' : 'Layer 1',
      title: t('customizationDelivery.quotationsTitle'),
      description: t('customizationDelivery.quotationsSubtitle'),
      buttonLabel: t('customizationDelivery.createQuotation'),
      visible: canAccessCustomization(user),
    },
    {
      path: '/customization-delivery/orders',
      icon: '📋',
      stepNumber: lang === 'ar' ? 'المرحلة ٢' : 'Layer 2',
      title: t('customizationDelivery.ordersTitle'),
      description: t('customizationDelivery.ordersSubtitle'),
      buttonLabel: t('customizationDelivery.openOrders'),
      visible: canAccessCustomization(user),
    },
    {
      path: '/customization-delivery/deliveries',
      icon: '🚚',
      stepNumber: lang === 'ar' ? 'المرحلة ٣' : 'Layer 3',
      title: t('customizationDelivery.deliveryTitle'),
      description: t('customizationDelivery.deliverySubtitle'),
      buttonLabel: t('customizationDelivery.openDelivery'),
      visible: canAccessDelivery(user),
    },
  ].filter((operation) => operation.visible);

  return (
    <div className="home-page customization-delivery-page">
      <PageHeader
        eyebrow={t('customizationDelivery.eyebrow')}
        title={t('customizationDelivery.title')}
        description={t('customizationDelivery.subtitle')}
      />

      <div className="three-cards-grid">
        {operations.map((operation) => (
          <section
            key={operation.path}
            className="card-panel card-panel--compact click-card module-card"
            onClick={() => navigate(operation.path)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                navigate(operation.path);
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={operation.title}
          >
            <span className="step-badge">{operation.stepNumber}</span>
            <div className="nav-card">
              <div className="nav-card__icon nav-card__icon--code module-card__icon" aria-hidden="true">
                {operation.icon}
              </div>
              <div className="nav-card__body">
                <div className="nav-card__title">{operation.title}</div>
                <p className="nav-card__desc">{operation.description}</p>
              </div>
              <button
                type="button"
                className="app-button app-button--primary app-button--block app-button--cta"
                onClick={(event) => {
                  event.stopPropagation();
                  navigate(operation.path);
                }}
              >
                {operation.buttonLabel}
              </button>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
