# Phase 36-01 — Procure-to-pay findings register

**Method.** Everything below is a live HTTP response through `http://localhost:8080` as a real
persona, or a row read from the live database as the owning **service role** (never `postgres` —
`purchasing_db` and `inventory_db` are FORCE row-level security and a superuser is exempt even
then). Nothing here was inferred from source. The run is reproducible:

```bash
bash scripts/e2e/phase31-procure-to-pay-e2e.sh          # diagnostic, always exits 0
PHASE31_GATE=1 bash scripts/e2e/phase31-procure-to-pay-e2e.sh   # acceptance gate
```

Raw evidence: `.planning/phases/36-purchasing-inventory-wiring/31-01-drive.log`.

**Freshness.** The run is gated on `scripts/check-stale-jars.sh`. auth, purchasing, inventory,
finance and the gateway were all executing their on-disk jars. `pos-service` and `hr-service` were
stale and are outside this phase's reasoning, so the gate reported and did not block on them.

**Isolation, checked before anything else was believed.** With no tenant GUC, `vendors` and
`ingredients` return 0 rows; with the Floating Terrace GUC they return 1 and 5; under Control
Bistro's GUC, 0 of Floating Terrace's vendors are visible. A harness that saw everything would have
scored a live leak as healthy data.

---

## The wiring table

Driven twice — once as **MANAGER** (the persona the seed uses, and the one recorded as answering
403), once as **OWNER**. Both columns are the real HTTP status.

| # | Chain step | MANAGER | OWNER | Persisted evidence |
|---|---|---|---|---|
| 1 | `POST /purchasing/vendors` | **200** | **200** | `vendors` row read back by id |
| 2 | `GET /purchasing/vendors` | **200** | **200** | 1 pre-existing seed vendor + the drive's |
| 3 | `POST /vendors/{id}/items` (500 G pack) | **200** | **200** | `vendor_items` row |
| 4 | `POST /vendor-items/{id}/prices` | **200** | **200** | `vendor_item_prices.unit_price_paisa = 620000` |
| 5 | `POST /purchase-orders` (catalog + hand-typed line) | **200** | **200** | 2 `purchase_order_lines`, status `DRAFT` |
| 6 | `POST /{id}/submit` | **200** | **200** | status `PENDING_APPROVAL` |
| 7 | `POST /{id}/approve` | **200** | **200** | status `APPROVED`, 1 `po_approval_records` row |
| 8 | `POST /{id}/send` | **200** | **200** | status `SENT` |
| 9 | `POST /{id}/mock-receive` — **both lines in one call** | **409** | **409** | nothing written · **F-31-01** |
| 9b | same receipt, **one line per call** | **200** | **200** | status `FULLY_RECEIVED`, 2 movements |
| 10 | `POST /purchasing/invoices` | **200** | **200** | `vendor_invoices.status = MATCHED`, `matched_at` set |
| 11 | `GET /purchasing/bank-accounts` | **200** | **200** | — |
| 12 | `POST /purchasing/payments` | **200** | **200** | 1 `ap_payment_allocations` row |

| Master-data entity | Create | Read | Update | Archive | Restore | Verdict |
|---|---|---|---|---|---|---|
| Ingredient | 200 | 200 | 200 | 200 | 200 | complete |
| Item category | 200 | 200 | 200 | 200 | n/a | complete |
| Storage location | 200 | 200 | 200 | 200 | n/a | complete |
| **Unit of measure** | 200 | 200 | **404** | **404** | — | **F-31-04** — create-only |
| Opening balance | 200 | — | — | — | — | works |
| Manual stock receipt | 200 | — | — | — | — | works |
| Stock count | 200 | — | — | — | — | works, on-hand 13.0000 read back |
| Stock levels | — | 200 | — | — | — | works |

**Tally: 47 pass, 2 fail.** Both failures are step 9, one per persona — the same defect.

---

## The MANAGER 403 — cause, and it is not what the seed comment says

**It does not reproduce. `GET /api/v1/purchasing/vendors` as `manager@terrace.local` answers 200.**

Four candidate causes were named in advance. Three are excluded with the query that excludes them,
and the fourth is what actually happened.

