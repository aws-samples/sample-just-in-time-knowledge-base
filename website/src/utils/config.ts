// src/utils/config.ts

// Define the Tenant interface
export interface Tenant {
  Name: string;
  Id: string;
}

// Define the Config interface
export interface Config {
  UserPoolId: string;
  IdentityPoolId: string;
  ClientId: string;
  Region: string;
  CognitoDomain: string;
  API: string;
  Tenants: Tenant[];
}

export function getConfig(): Config {
  if (!window.config) {
    throw new Error('Configuration not loaded. Ensure config.js is loaded before accessing config.');
  }
  return window.config;
}

// Type declaration
declare global {
  interface Window {
    config: Config;
    configLoaded: Promise<void>;
  }
}
  