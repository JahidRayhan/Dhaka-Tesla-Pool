const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeBaseAndDistance, computePoolDiscount } = require('../src/services/fareService');

// Path distances are what routeService produces for these routes over the
// seeded zone graph (sum of real edge distances along the shortest path) —
// pinned here as plain numbers so fare arithmetic is tested on its own,
// independent of routing. routing.test.js separately checks that the real
// graph produces these distances.
const BANANI_TO_MOHAKHALI_KM = 1.4478; // one edge
const BANANI_TO_FARMGATE_KM = 4.4384; // Banani > Mohakhali > Farmgate
const MOHAKHALI_TO_FARMGATE_KM = 2.9906; // one edge

test('base fare is a flat 3000 paisa per seat regardless of route', () => {
  assert.equal(computeBaseAndDistance(BANANI_TO_MOHAKHALI_KM).baseFarePaisa, 3000);
  assert.equal(computeBaseAndDistance(BANANI_TO_FARMGATE_KM).baseFarePaisa, 3000);
});

test('Banani -> Mohakhali distance charge matches the verified system output (2172 paisa)', () => {
  assert.equal(computeBaseAndDistance(BANANI_TO_MOHAKHALI_KM).distanceChargePaisa, 2172);
});

test('Banani -> Farmgate (two hops) distance charge is 6658 paisa', () => {
  assert.equal(computeBaseAndDistance(BANANI_TO_FARMGATE_KM).distanceChargePaisa, 6658);
});

test('Mohakhali -> Farmgate distance charge is 4486 paisa', () => {
  assert.equal(computeBaseAndDistance(MOHAKHALI_TO_FARMGATE_KM).distanceChargePaisa, 4486);
});

test('a solo passenger (pool size 1) gets no pool discount', () => {
  assert.equal(computePoolDiscount(6658, 1), 0);
});

test('base fare and distance charge scale with seatsRequested (2 seats costs exactly double)', () => {
  const oneSeat = computeBaseAndDistance(BANANI_TO_FARMGATE_KM, 1);
  const twoSeats = computeBaseAndDistance(BANANI_TO_FARMGATE_KM, 2);
  assert.equal(twoSeats.baseFarePaisa, oneSeat.baseFarePaisa * 2);
  assert.equal(twoSeats.distanceChargePaisa, oneSeat.distanceChargePaisa * 2);
});

test('a pooled passenger gets exactly 20% off their own distance charge, rounded to the nearest paisa', () => {
  assert.equal(computePoolDiscount(6658, 2), 1332); // Nusrat
  assert.equal(computePoolDiscount(4486, 2), 897); // Rafiq
});

test('final fare = base + distance - discount (Nusrat and Rafiq, pooled)', () => {
  const nusrat = computeBaseAndDistance(BANANI_TO_FARMGATE_KM);
  const nusratFinal = nusrat.baseFarePaisa + nusrat.distanceChargePaisa - computePoolDiscount(nusrat.distanceChargePaisa, 2);
  assert.equal(nusratFinal, 8326); // ৳83.26

  const rafiq = computeBaseAndDistance(MOHAKHALI_TO_FARMGATE_KM);
  const rafiqFinal = rafiq.baseFarePaisa + rafiq.distanceChargePaisa - computePoolDiscount(rafiq.distanceChargePaisa, 2);
  assert.equal(rafiqFinal, 6589); // ৳65.89
});