| Candidate | Discriminating evidence | Verdict |
|---|---|---|
| The tenant lacks `FEATURE_VENDOR`, and the gateway's route-to-feature map refuses | A disabled feature produces `FEATURE_DISABLED` in the error envelope. No purchasing call in the drive produced that code, and every `@RequiresFeature("FEATURE_VENDOR")` controller answered 200. | **excluded** |
| `auth_db` is missing the role→permission rows (the drift shape `045-repair-vendor-manage-approve-grants.xml` documents) | `select role_code, permission_code from role_permissions where permission_code like 'vendor%'` returns **10 rows for MANAGER** — `vendor.view, manage, po.create, po.approve, po.send, po.close, grn.receive, invoice.book, invoice.override, payment.create`. The rows are present. | **excluded now — this WAS the cause** |
| The rows exist but the issued token does not carry them | The MANAGER token's own `permissions` claim carries all ten `vendor.*` authorities, read out of the JWT, not assumed. | **excluded** |
| The demand itself is wrong — the endpoint asks for an authority the role should not need | Every purchasing endpoint demands a `vendor.*` authority that exists in the catalogue and is held by at least one role. No endpoint demands an authority nobody holds. | **excluded** |

**Cause: permission-grant drift in `auth_db`, already repaired.** The grants MANAGER needs are
present today. This is a **confirmed-closed** item, not work for plan 36-02.

**What plan 36-02 must therefore do — and must not do.** It must NOT widen a role: MANAGER already
holds every authority purchasing asks of it, so there is nothing to grant. Its remaining, real job
is the one thing the drive could not check by driving: making the drift *unrepeatable* and the
*distinction visible*. Specifically —

1. A test that reads the `@PreAuthorize` authority strings out of `services/purchasing-service/**/web/`
   at test time and fails when one is not in the permission catalogue or is granted to no role. The
   evidence above is a snapshot of one database on one day; a new endpoint added tomorrow escapes it.
2. A negative case: roles deliberately excluded from purchasing (Waiter, Cashier, Kitchen Staff)
   must still be excluded, asserted rather than assumed.
3. The feature-disabled-versus-permission-denied distinction at the screen. Both are 403 today and
   a user cannot tell "your plan does not include purchasing" from "you are not allowed to do this".

**Routed to: D-36-02.**

---

## Findings

### F-31-01 — A goods receipt of more than one line is impossible

**Severity: blocker.** This breaks the definition-of-done chain for every realistic purchase order.

**Surface:** `POST /api/v1/purchasing/purchase-orders/{poId}/mock-receive`

**Request:** two lines in one body, which is what a receiving clerk does with a two-line delivery:

```json
{"lines":[{"poLineId":"<catalog line>","receivedQty":2},
          {"poLineId":"<hand-typed line>","receivedQty":3}]}
```

**Response:** `409 CONFLICT` — `{"error":{"code":"CONFLICT","message":"This conflicts with existing data"}}`

**Database evidence:**

```
purchasing-service.log
  ERROR: duplicate key value violates unique constraint "uq_mock_grn_idem"

purchasing_db
  uq_mock_grn_idem  UNIQUE (tenant_id, idempotency_key)
```

**Mechanism.** `GrnReceiptSimulator.simulateReceive` writes one `MockGrnReceipt` row **per line**,
and sets the caller's single `Idempotency-Key` on **every one of them**. The second row in the same
call collides with the first. The uniqueness constraint is correct — an idempotency key must
identify one request — but the row it is attached to is per-line, so the invariant it expresses is
"one line per request", which nobody intended.

**Discrimination (this is the part that matters for the repair).** The same receipt succeeds when
sent one line at a time: `9b` is `200`, twice, for both personas. Receiving is not broken.
Receiving *more than one line* is. The repair is in the idempotency-key-to-row relationship, not in
the receiving path.

**Nothing partial was written** — the transaction rolls back, PO stays `SENT`, no movement, no
journal entry. That much is sound.

**Routed to: D-36-04** (plan 36-04 owns `GrnReceiptSimulator.java`).

---

### F-31-02 — A purchase order for an ingredient inventory has never seen is accepted, closes as FULLY_RECEIVED, and produces nothing

**Severity: blocker.** This is the defect the phase was called for, confirmed exactly, and it is
slightly worse than reported.

**Reproduction (probe 1 in the drive):** create a PO line naming a freshly generated UUID as
`ingredientId`.

