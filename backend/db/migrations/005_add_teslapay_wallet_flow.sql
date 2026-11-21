-- 005: make the simulated TeslaPay wallet actually move money.
--
-- Before this, `wallets` existed but nothing ever debited it: every completed
-- ride just created a PENDING cash payment. Now a passenger can choose how
-- they will pay when they request a ride, and TeslaPay rides are settled
-- from wallet to wallet in the same transaction that completes the trip.

-- How the passenger intends to pay. Chosen at request time; the `payments`
-- row written at completion records how it was actually settled (a TeslaPay
-- ride whose wallet ran short in the meantime falls back to cash).
ALTER TABLE ride_requests
  ADD COLUMN payment_method payment_method NOT NULL DEFAULT 'CASH';

-- Append-only ledger: balance changes are explainable after the fact
-- (Section 2: "enough history to explain exactly what happened").
CREATE TYPE wallet_transaction_kind AS ENUM ('TOPUP', 'RIDE_PAYMENT', 'RIDE_EARNING');

CREATE TABLE wallet_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  kind            wallet_transaction_kind NOT NULL,
  -- Signed integer paisa: positive credits the wallet, negative debits it.
  amount_paisa    BIGINT NOT NULL,
  ride_request_id UUID REFERENCES ride_requests(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Direction must match the kind, so a bug can't record a "payment" that
  -- adds money.
  CONSTRAINT wallet_tx_sign CHECK (
    (kind = 'RIDE_PAYMENT' AND amount_paisa < 0) OR
    (kind <> 'RIDE_PAYMENT' AND amount_paisa > 0)
  ),
  CONSTRAINT wallet_tx_ride_link CHECK (
    (kind = 'TOPUP' AND ride_request_id IS NULL) OR
    (kind <> 'TOPUP' AND ride_request_id IS NOT NULL)
  )
);

CREATE INDEX idx_wallet_tx_user ON wallet_transactions(user_id, created_at DESC);

-- A ride is paid for at most once, and the driver is credited at most once.
CREATE UNIQUE INDEX uq_wallet_tx_per_ride
  ON wallet_transactions(ride_request_id, kind)
  WHERE ride_request_id IS NOT NULL;
