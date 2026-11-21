const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluatePoolFit, allPairsDistances } = require('../src/services/routeService');
const matching = require('../src/config/matching');

test('every matching constant is a finite number (an undefined one would silently disable its rule)', () => {
  for (const name of ['MAX_DETOUR_RATIO', 'MAX_PASSENGERS_FOR_DETOUR_SEARCH', 'MIN_POOL_SAVINGS_RATIO']) {
    assert.equal(Number.isFinite(matching[name]), true, name);
  }
  assert.ok(matching.MAX_DETOUR_RATIO > 0 && matching.MIN_POOL_SAVINGS_RATIO > 0 && matching.MIN_POOL_SAVINGS_RATIO < 1);
});

/** Build the same shape loadGraph returns, from [a, b, km] edges. */
function graphOf(edges) {
  const adjacency = new Map();
  const add = (a, b, km) => { if (!adjacency.has(a)) adjacency.set(a, []); adjacency.get(a).push({ to: b, distanceKm: km }); };
  for (const [a, b, km] of edges) { add(a, b, km); add(b, a, km); }
  return { adjacency };
}

// A line 1-2-3-4 (1 km hops) with a short 0.2 km spur 5 hanging off node 3.
//      1 --- 2 --- 3 --- 4
//                  |
//                  5   (0.2 km)
const graph = graphOf([[1, 2, 1], [2, 3, 1], [3, 4, 1], [3, 5, 0.2]]);

test('all-pairs distances are correct on a small graph', () => {
  const d = allPairsDistances(graph);
  assert.equal(d.get(1).get(4), 3);
  assert.equal(d.get(2).get(5), 1.2);
  assert.ok(Math.abs(d.get(5).get(4) - 1.2) < 1e-9);
  assert.equal(d.get(4).get(4), 0);
});

test('a strictly compatible pool is accepted with zero detour (the old rule is the fast path)', () => {
  const fit = evaluatePoolFit(graph, [[1, 2, 3, 4]], [2, 3, 4]);
  assert.deepEqual([fit.fits, fit.strict, fit.maxDetourPercent], [true, true, 0]);
});

test('a small side-trip is accepted, with the worst passenger\'s extra distance reported', () => {
  // A: 1 -> 4 (3.0 km alone). B: 2 -> 5 (1.2 km alone). Branches at node 3, so the
  // strict rule says no. Best plan: pick up A, pick up B, drop B at 5, drop A at 4.
  // A rides 1 + 1.2 + 1.2 = 3.4 km (13% more); B rides 1.2 (0% more).
  const fit = evaluatePoolFit(graph, [[1, 2, 3, 4]], [2, 3, 5]);
  assert.equal(fit.strict, false);
  assert.equal(fit.fits, true);
  assert.equal(fit.maxDetourPercent, 13);
  assert.deepEqual(fit.order.map((s) => `${s.passenger}${s.kind[0]}@${s.zoneId}`), ['0P@1', '1P@2', '1D@5', '0D@4']);
});

test('the same pool is refused when the detour tolerance is tighter than the real detour', () => {
  assert.equal(evaluatePoolFit(graph, [[1, 2, 3, 4]], [2, 3, 5], { maxDetour: 0.10 }).fits, false);
  // The real detour is 3.4/3.0 - 1 = 13.3%: a 13% tolerance refuses it, 14% accepts it.
  assert.equal(evaluatePoolFit(graph, [[1, 2, 3, 4]], [2, 3, 5], { maxDetour: 0.13 }).fits, false);
  assert.equal(evaluatePoolFit(graph, [[1, 2, 3, 4]], [2, 3, 5], { maxDetour: 0.14 }).fits, true);
});

test('opposite directions are refused: that is two trips back to back, not a pool', () => {
  const fit = evaluatePoolFit(graph, [[1, 2, 3, 4]], [4, 3, 2, 1]);
  assert.equal(fit.fits, false);
  assert.equal(fit.maxDetourPercent, null);
});

test('a pool must actually save driving: a detour-free plan that saves nothing is refused', () => {
  const fit = evaluatePoolFit(graph, [[1, 2]], [3, 4]);
  assert.equal(fit.fits, false);
  // The back-to-back plan even drives MORE than the two solo trips (it must reposition 2->3),
  // so it only passes once the rule allows negative savings: proof the savings rule is what blocks it.
  assert.equal(evaluatePoolFit(graph, [[1, 2]], [3, 4], { minSavings: -1, maxDetour: 5 }).fits, true);
});

test('a cheaper plan that is unfair to one passenger is never chosen', () => {
  const g = graphOf([[1, 2, 1], [2, 3, 1], [3, 4, 1], [3, 6, 3]]);
  const fit = evaluatePoolFit(g, [[1, 2, 3, 4]], [2, 3, 6]);
  assert.equal(fit.fits, false);
});

test('every plan returned respects pickup-before-dropoff for each passenger', () => {
  const fit = evaluatePoolFit(graph, [[1, 2, 3, 4]], [2, 3, 5]);
  for (const p of [0, 1]) {
    const pickup = fit.order.findIndex((s) => s.passenger === p && s.kind === 'PICKUP');
    const drop = fit.order.findIndex((s) => s.passenger === p && s.kind === 'DROPOFF');
    assert.ok(pickup >= 0 && drop > pickup, `passenger ${p}`);
  }
});

test('with several passengers the best fair plan is found (three riders)', () => {
  const fit = evaluatePoolFit(graph, [[1, 2, 3, 4], [2, 3, 5]], [2, 3, 4]);
  assert.equal(fit.fits, true);
  assert.ok(fit.maxDetourPercent <= 25);
});

test('above the passenger limit only the strict rule applies (the search is bounded)', () => {
  const lineA = [1, 2, 3, 4];
  assert.equal(evaluatePoolFit(graph, [lineA, lineA, lineA, lineA], lineA).fits, true);
  assert.equal(evaluatePoolFit(graph, [lineA, lineA, lineA, lineA], [2, 3, 5]).fits, false, 'a detour-only fit is not searched for 5+ passengers');
});
