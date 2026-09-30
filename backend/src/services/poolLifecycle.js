const { logTransition } = require('./statusHistoryService');

/**
 * If a pool that hasn't left yet has no live members, cancel it.
 *
 * Without this, the last passenger cancelling leaves a MATCHED pool with zero
 * seats and nobody in it — and because a Tesla can only run one non-terminal
 * pool at a time, that empty pool blocks the driver from starting a new one.
 *
 * "Live" means any ride_request pointing at the pool that isn't CANCELLED
 * (a PENDING_CONFIRMATION joiner counts: they still hold a reserved seat and
 * may yet be promoted). Cancelled requests keep their pool_id, declined
 * joiners have it cleared, so this count is exact.
 *
 * Caller must be inside a transaction and should already hold the pool row
 * lock (see rideRequestService.cancel) so a concurrent accept can't slip a
 * new member in between the count and the cancel.
 */
async function cancelPoolIfEmpty(client, poolId, changedBy) {
  if (!poolId) return false;

  const { rows: live } = await client.query(
    `SELECT 1 FROM ride_requests WHERE pool_id = $1 AND status <> 'CANCELLED' LIMIT 1`,
    [poolId],
  );
  if (live.length > 0) return false;

  // Only a pool that hasn't departed can be emptied by passenger cancellation.
  const { rows } = await client.query(
    `UPDATE pools SET status = 'CANCELLED', cancelled_at = now(), seats_occupied = 0
     WHERE id = $1 AND status = 'MATCHED'
     RETURNING id`,
    [poolId],
  );
  if (rows.length === 0) return false;

  await logTransition(client, {
    entityType: 'pool',
    entityId: poolId,
    fromStatus: 'MATCHED',
    toStatus: 'CANCELLED',
    changedBy,
    note: 'last passenger cancelled; pool closed so the Tesla is free again',
  });
  return true;
}

module.exports = { cancelPoolIfEmpty };
