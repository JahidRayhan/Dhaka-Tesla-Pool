#!/bin/bash
# Manual end-to-end smoke test of the Banani rush-hour story, run against a
# live API + Postgres. Not a substitute for `npm test` (backend/tests/) —
# this is the exploratory script used while building the concurrency and
# fare-lock logic, kept for anyone who wants to watch the story play out via
# curl. Run from the project root, with the DB migrated/seeded and nothing
# else already listening on :4000.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/backend"

pkill -f "node src/server.js" 2>/dev/null || true
(node src/server.js > /tmp/api.log 2>&1 &)
sleep 2
echo "--- health ---"
curl -s localhost:4000/health; echo

login() {
  curl -s -X POST localhost:4000/api/auth/login -H "Content-Type: application/json" \
    -d "{\"email\":\"$1@dhakateslapool.test\",\"password\":\"password123\"}" \
    | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).token"
}

J=$(login jashim)
N=$(login nusrat)
R=$(login rafiq)
S=$(login shirin)
echo "jashim=${J:0:15}... nusrat=${N:0:15}... rafiq=${R:0:15}... shirin=${S:0:15}..."

echo "--- zones ---"
ZONES_JSON=$(curl -s localhost:4000/api/zones)
echo "$ZONES_JSON" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).zones.map(z=>z.name+'='+z.id).join(' | ')"

BANANI=$(echo "$ZONES_JSON" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).zones.find(z=>z.name==='Banani').id")
MOHAKHALI=$(echo "$ZONES_JSON" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).zones.find(z=>z.name==='Mohakhali').id")
GULSHAN1=$(echo "$ZONES_JSON" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).zones.find(z=>z.name==='Gulshan 1').id")
MIRPUR=$(echo "$ZONES_JSON" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).zones.find(z=>z.name==='Mirpur').id")

echo "--- Jashim registers Bullet is already seeded; go online ---"
TESLA_ID=$(curl -s localhost:4000/api/teslas/mine -H "Authorization: Bearer $J" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).teslas[0].id")
curl -s -X PATCH localhost:4000/api/teslas/$TESLA_ID/active -H "Authorization: Bearer $J" -H "Content-Type: application/json" -d '{"isActive": true}' > /dev/null
echo "tesla=$TESLA_ID online"

echo "--- Nusrat requests Banani -> Mohakhali ---"
NUSRAT_REQ=$(curl -s -X POST localhost:4000/api/ride-requests -H "Authorization: Bearer $N" -H "Content-Type: application/json" \
  -d "{\"pickupZoneId\":$BANANI,\"destinationZoneId\":$MOHAKHALI,\"seatsRequested\":1}")
echo "$NUSRAT_REQ" | node -pe "const r=JSON.parse(require('fs').readFileSync(0,'utf8')).rideRequest; 'id='+r.id+' estimatedFare='+r.final_fare_paisa+'p base='+r.base_fare_paisa+' distanceCharge='+r.distance_charge_paisa"
NUSRAT_ID=$(echo "$NUSRAT_REQ" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).rideRequest.id")

echo "--- Rafiq requests Banani -> Gulshan 1 ---"
RAFIQ_REQ=$(curl -s -X POST localhost:4000/api/ride-requests -H "Authorization: Bearer $R" -H "Content-Type: application/json" \
  -d "{\"pickupZoneId\":$BANANI,\"destinationZoneId\":$GULSHAN1,\"seatsRequested\":1}")
echo "$RAFIQ_REQ" | node -pe "const r=JSON.parse(require('fs').readFileSync(0,'utf8')).rideRequest; 'id='+r.id+' estimatedFare='+r.final_fare_paisa+'p base='+r.base_fare_paisa+' distanceCharge='+r.distance_charge_paisa"
RAFIQ_ID=$(echo "$RAFIQ_REQ" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).rideRequest.id")

echo "--- Shirin requests Banani -> Mirpur (should NOT be poolable with the above) ---"
SHIRIN_REQ=$(curl -s -X POST localhost:4000/api/ride-requests -H "Authorization: Bearer $S" -H "Content-Type: application/json" \
  -d "{\"pickupZoneId\":$BANANI,\"destinationZoneId\":$MIRPUR,\"seatsRequested\":1}")
SHIRIN_ID=$(echo "$SHIRIN_REQ" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).rideRequest.id")
echo "shirin req id=$SHIRIN_ID"

echo "--- Jashim accepts Nusrat into a NEW pool ---"
ACCEPT1=$(curl -s -X POST localhost:4000/api/ride-requests/$NUSRAT_ID/accept -H "Authorization: Bearer $J" -H "Content-Type: application/json" \
  -d "{\"teslaId\":\"$TESLA_ID\"}")
echo "$ACCEPT1"
POOL_ID=$(echo "$ACCEPT1" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).poolId")
echo "pool=$POOL_ID"

echo "--- Jashim accepts Rafiq into the SAME pool ---"
ACCEPT2=$(curl -s -X POST localhost:4000/api/ride-requests/$RAFIQ_ID/accept -H "Authorization: Bearer $J" -H "Content-Type: application/json" \
  -d "{\"teslaId\":\"$TESLA_ID\",\"poolId\":\"$POOL_ID\"}")
