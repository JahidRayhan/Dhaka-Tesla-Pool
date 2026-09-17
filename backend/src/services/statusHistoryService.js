/**
 * Writes one audit row. Must be called with a `client` that is inside the
 * same transaction as the status change itself, so the log and the state
 * it describes can never disagree (Section 2: "hold onto enough history to
 * explain exactly what happened").
 */
async function logTransition(client, { entityType, entityId, fromStatus, toStatus, changedBy, note }) {
  await client.query(
    `INSERT INTO status_history (entity_type, entity_id, from_status, to_status, changed_by, note)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [entityType, entityId, fromStatus, toStatus, changedBy, note || null],
  );
}

module.exports = { logTransition };
