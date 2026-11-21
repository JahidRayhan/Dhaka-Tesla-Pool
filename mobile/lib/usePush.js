import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { api } from './api';

// Show a banner even while the app is open: "your driver has arrived" is useless
// if it is hidden whenever you are looking at the app.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/**
 * Asks for permission once signed in, and registers this phone for push so the
 * server can reach it (consent questions, driver arrived, ...). Push is a
 * bonus, never a requirement: the in-app inbox works without it, so every failure
 * here (simulator, denied permission, no EAS project id) is silently ignored.
 */
export function usePushRegistration(accessToken) {
  useEffect(() => {
    if (!accessToken || Platform.OS === 'web') return;
    (async () => {
      try {
        if (!Device.isDevice) return; // simulators cannot receive push
        let { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
        if (status !== 'granted') return;
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', { name: 'Ride updates', importance: Notifications.AndroidImportance.HIGH });
        }
        const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
        const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
        await api.registerPushToken(accessToken, data, Platform.OS);
      } catch {
        // push is optional
      }
    })();
  }, [accessToken]);
}
