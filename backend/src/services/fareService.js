const { haversineKm } = require('../utils/haversine');

// All amounts in paisa (1 taka = 100 paisa). See DESIGN.md Section 3 for the
// worked-by-hand example these constants reproduce.
const BASE_FARE_PAISA = 3000; // ৳30 flat
const RATE_PER_KM_PAISA = 1500; // ৳15/km
const POOL_DISCOUNT_RATE = 0.2; // 20% off distanceCharge when pool size > 1

/**
 * baseFare + distanceCharge for a single zone-to-zone trip.
 * Called at request time to show the passenger an estimate, and again
 * whenever we need the raw (pre-discount) numbers.
 */
function computeBaseAndDistance(pickupZone, destinationZone) {
  const distanceKm = haversineKm(
    pickupZone.latitude,
    pickupZone.longitude,
    destinationZone.latitude,
    destinationZone.longitude,
  );

  const distanceChargePaisa = Math.round(RATE_PER_KM_PAISA * distanceKm);

  return {
    distanceKm,
    baseFarePaisa: BASE_FARE_PAISA,
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
