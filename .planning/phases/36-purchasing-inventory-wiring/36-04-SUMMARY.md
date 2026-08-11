---
phase: 36-purchasing-inventory-wiring
plan: 04
subsystem: api
tags: [purchasing, inventory, validation, feign, idempotency, uom, rabbitmq]

requires:
  - phase: 36-purchasing-inventory-wiring
    provides: 31-01-FINDINGS.md — F-31-01, F-31-02 and F-31-03, each measured live
provides:
  - reference validation governed by its own setting, independent of goods-receipt simulation
  - PoLineValidityGate — one place a PO line is judged, applied at creation and at receipt
  - a multi-line goods receipt that works
affects: [36-06, 36-07, 36-08]

tech-stack:
  added: []
  patterns:
    - "A cross-service check is gated by a property about that check, never by a property about something else"
    - "Validate the value that will actually travel on the event, not the one a reader expects"
    - "Everything that can refuse, refuses before anything is written"

key-files:
  created:
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/service/PoLineValidityGate.java
    - services/purchasing-service/src/test/java/io/restaurantos/purchasing/PoLineValidityGateIT.java
    - scripts/e2e/phase31-po-line-validity-e2e.sh
  modified:
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/config/InventoryIntegrationProperties.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/adapter/FeignIngredientReferenceValidator.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/adapter/MockIngredientReferenceValidator.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/service/PurchaseOrderService.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/service/GrnReceiptSimulator.java
    - services/purchasing-service/src/main/resources/application.yml
    - services/purchasing-service/src/test/java/io/restaurantos/purchasing/PurchasingTestBase.java

key-decisions:
  - "restaurantos.inventory.validate-references is a second, independent property; integration-mode keeps its meaning and default exactly."
  - "The gate checks the unit that travels on the goods-receipt event — packUom for a catalog line — not orderUom and not line.uom."
  - "F-31-01 repaired by putting the idempotency key on the FIRST row of the batch rather than on every row."

patterns-established:
  - "A refusal names every offending line, not the first — a caller fixing a twenty-line order one refusal at a time stops using the screen"

requirements-completed: [PIW-04]

duration: 80min
completed: 2026-08-11
status: complete
---

# Phase 36 Plan 04: The PO line validity gate Summary

**A purchase-order line naming an ingredient inventory does not have, or a unit inventory cannot
convert, is now refused with a 422 that names the line, the value and what would work instead —
and the goods receipt of a two-line delivery, which answered 409 for every realistic order,
succeeds.**

## Performance

- **Duration:** ~80 min · **Tasks:** 3 of 3 · **Created:** 3 · **Modified:** 7
- `PoLineValidityGateIT`: **12/12**
- `phase31-po-line-validity-e2e.sh`: **20 pass / 0 fail** against the live stack
- purchasing suite: 124 tests, 108 passing; the 16 failures are two classes broken by another
  executor's commit and by Docker — see Issues Encountered and `deferred-items.md`

## The defect that made all of this necessary

The ingredient reference check **already existed** and had **never once run**. It was conditioned on
`restaurantos.inventory.integration-mode=feign`; the live value is `mock`, because
`MockGrnController` is the only receiving path anything in this fleet has and it answers 404 outside
simulation mode. So a check written specifically to stop dangling ingredient references was disabled
everywhere it mattered, by a property about something else entirely — and the class implementing the
permissive fallback documented the reason as "mock mode has no reachable inventory-service", which
is true of an integration test and has never been true of the live stack.

Whether goods receipts are simulated and whether a reference is real are unrelated questions. They
are two settings now, and the configuration file says so in a comment so the next reader does not
re-merge them.

## What the chain does now that it did not before

| | before | after |
|---|---|---|
| PO line for an ingredient inventory never saw | 200, → `FULLY_RECEIVED`, no stock, no movement, no journal entry, DLQ +1 | **422 `INGREDIENT_NOT_FOUND`**, naming the line and the id, nothing written |
| PO line with unit `FURLONG` | 200, then 7 furlongs became **7 kilograms** | **422 `PACK_UOM_INVALID`**, naming the unit and the units that would work |
| Goods receipt of **two** lines in one call | **409 CONFLICT** "This conflicts with existing data" | **200**, `FULLY_RECEIVED`, stock +5.0 KG exactly |
| Receipt against a line created before the gate | evaporated silently | refused with the same error |

