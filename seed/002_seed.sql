-- Dhaka Tesla Pool — seed data
-- Fixed UUIDs so this is reproducible across runs (README demo credentials
-- and the test suite reference these exact IDs).
-- Cast: Jashim (driver) / Bullet (tesla) / Nusrat, Rafiq, Shirin (passengers).
-- Shared demo password for every seeded user: "password123"

-- ============================================================
-- ZONES (approximate real Dhaka coordinates, used as cluster centroids —
-- Section 4 explicitly allows "plain lat/long points" over a real map API)
-- ============================================================

INSERT INTO zones (name, latitude, longitude) VALUES
  ('Banani',      23.7936, 90.4066),
  ('Gulshan 1',   23.7809, 90.4161),
  ('Mohakhali',   23.7806, 90.4058),
  ('Niketon',     23.7909, 90.4183),
  ('Dhanmondi',   23.7461, 90.3742),
  ('Farmgate',    23.7581, 90.3897),
  ('Mirpur',      23.8223, 90.3654),
  ('Uttara',      23.8759, 90.3795),
  ('Bashundhara', 23.8145, 90.4485);

-- ============================================================
-- ZONE EDGES (Section 4 — a small, fixed road graph instead of a flat tag)
-- ============================================================
-- Banani and Mohakhali are both real junctions here (degree 3 and 3), which
-- is deliberate — it's what lets the matching rule actually demonstrate
-- rejecting a branch-crossing trip, not just accepting anything nearby.

INSERT INTO zone_edges (zone_a_id, zone_b_id)
SELECT a.id, b.id FROM zones a, zones b WHERE a.name = 'Banani'    AND b.name = 'Gulshan 1'
UNION ALL
SELECT a.id, b.id FROM zones a, zones b WHERE a.name = 'Banani'    AND b.name = 'Mohakhali'
UNION ALL
SELECT a.id, b.id FROM zones a, zones b WHERE a.name = 'Banani'    AND b.name = 'Bashundhara'
UNION ALL
SELECT a.id, b.id FROM zones a, zones b WHERE a.name = 'Gulshan 1' AND b.name = 'Niketon'
UNION ALL
SELECT a.id, b.id FROM zones a, zones b WHERE a.name = 'Mohakhali' AND b.name = 'Farmgate'
UNION ALL
SELECT a.id, b.id FROM zones a, zones b WHERE a.name = 'Mohakhali' AND b.name = 'Mirpur'
UNION ALL
SELECT a.id, b.id FROM zones a, zones b WHERE a.name = 'Farmgate'  AND b.name = 'Dhanmondi'
UNION ALL
SELECT a.id, b.id FROM zones a, zones b WHERE a.name = 'Mirpur'    AND b.name = 'Uttara';

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
   '$2b$10$FG7MTLJl33dF7QlCC/00muUv066leJ22ySRdDZ2MkpUg2qmBwA4vm', 'passenger');

INSERT INTO wallets (user_id, balance_paisa)
SELECT id, 100000 FROM users; -- ৳1000 starting TeslaPay balance for demo purposes

-- ============================================================
-- TESLA
-- ============================================================

INSERT INTO teslas (id, driver_id, name, capacity, is_active) VALUES
  ('4832fd3b-2deb-4357-87e8-5e17c6d61f6f', '596a6708-d03b-416f-bcf5-530d7db0a552', 'Bullet', 3, true);

-- Seed data intentionally stops at "Bullet is online, nobody has requested
-- yet" — the REQUESTED -> MATCHED -> ... lifecycle from here on is exercised
-- live via the API (and by the test suite), matching the Banani rush-hour
-- story rather than pre-baking its outcome into the seed.
