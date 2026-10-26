import React, { lazy, Suspense, useEffect, useState } from 'react';
import ErrorBoundary from './components/common/ErrorBoundary';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import meemLogo from './assets/logos/meem-logo.png';
import Home from './pages/Home';
import LoginPage from './pages/LoginPage';

import { AuthProvider, useAuth } from './contexts/AuthContext';
import { I18nProvider, useI18n } from './contexts/I18nContext';
import { ToastProvider } from './components/ui/ToastProvider';
import AppTopBarProgress from './components/ui/AppTopBarProgress';
import API from './services/api';
import {
  canAccessProduction,
  canAccessProductionRules,
  canAccessReceiptReview,
  canAccessIssueReview,
  canAccessTransfer,
  canAccessTransferRules,
  canAccessTransferReview,
  canAccessQuality,
  canAccessQualityReview,
  canAccessGrpo,
  canAccessPurchaseQuotation,
  canManageQuality,
  canManageUsers,
  canAccessScale,
  canManageScale,
  canAccessCustomization,
  canAccessDelivery,
  canAccessCustomizationOrDelivery,
} from './utils/roles';

import Loading from './components/Loading';

const Production = lazy(() => import('./pages/Production'));
const ReceiptWizard = lazy(() => import('./pages/ReceiptWizard'));
const IssueWizard = lazy(() => import('./pages/IssueWizard'));
const IssueReviewPage = lazy(() => import('./pages/IssueReviewPage'));
const TransferPage = lazy(() => import('./modules/transfer/pages/TransferPage'));
const CreateUserPage = lazy(() => import('./pages/CreateUserPage'));
const UserManagementPage = lazy(() => import('./pages/UserManagementPage'));
const ActivityLogPage = lazy(() => import('./pages/ActivityLogPage'));
const ProductionOrderRulesPage = lazy(() => import('./pages/ProductionOrderRulesPage'));
const TransferRulesPage = lazy(() => import('./pages/TransferRulesPage'));
const InspectionStagesManagementPage = lazy(() => import('./pages/InspectionStagesManagementPage'));
const QualityCategoriesManagementPage = lazy(() => import('./pages/QualityCategoriesManagementPage'));
const QualityCriteriaManagementPage = lazy(() => import('./pages/QualityCriteriaManagementPage'));
const ItemCriteriaMappingPage = lazy(() => import('./pages/ItemCriteriaMappingPage'));
const ReceiptReviewPage = lazy(() => import('./pages/ReceiptReviewPage'));
const TransferReviewPage = lazy(() => import('./pages/TransferReviewPage'));
const QualityLandingPage = lazy(() => import('./pages/QualityLandingPage'));
const ReceivingInspectionWizard = lazy(() => import('./pages/ReceivingInspectionWizard'));
const QualityReviewPage = lazy(() => import('./pages/QualityReviewPage'));
const PurchaseGRPODraftPage = lazy(() => import('./pages/PurchaseGRPODraftPage'));
const GRPOPage = lazy(() => import('./pages/GRPOPage'));
const GRPOReviewPage = lazy(() => import('./pages/GRPOReviewPage'));
const PurchaseQuotationPage = lazy(() => import('./pages/PurchaseQuotationPage'));
const PurchaseQuotationDraftPage = lazy(() => import('./pages/PurchaseQuotationDraftPage'));
const PurchaseQuotationReviewPage = lazy(() => import('./pages/PurchaseQuotationReviewPage'));
const ShippingReceivingPage = lazy(() => import('./pages/ShippingReceivingPage'));
const CustomizationDeliveryPage = lazy(() => import('./pages/CustomizationDeliveryPage'));
const SalesQuotationsPage = lazy(() => import('./pages/SalesQuotationsPage'));
const SalesQuotationCreatePage = lazy(() => import('./pages/SalesQuotationCreatePage'));
const SalesQuotationsReviewPage = lazy(() => import('./pages/SalesQuotationsReviewPage'));
const SalesOrdersReviewPage = lazy(() => import('./pages/SalesOrdersReviewPage'));
const SalesOrdersPage = lazy(() => import('./pages/SalesOrdersPage'));
const DeliveriesPage = lazy(() => import('./pages/DeliveriesPage'));
const CustomizationDetailPage = lazy(() => import('./pages/CustomizationDetailPage'));
const DeliveryDetailPage = lazy(() => import('./pages/DeliveryDetailPage'));
const DeliveryCreateWizardPage = lazy(() => import('./pages/DeliveryCreateWizardPage'));
const DeliveryReviewPage = lazy(() => import('./pages/DeliveryReviewPage'));
const ShippingDeliveryPage = lazy(() => import('./pages/ShippingDeliveryPage'));
const ShippingLoadingPage = lazy(() => import('./pages/ShippingLoadingPage'));
const ScaleLandingPage = lazy(() => import('./modules/scale/pages/ScaleLandingPage'));
const ScaleReceiptPage = lazy(() => import('./modules/scale/pages/ScaleReceiptPage'));
const ScaleWeighingPage = lazy(() => import('./modules/scale/pages/ScaleWeighingPage'));
const ScaleDraftsPage = lazy(() => import('./modules/scale/pages/ScaleDraftsPage'));
const ScaleDraftDetailPage = lazy(() => import('./modules/scale/pages/ScaleDraftDetailPage'));
const ScaleDevicesPage = lazy(() => import('./modules/scale/pages/ScaleDevicesPage'));
const ScaleItemElementsPage = lazy(() => import('./modules/scale/pages/ScaleItemElementsPage'));
const ScaleEntryExitPermitsPage = lazy(() => import('./modules/scale/pages/ScaleEntryExitPermitsPage'));
const ScaleEntryPermitPage = lazy(() => import('./modules/scale/pages/ScaleEntryPermitPage'));
const ScaleExitPermitPage = lazy(() => import('./modules/scale/pages/ScaleExitPermitPage'));

