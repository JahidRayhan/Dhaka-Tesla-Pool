const { pool } = require('../config/db');
const { ApiError } = require('../utils/ApiError');

/**
 * Either side of a COMPLETED ride rates the other, once. The passenger rates the
 * driver; the driver rates the passenger. Nobody else may rate it.
 */
async function rate(user, rideId, stars, comment) {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new ApiError(422, 'stars must be a whole number from 1 to 5');
  if (comment !== undefined && comment !== null && (typeof comment !== 'string' || comment.length > 500)) {
    throw new ApiError(422, 'comment must be text of at most 500 characters');
  }
  const { rows } = await pool.query(
    `SELECT rr.status, rr.passenger_id, t.driver_id FROM ride_requests rr
     LEFT JOIN pools p ON p.id = rr.pool_id LEFT JOIN teslas t ON t.id = p.tesla_id WHERE rr.id = $1`,
    [rideId],
  );
  const ride = rows[0];
  if (!ride) throw new ApiError(404, 'Ride not found');
  if (ride.status !== 'COMPLETED') throw new ApiError(409, 'You can rate a ride once it is completed');

  let rateeId;
  if (user.id === ride.passenger_id) rateeId = ride.driver_id;
  else if (user.id === ride.driver_id) rateeId = ride.passenger_id;
  else throw new ApiError(403, "That isn't your ride");

  try {
    await pool.query(
      'INSERT INTO ratings (ride_request_id, rater_id, ratee_id, stars, comment) VALUES ($1, $2, $3, $4, $5)',
      [rideId, user.id, rateeId, stars, comment?.trim() || null],
    );
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, 'You have already rated this ride');
    throw err;
  }
}

async function summary(userId) {
  const { rows } = await pool.query('SELECT round(avg(stars)::numeric, 2) AS average, count(*)::int AS count FROM ratings WHERE ratee_id = $1', [userId]);
  return { average: rows[0].average === null ? null : Number(rows[0].average), count: rows[0].count };
}

/** Which of these rides has the caller already rated? (so the app can hide the prompt) */
async function ratedByUser(userId, rideIds) {
  if (rideIds.length === 0) return new Set();
  const { rows } = await pool.query('SELECT ride_request_id FROM ratings WHERE rater_id = $1 AND ride_request_id = ANY($2::uuid[])', [userId, rideIds]);
  return new Set(rows.map((r) => r.ride_request_id));
}

module.exports = { rate, summary, ratedByUser };
