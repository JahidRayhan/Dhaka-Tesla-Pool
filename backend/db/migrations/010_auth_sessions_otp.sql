-- 010: real sessions and phone-based verification.
--
-- Access tokens become short-lived (minutes). A long-lived REFRESH token, stored
-- only as a hash and rotated on every use, keeps people signed in — and can be
-- revoked, which a bare 7-day JWT never could.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- One sign-in = one family. Every rotation stays in the family; presenting an
  -- already-used token means it was stolen or replayed, so the whole family dies.
  family_id   UUID        NOT NULL,
  token_hash  TEXT        NOT NULL UNIQUE,   -- sha256 of the token; the token itself is never stored
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  replaced_by UUID,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user   ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens (family_id);

-- One-time codes sent by SMS (phone verification and password reset).
CREATE TABLE otp_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose     TEXT        NOT NULL CHECK (purpose IN ('VERIFY_PHONE', 'RESET_PASSWORD')),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone       TEXT        NOT NULL,
  code_hash   TEXT        NOT NULL,          -- HMAC of the code; the 6 digits are never stored
  attempts    SMALLINT    NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_otp_user_purpose ON otp_codes (user_id, purpose, created_at DESC);

-- Shared counters for rate limiting, so the limit holds across several API
-- instances (an in-memory counter only counts what one process saw).
CREATE TABLE rate_limits (
  key      TEXT PRIMARY KEY,
  count    INT         NOT NULL,
  reset_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_rate_limits_reset ON rate_limits (reset_at);
