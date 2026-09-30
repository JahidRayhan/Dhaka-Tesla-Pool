const { ApiError } = require('../utils/ApiError');

// Postgres error codes we want to translate into clean 4xx responses
// instead of leaking a raw 500 + SQL detail to the client.
const PG_ERROR_MESSAGES = {
  23505: 'A record with that value already exists.', // unique_violation
  23503: 'Referenced record does not exist.', // foreign_key_violation
  23514: 'That value violates a data constraint.', // check_violation
};

// Client-side input errors that Postgres reports with its own codes. These
// are the caller's fault, so 400 — not a 500 that pages someone.
const PG_BAD_INPUT_CODES = new Set([
  '22P02', // invalid_text_representation (e.g. "not-a-uuid" for a uuid column)
  '22003', // numeric_value_out_of_range
]);

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: err.message,
      details: err.details,
    });
  }

  // Body-parser and friends tag their errors with a 4xx status and
  // expose=true (malformed JSON -> 400, oversized body -> 413). Pass those
  // through with a safe message instead of turning them into a 500.
  if (err.expose && err.status >= 400 && err.status < 500) {
    const message = err.type === 'entity.parse.failed' ? 'Request body is not valid JSON' : err.message;
    return res.status(err.status).json({ error: message });
  }

  if (PG_BAD_INPUT_CODES.has(err.code)) {
    return res.status(400).json({ error: 'Invalid identifier or value format' });
  }

  if (err.code && PG_ERROR_MESSAGES[err.code]) {
    return res.status(409).json({ error: PG_ERROR_MESSAGES[err.code] });
  }

  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = { errorHandler };
