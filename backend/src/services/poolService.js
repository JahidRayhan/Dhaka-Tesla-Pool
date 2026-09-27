const { pool: db } = require('../config/db');
const { ApiError } = require('../utils/ApiError');
const { computePoolDiscount } = require('./fareService');
const { logTransition } = require('./statusHistoryService');

async function assertOwnsActiveTesla(client, driverId, teslaId) {
  const { rows } = await client.query('SELECT * FROM teslas WHERE id = $1', [teslaId]);
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

      // Matching rule (Section 4): same pickup zone, destination in the
      // same cluster as the pool's existing members.
      const { rows: memberRows } = await client.query(
        `SELECT rr.pickup_zone_id, dz.cluster AS destination_cluster
         FROM ride_requests rr
         JOIN zones dz ON dz.id = rr.destination_zone_id
         WHERE rr.pool_id = $1 AND rr.status NOT IN ('CANCELLED')
         LIMIT 1`,
        [poolId],
      );
      if (memberRows.length > 0) {
        const { rows: newDestRows } = await client.query('SELECT cluster FROM zones WHERE id = $1', [
          rideRequest.destination_zone_id,
        ]);
        const sameZone = memberRows[0].pickup_zone_id === rideRequest.pickup_zone_id;
        const sameCluster = memberRows[0].destination_cluster === newDestRows[0].cluster;
        if (!sameZone || !sameCluster) {
          throw new ApiError(422, "This request's route doesn't match the pool's route");
        }
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

    // A brand-new pool's first member is auto-consented (see doc comment
    // above); joining an existing pool needs the passenger's own yes.
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

    await client.query('COMMIT');
    return { poolId: resolvedPoolId, rideRequestStatus: initialStatus };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Passenger accepts a driver's invitation to share their ride with whoever
 * else is in the pool. Only valid from PENDING_CONFIRMATION — this is the
 * other half of the consent gate in acceptRequest above.
 */
async function confirmJoin(passengerId, requestId) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`SELECT * FROM ride_requests WHERE id = $1 FOR UPDATE`, [requestId]);
    if (rows.length === 0) throw new ApiError(404, 'Ride request not found');
    const rideRequest = rows[0];
    if (rideRequest.passenger_id !== passengerId) throw new ApiError(403, "That ride isn't yours");
    if (rideRequest.status !== 'PENDING_CONFIRMATION') {
      throw new ApiError(409, `Ride request is '${rideRequest.status}', not awaiting confirmation`);
    }

    await client.query(`UPDATE ride_requests SET status = 'MATCHED', matched_at = now() WHERE id = $1`, [requestId]);
    await logTransition(client, {
      entityType: 'ride_request',
      entityId: requestId,
      fromStatus: 'PENDING_CONFIRMATION',
      toStatus: 'MATCHED',
      changedBy: passengerId,
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Passenger declines a driver's invitation to share. Frees the reserved
 * seat atomically (same "never decrement without a guard" reasoning as
 * rideRequestService.cancel) and returns the ride_request to REQUESTED —
 * back in the open pool for the driver to offer elsewhere, not cancelled
 * outright, since the passenger still wants a ride, just not this pool.
 */
async function declineJoin(passengerId, requestId, reason) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`SELECT * FROM ride_requests WHERE id = $1 FOR UPDATE`, [requestId]);
    if (rows.length === 0) throw new ApiError(404, 'Ride request not found');
    const rideRequest = rows[0];
    if (rideRequest.passenger_id !== passengerId) throw new ApiError(403, "That ride isn't yours");
    if (rideRequest.status !== 'PENDING_CONFIRMATION') {
      throw new ApiError(409, `Ride request is '${rideRequest.status}', not awaiting confirmation`);
    }

    await client.query(`UPDATE pools SET seats_occupied = seats_occupied - $1 WHERE id = $2`, [
      rideRequest.seats_requested,
      rideRequest.pool_id,
    ]);

    await client.query(`UPDATE ride_requests SET status = 'REQUESTED', pool_id = NULL WHERE id = $1`, [requestId]);
    await logTransition(client, {
      entityType: 'ride_request',
      entityId: requestId,
      fromStatus: 'PENDING_CONFIRMATION',
      toStatus: 'REQUESTED',
      changedBy: passengerId,
      note: reason,
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listMineForDriver(driverId) {
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
       RETURNING id, distance_charge_paisa`,
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

    // On completion, drop a PENDING cash payment record per passenger —
    // driver reconciles/collects it; TESLAPAY wallet debit would happen
    // synchronously elsewhere instead of via this default.
    if (toStatus === 'COMPLETED') {
      for (const rr of affected) {
        await client.query(
          `INSERT INTO payments (ride_request_id, amount_paisa, method, status)
           SELECT id, final_fare_paisa, 'CASH', 'PENDING' FROM ride_requests WHERE id = $1
           ON CONFLICT (ride_request_id) DO NOTHING`,
          [rr.id],
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

    await client.query('COMMIT');
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

module.exports = {
  acceptRequest,
  confirmJoin,
  declineJoin,
  listMineForDriver,
  getPoolDetail,
  markArrived,
  startTrip,
  completeTrip,
};
