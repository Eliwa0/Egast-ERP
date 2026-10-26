import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, Settings2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { canAccessProductionRules, canAccessTransferRules } from '../utils/roles';

function RulesHubPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useI18n();

  if (!canAccessProductionRules(user) && !canAccessTransferRules(user)) {
    return (
      <div className="page-shell page-shell--center">
        <div className="feedback-message feedback-message--error">{t('common.accessDenied')}</div>
      </div>
    );
  }

  const cards = [
    {
      path: '/order-rules/production',
      icon: <Settings2 size={52} strokeWidth={1.8} />,
      title: t('rulesHub.productionTitle'),
      description: t('rulesHub.productionDesc'),
      visible: canAccessProductionRules(user),
    },
    {
      path: '/order-rules/transfer',
      icon: <ArrowLeftRight size={52} strokeWidth={1.8} />,
      title: t('rulesHub.transferTitle'),
      description: t('rulesHub.transferDesc'),
      visible: canAccessTransferRules(user),
    },
  ].filter((card) => card.visible);

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
              <div className="nav-card__icon nav-card__icon--code">{card.icon}</div>
              <div className="nav-card__body">
                <div className="nav-card__title">{card.title}</div>
                <p className="nav-card__desc">{card.description}</p>
              </div>
              <button type="button" className="app-button app-button--primary app-button--block app-button--cta">
                {t('common.open')}
              </button>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default RulesHubPage;
