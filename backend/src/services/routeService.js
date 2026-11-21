const { pool } = require('../config/db');
const { MAX_DETOUR_RATIO, MAX_PASSENGERS_FOR_DETOUR_SEARCH, MIN_POOL_SAVINGS_RATIO } = require('../config/matching');
const { haversineKm } = require('../utils/haversine');

/**
 * Loads the zone graph fresh from the DB and builds an adjacency list with
 * distances computed from the endpoints' lat/lng — edges themselves carry
 * no stored distance, so there's nothing to keep in sync with the zones
 * table. Not cached: the graph is tiny (a handful of zones) and changes
 * essentially never at runtime, so re-querying per call is simpler than
 * cache invalidation and not worth optimizing for this MVP's scale.
 *
 * @param {import('pg').PoolClient | import('pg').Pool} [client]
 */
async function loadGraph(client = pool) {
  const { rows: zoneRows } = await client.query('SELECT id, latitude, longitude FROM zones');
  const { rows: edgeRows } = await client.query('SELECT zone_a_id, zone_b_id FROM zone_edges');

  const zoneById = new Map(zoneRows.map((z) => [z.id, z]));
  const adjacency = new Map(zoneRows.map((z) => [z.id, []]));

  for (const edge of edgeRows) {
    const a = zoneById.get(edge.zone_a_id);
    const b = zoneById.get(edge.zone_b_id);
    const distanceKm = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
    adjacency.get(edge.zone_a_id).push({ to: edge.zone_b_id, distanceKm });
    adjacency.get(edge.zone_b_id).push({ to: edge.zone_a_id, distanceKm });
  }

  return { zoneById, adjacency };
}

/**
 * Shortest path between two zones (Dijkstra — O(V^2), fine for a graph this
 * small; no priority queue needed). Returns the ordered list of zone ids
 * from origin to destination (inclusive of both) and the total distance, or
 * null if the zones aren't connected at all.
 *
 * @param {number} fromZoneId
 * @param {number} toZoneId
 * @param {import('pg').PoolClient | import('pg').Pool} [client]
 */
async function shortestPath(fromZoneId, toZoneId, client = pool) {
  if (fromZoneId === toZoneId) return { zoneIds: [fromZoneId], distanceKm: 0 };

  const { adjacency } = await loadGraph(client);
  const dist = new Map([[fromZoneId, 0]]);
  const prev = new Map();
  const visited = new Set();

  for (;;) {
    let current = null;
    let currentDist = Infinity;
    for (const [zoneId, d] of dist) {
      if (!visited.has(zoneId) && d < currentDist) {
        current = zoneId;
        currentDist = d;
      }
    }
    if (current === null || current === toZoneId) break;
    visited.add(current);

    for (const { to, distanceKm } of adjacency.get(current) || []) {
      const candidate = currentDist + distanceKm;
      if (!dist.has(to) || candidate < dist.get(to)) {
        dist.set(to, candidate);
        prev.set(to, current);
      }
    }
  }

  if (!dist.has(toZoneId)) return null; // no route exists between these zones

  const zoneIds = [toZoneId];
  let cursor = toZoneId;
  while (cursor !== fromZoneId) {
    cursor = prev.get(cursor);
    zoneIds.unshift(cursor);
  }
  return { zoneIds, distanceKm: dist.get(toZoneId) };
}

/**
 * Can a set of directed paths (each an ordered [pickup, ..., destination]
 * zone-id array) all be served by ONE vehicle driving a single, continuous,
 * non-branching route?
 *
 * Two checks, in order:
 *
 * 1. SHAPE: the undirected union of every path's edges must form a simple
 *    path — every zone touched by more than one edge across all paths
 *    combined must have degree <= 2 (no zone is a true branch point where
 *    the routes diverge in three different directions), and the union must
 *    be one connected piece (not two separate, unrelated line segments).
 *    This is the check that rejects the branching scenario directly: two
 *    paths that share a junction but then continue toward genuinely
 *    different destinations make that junction's degree 3, which fails.
 *
 * 2. DIRECTION: shape alone isn't enough — a simple path admits two possible
 *    directions of travel, and every request's own pickup->destination must
 *    align with the SAME one of those two directions. Two requests sharing
 *    an origin but heading to destinations on opposite sides of that origin
 *    pass the shape check (the union is still a simple path) but fail here,
 *    since the vehicle would have to travel one way for one passenger and
 *    the opposite way for the other.
 */
