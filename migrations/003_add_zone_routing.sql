-- Replaces the flat zones.cluster tag with a real graph model.
--
-- The cluster column was a crude proxy for "reachable without a detour" —
-- it couldn't express that reaching one zone from another might require
-- passing through (or backtracking through) a specific junction. zone_edges
-- captures which zones are DIRECTLY road-connected; the matching rule in
-- poolService now computes each request's actual shortest path across this
-- graph and checks whether multiple requests' paths can merge into one
-- single, non-branching vehicle route. See DESIGN.md's "Route-aware
-- pooling" section for the full reasoning and worked example.

CREATE TABLE zone_edges (
  id         SERIAL PRIMARY KEY,
  zone_a_id  INTEGER NOT NULL REFERENCES zones(id),
  zone_b_id  INTEGER NOT NULL REFERENCES zones(id),
  CONSTRAINT chk_edge_distinct CHECK (zone_a_id <> zone_b_id)
);

CREATE INDEX idx_zone_edges_a ON zone_edges(zone_a_id);
CREATE INDEX idx_zone_edges_b ON zone_edges(zone_b_id);

-- Edges are undirected (roads run both ways) and carry no stored distance —
-- distance is computed on the fly from the two zones' existing lat/lng via
-- the same haversineKm() utility already used elsewhere, so there's no
-- separate distance figure to keep in sync with the zones table.

ALTER TABLE zones DROP COLUMN cluster;

-- Each ride_request now stores the exact ordered path (zone ids, pickup to
-- destination inclusive) computed at request time — this is what the
-- matching rule checks for compatibility, and what the fare's distance
-- figure is derived from (see fareService — no longer a single straight-line
-- hop, but the sum of real edge distances along this path).
ALTER TABLE ride_requests ADD COLUMN route_zone_ids INTEGER[];
