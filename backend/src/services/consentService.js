const crypto = require('crypto');
const { commit } = require('../utils/tx');
const { notifyAfterCommit } = require('./notificationService');
const { retrying } = require('../utils/retryTx');
const { pool: db } = require('../config/db');
const { ApiError } = require('../utils/ApiError');
const { logTransition } = require('./statusHistoryService');
const { CONSENT_TIMEOUT_MINUTES } = require('../config/timeouts');

/**
 * Opens a consent proposal for a joiner being added to a pool: one row per
 * existing member (asked "are you OK sharing with this person, going there?")
 * plus one for the joiner themselves. All rows share a proposal_id so each
 * round of asking resolves independently of any earlier one.
 *
 * Must run inside the caller's transaction — the invitation and the seat
 * reservation that accompanies it either both happen or neither does.
 */
async function createProposal(client, joinerRequestId, existingMemberRequestIds, preApprovedRequestIds = []) {
  const proposalId = crypto.randomUUID();
  // A passenger who said up front "I'm fine sharing with up to N people" is
  // recorded as already ACCEPTED for a proposal inside that limit, so they are
  // never interrupted with a question they have already answered.
  await client.query(
    `INSERT INTO pool_join_consents (proposal_id, joiner_request_id, member_request_id, decision, decided_at)
     SELECT $1, $2, m,
            (CASE WHEN m = ANY($4::uuid[]) THEN 'ACCEPTED' ELSE 'PENDING' END)::consent_decision,
            CASE WHEN m = ANY($4::uuid[]) THEN now() END
     FROM unnest($3::uuid[]) AS m`,
    [proposalId, joinerRequestId, [...existingMemberRequestIds, joinerRequestId], preApprovedRequestIds],
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
/** The passengers already in the pool who were asked about this proposal (not the newcomer). */
async function memberPassengerIds(client, proposalId) {
  const { rows } = await client.query(
    `SELECT DISTINCT rr.passenger_id FROM pool_join_consents c JOIN ride_requests rr ON rr.id = c.member_request_id
     WHERE c.proposal_id = $1 AND c.member_request_id <> c.joiner_request_id`,
    [proposalId],
  );
  return rows.map((r) => r.passenger_id);
}

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

  // EXPIRED (nobody answered in time) is treated exactly like a decline.
  if (active.some((r) => r.decision === 'DECLINED' || r.decision === 'EXPIRED')) {
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
    const timedOut = active.some((r) => r.decision === 'EXPIRED');
    if (timedOut) {
      notifyAfterCommit(client, [joiner.passenger_id, ...(await memberPassengerIds(client, proposalId))], 'SHARE_EXPIRED', { rideRequestId: joinerRequestId });
    } else {
      notifyAfterCommit(client, [joiner.passenger_id], 'SHARE_REJECTED', { rideRequestId: joinerRequestId });
    }
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
    notifyAfterCommit(client, [joiner.passenger_id, ...(await memberPassengerIds(client, proposalId))], 'SHARE_ACCEPTED', { rideRequestId: joinerRequestId });
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
    throw new ApiError(409, 'This sharing decision has already been answered, timed out, or is no longer needed');
  }

  await client.query(`UPDATE pool_join_consents SET decision = $2, decided_at = now() WHERE id = $1`, [
    consentId,
    decision,
  ]);
  return resolveProposal(client, consent.proposal_id, passengerId, note);
}

/** An existing member (or anyone with a pending decision) approves or rejects a proposed joiner. */
async function respond(passengerId, consentId, decision, note) {
  // A late answer to an expired proposal must find it already closed.
  await expireStaleProposals();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const outcome = await applyDecision(client, consentId, passengerId, decision, note);
    await commit(client);
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
  await expireStaleProposals();
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
    await commit(client);
    return outcome;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Closes every proposal that has been open longer than the fixed timeout.
 * Each one is handled in its own transaction under the joiner's row lock, so a
 * last-second answer and the expiry cannot both win: whichever takes the lock
 * first decides, and the other sees the proposal already resolved.
 *
 * Idempotent and safe to call from anywhere, any number of times. Returns how
 * many joiners were sent back to the queue.
 */
async function expireStaleProposals() {
  const { rows: stale } = await db.query(
    `SELECT DISTINCT proposal_id, joiner_request_id
     FROM pool_join_consents
     WHERE decision = 'PENDING' AND created_at < now() - make_interval(mins => $1)`,
    [CONSENT_TIMEOUT_MINUTES],
  );

  let rejected = 0;
  for (const { proposal_id: proposalId, joiner_request_id: joinerId } of stale) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT id FROM ride_requests WHERE id = $1 FOR UPDATE`, [joinerId]);
      // Re-check under the lock: the proposal may have been answered or
      // withdrawn while we were waiting for it.
      const { rowCount } = await client.query(
        `UPDATE pool_join_consents SET decision = 'EXPIRED', decided_at = now()
         WHERE proposal_id = $1 AND decision = 'PENDING'
           AND created_at < now() - make_interval(mins => $2)`,
        [proposalId, CONSENT_TIMEOUT_MINUTES],
      );
      if (rowCount > 0) {
        const outcome = await resolveProposal(
          client,
          proposalId,
          null, // the system, not a person, made this change
          `sharing proposal timed out after ${CONSENT_TIMEOUT_MINUTES} minutes without everyone agreeing`,
        );
        if (outcome === 'REJECTED') rejected += 1;
      }
      await commit(client);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  return rejected;
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
const expiryOf = (createdAt) => new Date(new Date(createdAt).getTime() + CONSENT_TIMEOUT_MINUTES * 60 * 1000);

async function loadConsentContext(requestIds) {
  if (requestIds.length === 0) return { asked: new Map(), waiting: new Map(), ownPending: new Set(), expires: new Map() };

  const { rows: askedRows } = await db.query(
    `SELECT c.id, c.member_request_id, c.created_at, u.name AS joiner_name,
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
    `SELECT c.joiner_request_id, c.created_at, u.name AS member_name
     FROM pool_join_consents c
     JOIN ride_requests mr ON mr.id = c.member_request_id
     JOIN users u ON u.id = mr.passenger_id
     WHERE c.joiner_request_id = ANY($1::uuid[])
       AND c.member_request_id <> c.joiner_request_id
       AND c.decision = 'PENDING'`,
    [requestIds],
  );

  const { rows: ownRows } = await db.query(
    `SELECT joiner_request_id, created_at FROM pool_join_consents
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
      expiresAt: expiryOf(r.created_at),
    });
  }
  // When each still-open proposal for a joiner runs out (the earliest wins).
  const expires = new Map();
  for (const r of [...waitingRows, ...ownRows]) {
    const at = expiryOf(r.created_at);
    if (!expires.has(r.joiner_request_id) || at < expires.get(r.joiner_request_id)) {
      expires.set(r.joiner_request_id, at);
    }
  }
  const waiting = new Map();
  for (const r of waitingRows) {
    if (!waiting.has(r.joiner_request_id)) waiting.set(r.joiner_request_id, []);
    waiting.get(r.joiner_request_id).push(r.member_name);
  }
  return { asked, waiting, ownPending: new Set(ownRows.map((r) => r.joiner_request_id)), expires };
}

module.exports = retrying(
  {
  createProposal,
  resolveProposal,
  respond,
  respondAsJoiner,
  handleCancelledRequest,
  expireStaleProposals,
  loadConsentContext,
  },
  ['respond', 'respondAsJoiner'],
);
