# Acceptance tests — PRD feature coverage

`backend/tests/` (the original suite) is organized by *code module* — fare
math, then the ride lifecycle — and covers Section 12's explicit testing
list well. Going back through the PRD line by line against that suite
surfaced real gaps: nothing exercised signup, login failures, `/auth/me`,
unauthenticated/wrong-role access, ride history, Tesla registration or the
online/offline toggle, the driver's open-requests listing, the pool-detail/
pool-list endpoints, or — most notably — **completing a trip at all**.
`PATCH /pools/:id/complete` was never called by any existing test, which
also meant the Section 5 payment-record requirement was completely
unverified.

This suite is organized the other way around: one file per **PRD
requirement**, so each line below points at the exact test that proves it.
It's kept in its own folder, with its own `package.json` and its own test
database, so it never interferes with `backend/tests/` — both can be run
independently, in either order.

## Coverage matrix

| PRD requirement (Section 3, unless noted) | Test file | Covered by `backend/tests/`? |
|---|---|---|
| Passenger: sign up/in | `01-auth.test.js` | No — only used as a fixture |
| Passenger: request ride (pickup, destination, seats) | `03-ride-history-and-validation.test.js`, `backend/tests/lifecycle.test.js` | Partially |
| Passenger: see estimated fare | `backend/tests/lifecycle.test.js` | Yes |
| Passenger: track status through the full lifecycle | `backend/tests/lifecycle.test.js`, `04-pool-detail-completion-and-payments.test.js` | Partially (never reached COMPLETED) |
| Passenger: view history | `03-ride-history-and-validation.test.js` | No |
| Passenger: cancel while valid | `backend/tests/lifecycle.test.js` | Yes |
| Driver: sign in; go online/offline | `02-teslas-and-roles.test.js` | No |
| Driver: own a Tesla with fixed capacity | `02-teslas-and-roles.test.js` | No (capacity *enforcement* was tested; *registering* one with bounds validation was not) |
| Driver: see relevant (open) requests | `03-ride-history-and-validation.test.js` | No (accepting was tested; the listing endpoint itself was not) |
| Driver: accept a ride/pool | `backend/tests/lifecycle.test.js` | Yes |
| Driver: mark arrival, start | `backend/tests/lifecycle.test.js` | Yes |
| Driver: mark complete | `04-pool-detail-completion-and-payments.test.js` | **No — not exercised at all before this suite** |
| Driver: see passengers/seats and ride history | `04-pool-detail-completion-and-payments.test.js` | No |
| Pool: multiple requests share one Tesla | `backend/tests/lifecycle.test.js` | Yes |
| Pool: occupied seats never exceed capacity (incl. concurrency) | `backend/tests/lifecycle.test.js` | Yes |
| Pool: each passenger gets an individual fare | `backend/tests/lifecycle.test.js` | Yes |
| Pool: a Tesla runs one active pool at a time | `backend/tests/lifecycle.test.js` | Yes |
| Section 4: matching rule (zone/cluster) | `backend/tests/lifecycle.test.js` | Yes |
| Section 5: fare model (base + distance − discount) | `backend/tests/fare.test.js` | Yes |
| Section 5: payment record created on completion | `04-pool-detail-completion-and-payments.test.js` | **No — not exercised at all before this suite** |
| Section 6: JWT auth — reject missing/invalid tokens | `01-auth.test.js` | No |
| Section 6: role-based access (passenger vs. driver routes) | `02-teslas-and-roles.test.js` | No |
| Section 6: validation (bad input rejected cleanly, not 500) | `02-teslas-and-roles.test.js`, `03-ride-history-and-validation.test.js` | No |
| Section 6: users can't access another user's data | `backend/tests/lifecycle.test.js`, `04-pool-detail-completion-and-payments.test.js` | Partially (ride_request cross-user tested; pool cross-driver was not) |
| Section 12: invalid state transitions rejected | `backend/tests/lifecycle.test.js`, `04-pool-detail-completion-and-payments.test.js` | Yes, plus one more case here (complete before start) |

## Running this suite

Needs its own test database, separate from `backend/tests/`'s
`dhaka_tesla_pool_test`, so the two suites can never interfere with each
other even if run at the same time:

```bash
cd acceptance-tests
cp .env.test.example .env.test
npm install
TEST_DB_NAME=dhaka_tesla_pool_acceptance ../scripts/setup-test-db.sh
ENV_FILE=.env.test npm test
```

Expected: all tests pass. As of the last run against the real backend:
**23 pass, 0 fail** across the four files above (7 auth + 5 Tesla/role +
6 ride-history/validation + 5 pool-completion/payments).

## Why a separate folder instead of adding to `backend/tests/`

Two independent reasons: it keeps the original suite's scope honest (it
still does exactly what it always did — code-module coverage of the
Section 12 list) rather than quietly growing into something broader without
that being visible in its own history; and it makes this specific gap
auditable — anyone can diff what existed before against what's here and see
precisely which PRD lines had zero test coverage until now.
