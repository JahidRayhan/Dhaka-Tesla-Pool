export function formatTaka(paisa) {
  if (paisa === null || paisa === undefined) return '—';
  const value = Number(paisa) / 100;
  return `৳${value.toFixed(2)}`;
}

export const STATUS_LABEL = {
  REQUESTED: 'Waiting for a driver',
  PENDING_CONFIRMATION: 'Confirm sharing your ride',
  MATCHED: 'Matched',
  DRIVER_ARRIVED: 'Driver has arrived',
  STARTED: 'On the way',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const STATUS_TONE = {
  REQUESTED: 'amber',
  PENDING_CONFIRMATION: 'amber',
  MATCHED: 'transit',
  DRIVER_ARRIVED: 'transit',
  STARTED: 'transit',
  COMPLETED: 'ink',
  CANCELLED: 'ink',
};

// Copied from the web app / backend fare rule (POOL_DISCOUNT_RATE) for the one
// "up to 20% off" display string.
export const POOL_DISCOUNT_DISPLAY_PERCENT = 20;

// "3 min left" for a sharing proposal that times out; null when there is no
// deadline. Rounds up so "0 min left" never shows while time remains.
export function timeLeftLabel(expiresAt, now = Date.now()) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return 'expiring now';
  return `${Math.ceil(ms / 60000)} min left`;
}

export const joinNames = (names) => names.join(', ');
