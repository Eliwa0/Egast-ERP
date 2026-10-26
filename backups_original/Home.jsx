import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import { canAccessProduction, canAccessTransfer } from '../utils/roles';
import PageHeader from '../components/ui/PageHeader';

function Home() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { user } = useAuth();

  const cards = [
    {
      path: '/production',
      icon: '🏭',
      title: t('home.production'),
      description: t('home.productionDesc'),
      visible: canAccessProduction(user),
      iconClass: 'nav-card__icon--production',
    },
    {
      path: '/transfer',
      icon: '🔁',
      title: t('home.transfer'),
      description: t('home.transferDesc'),
      visible: canAccessTransfer(user),
      iconClass: 'nav-card__icon--transfer',
    },
  ].filter((card) => card.visible);

  const openCard = (path) => navigate(path);

  return (
    <div className="home-page">
      <PageHeader
        eyebrow={t('nav.sapWorkflow')}
        title={t('nav.home')}
        description={t('home.description')}
      />

      <div className="home-card-grid module-grid">
        {cards.map((card) => (
          <section
            key={card.path}
            className="card-panel card-panel--compact click-card module-card"
            onClick={() => openCard(card.path)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openCard(card.path);
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={card.title}
          >
            <div className="nav-card">
              <div className={`nav-card__icon module-card__icon ${card.iconClass}`}>{card.icon}</div>
              <div className="nav-card__body">
                <div className="nav-card__title">{card.title}</div>
                <p className="nav-card__desc">{card.description}</p>
              </div>
              <button
                type="button"
                className="app-button app-button--primary app-button--block app-button--cta"
                onClick={(event) => {
                  event.stopPropagation();
                  openCard(card.path);
                }}
              >
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
