const { pool } = require('../config/db');
const { ApiError } = require('../utils/ApiError');
const { haversineKm } = require('../utils/haversine');
const { logTransition } = require('./statusHistoryService');
const { commit } = require('../utils/tx');
const { retrying } = require('../utils/retryTx');
const { notifyAfterCommit } = require('./notificationService');
const { settleRidePayment } = require('./walletService');
const { LOCATION_STALE_MINUTES, ASSUMED_SPEED_KMH, NO_SHOW_WAIT_MINUTES, NO_SHOW_FEE_PAISA } = require('../config/tracking');

const LIVE_POOL = ['MATCHED', 'DRIVER_ARRIVED', 'STARTED'];
const isFresh = (at) => at && Date.now() - new Date(at).getTime() < LOCATION_STALE_MINUTES * 60_000;

// ---------------------------------------------------------------- location

/** The driver's app reports where the vehicle is while a pool is live. */
async function updateLocation(driverId, poolId, latitude, longitude) {
  const ok = (v, lim) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
  if (!ok(latitude, 90) || !ok(longitude, 180)) throw new ApiError(422, 'latitude and longitude must be valid coordinates');
  const { rows } = await pool.query('SELECT p.status, t.driver_id FROM pools p JOIN teslas t ON t.id = p.tesla_id WHERE p.id = $1', [poolId]);
  if (rows.length === 0) throw new ApiError(404, 'Pool not found');
  if (rows[0].driver_id !== driverId) throw new ApiError(403, "That pool isn't yours");
  if (!LIVE_POOL.includes(rows[0].status)) throw new ApiError(409, 'That pool is no longer running');
  await pool.query('UPDATE pools SET last_latitude = $2, last_longitude = $3, last_location_at = now() WHERE id = $1', [poolId, latitude, longitude]);
}

/**
 * Adds a `trip` object to each live ride: who is driving, in what, where the
 * vehicle is (only if its last report is recent) and an ETA to the pickup. The
 * ETA is straight-line distance at an assumed city speed — an honest estimate,
 * labelled as one by the clients, not routing.
 */
async function attachTrip(rides) {
  const live = rides.filter((r) => r.pool_id && LIVE_POOL.includes(r.status));
  if (live.length === 0) return rides.map((r) => ({ ...r, trip: null }));

  const { rows: pools } = await pool.query(
    `SELECT p.id, p.last_latitude, p.last_longitude, p.last_location_at, t.name AS tesla_name,
            u.name AS driver_name, dp.vehicle_plate, dp.status AS verification,
            (SELECT round(avg(stars)::numeric, 2) FROM ratings WHERE ratee_id = u.id) AS rating,
            (SELECT count(*)::int FROM ratings WHERE ratee_id = u.id) AS rating_count
     FROM pools p JOIN teslas t ON t.id = p.tesla_id JOIN users u ON u.id = t.driver_id
     LEFT JOIN driver_profiles dp ON dp.user_id = u.id
     WHERE p.id = ANY($1::uuid[])`,
    [[...new Set(live.map((r) => r.pool_id))]],
  );
  const { rows: pickups } = await pool.query(
    `SELECT rr.id, COALESCE(mp.latitude, z.latitude) AS lat, COALESCE(mp.longitude, z.longitude) AS lng
     FROM ride_requests rr JOIN zones z ON z.id = rr.pickup_zone_id LEFT JOIN meeting_points mp ON mp.id = rr.pickup_point_id
     WHERE rr.id = ANY($1::uuid[])`,
    [live.map((r) => r.id)],
  );
  const poolById = new Map(pools.map((p) => [p.id, p]));
  const pickupById = new Map(pickups.map((p) => [p.id, p]));

  return rides.map((r) => {
    const p = r.pool_id && LIVE_POOL.includes(r.status) ? poolById.get(r.pool_id) : null;
    if (!p) return { ...r, trip: null };
    const fresh = isFresh(p.last_location_at);
    const pickup = pickupById.get(r.id);
    const km = fresh && pickup ? haversineKm(p.last_latitude, p.last_longitude, pickup.lat, pickup.lng) : null;
    return {
      ...r,
      trip: {
        driverName: p.driver_name,
        teslaName: p.tesla_name,
        vehiclePlate: p.verification === 'VERIFIED' ? p.vehicle_plate : null,
        driverRating: { average: p.rating === null ? null : Number(p.rating), count: p.rating_count },
        location: fresh ? { latitude: p.last_latitude, longitude: p.last_longitude, updatedAt: p.last_location_at } : null,
        etaMinutes: r.status === 'MATCHED' && km !== null ? Math.max(1, Math.ceil((km / ASSUMED_SPEED_KMH) * 60)) : null,
      },
    };
  });
}

// ---------------------------------------------------------------- no-show

/**
 * The driver has arrived and waited; the passenger never came. Releases their
 * seat, charges a small no-show fee (wallet if they chose TeslaPay and can pay,
 * otherwise cash owed), and closes the pool if nobody is left.
 */
