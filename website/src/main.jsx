// src/main.jsx
import './polyfills';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';
import './styles/App.css';
import './i18n'; // Import i18n configuration

async function initApp() {
  try {
    // Wait for config to load
    await window.configLoaded;
    
    ReactDOM.createRoot(document.getElementById('root')).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (error) {
    console.error('Failed to load configuration:', error);
  }
}

initApp();
