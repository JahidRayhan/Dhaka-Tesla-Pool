#!/bin/bash
# Manual end-to-end walk through the Banani story against a live API + Postgres.
# Not a substitute for `npm test` (backend/tests/, acceptance-tests/) — this is
# the exploratory script used while building the routing, consent and
# concurrency logic, kept for anyone who wants to watch it play out via curl.
# Run from the project root with the DB migrated + seeded and nothing else on :4000.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/backend"

pkill -f "node src/server.js" 2>/dev/null || true
(node src/server.js > /tmp/api.log 2>&1 &)
sleep 2
echo "--- health ---"; curl -s localhost:4000/health; echo

json() { node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); $1"; }
api()  { # api METHOD PATH TOKEN [BODY]
  curl -s -X "$1" "localhost:4000$2" -H "Authorization: Bearer $3" -H "Content-Type: application/json" ${4:+-d "$4"}
}
login() {
  curl -s -X POST localhost:4000/api/auth/login -H "Content-Type: application/json" \
    -d "{\"email\":\"$1@dhakateslapool.test\",\"password\":\"password123\"}" | json "d.token"
}
J=$(login jashim); N=$(login nusrat); R=$(login rafiq); S=$(login shirin)

ZONES=$(curl -s localhost:4000/api/zones)
zid() { echo "$ZONES" | json "d.zones.find(z=>z.name==='$1').id"; }
BANANI=$(zid Banani); MOHAKHALI=$(zid Mohakhali); FARMGATE=$(zid Farmgate); BASHUNDHARA=$(zid Bashundhara)

TESLA_ID=$(api GET /api/teslas/mine $J | json "d.teslas[0].id")
api PATCH /api/teslas/$TESLA_ID/active $J '{"isActive": true}' > /dev/null
echo "Bullet is online"

request_ride() { # token pickup destination
  api POST /api/ride-requests $1 "{\"pickupZoneId\":$2,\"destinationZoneId\":$3,\"seatsRequested\":1}" | json "d.rideRequest.id"
}
show() { api GET /api/ride-requests/$2 $1 | json "const r=d.rideRequest; JSON.stringify({status:r.status, fare:r.final_fare_paisa, poolmates:r.poolmates, waitingOn:r.waitingOn})"; }

echo; echo "--- Nusrat: Banani -> Farmgate (goes through the Mohakhali junction) ---"
NUSRAT_ID=$(request_ride $N $BANANI $FARMGATE); show $N $NUSRAT_ID
echo "--- Rafiq: Mohakhali -> Farmgate (would be picked up ALONG THE WAY) ---"
RAFIQ_ID=$(request_ride $R $MOHAKHALI $FARMGATE); show $R $RAFIQ_ID
echo "--- Shirin: Banani -> Bashundhara (a different branch off the Banani junction) ---"
SHIRIN_ID=$(request_ride $S $BANANI $BASHUNDHARA); show $S $SHIRIN_ID

echo; echo "--- Jashim accepts Nusrat into a NEW pool (nobody to ask yet, so straight to MATCHED) ---"
ACCEPT=$(api POST /api/ride-requests/$NUSRAT_ID/accept $J "{\"teslaId\":\"$TESLA_ID\"}"); echo "$ACCEPT"
POOL_ID=$(echo "$ACCEPT" | json "d.poolId")

echo; echo "--- Jashim proposes Rafiq for the SAME pool -> PENDING_CONFIRMATION (needs EVERYONE's yes) ---"
api POST /api/ride-requests/$RAFIQ_ID/accept $J "{\"teslaId\":\"$TESLA_ID\",\"poolId\":\"$POOL_ID\"}"; echo

echo "--- Jashim tries to propose a SECOND newcomer (Shirin) while Rafiq's is still open (expect 409: one proposal at a time) ---"
curl -s -w " HTTP %{http_code}\n" -X POST localhost:4000/api/ride-requests/$SHIRIN_ID/accept -H "Authorization: Bearer $J" -H "Content-Type: application/json" -d "{\"teslaId\":\"$TESLA_ID\",\"poolId\":\"$POOL_ID\"}"

