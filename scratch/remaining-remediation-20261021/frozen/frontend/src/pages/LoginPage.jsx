import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import egastLogo from '../assets/logos/egast-logo.png';
import sapLogo from '../assets/logos/sap-logo.png';
import meemLogo from '../assets/logos/meem-logo.png';

function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { loginUser } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await API.post('/login/', { username, password });
      if (res.data.success) {
        loginUser(res.data.data);
        navigate('/');
      } else {
        setError(res.data.error || t('login.loginFailed'));
      }
    } catch (err) {
      setError(err.response?.data?.error || t('login.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-shell">
      <section className="login-card">
        <div className="login-logo-img">
          <div className="logo-frame logo-frame--login">
            <img src={meemLogo} alt="Meem" className="app-logo app-logo--meem" />
          </div>
        </div>
        <p className="login-eyebrow">{t('login.subtitle')}</p>
        <h1 className="login-title">{t('login.title')}</h1>

        <form onSubmit={handleSubmit} className="form-stack">
          <div className="form-field">
            <label className="form-label">{t('login.username')}</label>
            <input
              className="app-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              autoComplete="username"
            />
          </div>

          <div className="form-field">
            <label className="form-label">{t('login.password')}</label>
            <input
              className="app-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="feedback-message feedback-message--error">{error}</div>
          )}

          <button
            type="submit"
            className="app-button app-button--primary app-button--block app-button--large"
            disabled={loading}
          >
            {loading ? t('login.signingIn') : t('login.signIn')}
          </button>
        </form>

        <div className="brand-strip">
          <div className="logo-frame logo-frame--partner">
            <img src={egastLogo} alt="Egast Group" className="app-logo app-logo--egast" />
          </div>
          <div className="logo-frame logo-frame--partner">
            <img src={sapLogo} alt="SAP" className="app-logo app-logo--sap" />
          </div>
        </div>
      </section>
    </div>
  );
}

export default LoginPage;
