const { pool } = require('../config/db');
const { ApiError } = require('../utils/ApiError');
const { computeBaseAndDistance } = require('./fareService');
const { logTransition } = require('./statusHistoryService');

async function getZoneOrThrow(client, zoneId, label) {
  const { rows } = await client.query('SELECT * FROM zones WHERE id = $1', [zoneId]);
  if (rows.length === 0) throw new ApiError(422, `${label} zone does not exist`);
  return rows[0];
}

async function createRequest(passengerId, { pickupZoneId, destinationZoneId, seatsRequested = 1 }) {
  if (pickupZoneId === destinationZoneId) {
    throw new ApiError(422, 'Pickup and destination zone must differ');
  }
  if (!Number.isInteger(seatsRequested) || seatsRequested < 1) {
    throw new ApiError(422, 'seatsRequested must be a positive integer');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pickupZone = await getZoneOrThrow(client, pickupZoneId, 'Pickup');
    const destinationZone = await getZoneOrThrow(client, destinationZoneId, 'Destination');

    const { baseFarePaisa, distanceChargePaisa } = computeBaseAndDistance(pickupZone, destinationZone, seatsRequested);

    const { rows } = await client.query(
      `INSERT INTO ride_requests
         (passenger_id, pickup_zone_id, destination_zone_id, seats_requested,
          status, base_fare_paisa, distance_charge_paisa, pool_discount_paisa)
       VALUES ($1, $2, $3, $4, 'REQUESTED', $5, $6, 0)
       RETURNING *`,
      [passengerId, pickupZoneId, destinationZoneId, seatsRequested, baseFarePaisa, distanceChargePaisa],
    );
    const rideRequest = rows[0];

    await logTransition(client, {
      entityType: 'ride_request',
      entityId: rideRequest.id,
      fromStatus: null,
      toStatus: 'REQUESTED',
      changedBy: passengerId,
    });

    await client.query('COMMIT');
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

async function listMine(passengerId) {
  const { rows } = await pool.query(
    `SELECT rr.*, pz.name AS pickup_zone_name, dz.name AS destination_zone_name
     FROM ride_requests rr
     JOIN zones pz ON pz.id = rr.pickup_zone_id
     JOIN zones dz ON dz.id = rr.destination_zone_id
     WHERE rr.passenger_id = $1
     ORDER BY rr.requested_at DESC`,
    [passengerId],
  );
  return rows;
}

async function getByIdForUser(id, user) {
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
  return rideRequest;
}

/** Open requests a driver can consider accepting. MVP: no geospatial filter. */
async function listOpen() {
  const { rows } = await pool.query(
    `SELECT rr.*, u.name AS passenger_name,
            pz.name AS pickup_zone_name, dz.name AS destination_zone_name, dz.cluster AS destination_cluster
     FROM ride_requests rr
     JOIN users u ON u.id = rr.passenger_id
     JOIN zones pz ON pz.id = rr.pickup_zone_id
     JOIN zones dz ON dz.id = rr.destination_zone_id
     WHERE rr.status = 'REQUESTED'
     ORDER BY rr.requested_at ASC`,
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
    const cancellable =
      rideRequest.status === 'REQUESTED' ||
      (rideRequest.status === 'MATCHED' && rideRequest.pool_status === 'MATCHED');

    if (!cancellable) {
      throw new ApiError(409, `Ride request in status '${rideRequest.status}' can no longer be cancelled`);
    }

    if (rideRequest.pool_id) {
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

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createRequest, listMine, getByIdForUser, listOpen, cancel };
