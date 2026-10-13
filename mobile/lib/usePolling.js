import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/**
 * Calls `fn` every `ms` while `enabled` and the app is in the foreground.
 * Pausing in the background saves battery and avoids waking a sleeping
 * free-tier server for nobody.
 */
export function usePolling(fn, ms, enabled) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return undefined;
    let id = setInterval(() => fnRef.current(), ms);

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (!id) {
          fnRef.current(); // catch up immediately on return to the foreground
          id = setInterval(() => fnRef.current(), ms);
        }
      } else if (id) {
        clearInterval(id);
        id = null;
      }
    });

    return () => {
      if (id) clearInterval(id);
      sub.remove();
    };
  }, [ms, enabled]);
}