| Step | Result |
|---|---|
| `POST /purchase-orders` with the unknown ingredient | **200** — accepted |
| `POST /{id}/submit` | 200 |
| `POST /{id}/approve` | 200 |
| `POST /{id}/send` | 200 |
| `POST /{id}/mock-receive` | **200** |
| `purchase_orders.status` afterwards | **`FULLY_RECEIVED`** |
| `ingredient_branch_stock` rows for that ingredient | **0** |
| `inventory_movements` rows for that ingredient | **0** |
| `inventory.grn-received.queue.dlq` depth | **4 → 5** |

Every call reports success. The purchase order says the goods arrived. There is no stock, no
movement, and no journal entry. The message dead-letters ~20 seconds later after the consumer
exhausts its 2s/4s/8s retries, into a queue with **no consumer and no monitor**, so nothing and
nobody ever learns.

The correct moment to refuse is at `POST /purchase-orders`, where a human is present and can fix
the line. Refusing later only moves the silence.

**Routed to: D-36-04.**

---

### F-31-03 — A hand-typed line whose unit the tenant does not define is received at face value

**Severity: blocker.** Same class as the 1000× COGS defect, still open on this path.

**Reproduction (probe 2):** a hand-typed PO line, `uom: "FURLONG"`, against Basmati Rice, which is
stocked in **KG**. Nothing in the tenant's `units_of_measure` defines FURLONG.

| Step | Result |
|---|---|
| `POST /purchase-orders` with `uom: FURLONG` | **200** — accepted |
| submit / approve / send | 200 / 200 / 200 |
| `mock-receive`, quantity 7 | **200** |
| `ingredient_branch_stock.qty_on_hand` | **129.5000 → 136.5000** |

**Seven FURLONGs became seven kilograms.** `GrnUomResolver.resolveFactor` logs at ERROR and returns
`BigDecimal.ONE` — receiving at face value is the documented, deliberate behaviour, chosen because
throwing would dead-letter a batch after finance had already posted. That reasoning no longer holds:
finance now posts from the real stock lot (phase 14), so there is no longer an entry that a refusal
would strand.

Two things are wrong and they belong to two different plans:

- The line should never have been **created** with a unit the registry does not define — the tenant
  can be asked at the API, where a person can correct it. → **D-36-04** (plan 36-04).
- The receipt should **refuse** rather than guess, leaving no stock lot, no moving-average blend and
  no movement row. → **D-36-05** (plan 36-06).

**Routed to: D-36-04 and D-36-05.**

---

### F-31-04 — A unit of measure can be created and never changed or retired

**Severity: high.** Directly the user's report that master data is "not working".

| Call | Status |
|---|---|
| `POST /api/v1/inventory/uom` | 200 |
| `GET /api/v1/inventory/uom` | 200 |
| `PUT /api/v1/inventory/uom/{id}` | **404** |
| `POST /api/v1/inventory/uom/{id}/archive` | **404** |
| `DELETE /api/v1/inventory/uom/{id}` | **404** |

`UnitOfMeasureController` exposes exactly two methods. Every other master-data entity — ingredient,
category, storage location — has update and archive. A tenant that mistypes a unit's name or factor
has no way to correct it, and a unit created by accident is permanent and appears in every picker
forever. A `TETS` unit ("TEST", factor 5 G) is sitting in Floating Terrace's registry right now,
which is what that looks like in practice.

Retirement must be a timestamp, never a delete, and the code must never become editable: a unit code
is a foreign key **by value** across three services and two databases.

**Routed to: D-36-06.**

---

### F-31-05 — `finance.invoice-matched.queue` is bound, filling, and has no consumer

**Severity: medium.** Nothing in this phase's chain depends on it, which is exactly why it went
unnoticed.

```
name                              ready  unacked  consumers
finance.invoice-matched.queue         5        0          0
finance.invoice-matched.queue.dlq     0        0          0
reporting.invoice-matched.queue       0        0          1
```

Reporting consumes `INVOICE_MATCHED`; finance's queue is declared and bound and nothing reads it.
Messages accumulate forever. It is not a correctness defect *today* — the vendor-invoice journal
entry is posted by a different path and does post (`VENDOR_INVOICE`, 8 entries, DR 1700 / CR 2100,
balanced) — but a bound queue with no listener is either dead declaration that should be removed or
a consumer that was never written, and only someone who knows which can say.

