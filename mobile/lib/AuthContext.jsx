import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { api, ApiRequestError, setSession, clearSession } from './api';

const KEY = 'dtp_token';
const REFRESH_KEY = 'dtp_refresh';

// The JWT goes in the OS keychain/keystore (SecureStore), never AsyncStorage.
// SecureStore has no web implementation, so the web build falls back to
// localStorage — that build is only for development previews.
const storage =
  Platform.OS === 'web'
    ? {
        get: async (k) => window.localStorage.getItem(k),
        set: async (k, v) => window.localStorage.setItem(k, v),
        del: async (k) => window.localStorage.removeItem(k),
      }
    : {
        get: (k) => SecureStore.getItemAsync(k),
        set: (k, v) => SecureStore.setItemAsync(k, v),
        del: (k) => SecureStore.deleteItemAsync(k),
      };

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const forget = useCallback(async () => {
    await Promise.all([storage.del(KEY), storage.del(REFRESH_KEY)]);
    clearSession();
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // The API helper refreshes tokens silently; keep the keychain and React state
    // in step with it, and sign out only if the refresh token itself is invalid.
    setSession({
      onChange: async ({ accessToken, refreshToken }) => {
        await storage.set(KEY, accessToken);
        await storage.set(REFRESH_KEY, refreshToken);
        if (!cancelled) setToken(accessToken);
      },
      onExpired: () => forget(),
    });
    (async () => {
      try {
        const [access, refresh] = await Promise.all([storage.get(KEY), storage.get(REFRESH_KEY)]);
        if (!access && !refresh) return;
        setSession({ accessToken: access, refreshToken: refresh });
        const data = await api.me(access || '');
        if (cancelled) return;
        setToken((await storage.get(KEY)) || access);
        setUser(data.user);
      } catch (err) {
        // A dead session is dropped; a network failure keeps the tokens, so being
        // offline at launch doesn't sign anyone out.
        if (err instanceof ApiRequestError && err.status === 401) await forget();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [forget]);

  const applySession = useCallback(async (data) => {
    const access = data.accessToken || data.token;
    await storage.set(KEY, access);
    await storage.set(REFRESH_KEY, data.refreshToken);
    setSession({ accessToken: access, refreshToken: data.refreshToken });
    setToken(access);
    setUser(data.user);
    return data.user;
  }, []);

  const login = useCallback(async (email, password) => applySession(await api.login({ email, password })), [applySession]);
  const signup = useCallback(async (payload) => applySession(await api.signup(payload)), [applySession]);

  const logout = useCallback(async () => {
    const refresh = await storage.get(REFRESH_KEY);
    if (refresh) api.logout(refresh).catch(() => {}); // revoke it server-side, best effort
    await forget();
  }, [forget]);

  const value = useMemo(() => ({ token, user, setUser, loading, login, signup, logout }), [token, user, loading, login, signup, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
