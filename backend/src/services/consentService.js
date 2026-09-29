const crypto = require('crypto');
const { pool: db } = require('../config/db');
const { ApiError } = require('../utils/ApiError');
const { logTransition } = require('./statusHistoryService');

/**
 * Opens a consent proposal for a joiner being added to a pool: one row per
 * existing member (asked "are you OK sharing with this person, going there?")
 * plus one for the joiner themselves. All rows share a proposal_id so each
 * round of asking resolves independently of any earlier one.
 *
 * Must run inside the caller's transaction — the invitation and the seat
 * reservation that accompanies it either both happen or neither does.
 */
async function createProposal(client, joinerRequestId, existingMemberRequestIds) {
  const proposalId = crypto.randomUUID();
  await client.query(
    `INSERT INTO pool_join_consents (proposal_id, joiner_request_id, member_request_id)
     SELECT $1, $2, unnest($3::uuid[])`,
    [proposalId, joinerRequestId, [...existingMemberRequestIds, joinerRequestId]],
  );
  return proposalId;
}

/**
 * Looks at every still-relevant answer in a proposal and acts on the joiner:
 *  - anyone DECLINED  -> the joiner is removed from the pool (seat freed) and
 *                        returns to REQUESTED, free to be offered elsewhere
 *  - everyone ACCEPTED -> the joiner becomes MATCHED
 *  - otherwise         -> still waiting on someone; nothing changes
 *
 * VOID rows (a party who cancelled, or a proposal withdrawn) are ignored, so
 * a member cancelling mid-proposal can never leave the joiner stuck waiting
 * on an answer that will never come.
 *
 * Caller must already hold a lock on the joiner's ride_request row so
 * simultaneous answers from different parties resolve one at a time.
 */
async function resolveProposal(client, proposalId, changedBy, note) {
  const { rows } = await client.query(
    `SELECT joiner_request_id, decision FROM pool_join_consents WHERE proposal_id = $1`,
    [proposalId],
  );
  const active = rows.filter((r) => r.decision !== 'VOID');
  if (active.length === 0) return 'NOTHING';

  const joinerRequestId = rows[0].joiner_request_id;
  const { rows: joinerRows } = await client.query(`SELECT * FROM ride_requests WHERE id = $1`, [joinerRequestId]);
  const joiner = joinerRows[0];
  // Already resolved some other way (declined, cancelled, promoted) — nothing left to do.
  if (!joiner || joiner.status !== 'PENDING_CONFIRMATION') return 'NOTHING';

  if (active.some((r) => r.decision === 'DECLINED')) {
    // Free the reserved seat atomically and hand the request back to the open pool.
    await client.query(`UPDATE pools SET seats_occupied = seats_occupied - $1 WHERE id = $2`, [
      joiner.seats_requested,
      joiner.pool_id,
    ]);
    await client.query(`UPDATE ride_requests SET status = 'REQUESTED', pool_id = NULL WHERE id = $1`, [
      joinerRequestId,
    ]);
    await client.query(
      `UPDATE pool_join_consents SET decision = 'VOID', decided_at = now()
       WHERE proposal_id = $1 AND decision = 'PENDING'`,
      [proposalId],
    );
    await logTransition(client, {
      entityType: 'ride_request',
      entityId: joinerRequestId,
      fromStatus: 'PENDING_CONFIRMATION',
      toStatus: 'REQUESTED',
      changedBy,
      note: note || 'someone in the pool declined the proposed sharing',
    });
    return 'REJECTED';
  }

  if (active.every((r) => r.decision === 'ACCEPTED')) {
    await client.query(`UPDATE ride_requests SET status = 'MATCHED', matched_at = now() WHERE id = $1`, [
      joinerRequestId,
    ]);
    await logTransition(client, {
      entityType: 'ride_request',
      entityId: joinerRequestId,
      fromStatus: 'PENDING_CONFIRMATION',
      toStatus: 'MATCHED',
      changedBy,
      note: 'everyone in the pool agreed to share',
    });
    return 'PROMOTED';
  }

  return 'WAITING';
}

/**
 * Records one party's answer to a proposal and resolves it if that answer was
 * the deciding one. Runs inside the caller's transaction.
 */
async function applyDecision(client, consentId, passengerId, decision, note) {
  const { rows } = await client.query(
    `SELECT c.*, mr.passenger_id AS member_passenger_id
     FROM pool_join_consents c
     JOIN ride_requests mr ON mr.id = c.member_request_id
     WHERE c.id = $1`,
    [consentId],
  );
  if (rows.length === 0) throw new ApiError(404, 'Sharing decision not found');
  const consent = rows[0];
  if (consent.member_passenger_id !== passengerId) {
    throw new ApiError(403, "That decision isn't yours to make");
  }

  // Serialize on the joiner's row, then re-read this consent under the lock —
  // two parties answering at once must resolve one after the other, not race.
  await client.query(`SELECT id FROM ride_requests WHERE id = $1 FOR UPDATE`, [consent.joiner_request_id]);
  const { rows: fresh } = await client.query(
    `SELECT decision FROM pool_join_consents WHERE id = $1 FOR UPDATE`,
    [consentId],
  );
  if (fresh[0].decision !== 'PENDING') {
    throw new ApiError(409, 'This sharing decision has already been answered or is no longer needed');
  }

  await client.query(`UPDATE pool_join_consents SET decision = $2, decided_at = now() WHERE id = $1`, [
    consentId,
    decision,
  ]);
  return resolveProposal(client, consent.proposal_id, passengerId, note);
}

