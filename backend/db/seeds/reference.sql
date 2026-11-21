-- Reference data: the fixed zone list and road graph. Safe to run in EVERY
-- environment (including production) and safe to run repeatedly.

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
  ('Bashundhara', 23.8145, 90.4485)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- ZONE EDGES (Section 4 — a small, fixed road graph instead of a flat tag)
-- ============================================================
-- Banani and Mohakhali are both real junctions here (degree 3 and 3), which
-- is deliberate — it's what lets the matching rule actually demonstrate
-- rejecting a branch-crossing trip, not just accepting anything nearby.

INSERT INTO zone_edges (zone_a_id, zone_b_id)
SELECT x.a, x.b FROM (
SELECT a.id AS a, b.id AS b FROM zones a, zones b WHERE a.name = 'Banani'    AND b.name = 'Gulshan 1'
UNION ALL
SELECT a.id AS a, b.id AS b FROM zones a, zones b WHERE a.name = 'Banani'    AND b.name = 'Mohakhali'
UNION ALL
SELECT a.id AS a, b.id AS b FROM zones a, zones b WHERE a.name = 'Banani'    AND b.name = 'Bashundhara'
UNION ALL
SELECT a.id AS a, b.id AS b FROM zones a, zones b WHERE a.name = 'Gulshan 1' AND b.name = 'Niketon'
UNION ALL
SELECT a.id AS a, b.id AS b FROM zones a, zones b WHERE a.name = 'Mohakhali' AND b.name = 'Farmgate'
UNION ALL
SELECT a.id AS a, b.id AS b FROM zones a, zones b WHERE a.name = 'Mohakhali' AND b.name = 'Mirpur'
UNION ALL
SELECT a.id AS a, b.id AS b FROM zones a, zones b WHERE a.name = 'Farmgate'  AND b.name = 'Dhanmondi'
UNION ALL
SELECT a.id AS a, b.id AS b FROM zones a, zones b WHERE a.name = 'Mirpur'    AND b.name = 'Uttara'
) x
WHERE NOT EXISTS (SELECT 1 FROM zone_edges);

-- ============================================================
-- MEETING POINTS
-- ============================================================
-- PLACEHOLDERS: two generic points per zone, offset a few hundred metres from the
-- zone centre. Replace with real, locally-curated pickup spots (a landmark a
-- driver and passenger will both recognise) before relying on them in a launch.
INSERT INTO meeting_points (zone_id, name, latitude, longitude)
SELECT z.id, z.name || ' — ' || p.label, z.latitude + p.dlat, z.longitude + p.dlng
FROM zones z
CROSS JOIN (VALUES ('Main Road', 0.0020::float8, 0.0015::float8), ('Bus Stand', -0.0025::float8, -0.0020::float8)) AS p(label, dlat, dlng)
ON CONFLICT (zone_id, name) DO NOTHING;