const getInitialTheme = () => {
  const storedTheme = window.localStorage.getItem('app-theme');
  if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

function UnauthorizedPage() {
  const { t } = useI18n();
  return (
    <div className="page-shell page-shell--center">
      <div className="feedback-message feedback-message--error">
        {t('common.accessDenied')}
      </div>
    </div>
  );
}

function RequireAuth({ children, allow }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (allow && !allow(user)) return <UnauthorizedPage />;
  return children;
}

function PageTransition({ children }) {
  const location = useLocation();
  return (
    <div key={location.pathname} className="page-transition">
      {children}
    </div>
  );
}

function GlobalReviewRoute() {
  const { user } = useAuth();
  if (user && canAccessReceiptReview(user)) return <ReceiptReviewPage />;
  if (user && canAccessCustomization(user)) return <Navigate to="/customization-delivery/review" replace />;
  if (user && canAccessDelivery(user)) return <Navigate to="/customization-delivery/review/deliveries" replace />;
  if (user && canAccessGrpo(user)) return <Navigate to="/grpo/review" replace />;
  if (user && canAccessTransferReview(user)) return <Navigate to="/transfer-review" replace />;
  if (user && canAccessQualityReview(user)) return <Navigate to="/quality-review" replace />;
  if (user && canAccessScale(user)) return <Navigate to="/scale/drafts" replace />;
  return <ReceiptReviewPage />;
}



function LangToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <button
      type="button"
      className="toolbar-icon-btn lang-toggle-btn"
      onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
      title={lang === 'en' ? t('toolbar.switchToArabic') : t('toolbar.switchToEnglish')}
    >
      {lang === 'en' ? 'ع' : 'EN'}
    </button>
  );
}

