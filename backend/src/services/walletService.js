const { pool } = require('../config/db');
const { ApiError } = require('../utils/ApiError');

// Simulated top-up limits, in paisa: ৳1 minimum, ৳10,000 per top-up.
const MIN_TOPUP_PAISA = 100;
const MAX_TOPUP_PAISA = 1_000_000;

async function ensureWallet(client, userId) {
  await client.query(
    `INSERT INTO wallets (user_id, balance_paisa) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
}

async function getWallet(userId) {
  await ensureWallet(pool, userId);
  const { rows } = await pool.query('SELECT balance_paisa FROM wallets WHERE user_id = $1', [userId]);
  const { rows: transactions } = await pool.query(
    `SELECT id, kind, amount_paisa, ride_request_id, created_at
     FROM wallet_transactions WHERE user_id = $1
     ORDER BY created_at DESC, id DESC LIMIT 10`,
    [userId],
  );
  return { balancePaisa: Number(rows[0].balance_paisa), transactions };
}

async function topUp(userId, amountPaisa) {
  if (!Number.isInteger(amountPaisa) || amountPaisa < MIN_TOPUP_PAISA || amountPaisa > MAX_TOPUP_PAISA) {
    throw new ApiError(422, `amountPaisa must be a whole number between ${MIN_TOPUP_PAISA} and ${MAX_TOPUP_PAISA}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureWallet(client, userId);
    const { rows } = await client.query(
      `UPDATE wallets SET balance_paisa = balance_paisa + $2, updated_at = now()
       WHERE user_id = $1 RETURNING balance_paisa`,
      [userId, amountPaisa],
    );
    await client.query(
      `INSERT INTO wallet_transactions (user_id, kind, amount_paisa) VALUES ($1, 'TOPUP', $2)`,
      [userId, amountPaisa],
    );
    await client.query('COMMIT');
    return { balancePaisa: Number(rows[0].balance_paisa) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Move one ride's fare from the passenger's wallet to the driver's, inside the
 * caller's transaction (the one completing the trip) so a trip can never be
 * "completed but unpaid" or "paid but not completed".
 *
 * The debit is a single conditional UPDATE (`balance >= amount`), the same
 * pattern as the seat-capacity guard: two concurrent debits cannot both pass
 * a stale balance check, and the CHECK (balance_paisa >= 0) on the table is a
 * second line of defence.
 *
 * Returns true if settled, false if the passenger's balance was too low (the
 * caller then falls back to a pending cash payment — completing the trip
 * matters more than the payment method).
 */
async function settleRidePayment(client, { rideRequestId, passengerId, driverId, amountPaisa }) {
  if (amountPaisa === 0) return true; // nothing to move

  const debit = await client.query(
    `UPDATE wallets SET balance_paisa = balance_paisa - $2, updated_at = now()
     WHERE user_id = $1 AND balance_paisa >= $2
     RETURNING id`,
    [passengerId, amountPaisa],
  );
  if (debit.rows.length === 0) return false;

  await ensureWallet(client, driverId);
  await client.query(
    `UPDATE wallets SET balance_paisa = balance_paisa + $2, updated_at = now() WHERE user_id = $1`,
    [driverId, amountPaisa],
  );
  await client.query(
    `INSERT INTO wallet_transactions (user_id, kind, amount_paisa, ride_request_id)
     VALUES ($1, 'RIDE_PAYMENT', $3, $5), ($2, 'RIDE_EARNING', $4, $5)`,
    [passengerId, driverId, -amountPaisa, amountPaisa, rideRequestId],
  );
  return true;
}

async function balanceFor(client, userId) {
  const { rows } = await client.query('SELECT balance_paisa FROM wallets WHERE user_id = $1', [userId]);
  return rows.length ? Number(rows[0].balance_paisa) : 0;
}

module.exports = { getWallet, topUp, settleRidePayment, balanceFor, MIN_TOPUP_PAISA, MAX_TOPUP_PAISA };
