import * as Location from 'expo-location';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { api } from './api';

/**
 * While `enabled` and a pool is live, send the driver's position to the server
 * every ~15 seconds (or 50 m), so passengers see the vehicle and an ETA. Only
 * runs in the foreground, and only while this hook is mounted with a live pool.
 */
export function useLocationSharing({ enabled, poolId, token, onDenied }) {
  const deniedRef = useRef(onDenied);
  deniedRef.current = onDenied;

  useEffect(() => {
    if (!enabled || !poolId || Platform.OS === 'web') return undefined;
    let subscription = null;
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          deniedRef.current?.();
          return;
        }
        const sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 15000, distanceInterval: 50 },
          (pos) => {
            api.sendLocation(token, poolId, pos.coords.latitude, pos.coords.longitude).catch(() => {});
          },
        );
        if (cancelled) sub.remove();
        else subscription = sub;
      } catch {
        // no GPS: the server simply has no recent position, and arrival is not blocked
      }
    })();
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [enabled, poolId, token]);
}