function AppFrame({ theme, onToggleTheme }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logoutUser } = useAuth();
  const { t, lang } = useI18n();
  const [openMenu, setOpenMenu] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileDrawerSide, setMobileDrawerSide] = useState('left');

  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  const breadcrumbsByPath = {
    '/': [{ labelKey: 'nav.home', path: null }],
    '/production': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.production', path: null }],
    '/transfer': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.transfer', path: null }],
    '/receipt': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.production', path: '/production' }, { labelKey: 'nav.receiptWizard', path: null }],
    '/issue': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.production', path: '/production' }, { labelKey: 'nav.issueWizard', path: null }],
    '/create-user': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.usersPage', path: '/users' }, { labelKey: 'nav.createUser', path: null }],
    '/users': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.usersPage', path: null }],
    '/users/activity-log': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.usersPage', path: '/users' }, { labelKey: 'nav.activityLog', path: null }],
    '/order-rules': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.attributeRules', path: null }],
    '/order-rules/production': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.attributeRules', path: '/order-rules' }, { labelKey: 'nav.productionRules', path: null }],
    '/order-rules/transfer': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.attributeRules', path: '/order-rules' }, { labelKey: 'nav.transferRules', path: null }],
    '/order-rules/quality/stages': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.attributeRules', path: '/order-rules' }, { labelKey: 'nav.qualityRules', path: null }, { labelKey: 'nav.qualityInspectionStages', path: null }],
    '/order-rules/quality/categories': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.attributeRules', path: '/order-rules' }, { labelKey: 'nav.qualityRules', path: null }, { labelKey: 'nav.qualityCategories', path: null }],
    '/order-rules/quality/criteria': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.attributeRules', path: '/order-rules' }, { labelKey: 'nav.qualityRules', path: null }, { labelKey: 'nav.qualityCriteria', path: null }],
    '/order-rules/quality/item-criteria': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.attributeRules', path: '/order-rules' }, { labelKey: 'nav.qualityRules', path: null }, { labelKey: 'nav.qualityCriteriaMapping', path: null }],
    '/receipt-review': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.receiptReview', path: null }],
    '/issue-review': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.production', path: '/production' }, { labelKey: 'nav.issueReview', path: null }],
    '/transfer-review': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.transferReview', path: null }],
    '/transfer/shipping': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'physicalTransfer.shippingDelivery', path: null }],
    '/shipping-loading': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'physicalTransfer.shippingDelivery', path: null }],
    '/review': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.receiptReview', path: null }],
    '/quality': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.quality', path: null }],
    '/quality/receiving': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.quality', path: '/quality' }, { labelKey: 'nav.qualityReceiving', path: null }],
    '/quality-review': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.qualityReview', path: null }],
    '/scale': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.scale', path: null }],
    '/scale/weighing': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.scale', path: '/scale' }, { labelKey: 'nav.scaleWeighing', path: null }],
    '/scale/receipt': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.scale', path: '/scale' }, { labelKey: 'nav.scaleReceipt', path: null }],
    '/scale/drafts': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.scale', path: '/scale' }, { labelKey: 'nav.scaleDrafts', path: null }],
    '/scale/devices': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.scale', path: '/scale' }, { labelKey: 'nav.scaleDevices', path: null }],
    '/scale/item-elements': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.scale', path: '/scale' }, { labelKey: 'nav.scaleItemElements', path: null }],
    '/scale/entry-exit-permits': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.scale', path: '/scale' }, { labelKey: 'nav.scaleEntryExitPermits', path: null }],
    '/scale/entry-exit-permits/entry': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.scale', path: '/scale' }, { labelKey: 'nav.scaleEntryExitPermits', path: '/scale/entry-exit-permits' }, { labelKey: 'nav.scaleEntryPermit', path: null }],
    '/scale/entry-exit-permits/exit': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.scale', path: '/scale' }, { labelKey: 'nav.scaleEntryExitPermits', path: '/scale/entry-exit-permits' }, { labelKey: 'nav.scaleExitPermit', path: null }],
    '/shipping-receiving': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.shippingReceiving', path: null }],
    '/shipping-delivery': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.shippingReceiving', path: '/shipping-receiving' }, { labelKey: 'nav.shippingDelivery', path: null }],
    '/shipping-delivery/review': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.shippingReceiving', path: '/shipping-receiving' }, { labelKey: 'nav.shippingDelivery', path: '/shipping-delivery' }, { labelKey: 'nav.purchaseQuotationsReview', path: null }],
    '/grpo': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.shippingReceiving', path: '/shipping-receiving' }, { labelKey: 'nav.grpo', path: null }],
    '/grpo/review': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.shippingReceiving', path: '/shipping-receiving' }, { labelKey: 'nav.grpoReview', path: null }],
    '/purchase-quotations': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.shippingReceiving', path: '/shipping-receiving' }, { labelKey: 'nav.shippingDelivery', path: null }],
    '/purchase-quotations/review': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.shippingReceiving', path: '/shipping-receiving' }, { labelKey: 'nav.shippingDelivery', path: '/shipping-delivery' }, { labelKey: 'nav.purchaseQuotationsReview', path: null }],
    '/customization-delivery': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.customizationDelivery', path: null }],
    '/customization-delivery/quotations': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.customizationDelivery', path: '/customization-delivery' }, { labelKey: 'nav.salesQuotations', path: null }],
    '/customization-delivery/quotations/new': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.customizationDelivery', path: '/customization-delivery' }, { labelKey: 'nav.salesQuotations', path: '/customization-delivery/quotations' }, { labelKey: 'nav.createSalesQuotation', path: null }],
    '/customization-delivery/orders': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.customizationDelivery', path: '/customization-delivery' }, { labelKey: 'nav.salesOrders', path: null }],
    '/customization-delivery/deliveries': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.customizationDelivery', path: '/customization-delivery' }, { labelKey: 'nav.deliveries', path: null }],
    '/customization-delivery/deliveries/new': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.customizationDelivery', path: '/customization-delivery' }, { labelKey: 'nav.deliveries', path: '/customization-delivery/deliveries' }, { labelKey: 'nav.createDelivery', path: null }],
    '/customization-delivery/quotations/review': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.customizationDelivery', path: '/customization-delivery' }, { labelKey: 'nav.salesQuotationsReview', path: null }],
    '/customization-delivery/review': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.customizationDelivery', path: '/customization-delivery' }, { labelKey: 'nav.salesOrdersReview', path: null }],
    '/customization-delivery/review/deliveries': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.customizationDelivery', path: '/customization-delivery' }, { labelKey: 'nav.deliveryReview', path: null }],
  };

  const crumbs = location.pathname.startsWith('/customization-delivery/')
    ? (breadcrumbsByPath[location.pathname] || [
        { labelKey: 'nav.home', path: '/' },
        { labelKey: 'nav.customizationDelivery', path: '/customization-delivery' },
        { labelKey: 'nav.page', path: null },
      ])
    : location.pathname.startsWith('/scale/drafts/')
    ? [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.scale', path: '/scale' }, { labelKey: 'nav.scaleDrafts', path: '/scale/drafts' }, { labelKey: 'nav.page', path: null }]
    : location.pathname.startsWith('/quality/grpo-')
      ? [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.qualityReview', path: '/quality-review' }, { labelKey: 'nav.page', path: null }]
    : location.pathname === '/grpo/review'
      ? [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.shippingReceiving', path: '/shipping-receiving' }, { labelKey: 'nav.grpoReview', path: null }]
      : location.pathname.startsWith('/grpo/')
        ? [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.shippingReceiving', path: '/shipping-receiving' }, { labelKey: 'nav.grpo', path: '/grpo' }, { labelKey: 'nav.page', path: null }]
        : location.pathname.startsWith('/shipping-delivery/') && location.pathname !== '/shipping-delivery/review'
          ? [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.shippingReceiving', path: '/shipping-receiving' }, { labelKey: 'nav.shippingDelivery', path: '/shipping-delivery' }, { labelKey: 'nav.page', path: null }]
          : location.pathname.startsWith('/purchase-quotations/') && location.pathname !== '/purchase-quotations/review'
            ? [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.shippingReceiving', path: '/shipping-receiving' }, { labelKey: 'nav.shippingDelivery', path: '/shipping-delivery' }, { labelKey: 'nav.page', path: null }]
            : (breadcrumbsByPath[location.pathname] || [{ labelKey: 'nav.page', path: null }]);

  const showReviewMenu = user && (canAccessScale(user) || canAccessReceiptReview(user) || canAccessIssueReview(user) || canAccessTransferReview(user) || canAccessQualityReview(user) || canAccessGrpo(user) || canAccessPurchaseQuotation(user) || canAccessCustomization(user) || canAccessDelivery(user));
  const canAccessQualityRules = user && canManageQuality(user);
  const showRulesMenu = user && (
    (canAccessProductionRules(user) && canAccessTransferRules(user))
    || canAccessQualityRules
  );
  const rulesHomePath = canAccessProductionRules(user)
    ? '/order-rules/production'
    : canAccessTransferRules(user)
      ? '/order-rules/transfer'
      : '/order-rules/quality/criteria';

  const handleLogout = async () => {
    try { await API.post('/logout/'); } catch { /* ignore */ }
    logoutUser();
    navigate('/login');
  };

  const setHoveredMenu = (event, menu) => {
    // Ignore compatibility hover events on devices driven by touch.
    if (event.pointerType === 'mouse' && window.matchMedia('(hover: hover)').matches) setOpenMenu(menu);
  };

  const toggleMenu = (event, menu) => {
    const mouseHover = event.nativeEvent.pointerType === 'mouse' && window.matchMedia('(hover: hover)').matches;
    setOpenMenu((current) => mouseHover ? menu : (current === menu ? null : menu));
  };

  const navCurrent = (path) => (
    location.pathname === path || location.pathname.startsWith(`${path}/`)
      ? 'page'
      : undefined
  );

  return (
    <div className="app-shell">
      <AppTopBarProgress />
      <header className="app-toolbar">
        <div className="app-toolbar__content">
          <div className="app-brand">
            <div className="logo-frame logo-frame--header">
              <img src={meemLogo} alt="Meem" className="app-logo app-logo--meem" />
            </div>
            <div className="app-brand__text">
              <span className="app-brand__eyebrow">{t('nav.sapWorkflow')}</span>
              <nav className="breadcrumb" aria-label="breadcrumb">
                {crumbs.map((crumb, index) => (
                  <span key={crumb.labelKey || crumb.label} className="breadcrumb__item">
                    {index > 0 && <span className="breadcrumb__sep">/</span>}
                    {crumb.path !== null ? (
                      <Link to={crumb.path} className="breadcrumb__link">{crumb.label || t(crumb.labelKey)}</Link>
                    ) : (
                      <span className="breadcrumb__current">{crumb.label || t(crumb.labelKey)}</span>
                    )}
                  </span>
                ))}
              </nav>
            </div>
          </div>

          <button
            type="button"
            className="mobile-nav-toggle"
            aria-label={lang === 'ar' ? 'فتح قائمة التنقل' : 'Open navigation menu'}
            aria-expanded={mobileNavOpen}
            aria-controls="app-toolbar-actions"
            onClick={(event) => {
              if (!mobileNavOpen) {
                const buttonBounds = event.currentTarget.getBoundingClientRect();
                const buttonCenter = buttonBounds.left + (buttonBounds.width / 2);
                setMobileDrawerSide(buttonCenter >= (window.innerWidth / 2) ? 'right' : 'left');
              }
              setMobileNavOpen((current) => !current);
              setOpenMenu(null);
            }}
          >
            <Menu size={22} aria-hidden="true" />
          </button>

          {mobileNavOpen && (
            <button
              type="button"
              className="mobile-drawer-backdrop"
              aria-label={lang === 'ar' ? 'إغلاق قائمة التنقل' : 'Close navigation menu'}
              onClick={() => {
                setMobileNavOpen(false);
                setOpenMenu(null);
              }}
            />
          )}

          <div
            id="app-toolbar-actions"
            className={`app-toolbar__actions ${mobileNavOpen ? `app-toolbar__actions--mobile-open app-toolbar__actions--mobile-${mobileDrawerSide}` : ''}`}
            onClick={(event) => {
              if (event.target.closest('a')) setMobileNavOpen(false);
            }}
          >
            <div className="mobile-drawer__header">
              <div className="mobile-drawer__brand">
                <img src={meemLogo} alt="Meem" className="mobile-drawer__logo" />
                <div className="mobile-drawer__brand-copy">
                  <span>{t('nav.sapWorkflow')}</span>
                  <strong>{crumbs.at(-1)?.label || t(crumbs.at(-1)?.labelKey || 'nav.home')}</strong>
                </div>
              </div>
              <button
                type="button"
                className="mobile-drawer__close"
                aria-label={lang === 'ar' ? 'إغلاق قائمة التنقل' : 'Close navigation menu'}
                onClick={() => {
                  setMobileNavOpen(false);
                  setOpenMenu(null);
                }}
              >
                <X size={22} aria-hidden="true" />
              </button>
            </div>

            <span className="mobile-drawer__section-label">
              {lang === 'ar' ? 'التنقل' : 'Navigation'}
            </span>
            {showReviewMenu && (
              <div
                className={`toolbar-review-menu toolbar-review-menu--review ${openMenu === 'review' || openMenu === 'review-sales' || openMenu === 'review-shipping' || openMenu === 'review-production' ? 'toolbar-review-menu--open' : ''}`}
                onPointerEnter={(event) => setHoveredMenu(event, 'review')}
                onPointerLeave={(event) => setHoveredMenu(event, null)}
              >
                <button
                  type="button"
                  className="app-button app-button--secondary toolbar-nav-btn"
                  aria-expanded={openMenu === 'review'}
                  onClick={(event) => toggleMenu(event, 'review')}
                >
                  <span>{t('toolbar.review')}</span>
                  <span className="mobile-drawer__nav-arrow" aria-hidden="true">›</span>
                </button>
                <div className="toolbar-review-menu__list">
                  {(canAccessGrpo(user) || canAccessPurchaseQuotation(user)) && (
                    <div
                      className={`toolbar-review-menu__submenu-wrap ${openMenu === 'review-shipping' ? 'toolbar-review-menu__submenu-wrap--open' : ''}`}
                      onPointerEnter={(event) => setHoveredMenu(event, 'review-shipping')}
                      onPointerLeave={(event) => setHoveredMenu(event, 'review')}
                    >
                      <button
                        type="button"
                        className="toolbar-review-menu__item toolbar-review-menu__submenu-trigger"
                        aria-expanded={openMenu === 'review-shipping'}
                        onClick={(event) => toggleMenu(event, 'review-shipping')}
                      >
                        <span className="toolbar-review-menu__trigger-main">
                          <span className="toolbar-review-menu__item-icon" aria-hidden="true">🚚</span>
                          <span className="toolbar-review-menu__item-text">{t('nav.shippingReceiving')}</span>
                        </span>
                        <span className="toolbar-review-menu__arrow" aria-hidden="true">{lang === 'ar' ? '‹' : '›'}</span>
                      </button>
                      <div className="toolbar-review-menu__submenu">
                        {canAccessGrpo(user) && <Link to="/grpo/review" className="toolbar-review-menu__item" aria-current={navCurrent('/grpo/review')} onClick={() => setOpenMenu(null)}>
                          <span className="toolbar-review-menu__item-icon" aria-hidden="true">📦</span>
                          <span className="toolbar-review-menu__item-text">{t('nav.grpoReview')}</span>
                        </Link>}
                        {canAccessPurchaseQuotation(user) && <Link to="/purchase-quotations/review" className="toolbar-review-menu__item" aria-current={navCurrent('/purchase-quotations/review')} onClick={() => setOpenMenu(null)}>
                          <span className="toolbar-review-menu__item-icon" aria-hidden="true">📋</span>
                          <span className="toolbar-review-menu__item-text">{t('nav.purchaseQuotationsReview') || 'Shipping Review'}</span>
                        </Link>}
                      </div>
                    </div>
                  )}
                  {canAccessScale(user) && (
                    <Link to="/scale/drafts" className="toolbar-review-menu__item" aria-current={navCurrent('/scale/drafts')} onClick={() => setOpenMenu(null)}>
                      <span className="toolbar-review-menu__item-icon" aria-hidden="true">⚖️</span>
                      <span className="toolbar-review-menu__item-text">{t('nav.scaleReview') || 'Scale Review'}</span>
                    </Link>
                  )}
                  {canAccessQualityReview(user) && (
                    <Link to="/quality-review" className="toolbar-review-menu__item" aria-current={navCurrent('/quality-review')} onClick={() => setOpenMenu(null)}>
                      <span className="toolbar-review-menu__item-icon" aria-hidden="true">🛡️</span>
                      <span className="toolbar-review-menu__item-text">{t('nav.qualityReview') || 'Quality Review'}</span>
                    </Link>
                  )}
                  {(canAccessReceiptReview(user) || canAccessIssueReview(user)) && (
                    <div
                      className={`toolbar-review-menu__submenu-wrap ${openMenu === 'review-production' ? 'toolbar-review-menu__submenu-wrap--open' : ''}`}
                      onPointerEnter={(event) => setHoveredMenu(event, 'review-production')}
                      onPointerLeave={(event) => setHoveredMenu(event, 'review')}
                    >
                      <button
                        type="button"
                        className="toolbar-review-menu__item toolbar-review-menu__submenu-trigger"
                        aria-expanded={openMenu === 'review-production'}
                        onClick={(event) => toggleMenu(event, 'review-production')}
                      >
                        <span className="toolbar-review-menu__trigger-main">
                          <span className="toolbar-review-menu__item-icon" aria-hidden="true">🏭</span>
                          <span className="toolbar-review-menu__item-text">{t('nav.productionReview')}</span>
                        </span>
                        <span className="toolbar-review-menu__arrow" aria-hidden="true">{lang === 'ar' ? '‹' : '›'}</span>
                      </button>
                      <div className="toolbar-review-menu__submenu">
                        {canAccessReceiptReview(user) && <Link to="/receipt-review" className="toolbar-review-menu__item" aria-current={navCurrent('/receipt-review')} onClick={() => setOpenMenu(null)}>
                          <span className="toolbar-review-menu__item-icon" aria-hidden="true">📄</span>
                          <span className="toolbar-review-menu__item-text">{t('nav.receiptReview')}</span>
                        </Link>}
                        {canAccessIssueReview(user) && <Link to="/issue-review" className="toolbar-review-menu__item" aria-current={navCurrent('/issue-review')} onClick={() => setOpenMenu(null)}>
                          <span className="toolbar-review-menu__item-icon" aria-hidden="true">📋</span>
                          <span className="toolbar-review-menu__item-text">{t('nav.issueReview')}</span>
                        </Link>}
                      </div>
                    </div>
                  )}
                  {canAccessTransferReview(user) && (
                    <Link to="/transfer-review" className="toolbar-review-menu__item" aria-current={navCurrent('/transfer-review')} onClick={() => setOpenMenu(null)}>
                      <span className="toolbar-review-menu__item-icon" aria-hidden="true">🔄</span>
                      <span className="toolbar-review-menu__item-text">{t('nav.transferReview')}</span>
                    </Link>
                  )}
                  {(canAccessCustomization(user) || canAccessDelivery(user)) && (
                    <div
                      className={`toolbar-review-menu__submenu-wrap ${openMenu === 'review-sales' ? 'toolbar-review-menu__submenu-wrap--open' : ''}`}
                      onPointerEnter={(event) => setHoveredMenu(event, 'review-sales')}
                      onPointerLeave={(event) => setHoveredMenu(event, 'review')}
                    >
                      <button
                        type="button"
                        className="toolbar-review-menu__item toolbar-review-menu__submenu-trigger"
                        aria-expanded={openMenu === 'review-sales'}
                        aria-current={location.pathname === '/customization-delivery/quotations/review' || location.pathname === '/customization-delivery/review' || location.pathname === '/customization-delivery/review/deliveries' ? 'page' : undefined}
                        onClick={(event) => toggleMenu(event, 'review-sales')}
                      >
                        <span className="toolbar-review-menu__trigger-main">
                          <span className="toolbar-review-menu__item-icon" aria-hidden="true">📋</span>
                          <span className="toolbar-review-menu__item-text">{t('nav.salesReview')}</span>
                        </span>
                        <span className="toolbar-review-menu__arrow" aria-hidden="true">{lang === 'ar' ? '‹' : '›'}</span>
                      </button>
                      <div className="toolbar-review-menu__submenu">
                        {canAccessCustomization(user) && <Link to="/customization-delivery/quotations/review" className="toolbar-review-menu__item" aria-current={location.pathname === '/customization-delivery/quotations/review' ? 'page' : undefined} onClick={() => setOpenMenu(null)}>
                          <span className="toolbar-review-menu__item-icon" aria-hidden="true">📝</span>
                          <span className="toolbar-review-menu__item-text">{t('nav.salesQuotationsReview')}</span>
                        </Link>}
                        {canAccessCustomization(user) && <Link to="/customization-delivery/review" className="toolbar-review-menu__item" aria-current={location.pathname === '/customization-delivery/review' ? 'page' : undefined} onClick={() => setOpenMenu(null)}>
                          <span className="toolbar-review-menu__item-icon" aria-hidden="true">📄</span>
                          <span className="toolbar-review-menu__item-text">{t('nav.salesOrdersReview')}</span>
                        </Link>}
                        {canAccessDelivery(user) && <Link to="/customization-delivery/review/deliveries" className="toolbar-review-menu__item" aria-current={navCurrent('/customization-delivery/review/deliveries')} onClick={() => setOpenMenu(null)}>
                          <span className="toolbar-review-menu__item-icon" aria-hidden="true">🚚</span>
                          <span className="toolbar-review-menu__item-text">{t('nav.deliveryReview')}</span>
                        </Link>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {user && canAccessCustomization(user) && !showReviewMenu && (
              <Link to="/customization-delivery/review" className="app-button app-button--secondary toolbar-nav-btn">
                {t('toolbar.review')}
              </Link>
            )}
            {user && canAccessReceiptReview(user) && !showReviewMenu && (
              <Link to="/receipt-review" className="app-button app-button--secondary toolbar-nav-btn">
                {t('toolbar.review')}
              </Link>
            )}
            {user && canAccessIssueReview(user) && !showReviewMenu && (
              <Link to="/issue-review" className="app-button app-button--secondary toolbar-nav-btn">
                {t('nav.issueReview')}
              </Link>
            )}
            {user && canAccessTransferReview(user) && !showReviewMenu && (
              <Link to="/transfer-review" className="app-button app-button--secondary toolbar-nav-btn">
                {t('toolbar.review')}
              </Link>
            )}
            {user && canAccessQualityReview(user) && !showReviewMenu && (
              <Link to="/quality-review" className="app-button app-button--secondary toolbar-nav-btn">
                {t('toolbar.review')}
              </Link>
            )}
            {user && canAccessGrpo(user) && !showReviewMenu && (
              <Link to="/grpo/review" className="app-button app-button--secondary toolbar-nav-btn">
                {t('toolbar.review')}
              </Link>
            )}

            {user && (
              <>
                {showRulesMenu && (
                  <div
                    className={`toolbar-review-menu ${openMenu === 'rules' || openMenu === 'rules-quality' || openMenu === 'rules-transfer' ? 'toolbar-review-menu--open' : ''}`}
                    onPointerEnter={(event) => setHoveredMenu(event, 'rules')}
                    onPointerLeave={(event) => setHoveredMenu(event, null)}
                  >
                    <button
                      type="button"
                      className="app-button app-button--secondary toolbar-nav-btn"
                      aria-expanded={openMenu === 'rules'}
                      aria-current={navCurrent('/order-rules/production') || navCurrent('/order-rules/transfer') || (location.pathname.startsWith('/order-rules/quality') ? 'page' : undefined)}
                      onClick={(event) => toggleMenu(event, 'rules')}
                    >
                      <span>{t('toolbar.rules')}</span>
                      <span className="mobile-drawer__nav-arrow" aria-hidden="true">›</span>
                    </button>
                    <div className="toolbar-review-menu__list">
                      {canAccessProductionRules(user) && (
                        <Link to="/order-rules/production" className="toolbar-review-menu__item" aria-current={navCurrent('/order-rules/production')} onClick={() => setOpenMenu(null)}>
                          {t('nav.productionRules')}
                        </Link>
                      )}
                      {canAccessTransferRules(user) && (
                        <div
                          className={`toolbar-review-menu__submenu-wrap ${openMenu === 'rules-transfer' ? 'toolbar-review-menu__submenu-wrap--open' : ''}`}
                          onPointerEnter={(event) => setHoveredMenu(event, 'rules-transfer')}
                          onPointerLeave={(event) => setHoveredMenu(event, 'rules')}
                        >
                          <button
                            type="button"
                            className="toolbar-review-menu__item toolbar-review-menu__submenu-trigger"
                            aria-expanded={openMenu === 'rules-transfer'}
                            aria-current={navCurrent('/order-rules/transfer')}
                            onClick={(event) => toggleMenu(event, 'rules-transfer')}
                          >
                            <span>{t('nav.transferRules')}</span>
                            <span className="toolbar-review-menu__arrow" aria-hidden="true">{lang === 'ar' ? '‹' : '›'}</span>
                          </button>
                          <div className="toolbar-review-menu__submenu">
                            <Link to="/order-rules/transfer" className="toolbar-review-menu__item" aria-current={navCurrent('/order-rules/transfer')} onClick={() => setOpenMenu(null)}>
                              {t('nav.transferRules')}
                            </Link>
                          </div>
                        </div>
                      )}
                      {canAccessQualityRules && (
                        <div
                          className={`toolbar-review-menu__submenu-wrap ${openMenu === 'rules-quality' ? 'toolbar-review-menu__submenu-wrap--open' : ''}`}
                          onPointerEnter={(event) => setHoveredMenu(event, 'rules-quality')}
                          onPointerLeave={(event) => setHoveredMenu(event, 'rules')}
                        >
                          <button
                            type="button"
                            className="toolbar-review-menu__item toolbar-review-menu__submenu-trigger"
                            aria-expanded={openMenu === 'rules-quality'}
                            onClick={(event) => toggleMenu(event, 'rules-quality')}
                          >
                            <span>{t('nav.qualityRules')}</span>
                            <span className="toolbar-review-menu__arrow" aria-hidden="true">{lang === 'ar' ? '‹' : '›'}</span>
                          </button>
                          <div className="toolbar-review-menu__submenu">
                            <Link to="/order-rules/quality/stages" className="toolbar-review-menu__item" aria-current={navCurrent('/order-rules/quality/stages')} onClick={() => setOpenMenu(null)}>
                              {t('nav.qualityInspectionStages')}
                            </Link>
                            <Link to="/order-rules/quality/categories" className="toolbar-review-menu__item" aria-current={navCurrent('/order-rules/quality/categories')} onClick={() => setOpenMenu(null)}>
                              {t('nav.qualityCategories')}
                            </Link>
                            <Link to="/order-rules/quality/criteria" className="toolbar-review-menu__item" aria-current={navCurrent('/order-rules/quality/criteria')} onClick={() => setOpenMenu(null)}>
                              {t('nav.qualityCriteria')}
                            </Link>
                            <Link to="/order-rules/quality/item-criteria" className="toolbar-review-menu__item" aria-current={navCurrent('/order-rules/quality/item-criteria')} onClick={() => setOpenMenu(null)}>
                              {t('nav.qualityCriteriaMapping')}
                            </Link>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {canAccessProductionRules(user) && !showRulesMenu && (
                  <Link to="/order-rules/production" className="app-button app-button--secondary toolbar-nav-btn" aria-current={navCurrent('/order-rules/production')}>
                    {t('nav.productionRules')}
                  </Link>
                )}
                {canAccessTransferRules(user) && !showRulesMenu && (
                  <div
                    className={`toolbar-review-menu ${openMenu === 'rules-transfer' ? 'toolbar-review-menu--open' : ''}`}
                    onPointerEnter={(event) => setHoveredMenu(event, 'rules-transfer')}
                    onPointerLeave={(event) => setHoveredMenu(event, null)}
                  >
                    <button
                      type="button"
                      className="app-button app-button--secondary toolbar-nav-btn"
                      aria-expanded={openMenu === 'rules-transfer'}
                      aria-current={navCurrent('/order-rules/transfer')}
                      onClick={(event) => toggleMenu(event, 'rules-transfer')}
                    >
                      <span>{t('nav.transferRules')}</span>
                      <span className="mobile-drawer__nav-arrow" aria-hidden="true">›</span>
                    </button>
                    <div className="toolbar-review-menu__list">
                      <Link to="/order-rules/transfer" className="toolbar-review-menu__item" aria-current={navCurrent('/order-rules/transfer')} onClick={() => setOpenMenu(null)}>
                        {t('nav.transferRules')}
                      </Link>
                    </div>
                  </div>
                )}
                {canManageUsers(user) && (
                  <Link to="/users" className="app-button app-button--secondary toolbar-nav-btn" aria-current={navCurrent('/users')}>
                    {t('toolbar.users')}
                  </Link>
                )}
              </>
            )}

            {user && (
              <span className="user-badge">
                <span className="user-badge__name">{user.username}</span>
                {user.warehouse && <span className="user-badge__warehouse">WH {user.warehouse}</span>}
              </span>
            )}

            <LangToggle />

            <button
              type="button"
              className="mobile-drawer__theme"
              onClick={onToggleTheme}
            >
              <span aria-hidden="true">{theme === 'light' ? '🌙' : '☀️'}</span>
              <span>{theme === 'light' ? t('toolbar.switchToDark') : t('toolbar.switchToLight')}</span>
            </button>

            {user && (
              <button type="button" className="app-button app-button--secondary toolbar-nav-btn toolbar-signout" onClick={handleLogout}>
                {t('toolbar.signOut')}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="app-content">
        <PageTransition>
          <ErrorBoundary>
            <Suspense fallback={<Loading label={t('common.loading')} />}>
            <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />

            {/* Production Routes */}
            <Route path="/production" element={<RequireAuth allow={canAccessProduction}><Production /></RequireAuth>} />
            <Route path="/receipt" element={<RequireAuth allow={canAccessProduction}><ReceiptWizard /></RequireAuth>} />
            <Route path="/issue" element={<RequireAuth allow={canAccessProduction}><IssueWizard /></RequireAuth>} />
            <Route path="/issue-review" element={<RequireAuth allow={canAccessIssueReview}><IssueReviewPage /></RequireAuth>} />
            <Route path="/receipt-review" element={<RequireAuth allow={canAccessReceiptReview}><ReceiptReviewPage /></RequireAuth>} />
            <Route path="/review" element={<RequireAuth allow={(u) => canAccessReceiptReview(u) || canAccessCustomization(u) || canAccessDelivery(u) || canAccessGrpo(u) || canAccessPurchaseQuotation(u) || canAccessTransferReview(u) || canAccessQualityReview(u) || canAccessScale(u)}><GlobalReviewRoute /></RequireAuth>} />

            {/* Transfer Routes */}
            <Route path="/transfer" element={<RequireAuth allow={canAccessTransfer}><TransferPage operation="internal" /></RequireAuth>} />
            <Route path="/transfer/internal" element={<RequireAuth allow={canAccessTransfer}><Navigate to="/transfer" replace /></RequireAuth>} />
            <Route path="/transfer/shipping" element={<RequireAuth allow={canAccessTransfer}><Navigate to="/shipping-loading" replace /></RequireAuth>} />
            <Route path="/transfer-review" element={<RequireAuth allow={canAccessTransferReview}><TransferReviewPage /></RequireAuth>} />
            <Route path="/transfer-review/internal" element={<RequireAuth allow={canAccessTransferReview}><Navigate to="/transfer-review" replace /></RequireAuth>} />
            <Route path="/transfer-review/shipping" element={<RequireAuth allow={canAccessTransferReview}><Navigate to="/transfer-review" replace /></RequireAuth>} />

            {/* Quality Routes */}
            <Route path="/quality" element={<RequireAuth allow={canAccessQuality}><QualityLandingPage /></RequireAuth>} />
            <Route path="/quality/receiving" element={<RequireAuth allow={canAccessQuality}><ReceivingInspectionWizard /></RequireAuth>} />
            <Route path="/quality/pre-export" element={<Navigate to="/quality" replace />} />
            <Route path="/quality-review" element={<RequireAuth allow={canAccessQualityReview}><QualityReviewPage /></RequireAuth>} />
            <Route path="/quality/grpo-drafts/:draftId" element={<RequireAuth allow={(u) => canAccessQualityReview(u) && canAccessGrpo(u)}><PurchaseGRPODraftPage /></RequireAuth>} />
            <Route path="/quality/grpo-documents/:draftId" element={<RequireAuth allow={(u) => canAccessQualityReview(u) && canAccessGrpo(u)}><PurchaseGRPODraftPage /></RequireAuth>} />

            {/* Shipping & Receiving Module Routes */}
            <Route path="/shipping-receiving" element={<RequireAuth allow={(u) => canAccessGrpo(u) || canAccessPurchaseQuotation(u)}><ShippingReceivingPage /></RequireAuth>} />
            <Route path="/shipping-delivery" element={<RequireAuth allow={canAccessPurchaseQuotation}><ShippingDeliveryPage /></RequireAuth>} />
            <Route path="/shipping-loading" element={<RequireAuth allow={canAccessTransfer}><ShippingLoadingPage /></RequireAuth>} />
            <Route path="/shipping-delivery/review" element={<RequireAuth allow={canAccessPurchaseQuotation}><PurchaseQuotationReviewPage /></RequireAuth>} />
            <Route path="/shipping-delivery/:draftId" element={<RequireAuth allow={canAccessPurchaseQuotation}><PurchaseQuotationDraftPage /></RequireAuth>} />
            <Route path="/shipping-delivery/documents/:draftId" element={<RequireAuth allow={canAccessPurchaseQuotation}><PurchaseQuotationDraftPage postedViewOnly /></RequireAuth>} />

            {/* Standalone GRPO Routes */}
            <Route path="/grpo" element={<RequireAuth allow={canAccessGrpo}><GRPOPage /></RequireAuth>} />
            <Route path="/grpo/review" element={<RequireAuth allow={canAccessGrpo}><GRPOReviewPage /></RequireAuth>} />
            <Route path="/grpo/manual/new" element={<RequireAuth allow={canAccessGrpo}><PurchaseGRPODraftPage manualCreate /></RequireAuth>} />
            <Route path="/grpo/:draftId" element={<RequireAuth allow={canAccessGrpo}><PurchaseGRPODraftPage /></RequireAuth>} />
            <Route path="/grpo/documents/:draftId" element={<RequireAuth allow={canAccessGrpo}><PurchaseGRPODraftPage postedViewOnly /></RequireAuth>} />

            {/* Standalone Purchase Quotation Routes */}
            <Route path="/purchase-quotations" element={<RequireAuth allow={canAccessPurchaseQuotation}><PurchaseQuotationPage /></RequireAuth>} />
            <Route path="/purchase-quotations/review" element={<RequireAuth allow={canAccessPurchaseQuotation}><PurchaseQuotationReviewPage /></RequireAuth>} />
            <Route path="/purchase-quotations/:draftId" element={<RequireAuth allow={canAccessPurchaseQuotation}><PurchaseQuotationDraftPage /></RequireAuth>} />
            <Route path="/purchase-quotations/documents/:draftId" element={<RequireAuth allow={canAccessPurchaseQuotation}><PurchaseQuotationDraftPage postedViewOnly /></RequireAuth>} />

            {/* Customization & Delivery 3-Layer Workflow Routes */}
            <Route path="/customization-delivery" element={<RequireAuth allow={canAccessCustomizationOrDelivery}><CustomizationDeliveryPage /></RequireAuth>} />
            <Route path="/customization-delivery/quotations" element={<RequireAuth allow={canAccessCustomization}><SalesQuotationsPage /></RequireAuth>} />
            <Route path="/customization-delivery/quotations/new" element={<RequireAuth allow={canAccessCustomization}><SalesQuotationCreatePage /></RequireAuth>} />
            <Route path="/customization-delivery/quotations/review" element={<RequireAuth allow={canAccessCustomization}><SalesQuotationsReviewPage /></RequireAuth>} />
            <Route path="/customization-delivery/review" element={<RequireAuth allow={canAccessCustomization}><SalesOrdersReviewPage /></RequireAuth>} />
            <Route path="/customization-delivery/review/deliveries" element={<RequireAuth allow={canAccessDelivery}><DeliveryReviewPage /></RequireAuth>} />
            <Route path="/customization-delivery/orders" element={<RequireAuth allow={canAccessCustomization}><SalesOrdersPage /></RequireAuth>} />
            <Route path="/customization-delivery/deliveries" element={<RequireAuth allow={canAccessDelivery}><DeliveriesPage /></RequireAuth>} />
            <Route path="/customization-delivery/deliveries/new/:docEntry" element={<RequireAuth allow={canAccessDelivery}><DeliveryCreateWizardPage /></RequireAuth>} />
            <Route path="/customization-delivery/customization/documents/:docEntry" element={<RequireAuth allow={canAccessCustomization}><CustomizationDetailPage /></RequireAuth>} />
            <Route path="/customization-delivery/quotations/documents/:docEntry" element={<RequireAuth allow={canAccessCustomization}><CustomizationDetailPage /></RequireAuth>} />
            <Route path="/customization-delivery/delivery/documents/:docEntry" element={<RequireAuth allow={canAccessDelivery}><DeliveryDetailPage /></RequireAuth>} />
            <Route path="/customization-delivery/orders/documents/:docEntry" element={<RequireAuth allow={canAccessCustomization}><DeliveryDetailPage orderViewOnly /></RequireAuth>} />

            {/* Backward-compatibility redirects for old routes */}
            <Route path="/customization-delivery/customization" element={<Navigate to="/customization-delivery/quotations" replace />} />
            <Route path="/customization-delivery/delivery" element={<Navigate to="/customization-delivery/deliveries" replace />} />


            {/* User & Rule Management Routes */}
            <Route path="/users" element={<RequireAuth allow={canManageUsers}><UserManagementPage /></RequireAuth>} />
            <Route path="/users/activity-log" element={<RequireAuth allow={canManageUsers}><ActivityLogPage /></RequireAuth>} />
            <Route path="/create-user" element={<RequireAuth allow={canManageUsers}><CreateUserPage /></RequireAuth>} />
            <Route path="/order-rules" element={<RequireAuth allow={(u) => canAccessProductionRules(u) || canAccessTransferRules(u) || canManageQuality(u)}><Navigate to={rulesHomePath} replace /></RequireAuth>} />
            <Route path="/order-rules/production" element={<RequireAuth allow={canAccessProductionRules}><ProductionOrderRulesPage /></RequireAuth>} />
            <Route path="/order-rules/transfer" element={<RequireAuth allow={canAccessTransferRules}><TransferRulesPage /></RequireAuth>} />
            <Route path="/order-rules/quality" element={<RequireAuth allow={canManageQuality}><Navigate to="/order-rules/quality/criteria" replace /></RequireAuth>} />
            <Route path="/order-rules/quality/stages" element={<RequireAuth allow={canManageQuality}><InspectionStagesManagementPage /></RequireAuth>} />
            <Route path="/order-rules/quality/categories" element={<RequireAuth allow={canManageQuality}><QualityCategoriesManagementPage /></RequireAuth>} />
            <Route path="/order-rules/quality/criteria" element={<RequireAuth allow={canManageQuality}><QualityCriteriaManagementPage /></RequireAuth>} />
            <Route path="/order-rules/quality/item-criteria" element={<RequireAuth allow={canManageQuality}><ItemCriteriaMappingPage /></RequireAuth>} />

            {/* Scale Module Routes */}
            <Route path="/scale" element={<RequireAuth allow={canAccessScale}><ScaleLandingPage /></RequireAuth>} />
            <Route path="/scale/weighing" element={<RequireAuth allow={canAccessScale}><ScaleWeighingPage /></RequireAuth>} />
            <Route path="/scale/receipt" element={<RequireAuth allow={canAccessScale}><ScaleReceiptPage /></RequireAuth>} />
            <Route path="/scale/drafts" element={<RequireAuth allow={canAccessScale}><ScaleDraftsPage /></RequireAuth>} />
            <Route path="/scale/drafts/:draftId" element={<RequireAuth allow={canAccessScale}><ScaleDraftDetailPage /></RequireAuth>} />
            <Route path="/scale/devices" element={<RequireAuth allow={canManageScale}><ScaleDevicesPage /></RequireAuth>} />
            <Route path="/scale/item-elements" element={<RequireAuth allow={canManageScale}><ScaleItemElementsPage /></RequireAuth>} />
            <Route path="/scale/entry-exit-permits" element={<RequireAuth allow={canAccessScale}><ScaleEntryExitPermitsPage /></RequireAuth>} />
            <Route path="/scale/entry-exit-permits/entry" element={<RequireAuth allow={canAccessScale}><ScaleEntryPermitPage /></RequireAuth>} />
            <Route path="/scale/entry-exit-permits/exit" element={<RequireAuth allow={canAccessScale}><ScaleExitPermitPage /></RequireAuth>} />
          </Routes>
            </Suspense>
          </ErrorBoundary>
        </PageTransition>
      </main>

      <button
        type="button"
        className="theme-fab"
        onClick={onToggleTheme}
        title={theme === 'light' ? t('toolbar.switchToDark') : t('toolbar.switchToLight')}
      >
        {theme === 'light' ? '🌙' : '☀️'}
      </button>
    </div>
  );
}

function App() {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem('app-theme', theme);
  }, [theme]);

  return (
    <I18nProvider>
      <AuthProvider>
        <ToastProvider>
          <Router>
            <AppFrame
              theme={theme}
              onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            />
          </Router>
        </ToastProvider>
      </AuthProvider>
    </I18nProvider>
  );
}

export default App;
