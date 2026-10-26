import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../../contexts/I18nContext';
import { useAuth } from '../../../contexts/AuthContext';
import { canManageScale } from '../../../utils/roles';
import PageHeader from '../../../components/ui/PageHeader';

export function ScaleLandingPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { user } = useAuth();

  const cards = [
    {
      path: '/scale/weighing',
      icon: '⚖️',
      title: t('scale.weighingTitle'),
      description: t('scale.weighingSubtitle'),
      buttonLabel: t('scale.openWeighing'),
      iconClass: 'nav-card__icon--production',
      visible: true,
    },
    {
      path: '/scale/receipt',
      icon: '🧾',
      title: t('scale.receiptTitle'),
      description: t('scale.receiptSubtitle'),
      buttonLabel: t('scale.openReceipt'),
      iconClass: 'nav-card__icon--production',
      visible: true,
    },
    {
      path: '/scale/devices',
      icon: '🖥️',
      title: t('scale.devicesTitle'),
      description: t('scale.devicesSubtitle'),
      buttonLabel: t('scale.openDevices'),
      iconClass: 'nav-card__icon--quality',
      visible: canManageScale(user),
    },
    {
      path: '/scale/item-elements',
      icon: '📦',
      title: t('scale.itemElementsTitle'),
      description: t('scale.itemElementsSubtitle'),
      buttonLabel: t('scale.openItemElements'),
      iconClass: 'nav-card__icon--transfer',
      visible: canManageScale(user),
    },
    {
      path: '/scale/entry-exit-permits',
      icon: '🚦',
      title: t('scale.entryExitPermitsTitle'),
      description: t('scale.entryExitPermitsSubtitle'),
      buttonLabel: t('scale.openEntryExitPermits'),
      iconClass: 'nav-card__icon--quality',
      visible: true,
    },
  ].filter((c) => c.visible);

  return (
    <div className="home-page scale-landing-page">
      <PageHeader
        eyebrow={t('scale.title')}
        title={t('scale.title')}
        description={t('scale.subtitle')}
      />

      <div className="home-card-grid module-grid">
        {cards.map((card) => (
          <section
            key={card.path}
            className="card-panel card-panel--compact click-card module-card"
            onClick={() => navigate(card.path)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                navigate(card.path);
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={card.title}
          >
            <div className="nav-card">
              <div className={`nav-card__icon module-card__icon ${card.iconClass}`}>
                {card.icon}
              </div>
              <div className="nav-card__body">
                <div className="nav-card__title">{card.title}</div>
                <p className="nav-card__desc">{card.description}</p>
              </div>
              <button
                type="button"
                className="app-button app-button--primary app-button--block app-button--cta"
                onClick={(event) => {
                  event.stopPropagation();
                  navigate(card.path);
                }}
              >
                {card.buttonLabel}
              </button>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default ScaleLandingPage;
