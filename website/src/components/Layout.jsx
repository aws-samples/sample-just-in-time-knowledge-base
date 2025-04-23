import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import '../styles/Layout.css';
import { useTranslation } from 'react-i18next';

function Layout({ children }) {
  const { tokens, isAuthenticated, signOut } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [tenantId, setTenantId] = useState('');

  useEffect(() => {
    if (!isAuthenticated && tokens) {
      // Session expired
      signOut();
      navigate('/login', {
        state: { message: t('common.app.SESSION_EXPIRE') }
      });
    }

    // Extract tenant ID from tokens if available
    if (tokens && tokens.idToken) {
      try {
        const payload = JSON.parse(atob(tokens.idToken.split('.')[1]));
        if (payload['custom:tenantId']) {
          setTenantId(payload['custom:tenantId']);
        }
      } catch (error) {
        console.error('Error parsing token:', error);
      }
    }
  }, [isAuthenticated, tokens, t, navigate, signOut]);

  const handleLogout = async () => {
    await signOut();
    setTenantId(''); // Clear tenant ID on logout
    navigate('/login');
  };

  return (
    <div className="layout">
      <header className="header">
        <div className="logo">
          <h1 className="LogoHeader"> {t('common.app.TITLE')} {tenantId && `- ${tenantId}`}</h1>
        </div>
        {tokens && (
          <button className="btn-primary" onClick={handleLogout}>
            {t('common.app.LOGOUT')}
          </button>
        )}
      </header>
      <main className="main-content">
        {children}
      </main>
      <footer className="footer">
        <p>{t('common.app.WELCOME_SAMPLE')}</p>
      </footer>
    </div>
  );
}

export default Layout;