function routesAreCompatible(existingPaths, newPath) {
  const allPaths = [...existingPaths, newPath];

  // --- 1. Shape: build the undirected union, check max degree and connectivity ---
  const neighbors = new Map();
  const addEdge = (u, v) => {
    if (!neighbors.has(u)) neighbors.set(u, new Set());
    if (!neighbors.has(v)) neighbors.set(v, new Set());
    neighbors.get(u).add(v);
    neighbors.get(v).add(u);
  };
  for (const path of allPaths) {
    for (let i = 0; i < path.length - 1; i++) addEdge(path[i], path[i + 1]);
  }

  for (const neighborSet of neighbors.values()) {
    if (neighborSet.size > 2) return false; // a genuine branch point
  }

  const nodes = [...neighbors.keys()];
  if (nodes.length === 0) return true; // degenerate (shouldn't happen in practice)

  const seen = new Set([nodes[0]]);
  const queue = [nodes[0]];
  while (queue.length > 0) {
    const u = queue.shift();
    for (const v of neighbors.get(u)) {
      if (!seen.has(v)) {
        seen.add(v);
        queue.push(v);
      }
    }
  }
  if (seen.size !== nodes.length) return false; // two disconnected pieces, not one route

  // --- 2. Direction: walk the simple path to get one canonical ordering, ---
  //     then every request's own pickup->destination must move the same way ---
  const endpoints = nodes.filter((n) => neighbors.get(n).size === 1);
  // A single shared zone with nothing else touching it (e.g. only one path,
  // or all paths identical) has no degree-1 endpoints in the usual sense —
  // walk from any node instead.
  const start = endpoints[0] ?? nodes[0];

  const chain = [start];
  const visitedWalk = new Set([start]);
  let current = start;
  for (let i = 1; i < nodes.length; i++) {
    const next = [...neighbors.get(current)].find((n) => !visitedWalk.has(n));
    if (next === undefined) break;
    chain.push(next);
    visitedWalk.add(next);
    current = next;
  }
  const position = new Map(chain.map((zoneId, index) => [zoneId, index]));

  let sharedDirection = null;
  for (const path of allPaths) {
    const originPos = position.get(path[0]);
    const destPos = position.get(path[path.length - 1]);
    const direction = Math.sign(destPos - originPos);
    if (sharedDirection === null) {
      sharedDirection = direction;
    } else if (direction !== sharedDirection) {
      return false; // this request needs to travel the opposite way
    }
  }

  return true;
}

/**
 * All-pairs shortest distances (km) over the zone graph. Floyd-Warshall is fine
 * for a graph with a dozen nodes; recomputed per call, like loadGraph.
 * @returns {Map<number, Map<number, number>>}
 */
function allPairsDistances(graph) {
  const ids = [...graph.adjacency.keys()];
  const d = new Map(ids.map((a) => [a, new Map(ids.map((b) => [b, a === b ? 0 : Infinity]))]));
  for (const [from, edges] of graph.adjacency) for (const e of edges) d.get(from).set(e.to, Math.min(d.get(from).get(e.to), e.distanceKm));
  for (const k of ids) for (const i of ids) for (const j of ids) {
    const via = d.get(i).get(k) + d.get(k).get(j);
    if (via < d.get(i).get(j)) d.get(i).set(j, via);
  }
  return d;
}

