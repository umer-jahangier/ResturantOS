#!/usr/bin/env bash
# ATTACK 14: tenant isolation across the inventory/purchasing surface.
# Sign in as Floating Terrace and try to read Control Bistro's stock, vendors, POs and invoices.
set -u
GW=http://localhost:8080
SC=/private/tmp/claude-501/-Users-muhammadumer-Documents-Projects-ResturantOS/b8e6f92e-7d80-4d4f-b270-4f05a9458825/scratchpad

tok() { curl -s -X POST "$GW/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d "{\"tenantSlug\":\"$1\",\"email\":\"$2\",\"password\":\"$3\"}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',d).get('accessToken',''))"; }

FT=$(tok floating-terrace manager@terrace.local 'Terrace#Manager1')
CB=$(tok control-bistro-isolation-test-tenant manager@control.local 'Control#Manager1')
echo "FT token: ${#FT} chars | CB token: ${#CB} chars"

claim() { python3 -c "
import base64,json,sys
t='$1'.split('.')[1]; t+='='*(-len(t)%4)
p=json.loads(base64.urlsafe_b64decode(t)); print(p.get('$2',''))"; }

FT_T=$(claim "$FT" tenant_id); FT_B=$(claim "$FT" branch_id)
CB_T=$(claim "$CB" tenant_id); CB_B=$(claim "$CB" branch_id)
echo "FT tenant=$FT_T branch=$FT_B"
echo "CB tenant=$CB_T branch=$CB_B"
echo

probe() { # label token url
  code=$(curl -s -o "$SC/iso.body" -w '%{http_code}' "$3" -H "Authorization: Bearer $2")
  n=$(python3 -c "
import json
try:
  d=json.load(open('$SC/iso.body')); r=d.get('data',d)
  if isinstance(r,dict): r=r.get('items',r.get('content',[]))
  print(len(r) if isinstance(r,list) else 'obj')
except Exception: print('-')")
  echo "  $1 -> http=$code rows=$n  $(head -c 130 "$SC/iso.body")"
}

echo "=== BASELINE: each tenant reading its OWN data ==="
probe "FT reads FT stock  " "$FT" "$GW/api/v1/inventory/stock?branchId=$FT_B"
probe "CB reads CB stock  " "$CB" "$GW/api/v1/inventory/stock?branchId=$CB_B"

echo
echo "=== ATTACK: Floating Terrace manager reaching for Control Bistro ==="
probe "FT -> CB stock     " "$FT" "$GW/api/v1/inventory/stock?branchId=$CB_B"
probe "FT -> CB POs       " "$FT" "$GW/api/v1/purchasing/purchase-orders?branchId=$CB_B"
probe "FT -> CB suggests  " "$FT" "$GW/api/v1/purchasing/order-suggestions?branchId=$CB_B"
probe "FT -> CB wastage   " "$FT" "$GW/api/v1/inventory/wastage?branchId=$CB_B"
probe "FT -> CB vendors   " "$FT" "$GW/api/v1/purchasing/vendors"
probe "FT -> CB invoices  " "$FT" "$GW/api/v1/purchasing/invoices?branchId=$CB_B"

echo
echo "=== ATTACK: reverse direction ==="
probe "CB -> FT stock     " "$CB" "$GW/api/v1/inventory/stock?branchId=$FT_B"
probe "CB -> FT POs       " "$CB" "$GW/api/v1/purchasing/purchase-orders?branchId=$FT_B"

echo
echo "=== ATTACK: direct object reference — FT's real PO id, read by CB ==="
probe "CB -> FT PO byId   " "$CB" "$GW/api/v1/purchasing/purchase-orders/99a80052-e7fb-41da-b958-fbb437fbb3f2"
probe "FT -> own PO byId  " "$FT" "$GW/api/v1/purchasing/purchase-orders/99a80052-e7fb-41da-b958-fbb437fbb3f2"

echo
echo "=== ATTACK: can FT WRITE into CB's branch? (receipt) ==="
code=$(curl -s -o "$SC/iso.w" -w '%{http_code}' -X POST "$GW/api/v1/inventory/receipts" \
  -H "Authorization: Bearer $FT" -H 'Content-Type: application/json' \
  -d "{\"branchId\":\"$CB_B\",\"lines\":[{\"ingredientId\":\"00000000-0000-0000-0000-000000000001\",\"qty\":1,\"unitCostPaisa\":100}]}")
echo "  FT writes receipt into CB branch -> http=$code $(head -c 200 "$SC/iso.w")"
