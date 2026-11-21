import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// One tiny key-value store: the OS keychain/keystore on phones, localStorage in the
// web preview (SecureStore has no web implementation).
export const storage =
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
