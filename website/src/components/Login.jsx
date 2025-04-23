// src/components/Login.jsx
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import '../styles/Login.css';
import { useTranslation } from 'react-i18next';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantId, setTenantId] = useState(''); // Will be set from config
  const [tenants, setTenants] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('signin'); // signin, signup, confirm, forgot
  const [confirmationCode, setConfirmationCode] = useState('');
  const { signIn, signUp, forgotPassword, confirmPassword } = useAuth();
  const { t } = useTranslation();
  
  // Load tenants from config when component mounts
  useEffect(() => {
    if (window.config && window.config.Tenants && window.config.Tenants.length > 0) {
      setTenants(window.config.Tenants);
      setTenantId(window.config.Tenants[0].Id); // Set default to first tenant
    } else {
      // Throw an error if config is not available
      setError('Configuration error: Tenant information is not available. Please check your configuration.');
      console.error('Configuration error: window.config.Tenants is not properly defined');
    }
  }, []);

  const handleSignIn = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      await signIn(email, password);
    } catch (err) {
      setError(err.message || t('error.messages.LOGIN'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      await signUp(email, password, tenantId);
      setMode('confirm');
    } catch (err) {
      setError(err.message || t('error.messages.GENERIC'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      await forgotPassword(email);
      setMode('resetPassword');
    } catch (err) {
      setError(err.message || t('error.messages.GENERIC'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      await confirmPassword(email, confirmationCode, password);
      setMode('signin');
    } catch (err) {
      setError(err.message || t('error.messages.GENERIC'));
    } finally {
      setIsLoading(false);
    }
  };

  const renderSignIn = () => (
    <form onSubmit={handleSignIn} className="login-form">
      <h2>{t('auth.login.TITLE')}</h2>
      <div className="form-group">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('auth.login.USERNAME')}
          required
        />
      </div>
      <div className="form-group">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('auth.login.PASSWORD')}
          required
        />
      </div>
      <div className="form-actions">
        <button type="submit" disabled={isLoading}>
          {isLoading ? t('common.app.LOADING') : t('auth.login.SIGNIN')}
        </button>
      </div>
      <div className="form-links">
        <button
          type="button"
          className="link-button"
          onClick={() => setMode('signup')}
        >
          {t('auth.login.NEED_ACCOUNT')}
        </button>
        <button
          type="button"
          className="link-button"
          onClick={() => setMode('forgot')}
        >
          {t('auth.login.FORGOT_PASSWORD')}
        </button>
      </div>
    </form>
  );

  const renderSignUp = () => (
    <form onSubmit={handleSignUp} className="login-form">
      <h2>{t('auth.login.SIGNUP')}</h2>
      <div className="form-group">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('auth.login.USERNAME')}
          required
        />
      </div>
      <div className="form-group">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('auth.login.PASSWORD')}
          required
        />
      </div>
      <div className="form-group">
        <select
          id="tenant-select"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          required
        >
          {tenants.map(tenant => (
            <option key={tenant.Id} value={tenant.Id}>
              {tenant.Name}
            </option>
          ))}
        </select>
      </div>
      <div className="form-actions">
        <button type="submit" disabled={isLoading}>
          {isLoading ? t('common.app.LOADING') : t('common.app.CREATE')}
        </button>
      </div>
      <div className="form-links">
        <button
          type="button"
          className="link-button"
          onClick={() => setMode('signin')}
        >
          {t('auth.login.HAVE_ACCOUNT')}
        </button>
      </div>
    </form>
  );

  const renderConfirmation = () => (
    <div className="login-form">
      <h2>{t('auth.login.EMAIL_VERIFICATION')}</h2>
      <div className="verification-message">
        <p>{t('auth.login.VERIFICATION_SENT')} <strong>{email}</strong>.</p>
        <p>{t('auth.login.CHECK_EMAIL')}</p>
        <p>{t('auth.login.AFTER_VERIFICATION')}</p>
      </div>
      <div className="form-actions">
        <button 
          type="button" 
          className="primary-button"
          onClick={() => setMode('signin')}
        >
          {t('auth.login.RETURN_SIGNIN')}
        </button>
      </div>
    </div>
  );

  const renderForgotPassword = () => (
    <form onSubmit={handleForgotPassword} className="login-form">
      <h2>{t('auth.login.RESET_PASSWORD')}</h2>
      <div className="form-group">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('auth.login.USERNAME')}
          required
        />
      </div>
      <div className="form-actions">
        <button type="submit" disabled={isLoading}>
          {isLoading ? t('common.app.LOADING') : t('auth.login.SEND_RESET')}
        </button>
      </div>
      <div className="form-links">
        <button
          type="button"
          className="link-button"
          onClick={() => setMode('signin')}
        >
          {t('auth.login.BACK_SIGNIN')}
        </button>
      </div>
    </form>
  );

  const renderResetPassword = () => (
    <form onSubmit={handleResetPassword} className="login-form">
      <h2>{t('auth.login.RESET_PASSWORD')}</h2>
      <div className="form-group">
        <input
          type="text"
          value={confirmationCode}
          onChange={(e) => setConfirmationCode(e.target.value)}
          placeholder={t('auth.login.CONFIRMATION_CODE')}
          required
        />
      </div>
      <div className="form-group">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('auth.login.PASSWORD')}
          required
        />
      </div>
      <div className="form-actions">
        <button type="submit" disabled={isLoading}>
          {isLoading ? t('common.app.LOADING') : t('auth.login.RESET_PASSWORD')}
        </button>
      </div>
    </form>
  );

  return (
    <div className="login-container">
      {error && <div className="error-message">{error}</div>}
      {mode === 'signin' && renderSignIn()}
      {mode === 'signup' && renderSignUp()}
      {mode === 'confirm' && renderConfirmation()}
      {mode === 'forgot' && renderForgotPassword()}
      {mode === 'resetPassword' && renderResetPassword()}
    </div>
  );
}

export default Login;
