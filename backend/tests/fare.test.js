const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeBaseAndDistance, computePoolDiscount } = require('../src/services/fareService');

// Same coordinates as seed/002_seed.sql — kept in sync deliberately so this
// test documents (and pins) the numbers in DESIGN.md's worked example.
const BANANI = { latitude: 23.7936, longitude: 90.4066 };
const MOHAKHALI = { latitude: 23.7806, longitude: 90.4058 };
const GULSHAN_1 = { latitude: 23.7809, longitude: 90.4161 };

test('base fare is a flat 3000 paisa regardless of route', () => {
  const { baseFarePaisa } = computeBaseAndDistance(BANANI, MOHAKHALI);
  assert.equal(baseFarePaisa, 3000);
});

test('Banani -> Mohakhali distance charge matches the verified system output (2172 paisa)', () => {
  const { distanceChargePaisa } = computeBaseAndDistance(BANANI, MOHAKHALI);
  assert.equal(distanceChargePaisa, 2172);
});

test('Banani -> Gulshan 1 distance charge matches the verified system output (2567 paisa)', () => {
  const { distanceChargePaisa } = computeBaseAndDistance(BANANI, GULSHAN_1);
  assert.equal(distanceChargePaisa, 2567);
});

test('a solo passenger (pool size 1) gets no pool discount', () => {
  assert.equal(computePoolDiscount(2172, 1), 0);
});

test('base fare and distance charge scale with seatsRequested (2 seats costs exactly double)', () => {
  const oneSeat = computeBaseAndDistance(BANANI, MOHAKHALI, 1);
  const twoSeats = computeBaseAndDistance(BANANI, MOHAKHALI, 2);
  assert.equal(twoSeats.baseFarePaisa, oneSeat.baseFarePaisa * 2);
  assert.equal(twoSeats.distanceChargePaisa, oneSeat.distanceChargePaisa * 2);
});

test('a pooled passenger gets exactly 20% off their own distance charge, rounded to the nearest paisa', () => {
  assert.equal(computePoolDiscount(2172, 2), 434); // Nusrat
  assert.equal(computePoolDiscount(2567, 2), 513); // Rafiq
});

test('final fare = base + distance - discount (Nusrat and Rafiq, pooled)', () => {
  const nusrat = computeBaseAndDistance(BANANI, MOHAKHALI);
  const nusratDiscount = computePoolDiscount(nusrat.distanceChargePaisa, 2);
  const nusratFinal = nusrat.baseFarePaisa + nusrat.distanceChargePaisa - nusratDiscount;
  assert.equal(nusratFinal, 4738);

  const rafiq = computeBaseAndDistance(BANANI, GULSHAN_1);
  const rafiqDiscount = computePoolDiscount(rafiq.distanceChargePaisa, 2);
  const rafiqFinal = rafiq.baseFarePaisa + rafiq.distanceChargePaisa - rafiqDiscount;
  assert.equal(rafiqFinal, 5054);
});