async function markNoShow(driverId, poolId, requestId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: peek } = await client.query('SELECT t.driver_id FROM pools p JOIN teslas t ON t.id = p.tesla_id WHERE p.id = $1', [poolId]);
    if (peek.length === 0) throw new ApiError(404, 'Pool not found');
    if (peek[0].driver_id !== driverId) throw new ApiError(403, "That pool isn't yours");

    // Same lock order as everywhere else: ride rows (by id), then the pool.
    await client.query(`SELECT id FROM ride_requests WHERE pool_id = $1 AND status IN ('PENDING_CONFIRMATION','MATCHED','DRIVER_ARRIVED','STARTED') ORDER BY id FOR UPDATE`, [poolId]);
    const { rows: [target] } = await client.query('SELECT * FROM pools WHERE id = $1 FOR UPDATE', [poolId]);
    if (target.status !== 'DRIVER_ARRIVED') throw new ApiError(409, 'You can only mark a no-show after arriving and before the trip starts');

    const { rows: [ride] } = await client.query('SELECT * FROM ride_requests WHERE id = $1 AND pool_id = $2', [requestId, poolId]);
    if (!ride) throw new ApiError(404, 'That passenger is not in this pool');
    if (ride.status !== 'DRIVER_ARRIVED') throw new ApiError(409, `That passenger's ride is '${ride.status}', not waiting for pickup`);

    const waitedMs = Date.now() - new Date(ride.driver_arrived_at).getTime();
    if (waitedMs < NO_SHOW_WAIT_MINUTES * 60_000) {
      const left = Math.ceil((NO_SHOW_WAIT_MINUTES * 60_000 - waitedMs) / 60_000);
      throw new ApiError(409, `Please wait ${left} more minute${left === 1 ? '' : 's'} before marking a no-show`);
    }

    await client.query(`UPDATE ride_requests SET status = 'CANCELLED', cancelled_at = now(), cancellation_reason = 'no-show' WHERE id = $1`, [requestId]);
    await client.query('UPDATE pools SET seats_occupied = seats_occupied - $2 WHERE id = $1', [poolId, ride.seats_requested]);

    let method = 'CASH';
    let status = 'PENDING';
    if (ride.payment_method === 'TESLAPAY' && (await settleRidePayment(client, { rideRequestId: requestId, passengerId: ride.passenger_id, driverId, amountPaisa: NO_SHOW_FEE_PAISA }))) {
      method = 'TESLAPAY';
      status = 'PAID';
    }
    await client.query(
      `INSERT INTO payments (ride_request_id, amount_paisa, method, status, paid_at, kind)
       VALUES ($1, $2, $3::payment_method, $4::payment_status, CASE WHEN $4::payment_status = 'PAID' THEN now() END, 'NO_SHOW_FEE')`,
      [requestId, NO_SHOW_FEE_PAISA, method, status],
    );
    await logTransition(client, { entityType: 'ride_request', entityId: requestId, fromStatus: 'DRIVER_ARRIVED', toStatus: 'CANCELLED', changedBy: driverId, note: `no-show after ${NO_SHOW_WAIT_MINUTES} minutes; fee charged` });

    const { rows: left } = await client.query(`SELECT 1 FROM ride_requests WHERE pool_id = $1 AND status IN ('PENDING_CONFIRMATION','MATCHED','DRIVER_ARRIVED') LIMIT 1`, [poolId]);
    if (left.length === 0) {
      await client.query(`UPDATE pools SET status = 'CANCELLED', cancelled_at = now(), seats_occupied = 0 WHERE id = $1`, [poolId]);
      await logTransition(client, { entityType: 'pool', entityId: poolId, fromStatus: 'DRIVER_ARRIVED', toStatus: 'CANCELLED', changedBy: driverId, note: 'the only passenger did not show up' });
    }
    notifyAfterCommit(client, [ride.passenger_id], 'NO_SHOW', { rideRequestId: requestId, feePaisa: NO_SHOW_FEE_PAISA });
    await commit(client);
    return { feePaisa: NO_SHOW_FEE_PAISA, feeSettledWith: method };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------- receipts & earnings

const RECEIPT_OK = (r) => r.status === 'COMPLETED' || (r.status === 'CANCELLED' && r.payment_kind === 'NO_SHOW_FEE');

