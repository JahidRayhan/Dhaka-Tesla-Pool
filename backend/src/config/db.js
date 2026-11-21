const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  // A crashed idle client shouldn't crash the whole process.
  console.error('Unexpected error on idle PG client', err);
});

// Hooks queued with utils/tx.afterCommit belong to ONE transaction. If it rolled
// back, or the function simply returned the connection, they must never fire on
// whatever transaction uses this pooled connection next — so releasing discards them.
// pg calls connect() in two shapes (promise, and callback — pool.query uses the
// callback form internally), so both must keep working.
function discardHooksOnRelease(client) {
  const originalRelease = client.release.bind(client);
  client.release = (...args) => {
    /** @type {any} */ (client).__afterCommit = [];
    return originalRelease(...args);
  };
  return client;
}
const originalConnect = pool.connect.bind(pool);
/** @type {any} */ (pool).connect = (callback) => {
  if (typeof callback === 'function') {
    return originalConnect((err, client, done) => callback(err, client && discardHooksOnRelease(client), done));
  }
  return originalConnect().then(discardHooksOnRelease);
};

module.exports = { pool };
