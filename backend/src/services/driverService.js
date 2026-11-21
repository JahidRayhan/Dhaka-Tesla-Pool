const { pool } = require('../config/db');
const { ApiError } = require('../utils/ApiError');
const { requireVerifiedDrivers } = require('../config/features');
const { notify } = require('./notificationService');

async function getProfile(userId) {
  const { rows } = await pool.query('SELECT user_id, license_number, vehicle_plate, status, submitted_at, reviewed_at, review_note FROM driver_profiles WHERE user_id = $1', [userId]);
  return rows[0] || null;
}

/** A driver submits (or corrects) their licence and plate; any change goes back to PENDING review. */
async function submitProfile(userId, { licenseNumber, vehiclePlate }) {
  const license = typeof licenseNumber === 'string' ? licenseNumber.trim() : '';
  const plate = typeof vehiclePlate === 'string' ? vehiclePlate.trim().toUpperCase() : '';
  if (license.length < 3 || license.length > 40) throw new ApiError(422, 'licenseNumber must be 3-40 characters');
  if (plate.length < 3 || plate.length > 20) throw new ApiError(422, 'vehiclePlate must be 3-20 characters');
  await pool.query(
    `INSERT INTO driver_profiles (user_id, license_number, vehicle_plate, status) VALUES ($1, $2, $3, 'PENDING')
     ON CONFLICT (user_id) DO UPDATE SET
       status = CASE WHEN driver_profiles.license_number = $2 AND driver_profiles.vehicle_plate = $3 THEN driver_profiles.status ELSE 'PENDING' END,
       submitted_at = CASE WHEN driver_profiles.license_number = $2 AND driver_profiles.vehicle_plate = $3 THEN driver_profiles.submitted_at ELSE now() END,
       reviewed_by = CASE WHEN driver_profiles.license_number = $2 AND driver_profiles.vehicle_plate = $3 THEN driver_profiles.reviewed_by END,
       reviewed_at = CASE WHEN driver_profiles.license_number = $2 AND driver_profiles.vehicle_plate = $3 THEN driver_profiles.reviewed_at END,
       review_note = CASE WHEN driver_profiles.license_number = $2 AND driver_profiles.vehicle_plate = $3 THEN driver_profiles.review_note END,
       license_number = $2, vehicle_plate = $3`,
    [userId, license, plate],
  );
  return getProfile(userId);
}

/** Throws unless this driver may go online. Only enforced when REQUIRE_VERIFIED_DRIVERS=true. */
async function assertMayGoOnline(userId) {
  if (!requireVerifiedDrivers()) return;
  const profile = await getProfile(userId);
  if (!profile) throw new ApiError(403, 'Submit your licence and vehicle details for verification before going online');
  if (profile.status === 'PENDING') throw new ApiError(403, 'Your details are still being verified. You can go online once they are approved');
  if (profile.status === 'REJECTED') throw new ApiError(403, `Your verification was not approved${profile.review_note ? `: ${profile.review_note}` : ''}. Please correct your details and submit again`);
}

// ---- admin ----

async function listForReview(status) {
  const allowed = ['PENDING', 'VERIFIED', 'REJECTED'];
  if (status !== undefined && !allowed.includes(status)) throw new ApiError(422, `status must be one of ${allowed.join(', ')}`);
  const { rows } = await pool.query(
    `SELECT dp.user_id, u.name, u.email, u.phone, u.phone_verified_at, dp.license_number, dp.vehicle_plate, dp.status, dp.submitted_at, dp.reviewed_at, dp.review_note
     FROM driver_profiles dp JOIN users u ON u.id = dp.user_id
     WHERE ($1::text IS NULL OR dp.status = $1) ORDER BY dp.submitted_at ASC LIMIT 200`,
    [status ?? null],
  );
  return rows;
}

async function review(adminId, userId, decision, note) {
  if (!['VERIFIED', 'REJECTED'].includes(decision)) throw new ApiError(422, 'decision must be VERIFIED or REJECTED');
  if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 300)) throw new ApiError(422, 'note must be text of at most 300 characters');
  if (decision === 'REJECTED' && !note?.trim()) throw new ApiError(422, 'Say why the details were not approved, so the driver can fix them');
  const { rowCount } = await pool.query(
    `UPDATE driver_profiles SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4 WHERE user_id = $1`,
    [userId, decision, adminId, note?.trim() || null],
  );
  if (rowCount === 0) throw new ApiError(404, 'No verification request from that driver');
  await notify([userId], decision === 'VERIFIED' ? 'DRIVER_VERIFIED' : 'DRIVER_REJECTED', { note: note?.trim() });
}

module.exports = { getProfile, submitProfile, assertMayGoOnline, listForReview, review };
