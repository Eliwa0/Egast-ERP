import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../contexts/I18nContext';
import PageHeader from '../components/ui/PageHeader';

function QualityLandingPage() {
  const navigate = useNavigate();
  const { t } = useI18n();

  const inspectionTypes = [
    {
      path: '/quality/receiving',
      icon: '📥',
      title: t('quality.receivingTitle'),
      description: t('quality.receivingSubtitle'),
      buttonLabel: t('quality.receivingButton'),
      iconClass: 'nav-card__icon--quality',
    },
  ];

  const openInspection = (path) => navigate(path);

  return (
    <div className="home-page quality-landing-page">
      <PageHeader
        eyebrow={t('quality.headerKicker')}
        title={t('quality.landingTitle')}
        description={t('quality.landingSubtitle')}
      />

      <div className="home-card-grid module-grid">
        {inspectionTypes.map((inspection) => (
          <section
            key={inspection.path}
            className="card-panel card-panel--compact click-card module-card"
            onClick={() => openInspection(inspection.path)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openInspection(inspection.path);
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={inspection.title}
          >
            <div className="nav-card">
              <div className={`nav-card__icon module-card__icon ${inspection.iconClass}`}>
                {inspection.icon}
              </div>
              <div className="nav-card__body">
                <div className="nav-card__title">{inspection.title}</div>
                <p className="nav-card__desc">{inspection.description}</p>
              </div>
              <button
                type="button"
                className="app-button app-button--primary app-button--block app-button--cta"
                onClick={(event) => {
                  event.stopPropagation();
                  openInspection(inspection.path);
                }}
              >
                {inspection.buttonLabel}
              </button>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default QualityLandingPage;
