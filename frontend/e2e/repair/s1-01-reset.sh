#!/usr/bin/env bash
#
# Put Floating Terrace / F-7 back to the PRE-FIX routing baseline: nothing routed at all.
#
# The audit that produced the register had already routed Drinks -> BAR over the API while
# diagnosing (register §4.1). Leaving that in place would let the browser proof "verify" a route
# it never created — the screen would show BAR on arrival and a passing run would prove nothing.
# So the baseline is asserted, not assumed.
#
# Usage: bash frontend/e2e/repair/s1-01-reset.sh
set -euo pipefail

REPO="/Users/muhammadumer/Documents/Projects/ResturantOS"
GW="http://localhost:8080"
BRANCH="34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03"   # Floating Terrace HQ (F-7)

CODE="$(python3 "$REPO/scripts/generate_totp.py" admin@terrace.local 2>/dev/null | grep -o '[0-9]\{6\}')"
TOK="$(curl -s -X POST "$GW/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"admin@terrace.local\",\"password\":\"Terrace#Admin1\",\"tenantSlug\":\"floating-terrace\",\"totpCode\":\"$CODE\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['accessToken'])")"

routing() { curl -s -H "Authorization: Bearer $TOK" "$GW/api/v1/pos/menu/routing?branchId=$BRANCH"; }

for c in $(routing | python3 -c "import sys,json;print(' '.join(c['categoryId'] for c in json.load(sys.stdin)['data']['categories'] if c['stationId']))"); do
  curl -s -o /dev/null -w "cleared category $c -> %{http_code}\n" -X PUT \
    -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"stationId":null}' \
    "$GW/api/v1/pos/menu/categories/$c/station?branchId=$BRANCH"
done

for i in $(routing | python3 -c "import sys,json;print(' '.join(i['itemId'] for i in json.load(sys.stdin)['data']['items'] if i['stationId']))"); do
  curl -s -o /dev/null -w "cleared item $i -> %{http_code}\n" -X PUT \
    -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"stationId":null}' \
    "$GW/api/v1/pos/menu/items/$i/station?branchId=$BRANCH"
done

# ── the residue no endpoint can clear ────────────────────────────────────────────────────────
#
# `MenuServiceImpl.assignStation` ALSO writes the pre-28-05 tenant-wide columns
# (`menu_items.station_id`, `menu_items.kds_station`) when it sets a route, and DELIBERATELY does
# not clear them when the route is cleared — the comment in that method says so. The resolver's
# step 3 then keeps answering with that value for any branch the station actually belongs to.
#
# So "Follow the category" does not restore the category route for an item whose route was once
# set at this branch: it falls back to the old column instead. That is a real product defect
# (reported as a new gap by S1-01, NOT fixed here — MenuServiceImpl.java was dirty under another
# agent's change). This SQL is FIXTURE REPAIR so the browser proof starts from a true baseline;
# it is not a workaround being shipped.
docker exec restaurantos-postgres psql -U postgres -d pos_db -qtc \
  "UPDATE menu_items SET station_id = NULL, kds_station = NULL
     WHERE tenant_id = (SELECT tenant_id FROM menu_items WHERE id = '0fc28f38-8170-47fb-b0c6-e96f68c5423f')
       AND station_id IS NOT NULL;" >/dev/null

routing | python3 -c "
import sys,json
d = json.load(sys.stdin)['data']
cats = [(c['categoryName'], c['stationCode']) for c in d['categories'] if c['stationId']]
items = [(i['itemName'], i['effectiveStationCode'], i['source']) for i in d['items'] if i['effectiveStationCode']]
print('BASELINE categories with a route:', cats)
print('BASELINE items with any destination:', items)
assert not cats and not items, 'baseline NOT clean — the proof would verify a route it did not create'
print('baseline clean')
"