echo "$ACCEPT2"
echo "(joining an EXISTING pool lands in PENDING_CONFIRMATION — Rafiq must explicitly agree to share)"

echo "--- Rafiq confirms sharing the ride ---"
curl -s -X POST localhost:4000/api/ride-requests/$RAFIQ_ID/confirm -H "Authorization: Bearer $R" -w " confirm -> HTTP %{http_code}\n"

echo "--- Jashim tries to accept Shirin into the SAME pool (should be REJECTED — different cluster) ---"
curl -s -w "\nHTTP %{http_code}\n" -X POST localhost:4000/api/ride-requests/$SHIRIN_ID/accept -H "Authorization: Bearer $J" -H "Content-Type: application/json" \
  -d "{\"teslaId\":\"$TESLA_ID\",\"poolId\":\"$POOL_ID\"}"

echo "--- Concurrency test: two simultaneous accepts for the pool's last logical seat ---"
echo "(pool now has 2/3 seats occupied; fire two concurrent 1-seat accepts and expect exactly one to succeed)"
# Reuse Shirin's existing request twice isn't valid (already REQUESTED once) so
# create two fresh 1-seat requests compatible with the pool and race them.
mkREQ() {
  curl -s -X POST localhost:4000/api/ride-requests -H "Authorization: Bearer $1" -H "Content-Type: application/json" \
    -d "{\"pickupZoneId\":$BANANI,\"destinationZoneId\":$MOHAKHALI,\"seatsRequested\":1}" \
    | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).rideRequest.id"
}
RACE_A=$(mkREQ "$N")
RACE_B=$(mkREQ "$R")
echo "race requests: A=$RACE_A B=$RACE_B"

curl -s -o /tmp/race_a.json -w "A -> HTTP %{http_code}\n" -X POST localhost:4000/api/ride-requests/$RACE_A/accept -H "Authorization: Bearer $J" -H "Content-Type: application/json" -d "{\"teslaId\":\"$TESLA_ID\",\"poolId\":\"$POOL_ID\"}" &
curl -s -o /tmp/race_b.json -w "B -> HTTP %{http_code}\n" -X POST localhost:4000/api/ride-requests/$RACE_B/accept -H "Authorization: Bearer $J" -H "Content-Type: application/json" -d "{\"teslaId\":\"$TESLA_ID\",\"poolId\":\"$POOL_ID\"}" &
wait
echo "race A result:"; cat /tmp/race_a.json; echo
echo "race B result:"; cat /tmp/race_b.json; echo

echo "--- whichever request won the race must also confirm sharing before arrival ---"
if grep -q '"poolId"' /tmp/race_a.json; then
  curl -s -X POST localhost:4000/api/ride-requests/$RACE_A/confirm -H "Authorization: Bearer $N" -w " confirm winner A -> HTTP %{http_code}\n"
else
  curl -s -X POST localhost:4000/api/ride-requests/$RACE_B/confirm -H "Authorization: Bearer $R" -w " confirm winner B -> HTTP %{http_code}\n"
fi

echo "--- pool detail after all this ---"
curl -s localhost:4000/api/pools/$POOL_ID -H "Authorization: Bearer $J" | node -pe "JSON.stringify(JSON.parse(require('fs').readFileSync(0,'utf8')).pool, null, 2)"

echo "--- driver marks arrive -> start (this is where fares finalize) ---"
curl -s -X PATCH localhost:4000/api/pools/$POOL_ID/arrive -H "Authorization: Bearer $J" -w " arrive-> HTTP %{http_code}\n"
curl -s -X PATCH localhost:4000/api/pools/$POOL_ID/start -H "Authorization: Bearer $J" -w " start -> HTTP %{http_code}\n"

echo "--- Nusrat's final fare (expect 4738 paisa) ---"
curl -s localhost:4000/api/ride-requests/$NUSRAT_ID -H "Authorization: Bearer $N" | node -pe "const r=JSON.parse(require('fs').readFileSync(0,'utf8')).rideRequest; JSON.stringify({status:r.status, base:r.base_fare_paisa, distance:r.distance_charge_paisa, discount:r.pool_discount_paisa, final:r.final_fare_paisa})"

echo "--- Rafiq's final fare (expect 5054 paisa) ---"
curl -s localhost:4000/api/ride-requests/$RAFIQ_ID -H "Authorization: Bearer $R" | node -pe "const r=JSON.parse(require('fs').readFileSync(0,'utf8')).rideRequest; JSON.stringify({status:r.status, base:r.base_fare_paisa, distance:r.distance_charge_paisa, discount:r.pool_discount_paisa, final:r.final_fare_paisa})"

echo "--- cross-user access control: Rafiq tries to read Nusrat's ride (expect 403) ---"
curl -s -o /dev/null -w "HTTP %{http_code}\n" localhost:4000/api/ride-requests/$NUSRAT_ID -H "Authorization: Bearer $R"

echo "--- complete the trip ---"
curl -s -X PATCH localhost:4000/api/pools/$POOL_ID/complete -H "Authorization: Bearer $J" -w " complete -> HTTP %{http_code}\n"

echo "DONE"
