-- 013: how a passenger wants to share, and when.

ALTER TABLE ride_requests
  -- "I'm happy to ride with up to N people in total (including me)". NULL = always ask me.
  -- Passengers who pre-approve are not interrupted by consent questions that fall
  -- inside what they already said yes to.
  ADD COLUMN share_max SMALLINT CHECK (share_max BETWEEN 2 AND 6),
  -- Only pool with women passengers (the passenger must have declared gender = female).
  ADD COLUMN women_only BOOLEAN NOT NULL DEFAULT false,
  -- A ride for later. Hidden from drivers until shortly before this time.
  ADD COLUMN scheduled_for TIMESTAMPTZ,
  -- "I can wait up to N minutes for a pool"; after that the request is cancelled
  -- instead of lingering on the board forever.
  ADD COLUMN max_wait_minutes SMALLINT CHECK (max_wait_minutes BETWEEN 5 AND 240),
  ADD COLUMN expires_at TIMESTAMPTZ;

CREATE INDEX idx_ride_requests_expiry ON ride_requests (expires_at)
  WHERE status = 'REQUESTED' AND expires_at IS NOT NULL;

-- A commute that repeats ("weekdays 08:30"). A background job turns each due
-- occurrence into an ordinary scheduled ride request shortly beforehand.
CREATE TABLE recurring_rides (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id        UUID     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pickup_zone_id      INTEGER  NOT NULL REFERENCES zones(id),
  destination_zone_id INTEGER  NOT NULL REFERENCES zones(id),
  seats_requested     SMALLINT NOT NULL DEFAULT 1 CHECK (seats_requested BETWEEN 1 AND 6),
  payment_method      payment_method NOT NULL DEFAULT 'CASH',
  days_of_week        SMALLINT[] NOT NULL CHECK (cardinality(days_of_week) BETWEEN 1 AND 7),  -- ISO: 1 = Monday ... 7 = Sunday
  time_of_day         TIME     NOT NULL,                                                      -- local time in Dhaka
  max_wait_minutes    SMALLINT CHECK (max_wait_minutes BETWEEN 5 AND 240),
  share_max           SMALLINT CHECK (share_max BETWEEN 2 AND 6),
  women_only          BOOLEAN  NOT NULL DEFAULT false,
  active              BOOLEAN  NOT NULL DEFAULT true,
  last_generated_on   DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recurring_zones_differ CHECK (pickup_zone_id <> destination_zone_id)
);
CREATE INDEX idx_recurring_active ON recurring_rides (active) WHERE active;
CREATE INDEX idx_recurring_passenger ON recurring_rides (passenger_id);
