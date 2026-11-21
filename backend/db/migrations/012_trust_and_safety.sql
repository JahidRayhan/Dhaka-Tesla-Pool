-- 012: the pieces strangers sharing a small vehicle need in order to trust it.

-- Self-declared; only used so a passenger can ask for women-only pooling.
ALTER TABLE users ADD COLUMN gender TEXT CHECK (gender IN ('female', 'male', 'other'));
-- The language of notifications the server writes (push messages, SMS).
ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'bn'));

-- A driver's credentials, reviewed by an admin. No row = never submitted.
CREATE TABLE driver_profiles (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  license_number TEXT        NOT NULL CHECK (length(license_number) BETWEEN 3 AND 40),
  vehicle_plate  TEXT        NOT NULL CHECK (length(vehicle_plate) BETWEEN 3 AND 20),
  status         TEXT        NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by    UUID REFERENCES users(id),
  reviewed_at    TIMESTAMPTZ,
  review_note    TEXT
);
CREATE INDEX idx_driver_profiles_status ON driver_profiles (status);

-- Both sides rate each completed ride, once.
CREATE TABLE ratings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_request_id UUID        NOT NULL REFERENCES ride_requests(id) ON DELETE CASCADE,
  rater_id        UUID        NOT NULL REFERENCES users(id),
  ratee_id        UUID        NOT NULL REFERENCES users(id),
  stars           SMALLINT    NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment         TEXT CHECK (length(comment) <= 500),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT one_rating_per_rater_per_ride UNIQUE (ride_request_id, rater_id),
  CONSTRAINT cannot_rate_yourself CHECK (rater_id <> ratee_id)
);
CREATE INDEX idx_ratings_ratee ON ratings (ratee_id);

-- "Share my trip": an unguessable link a friend can open without an account.
-- Only the SHA-256 of the token is stored, so a database leak does not leak links.
CREATE TABLE trip_shares (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      TEXT        NOT NULL UNIQUE,
  ride_request_id UUID        NOT NULL REFERENCES ride_requests(id) ON DELETE CASCADE,
  created_by      UUID        NOT NULL REFERENCES users(id),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_trip_shares_ride ON trip_shares (ride_request_id);

-- Fixed, well-known pickup spots inside a zone. Pooling works when people meet
-- the vehicle at a few predictable places instead of anywhere in a neighbourhood.
CREATE TABLE meeting_points (
  id        SERIAL PRIMARY KEY,
  zone_id   INTEGER          NOT NULL REFERENCES zones(id),
  name      VARCHAR(80)      NOT NULL,
  latitude  DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  CONSTRAINT meeting_point_unique UNIQUE (zone_id, name)
);
ALTER TABLE ride_requests ADD COLUMN pickup_point_id INTEGER REFERENCES meeting_points(id);
