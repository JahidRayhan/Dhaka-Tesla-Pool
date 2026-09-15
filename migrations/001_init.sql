-- Dhaka Tesla Pool — Database Schema (PostgreSQL)
-- Cast used consistently in seed data / tests: Jashim (driver), Bullet (tesla),
-- Nusrat, Rafiq, Shirin (passengers).

-- ============================================================
-- ENUM TYPES
-- ============================================================

CREATE TYPE user_role AS ENUM ('passenger', 'driver', 'both');

CREATE TYPE ride_request_status AS ENUM (
  'REQUESTED',
  'MATCHED',
  'DRIVER_ARRIVED',
  'STARTED',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE pool_status AS ENUM (
  'MATCHED',
  'DRIVER_ARRIVED',
  'STARTED',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE payment_method AS ENUM ('CASH', 'TESLAPAY');
CREATE TYPE payment_status AS ENUM ('PENDING', 'PAID');

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(100) NOT NULL,
  email           VARCHAR(255) NOT NULL UNIQUE,
  phone           VARCHAR(20)  UNIQUE,
  password_hash   TEXT NOT NULL,
  role            user_role NOT NULL DEFAULT 'passenger',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Simulated TeslaPay wallet (Section 5 payment option)
CREATE TABLE wallets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance_paisa   BIGINT NOT NULL DEFAULT 0 CHECK (balance_paisa >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- ZONES (Section 4 — keep geography simple)
-- ============================================================

CREATE TABLE zones (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(50) NOT NULL UNIQUE,   -- Banani, Gulshan 1, Mohakhali, ...
  cluster         VARCHAR(50) NOT NULL,          -- coarse area group used by matching rule
  latitude        DOUBLE PRECISION NOT NULL,
  longitude       DOUBLE PRECISION NOT NULL
);

CREATE INDEX idx_zones_cluster ON zones(cluster);

-- ============================================================
-- TESLAS (vehicles)
-- ============================================================

CREATE TABLE teslas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            VARCHAR(50) NOT NULL,          -- "Bullet"
  capacity        SMALLINT NOT NULL CHECK (capacity > 0 AND capacity <= 6),
  is_active       BOOLEAN NOT NULL DEFAULT false, -- driver online/offline toggle
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_teslas_driver ON teslas(driver_id);
CREATE INDEX idx_teslas_active ON teslas(is_active) WHERE is_active = true;

-- ============================================================
-- POOLS (a single Tesla trip; may carry 1..capacity ride_requests)
-- ============================================================

CREATE TABLE pools (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tesla_id          UUID NOT NULL REFERENCES teslas(id),
  status            pool_status NOT NULL DEFAULT 'MATCHED',
  seats_occupied    SMALLINT NOT NULL DEFAULT 0 CHECK (seats_occupied >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  driver_arrived_at TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ
);

CREATE INDEX idx_pools_tesla ON pools(tesla_id);
CREATE INDEX idx_pools_status ON pools(status);

-- Defense-in-depth: seats_occupied can never exceed the Tesla's capacity.
-- (Primary enforcement is an app-level transaction with row locking —
-- see "Concurrency" in DESIGN.md — this trigger is a DB-level backstop.)
CREATE OR REPLACE FUNCTION check_pool_capacity() RETURNS TRIGGER AS $$
DECLARE
  cap SMALLINT;
BEGIN
  SELECT capacity INTO cap FROM teslas WHERE id = NEW.tesla_id;
  IF NEW.seats_occupied > cap THEN
    RAISE EXCEPTION 'pool % would exceed tesla capacity (% > %)', NEW.id, NEW.seats_occupied, cap;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pool_capacity
  BEFORE INSERT OR UPDATE OF seats_occupied ON pools
  FOR EACH ROW EXECUTE FUNCTION check_pool_capacity();

-- ============================================================
-- RIDE REQUESTS (one row per passenger's trip request)
-- ============================================================

CREATE TABLE ride_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id        UUID NOT NULL REFERENCES users(id),
  pickup_zone_id      INTEGER NOT NULL REFERENCES zones(id),
  destination_zone_id INTEGER NOT NULL REFERENCES zones(id),
  seats_requested     SMALLINT NOT NULL DEFAULT 1 CHECK (seats_requested > 0),
  status              ride_request_status NOT NULL DEFAULT 'REQUESTED',
  pool_id             UUID REFERENCES pools(id),

  -- fare breakdown, locked at MATCHED time (integer paisa)
  base_fare_paisa       BIGINT,
  distance_charge_paisa BIGINT,
  pool_discount_paisa   BIGINT DEFAULT 0,
  final_fare_paisa      BIGINT GENERATED ALWAYS AS
    (COALESCE(base_fare_paisa, 0) + COALESCE(distance_charge_paisa, 0) - COALESCE(pool_discount_paisa, 0))
    STORED,

  requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  matched_at           TIMESTAMPTZ,
  driver_arrived_at    TIMESTAMPTZ,
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  cancellation_reason  TEXT,

  CONSTRAINT chk_pickup_ne_destination CHECK (pickup_zone_id <> destination_zone_id)
);

CREATE INDEX idx_ride_requests_passenger ON ride_requests(passenger_id);
CREATE INDEX idx_ride_requests_pool ON ride_requests(pool_id);
CREATE INDEX idx_ride_requests_status ON ride_requests(status);

-- ============================================================
-- STATUS HISTORY (audit trail — "explain exactly what happened")
-- ============================================================

CREATE TABLE status_history (
  id              BIGSERIAL PRIMARY KEY,
  entity_type     VARCHAR(20) NOT NULL CHECK (entity_type IN ('ride_request', 'pool')),
  entity_id       UUID NOT NULL,
  from_status     VARCHAR(30),
  to_status       VARCHAR(30) NOT NULL,
  changed_by      UUID REFERENCES users(id),
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  note            TEXT
);

CREATE INDEX idx_status_history_entity ON status_history(entity_type, entity_id);

-- ============================================================
-- PAYMENTS
-- ============================================================

CREATE TABLE payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_request_id UUID NOT NULL UNIQUE REFERENCES ride_requests(id),
  amount_paisa    BIGINT NOT NULL CHECK (amount_paisa >= 0),
  method          payment_method NOT NULL DEFAULT 'CASH',
  status          payment_status NOT NULL DEFAULT 'PENDING',
  paid_at         TIMESTAMPTZ
);

CREATE INDEX idx_payments_ride_request ON payments(ride_request_id);