**Routed to: handoff — no locked decision covers it.** See below.

---

### F-31-06 — A rejected value answers 409 with a message that names nothing

**Severity: low, but it is why finding real defects here is slow.**

`POST /vendor-items/{id}/prices` with `"source":"drive"` answers:

```
409 {"error":{"code":"CONFLICT","message":"This conflicts with existing data","details":[]}}
```

The real cause is a check constraint: `source` must be one of `CATALOG, CONTRACT, INVOICE, MANUAL`.
The response says neither the field nor the permitted values, and `details` is empty although the
error envelope has a slot for exactly this. The same opaque 409 is what F-31-01 produces for a
completely different cause, which is how a blocker spent an afternoon looking like a duplicate
submission.

**Routed to: handoff** — it is a shared-lib error-envelope concern, not purchasing's, and widening
this phase to cover it would be scope creep.

---

## Confirmed closed

Recorded so that a later plan does not repair them again.

### C-1 — The purchase-unit conversion is correct on the catalog path (was the 1000× defect)

The hand-checkable case was driven end to end. A vendor catalog item of **500 G per pack** priced at
**620,000 paisa (PKR 6,200) per pack**, two packs received, against **Basmati Rice stocked in KG**:

- expected: 2 × 500 G = 1000 G = **+1.0 KG**, at 620,000 ÷ 500 g × 1000 g/kg = **1,240,000 paisa/KG**
- plus the hand-typed line, 3 KG at 1,250,000 paisa/KG = **+3.0 KG**
- **expected total: +4.0 KG.** Observed: `qty_on_hand` **106.5000 → 110.5000**. Exact.

Moving-average cost blended correctly too: 110.5 KG at 74,004.5249 blended with 1 KG at 1,240,000
and 3 KG at 1,250,000 gives **115,000.0000** paisa/KG, which is the value in
`ingredient_branch_stock`. Checked by hand, to the paisa.

`IngredientUomFactorResolver` and `GrnUomResolver`'s ratio arithmetic are right. Plan 36-06 must not
touch the arithmetic — its job is the **refusal** (F-31-03), not the conversion.

### C-2 — A goods receipt posts exactly one journal entry

26 `RECEIPT` movements in inventory over the run; 26 `STOCK_RECEIPT` journal entries in finance
across **26 distinct `source_id`s**. One entry per stock lot, no double post. The phase-14 defect
(purchasing posting DR 1300 / CR 1700 *and* finance posting the same entry from `STOCK_RECEIVED`)
has not regressed.

### C-3 — The ledger shape is correct and every entry balances

```
STOCK_RECEIPT   DR 1300  43,524,000   CR 1700  43,524,000
VENDOR_INVOICE  DR 1700   9,920,000   CR 2100   9,920,000
AP_PAYMENT      DR 2100   9,920,000   CR 1010   9,920,000
COUNT_VARIANCE  DR 5231      25,285   CR 1300      25,285
```

Accounts payable nets to **zero** across the invoice-then-pay cycle. No `JE_UNBALANCED` rejection
appeared. GR/IR (1700) does **not** net to zero, and that is correct rather than a defect: far more
was received than invoiced, because the drive invoices only the catalog line and the three probes
never invoice at all. The residual credit is the uninvoiced receipts, which is what GR/IR is for.

### C-4 — Approval limits are populated and do gate approval

Both personas' tokens carry `attributes.approval_limit_paisa` — MANAGER 30,000,000, OWNER
100,000,000 — and approval succeeded with a `po_approval_records` row written. The seed's repair
(commit `28f3964`) holds.

**This does not close D-36-03.** The limit is on the row because a *script* put it there. Plan 36-03
still owns making it settable from inside the product, which the drive cannot test because the
capability does not exist.

### C-5 — The seed's row-level-security warning is now false, and the caveat above it is stale

`scripts/seed_restaurantos.py` carries a comment above its vendor-listing call asserting that
purchasing tables are RLS-enabled but **not forced**, so a listing returns every tenant's vendors.
That is no longer true. Every tenant-owned table in both databases carries FORCE:

