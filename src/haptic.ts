import { getState } from './store.ts';

/** true on devices that can vibrate (Android browsers; iOS has no vibrate API) */
export const hapticSupported = typeof navigator !== 'undefined' && 'vibrate' in navigator;

/** short tick; ms is the length. Respects the Settings toggle. */
export function haptic(ms = 10): void {
  if (!hapticSupported || !getState().prefs.haptics) return;
  try {
    navigator.vibrate(ms);
  } catch {
    /* ignore */
  }
}

/** a double pulse, for a double tap */
export function hapticDouble(): void {
  if (!hapticSupported || !getState().prefs.haptics) return;
  try {
    navigator.vibrate([8, 40, 8]);
  } catch {
    /* ignore */
  }
}

/** ticks only when `key` changes to a non-null value, i.e. when entering a snap */
export function snapTicker(): (key: string | number | null) => void {
  let last: string | number | null = null;
  return (key) => {
    if (key !== null && key !== last) haptic(6);
    last = key;
  };
}
