const { pool: db } = require('../config/db');
const { retrying } = require('../utils/retryTx');
const { ApiError } = require('../utils/ApiError');
const { computePoolDiscount } = require('./fareService');
const { logTransition } = require('./statusHistoryService');
const { loadGraph, evaluatePoolFit } = require('./routeService');
const consentService = require('./consentService');
const { settleRidePayment } = require('./walletService');
const { commit } = require('../utils/tx');
const { notifyAfterCommit } = require('./notificationService');
const { haversineKm } = require('../utils/haversine');
const { ARRIVAL_GEOFENCE_KM, LOCATION_STALE_MINUTES } = require('../config/tracking');
const { CONSENT_TIMEOUT_MINUTES } = require('../config/timeouts');

async function assertOwnsActiveTesla(client, driverId, teslaId) {
  // FOR UPDATE serialises everything a driver does with one Tesla. Without it,
  // two simultaneous accepts both saw "no active pool" (there was no row to
  // lock) and both created one — one vehicle in two pools. Reproduced: 25 of 25
  // concurrent rounds did exactly that before this lock.
  const { rows } = await client.query('SELECT * FROM teslas WHERE id = $1 FOR UPDATE', [teslaId]);
  if (rows.length === 0) throw new ApiError(404, 'Tesla not found');
  const tesla = rows[0];
  if (tesla.driver_id !== driverId) throw new ApiError(403, "That Tesla isn't yours");
  if (!tesla.is_active) throw new ApiError(409, 'Go online before accepting rides');
  return tesla;
}

/**
 * Driver accepts a REQUESTED ride into either a brand-new pool (poolId
 * omitted) or an existing pool of theirs (poolId given). Either way, seat
 * capacity is enforced with a single atomic UPDATE ... WHERE — see
 * DESIGN.md "Concurrency" for why this is the fix for the
 * Nusrat-vs-Shirin last-seat race, not a read-then-write in app code.
 *
 * A brand-new pool's first member goes straight to MATCHED — requesting a
 * ride at all is itself consent to share if the app later finds someone
 * compatible. Joining an EXISTING pool (a stranger is already in it) instead
 * lands the ride_request in PENDING_CONFIRMATION: the seat is reserved
 * immediately, but the passenger being added must explicitly confirm before
 * it becomes MATCHED — see confirmJoin/declineJoin below, and DESIGN.md's
 * "Passenger consent to pooling" section.
 */
