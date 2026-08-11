---
phase: 36-purchasing-inventory-wiring
plan: 05
subsystem: inventory
tags: [master-data, uom, flyway, rls, react, crud]

requires:
  - phase: 36-purchasing-inventory-wiring
    provides: 31-01-FINDINGS.md — F-31-04, units of measure were create-only
provides:
  - V13 units_of_measure.archived_at, and update/archive/restore endpoints
  - a retire guard counting four kinds of reference, including one across a database boundary
  - unit edit and retire on the setup screen, rendering the server's reference breakdown
  - a coverage matrix asserting what complete master-data CRUD means
affects: [36-06, 36-07, 36-08]

tech-stack:
  added: []
  patterns:
    - "Retirement is a timestamp; a code referenced by value is never renamed and never deleted"
    - "Two read paths disagree on purpose: pickers exclude retired units, conversions include them"
    - "A cross-database guard that cannot be evaluated REFUSES the write rather than assuming zero"

key-files:
  created:
    - services/inventory-service/src/main/resources/db/migration/V13__uom_archived_at.sql
    - services/inventory-service/src/main/java/io/restaurantos/inventory/feign/PurchasingUomUsageClient.java
    - frontend/lib/repositories/__tests__/master-data-crud-coverage.test.ts
    - scripts/e2e/phase31-master-data-e2e.sh
  modified:
    - services/inventory-service/src/main/java/io/restaurantos/inventory/domain/model/UnitOfMeasure.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/dto/InventoryDtos.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/service/IngredientService.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/web/UnitOfMeasureController.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/repository/IngredientRepository.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/repository/IngredientUomConversionRepository.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/web/InternalPurchasingController.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/repository/VendorItemRepository.java
    - frontend/lib/api-client/schemas/inventory.schema.ts
    - frontend/lib/adapters/inventory.adapter.ts
    - frontend/lib/repositories/inventory.repository.ts
    - frontend/lib/hooks/inventory/use-inventory.ts
    - frontend/components/inventory/UomFormDialog.tsx
    - frontend/app/(tenant)/app/inventory/setup/page.tsx

key-decisions:
  - "A unit's CODE cannot be changed. It is a foreign key by value across three services and two databases."
  - "The retire guard's cross-database count has NO fallback: unreachable means refuse."
  - "Pickers filter retired units; conversion paths deliberately do not."

patterns-established:
  - "An exemption in a coverage matrix is data with a reason, never an omitted row"

requirements-completed: [PIW-06]

duration: 70min
completed: 2026-08-11
status: complete
---

# Phase 36 Plan 05: Master data Summary

**A unit of measure can now be corrected and retired from the setup screen — both operations
answered 404 before — and it cannot be retired out from under the ingredients, conversion rows or
vendor-catalog rows that still name it, with the refusal saying which and how many.**

## Performance

- **Duration:** ~70 min · **Tasks:** 3 of 3
- `scripts/e2e/phase31-master-data-e2e.sh`: **35 pass / 0 fail** live
- frontend: **876/876** across 91 files · typecheck clean
- V13 applied to the live database: `Successfully applied 1 migration … now at version v13`

## What changed, and what it looked like before

`UnitOfMeasureController` had exactly two methods. Against the live stack:

| | before | after |
|---|---|---|
| `PUT /api/v1/inventory/uom/{id}` | **404** | **200**, name / dimension / factor corrected |
| `POST /api/v1/inventory/uom/{id}/archive` | **404** | **200**, `archived_at` set |
| `POST .../restore` | **404** | **200** |
| retiring a unit ingredients are stocked in | n/a | **422** naming what still uses it |
| a retired unit in a picker | n/a | absent |
| a retired unit in a conversion | n/a | still resolves |

Every other master-data entity in this service — ingredient, item category, storage location — has
had update and archive for phases. A tenant that mistyped a unit's name or its conversion factor had
no way to correct it, and a unit created by accident appeared in every picker forever. Floating
Terrace's registry contains a unit coded `TETS`, named "TEST", with a factor of 5 grams. That is
what the gap looks like in practice, and it is the concrete half of the user's report that "adding
stocks, or ingredients" does not work.

