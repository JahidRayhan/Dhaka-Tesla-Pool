-- 009: idempotency keys. A phone on a flaky network retries; a double tap
-- happens. A client sends `Idempotency-Key: <uuid>` on a POST and the server
-- guarantees the action runs at most once: a repeat returns the first result.
CREATE TABLE idempotency_keys (
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key           TEXT        NOT NULL,
  request_hash  TEXT        NOT NULL,   -- method + path + body; a reused key with a different request is an error
  status_code   INT,                     -- NULL while the first request is still running
  response_body JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idx_idempotency_created ON idempotency_keys (created_at);
