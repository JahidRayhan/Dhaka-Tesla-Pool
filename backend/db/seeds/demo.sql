-- DEMO DATA ONLY: fake accounts with a publicly known password ("password123")
-- and free wallet balances. scripts/seed.js refuses to load this in production.
-- Fixed UUIDs so the tests and README demo credentials stay reproducible.
-- Cast: Jashim (driver) / Bullet (tesla) / Nusrat, Rafiq, Shirin (passengers).

-- ============================================================
-- USERS
-- ============================================================

INSERT INTO users (id, name, email, phone, password_hash, role) VALUES
  ('596a6708-d03b-416f-bcf5-530d7db0a552', 'Jashim', 'jashim@dhakateslapool.test', '+8801710000001',
   '$2b$10$FG7MTLJl33dF7QlCC/00muUv066leJ22ySRdDZ2MkpUg2qmBwA4vm', 'driver'),
  ('e3d4a8ea-8ca0-4179-a5a8-87ef5a72d33f', 'Nusrat', 'nusrat@dhakateslapool.test', '+8801710000002',
   '$2b$10$FG7MTLJl33dF7QlCC/00muUv066leJ22ySRdDZ2MkpUg2qmBwA4vm', 'passenger'),
  ('f61590de-a26b-4f31-b42f-d1d4c45d308e', 'Rafiq', 'rafiq@dhakateslapool.test', '+8801710000003',
   '$2b$10$FG7MTLJl33dF7QlCC/00muUv066leJ22ySRdDZ2MkpUg2qmBwA4vm', 'passenger'),
  ('27a52ee0-3b0b-4b3d-8b3b-1ab8120bec32', 'Shirin', 'shirin@dhakateslapool.test', '+8801710000004',
   '$2b$10$FG7MTLJl33dF7QlCC/00muUv066leJ22ySRdDZ2MkpUg2qmBwA4vm', 'passenger')
ON CONFLICT (id) DO NOTHING;

INSERT INTO wallets (user_id, balance_paisa, ledger_baseline_paisa)
SELECT id, 100000, 100000 FROM users -- ৳1000 starting TeslaPay balance for demo purposes
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================
-- TESLA
-- ============================================================

INSERT INTO teslas (id, driver_id, name, capacity, is_active) VALUES
  ('4832fd3b-2deb-4357-87e8-5e17c6d61f6f', '596a6708-d03b-416f-bcf5-530d7db0a552', 'Bullet', 3, true)
ON CONFLICT (id) DO NOTHING;

-- Seed data intentionally stops at "Bullet is online, nobody has requested
-- yet" — the REQUESTED -> MATCHED -> ... lifecycle from here on is exercised
-- live via the API (and by the test suite), matching the Banani rush-hour
-- story rather than pre-baking its outcome into the seed.

-- ============================================================
-- DEMO PROFILES (gender for women-only pooling, a verified driver, an admin)
-- ============================================================
UPDATE users SET gender = 'female' WHERE email IN ('nusrat@dhakateslapool.test', 'shirin@dhakateslapool.test');
UPDATE users SET gender = 'male'   WHERE email IN ('jashim@dhakateslapool.test', 'rafiq@dhakateslapool.test');

INSERT INTO driver_profiles (user_id, license_number, vehicle_plate, status, reviewed_at, review_note)
SELECT id, 'DL-DEMO-0001', 'DHAKA-DEMO-01', 'VERIFIED', now(), 'demo seed'
FROM users WHERE email = 'jashim@dhakateslapool.test'
ON CONFLICT (user_id) DO NOTHING;

-- Operator account for the admin console (same public demo password).
INSERT INTO users (id, name, email, phone, password_hash, role)
SELECT '0d1c7e5a-3a45-4c3e-9a77-7d6f0c1b2a99', 'Demo Admin', 'admin@dhakateslapool.test', '+8801710000099', password_hash, 'admin'
FROM users WHERE email = 'jashim@dhakateslapool.test'
ON CONFLICT (id) DO NOTHING;
INSERT INTO wallets (user_id, balance_paisa, ledger_baseline_paisa)
SELECT id, 0, 0 FROM users WHERE email = 'admin@dhakateslapool.test'
ON CONFLICT (user_id) DO NOTHING;
