import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import { canAccessGrpo, canAccessPurchaseQuotation } from '../utils/roles';
import PageHeader from '../components/ui/PageHeader';

function ShippingReceivingPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { user } = useAuth();

  const operations = [
    {
      path: '/shipping-delivery',
      icon: '🚚',
      title: t('shippingReceiving.shippingDeliveryTitle'),
      description: t('shippingReceiving.shippingDeliverySubtitle'),
      buttonLabel: t('shippingReceiving.openShippingDelivery'),
      iconClass: 'nav-card__icon--production',
      visible: canAccessPurchaseQuotation(user),
    },
    {
      path: '/grpo',
      icon: '📥',
      title: t('shippingReceiving.grpoTitle'),
      description: t('shippingReceiving.grpoSubtitle'),
      buttonLabel: t('shippingReceiving.openGrpo'),
      iconClass: 'nav-card__icon--transfer',
      visible: canAccessGrpo(user),
    },
  ].filter((op) => op.visible);

  const openOperation = (path) => navigate(path);

  return (
    <div className="home-page shipping-receiving-page">
      <PageHeader
        eyebrow={t('shippingReceiving.eyebrow')}
        title={t('shippingReceiving.title')}
        description={t('shippingReceiving.subtitle')}
      />

      <div className="home-card-grid module-grid">
        {operations.map((operation) => (
          <section
            key={operation.path}
            className="card-panel card-panel--compact click-card module-card"
            onClick={() => openOperation(operation.path)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openOperation(operation.path);
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={operation.title}
          >
            <div className="nav-card">
              <div className={`nav-card__icon module-card__icon ${operation.iconClass}`}>
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
                  openOperation(operation.path);
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

export default ShippingReceivingPage;
