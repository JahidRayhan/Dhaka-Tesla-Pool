/**
 * Fixed policy for trip tracking, no-shows and scheduling (same philosophy as
 * timeouts.js: the promise made to users is the same everywhere).
 */
module.exports = {
  // The driver must be within this distance of a pickup zone's centre to mark
  // "arrived" — IF their app has shared a recent location. Zones are
  // neighbourhoods, not points, so this is deliberately generous. No recent
  // location = not enforced (GPS can fail).
  ARRIVAL_GEOFENCE_KM: 2,
  // A reported position older than this is not trusted for the arrival check or the ETA.
  LOCATION_STALE_MINUTES: 5,
  // Average pooled-rickshaw speed in Dhaka traffic, used only for the ETA estimate.
  ASSUMED_SPEED_KMH: 15,
  // After the driver arrives, how long a passenger may keep them waiting before
  // the driver can release the seat as a no-show.
  NO_SHOW_WAIT_MINUTES: 5,
  // What a no-show costs the passenger (paisa): ৳30.00, one base fare.
  NO_SHOW_FEE_PAISA: 3000,
  // A scheduled ride becomes visible to drivers this long before its time.
  SCHEDULE_VISIBLE_LEAD_MINUTES: 20,
  // An unmatched ride is cancelled after this long unless the passenger chose a
  // different "I can wait up to N minutes" (immediate rides count from the request;
  // scheduled rides from the scheduled time).
  DEFAULT_MAX_WAIT_MINUTES: 60,
  SCHEDULED_GRACE_MINUTES: 30,
  // The soonest a ride can be scheduled for, and the furthest ahead.
  MIN_SCHEDULE_AHEAD_MINUTES: 5,
  MAX_SCHEDULE_AHEAD_DAYS: 30,
};
