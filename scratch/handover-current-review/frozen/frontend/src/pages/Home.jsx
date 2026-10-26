import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import {
  canAccessProduction,
  canAccessTransfer,
  canAccessQuality,
  canAccessScale,
  canAccessGrpo,
  canAccessPurchaseQuotation,
  canAccessCustomizationOrDelivery,
} from '../utils/roles';

function Home() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const cardOrder = [
    '/shipping-receiving',
    '/scale',
    '/quality',
    '/production',
    '/transfer',
    '/shipping-loading',
    '/customization-delivery',
  ];

  const cards = [
    {
      path: '/shipping-loading',
      icon: '🚚',
      title: lang === 'ar' ? 'الشحن / الدليفري' : 'Shipping / Delivery',
      description: lang === 'ar' ? 'تحميل الحاويات وإرسال البيان للباسكول — المرحلة 5' : 'Container loading and scale handoff — Stage 5',
      visible: canAccessTransfer(user),
    },
    {
      path: '/production',
      icon: '🏭',
      title: t('home.production'),
      description: t('home.productionDesc'),
      visible: canAccessProduction(user),
    },
    {
      path: '/quality',
      icon: '🔍',
      title: t('home.quality'),
      description: t('home.qualityDesc'),
      visible: canAccessQuality(user),
    },
    {
      path: '/scale',
      icon: '⚖️',
      title: t('scale.title'),
      description: t('scale.subtitle'),
      visible: canAccessScale(user),
    },
    {
      path: '/transfer',
      icon: '🔁',
      title: t('home.transfer'),
      description: t('home.transferDesc'),
      visible: canAccessTransfer(user),
    },
    {
      path: '/shipping-receiving',
      icon: '🚚',
      title: t('home.shippingReceivingTitle'),
      description: t('home.shippingReceivingDesc'),
      visible: canAccessGrpo(user) || canAccessPurchaseQuotation(user),
    },
    {
      path: '/customization-delivery',
      icons: ['🧾', '🚢'],
      title: t('home.customizationDeliveryTitle'),
      description: t('home.customizationDeliveryDesc'),
      visible: canAccessCustomizationOrDelivery(user),
    },
  ]
    .filter((card) => card.visible)
    .sort((a, b) => cardOrder.indexOf(a.path) - cardOrder.indexOf(b.path));

  return (
    <div className="page-shell page-shell--center">
      <div className="home-card-grid">
        {cards.map((card) => (
          <section
            key={card.path}
            className="card-panel card-panel--compact click-card"
            onClick={() => navigate(card.path)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') navigate(card.path);
            }}
            role="button"
            tabIndex={0}
          >
            <div className="nav-card">
              {card.icons ? (
                <div className="nav-card__icon-pair" aria-hidden="true">
                  {card.icons.map((icon, iconIndex) => (
                    <div
                      key={iconIndex}
                      className={`nav-card__icon nav-card__icon--code nav-card__icon--paired nav-card__icon--paired-${iconIndex + 1}`}
                    >
                      {icon}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="nav-card__icon nav-card__icon--code">{card.icon}</div>
              )}
              <div className="nav-card__body">
                <div className="nav-card__title">{card.title}</div>
                <p className="nav-card__desc">{card.description}</p>
              </div>
              <button type="button" className="app-button app-button--primary app-button--block app-button--cta">
                {t('home.open')}
              </button>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default Home;
