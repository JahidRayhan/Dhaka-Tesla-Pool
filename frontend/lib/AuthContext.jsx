'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { api, setSession, clearSession } from './api';

const AuthContext = createContext(null);
const STORAGE_KEY = 'dtp_token';
const REFRESH_KEY = 'dtp_refresh';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  function persist({ accessToken, refreshToken }) {
    window.localStorage.setItem(STORAGE_KEY, accessToken);
    window.localStorage.setItem(REFRESH_KEY, refreshToken);
  }

  function forget() {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
    clearSession();
    setToken(null);
    setUser(null);
  }

  // The API helper refreshes tokens silently; keep storage and React state in step
  // with it, and sign out only if the refresh token itself is no longer valid.
  useEffect(() => {
    setSession({
      onChange: (tokens) => {
        persist(tokens);
        setToken(tokens.accessToken);
      },
      onExpired: forget,
    });
    const storedAccess = window.localStorage.getItem(STORAGE_KEY);
    const storedRefresh = window.localStorage.getItem(REFRESH_KEY);
    if (!storedAccess && !storedRefresh) {
      setLoading(false);
      return;
    }
    setSession({ accessToken: storedAccess, refreshToken: storedRefresh });
    api
      .me(storedAccess || '')
      .then((data) => {
        setToken(window.localStorage.getItem(STORAGE_KEY));
        setUser(data.user);
      })
      .catch(() => forget())
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applySession(data) {
    persist({ accessToken: data.accessToken || data.token, refreshToken: data.refreshToken });
    setSession({ accessToken: data.accessToken || data.token, refreshToken: data.refreshToken });
    setToken(data.accessToken || data.token);
    setUser(data.user);
  }

  async function login(email, password) {
    const data = await api.login({ email, password });
    applySession(data);
    return data.user;
  }

  async function signup(payload) {
    const data = await api.signup(payload);
    applySession(data);
    return data.user;
  }

  function logout() {
    const refreshToken = window.localStorage.getItem(REFRESH_KEY);
    if (refreshToken) api.logout(refreshToken).catch(() => {}); // revoke it server-side, best effort
    forget();
  }

  return (
    <AuthContext.Provider value={{ token, user, loading, login, signup, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
