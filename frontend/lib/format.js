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

// 20% is duplicated here from backend/src/services/fareService.js
// (POOL_DISCOUNT_RATE) rather than fetched from an endpoint — a small,
// documented coupling that's fine for an MVP's one display string, but
// would drift silently if the backend rate ever changed without updating
// this too. Worth a shared-constants endpoint if that becomes a real risk.
export const POOL_DISCOUNT_DISPLAY_PERCENT = 20;

// "about 3 min left" for a sharing proposal that times out; null when there is
// no deadline. Rounds up so "0 min left" is never shown while time remains.
export function timeLeftLabel(expiresAt, now = Date.now()) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return 'expiring now';
  const minutes = Math.ceil(ms / 60000);
  return `${minutes} min left`;
}

// Where a signed-in person lands: operators on the console, drivers on the board, everyone else on rides.
export function homeFor(user) {
  if (user.role === 'admin') return '/admin';
  return user.role === 'driver' ? '/driver' : '/passenger';
}
