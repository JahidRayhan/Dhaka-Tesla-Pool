-- 007: a Tesla is one physical vehicle, so it can run at most one non-terminal
-- pool at a time. poolService.acceptRequest already refuses to start a second
-- one (and locks the Tesla row so simultaneous accepts queue up), but a rule
-- this important belongs in the database too: it is the backstop that holds
-- even if a future code path forgets the check.
--
-- Partial unique index: it only constrains pools that are still "live";
-- COMPLETED and CANCELLED pools pile up freely.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pools_one_active_per_tesla
  ON pools (tesla_id)
  WHERE status IN ('MATCHED', 'DRIVER_ARRIVED', 'STARTED');