## The live proof

```
--- unit of measure: create, read, change, retire, restore ---
PASS: unit UPDATE — this answered 404 before 36-05 (200)
PASS: the change is visible in the next list
PASS: a 'code' in the body is IGNORED — the code is unchangeable (DRV94050)
PASS: a base unit with a factor other than 1 is refused on UPDATE too (422)
PASS: unit ARCHIVE — this answered 404 before 36-05 (200)
PASS: db: archived_at is set — the row is RETIRED, never deleted (1)
PASS: a retired unit is gone from the picker
PASS: the setup screen can still SEE it, shown as retired
PASS: retiring an already-retired unit succeeds and changes nothing (200)
PASS: a restored unit is offered by the picker again

--- a unit still in use cannot be retired, and the refusal says by what ---
      retire 'EACH' -> HTTP 422 UOM_CONVERSION_INVALID
      body: "EACH" is still used by 1 ingredient(s) stocked in it. Change those to another unit
             first — the unit is kept rather than deleted so historical records that name it
             still convert.

--- ingredient / category / storage location / opening stock ---
PASS: the reorder point was STORED, not just accepted
PASS: db: the changed reorder point is what reorder suggestions will read (12.0000)
PASS: db: on-hand is exactly the opening quantity (15.0000)
PASS: db: exactly one OPENING_BALANCE movement — a different event from a RECEIPT (1)
----------------------------------------
PASS: 35   FAIL: 0
```

## Three decisions worth reading

**The code cannot be changed, and the form says so in one line.** A unit code is a foreign key **by
value** into `ingredients.base_uom_code`, `ingredients.recipe_uom_code`,
`ingredient_uom_conversions` on both sides, and — across a database boundary —
`purchasing_db.vendor_items.pack_uom`. Nothing can follow those references backwards, so a rename
orphans every one of them silently and every goods receipt in the old code stops converting.
Correcting a code is a retire-and-recreate, which is a decision a person should make explicitly.
`UpdateUomRequest` does not carry a `code` field at all, so the API cannot be talked into it either
— the live drive sends one and asserts the stored code is unchanged.

**Retirement is a timestamp, never a delete**, for the same reason plus one more: a receipt recorded
last year in a unit since retired must keep converting, or the stock valuation it produced becomes
unreproducible.

**The cross-database half of the guard has no fallback.** Inventory owns `units_of_measure` and is
the only place a unit can be retired, but purchasing's vendor catalog packs in unit codes across a
boundary no constraint can span. A new internal seam (`GET /internal/purchasing/uom-usage`) answers
the count. If purchasing-service cannot be reached, the retire is **refused** and says so — the two
failure modes are not symmetric: retiring a unit is never urgent, and a unit retired out from under
a catalog row makes every receipt against it convert at face value, silently wrong in both quantity
and cost. That is the exact defect this phase measured twice.

## Task Commits

1. **Task 2 (backend) + task 3 (live script)** — `84132ec` (feat)
2. **Task 1 (coverage matrix) + task 3 (screens)** — `f55292d` (feat)

The commits are grouped by layer rather than by task number: the coverage matrix asserts repository
methods that task 3 adds, so committing it first would have committed a red test.

## Decisions Made

- **Two read paths disagree on purpose.** `listUoms(includeRetired)` filters for pickers; the setup
  screen passes `true`; and `GrnUomResolver` / `UomConverter` do not come through it at all and keep
  seeing every unit. The reason is written at both sites, because a later reader "tidying" the
  conversion path into the filtered one would silently break every historical receipt.
- **The update path reuses `createUom`'s validation** rather than restating it. The duplicate check,
  the family-base invariant and the dimension check are already correct there, and a second copy is
  how two paths drift. The live drive asserts the invariant holds on update: a base unit given a
  factor other than 1 is refused with the same message.
