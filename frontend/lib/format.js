export function formatTaka(paisa) {
  if (paisa === null || paisa === undefined) return '—';
  const value = Number(paisa) / 100;
  return `৳${value.toFixed(2)}`;
}

export const STATUS_LABEL = {
  REQUESTED: 'Waiting for a driver',
  MATCHED: 'Matched',
  DRIVER_ARRIVED: 'Driver has arrived',
  STARTED: 'On the way',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const STATUS_TONE = {
  REQUESTED: 'amber',
  MATCHED: 'transit',
  DRIVER_ARRIVED: 'transit',
  STARTED: 'transit',
  COMPLETED: 'ink',
  CANCELLED: 'ink',
};
