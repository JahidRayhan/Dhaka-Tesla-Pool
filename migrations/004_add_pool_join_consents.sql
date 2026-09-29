-- All-party consent for pool joins.
--
-- The first version of consent (migration 002) only asked the passenger being
-- ADDED to a pool. That was asymmetric: an existing member who'd agreed to
-- share in the abstract never got a say about sharing with THIS particular
-- person on THIS particular route. Now every party affected by a proposed
-- join gets their own row here — each existing member, plus the joiner — and
-- the joiner only becomes MATCHED once every row is ACCEPTED. A single
-- DECLINED row removes the joiner from the pool and returns them to
-- REQUESTED (seat freed), so one "no" from anyone is enough.

CREATE TYPE consent_decision AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'VOID');

CREATE TABLE pool_join_consents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Every row created for one proposal shares a proposal_id. A joiner can be
  -- proposed to a pool more than once (declined, returned to REQUESTED,
  -- proposed again) — scoping resolution to a proposal_id stops an old
  -- DECLINED row from a past round wrongly auto-rejecting the current one.
  proposal_id        UUID NOT NULL,
  -- The ride_request being proposed for the pool.
  joiner_request_id  UUID NOT NULL REFERENCES ride_requests(id),
  -- The ride_request whose passenger is being asked. Equal to
  -- joiner_request_id for the joiner's own consent row.
  member_request_id  UUID NOT NULL REFERENCES ride_requests(id),
  decision           consent_decision NOT NULL DEFAULT 'PENDING',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at         TIMESTAMPTZ
);

CREATE INDEX idx_consents_joiner ON pool_join_consents(joiner_request_id);
CREATE INDEX idx_consents_proposal ON pool_join_consents(proposal_id);
CREATE INDEX idx_consents_member_pending ON pool_join_consents(member_request_id) WHERE decision = 'PENDING';

-- A given party can only have one open question about a given joiner at a
-- time. Rows from earlier, resolved proposals (DECLINED/VOID/ACCEPTED) stay
-- as history, so the same joiner can be proposed again later without
-- colliding with them.
CREATE UNIQUE INDEX uq_consents_one_pending
  ON pool_join_consents(joiner_request_id, member_request_id)
  WHERE decision = 'PENDING';
