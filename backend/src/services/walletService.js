const { pool } = require('../config/db');
const { ApiError } = require('../utils/ApiError');
const { simulatedPaymentsEnabled } = require('../config/features');

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
  // Adding money is a simulation (free money). Production has no payment
  // gateway yet, so it refuses unless explicitly switched on for a demo.
  if (!simulatedPaymentsEnabled()) {
    throw new ApiError(403, 'Adding money is not available yet — online payments are coming soon');
  }
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

/**
 * Accounting self-check. Returns every place the books disagree:
 *  - wallets whose balance != opening baseline + sum of their ledger rows
 *  - TeslaPay payments marked PAID whose ledger rows don't add up to the fare
 * An empty result is the healthy state. Run nightly (jobs.js) and on demand
 * (scripts/reconcile.js, GET /admin/reconcile).
 */
async function reconcile() {
  const { rows: wallets } = await pool.query(
    `SELECT w.user_id, w.balance_paisa, w.ledger_baseline_paisa,
            COALESCE(SUM(t.amount_paisa), 0) AS ledger_sum
     FROM wallets w LEFT JOIN wallet_transactions t ON t.user_id = w.user_id
     GROUP BY w.user_id, w.balance_paisa, w.ledger_baseline_paisa
     HAVING w.balance_paisa <> w.ledger_baseline_paisa + COALESCE(SUM(t.amount_paisa), 0)`,
  );
  const { rows: payments } = await pool.query(
    `SELECT p.ride_request_id, p.amount_paisa,
            COALESCE(SUM(t.amount_paisa) FILTER (WHERE t.kind = 'RIDE_PAYMENT'), 0) AS paid_out,
            COALESCE(SUM(t.amount_paisa) FILTER (WHERE t.kind = 'RIDE_EARNING'), 0) AS earned
     FROM payments p LEFT JOIN wallet_transactions t ON t.ride_request_id = p.ride_request_id
     WHERE p.method = 'TESLAPAY' AND p.status = 'PAID'
     GROUP BY p.ride_request_id, p.amount_paisa
     HAVING COALESCE(SUM(t.amount_paisa) FILTER (WHERE t.kind = 'RIDE_PAYMENT'), 0) <> -p.amount_paisa
         OR COALESCE(SUM(t.amount_paisa) FILTER (WHERE t.kind = 'RIDE_EARNING'), 0) <> p.amount_paisa`,
  );
  return {
    ok: wallets.length === 0 && payments.length === 0,
    walletMismatches: wallets.map((w) => ({
      userId: w.user_id,
      balancePaisa: Number(w.balance_paisa),
      expectedPaisa: Number(w.ledger_baseline_paisa) + Number(w.ledger_sum),
    })),
    paymentMismatches: payments.map((p) => ({ rideRequestId: p.ride_request_id, amountPaisa: Number(p.amount_paisa), paidOut: Number(p.paid_out), earned: Number(p.earned) })),
  };
}

module.exports = { getWallet, topUp, reconcile, settleRidePayment, balanceFor, MIN_TOPUP_PAISA, MAX_TOPUP_PAISA };
