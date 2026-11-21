const { pool } = require('../config/db');
const { commit } = require('../utils/tx');
const { retrying } = require('../utils/retryTx');
const { ApiError } = require('../utils/ApiError');
const { computeBaseAndDistance } = require('./fareService');
const { shortestPath } = require('./routeService');
const consentService = require('./consentService');
const { balanceFor } = require('./walletService');
const { notifyAfterCommit } = require('./notificationService');
const tripService = require('./tripService');
const ratingService = require('./ratingService');
const { DEFAULT_MAX_WAIT_MINUTES, SCHEDULED_GRACE_MINUTES, MIN_SCHEDULE_AHEAD_MINUTES, MAX_SCHEDULE_AHEAD_DAYS, SCHEDULE_VISIBLE_LEAD_MINUTES } = require('../config/tracking');
const { logTransition } = require('./statusHistoryService');
const { cancelPoolIfEmpty } = require('./poolLifecycle');

// Matches the largest Tesla capacity a driver can register (teslaController: 1-6).
// A bigger request could never be seated anywhere.
const MAX_SEATS_PER_REQUEST = 6;

async function getZoneOrThrow(client, zoneId, label) {
  const { rows } = await client.query('SELECT * FROM zones WHERE id = $1', [zoneId]);
  if (rows.length === 0) throw new ApiError(422, `${label} zone does not exist`);
  return rows[0];
}

const PAYMENT_METHODS = ['CASH', 'TESLAPAY'];

const isIntegerInRange = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/**
 * @typedef {object} RideRequestInput
 * @property {number} pickupZoneId
 * @property {number} destinationZoneId
 * @property {number} [seatsRequested]
 * @property {string} [paymentMethod]   CASH | TESLAPAY
 * @property {number | null} [shareMax]  pre-approve sharing with up to N people in total
 * @property {boolean} [womenOnly]
 * @property {number | null} [pickupPointId]
 * @property {string | Date | null} [scheduledFor]
 * @property {number | null} [maxWaitMinutes]
 *
 * @param {string} passengerId
 * @param {RideRequestInput} input
 * @param {{ allowSoon?: boolean }} [internal] `allowSoon` is set by the recurring-ride
 *        job, which books rides that may be only minutes away; ordinary requests must
 *        be scheduled at least MIN_SCHEDULE_AHEAD_MINUTES ahead.
 */
