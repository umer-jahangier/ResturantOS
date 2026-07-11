# Phase 10 — Mock GRN / Inventory Fixtures

**Purpose:** Execute Phase 10 fully without Phase 8 (inventory-service). Mocks follow the same contracts as `Docs/agent-specs/02-event-schema-registry.md` and internal API contracts so Phase 8 can swap in later without changing purchasing tests.

**Default integration mode:** `restaurantos.inventory.integration-mode=mock` (dev, test, local docker-compose).  
**Real inventory mode:** `restaurantos.inventory.integration-mode=feign` (after Phase 8).

---

## Fixture scenarios (CI + manual QA)

| ID | Scenario | Mock GRN setup | Expected match | Expected finance JEs |
|----|----------|----------------|----------------|----------------------|
| F1 | Happy path full receive | receivedQty = orderedQty, on-time | All OK → MATCHED | GR/IR on receipt (1300/1700) + invoice (1700/1710→2100) + payment (2100→1100) |
| F2 | Partial receive | receivedQty = 80% of ordered | OK if invoice qty ≤ GRN within tolerance | Same, partial amounts |
| F3 | Over receive | receivedQty = 110% of ordered | QTY_OVER unless tolerance allows | MISMATCHED until override |
| F4 | No GRN yet | receivedQty = 0 | MISSING_GRN | No invoice match |
| F5 | Late delivery | receivedAt > expectedDeliveryDate + 1d | Match OK; scorecard on-time ↓ | GR/IR on receipt still posts |
| F6 | Price drift | Same qty; invoice unit price +5% vs PO | PRICE_OVER (default 2% tol) | MISMATCHED; override → pay |
| F7 | Idempotent replay | Same GRN receive posted twice | No duplicate STOCK_RECEIVED JE | posted_source_events dedup |
| F8 | Spend analytics, multi-period | 2 vendors, 3 categories, Jun 2026 vs May 2026 (default prior window) | `spendReport()` by-vendor + by-category totals with deltaPct | N/A (purchasing_db only, no finance) |

---

## F8 — Spend analytics multi-period (PUR-06)

Category resolved via `spend-category-map.yml` (ingredientId -> category), using the fixed seed
ingredient UUIDs above: `...0001` = Meat, `...0002` = Produce, `...0003` = Dairy.

| Vendor | Category | Jun 2026 (current) | May 2026 (prior) | deltaPct |
|--------|----------|---------------------|-------------------|----------|
| Vendor A | Produce (`...0002`) | 50,000 paisa | 40,000 paisa | ≈ +25% |
| Vendor A | Dairy (`...0003`) | 30,000 paisa | 25,000 paisa | ≈ +20% |
| Vendor B | Meat (`...0001`) | 20,000 paisa | 0 (no prior invoice) | `null` (no prior spend) |

By-vendor totals: Vendor A = 80,000 paisa (Produce + Dairy), Vendor B = 20,000 paisa.
All invoices are `MATCHED`. Default prior-window formula (`compareTo = from.minusDays(1)`,
`compareFrom = compareTo.minusDays(DAYS.between(from, to))`) applied with `from=2026-06-01`,
`to=2026-06-30` yields `compareFrom=2026-05-02`, `compareTo=2026-05-31` — May invoices in this fixture
are dated within that window (e.g. 2026-05-15).

---

## Mock data shapes

### GRN summary (Feign contract — mock adapter returns this)

```json
{
  "poLineId": "uuid",
  "poId": "uuid",
  "grnId": "uuid",
  "receivedQty": "100.000",
  "orderedQty": "100.000",
  "receivedAt": "2026-06-15T10:30:00Z",
  "expectedDeliveryDate": "2026-06-14"
}
```

### STOCK_RECEIVED event payload

Per `02-event-schema-registry.md` — include `poId`, `poLineId`, `ingredientId`, `qtyReceived`, `branchId`, `grnId`.

### GR/IR on receipt JE (finance auto-post)

| DR | CR | sourceType | sourceId |
|----|-----|------------|----------|
| Inventory (1300) | GR/IR (1700) | `GRN` | grnId |

---

## Seed ingredients (logical UUIDs — no inventory DB)

Use fixed UUIDs in mock fixtures and MSW so PO lines, GRN, and frontend demos stay consistent:

| UUID | Name |
|------|------|
| `11111111-1111-4111-8111-111111110001` | Chicken breast |
| `11111111-1111-4111-8111-111111110002` | Cooking oil |
| `11111111-1111-4111-8111-111111110003` | Rice 25kg |

---

## MSW (frontend dev)

Handlers in `frontend/mocks/purchasing.handlers.ts` must implement:

- Vendors, POs, mock GRN receive endpoint
- Invoice list/detail with match columns populated from fixture F1–F6
- Analytics scorecard with on-time/fill-rate/price-variance from mock timestamps
- Analytics spend (F8): by-vendor and by-category totals with a prior-period comparison

---

## Phase 8 swap checklist (post-execution, not Phase 10)

- [ ] Set `integration-mode=feign`
- [ ] Remove or hide mock GRN API from public routes (internal/dev profile only)
- [ ] Re-run fixture scenarios F1–F7 against real inventory-service
- [ ] Delete `mock_grn_receipts` usage from prod profile (table may remain for audit)
