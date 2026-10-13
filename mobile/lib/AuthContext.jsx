import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { api, ApiRequestError } from './api';

const KEY = 'dtp_token';

// The JWT goes in the OS keychain/keystore (SecureStore), never AsyncStorage.
// SecureStore has no web implementation, so the web build falls back to
// localStorage — that build is only for development previews.
const storage =
  Platform.OS === 'web'
    ? {
        get: async () => window.localStorage.getItem(KEY),
        set: async (v) => window.localStorage.setItem(KEY, v),
        del: async () => window.localStorage.removeItem(KEY),
      }
    : {
        get: () => SecureStore.getItemAsync(KEY),
        set: (v) => SecureStore.setItemAsync(KEY, v),
        del: () => SecureStore.deleteItemAsync(KEY),
      };

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await storage.get();
        if (!stored) return;
        const data = await api.me(stored);
        if (cancelled) return;
        setToken(stored);
        setUser(data.user);
      } catch (err) {
        // An expired/invalid token is dropped; a network failure keeps it, so
        // being offline at launch doesn't sign anyone out.
        if (err instanceof ApiRequestError && err.status === 401) await storage.del();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applySession = useCallback(async (data) => {
    await storage.set(data.token);
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const login = useCallback(async (email, password) => applySession(await api.login({ email, password })), [applySession]);
  const signup = useCallback(async (payload) => applySession(await api.signup(payload)), [applySession]);

  const logout = useCallback(async () => {
    await storage.del();
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ token, user, loading, login, signup, logout }), [token, user, loading, login, signup, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
