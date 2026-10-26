import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../../contexts/I18nContext';
import PageHeader from '../../../components/ui/PageHeader';

export function ScaleEntryExitPermitsPage() {
  const navigate = useNavigate();
  const { t } = useI18n();

  const actions = [
    {
      path: '/scale/entry-exit-permits/entry',
      icon: '🚪',
      title: t('scale.entryPermitTitle'),
      description: t('scale.entryPermitSubtitle'),
      buttonLabel: t('scale.openEntryPermit'),
      accent: 'nav-card__icon--production',
    },
    {
      path: '/scale/entry-exit-permits/exit',
      icon: '🚛',
      title: t('scale.exitPermitTitle'),
      description: t('scale.exitPermitSubtitle'),
      buttonLabel: t('scale.openExitPermit'),
      accent: 'nav-card__icon--transfer',
    },
  ];

  return (
    <div className="home-page scale-permits-selection-page">
      <PageHeader
        eyebrow={t('scale.title')}
        title={t('scale.entryExitPermitsTitle')}
        description={t('scale.entryExitPermitsSubtitle')}
      />

      <div className="pep-actions">
        {actions.map((action) => (
          <section
            key={action.path}
            className="card-panel pep-action-card"
            onClick={() => navigate(action.path)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                navigate(action.path);
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={action.title}
          >
            <div className={`pep-icon ${action.accent}`}>{action.icon}</div>
            <h2 className="pep-title">{action.title}</h2>
            <p className="pep-desc">{action.description}</p>
            <button
              type="button"
              className="app-button app-button--primary app-button--block app-button--cta"
              onClick={(event) => {
                event.stopPropagation();
                navigate(action.path);
              }}
            >
              {action.buttonLabel}
            </button>
          </section>
        ))}
      </div>

      <style>{`
        .scale-permits-selection-page { padding-bottom: 40px; }
        .pep-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 20px;
          width: min(900px, 100%);
          margin: 0 auto;
        }
        .pep-action-card {
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 26px;
          min-height: 240px;
          text-align: start;
          cursor: pointer;
          transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
        }
        .pep-action-card:hover {
          transform: translateY(-2px);
          border-color: var(--color-primary);
          box-shadow: var(--shadow-md);
        }
        .pep-icon {
          display: grid;
          place-items: center;
          width: 62px;
          height: 62px;
          border-radius: 16px;
          font-size: 30px;
          line-height: 1;
        }
        .pep-icon.nav-card__icon--production {
          background: var(--bg-success-soft);
          border-color: color-mix(in srgb, var(--success) 28%, transparent);
        }
        .pep-icon.nav-card__icon--transfer {
          background: var(--bg-primary-soft);
          border-color: color-mix(in srgb, var(--primary) 28%, transparent);
        }
        .pep-title { margin: 0; font-size: 1.35rem; color: var(--color-text); }
        .pep-desc { margin: 0; color: var(--color-text-muted); line-height: 1.55; }
        .pep-action-card .app-button--cta { margin-top: auto; }

        @media (max-width: 720px) {
          .pep-actions { grid-template-columns: 1fr; width: min(480px, 100%); }
        }
      `}</style>
    </div>
  );
}

export default ScaleEntryExitPermitsPage;