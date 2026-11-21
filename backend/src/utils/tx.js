const logger = require('./logger');

/**
 * Work that must only happen if the transaction actually commits — chiefly
 * notifications ("your driver has arrived" must never be sent for a change that
 * was then rolled back). Queue it while the transaction runs; `commit()` runs it
 * afterwards. Hooks never run on rollback (config/db.js discards them when the
 * connection is released), and a failing hook can never undo or delay the commit
 * it follows.
 *
 * @param {import('pg').PoolClient} client
 * @param {() => Promise<void> | void} fn
 */
function afterCommit(client, fn) {
  const c = /** @type {any} */ (client);
  (c.__afterCommit ||= []).push(fn);
}

/** COMMIT, then run queued hooks. @param {import('pg').PoolClient} client */
async function commit(client) {
  await client.query('COMMIT');
  const c = /** @type {any} */ (client);
  const hooks = c.__afterCommit || [];
  c.__afterCommit = [];
  for (const hook of hooks) {
    try {
      await hook();
    } catch (err) {
      logger.warn('after-commit hook failed', { err });
    }
  }
}

module.exports = { afterCommit, commit };