/** An existing member (or anyone with a pending decision) approves or rejects a proposed joiner. */
async function respond(passengerId, consentId, decision, note) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const outcome = await applyDecision(client, consentId, passengerId, decision, note);
    await client.query('COMMIT');
    return outcome;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The joiner answering for themselves. Keeps the ride_request-shaped errors
 * the joiner-facing endpoints have always had (404 / 403 / 409), then
 * delegates to the same decision logic every other party uses.
 */
async function respondAsJoiner(passengerId, requestId, decision, note) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`SELECT * FROM ride_requests WHERE id = $1`, [requestId]);
    if (rows.length === 0) throw new ApiError(404, 'Ride request not found');
    const rideRequest = rows[0];
    if (rideRequest.passenger_id !== passengerId) throw new ApiError(403, "That ride isn't yours");
    if (rideRequest.status !== 'PENDING_CONFIRMATION') {
      throw new ApiError(409, `Ride request is '${rideRequest.status}', not awaiting confirmation`);
    }

    const { rows: own } = await client.query(
      `SELECT id FROM pool_join_consents
       WHERE joiner_request_id = $1 AND member_request_id = $1 AND decision = 'PENDING'`,
      [requestId],
    );
    if (own.length === 0) {
      throw new ApiError(409, 'You have already answered — waiting on the others in the pool');
    }

    const outcome = await applyDecision(client, own[0].id, passengerId, decision, note);
    await client.query('COMMIT');
    return outcome;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Called when a ride_request is cancelled. Any proposal that request was
 * part of has to be tidied so nobody is left waiting on an answer that can
 * never arrive:
 *  - if it was the JOINER, its open questions are simply withdrawn (VOID)
 *  - if it was an existing MEMBER being asked, its open question is withdrawn
 *    and each affected proposal is re-evaluated — if theirs was the only
 *    answer still outstanding, the joiner may now be fully approved
 */
async function handleCancelledRequest(client, requestId, changedBy) {
  await client.query(
    `UPDATE pool_join_consents SET decision = 'VOID', decided_at = now()
     WHERE joiner_request_id = $1 AND decision = 'PENDING'`,
    [requestId],
  );

  const { rows: affected } = await client.query(
    `UPDATE pool_join_consents SET decision = 'VOID', decided_at = now()
     WHERE member_request_id = $1 AND joiner_request_id <> $1 AND decision = 'PENDING'
     RETURNING proposal_id, joiner_request_id`,
    [requestId],
  );

  const seen = new Set();
  for (const { proposal_id: proposalId, joiner_request_id: joinerId } of affected) {
    if (seen.has(proposalId)) continue;
    seen.add(proposalId);
    await client.query(`SELECT id FROM ride_requests WHERE id = $1 FOR UPDATE`, [joinerId]);
    await resolveProposal(client, proposalId, changedBy, 'a member of the pool cancelled while a proposal was open');
  }
}

/**
 * For a batch of the viewing passenger's own ride_requests, what each one is
 * currently being asked (as an EXISTING member, about a proposed newcomer)
 * and, for one still pending itself (as the JOINER), who hasn't answered yet.
 * Names and destinations only — never fares, which stay each passenger's own.
 */
async function loadConsentContext(requestIds) {
  if (requestIds.length === 0) return { asked: new Map(), waiting: new Map(), ownPending: new Set() };

  const { rows: askedRows } = await db.query(
    `SELECT c.id, c.member_request_id, u.name AS joiner_name,
            pz.name AS joiner_pickup, dz.name AS joiner_destination
     FROM pool_join_consents c
     JOIN ride_requests jr ON jr.id = c.joiner_request_id
     JOIN users u ON u.id = jr.passenger_id
     JOIN zones pz ON pz.id = jr.pickup_zone_id
     JOIN zones dz ON dz.id = jr.destination_zone_id
     WHERE c.member_request_id = ANY($1::uuid[])
       AND c.joiner_request_id <> c.member_request_id
       AND c.decision = 'PENDING'`,
    [requestIds],
  );

  const { rows: waitingRows } = await db.query(
    `SELECT c.joiner_request_id, u.name AS member_name
     FROM pool_join_consents c
     JOIN ride_requests mr ON mr.id = c.member_request_id
     JOIN users u ON u.id = mr.passenger_id
     WHERE c.joiner_request_id = ANY($1::uuid[])
       AND c.member_request_id <> c.joiner_request_id
       AND c.decision = 'PENDING'`,
    [requestIds],
  );

  const { rows: ownRows } = await db.query(
    `SELECT joiner_request_id FROM pool_join_consents
     WHERE joiner_request_id = ANY($1::uuid[])
       AND member_request_id = joiner_request_id AND decision = 'PENDING'`,
    [requestIds],
  );

  const asked = new Map();
  for (const r of askedRows) {
    if (!asked.has(r.member_request_id)) asked.set(r.member_request_id, []);
    asked.get(r.member_request_id).push({
      id: r.id,
      joinerName: r.joiner_name,
      joinerPickup: r.joiner_pickup,
      joinerDestination: r.joiner_destination,
    });
  }
  const waiting = new Map();
  for (const r of waitingRows) {
    if (!waiting.has(r.joiner_request_id)) waiting.set(r.joiner_request_id, []);
    waiting.get(r.joiner_request_id).push(r.member_name);
  }
  return { asked, waiting, ownPending: new Set(ownRows.map((r) => r.joiner_request_id)) };
}

module.exports = {
  createProposal,
  respond,
  respondAsJoiner,
  handleCancelledRequest,
  loadConsentContext,
};
