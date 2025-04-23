/**
 * This file is a compatibility layer between our new API client and the existing AuthContext.
 * It's not actually used since we're making the auth context globally available instead.
 */

// This function would normally get tokens from localStorage
export const getAuthTokens = () => {
  if (window.authInstance && window.authInstance.tokens) {
    return window.authInstance.tokens;
  }
  return null;
};

// This function would normally set tokens in localStorage
export const setAuthTokens = (tokens) => {
  // We don't need to do anything here since we're using the AuthContext
  console.log('setAuthTokens called, but not implemented');
};

// This function would normally clear tokens from localStorage
export const clearAuthTokens = () => {
  // We don't need to do anything here since we're using the AuthContext
  console.log('clearAuthTokens called, but not implemented');
};

// This function would normally check if user is authenticated
export const isAuthenticated = () => {
  return window.authInstance && window.authInstance.isAuthenticated;
};
