const { ApiError } = require('../utils/ApiError');

// Postgres error codes we want to translate into clean 4xx responses
// instead of leaking a raw 500 + SQL detail to the client.
const PG_ERROR_MESSAGES = {
  23505: 'A record with that value already exists.', // unique_violation
  23503: 'Referenced record does not exist.', // foreign_key_violation
  23514: 'That value violates a data constraint.', // check_violation
};

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: err.message,
      details: err.details,
    });
  }

  if (err.code && PG_ERROR_MESSAGES[err.code]) {
    return res.status(409).json({ error: PG_ERROR_MESSAGES[err.code] });
  }

  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = { errorHandler };