async function acceptRequest(driverId, requestId, { teslaId, poolId }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const tesla = await assertOwnsActiveTesla(client, driverId, teslaId);

    const { rows: rrRows } = await client.query(
      `SELECT * FROM ride_requests WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    if (rrRows.length === 0) throw new ApiError(404, 'Ride request not found');
    const rideRequest = rrRows[0];
    if (rideRequest.status !== 'REQUESTED') {
      throw new ApiError(409, `Ride request is already '${rideRequest.status}'`);
    }

    let resolvedPoolId = poolId;
    const joiningExistingPool = Boolean(poolId);
    let existingMemberIds = [];
    let joinMembers = [];

    if (poolId) {
      // --- Join an existing pool ---
      const { rows: poolRows } = await client.query(
        `SELECT * FROM pools WHERE id = $1 FOR UPDATE`,
        [poolId],
      );
      if (poolRows.length === 0) throw new ApiError(404, 'Pool not found');
      const targetPool = poolRows[0];

      if (targetPool.tesla_id !== teslaId) throw new ApiError(422, 'Pool belongs to a different Tesla');
      if (targetPool.status !== 'MATCHED') {
        throw new ApiError(409, 'Pool is no longer accepting passengers (driver already en route)');
      }

      // One open proposal per pool at a time: everyone already in the pool is
      // being asked about the current newcomer, and asking them about a
      // second one before the first is settled would mean they'd be
      // consenting to a group that doesn't exist yet.
      const { rows: pendingRows } = await client.query(
        `SELECT id FROM ride_requests WHERE pool_id = $1 AND status = 'PENDING_CONFIRMATION'`,
        [poolId],
      );
      if (pendingRows.length > 0) {
        throw new ApiError(
          409,
          'Another passenger is still waiting on this pool to agree to share — settle that first',
        );
      }

      // Matching rule (Section 4): the newcomer's actual path across the zone
      // graph has to merge with everyone already in the pool into one
      // continuous, non-branching route that all of them travel the same way
      // along — see routeService.routesAreCompatible and DESIGN.md's
      // "Route-aware pooling". This replaced an earlier flat cluster tag that
      // couldn't tell "same general area" from "needs to backtrack through a
      // junction."
      const { rows: memberRows } = await client.query(
        `SELECT rr.id, rr.passenger_id, rr.route_zone_ids, rr.share_max, rr.women_only, u.gender
         FROM ride_requests rr JOIN users u ON u.id = rr.passenger_id
         WHERE rr.pool_id = $1 AND rr.status NOT IN ('CANCELLED')`,
        [poolId],
      );
      const existingPaths = memberRows.map((r) => r.route_zone_ids);
      // Strict no-backtracking first; otherwise a bounded detour is allowed if it
      // is fair to everyone and the pool really saves driving (config/matching.js).
      const fit = evaluatePoolFit(await loadGraph(client), existingPaths, rideRequest.route_zone_ids);
      if (!fit.fits) {
        throw new ApiError(
          422,
          "This request's route can't be combined with the pool's without backtracking through a junction",
        );
      }
      existingMemberIds = memberRows.map((r) => r.id);
      joinMembers = memberRows;

      // Women-only works both ways: a passenger who asked for it is only ever
      // pooled with women, and a women-only pool does not take anyone else.
      const { rows: [joinerUser] } = await client.query('SELECT gender FROM users WHERE id = $1', [rideRequest.passenger_id]);
      if (rideRequest.women_only && memberRows.some((m) => m.gender !== 'female')) {
        throw new ApiError(422, 'This passenger asked for a women-only ride, and this pool includes other passengers');
      }
      if (memberRows.some((m) => m.women_only) && joinerUser.gender !== 'female') {
        throw new ApiError(422, 'This pool is women-only');
      }

      // Atomic capacity guard — the whole point of this statement is that
      // the check and the increment happen as one indivisible DB operation.
      const { rows: updated } = await client.query(
        `UPDATE pools
         SET seats_occupied = seats_occupied + $2
         WHERE id = $1
           AND status = 'MATCHED'
           AND seats_occupied + $2 <= (SELECT capacity FROM teslas WHERE id = $3)
         RETURNING id`,
        [poolId, rideRequest.seats_requested, teslaId],
      );
      if (updated.length === 0) {
        throw new ApiError(409, 'Not enough seats left in that pool');
      }
    } else {
      // --- Start a brand-new pool ---
      // A Tesla is one physical vehicle — it can only be running one
      // non-terminal pool at a time. Without this check, a driver could
      // accept two different requests into two separate new pools on the
      // same Tesla, each individually passing its own capacity check while
      // the vehicle is logically in two places at once.
      const { rows: activePools } = await client.query(
        `SELECT id FROM pools WHERE tesla_id = $1 AND status NOT IN ('COMPLETED', 'CANCELLED') FOR UPDATE`,
        [teslaId],
      );
      if (activePools.length > 0) {
        throw new ApiError(
          409,
          `${tesla.name} already has an active pool — add this passenger to it instead of starting a new one`,
        );
      }

      if (rideRequest.seats_requested > tesla.capacity) {
        throw new ApiError(422, `${tesla.name} only has ${tesla.capacity} seats`);
      }
      const { rows: newPool } = await client.query(
        `INSERT INTO pools (tesla_id, status, seats_occupied)
         VALUES ($1, 'MATCHED', $2)
         RETURNING id`,
        [teslaId, rideRequest.seats_requested],
      );
      resolvedPoolId = newPool[0].id;
      await logTransition(client, {
        entityType: 'pool',
        entityId: resolvedPoolId,
        fromStatus: null,
        toStatus: 'MATCHED',
        changedBy: driverId,
      });
    }

    // A brand-new pool's first member has nobody to share with yet, so
    // there's nobody to ask. Joining an EXISTING pool opens an all-party
    // consent proposal instead: every current member AND the newcomer must
    // approve before the newcomer becomes MATCHED.
    // Two explicit branches, not one UPDATE with $2 doing double duty as
    // both the enum assignment and a text comparison in a CASE — Postgres's
    // parameter-type inference gets confused when the same placeholder is
    // used in two different type contexts in one statement (hit this as a
    // real 500 while building this feature, not a hypothetical).
    const initialStatus = joiningExistingPool ? 'PENDING_CONFIRMATION' : 'MATCHED';

    if (initialStatus === 'MATCHED') {
      await client.query(
        `UPDATE ride_requests SET status = 'MATCHED', pool_id = $2, matched_at = now() WHERE id = $1`,
        [requestId, resolvedPoolId],
      );
    } else {
      await client.query(
        `UPDATE ride_requests SET status = 'PENDING_CONFIRMATION', pool_id = $2 WHERE id = $1`,
        [requestId, resolvedPoolId],
      );
    }
    await logTransition(client, {
      entityType: 'ride_request',
      entityId: requestId,
      fromStatus: 'REQUESTED',
      toStatus: initialStatus,
      changedBy: driverId,
    });

    const { rows: [driverRow] } = await client.query('SELECT name FROM users WHERE id = $1', [driverId]);
    let finalStatus = initialStatus;
    if (!joiningExistingPool) {
      notifyAfterCommit(client, [rideRequest.passenger_id], 'POOL_MATCHED', { poolId: resolvedPoolId, driverName: driverRow.name, teslaName: tesla.name });
    } else {
      // Anyone who pre-approved sharing "with up to N" is not asked again, as
      // long as this pool stays within their N.
      const newSize = joinMembers.length + 1;
      const approves = (r) => r.share_max != null && newSize <= r.share_max;
      const preApproved = joinMembers.filter(approves).map((r) => r.id);
      if (approves(rideRequest)) preApproved.push(requestId);
      const proposalId = await consentService.createProposal(client, requestId, existingMemberIds, preApproved);

      if (preApproved.length === existingMemberIds.length + 1) {
        // Everyone had already said yes: no question to ask, the newcomer is matched now.
        await consentService.resolveProposal(client, proposalId, driverId, 'every passenger had pre-approved sharing for a pool this size');
        finalStatus = 'MATCHED';
        notifyAfterCommit(client, [rideRequest.passenger_id], 'POOL_MATCHED', { poolId: resolvedPoolId, driverName: driverRow.name, teslaName: tesla.name });
      } else {
        const { rows: [joinerRow] } = await client.query('SELECT name FROM users WHERE id = $1', [rideRequest.passenger_id]);
        const asked = joinMembers.filter((m) => !preApproved.includes(m.id)).map((m) => m.passenger_id);
        notifyAfterCommit(client, asked, 'SHARE_REQUEST', { rideRequestId: requestId, joinerName: joinerRow.name, minutes: CONSENT_TIMEOUT_MINUTES });
        if (!preApproved.includes(requestId)) {
          notifyAfterCommit(client, [rideRequest.passenger_id], 'SHARE_CONFIRM', { rideRequestId: requestId, minutes: CONSENT_TIMEOUT_MINUTES });
        }
      }
    }

    await commit(client);
    return { poolId: resolvedPoolId, rideRequestStatus: finalStatus };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The joiner answering for themselves — confirm or decline sharing. Their
 * answer is one of several: every existing member has to approve too, and any
 * single decline (including this one) sends the joiner back to REQUESTED
 * with the seat freed. All the logic lives in consentService.
 */
const confirmJoin = (passengerId, requestId) =>
  consentService.respondAsJoiner(passengerId, requestId, 'ACCEPTED');

const declineJoin = (passengerId, requestId, reason) =>
  consentService.respondAsJoiner(passengerId, requestId, 'DECLINED', reason);

async function listMineForDriver(driverId) {
  await consentService.expireStaleProposals();
  const { rows } = await db.query(
    `SELECT p.*, t.name AS tesla_name, t.capacity
     FROM pools p
     JOIN teslas t ON t.id = p.tesla_id
     WHERE t.driver_id = $1 AND p.status NOT IN ('COMPLETED', 'CANCELLED')
     ORDER BY p.created_at DESC`,
    [driverId],
  );
  return rows;
}

async function getPoolDetail(driverId, poolId) {
  await consentService.expireStaleProposals();
  const { rows: poolRows } = await db.query(
    `SELECT p.*, t.driver_id, t.name AS tesla_name, t.capacity
     FROM pools p JOIN teslas t ON t.id = p.tesla_id
     WHERE p.id = $1`,
    [poolId],
  );
  if (poolRows.length === 0) throw new ApiError(404, 'Pool not found');
  if (poolRows[0].driver_id !== driverId) throw new ApiError(403, "That pool isn't yours");

  const { rows: members } = await db.query(
    `SELECT rr.id, rr.passenger_id, u.name AS passenger_name, rr.status,
            rr.seats_requested, rr.final_fare_paisa, rr.pickup_zone_id, rr.destination_zone_id
     FROM ride_requests rr JOIN users u ON u.id = rr.passenger_id
     WHERE rr.pool_id = $1
     ORDER BY rr.matched_at ASC`,
    [poolId],
  );

  return { ...poolRows[0], members };
}

async function transitionPool(driverId, poolId, { fromStatus, toStatus, rrFromStatus, rrToStatus, timestampCol }) {
  // An expired proposal must not keep blocking "mark arrived".
  await consentService.expireStaleProposals();
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT p.*, t.driver_id FROM pools p JOIN teslas t ON t.id = p.tesla_id
       WHERE p.id = $1 FOR UPDATE OF p`,
      [poolId],
    );
    if (rows.length === 0) throw new ApiError(404, 'Pool not found');
    const targetPool = rows[0];
    if (targetPool.driver_id !== driverId) throw new ApiError(403, "That pool isn't yours");
    if (targetPool.status !== fromStatus) {
      throw new ApiError(409, `Pool must be '${fromStatus}' to do this (currently '${targetPool.status}')`);
    }

    // Arriving implies everyone actually coming has agreed to come — can't
    // mark arrival while someone the driver added is still deciding.
    if (toStatus === 'DRIVER_ARRIVED') {
      const { rows: pending } = await client.query(
        `SELECT id FROM ride_requests WHERE pool_id = $1 AND status = 'PENDING_CONFIRMATION'`,
        [poolId],
      );
      if (pending.length > 0) {
        throw new ApiError(409, 'Some passengers in this pool have not yet confirmed sharing the ride');
      }

      // If the driver's app has shared a recent position, they must actually be
      // near a pickup. No recent position = not enforced (GPS fails; the demo has none).
      const recent = targetPool.last_location_at && Date.now() - new Date(targetPool.last_location_at).getTime() < LOCATION_STALE_MINUTES * 60000;
      if (recent) {
        const { rows: pickups } = await client.query(
          `SELECT DISTINCT z.latitude, z.longitude FROM ride_requests rr JOIN zones z ON z.id = rr.pickup_zone_id
           WHERE rr.pool_id = $1 AND rr.status = 'MATCHED'`,
          [poolId],
        );
        const nearest = Math.min(...pickups.map((z) => haversineKm(targetPool.last_latitude, targetPool.last_longitude, z.latitude, z.longitude)));
        if (pickups.length > 0 && nearest > ARRIVAL_GEOFENCE_KM) {
          throw new ApiError(409, `You don't seem to be near the pickup yet (about ${nearest.toFixed(1)} km away)`);
        }
      }
    }

    await client.query(
      `UPDATE pools SET status = $2, ${timestampCol} = now() WHERE id = $1`,
      [poolId, toStatus],
    );
    await logTransition(client, {
      entityType: 'pool',
      entityId: poolId,
      fromStatus,
      toStatus,
      changedBy: driverId,
    });

    const { rows: affected } = await client.query(
      `UPDATE ride_requests SET status = $2, ${timestampCol} = now()
       WHERE pool_id = $1 AND status = $3
       RETURNING id, passenger_id, distance_charge_paisa`,
      [poolId, rrToStatus, rrFromStatus],
    );

    // Finalize the pool discount exactly once, at STARTED — see DESIGN.md.
    if (toStatus === 'STARTED') {
      const finalPassengerCount = affected.length;
      for (const rr of affected) {
        const discount = computePoolDiscount(rr.distance_charge_paisa, finalPassengerCount);
        await client.query('UPDATE ride_requests SET pool_discount_paisa = $2 WHERE id = $1', [rr.id, discount]);
      }
    }

    // On completion, settle payment for every passenger in the pool.
    //  - CASH: a PENDING payment record the driver collects and reconciles.
    //  - TESLAPAY: move the fare wallet-to-wallet right here, in the same
    //    transaction as the status change. If the passenger's balance fell
    //    short since they requested, fall back to a pending cash payment —
    //    the trip still completes, and the record shows how it really settled.
    if (toStatus === 'COMPLETED') {
      // Passengers in id order so concurrent completions lock wallet rows in a
      // consistent order.
      const { rows: toSettle } = await client.query(
        `SELECT id, passenger_id, final_fare_paisa, payment_method
         FROM ride_requests WHERE id = ANY($1::uuid[]) ORDER BY passenger_id`,
        [affected.map((rr) => rr.id)],
      );
      for (const rr of toSettle) {
        const amountPaisa = Number(rr.final_fare_paisa);
        let method = 'CASH';
        let status = 'PENDING';
        if (rr.payment_method === 'TESLAPAY') {
          const settled = await settleRidePayment(client, {
            rideRequestId: rr.id,
            passengerId: rr.passenger_id,
            driverId,
            amountPaisa,
          });
          if (settled) {
            method = 'TESLAPAY';
            status = 'PAID';
          }
        }
        await client.query(
          `INSERT INTO payments (ride_request_id, amount_paisa, method, status, paid_at)
           VALUES ($1, $2, $3::payment_method, $4::payment_status,
                   CASE WHEN $4::payment_status = 'PAID' THEN now() END)
           ON CONFLICT (ride_request_id) DO NOTHING`,
          [rr.id, amountPaisa, method, status],
        );
      }
    }

    for (const rr of affected) {
      await logTransition(client, {
        entityType: 'ride_request',
        entityId: rr.id,
        fromStatus: rrFromStatus,
        toStatus: rrToStatus,
        changedBy: driverId,
      });
    }

    // Tell every passenger (after the commit, never for a rolled-back change).
    const { rows: [driverRow] } = await client.query('SELECT name FROM users WHERE id = $1', [driverId]);
    if (toStatus === 'DRIVER_ARRIVED') {
      notifyAfterCommit(client, affected.map((r) => r.passenger_id), 'DRIVER_ARRIVED', { poolId, driverName: driverRow.name });
    } else if (toStatus === 'STARTED') {
      notifyAfterCommit(client, affected.map((r) => r.passenger_id), 'TRIP_STARTED', { poolId });
    } else if (toStatus === 'COMPLETED') {
      const { rows: fares } = await client.query('SELECT id, passenger_id, final_fare_paisa FROM ride_requests WHERE id = ANY($1::uuid[])', [affected.map((r) => r.id)]);
      for (const f of fares) notifyAfterCommit(client, [f.passenger_id], 'TRIP_COMPLETED', { poolId, rideRequestId: f.id, farePaisa: Number(f.final_fare_paisa) });
    }

    await commit(client);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const MAX_CANCEL_REASON_LENGTH = 200;

/**
 * The driver cancels a pool that has not left yet (MATCHED or DRIVER_ARRIVED).
 * Once the trip has STARTED passengers are in the vehicle, so it can only be
 * completed.
 *
 * Passengers are not cancelled — the driver backing out is not their doing —
 * they go back to REQUESTED with their seat released, so another driver (or
 * the same one later) can pick them up. Any open sharing proposal is
 * withdrawn with the pool. Every change is audited with the driver's reason.
 */
async function cancelPool(driverId, poolId, reason) {
  if (reason != null && (typeof reason !== 'string' || reason.length > MAX_CANCEL_REASON_LENGTH)) {
    throw new ApiError(422, `reason must be text of at most ${MAX_CANCEL_REASON_LENGTH} characters`);
  }
  const cleanReason = reason && reason.trim() ? reason.trim() : null;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Ownership first, with no locks, so a stranger can never make us hold any.
    const { rows: peek } = await client.query(
      `SELECT t.driver_id FROM pools p JOIN teslas t ON t.id = p.tesla_id WHERE p.id = $1`,
      [poolId],
    );
    if (peek.length === 0) throw new ApiError(404, 'Pool not found');
    if (peek[0].driver_id !== driverId) throw new ApiError(403, "That pool isn't yours");

    // LOCK ORDER matters. Every other flow that touches a ride and its pool
    // (a passenger cancelling, a consent answer, accepting a request) locks the
    // ride_request row(s) FIRST and the pool SECOND. Locking the pool first here
    // made a passenger-cancel racing a driver-cancel deadlock (Postgres 40P01) —
    // reproduced under a 40-round race test before this was changed.
    const memberStatuses = `('PENDING_CONFIRMATION', 'MATCHED', 'DRIVER_ARRIVED')`;
    const { rows: lockedMembers } = await client.query(
      `SELECT id FROM ride_requests WHERE pool_id = $1 AND status IN ${memberStatuses} ORDER BY id FOR UPDATE`,
      [poolId],
    );
    const { rows } = await client.query(
      `SELECT p.*, t.driver_id FROM pools p JOIN teslas t ON t.id = p.tesla_id
       WHERE p.id = $1 FOR UPDATE OF p`,
      [poolId],
    );
    const target = rows[0];
    if (!['MATCHED', 'DRIVER_ARRIVED'].includes(target.status)) {
      throw new ApiError(409, `A pool that is '${target.status}' can no longer be cancelled`);
    }

    // Re-read the membership now that the pool is locked: if someone joined (or
    // left) between the two locks above, we hold the wrong set — fail cleanly.
    const { rows: members } = await client.query(
      `SELECT id, status FROM ride_requests WHERE pool_id = $1 AND status IN ${memberStatuses} ORDER BY id`,
      [poolId],
    );
    const lockedIds = new Set(lockedMembers.map((m) => m.id));
    if (members.length !== lockedIds.size || members.some((m) => !lockedIds.has(m.id))) {
      throw new ApiError(409, 'The pool changed while it was being cancelled — please try again');
    }
    const memberIds = members.map((m) => m.id);

    // Withdraw every open question that involves these passengers.
    await client.query(
      `UPDATE pool_join_consents SET decision = 'VOID', decided_at = now()
       WHERE decision = 'PENDING'
         AND (joiner_request_id = ANY($1::uuid[]) OR member_request_id = ANY($1::uuid[]))`,
      [memberIds],
    );

    await client.query(
      `UPDATE ride_requests
       SET status = 'REQUESTED', pool_id = NULL, matched_at = NULL, driver_arrived_at = NULL
       WHERE id = ANY($1::uuid[])`,
      [memberIds],
    );
    await client.query(
      `UPDATE pools SET status = 'CANCELLED', cancelled_at = now(), seats_occupied = 0 WHERE id = $1`,
      [poolId],
    );

    const note = cleanReason ? `driver cancelled the pool: ${cleanReason}` : 'driver cancelled the pool';
    await logTransition(client, {
      entityType: 'pool',
      entityId: poolId,
      fromStatus: target.status,
      toStatus: 'CANCELLED',
      changedBy: driverId,
      note,
    });
    for (const m of members) {
      await logTransition(client, {
        entityType: 'ride_request',
        entityId: m.id,
        fromStatus: m.status,
        toStatus: 'REQUESTED',
        changedBy: driverId,
        note: `${note} — back in the queue`,
      });
    }

    await commit(client);
    return { releasedRequests: memberIds.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const markArrived = (driverId, poolId) =>
  transitionPool(driverId, poolId, {
    fromStatus: 'MATCHED',
    toStatus: 'DRIVER_ARRIVED',
    rrFromStatus: 'MATCHED',
    rrToStatus: 'DRIVER_ARRIVED',
    timestampCol: 'driver_arrived_at',
  });

const startTrip = (driverId, poolId) =>
  transitionPool(driverId, poolId, {
    fromStatus: 'DRIVER_ARRIVED',
    toStatus: 'STARTED',
    rrFromStatus: 'DRIVER_ARRIVED',
    rrToStatus: 'STARTED',
    timestampCol: 'started_at',
  });

const completeTrip = (driverId, poolId) =>
  transitionPool(driverId, poolId, {
    fromStatus: 'STARTED',
    toStatus: 'COMPLETED',
    rrFromStatus: 'STARTED',
    rrToStatus: 'COMPLETED',
    timestampCol: 'completed_at',
  });

module.exports = retrying(
  {
  acceptRequest,
  confirmJoin,
  declineJoin,
  listMineForDriver,
  getPoolDetail,
  markArrived,
  startTrip,
  completeTrip,
  cancelPool,
  },
  ['acceptRequest', 'confirmJoin', 'declineJoin', 'markArrived', 'startTrip', 'completeTrip', 'cancelPool'],
);
