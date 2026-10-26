import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PackageCheck, PackageMinus } from 'lucide-react';
import { useI18n } from '../contexts/I18nContext';
import PageHeader from '../components/ui/PageHeader';

function Production() {
  const navigate = useNavigate();
  const { t } = useI18n();

  const openReceipt = () => navigate('/receipt');
  const openIssue = () => navigate('/issue');

  return (
    <div className="production-page">
      <PageHeader
        title={t('production.moduleTitle')}
      />

      <div className="production-actions-grid">
        {/* Receipt from Production */}
        <section
          className="card-panel card-panel--compact click-card production-action-card"
          onClick={openReceipt}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openReceipt();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label={t('production.start')}
        >
          <div className="nav-card">
            <div className="nav-card__icon nav-card__icon--success production-action-card__icon" aria-hidden="true">
              <PackageCheck size={38} strokeWidth={1.8} />
            </div>
            <div className="nav-card__body">
              <div className="nav-card__title">{t('production.title')}</div>
              <p className="nav-card__desc">{t('production.desc')}</p>
            </div>
            <button
              type="button"
              className="app-button app-button--success app-button--block app-button--cta"
              onClick={(event) => {
                event.stopPropagation();
                openReceipt();
              }}
            >
              {t('production.start')}
            </button>
          </div>
        </section>

        {/* Issue for Production */}
        <section
          className="card-panel card-panel--compact click-card production-action-card"
          onClick={openIssue}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openIssue();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label={t('production.issueStart')}
        >
          <div className="nav-card">
            <div className="nav-card__icon nav-card__icon--primary production-action-card__icon" aria-hidden="true">
              <PackageMinus size={38} strokeWidth={1.8} />
            </div>
            <div className="nav-card__body">
              <div className="nav-card__title">{t('production.issueTitle')}</div>
              <p className="nav-card__desc">{t('production.issueDesc')}</p>
            </div>
            <button
              type="button"
              className="app-button app-button--primary app-button--block app-button--cta"
              onClick={(event) => {
                event.stopPropagation();
                openIssue();
              }}
            >
              {t('production.issueStart')}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Production;
