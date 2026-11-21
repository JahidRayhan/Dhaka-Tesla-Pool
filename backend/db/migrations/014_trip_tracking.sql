-- 014: where the vehicle is, and what happens when a passenger never shows up.

-- The driver app reports its position while a pool is live.
ALTER TABLE pools
  ADD COLUMN last_latitude  DOUBLE PRECISION,
  ADD COLUMN last_longitude DOUBLE PRECISION,
  ADD COLUMN last_location_at TIMESTAMPTZ;

-- A no-show is charged a small fee instead of a fare; the payment row says which.
ALTER TABLE payments ADD COLUMN kind TEXT NOT NULL DEFAULT 'FARE' CHECK (kind IN ('FARE', 'NO_SHOW_FEE'));