```
purchasing_db: vendors, purchase_orders, purchase_order_lines, vendor_items,
               vendor_item_prices, vendor_invoices, vendor_invoice_lines,
               ap_payments, ap_payment_allocations, po_approval_records,
               po_approval_tiers, vendor_catalogues, vendor_categories,
               mock_grn_receipts                       — all rowsecurity=t, forced=t
inventory_db:  ingredients, ingredient_branch_stock, units_of_measure,
               item_categories, storage_locations, stock_lots,
               inventory_movements, recipes, recipe_lines, stock_counts,
               stock_count_lines, stock_transfers, stock_wastage, …  — all t / t
```

A stale warning in a seed is how a real leak gets ignored, so this is a finding even though it lands
in the safe direction. **Routed to: D-36-01 / plan 36-07**, which owns the seed and the credentials
document.

### C-6 — Tenant isolation holds at the application layer, not only the database layer

The database policy was verified by canary. The **application** was verified separately, because
they are different questions — a `findById` where a `findByTenantIdAndId` was meant compiles fine
and is scoped by nothing:

| Attempt, with a Floating Terrace token | Result |
|---|---|
| `GET /purchasing/purchase-orders/{a Saffron Grill PO id}` | **404 NOT_FOUND** |
| `GET /inventory/ingredients/{a Saffron Grill ingredient id}` | **404 NOT_FOUND** |

Both refuse, and both refuse with 404 rather than 403, which leaks less. Noted because a sibling
audit found Hibernate's `tenantFilter` failing to propagate to `BranchEntity` elsewhere in the
fleet; on these two read paths it does not.

---

## Handoff — found here, owned elsewhere

| Item | Why it is not this phase's work | Suggested owner |
|---|---|---|
| **F-31-05** `finance.invoice-matched.queue` bound with no consumer, 5 messages and growing | Nothing in procure-to-pay depends on it and the vendor-invoice entry posts by another path. Deciding between "delete the declaration" and "write the missing consumer" needs the finance owner, not a purchasing repair. | finance-service |
| **F-31-06** 409 CONFLICT with an empty `details` array on a check-constraint violation | `GlobalExceptionHandler` in shared-lib maps every `DataIntegrityViolationException` to one opaque message for every service in the fleet. Fixing it here would be a fleet-wide change made inside a purchasing plan. | shared-lib |
| `inventory.grn-received.queue.dlq` has **no consumer and no monitor** | The DLQ is correctly bound and correctly receives poison messages; the gap is that only pos and kitchen have DLQ alerting. That is an observability decision across the fleet. | platform / observability |
| `tenant_match_tolerances` in `purchasing_db` has neither RLS nor FORCE | It appears to be tenant-scoped configuration. It may be deliberate (a platform-wide default table), and `RlsForcedInvariantIT` currently passes, so it is either exempted on purpose or an exemption nobody re-examined. Not touched here. | purchasing-service |

---

## What each remaining plan's inbox now contains

| Decision | Plan | Verdict from this drive |
|---|---|---|
| **D-36-02** — the purchasing permission question | 36-02 | **The 403 does not reproduce; the grants are present.** Do not widen any role. The remaining work is the reachability test that makes the drift unrepeatable, the negative case for excluded roles, and making feature-disabled distinguishable from permission-denied on screen. |
| **D-36-03** — approval limits set in the UI | 36-03 | Limits exist and gate correctly, but only because a script wrote them. The capability to set one from inside the product does not exist. Full scope stands. |
| **D-36-04** — a PO line must reference a real ingredient | 36-04 | **F-31-02** and **F-31-03** confirmed, plus **F-31-01** (multi-line receipt impossible) which was not previously known and is a blocker. |
| **D-36-05** — one conversion resolver, refusing rather than guessing | 36-06 | The **arithmetic is correct** (C-1) — do not touch it. The **refusal** is missing: F-31-03 shows 7 FURLONG becoming 7 KG. |
| **D-36-06** — master data is complete CRUD | 36-05 | Ingredients, categories and storage locations are complete. **Units of measure are create-only** (F-31-04). |
| **D-36-01** — seed and credentials tell the truth | 36-07 | Purchasing is reachable for the seed's persona, so the "purchasing is empty" caveat can go once the seed actually creates the data. The seed's RLS warning is **stale and must be corrected** (C-5). |

**This plan applied no fix.** Every item above is someone else's to repair.
