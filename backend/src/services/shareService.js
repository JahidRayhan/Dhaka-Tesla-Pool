const crypto = require('crypto');
const { pool } = require('../config/db');
const { ApiError } = require('../utils/ApiError');
const { LOCATION_STALE_MINUTES } = require('../config/tracking');

const SHARE_TTL_HOURS = 6;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SHAREABLE = ['REQUESTED', 'PENDING_CONFIRMATION', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED'];

/** A passenger creates a link a friend can open WITHOUT an account to follow the trip. Replaces any earlier link for the ride. */
async function create(user, rideId) {
  const { rows } = await pool.query('SELECT passenger_id, status FROM ride_requests WHERE id = $1', [rideId]);
  if (rows.length === 0) throw new ApiError(404, 'Ride not found');
  if (rows[0].passenger_id !== user.id) throw new ApiError(403, "That isn't your ride");
  if (!SHAREABLE.includes(rows[0].status)) throw new ApiError(409, 'This ride has ended, so there is nothing to follow');

  const token = crypto.randomBytes(24).toString('base64url');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE trip_shares SET revoked_at = now() WHERE ride_request_id = $1 AND revoked_at IS NULL', [rideId]);
    const { rows: [share] } = await client.query(
      `INSERT INTO trip_shares (token_hash, ride_request_id, created_by, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(hours => $4)) RETURNING expires_at`,
      [sha256(token), rideId, user.id, SHARE_TTL_HOURS],
    );
    await client.query('COMMIT');
    // A query string, not /trip/<token>: the web app is a static export, which cannot have a page per token.
    return { token, path: `/trip?t=${token}`, expiresAt: share.expires_at };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function revoke(user, rideId) {
  const { rows } = await pool.query('SELECT passenger_id FROM ride_requests WHERE id = $1', [rideId]);
  if (rows.length === 0) throw new ApiError(404, 'Ride not found');
  if (rows[0].passenger_id !== user.id) throw new ApiError(403, "That isn't your ride");
  await pool.query('UPDATE trip_shares SET revoked_at = now() WHERE ride_request_id = $1 AND revoked_at IS NULL', [rideId]);
}

/**
 * What the PUBLIC link shows: enough to follow along and feel safe, and nothing
 * that identifies the other passengers or exposes account details. First names
 * only; the vehicle plate only if the driver is verified; the position only if fresh.
 * An unknown, revoked, expired or finished-long-ago link is a plain 404, so the
 * response never reveals which of those it was.
 */
async function publicView(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) throw new ApiError(404, 'This link is not valid any more');
  const { rows } = await pool.query(
    `SELECT s.expires_at, rr.status, rr.completed_at, rr.cancelled_at, rr.route_zone_ids, split_part(pu.name, ' ', 1) AS passenger_first_name,
            pz.name AS pickup, dz.name AS destination, mp.name AS pickup_point,
            t.name AS tesla_name, split_part(du.name, ' ', 1) AS driver_first_name, dp.vehicle_plate, dp.status AS verification,
            p.last_latitude, p.last_longitude, p.last_location_at
     FROM trip_shares s
     JOIN ride_requests rr ON rr.id = s.ride_request_id
     JOIN users pu ON pu.id = rr.passenger_id
     JOIN zones pz ON pz.id = rr.pickup_zone_id JOIN zones dz ON dz.id = rr.destination_zone_id
     LEFT JOIN meeting_points mp ON mp.id = rr.pickup_point_id
     LEFT JOIN pools p ON p.id = rr.pool_id LEFT JOIN teslas t ON t.id = p.tesla_id
     LEFT JOIN users du ON du.id = t.driver_id LEFT JOIN driver_profiles dp ON dp.user_id = du.id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
       AND (rr.completed_at IS NULL OR rr.completed_at > now() - interval '1 hour')
       AND (rr.cancelled_at IS NULL OR rr.cancelled_at > now() - interval '1 hour')`,
    [sha256(token)],
  );
  const r = rows[0];
  if (!r) throw new ApiError(404, 'This link is not valid any more');
  const live = ['MATCHED', 'DRIVER_ARRIVED', 'STARTED'].includes(r.status);
  const fresh = live && r.last_location_at && Date.now() - new Date(r.last_location_at).getTime() < LOCATION_STALE_MINUTES * 60_000;
  return {
    trip: {
      passengerFirstName: r.passenger_first_name,
      status: r.status,
      pickup: r.pickup,
      pickupPoint: r.pickup_point,
      destination: r.destination,
      driverFirstName: live ? r.driver_first_name : null,
      teslaName: live ? r.tesla_name : null,
      vehiclePlate: live && r.verification === 'VERIFIED' ? r.vehicle_plate : null,
      location: fresh ? { latitude: r.last_latitude, longitude: r.last_longitude, updatedAt: r.last_location_at } : null,
    },
  };
}

module.exports = { create, revoke, publicView };
