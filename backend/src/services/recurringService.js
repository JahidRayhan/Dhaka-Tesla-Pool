const { pool } = require('../config/db');
const { ApiError } = require('../utils/ApiError');
const logger = require('../utils/logger');
const rideRequestService = require('./rideRequestService');
const { notify } = require('./notificationService');

const MAX_RECURRING_PER_USER = 5;
const BOOK_AHEAD_MINUTES = 60; // a commute is booked this long before it is due
const LATE_GRACE_MINUTES = 30; // ...and still booked if the job only gets to it this late
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
const TZ = 'Asia/Dhaka'; // UTC+6 all year: Bangladesh does not observe daylight saving time currently

const COLUMNS = `id, pickup_zone_id, destination_zone_id, seats_requested, payment_method, days_of_week,
  to_char(time_of_day, 'HH24:MI') AS time_of_day, max_wait_minutes, share_max, women_only, active, last_generated_on, created_at`;

async function create(passengerId, input) {
  const { pickupZoneId, destinationZoneId, seatsRequested = 1, paymentMethod = 'CASH', daysOfWeek, timeOfDay, maxWaitMinutes = null, shareMax = null, womenOnly = false } = input;
  if (!Array.isArray(daysOfWeek) || daysOfWeek.length < 1 || daysOfWeek.length > 7 || !daysOfWeek.every((d) => Number.isInteger(d) && d >= 1 && d <= 7) || new Set(daysOfWeek).size !== daysOfWeek.length) {
    throw new ApiError(422, 'daysOfWeek must be distinct numbers from 1 (Monday) to 7 (Sunday)');
  }
  if (typeof timeOfDay !== 'string' || !TIME_OF_DAY.test(timeOfDay)) throw new ApiError(422, 'timeOfDay must be a local time like "08:30"');
  if (!Number.isInteger(pickupZoneId) || !Number.isInteger(destinationZoneId) || pickupZoneId === destinationZoneId) {
    throw new ApiError(422, 'Choose two different zones');
  }
  if (!['CASH', 'TESLAPAY'].includes(paymentMethod)) throw new ApiError(422, 'paymentMethod must be CASH or TESLAPAY');
  if (!Number.isInteger(seatsRequested) || seatsRequested < 1 || seatsRequested > 6) throw new ApiError(422, 'seatsRequested must be 1-6');
  if (maxWaitMinutes !== null && !(Number.isInteger(maxWaitMinutes) && maxWaitMinutes >= 5 && maxWaitMinutes <= 240)) throw new ApiError(422, 'maxWaitMinutes must be 5-240');
  if (shareMax !== null && !(Number.isInteger(shareMax) && shareMax >= 2 && shareMax <= 6)) throw new ApiError(422, 'shareMax must be 2-6');
  if (typeof womenOnly !== 'boolean') throw new ApiError(422, 'womenOnly must be true or false');

  const { rows: [{ n }] } = await pool.query('SELECT count(*)::int AS n FROM recurring_rides WHERE passenger_id = $1 AND active', [passengerId]);
  if (n >= MAX_RECURRING_PER_USER) throw new ApiError(409, `You can keep at most ${MAX_RECURRING_PER_USER} recurring rides`);

  try {
    const { rows } = await pool.query(
      `INSERT INTO recurring_rides (passenger_id, pickup_zone_id, destination_zone_id, seats_requested, payment_method, days_of_week, time_of_day, max_wait_minutes, share_max, women_only)
       VALUES ($1, $2, $3, $4, $5, $6::smallint[], $7::time, $8, $9, $10) RETURNING ${COLUMNS}`,
      [passengerId, pickupZoneId, destinationZoneId, seatsRequested, paymentMethod, [...daysOfWeek].sort(), timeOfDay, maxWaitMinutes, shareMax, womenOnly],
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23503') throw new ApiError(422, 'Unknown zone');
    throw err;
  }
}

async function list(passengerId) {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM recurring_rides WHERE passenger_id = $1 ORDER BY created_at`, [passengerId]);
  return rows;
}

async function setActive(passengerId, id, active) {
  const { rowCount } = await pool.query('UPDATE recurring_rides SET active = $3 WHERE id = $1 AND passenger_id = $2', [id, passengerId, !!active]);
  if (rowCount === 0) throw new ApiError(404, 'Recurring ride not found');
}

async function remove(passengerId, id) {
  const { rowCount } = await pool.query('DELETE FROM recurring_rides WHERE id = $1 AND passenger_id = $2', [id, passengerId]);
  if (rowCount === 0) throw new ApiError(404, 'Recurring ride not found');
}

/**
 * Turns each commute that is due into an ordinary scheduled ride request. Safe to
 * run every minute on several instances: a commute is CLAIMED for today with one
 * conditional UPDATE before anything is created, so it can only ever be booked
 * once per day. `at` exists so tests can choose "now".
 * @returns {Promise<{ booked: number, failed: number }>}
 */
async function generateDue({ at = new Date() } = {}) {
  const { rows: due } = await pool.query(
    `WITH local AS (SELECT ($1::timestamptz AT TIME ZONE $2) AS now_local)
     UPDATE recurring_rides r SET last_generated_on = (SELECT now_local::date FROM local)
     FROM local
     WHERE r.active
       AND EXTRACT(ISODOW FROM local.now_local)::int = ANY(r.days_of_week)
       AND r.last_generated_on IS DISTINCT FROM local.now_local::date
       AND local.now_local >= (local.now_local::date + r.time_of_day) - make_interval(mins => $3)
       AND local.now_local <= (local.now_local::date + r.time_of_day) + make_interval(mins => $4)
     RETURNING r.*, to_char(r.time_of_day, 'HH24:MI') AS time_text,
       (((local.now_local::date + r.time_of_day) AT TIME ZONE $2)) AS scheduled_for`,
    [at.toISOString(), TZ, BOOK_AHEAD_MINUTES, LATE_GRACE_MINUTES],
  );

  let booked = 0;
  let failed = 0;
  for (const r of due) {
    const { rows: names } = await pool.query('SELECT p.name AS pickup, d.name AS destination FROM zones p, zones d WHERE p.id = $1 AND d.id = $2', [r.pickup_zone_id, r.destination_zone_id]);
    const route = `${names[0].pickup} → ${names[0].destination}`;
    try {
      await rideRequestService.createRequest(
        r.passenger_id,
        {
          pickupZoneId: r.pickup_zone_id,
          destinationZoneId: r.destination_zone_id,
          seatsRequested: r.seats_requested,
          paymentMethod: r.payment_method,
          shareMax: r.share_max,
          womenOnly: r.women_only,
          maxWaitMinutes: r.max_wait_minutes,
          scheduledFor: new Date(r.scheduled_for),
        },
        { allowSoon: true },
      );
      booked += 1;
      await notify([r.passenger_id], 'RECURRING_RIDE_CREATED', { route, time: r.time_text });
    } catch (err) {
      failed += 1;
      logger.warn('recurring ride could not be booked', { recurringId: r.id, err });
      await notify([r.passenger_id], 'RECURRING_RIDE_FAILED', { route, reason: err instanceof ApiError ? err.message : 'something went wrong' });
    }
  }
  return { booked, failed };
}

module.exports = { create, list, setActive, remove, generateDue };