Live evidence, verbatim:

```
--- an ingredient inventory has never seen (F-31-02) ---
      -> HTTP 422 INGREDIENT_NOT_FOUND
      body: {"error":{"code":"INGREDIENT_NOT_FOUND","message":"These purchase-order lines name an
      ingredient that is not in this tenant's inventory, so a goods receipt against them would
      create no stock and no ledger entry: line 1 (d3b314f7-05bd-4321-bb9a-ed753fabbd91). Choose an
      ingredient that exists, or create it in Inventory first."}}

--- a unit the tenant's registry does not define (F-31-03) ---
      -> HTTP 422 PACK_UOM_INVALID
      body: {"error":{"code":"PACK_UOM_INVALID","message":"'FURLONG' is not a unit of measure in
      this tenant. Goods receipts are converted from the pack unit into the ingredient's stock
      unit, so it must be one of: G, KG, MG, LB, OZ, ML, L, FLOZ, CUP, TBSP, TSP, EACH, …"}}

--- a refusal writes nothing ---
PASS: no purchase order row was created by either refusal (47)
PASS: the goods-receipt dead-letter queue did not grow (8)
PASS: no stock row appeared for the unknown ingredient (0)
PASS: no inventory movement appeared for the unknown ingredient (0)

--- a goods receipt of TWO lines in one call (F-31-01) ---
PASS: BOTH lines received in ONE call — the F-31-01 blocker (200)
PASS: the order reached FULLY_RECEIVED from a single two-line receipt
      qty_on_hand -3000.0000 -> -2995.0000 (expected +5.0 KG: 2 + 3)
----------------------------------------
PASS: 20   FAIL: 0
```

## F-31-01, the blocker nobody had recorded

`uq_mock_grn_idem UNIQUE (tenant_id, idempotency_key)` is a correct constraint: an idempotency key
identifies one **request**. But `simulateReceive` wrote one `MockGrnReceipt` row per **line** and
stamped the caller's single key on every one of them, so the second row of a two-line receipt
collided with the first and the whole call came back 409. Receiving was never broken — receiving
*more than one line* was, which is every realistic delivery. The key now goes on the first row of
the batch, which is what makes the constraint mean "this request has been processed" — the meaning
it was always supposed to have. The replay lookup finds that row and returns the batch's grnId
unchanged.

## Which unit is checked, and why it is not the obvious one

The unit that travels on the goods-receipt event is not the same field for the two line shapes:

- **catalog line** → the vendor item's `packUom`. Never `orderUom`, the outer unit the price is
  quoted in ("CASE"), and never `line.uom`, which *defaults* to `orderUom` for exactly that reason.
- **hand-typed line** → the line's own free-text `uom`.

`catalogLineIsCheckedOnThePackUomThatTravels` asserts both directions: a catalog line whose
`orderUom` is `CASE` (not in the registry) must **pass**, because CASE never reaches inventory; a
catalog line whose `packUom` is `FURLONG` must **fail**. Validating the wrong field would produce a
check that exists, is green, and prevents nothing — which is this project's signature failure.

## Task Commits

All three tasks in one commit, `90f7610` (fix). They are one change: task 1's property split is what
makes task 2's gate run at all, and task 3's receipt-side application shares the gate and the
`GrnReceiptSimulator` rewrite. Splitting them would have produced two commits that do not compile.

## Decisions Made

- **Fail-closed on a definitive no, degrade-open on a transport failure.** A brief inventory outage
  must not make purchasing unwritable; a confirmed absence is the entire point of the check.
- **Every offending line named, not the first.** A caller fixing a twenty-line order one refusal at
  a time will stop using the screen.
- **Lookups de-duplicated per request.** A twenty-line order against five ingredients asks about
  five, not twenty.
- **The existing exceptions and codes were reused,** not replaced. `INGREDIENT_NOT_FOUND` and
  `PACK_UOM_INVALID` already map to 422 and the frontend may branch on them.
- **`validate-references=false` in `PurchasingTestBase` as an inherited `@TestPropertySource`,
  not a `@DynamicPropertySource`.** Dynamic properties have the highest precedence in Spring's test
  hierarchy and cannot be overridden by a subclass; an inherited `@TestPropertySource` merges and
  the subclass wins, which is what lets `PoLineValidityGateIT` turn the check back on for itself.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] The property could not be overridden by the test that needed it**