- **The exemptions in the coverage matrix are data with reasons.** A stock level has no create
  because stock comes into existence through an opening balance or a receipt — different economic
  events with different ledger consequences — and saying so is what stops a later reader "fixing"
  it. An exemption invented to make a test pass would be worse than a failing test.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical functionality] The plan assumed a seam that did not exist**

- **Issue:** the plan says to read the vendor-catalog reference count "through the existing internal
  seam purchasing already exposes". `InternalPurchasingController` exposes open receipts, pending
  invoices, unmatched counts and GRN pending counts — nothing about unit usage, and inventory had no
  Feign client to purchasing at all.
- **Fix:** added `GET /internal/purchasing/uom-usage` (a count, case-insensitive, tenant by header)
  plus `PurchasingUomUsageClient` on the inventory side, following `FinanceCoaClient`'s no-fallback
  precedent for a client that feeds a write decision.
- **Why it was not deferred:** without it the guard could only count three of four reference kinds,
  and the fourth is the one that crosses the boundary the whole phase exists to repair. A guard that
  silently omits a reference class is the same defect as no guard.

**2. [Rule 1 — Bug] The coverage matrix named a method that does not exist**

- **Issue:** the matrix asserted `InventoryRepository.listStockLevels`; the method is
  `getStockLevels`. The test failed exactly as designed, naming the entity and the operation.
- **Fix:** corrected the matrix. Worth noting that the failure mode worked: the message read as a
  sentence rather than a diff.

**3. [Rule 3 — Blocking] `queryKeys.inventory.uoms` takes a non-nullable branch id**

- **Issue:** the new invalidation helper typed `branchId` as `string | null`; `tsc` caught it.
- **Fix:** matched the existing signature.

**Total deviations:** 3 (1 × Rule 2, 1 × Rule 1, 1 × Rule 3).

## Gaps left open, named rather than exempted

> **Update:** the first item below was closed after plan 36-07 landed. Left visible rather than
> deleted, so the record shows a named gap being closed rather than a summary that never had one.

- ~~**`UomLifecycleIT` was not written.**~~ **CLOSED** — written after 36-07, commit `b179b57`,
  **12/12** under failsafe. All seven behaviours are now a build gate as well as a live assertion:
  name/factor correctable, the code unchangeable (asserted by reflection on the request record, so
  a rename is unrepresentable rather than merely refused), the family-base invariant on update, the
  retire guard with one test per kind of reference including the unreachable cross-database case,
  retired-but-still-converting, restore, and idempotent retirement — plus the invariant that the row
  count never falls and no delete method exists. Live proof and a build gate, not either alone.
- **The `TETS` unit in Floating Terrace's registry was not removed.** It can now be retired through
  the product, which is the point; removing it is tenant data and not this plan's to change.

## Issues Encountered

- **The stack went stale three times mid-plan** — gateway, auth-service and inventory-service were
  each rebuilt by concurrently running executors while this plan was running. The freshness gate
  caught every one and refused to produce a result; each was verified bootable (`unzip -t`,
  `BOOT-INF` entry count) and restarted before the live run. The first run of the master-data script
  was abandoned by the gate rather than reporting a false 404, which is exactly what the gate is for:
  an endpoint that is not loaded yet answers 404 identically to one that does not exist.
- **One pre-existing eslint warning** in `UomFormDialog.tsx` (`react-hooks/incompatible-library` on a
  `form.watch()` call that predates this plan). Not touched — out of scope.

## User Setup Required

None. V13 applies automatically on inventory-service startup.

## Self-Check: PASSED

- `V13__uom_archived_at.sql` — FOUND, applied live (`now at version v13`)
- `PurchasingUomUsageClient.java` — FOUND
- `master-data-crud-coverage.test.ts` — FOUND, 9/9
- `scripts/e2e/phase31-master-data-e2e.sh` — FOUND, 35/0 live
- `UomLifecycleIT.java` — **ABSENT**, recorded above as a gap
- commit `84132ec` — FOUND · commit `f55292d` — FOUND
- inventory-service and purchasing-service rebuilt, restarted, `check-stale-jars.sh` clean for this
  phase's services before the live run
