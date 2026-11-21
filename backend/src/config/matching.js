/**
 * How much longer a passenger's in-vehicle trip may be than the same trip taken
 * alone before pooling stops being fair. 0.25 = 25% longer. A fixed policy
 * constant, like the timeouts: the same promise for every passenger.
 */
const MAX_DETOUR_RATIO = 0.25;

/**
 * Exhaustively planning the best stop order is fine for a handful of passengers
 * (8 stops = 2,520 orderings) but explodes beyond that. Above this many
 * passengers only the strict no-backtracking rule is applied.
 */
const MAX_PASSENGERS_FOR_DETOUR_SEARCH = 4;

/**
 * A pool that needs a detour must still be worth it: the vehicle has to drive at
 * least this much LESS in total than the passengers' separate solo trips would
 * add up to. Without this, "drop the first passenger, then pick up the second at
 * the same spot" looks fair to everyone (nobody rides further than alone) but is
 * just two trips back to back that would wrongly earn the pool discount.
 * 0.15 = the pool must save at least 15% of the combined solo distance.
 */
const MIN_POOL_SAVINGS_RATIO = 0.15;

module.exports = { MAX_DETOUR_RATIO, MAX_PASSENGERS_FOR_DETOUR_SEARCH, MIN_POOL_SAVINGS_RATIO };