async function createRequest(passengerId, input, { allowSoon = false } = {}) {
  const {
    pickupZoneId,
    destinationZoneId,
    seatsRequested = 1,
    paymentMethod = 'CASH',
    shareMax = null,
    womenOnly = false,
    pickupPointId = null,
    scheduledFor = null,
    maxWaitMinutes = null,
  } = input;
  if (pickupZoneId === destinationZoneId) {
    throw new ApiError(422, 'Pickup and destination zone must differ');
  }
  if (!Number.isInteger(seatsRequested) || seatsRequested < 1) {
    throw new ApiError(422, 'seatsRequested must be a positive integer');
  }
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    throw new ApiError(422, `paymentMethod must be one of ${PAYMENT_METHODS.join(', ')}`);
  }
  if (seatsRequested > MAX_SEATS_PER_REQUEST) {
    throw new ApiError(422, `seatsRequested cannot exceed ${MAX_SEATS_PER_REQUEST}`);
  }
  if (shareMax !== null && shareMax !== undefined && !isIntegerInRange(shareMax, 2, 6)) {
    throw new ApiError(422, 'shareMax must be a whole number from 2 to 6 (or omitted to be asked each time)');
  }
  if (typeof womenOnly !== 'boolean') {
    throw new ApiError(422, 'womenOnly must be true or false');
  }
  if (pickupPointId !== null && pickupPointId !== undefined && !Number.isInteger(pickupPointId)) {
    throw new ApiError(422, 'pickupPointId must be a whole number');
  }
  if (maxWaitMinutes !== null && maxWaitMinutes !== undefined && !isIntegerInRange(maxWaitMinutes, 5, 240)) {
    throw new ApiError(422, 'maxWaitMinutes must be a whole number from 5 to 240');
  }
  let scheduledDate = null;
  if (scheduledFor !== null && scheduledFor !== undefined) {
    scheduledDate = typeof scheduledFor === 'string' || scheduledFor instanceof Date ? new Date(scheduledFor) : new Date(NaN);
    const now = Date.now();
    const earliest = now + (allowSoon ? -60_000 : MIN_SCHEDULE_AHEAD_MINUTES * 60_000);
    if (Number.isNaN(scheduledDate.getTime())) throw new ApiError(422, 'scheduledFor must be a valid date and time');
    if (scheduledDate.getTime() < earliest) throw new ApiError(422, `A scheduled ride must be at least ${MIN_SCHEDULE_AHEAD_MINUTES} minutes from now`);
    if (scheduledDate.getTime() > now + MAX_SCHEDULE_AHEAD_DAYS * 86_400_000) throw new ApiError(422, `A ride can be scheduled at most ${MAX_SCHEDULE_AHEAD_DAYS} days ahead`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await getZoneOrThrow(client, pickupZoneId, 'Pickup');
    await getZoneOrThrow(client, destinationZoneId, 'Destination');

    if (womenOnly) {
      const { rows: [u] } = await client.query('SELECT gender FROM users WHERE id = $1', [passengerId]);
      if (u?.gender !== 'female') {
        throw new ApiError(422, 'Women-only rides are for passengers who have set their gender to female in their profile');
      }
    }
    if (pickupPointId !== null && pickupPointId !== undefined) {
      const { rows: points } = await client.query('SELECT zone_id FROM meeting_points WHERE id = $1', [pickupPointId]);
      if (points.length === 0 || points[0].zone_id !== pickupZoneId) {
        throw new ApiError(422, 'That meeting point is not in the pickup zone');
      }
    }

    // The trip's real path across the zone graph — not a single straight-line
    // hop. Its distance drives the fare, and the path itself is stored so the
    // pooling rule can later check whether it merges with other requests'
    // paths into one non-branching vehicle route.
    const route = await shortestPath(pickupZoneId, destinationZoneId, client);
    if (!route) {
      throw new ApiError(422, 'No route exists between those two zones');
    }

    const { baseFarePaisa, distanceChargePaisa } = computeBaseAndDistance(route.distanceKm, seatsRequested);

    // Choosing TeslaPay means the wallet should be able to cover the full
    // undiscounted fare now; pooling can only make it cheaper. (The balance is
    // checked again, atomically, when the trip completes.)
    if (paymentMethod === 'TESLAPAY') {
      const balance = await balanceFor(client, passengerId);
      const estimate = baseFarePaisa + distanceChargePaisa;
      if (balance < estimate) {
        throw new ApiError(
          422,
          `Not enough TeslaPay balance: this ride costs up to ৳${(estimate / 100).toFixed(2)} but your wallet has ৳${(balance / 100).toFixed(2)}`,
        );
      }
    }

    // Nobody should wait forever on a board: an unmatched request lapses after
    // the passenger's chosen wait (default 60 min; for a scheduled ride it counts
    // from the scheduled time).
    const waitMinutes = maxWaitMinutes ?? (scheduledDate ? SCHEDULED_GRACE_MINUTES : DEFAULT_MAX_WAIT_MINUTES);
    const expiresAt = new Date((scheduledDate ? scheduledDate.getTime() : Date.now()) + waitMinutes * 60_000);

    const { rows } = await client.query(
      `INSERT INTO ride_requests
         (passenger_id, pickup_zone_id, destination_zone_id, seats_requested,
          status, base_fare_paisa, distance_charge_paisa, pool_discount_paisa, route_zone_ids,
          payment_method, share_max, women_only, pickup_point_id, scheduled_for, max_wait_minutes, expires_at)
       VALUES ($1, $2, $3, $4, 'REQUESTED', $5, $6, 0, $7::integer[], $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        passengerId, pickupZoneId, destinationZoneId, seatsRequested, baseFarePaisa, distanceChargePaisa, route.zoneIds,
        paymentMethod, shareMax ?? null, womenOnly, pickupPointId ?? null, scheduledDate, maxWaitMinutes ?? null, expiresAt,
      ],
    );
    const rideRequest = rows[0];

    await logTransition(client, {
      entityType: 'ride_request',
      entityId: rideRequest.id,
      fromStatus: null,
      toStatus: 'REQUESTED',
      changedBy: passengerId,
      note: scheduledDate ? `scheduled for ${scheduledDate.toISOString()}` : null,
    });

    await commit(client);
    // final_fare_paisa here is base+distance only (pool_discount_paisa=0) —
    // an ESTIMATE. The real discount, if any, is only finalized when the
    // pool starts (see poolService.startTrip).
    return rideRequest;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cancels requests nobody picked up in time (their "I can wait up to N minutes"
 * ran out). Safe to run from anywhere, any number of times, on several
 * instances at once: each request is claimed with SKIP LOCKED.
 * @returns {Promise<number>} how many were cancelled
 */
async function expireUnmatchedRequests() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, passenger_id, COALESCE(max_wait_minutes, $1) AS wait_minutes FROM ride_requests
       WHERE status = 'REQUESTED' AND expires_at IS NOT NULL AND expires_at <= now()
       ORDER BY expires_at LIMIT 200 FOR UPDATE SKIP LOCKED`,
      [DEFAULT_MAX_WAIT_MINUTES],
    );
    for (const r of rows) {
      await client.query(`UPDATE ride_requests SET status = 'CANCELLED', cancelled_at = now(), cancellation_reason = 'no pool found in time' WHERE id = $1`, [r.id]);
      await logTransition(client, { entityType: 'ride_request', entityId: r.id, fromStatus: 'REQUESTED', toStatus: 'CANCELLED', changedBy: null, note: `no pool found within ${r.wait_minutes} minutes` });
      notifyAfterCommit(client, [r.passenger_id], 'REQUEST_EXPIRED', { rideRequestId: r.id, minutes: Number(r.wait_minutes) });
    }
    await commit(client);
    return rows.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Attaches a `poolmates` array (name + destination only — never fares,
 * which are each passenger's own private data) to each ride_request that
 * has a pool_id, so a passenger can see who they're sharing a ride with.
 * One batched query for however many rows are passed in, not N+1.
 */
async function attachPoolmates(rows) {
  const poolIds = [...new Set(rows.filter((r) => r.pool_id).map((r) => r.pool_id))];
  if (poolIds.length === 0) {
    return rows.map((r) => ({ ...r, poolmates: [] }));
  }

  const { rows: mates } = await pool.query(
    `SELECT rr.pool_id, rr.id, u.name AS passenger_name, dz.name AS destination_zone_name
     FROM ride_requests rr
     JOIN users u ON u.id = rr.passenger_id
     JOIN zones dz ON dz.id = rr.destination_zone_id
     WHERE rr.pool_id = ANY($1::uuid[]) AND rr.status NOT IN ('CANCELLED', 'PENDING_CONFIRMATION')`,
    [poolIds],
  );

  return rows.map((r) => ({
    ...r,
    poolmates: r.pool_id
      ? mates
          .filter((m) => m.pool_id === r.pool_id && m.id !== r.id)
          .map((m) => ({ name: m.passenger_name, destination: m.destination_zone_name }))
      : [],
  }));
}

/**
 * Adds what this passenger is currently being ASKED (pendingConsents — an
 * existing member asked about a proposed newcomer) and, for a ride still
 * awaiting agreement itself, who hasn't answered yet (waitingOn) and whether
 * its own answer is still outstanding (ownConsentPending).
 */
async function attachConsentContext(rows) {
  const { asked, waiting, ownPending, expires } = await consentService.loadConsentContext(rows.map((r) => r.id));
  return rows.map((r) => ({
    ...r,
    pendingConsents: asked.get(r.id) || [],
    waitingOn: waiting.get(r.id) || [],
    ownConsentPending: ownPending.has(r.id),
    // When the open sharing proposal for this ride times out (null if none).
    consentExpiresAt: expires.get(r.id) || null,
  }));
}

async function enrich(rows) {
  return tripService.attachTrip(await attachConsentContext(await attachPoolmates(rows)));
}

async function listMine(passengerId) {
  await consentService.expireStaleProposals();
  await expireUnmatchedRequests();
  const { rows } = await pool.query(
    `SELECT rr.*, pz.name AS pickup_zone_name, dz.name AS destination_zone_name,
            pay.method AS paid_with, pay.status AS payment_status, pay.kind AS payment_kind,
            mp.name AS pickup_point_name
     FROM ride_requests rr
     JOIN zones pz ON pz.id = rr.pickup_zone_id
     JOIN zones dz ON dz.id = rr.destination_zone_id
     LEFT JOIN payments pay ON pay.ride_request_id = rr.id
     LEFT JOIN meeting_points mp ON mp.id = rr.pickup_point_id
     WHERE rr.passenger_id = $1
     ORDER BY rr.requested_at DESC`,
    [passengerId],
  );
  const rides = await enrich(rows);
  // Lets the app hide the "rate your driver" prompt once it has been answered.
  const rated = await ratingService.ratedByUser(passengerId, rides.filter((r) => r.status === 'COMPLETED').map((r) => r.id));
  return rides.map((r) => ({ ...r, rated: rated.has(r.id) }));
}

async function getByIdForUser(id, user) {
  await consentService.expireStaleProposals();
  const { rows } = await pool.query(
    `SELECT rr.*, p.tesla_id, t.driver_id
     FROM ride_requests rr
     LEFT JOIN pools p ON p.id = rr.pool_id
     LEFT JOIN teslas t ON t.id = p.tesla_id
     WHERE rr.id = $1`,
    [id],
  );
  if (rows.length === 0) throw new ApiError(404, 'Ride request not found');
  const rideRequest = rows[0];

  const isOwner = rideRequest.passenger_id === user.id;
  const isAssignedDriver = rideRequest.driver_id === user.id;
  if (!isOwner && !isAssignedDriver) {
    throw new ApiError(403, "You can't view another user's ride");
  }
  const [enriched] = await enrich([rideRequest]);
  return enriched;
}

/**
 * Open requests a driver can consider accepting. A scheduled ride only appears
 * shortly before its time, and a request whose wait has run out is not shown
 * even if the cleanup job has not got to it yet.
 */
async function listOpen({ limit = 50, offset = 0 } = {}) {
  await consentService.expireStaleProposals(); // expired joiners are open requests again
  await expireUnmatchedRequests();
  const { rows } = await pool.query(
    `SELECT rr.*, u.name AS passenger_name, u.gender AS passenger_gender,
            pz.name AS pickup_zone_name, dz.name AS destination_zone_name, mp.name AS pickup_point_name,
            (SELECT round(avg(stars)::numeric, 2) FROM ratings WHERE ratee_id = rr.passenger_id) AS passenger_rating
     FROM ride_requests rr
     JOIN users u ON u.id = rr.passenger_id
     JOIN zones pz ON pz.id = rr.pickup_zone_id
     JOIN zones dz ON dz.id = rr.destination_zone_id
     LEFT JOIN meeting_points mp ON mp.id = rr.pickup_point_id
     WHERE rr.status = 'REQUESTED'
       AND (rr.scheduled_for IS NULL OR rr.scheduled_for <= now() + make_interval(mins => $3))
       AND (rr.expires_at IS NULL OR rr.expires_at > now())
     ORDER BY COALESCE(rr.scheduled_for, rr.requested_at) ASC, rr.id ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset, SCHEDULE_VISIBLE_LEAD_MINUTES],
  );
  return rows;
}

async function cancel(passengerId, id, reason) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT rr.*, p.status AS pool_status
       FROM ride_requests rr
       LEFT JOIN pools p ON p.id = rr.pool_id
       WHERE rr.id = $1
       FOR UPDATE OF rr`,
      [id],
    );
    if (rows.length === 0) throw new ApiError(404, 'Ride request not found');
    const rideRequest = rows[0];

    if (rideRequest.passenger_id !== passengerId) {
      throw new ApiError(403, "You can't cancel another user's ride");
    }

    // "Cancel while valid" — Section 3. Not allowed once the driver has
    // arrived; the trip is effectively already underway from the rider's POV.
    // PENDING_CONFIRMATION is cancellable too — distinct from declineJoin,
    // which returns the passenger to REQUESTED (still wants a ride, just not
    // this pool); cancelling here ends the request outright.
    const cancellable =
      rideRequest.status === 'REQUESTED' ||
      rideRequest.status === 'PENDING_CONFIRMATION' ||
      (rideRequest.status === 'MATCHED' && rideRequest.pool_status === 'MATCHED');

    if (!cancellable) {
      throw new ApiError(409, `Ride request in status '${rideRequest.status}' can no longer be cancelled`);
    }

    if (rideRequest.pool_id) {
      // Lock the pool row first (same order as poolService.acceptRequest:
      // ride_request, then pool) so a driver adding someone at the same
      // moment can't interleave with the emptiness check further down.
      await client.query('SELECT id FROM pools WHERE id = $1 FOR UPDATE', [rideRequest.pool_id]);
      // Free the seat(s) atomically — never just decrement in app code
      // without a WHERE guard, for the same reason capacity is never
      // incremented without one (see poolService.acceptRequest).
      await client.query(
        `UPDATE pools SET seats_occupied = seats_occupied - $1 WHERE id = $2`,
        [rideRequest.seats_requested, rideRequest.pool_id],
      );
    }

    await client.query(
      `UPDATE ride_requests
       SET status = 'CANCELLED', cancelled_at = now(), cancellation_reason = $2
       WHERE id = $1`,
      [id, reason || null],
    );

    await logTransition(client, {
      entityType: 'ride_request',
      entityId: id,
      fromStatus: rideRequest.status,
      toStatus: 'CANCELLED',
      changedBy: passengerId,
      note: reason,
    });

    // Anyone still waiting on an answer from this passenger — or this
    // passenger was themselves a pending newcomer — needs their proposal tidied.
    await consentService.handleCancelledRequest(client, id, passengerId);

    // If that was the last live passenger, close the pool so the Tesla isn't
    // stuck behind an empty one.
    await cancelPoolIfEmpty(client, rideRequest.pool_id, passengerId);

    await commit(client);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = retrying(
  { createRequest, listMine, getByIdForUser, listOpen, cancel, expireUnmatchedRequests 
  },
  ['cancel'],
);
