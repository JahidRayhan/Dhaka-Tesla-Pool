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