- **Found during:** Task 2 — six of twelve tests failed because validation never ran.
- **Issue:** the property was first placed in `PurchasingTestBase`'s `@DynamicPropertySource`.
  Dynamic properties outrank `@TestPropertySource`, so `PoLineValidityGateIT`'s own
  `validate-references=true` was silently ignored and the permissive validator stayed active — a
  test that could never have failed.
- **Fix:** moved to an inherited `@TestPropertySource` on the base, with the precedence rule written
  down next to it.
- **Verification:** 12/12.

**2. [Rule 1 — Bug] The test fixture collided with a real constraint**

- **Issue:** `uq_vendor_item_tenant_vendor_sku` is `UNIQUE NULLS NOT DISTINCT`, so two catalog rows
  with a null SKU collide. The fixture created two.
- **Fix:** a unique SKU per fixture row, with the reason noted.

**3. [Rule 3 — Blocking] `TenantContext` has no `setTenantId`**

- **Issue:** the interface exposes `set(tenantId, branchId, userId, impersonatedBy)`.
- **Fix:** used the real signature.

**Total deviations:** 3 auto-fixed (2 × Rule 3, 1 × Rule 1), all in the test apparatus.

## Issues Encountered

### A working-tree incident, recorded because it was mine

While trying to establish whether a failing sibling test predated my change, I ran
`git stash push -- <paths>`. The push **failed** on an untracked pathspec, and the `git stash pop`
that followed therefore popped **`stash@{0}` — an unrelated stash from 2026-07-14** — into a shared
working tree, producing 14 conflicted files across gateway, auth-service, frontend and pos-service,
plus three untracked files including a `V4__order_refunds_audit_columns.sql` pos migration.

Recovered immediately and completely: every one of the 19 tracked files the stash touched was
restored with `git checkout HEAD -- <file>` (none of them was a file I had edited, and none had
uncommitted work from another executor), the index was unstaged, and the three untracked artefacts
— identified by an mtime matching the pop to the second — were removed individually. `git clean` was
**not** used. The stash was never dropped and `stash@{0}` is intact.

This should not have happened: my own operating rules prohibit `git stash` in this repository
precisely because the stash stack is shared, and I used it anyway. Recording it rather than quietly
fixing it, because a silent recovery is how the next person repeats it.

### Two purchasing test classes are red, and neither is this plan's doing

Logged in `.planning/phases/36-purchasing-inventory-wiring/deferred-items.md`:

- **`VendorItemCatalogIT` — 7 of 10 failing, 500 "TenantContext is empty".** Caused by commit
  `f72e012` (23:02 today, another executor): `JwtAuthenticationFilter` now clears `TenantContext` in
  a `finally` on the tokenless path too. That fix is correct — it closes a live cross-tenant leak.
  Its side effect is that purchasing ITs set the tenant once in `@BeforeEach` and drive MockMvc with
  a `RequestPostProcessor` rather than a real token, so the first request clears the ThreadLocal and
  every later one throws. The evidence is exact: the failing tests are precisely those making two or
  more requests, and the three that pass make one or none. The repair belongs to the test apparatus,
  not the filter — reverting `f72e012` would restore a cross-tenant leak to make a test green.
- **`PurchasingOpaPolicyIT` — 9 context-load errors,** `Could not enhance configuration class
  RealOpaTestConfig`. Nothing in this phase touches OPA wiring.
- **Testcontainers Postgres intermittently refuses connections**, failing the whole module at once
  and then succeeding on retry. Recorded so a future reader does not attribute it to a code change.

`PoLineValidityGateIT` passes 12/12 both alone and inside the full-suite run, and the live drive
passes 20/20 — so the gate itself is proven by both a green test and a green live run.

## User Setup Required

None. `INVENTORY_VALIDATE_REFERENCES` defaults to `true`; set it to `false` only in an environment
that genuinely has no inventory-service.

## Self-Check: PASSED

- `PoLineValidityGate.java` — FOUND
- `PoLineValidityGateIT.java` — FOUND, 12/12 under failsafe
- `scripts/e2e/phase31-po-line-validity-e2e.sh` — FOUND, 20/0 live
- `085`-style migration — n/a, this plan writes none
- commit `90f7610` — FOUND
- purchasing-service rebuilt (BOOT-INF = 340), restarted, `check-stale-jars.sh` clean for
  auth / purchasing / inventory / finance / gateway before the live run
