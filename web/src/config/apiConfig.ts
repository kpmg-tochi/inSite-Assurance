import axios from 'axios';

declare module 'axios' {
  export interface InternalAxiosRequestConfig {
    /** The access token this request was sent with. */
    _authToken?: string;
    /** Set once the request has been retried after a token refresh. */
    _retry?: boolean;
  }
}

const DEV_URL =
  import.meta.env.VITE_API_DEV_URL || 'http://localhost:4000/api/v1';
const PROD_URL = import.meta.env.VITE_API_PROD_URL || '/api/v1';

export const BASE_URL = import.meta.env.DEV ? DEV_URL : PROD_URL;

export const TOKEN_STORAGE_KEY = 'accessToken';

// Global Axios instance
export const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// In-memory access token cache
let accessToken: string | null = null;

/**
 * Synchronizes the token across in-memory variable and localStorage.
 */
export const updateToken = (token: string | null) => {
  accessToken = token;
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    localStorage.setItem('lastTokenRefresh', String(Date.now()));
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem('lastTokenRefresh');
  }
};

export const getStoredToken = (): string | null => {
  if (!accessToken) {
    accessToken = localStorage.getItem(TOKEN_STORAGE_KEY);
  }
  return accessToken;
};

let onUnauthorizedCallback: (() => void) | null = null;

export const registerUnauthorizedHandler = (cb: () => void) => {
  onUnauthorizedCallback = cb;
};

// ---- Request interceptor ----
// Attaches the access token to all requests.
api.interceptors.request.use(async (config) => {
  if (!accessToken) {
    accessToken = localStorage.getItem(TOKEN_STORAGE_KEY);
  }

  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
    config._authToken = accessToken;
  }

  return config;
});

// ---- Response interceptor ----
// Extracts normalized error messages and clears session on 401.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status;
    const serverMessage =
      error.response?.data?.error?.message || error.response?.data?.message;

    if (status === 401) {
      updateToken(null);
      if (onUnauthorizedCallback) {
        onUnauthorizedCallback();
      }
    }

    if (serverMessage) {
      error.message = serverMessage;
    }

    return Promise.reject(error);
  }
);
