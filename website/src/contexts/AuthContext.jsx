// src/contexts/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import { CognitoUserPool, CognitoUser, AuthenticationDetails, CognitoUserAttribute } from 'amazon-cognito-identity-js';
import { getConfig } from '../utils/config';
import { useTranslation } from 'react-i18next';

const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState({
    isAuthenticated: false,
    user: null,
    tokens: null,
    session: null
  });
  const [isLoading, setIsLoading] = useState(true);
  const [userPool, setUserPool] = useState(null);
  const { t } = useTranslation();

  useEffect(() => {
    const config = getConfig();
    const pool = new CognitoUserPool({
      UserPoolId: config.UserPoolId,
      ClientId: config.ClientId
    });
    setUserPool(pool);
    checkAuthentication(pool);
  }, []);

  useEffect(() => {
    if (auth.isAuthenticated && userPool) {
      const checkInterval = setInterval(() => {
        const cognitoUser = userPool.getCurrentUser();
        if (cognitoUser) {
          cognitoUser.getSession((err, session) => {
            if (err || !session.isValid()) {
              signOut();
            }
          });
        }
      }, 60000);

      return () => clearInterval(checkInterval);
    }
  }, [auth.isAuthenticated, userPool]);

  const checkAuthentication = async (pool) => {
    if (!pool) return;

    try {
      const cognitoUser = pool.getCurrentUser();
      if (cognitoUser) {
        cognitoUser.getSession((err, session) => {
          if (err) {
            console.error('Session error:', err);
            setAuth(prev => ({ ...prev, isAuthenticated: false }));
            setIsLoading(false);
            return;
          }

          if (session.isValid()) {
            setAuth({
              isAuthenticated: true,
              user: cognitoUser,
              session: session,
              tokens: {
                accessToken: session.getAccessToken().getJwtToken(),
                idToken: session.getIdToken().getJwtToken()
              }
            });
          } else {
            setAuth(prev => ({ ...prev, isAuthenticated: false }));
          }
        });
      }
    } catch (error) {
      console.error('Authentication check error:', error);
      setAuth(prev => ({ ...prev, isAuthenticated: false }));
    } finally {
      setIsLoading(false);
    }
  };

  const signIn = (email, password) => {
    if (!userPool) {
      return Promise.reject(new Error(t('error.messages.GENERIC')));
    }
    return new Promise((resolve, reject) => {
      const authenticationDetails = new AuthenticationDetails({
        Username: email,
        Password: password
      });

      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: userPool
      });

      cognitoUser.authenticateUser(authenticationDetails, {
        onSuccess: (session) => {
          setAuth({
            isAuthenticated: true,
            user: cognitoUser,
            session: session,
            tokens: {
              accessToken: session.getAccessToken().getJwtToken(),
              idToken: session.getIdToken().getJwtToken()
            }
          });
          resolve(session);
        },
        onFailure: (err) => {
          console.error('Authentication error:', err);
          reject(err);
        }
      });
    });
  };

  const signUp = (email, password, tenantId) => {
    if (!userPool) {
      return Promise.reject(new Error(t('error.messages.GENERIC')));
    }
    return new Promise((resolve, reject) => {
      const attributeList = [
        new CognitoUserAttribute({
          Name: 'email',
          Value: email
        }),
        new CognitoUserAttribute({
          Name: 'custom:tenantId',
          Value: tenantId
        })
      ];

      userPool.signUp(email, password, attributeList, null, (err, result) => {
        if (err) {
          console.error('Sign up error:', err);
          reject(err);
          return;
        }
        resolve(result);
      });
    });
  };

  const confirmSignUp = (email, code) => {
    if (!userPool) {
      return Promise.reject(new Error(t('error.messages.GENERIC')));
    }
    return new Promise((resolve, reject) => {
      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: userPool
      });

      cognitoUser.confirmRegistration(code, true, (err, result) => {
        if (err) {
          console.error('Confirmation error:', err);
          reject(err);
          return;
        }
        resolve(result);
      });
    });
  };

  const resendConfirmationCode = (email) => {
    if (!userPool) {
      return Promise.reject(new Error(t('error.messages.GENERIC')));
    }
    return new Promise((resolve, reject) => {
      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: userPool
      });

      cognitoUser.resendConfirmationCode((err, result) => {
        if (err) {
          console.error('Resend code error:', err);
          reject(err);
          return;
        }
        resolve(result);
      });
    });
  };

  const signOut = () => {
    const cognitoUser = userPool.getCurrentUser();
    if (cognitoUser) {
      cognitoUser.signOut();
      setAuth({
        isAuthenticated: false,
        user: null,
        tokens: null,
        session: null
      });
      // Ensure any tenant-related state is cleared
      localStorage.removeItem('tenantId');
    }
  };

  const forgotPassword = (email) => {
    if (!userPool) {
      return Promise.reject(new Error(t('error.messages.GENERIC')));
    }
    return new Promise((resolve, reject) => {
      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: userPool
      });

      cognitoUser.forgotPassword({
        onSuccess: (data) => {
          resolve(data);
        },
        onFailure: (err) => {
          console.error('Forgot password error:', err);
          reject(err);
        }
      });
    });
  };

  const confirmPassword = (email, code, newPassword) => {
    if (!userPool) {
      return Promise.reject(new Error(t('error.messages.GENERIC')));
    }
    return new Promise((resolve, reject) => {
      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: userPool
      });

      cognitoUser.confirmPassword(code, newPassword, {
        onSuccess: () => {
          resolve();
        },
        onFailure: (err) => {
          console.error('Confirm password error:', err);
          reject(err);
        }
      });
    });
  };

  // Helper method to get the current session's access token for API calls
  const getAccessToken = async () => {
    if (!userPool) {
      return Promise.reject(new Error(t('error.messages.GENERIC')));
    }
    return new Promise((resolve, reject) => {
      const cognitoUser = userPool.getCurrentUser();
      if (!cognitoUser) {
        reject(new Error(t('error.messages.LOGIN')));
        return;
      }

      cognitoUser.getSession((err, session) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(session.getAccessToken().getJwtToken());
      });
    });
  };

  const value = {
    ...auth,
    isLoading,
    signIn,
    signUp,
    signOut,
    confirmSignUp,
    resendConfirmationCode,
    forgotPassword,
    confirmPassword,
    getAccessToken,
    checkAuthentication
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