async function receipt(rideId, user) {
  const { rows } = await pool.query(
    `SELECT rr.*, pz.name AS pickup_zone_name, dz.name AS destination_zone_name, mp.name AS pickup_point_name,
            pay.method AS paid_with, pay.status AS payment_status, pay.kind AS payment_kind, pay.amount_paisa AS payment_amount, pay.paid_at,
            t.name AS tesla_name, t.driver_id, du.name AS driver_name, dp.vehicle_plate, dp.status AS verification
     FROM ride_requests rr
     JOIN zones pz ON pz.id = rr.pickup_zone_id JOIN zones dz ON dz.id = rr.destination_zone_id
     LEFT JOIN meeting_points mp ON mp.id = rr.pickup_point_id
     LEFT JOIN payments pay ON pay.ride_request_id = rr.id
     LEFT JOIN pools p ON p.id = rr.pool_id LEFT JOIN teslas t ON t.id = p.tesla_id
     LEFT JOIN users du ON du.id = t.driver_id LEFT JOIN driver_profiles dp ON dp.user_id = du.id
     WHERE rr.id = $1`,
    [rideId],
  );
  const r = rows[0];
  if (!r) throw new ApiError(404, 'Ride not found');
  if (r.passenger_id !== user.id && r.driver_id !== user.id && user.role !== 'admin') throw new ApiError(403, "That isn't your ride");
  if (!RECEIPT_OK(r)) throw new ApiError(409, 'A receipt is available once the ride is completed');

  const nameById = new Map((await pool.query('SELECT id, name FROM zones WHERE id = ANY($1::int[])', [r.route_zone_ids || []])).rows.map((z) => [z.id, z.name]));
  const { rows: [{ n: coPassengers }] } = await pool.query(
    `SELECT count(*)::int AS n FROM ride_requests WHERE pool_id = $1 AND id <> $2 AND status = 'COMPLETED'`,
    [r.pool_id, r.id],
  );
  const isFee = r.payment_kind === 'NO_SHOW_FEE';
  return {
    receipt: {
      rideRequestId: r.id,
      kind: isFee ? 'NO_SHOW_FEE' : 'FARE',
      route: { pickup: r.pickup_zone_name, pickupPoint: r.pickup_point_name, destination: r.destination_zone_name, via: (r.route_zone_ids || []).map((id) => nameById.get(id)) },
      seats: r.seats_requested,
      sharedWith: coPassengers, // a count only: never names
      times: { requestedAt: r.requested_at, matchedAt: r.matched_at, driverArrivedAt: r.driver_arrived_at, startedAt: r.started_at, completedAt: r.completed_at, cancelledAt: r.cancelled_at },
      fare: isFee
        ? { noShowFeePaisa: Number(r.payment_amount), totalPaisa: Number(r.payment_amount) }
        : { basePaisa: Number(r.base_fare_paisa), distancePaisa: Number(r.distance_charge_paisa), poolDiscountPaisa: Number(r.pool_discount_paisa), totalPaisa: Number(r.final_fare_paisa) },
      payment: { method: r.paid_with, status: r.payment_status, paidAt: r.paid_at, requestedMethod: r.payment_method },
      driver: { name: r.driver_name, teslaName: r.tesla_name, vehiclePlate: r.verification === 'VERIFIED' ? r.vehicle_plate : null },
    },
  };
}

/** A driver's money for a date range (Dhaka days): what was paid to the wallet, and what is cash still to collect. */
/**
 * @param {string} driverId
 * @param {{ from?: string | Date, to?: string | Date }} [range]
 */
async function driverEarnings(driverId, { from, to } = {}) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 86_400_000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) throw new ApiError(422, 'from and to must be valid dates, from before to');
  if (end.getTime() - start.getTime() > 366 * 86_400_000) throw new ApiError(422, 'Choose a range of at most one year');

  const { rows } = await pool.query(
    `SELECT (COALESCE(rr.completed_at, rr.cancelled_at) AT TIME ZONE 'Asia/Dhaka')::date AS day,
            pay.kind, pay.method, pay.status, count(*)::int AS rides, sum(pay.amount_paisa)::bigint AS amount
     FROM payments pay
     JOIN ride_requests rr ON rr.id = pay.ride_request_id
     JOIN pools p ON p.id = rr.pool_id JOIN teslas t ON t.id = p.tesla_id
     WHERE t.driver_id = $1 AND COALESCE(rr.completed_at, rr.cancelled_at) >= $2 AND COALESCE(rr.completed_at, rr.cancelled_at) <= $3
     GROUP BY 1, 2, 3, 4 ORDER BY 1`,
    [driverId, start, end],
  );
  const totals = { ridesCompleted: 0, grossPaisa: 0, walletPaidPaisa: 0, cashToCollectPaisa: 0, noShowFeesPaisa: 0 };
  const days = new Map();
  for (const r of rows) {
    const amount = Number(r.amount);
    totals.grossPaisa += amount;
    if (r.kind === 'FARE') totals.ridesCompleted += r.rides;
    if (r.kind === 'NO_SHOW_FEE') totals.noShowFeesPaisa += amount;
    if (r.status === 'PAID') totals.walletPaidPaisa += amount;
    else totals.cashToCollectPaisa += amount;
    const key = r.day.toISOString().slice(0, 10);
    const d = days.get(key) || { day: key, rides: 0, grossPaisa: 0 };
    if (r.kind === 'FARE') d.rides += r.rides;
    d.grossPaisa += amount;
    days.set(key, d);
  }
  return { from: start.toISOString(), to: end.toISOString(), totals, byDay: [...days.values()] };
}

module.exports = retrying({ updateLocation, attachTrip, markNoShow, receipt, driverEarnings }, ['markNoShow']);
