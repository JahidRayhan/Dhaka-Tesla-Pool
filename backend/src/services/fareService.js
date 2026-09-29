// All amounts in paisa (1 taka = 100 paisa). See DESIGN.md Section 3 for the
// worked-by-hand example these constants reproduce.
const BASE_FARE_PAISA = 3000; // ৳30 flat
const RATE_PER_KM_PAISA = 1500; // ৳15/km
const POOL_DISCOUNT_RATE = 0.2; // 20% off distanceCharge when pool size > 1

/**
 * baseFare + distanceCharge for a trip of a given length, scaled by seat
 * count. A 2-seat booking occupies twice the capacity of a 1-seat booking on
 * the same route, so it should cost twice as much — this was a real bug
 * caught by hand-testing: seatsRequested was accepted by the API but never
 * actually reached the fare calculation, so a 1-seat and 2-seat booking on
 * an identical route billed identically.
 *
 * Takes a precomputed distanceKm rather than zone objects: HOW FAR a trip is
 * belongs to routeService (the sum of real edge distances along the
 * request's shortest path), and this function only decides what that
 * distance costs. Keeping them separate means changing the routing model
 * never requires touching fare arithmetic, and vice versa.
 */
function computeBaseAndDistance(distanceKm, seatsRequested = 1) {
  const baseFarePaisa = BASE_FARE_PAISA * seatsRequested;
  // Round the PER-SEAT distance charge first, then multiply by seat count —
  // not the other way around. Rounding the combined amount (rate * distance
  // * seats) independently at each seat count lets 2 seats drift a paisa
  // away from exactly double 1 seat, because two separate roundings don't
  // commute with multiplication. Rounding once per seat and then scaling by
  // an integer guarantees seatsRequested=2 is always exactly 2x
  // seatsRequested=1 on the same route — caught by the "costs exactly
  // double" test itself failing on the first version of this fix.
  const perSeatDistanceChargePaisa = Math.round(RATE_PER_KM_PAISA * distanceKm);
  const distanceChargePaisa = perSeatDistanceChargePaisa * seatsRequested;

  return {
    distanceKm,
    baseFarePaisa,
    distanceChargePaisa,
  };
}

/**
 * The pool discount, given a member's own distanceChargePaisa and the
 * pool's final passenger count. Only called once — at STARTED — when the
 * pool's membership is locked in (see DESIGN.md "Correction" note).
 */
function computePoolDiscount(distanceChargePaisa, finalPoolPassengerCount) {
  if (finalPoolPassengerCount <= 1) return 0;
  return Math.round(distanceChargePaisa * POOL_DISCOUNT_RATE);
}

module.exports = {
  BASE_FARE_PAISA,
  RATE_PER_KM_PAISA,
  POOL_DISCOUNT_RATE,
  computeBaseAndDistance,
  computePoolDiscount,
};