echo; echo "--- Rafiq agrees. Is that enough? (No: Nusrat has a say too) ---"
api POST /api/ride-requests/$RAFIQ_ID/confirm $R; show $R $RAFIQ_ID
echo "--- Can Jashim arrive yet? (expect 409) ---"
curl -s -w " HTTP %{http_code}\n" -X PATCH localhost:4000/api/pools/$POOL_ID/arrive -H "Authorization: Bearer $J"

echo; echo "--- What Nusrat is being asked ---"
QUESTION=$(api GET /api/ride-requests/mine $N | json "JSON.stringify(d.rideRequests.flatMap(r=>r.pendingConsents)[0])"); echo "$QUESTION"
CONSENT_ID=$(echo "$QUESTION" | json "d.id")
echo "--- Nusrat approves ---"
api POST /api/pool-consents/$CONSENT_ID/approve $N; show $R $RAFIQ_ID

echo; echo "--- Now the proposal is settled, Shirin's route can't merge with the pool's (expect 422) ---"
curl -s -w " HTTP %{http_code}\n" -X POST localhost:4000/api/ride-requests/$SHIRIN_ID/accept -H "Authorization: Bearer $J" -H "Content-Type: application/json" -d "{\"teslaId\":\"$TESLA_ID\",\"poolId\":\"$POOL_ID\"}"

echo; echo "--- Last-seat race: two extra 1-seat requests for the one remaining seat, accepted at once ---"
RACE_A=$(request_ride $N $MOHAKHALI $FARMGATE); RACE_B=$(request_ride $R $MOHAKHALI $FARMGATE)
curl -s -o /tmp/race_a.json -w "A -> HTTP %{http_code}\n" -X POST localhost:4000/api/ride-requests/$RACE_A/accept -H "Authorization: Bearer $J" -H "Content-Type: application/json" -d "{\"teslaId\":\"$TESLA_ID\",\"poolId\":\"$POOL_ID\"}" &
curl -s -o /tmp/race_b.json -w "B -> HTTP %{http_code}\n" -X POST localhost:4000/api/ride-requests/$RACE_B/accept -H "Authorization: Bearer $J" -H "Content-Type: application/json" -d "{\"teslaId\":\"$TESLA_ID\",\"poolId\":\"$POOL_ID\"}" &
wait
echo "(exactly one wins; the winner then has to be agreed to by everyone — here they simply cancel instead)"
if grep -q '"poolId"' /tmp/race_a.json; then api PATCH /api/ride-requests/$RACE_A/cancel $N; else api PATCH /api/ride-requests/$RACE_B/cancel $R; fi

echo; echo "--- Arrive, start (this is when the pool discount finalizes) ---"
curl -s -X PATCH localhost:4000/api/pools/$POOL_ID/arrive -H "Authorization: Bearer $J" -w " arrive -> HTTP %{http_code}\n"
curl -s -X PATCH localhost:4000/api/pools/$POOL_ID/start  -H "Authorization: Bearer $J" -w " start  -> HTTP %{http_code}\n"
echo "Nusrat (expect 8326 paisa = 3000 + 6658 - 1332):"; show $N $NUSRAT_ID
echo "Rafiq  (expect 6589 paisa = 3000 + 4486 - 897):";  show $R $RAFIQ_ID

echo; echo "--- Cross-user access: Rafiq tries to read Nusrat's ride (expect 403) ---"
curl -s -o /dev/null -w "HTTP %{http_code}\n" localhost:4000/api/ride-requests/$NUSRAT_ID -H "Authorization: Bearer $R"

echo; echo "--- Complete ---"
curl -s -X PATCH localhost:4000/api/pools/$POOL_ID/complete -H "Authorization: Bearer $J" -w " complete -> HTTP %{http_code}\n"
echo DONE
