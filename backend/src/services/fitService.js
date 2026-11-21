const { pool } = require('../config/db');
const { ApiError } = require('../utils/ApiError');
const { loadGraph, evaluatePoolFit } = require('./routeService');

/**
 * For a driver looking at the open board while they already have a live pool:
 * says, for each open request, whether it could join THAT pool and, if not, why —
 * so the driver is not left tapping "Add to pool" just to be told no. Each
 * request gets  fit: { fits, reason, detourPercent }  and the page is ordered
 * with the ones that fit first (otherwise keeping the board's own order).
 * reason is one of: SEATS | WOMEN_ONLY | ROUTE | POOL_BUSY | null
 */
async function annotateFit(driverId, poolId, requests) {
  const { rows: [target] } = await pool.query(
    `SELECT p.id, p.status, p.seats_occupied, t.capacity, t.driver_id FROM pools p JOIN teslas t ON t.id = p.tesla_id WHERE p.id = $1`,
    [poolId],
  );
  if (!target) throw new ApiError(404, 'Pool not found');
  if (target.driver_id !== driverId) throw new ApiError(403, "That pool isn't yours");

  const { rows: members } = await pool.query(
    `SELECT rr.id, rr.status, rr.route_zone_ids, rr.women_only, u.gender
     FROM ride_requests rr JOIN users u ON u.id = rr.passenger_id
     WHERE rr.pool_id = $1 AND rr.status <> 'CANCELLED'`,
    [poolId],
  );
  const graph = await loadGraph();
  const free = target.capacity - target.seats_occupied;
  const poolIsWomenOnly = members.some((m) => m.women_only);
  const busy = target.status !== 'MATCHED' || members.some((m) => m.status === 'PENDING_CONFIRMATION');

  const annotated = requests.map((r) => {
    let fit;
    if (busy) fit = { fits: false, reason: 'POOL_BUSY', detourPercent: null };
    else if (r.seats_requested > free) fit = { fits: false, reason: 'SEATS', detourPercent: null };
    else if ((r.women_only && members.some((m) => m.gender !== 'female')) || (poolIsWomenOnly && r.passenger_gender !== 'female')) fit = { fits: false, reason: 'WOMEN_ONLY', detourPercent: null };
    else {
      const result = evaluatePoolFit(graph, members.map((m) => m.route_zone_ids), r.route_zone_ids);
      fit = { fits: result.fits, reason: result.fits ? null : 'ROUTE', detourPercent: result.maxDetourPercent };
    }
    return { ...r, fit };
  });
  // Stable: fitting requests first, original order within each group.
  return [...annotated.filter((r) => r.fit.fits), ...annotated.filter((r) => !r.fit.fits)];
}

module.exports = { annotateFit };
