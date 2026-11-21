-- 006: pool-join proposals can now expire.
--
-- A proposal used to wait forever if someone never answered, leaving the
-- newcomer holding a reserved seat and the driver blocked from marking
-- arrival. Proposals now time out after a FIXED window (see
-- backend/src/config/timeouts.js). An expired proposal counts as a "no": the
-- newcomer returns to REQUESTED and the seat is freed.
--
-- EXPIRED is its own decision value, not DECLINED, so the audit trail can tell
-- "Nusrat said no" apart from "Nusrat never answered".
ALTER TYPE consent_decision ADD VALUE IF NOT EXISTS 'EXPIRED';

-- The expiry sweep looks for old PENDING rows; keep that scan cheap.
CREATE INDEX IF NOT EXISTS idx_consents_pending_age
  ON pool_join_consents(created_at) WHERE decision = 'PENDING';
