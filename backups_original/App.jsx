import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import meemLogo from './assets/logos/meem-logo.png';
import Home from './pages/Home';
import Production from './pages/Production';
import ReceiptWizard from './pages/ReceiptWizard';
import TransferPage from './modules/transfer/pages/TransferPage';
import LoginPage from './pages/LoginPage';
import CreateUserPage from './pages/CreateUserPage';
import UserManagementPage from './pages/UserManagementPage';
import ProductionOrderRulesPage from './pages/ProductionOrderRulesPage';
import TransferRulesPage from './pages/TransferRulesPage';
import ReceiptReviewPage from './pages/ReceiptReviewPage';
import TransferReviewPage from './pages/TransferReviewPage';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { I18nProvider, useI18n } from './contexts/I18nContext';
import { ToastProvider } from './components/ui/ToastProvider';
import API from './services/api';
import {
  canAccessProduction,
  canAccessProductionRules,
  canAccessReceiptReview,
  canAccessTransfer,
  canAccessTransferRules,
  canAccessTransferReview,
  canManageUsers,
} from './utils/roles';

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

  const breadcrumbsByPath = {
    '/':              [{ labelKey: 'nav.home',          path: null }],
    '/production':    [{ labelKey: 'nav.home',          path: '/' }, { labelKey: 'nav.production',     path: null }],
    '/transfer':      [{ labelKey: 'nav.home',          path: '/' }, { labelKey: 'nav.transfer',       path: null }],
    '/receipt':       [{ labelKey: 'nav.home',          path: '/' }, { labelKey: 'nav.production',     path: '/production' }, { labelKey: 'nav.receiptWizard', path: null }],
    '/create-user':   [{ labelKey: 'nav.home',          path: '/' }, { labelKey: 'nav.usersPage',      path: '/users' },       { labelKey: 'nav.createUser',    path: null }],
    '/users':         [{ labelKey: 'nav.home',          path: '/' }, { labelKey: 'nav.usersPage',      path: null }],
    '/order-rules':   [{ labelKey: 'nav.home',          path: '/' }, { labelKey: 'nav.attributeRules', path: null }],
    '/order-rules/production': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.attributeRules', path: '/order-rules' }, { labelKey: 'nav.productionRules', path: null }],
    '/order-rules/transfer': [{ labelKey: 'nav.home', path: '/' }, { labelKey: 'nav.attributeRules', path: '/order-rules' }, { labelKey: 'nav.transferRules', path: null }],
    '/receipt-review':[{ labelKey: 'nav.home',          path: '/' }, { labelKey: 'nav.receiptReview',  path: null }],
    '/transfer-review':[{ labelKey: 'nav.home',         path: '/' }, { labelKey: 'nav.transferReview', path: null }],
    '/review':        [{ labelKey: 'nav.home',          path: '/' }, { labelKey: 'nav.receiptReview',  path: null }],
  };

  const crumbs = breadcrumbsByPath[location.pathname] || [{ labelKey: 'nav.page', path: null }];
  const showReviewMenu = user && canAccessReceiptReview(user) && canAccessTransferReview(user);
  const showRulesMenu = user && canAccessProductionRules(user) && canAccessTransferRules(user);
  const rulesHomePath = canAccessProductionRules(user) ? '/order-rules/production' : '/order-rules/transfer';

  const handleLogout = async () => {
    try { await API.post('/logout/'); } catch { /* ignore */ }
    logoutUser();
    navigate('/login');
  };

  const toggleTouchMenu = (event, menu) => {
    if (event.pointerType === 'mouse') return;
    event.preventDefault();
    setOpenMenu((current) => (current === menu ? null : menu));
  };

  return (
    <div className="app-shell">
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

          <div className="app-toolbar__actions">
            {showReviewMenu && (
              <div
                className={`toolbar-review-menu toolbar-review-menu--review ${openMenu === 'review' ? 'toolbar-review-menu--open' : ''}`}
                onMouseEnter={() => setOpenMenu('review')}
                onMouseLeave={() => setOpenMenu(null)}
              >
                <button
                  type="button"
                  className="app-button app-button--secondary toolbar-nav-btn"
                  aria-expanded={openMenu === 'review'}
                  onPointerDown={(event) => toggleTouchMenu(event, 'review')}
                >
                  {t('toolbar.review')}
                </button>
                <div className="toolbar-review-menu__list">
                  <Link to="/receipt-review" className="toolbar-review-menu__item" onClick={() => setOpenMenu(null)}>
                    {t('nav.receiptReview')}
                  </Link>
                  <Link to="/transfer-review" className="toolbar-review-menu__item" onClick={() => setOpenMenu(null)}>
                    {t('nav.transferReview')}
                  </Link>
                </div>
              </div>
            )}
            {user && canAccessReceiptReview(user) && !showReviewMenu && (
              <Link to="/receipt-review" className="app-button app-button--secondary toolbar-nav-btn">
                {t('toolbar.review')}
              </Link>
            )}
            {user && canAccessTransferReview(user) && !showReviewMenu && (
              <Link to="/transfer-review" className="app-button app-button--secondary toolbar-nav-btn">
                {t('toolbar.review')}
              </Link>
            )}
            {user && (
              <>
                {showRulesMenu && (
                  <div
                    className={`toolbar-review-menu ${openMenu === 'rules' ? 'toolbar-review-menu--open' : ''}`}
                    onMouseEnter={() => setOpenMenu('rules')}
                    onMouseLeave={() => setOpenMenu(null)}
                  >
                    <button
                      type="button"
                      className="app-button app-button--secondary toolbar-nav-btn"
                      aria-expanded={openMenu === 'rules'}
                      onPointerDown={(event) => toggleTouchMenu(event, 'rules')}
                    >
                      {t('toolbar.rules')}
                    </button>
                    <div className="toolbar-review-menu__list">
                      <Link to="/order-rules/production" className="toolbar-review-menu__item" onClick={() => setOpenMenu(null)}>
                        {t('nav.productionRules')}
                      </Link>
                      <Link to="/order-rules/transfer" className="toolbar-review-menu__item" onClick={() => setOpenMenu(null)}>
                        {t('nav.transferRules')}
                      </Link>
                    </div>
                  </div>
                )}
                {canAccessProductionRules(user) && !showRulesMenu && (
                  <Link to="/order-rules/production" className="app-button app-button--secondary toolbar-nav-btn">
                    {t('toolbar.rules')}
                  </Link>
                )}
                {canAccessTransferRules(user) && !showRulesMenu && (
                  <Link to="/order-rules/transfer" className="app-button app-button--secondary toolbar-nav-btn">
                    {t('toolbar.rules')}
                  </Link>
                )}
                {canManageUsers(user) && (
                  <Link to="/users" className="app-button app-button--secondary toolbar-nav-btn">
                    {t('toolbar.users')}
                  </Link>
                )}
              </>
            )}
            {user && (
              <span className="user-badge">
                <span className="user-badge__name">{user.username}</span>
                {user.warehouse && (
                  <span className="user-badge__warehouse">🏭 {user.warehouse}</span>
                )}
              </span>
            )}
            <LangToggle />
            {user && (
              <button type="button" className="app-button app-button--secondary toolbar-nav-btn toolbar-signout"
                onClick={handleLogout}>
                {t('toolbar.signOut')}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="app-content">
        <PageTransition>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
            <Route path="/production" element={<RequireAuth allow={canAccessProduction}><Production /></RequireAuth>} />
            <Route path="/transfer" element={<RequireAuth allow={canAccessTransfer}><TransferPage /></RequireAuth>} />
            <Route path="/receipt" element={<RequireAuth allow={canAccessProduction}><ReceiptWizard /></RequireAuth>} />
            <Route path="/users" element={<RequireAuth allow={canManageUsers}><UserManagementPage /></RequireAuth>} />
            <Route path="/create-user" element={<RequireAuth allow={canManageUsers}><CreateUserPage /></RequireAuth>} />
            <Route path="/order-rules" element={<RequireAuth allow={(u) => canAccessProductionRules(u) || canAccessTransferRules(u)}><Navigate to={rulesHomePath} replace /></RequireAuth>} />
            <Route path="/order-rules/production" element={<RequireAuth allow={canAccessProductionRules}><ProductionOrderRulesPage /></RequireAuth>} />
            <Route path="/order-rules/transfer" element={<RequireAuth allow={canAccessTransferRules}><TransferRulesPage /></RequireAuth>} />
            <Route path="/receipt-review" element={<RequireAuth allow={canAccessReceiptReview}><ReceiptReviewPage /></RequireAuth>} />
            <Route path="/transfer-review" element={<RequireAuth allow={canAccessTransferReview}><TransferReviewPage /></RequireAuth>} />
            <Route path="/review" element={<RequireAuth allow={canAccessReceiptReview}><ReceiptReviewPage /></RequireAuth>} />
          </Routes>
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
