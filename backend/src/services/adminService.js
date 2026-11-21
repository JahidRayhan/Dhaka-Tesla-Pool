const { pool } = require('../config/db');
const { ApiError } = require('../utils/ApiError');
const walletService = require('./walletService');

/** At-a-glance health of the service for the admin console. */
async function stats() {
  const [{ rows: users }, { rows: rides }, { rows: pools }, { rows: money }, { rows: drivers }] = await Promise.all([
    pool.query(`SELECT role, count(*)::int AS n FROM users GROUP BY role`),
    pool.query(`SELECT status, count(*)::int AS n FROM ride_requests WHERE requested_at > now() - interval '30 days' GROUP BY status`),
    pool.query(`SELECT status, count(*)::int AS n FROM pools GROUP BY status`),
    pool.query(`SELECT method, status, kind, count(*)::int AS n, COALESCE(sum(amount_paisa), 0)::bigint AS amount FROM payments GROUP BY method, status, kind`),
    pool.query(`SELECT status, count(*)::int AS n FROM driver_profiles GROUP BY status`),
  ]);
  const toMap = (rows, key = 'status') => Object.fromEntries(rows.map((r) => [r[key], r.n]));
  return {
    users: toMap(users, 'role'),
    ridesLast30Days: toMap(rides),
    pools: toMap(pools),
    driverVerification: toMap(drivers),
    payments: money.map((m) => ({ method: m.method, status: m.status, kind: m.kind, count: m.n, amountPaisa: Number(m.amount) })),
  };
}

/** @param {{ status?: string, limit?: number, offset?: number }} [options] */
async function listRides({ status, limit = 50, offset = 0 } = {}) {
  const allowed = ['REQUESTED', 'PENDING_CONFIRMATION', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED'];
  if (status !== undefined && !allowed.includes(status)) throw new ApiError(422, `status must be one of ${allowed.join(', ')}`);
  const { rows } = await pool.query(
    `SELECT rr.id, rr.status, rr.requested_at, rr.final_fare_paisa, rr.seats_requested, rr.payment_method,
            u.name AS passenger_name, pz.name AS pickup, dz.name AS destination, rr.pool_id
     FROM ride_requests rr JOIN users u ON u.id = rr.passenger_id
     JOIN zones pz ON pz.id = rr.pickup_zone_id JOIN zones dz ON dz.id = rr.destination_zone_id
     WHERE ($1::text IS NULL OR rr.status::text = $1)
     ORDER BY rr.requested_at DESC, rr.id LIMIT $2 OFFSET $3`,
    [status ?? null, limit, offset],
  );
  return rows;
}

/** The full story of one ride: the ride, its payment and ledger rows, and every status change — for disputes. */
async function rideDetail(id) {
  const { rows: [ride] } = await pool.query(
    `SELECT rr.*, u.name AS passenger_name, u.email AS passenger_email, pz.name AS pickup, dz.name AS destination,
            t.name AS tesla_name, du.name AS driver_name
     FROM ride_requests rr JOIN users u ON u.id = rr.passenger_id
     JOIN zones pz ON pz.id = rr.pickup_zone_id JOIN zones dz ON dz.id = rr.destination_zone_id
     LEFT JOIN pools p ON p.id = rr.pool_id LEFT JOIN teslas t ON t.id = p.tesla_id LEFT JOIN users du ON du.id = t.driver_id
     WHERE rr.id = $1`,
    [id],
  );
  if (!ride) throw new ApiError(404, 'Ride not found');
  const [{ rows: payment }, { rows: ledger }, { rows: history }, { rows: consents }] = await Promise.all([
    pool.query('SELECT * FROM payments WHERE ride_request_id = $1', [id]),
    pool.query('SELECT user_id, kind, amount_paisa, created_at FROM wallet_transactions WHERE ride_request_id = $1 ORDER BY created_at', [id]),
    pool.query(`SELECT entity_type, from_status, to_status, changed_by, note, changed_at FROM status_history WHERE (entity_type = 'ride_request' AND entity_id = $1) OR (entity_type = 'pool' AND entity_id = $2) ORDER BY changed_at, id`, [id, ride.pool_id]),
    pool.query('SELECT proposal_id, member_request_id, decision, created_at, decided_at FROM pool_join_consents WHERE joiner_request_id = $1 OR member_request_id = $1 ORDER BY created_at', [id]),
  ]);
  const { password_hash, ...safe } = ride;
  return { ride: safe, payment: payment[0] || null, ledger, history, consents };
}

const reconcile = () => walletService.reconcile();

module.exports = { stats, listRides, rideDetail, reconcile };