/**
 * Can this newcomer share the vehicle with the passengers already in it?
 *
 * 1. Strict rule first (routesAreCompatible): everyone travels one direction
 *    along one non-branching route, so nobody rides a metre more than alone.
 * 2. Otherwise plan the best order of pickups and drop-offs for everyone and
 *    measure each passenger's in-vehicle distance against their solo trip. The
 *    pool fits if the best plan keeps EVERY passenger within `maxDetour` (a
 *    ratio: 0.25 = 25% longer) AND the vehicle drives meaningfully less than the
 *    separate solo trips would (MIN_POOL_SAVINGS_RATIO) — otherwise "pooling" is
 *    just trips back to back. Among plans that qualify it picks the one with the
 *    least total vehicle distance, never trading one passenger's unfairness for
 *    another's saving.
 *
 * @param {{ adjacency: Map<number, {to:number, distanceKm:number}[]> }} graph
 * @param {number[][]} existingPaths zone-id paths of passengers already in the pool
 * @param {number[]} newPath the newcomer's path
 * @param {{ maxDetour?: number, maxPassengers?: number, minSavings?: number }} [options]
 * @returns {{ fits: boolean, strict: boolean, maxDetourPercent: number | null, order: {passenger:number, kind:'PICKUP'|'DROPOFF', zoneId:number}[] | null }}
 */
function evaluatePoolFit(graph, existingPaths, newPath, { maxDetour = MAX_DETOUR_RATIO, maxPassengers = MAX_PASSENGERS_FOR_DETOUR_SEARCH, minSavings = MIN_POOL_SAVINGS_RATIO } = {}) {
  if (routesAreCompatible(existingPaths, newPath)) return { fits: true, strict: true, maxDetourPercent: 0, order: null };

  const paths = [...existingPaths, newPath];
  if (paths.length > maxPassengers) return { fits: false, strict: false, maxDetourPercent: null, order: null };

  const dist = allPairsDistances(graph);
  const trips = paths.map((p) => ({ from: p[0], to: p[p.length - 1] }));
  const solo = trips.map((t) => dist.get(t.from).get(t.to));
  if (solo.some((s) => !(s > 0) || !Number.isFinite(s))) return { fits: false, strict: false, maxDetourPercent: null, order: null };

  const soloSum = solo.reduce((a, b) => a + b, 0);
  const stopCount = trips.length * 2;
  let best = null; // { total, order, worst }

  // Depth-first over stop orders; a drop-off may only follow its own pickup.
  const sequence = [];
  const pickedUp = new Array(trips.length).fill(false);
  const droppedOff = new Array(trips.length).fill(false);

  function evaluate() {
    const zoneAt = sequence.map((s) => (s.kind === 'PICKUP' ? trips[s.passenger].from : trips[s.passenger].to));
    const legs = [0];
    for (let i = 1; i < zoneAt.length; i += 1) legs.push(legs[i - 1] + dist.get(zoneAt[i - 1]).get(zoneAt[i]));
    let worst = 0;
    for (let p = 0; p < trips.length; p += 1) {
      const pickupAt = sequence.findIndex((s) => s.passenger === p && s.kind === 'PICKUP');
      const dropAt = sequence.findIndex((s) => s.passenger === p && s.kind === 'DROPOFF');
      const ride = legs[dropAt] - legs[pickupAt];
      worst = Math.max(worst, ride / solo[p] - 1);
    }
    if (worst > maxDetour + 1e-9) return;
    const total = legs[legs.length - 1];
    if (total > soloSum * (1 - minSavings) + 1e-9) return; // not worth pooling
    if (!best || total < best.total - 1e-9) {
      best = { total, worst, order: sequence.map((s, i) => ({ passenger: s.passenger, kind: s.kind, zoneId: zoneAt[i] })) };
    }
  }

  function search() {
    if (sequence.length === stopCount) return evaluate();
    for (let p = 0; p < trips.length; p += 1) {
      if (!pickedUp[p]) {
        pickedUp[p] = true; sequence.push({ passenger: p, kind: 'PICKUP' });
        search();
        sequence.pop(); pickedUp[p] = false;
      } else if (!droppedOff[p]) {
        droppedOff[p] = true; sequence.push({ passenger: p, kind: 'DROPOFF' });
        search();
        sequence.pop(); droppedOff[p] = false;
      }
    }
  }
  search();

  return best
    ? { fits: true, strict: false, maxDetourPercent: Math.max(0, Math.round(best.worst * 100)), order: best.order }
    : { fits: false, strict: false, maxDetourPercent: null, order: null };
}

module.exports = { loadGraph, shortestPath, routesAreCompatible, allPairsDistances, evaluatePoolFit };
