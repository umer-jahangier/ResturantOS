---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 08.2
current_phase_name: INSERTED
status: ready_to_execute
stopped_at: "Phase 08.2 planned — 20 plans across 5 waves, plan-checker VERIFICATION PASSED (iteration 2). Next: /gsd-execute-phase 08.2"
last_updated: "2026-07-22T00:00:00.000Z"
last_activity: 2026-07-22
last_activity_desc: Phase 08.2 planned — 20 plans, 5 waves, checker passed
progress:
  total_phases: 17
  completed_phases: 10
  total_plans: 122
  completed_plans: 90
  percent: 59
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-22)

**Core value:** A restaurant tenant can run operations end-to-end — POS order → inventory depletion → balanced double-entry JE — with strict tenant/branch isolation and no accounting imbalance.
**Current focus:** Phase 08.1 — pos-inventory-depletion-activation

## Current Position

Phase: 08.2 — Inventory Master Data & Procurement Catalog (INSERTED)
Plan: 0 of 20 — PLANNED, ready to execute (`/gsd-execute-phase 08.2`)
Status: 20 plans across 5 waves. Plan-checker returned VERIFICATION PASSED on iteration 2
(iteration 1 found 1 blocker + 2 warnings, all closed). Coverage gates: 6/6 requirements
(INV-01, INV-13, INV-14, INV-15, PUR-07, PUR-08), 9/9 CONTEXT.md decisions (D-01..D-09).
Wave 1 (01-05, 20) = additive Flyway migrations (inventory V5, purchasing V5), the
`ingredient_branch_stock` read seam, the recipe-coverage origin-bug fix, the shared frontend
foundation, and the carried-over infra defects. Wave 2 (06-08) = APIs over the new schema.
Wave 3 (09-10) = ingredient master data (inventory V6) + catalog-driven PO line server side.
Wave 4 (11-13) = mock-resolver deletion + both frontend data layers. Wave 5 (14-19) = the six
user-facing screens. Plan 08.2-20 was added during revision: CONTEXT.md's "carried-over
defects" section committed the gateway `resilience4j.circuitbreaker.instances` gap
(inventory/purchasing/pos/kitchen inherit defaults → persistent 503s after any upstream
restart) and the `start-dev.sh` purchasing-service exclusion as in-scope, and no plan owned
them; revision also found `local-service-env.sh` is missing the `PURCHASING_DB_*` block
entirely, so the `mvn -pl` fix alone would have been cosmetic.
Note: Nyquist validation was knowingly waived for this phase — RESEARCH.md has no
`## Validation Architecture` section, so no VALIDATION.md exists; per-plan `<verify>` blocks
compensate.
delivered. 08-01 stood up the `services/inventory-service` Maven module (Java 25 / Spring Boot 4,
port 8085, `inventory_db`), the FORCE-RLS 11-table domain schema, idempotency scaffolding, event
contract, and RabbitMQ topology. 08-03 delivered the stock-domain JPA model (Ingredient/UOM/
IngredientBranchStock/StockLot/InventoryMovement), `MacCalculator` (HALF_UP weighted-average
cost, D-02 oversell-reset), ingredient/UOM/opening-balance CRUD, and the activated
`/api/v1/inventory/**` gateway route. 08-09 delivered `InventoryAuthorizationService`
(authorizeView/authorizeManage OPA seam) every inventory controller wires into. 08-04 delivered
versioned `Recipe`/`RecipeLine` BOM entities, CRUD, and the D-01 effective-version resolution
seam — `RecipeService.resolveEffectiveRecipe(menuItemId, atInstant)`. 08-05 (the correctness
crux of the phase) delivered the `ORDER_CLOSED` depletion consumer (INV-03): `OrderClosedConsumer`
(idempotent, consumer name `inventory.depletion`) wraps `DepletionService.deplete`, which resolves
each item's effective recipe at `closedAt` (D-01), pre-sorts the distinct `ingredientId` set
before any `PESSIMISTIC_WRITE` lock (Pitfall 6 deadlock avoidance), walks lots FEFO with per-lot
floor-at-zero while the aggregate `qty_on_hand` may go negative on oversell (D-02), values COGS at
the aggregate MAC only — never a lot's own receipt cost (D-04/Pitfall 9) — and publishes
`STOCK_DEPLETED`/`LOW_STOCK_ALERT` through the transactional outbox. 08-06 delivered stock
receipts (MAC recompute on receive + `STOCK_RECEIVED`) and the `GET /internal/grn/pending-count`
finance seam (INV-04). 08-07 delivered inter-branch transfers (ship/receive with in-transit
accounting + `TRANSFER_VARIANCE`, INV-05). 08-08 (this plan, the final plan of the phase)
delivered stock counts with variance posting (`StockCountService.postCount` — sorted-lock
`findForUpdate`, `COUNT_VARIANCE` movement HALF_UP, reorder-breach `LOW_STOCK_ALERT`,
`COUNT_VARIANCE_POSTED` via the transactional outbox) plus a nightly `@Scheduled` FEFO expiry
sweep (`ExpirySweepService`, configurable lead-days/cron, `EXPIRY_ALERT`) — INV-06, closing out
Phase 8. 8 new integration tests (StockCountIT/LowStockAlertIT/StockCountAccessControlIT/
ExpirySweepIT), full module regression 44/44 green. A known architectural limitation was
documented (not silently worked around): the expiry sweep's cross-tenant discovery query is
bound by the same FORCE RLS + NOBYPASSRLS constraint as every other `stock_lots` query, so real
cron-path dispatch across a cold multi-tenant fleet is presently a no-op — closing this needs a
future Rule-4 architectural decision (BYPASSRLS service account or tenant registry). See
08-08-SUMMARY.md for full detail.
**[2026-07-19 gap-closure]** 08-VERIFICATION.md flagged this as open gap D6 (not acceptable
deferred scope — no later phase addressed it). Fixed on `gsd/phase-08-inventory-recipe-management`:
added `inventory_tenant_registry` (V3 migration, RLS-EXEMPT, mirrors V2's non-RLS convention —
NO BYPASSRLS grant, NO domain-table FORCE-RLS relaxation) + `TenantRegistryService.registerTenant`
(idempotent, in-transaction upsert) hooked into `OpeningBalanceService`/`ReceiptService`/
`TransferService.receive`/`StockCountService`. `ExpirySweepService.sweep()` now discovers tenants
via the registry (no ambient `TenantContext` needed) instead of the removed
`StockLotRepository.findDistinctTenantIdsWithExpiringLots`. New `ExpirySweepCronPathIT` proves the
real cron shape (zero ambient context, tenants seeded via the real `ReceiptService` write path,
registry asserted populated before sweep runs) — full module regression: 18 IT classes + 5 unit
classes, all green. Tenant isolation on every domain table is completely unchanged. See
08-08-SUMMARY.md's "D6 Gap-Closure (2026-07-19)" section for full detail.
Next: Phase 9 (Order-to-Ledger Auto-Posting & Customer Loyalty).
Last activity: 2026-07-19 — Phase 08.1 complete, transitioned to Phase 10

<details>
<summary>Historical Phase 07.3 / Phase 10 notes (pre-existing, retained for context — not updated by 08-01)</summary>

Plans: 10 plans across 3 waves + 1 gap-closure plan — 11/11 complete (07.3-01 done: PaymentStatus derivation,
maybeCloseOrder seam, GET /orders/{id}/payments; 07.3-02 done: KITCHEN_ITEM_STATUS_CHANGED
kitchen→pos live item-status sync, POS-20; 07.3-03 done: client-only cart terminal +
PICKUP order type + Clear/New Order + charge gating, POS-16/17/18/19; 07.3-04 done: rich
OrderSummaryDto (payment status + item quantity), PATCH /orders/{id}/table assign-table,
tableNumber on send-to-KDS event, POS-24/POS-16/KDS-04; 07.3-05 done: kitchen-service V5
migration + tableNumber propagation to KdsTicket/KdsTicketDto (parity w/ 07.3-04's producer
field), POST /tickets/{id}/items/{id}/status explicit item-status endpoint wrapping
markItemStatus, DEFAULT-station auto-seed-on-miss (TicketRoutingService.ensureStation +
KdsController.getStations) so the KDS board is never empty, KDS-04; 07.3-06 done: useOrder
live refetch + useAddItem instant cache-seed, "Send New Items (N)" revision CTA + panelized
detail surface, Order Management manual Refresh, Wave-0 E2E for POS-20/POS-21 — POS-20 E2E
BLOCKED on this dev branch by an out-of-scope kitchen-service pagination/data-hygiene
defect, logged in deferred-items.md; 07.3-07 done: PaymentStatusBadge (4-state), full-page
Charge route (/app/pos/orders/[orderId]/charge) replacing the sm:max-w-md PaymentPanel
modal, useOrderPayments/useRecordPayment, CHARGE NOW reroute, Wave-0 E2E for POS-22/23 —
S5/S5b BLOCKED live this session by a pre-existing gateway 503 on GET .../payments and a
pre-existing S4 fire-toast timing gap, both out of scope, logged in deferred-items.md;
07.3-08 done: OrderSummary model/schema/adapter extended (settlementStatus/paymentStatus/
amountPaidPaisa/itemQuantity/distinctItemCount), PosRepository.assignTable + useAssignTable,
Order Management Closed/Paid settlement filters + order-no./table-name search box, Items
column replacing Cover, payment-status badge column, Assign Table row action via
table-select-combobox's new availableOnly prop, POS-24; 07.3-09 done: useOnlineStatus
connectivity-ping removal (navigator.onLine events only), void/refund + till open/close
converted from hand-rolled fixed-overlay modals to dedicated no-[role=dialog] in-place
panels mirroring the 07.3-07 charge-page pattern, new pos-modal-revamp.spec.ts POS-25
no-dialog + screenshot backstop, POS-25/POS-26 — till stage reaches a live PASS
(pos25-till.png); void/refund stage BLOCKED live this session by a pre-existing
pos-service addItem HTTP-response-relay hang (server writes complete near-instantly but
the response never reaches the client), out of scope, logged in deferred-items.md;
07.3-10 done: kitchen/ redesigned into a station-isolated board — station-picker.tsx
(auto-navigates on a single active station) -> station-board.tsx (New/Started/Preparing/
Ready item-status columns via kds-item-column.tsx, item-centric mixed-status support) ->
kitchen/[stationCode]/orders/[ticketId] dedicated detail page (kills the old tap-to-open
Dialog), slim kds-ticket-card.tsx (order#/table/age/item-names only), useUpdateItemStatus
wired to 07.3-05's item-status endpoint, single shared useKdsClock replacing per-card
setInterval, subtle escalation-threshold aging (left border + timer chip, no
animate-bounce/bg-red-950), Wave-0 E2E kds-stations.spec.ts — ran live twice, both PASS,
KDS-04/KDS-05 both complete); 07.3-11 (gap-closure) done: closed the sole BLOCKER gap
(BE-CR-01/POS-23/SC4) from 07.3-VERIFICATION.md — retired legacy
POST /orders/{id}/close to 410 Gone, deleted OrderService.closeOrder (the tender-sum-only
performClose bypass that never checked derivedStatus==SERVED), leaving maybeCloseOrder
as the ONLY code path that can transition an order to CLOSED; migrated all 8 IT-fixture
callers (AssignTableIT/OrderSummaryDtoIT/TableOrderLookupIT/VoidRefundOpaIT/
OrderRevisionIT/PeriodLockCloseIT) onto a new shared PosTestBase.closeViaServeAndPay
helper that drives closure through the real serve+pay seam; deleted
OrderCloseIdempotencyIT (subject retired) with its single-publish coverage preserved
via a new SettlementSemanticsIT backstop test; deleted orphaned frontend PaymentPanel
component + useCloseOrder hook (zero live references). 25/25 targeted backend ITs green,
frontend tsc clean. Phase 07.3 now 11/11 plans complete.
Status: Ready to execute
Last activity: 2026-07-14 — Phase 07.3 merge landed (historical)

</details>

**Current focus:** Phase 08 (Inventory & Recipe Management) — COMPLETE, 9/9 plans (08-01..08-09
all landed; INV-01..INV-07 delivered). Phase 10 (Purchasing & AP) gap-closure wave (18/18) is
separately complete pending its own UAT/verification re-pass (see historical block below) —
unrelated to Phase 08.

## Current Position

Phase: 10 of 11 (Purchasing & Accounts Payable) — gap-closure wave COMPLETE (18/18 plans; 10-18 was the final plan)
Plan: 18 of 18 — ALL gap-closure plans (10-07..10-18) now landed
Status: 10-18 complete (this plan) — AR sub-ledger + house/corporate customer-account entity + AR aging + the internal POS-charge seam (POST /internal/finance/ar/charges, the Phase 7 contract) closing FIN-05's AR half. customer_accounts + ar_transactions (Flyway V6, RLS FORCEd, POS-retry idempotency index), ArService (credit-limit invariant checked before any write, manual+internal writers funnel into one postCharge()), finance.ar.view/finance.ar.manage permissions seeded, finance-service's first @PreAuthorize reflection guard (FinanceEndpointAuthorizationIT, found and correctly excluded one pre-existing internal endpoint mis-homed in a public controller), House Accounts + AR Aging frontend pages. Full finance-service `mvn verify`: 40 ITs, 34 pass, only the same 3 pre-existing "Branch context required" failures remain (unchanged). Real-stack click-path NOT completed — blocked by a pre-existing, stack-wide FEATURE_DISABLED gateway response affecting ALL modules (finance AND purchasing), confirmed via real login + real JWT + real gateway routing; see 10-18-SUMMARY.md Issues Encountered. Phase 10 gap-closure wave (10-07..10-18, 12 plans) is now fully executed; a phase-level UAT/verification re-pass (not this plan) owns flipping FIN-05 back to Complete in REQUIREMENTS.md.
Last activity: 2026-07-13 — Completed 10-18 (AR sub-ledger + internal POS seam + house-accounts/AR-aging UI — 3 tasks, 3 commits, ce326c9/f24fa0d/8699b91)

Progress: [██████████████████░░░░] 82% (36/44 plans)

### Phases merged from main (2026-07-14)

Phase 07.2 (finance-accounting-period-provisioning-guarantee-open-period) — 6/7 plans complete
Phase 07 (point-of-sale-kitchen-display) — COMPLETE (8/8 plans; verification human_needed, recommended complete)

## Performance Metrics

**Velocity:**

- Total plans completed: 73 (recomputed at the 2026-07-14 main merge — sum of the By-Phase table below; the pre-merge branch counters (32 on Mufazzal, 27 on main) each counted only their own side)
- Phase 1: 4/4 plans executed; verification gaps_found (4/5) — SC5 gap open
- Phase 2: 3/3 plans executed; verification passed (5/5)
- Phase 3: 3/3 plans executed; verification passed (24/24)
- Phase 4: 8/8 plans executed; verification passed (16/16 FE + 7/7 DS gap-closure; tsc/lint/vitest green)
- Phase 6: 2/2 plans executed (COMPLETE — periods + close/lock + Finance frontend)
- Phase 7: 8/8 plans executed (COMPLETE — incl. gap-closure 07-05..07-08; 07-09 charge-to-account still open)
- Phase 07.1: 10/10 plans executed (COMPLETE — POS production ops + item-level kitchen tracking)
- Phase 07.2: 6/7 plans executed (07.2-06 verification checkpoint AWAITING USER)
- Phase 07.3: 11/11 plans executed (COMPLETE — POS/KDS bug-fix + UX revamp, incl. gap-closure 07.3-11)
- Phase 10: 18/18 plans executed (REOPENED gap-closure wave COMPLETE — 10-07..10-18 all landed; a phase-level UAT/verification re-pass is the next step, not another execution plan)
- Phase 08: 9/9 plans executed (COMPLETE — INV-01..INV-07 all delivered; 08-01 module scaffold; 08-02 InventoryTestBase/TestFixtures/SchemaMigrationIT test harness; 08-03 stock domain/MAC/master-data CRUD; 08-09 OPA authorization seam; 08-04 versioned recipes/BOM + D-01 effective-version resolution; 08-05 ORDER_CLOSED depletion consumer; 08-06 receipts + GRN pending-count seam; 08-07 inter-branch transfers; 08-08 stock counts + variance posting + low-stock/expiry alerts — a phase-level UAT/verification re-pass is the next step, not another execution plan)

**By Phase:**

| Phase                                                | Plans | Verify                                               |
| ---------------------------------------------------- | ----- | ---------------------------------------------------- |
| 01-infrastructure-foundation-shared-library          | 4/4   | 4/5 gaps_found                                       |
| 02-authentication-authorization                      | 3/3   | 5/5 passed                                           |
| 03-api-gateway-platform-admin-tenant-user-management | 3/3   | 24/24 passed                                         |
| 04-frontend-shell-ci-cd                              | 8/8   | 16/16 FE + 7/7 DS passed                             |
| 06-finance-core-general-ledger-periods               | 2/2   | complete                                             |
| 07-point-of-sale-kitchen-display                     | 8/8   | human_needed, recommended complete                   |
| 07.1-pos-production-operations                       | 10/10 | complete                                             |
| 07.2-finance-accounting-period-provisioning          | 6/7   | 07.2-06 checkpoint awaiting user                     |
| 07.3-pos-kitchen-bugfix-ux-revamp                    | 11/11 | complete (gap-closure 07.3-11 landed)                |
| 08-inventory-recipe-management                       | 9/9   | complete — UAT/verification re-pass pending          |
| 10-purchasing-accounts-payable                       | 18/18 | gap-closure wave complete (10-07..10-18); UAT re-pass pending |

**Recent Trend:**

- Last completed plan: 08-08
- Trend: Phase 08 (Inventory & Recipe Management) is now COMPLETE — 9/9 plans, INV-01..INV-07 all delivered. 08-01 stood up the `inventory-service` Maven module (FORCE-RLS 11-table schema, idempotency scaffolding, event contract, RabbitMQ topology). 08-02 added the `InventoryTestBase`/`TestFixtures`/`SchemaMigrationIT` test harness every downstream feature IT reuses. 08-03 delivered the stock-domain JPA model, `MacCalculator` (HALF_UP weighted-average, D-02 oversell-reset), ingredient/UOM/opening-balance CRUD, and the activated `/api/v1/inventory/**` gateway route. 08-09 delivered `InventoryAuthorizationService` (authorizeView/authorizeManage OPA seam). 08-04 delivered versioned `Recipe`/`RecipeLine` BOM entities, CRUD, and the D-01 effective-version resolution seam (`RecipeService.resolveEffectiveRecipe`). 08-05 delivered the `ORDER_CLOSED` depletion consumer (INV-03): idempotent `OrderClosedConsumer` + `DepletionService` — D-01 recipe resolution, sorted-lock deadlock avoidance (Pitfall 6), FEFO floor-at-zero with negative-aggregate oversell (D-02), aggregate-MAC COGS never lot cost (D-04/Pitfall 9), transactional-outbox `STOCK_DEPLETED`/`LOW_STOCK_ALERT`. 08-06 delivered stock receipts (MAC recompute + `STOCK_RECEIVED`) and the `GET /internal/grn/pending-count` finance seam. 08-07 delivered inter-branch transfers (ship/receive + in-transit accounting + `TRANSFER_VARIANCE`). 08-08 (this session, the final plan) delivered stock counts with variance posting (`StockCountService.postCount` — sorted-lock, `COUNT_VARIANCE` movement, reorder-breach `LOW_STOCK_ALERT`, `COUNT_VARIANCE_POSTED`) and a nightly `@Scheduled` FEFO expiry sweep (`ExpirySweepService`, configurable lead-days/cron, `EXPIRY_ALERT`) — 8 new integration tests, 44/44 module-wide, no regression. A documented architectural limitation: the expiry sweep's cross-tenant discovery is bound by FORCE RLS + NOBYPASSRLS, so real cron-path dispatch across a cold multi-tenant fleet is presently a no-op pending a future architectural decision. Next: Phase 9 (Order-to-Ledger Auto-Posting & Customer Loyalty). Phase 10's gap-closure wave (10-07..10-18) remains separately complete pending its own UAT/verification re-pass (unrelated to Phase 08).

_Updated after each plan completion_

**Per-plan timings (Phases 07–07.3, from main):**

| Phase 07 P05 | 20min | 2 tasks | 3 files |
| Phase 07 P06 | 20min | 2 tasks | 4 files |
| Phase 07 P07 | 20min | 2 tasks | 7 files |
| Phase 07 P08 | 12min | 2 tasks | 12 files |
| Phase 07.1 P01 | 25 min | 3 tasks | 9 files |
| Phase 07.1 P02 | 40 min | 3 tasks | 15 files |
| Phase 07.1 P03 | 45min | 3 tasks | 16 files |
| Phase 07.1 P04 | 35 min | 3 tasks | 14 files |
| Phase 07.1 P05 | 55min | 3 tasks | 24 files |
| Phase 07.1 P07 | 45min | 3 tasks | 5 files |
| Phase 07.1 P08 | 25min | 2 tasks | 6 files |
| Phase 07.1-09 P09 | 50 min | 2 tasks | 9 files |
| Phase 07.1 P10 | ~20min | 1 tasks | 2 files |
| Phase 07.2 P01 | 3 min | 2 tasks | 2 files |
| Phase 07.2 P02 | 9min | 2 tasks | 3 files |
| Phase 07.2 P03 | 25min | 2 tasks | 4 files |
| Phase 07.2 P04 | 20min | 2 tasks | 3 files |
| Phase 07.2 P05 | 20min | 2 tasks | 3 files |
| Phase 07.2 P07 | 21min | 3 tasks | 11 files |
| Phase 07.3 P01 | 55min | 3 tasks | 8 files |
| Phase 07.3 P02 | 20min | 2 tasks | 5 files |
| Phase 07.3 P03 | 35min | 4 tasks | 13 files |
| Phase 07.3 P04 | 40min | 3 tasks | 9 files |
| Phase 07.3 P06 | 55min | 4 tasks | 7 files |
| Phase 07.3 P07 | 40min | 4 tasks | 21 files |
| Phase 07.3 P05 | 20min | 3 tasks | 13 files |
| Phase 07.3 P08 | 20min | 2 tasks | 9 files |
| Phase 07.3 P09 | 65min | 3 tasks | 6 files |
| Phase 07.3 P10 | 23min | 4 tasks | 21 files |
| Phase 07.3 P11 | 90min | 4 tasks | 19 files |
| Phase 08 P01 | 6min | 3 tasks | 13 files |
| Phase 08-inventory-recipe-management P02 | 12min | 2 tasks | 3 files |
| Phase 08 P09 | 3min | 2 tasks | 6 files |
| Phase 08 P03 | 14min | 3 tasks | 25 files |
| Phase 08-inventory-recipe-management P04 | 13min | 2 tasks | 10 files |
| Phase 08-inventory-recipe-management P05 | 12min | 3 tasks | 6 files |
| Phase 08-inventory-recipe-management P06 | 18min | 2 tasks | 9 files |
| Phase 08 P07 | 20min | 1 tasks | 9 files |
| Phase 08 P08 | 24min | 2 tasks | 13 files |
| Phase 08.1 P01 | 25min | 3 tasks | 8 files |
| Phase 08.1 P02 | 15min | 3 tasks | 19 files |
| Phase 08.1 P04 | 35min | 3 tasks | 15 files |
| Phase 08.1 P06 | 45min | 3 tasks | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [02-01]: NON-RLS `auth_tenants` slug lookup before tenant GUC (Phase 2/3 seam).
- [02-01]: Login `@Transactional(noRollbackFor auth failures)` so lockout counts persist.
- [02-02]: Step-up at login for `rbac.manage`, `finance.period.close`, or `totp_enabled`; privileged first-enrollment is provisioning (Phase 3).
- [02-02]: `EncryptionService` in shared-lib via opt-in `EncryptionAutoConfiguration` (not SharedAutoConfiguration).
- [02-03]: `DefaultOpaClient` serializes OPA input with snake_case JSON; 2s connect+read timeout fail-closed.
- [01-04]: Security beans shipped in shared-lib but wired in auth-service SecurityFilterChain.
- [03-01-A]: `StripInternalHeaderFilter` as GlobalFilter (not YAML default-filter) — applies to ALL routes including programmatic.
- [03-01-B]: `SharedAutoConfiguration` excluded from gateway — it requires EntityManager (JPA) + WebMvcConfigurer (servlet), incompatible with reactive gateway.
- [03-01-C]: `WebClientConfig` provides `WebClient.Builder` bean — Spring Boot 4 removed auto-configuration of this bean.
- [03-01-D]: `TESTCONTAINERS_RYUK_DISABLED=true` required for Colima Docker environment (no bind mount support for Ryuk).
- [03-03-A]: auth-service is system of record for `user_branch_roles`; user-service owns ONLY `branches` and delegates all role/permission operations via Feign to `/internal/auth/**`.
- [03-03-B]: Testcontainers `POSTGRES_USER` creates a superuser — RLS row visibility tests replaced with `pg_policies` metadata checks; production RLS enforcement deferred to staging with non-superuser roles.
- [03-03-C]: `saveAndFlush()` required in BranchService.createInternal to catch `DataIntegrityViolationException` inside try-catch (JPA batches flush otherwise).
- [03-03-D]: `FeignInternalConfig` and `UserInternalServiceFilter` are duplicated in user-service; extraction to shared-lib is tech debt.
- [03-02-A]: `noRollbackFor=ProvisioningException.class` on provision() so PROVISIONING_FAILED state commits when saga throws.
- [03-02-B]: Never set entity ID manually before `save()` with `@GeneratedValue(UUID)` — Spring Data calls `merge()` (not `persist()`) if ID is non-null, issuing an UPDATE for non-existent row → StaleObjectStateException.
- [03-02-C]: `@JdbcTypeCode(SqlTypes.JSON)` required on String fields mapped to PostgreSQL JSONB columns; `columnDefinition` alone insufficient.
- [03-02-D]: Do not add `@EnableJpaAuditing` to any service's Application class; `SharedAutoConfiguration` is authoritative — duplicate causes BeanDefinitionOverrideException.
- [04-01-A]: Next 16 uses `proxy.ts` (not `middleware.ts`), exported fn `proxy` — recommend updating FE-03 wording.
- [04-01-B]: `proxy.ts`/DAL read a non-HttpOnly `has_session` marker (UX hint only); `refresh_token` is HttpOnly Path=/api/v1/auth and invisible on app routes — real gate is DAL + gateway 401 (CVE-2025-29927).
- [04-01-C]: Auth contract frozen — `refresh_token` cookie, `{email,password,tenantSlug,totpCode?}`, `ApiResponse<{accessToken,expiresInSeconds,userId,tenantId,branchId}>`; permissions from JWT decode, no `/me`. Wire format is camelCase (no global snake_case Jackson config).
- [04-01-D]: Live auth-service error codes (supersede §7.4): `UNAUTHENTICATED` 401 (bad creds + suspended-tenant masked), `ACCOUNT_LOCKED` 423, `TOTP_REQUIRED` 401, `BRANCH_ACCESS_DENIED` 403, `PASSWORD_REUSE` 400 — flagged §7.4 reconciliation.
- [04-01-E]: Four-layer abstraction enforced via ESLint `no-restricted-imports` on `components/**`; repositories always `.parse()` (never the non-throwing variant) before adapting.
- [04-01-F]: Tailwind 4 CSS-first (no tailwind.config.js); removed shadcn radix-base `@import "shadcn/tailwind.css"` (uninstalled pkg broke build). pnpm 11 needs `allowBuilds` map.
- [04-02-A]: D4 resolved — FeatureGuard uses `useFeatureFlags()` (proactive UI hiding); gateway stays authoritative (403 FEATURE_DISABLED). Live `/api/v1/feature-flags` shape still a Phase-3 contract to confirm.
- [04-02-B]: Branch switch invalidation = `queryClient.clear()` (full clear) — all server-state keys are branch-scoped; `setSession` on the reissued JWT also sets the active branch (no separate active-branch store).
- [04-02-C]: Components branch on `ApiError` guard methods via TanStack-mutation type inference — never import `@/lib/api-client` (FE-08 boundary preserved).
- [04-02-D]: Used a hand-rolled `createZodResolver` (frontend/lib/forms/zod-resolver.ts) instead of `@hookform/resolvers` (package.json owned by 04-03). Optional to swap later.
- [04-02-E]: BranchSwitcher available-branches are a Phase-4 static stub (ids match MSW); live list is a Phase-3 contract (e.g. `/api/v1/branches`).
- [04-03-A]: CI coverage gates are data-driven from `.github/workflows/coverage-gates.json` (finance/inventory ≥75 forward-declared, others + frontend ≥60, OPA ==100) — later phases raise gates without editing the workflow.
- [04-03-B]: D5 — `openapi-to-zod-check` verified ABSENT on npm (404); schema-sync ships Zod-schema `tsc --noEmit` + a documented OpenAPI↔Zod placeholder (backend SpringDoc OpenAPI is Phase-3+).
- [04-03-C]: D6 — Playwright scaffold + ONE `/app/dashboard`→`/login` smoke only; full ~50-journey staging suite is cross-phase. promote-to-prod is a deliberate manual `environment: production` gate (not a pipeline failure).
- [04-03-D]: cosign keyless OIDC (`id-token: write`) signs multi-arch (amd64+arm64) GHCR images over a DRY 8-image matrix; PRs build-only (no push/sign).
- [04-03-E]: Java checkstyle/spotbugs/pmd NOT wired in parent POM — CI lint runs a clean multi-module compile; wiring the dedicated goals (and data-driven JaCoCo check) is deferred tech debt.
- [04-04-A]: `useSyncExternalStore` for SSR mounted check in ThemeToggle — project ESLint rule `react-hooks/set-state-in-effect` prohibits `setState` directly in effects; `useSyncExternalStore(noop, () => true, () => false)` is the correct SSR-safe alternative.
- [04-04-B]: OKLCH values for semantic state tokens: warning≈oklch(0.795 0.184 86°) amber, success≈oklch(0.723 0.191 149°) green, info≈oklch(0.685 0.169 237°) blue (approximate conversions of DS doc HSL intent).
- [04-04-C]: `.skeleton` uses `var(--muted)`/`var(--border)` directly — NOT `oklch(var(...))` which is invalid CSS.
- [04-04-D]: `StatusAnnouncer` uses module-level `globalSetMessage` reference
- [04-05-A]: Skeleton primitive replaced — shadcn `animate-pulse` → `.skeleton` shimmer class (DS-02); `aria-hidden="true"` + `role="presentation"` + `className?: string` only.
- [04-05-B]: tsconfig target ES2017→ES2020 to support BigInt literals in money-display.tsx (lib already esnext; Next.js transpiles independently).
- [04-05-C]: PageTransition returns `<>{children}</>` when `useReducedMotion()` true — zero DOM overhead for motion-sensitive users.
- [04-05-D]: Variants test placed at `__tests__/lib/motion/variants.test.ts` — vitest.config.ts include pattern requires `__tests__/**` root, not `lib/motion/__tests__/`.
- [04-06-A]: `BigInt(100)` function call (not literal `100n`) for ES2017 tsconfig compat in MoneyDisplay.
- [04-06-B]: React Compiler warning on `useReactTable` is expected — TanStack Table v8 returns non-memoizable functions; warning only, not error.
- [04-06-C]: `CommandPalette` wraps cmdk inside existing shadcn `Dialog` for consistent overlay/animation/keyboard-trap. to avoid React context for a low-frequency aria-live side-effect. Stack reconciliation = ADAPT (user-approved): keep Next 16 + Tailwind 4 CSS-first + OKLCH + flat `frontend/{app,components,lib}` + enforced four-layer boundary; the doc's Next 14 / Tailwind 3.4 / `tailwind.config.ts` / HSL / `src/` / `geist`-package lines are superseded (see doc §0). Rollout = save-as-reference + Phase-4 shell gap-closure (DS-01..07); module UX (POS/KDS/Finance/Inventory/NLQ/Reports/HR/Vendor) folds into phases 5–12.
- [04-08-A]: Palette-generator test placed at `__tests__/lib/theme/` (vitest include pattern requires `__tests__/**`; `lib/theme/__tests__/` would not be discovered).
- [04-08-B]: AppearanceForm hex input fully-controlled (no useEffect+setState) — applyColor() atomically updates brandColor, hexInput, and palette; complies with react-hooks/set-state-in-effect rule.
- [04-08-C]: AppearancePage is RSC; onSave handled entirely within AppearanceForm (RSC cannot pass function props to client components); localStorage stub with Phase 7 backend contract: PUT /api/v1/tenants/:id/theme.
- [04-07-A]: Tooltip built from radix-ui unified package (not @radix-ui/react-tooltip sub-package) — created tooltip.tsx importing from 'radix-ui' directly.
- [04-07-B]: TenantThemeInjector reads localStorage client-side in 'use client' layout; SSR returns null (globals.css tokens provide defaults).
- [04-07-C]: Tenant layout converted to 'use client' for mobileOpen useState (acceptable — layout is auth-gated by proxy.ts).
- [04-07-D]: navGroups exports alongside tenantNavItems flat array for backward compat.
- [06-01-A]: Flyway (not Liquibase) for finance-service — single SQL migration file cleaner for complex DDL with triggers and RLS.
- [06-01-B]: DEFERRABLE INITIALLY DEFERRED constraint trigger for JE balance — allows inserting multiple lines in one txn before check fires at COMMIT.
- [06-01-C]: Class-level @Transactional on JournalEntryServiceImpl — ensures post() runs in a transaction so deferred trigger fires at Spring transaction commit.
- [06-01-D]: PakistanRestaurantCoaTemplate returns 55 accounts (1000–7200 range): Assets/Liabilities/Equity/Revenue/COGS/Expenses/Non-Operating, 17 system-tagged.
- [06-01-E]: Immutability trigger exemption: reversed_by_je UPDATE on a POSTED JE is allowed (needed for the reversal workflow link-back).
- [06-02-A]: Pakistan FY formula: period 1 = July of (fiscalYear-1). Month = ((6 + periodNo - 1) % 12) + 1. Year = startCalYear for periods 1-6 (Jul-Dec), fiscalYear for periods 7-12 (Jan-Jun).
- [06-02-B]: TOTP gate via header-only in Phase 6 (X-TOTP-Verified=true); real step-up from Phase 2 auth-service (02-02) to be wired in Phase 7+.
- [06-02-C]: Feign pre-close stubs return 0 with TODO comments for Phase 7/8/10; circuit breaker enabled (spring.cloud.openfeign.circuitbreaker.enabled=true).
- [06-02-D]: Frontend follows existing 4-layer pattern: Zod schema → adapter → repository → TanStack Query hook → component (ESLint-enforced by no-restricted-imports on components/\*\*).
- [06-02-E]: Integration tests re-set TenantContext after provision() calls (finally block clears it); pattern: tenantContext.set(tenantId, null, null, null) after each provision().
- [06-02-F]: Finance pages at /app/finance/_ (tenant route group is (tenant)/app/_); proxy.ts PROTECTED=['/platform','/app'].
- [10-05-A]: finance-service consumes OPA via its own Feign AuthorizationClient to authorization-service (copied verbatim from purchasing-service's), NOT shared-lib's OpaClient/AuthorizationService — that bean is `@ConditionalOnProperty("restaurantos.opa.url")` and neither finance-service nor purchasing-service sets it.
- [10-05-B]: Expense create @PreAuthorize reuses `finance.journal.post` (no `finance.expense.create` permission exists in auth-service's seed); approve/reject use `finance.expense.approve` (previously zero consumers).
- [10-03-A]: PUR-06 spend analytics deltaPct is `null` (not a sentinel like 100.0) when a bucket's prior-period spend is 0 — "new spend" has no meaningful percent change; documented in `VendorAnalyticsService.spendReport()` javadoc.
- [10-03-B]: PUR-06 category resolution is mock-first via `IngredientCategoryResolver`/`MockIngredientCategoryResolver` reading classpath `spend-category-map.yml` (ingredientId -> label); Phase 8 swaps in a feign resolver on the same seam as `GrnDataPort`, keyed on `restaurantos.inventory.integration-mode`.
- [10-03-C]: PUR-05 price variance is a spend-weighted mean (weight = lineTotalPaisa) of per-line `(invoiceUnitPricePaisa/poUnitPricePaisa - 1)*100`, reusing `ThreeWayMatchService`'s exact priceRatio math (BigDecimal scale 6, HALF_UP) — a metric, not a tolerance check; lines with PO price 0 are skipped; 0.0 (never NaN) when no qualifying lines.
- [10-03-D]: Fixed several purchasing MSW mock ids (VENDOR_ID/PO_ID/LINE_ID) that used non-hex letter prefixes (`v`/`p`/`l`) and silently failed `z.string().uuid()` — no prior test exercised the purchasing repository against MSW, so this was latent; caught while adding the first such vitest.
- [10-04-A]: PO close allowed source states are FULLY_RECEIVED (free) and PARTIALLY_RECEIVED (short-close, reason mandatory + OPA action `vendor.po.close`) only — all other states including already-CLOSED throw InvalidPoStateException (no idempotent no-op). No finance JE posted on close (GR/IR and AP already posted at receipt/invoice-match time).
- [10-06-A]: Phase 10's `REQUIREMENTS.md` traceability table had two false "Complete" rows (PUR-05, FIN-05) and one orphaned "Pending" row (PUR-06, never assigned an owning plan) — root cause was the original 10-VERIFICATION.md scoring narrow must-haves instead of requirement text. All 7 PUR/FIN rows re-derived from a named green IT + source grep per row; this pattern (verify against requirement text, not must-haves) is the standing lesson for future phase verification.
- [10-11-A]: `sidebar-nav-items.ts` `NavItem.feature` field retyped from `string` to `FeatureFlag` (canonical union in `frontend/lib/features/feature-flags.ts`, union of `TierFeatureDefaults.java` + `RouteFeatureMap.java`) — a nav item referencing a flag the backend doesn't grant is now a `tsc` compile error, not a silently-invisible nav item (root cause of the Purchasing-module-unreachable blocker: `FEATURE_PURCHASING` existed nowhere in the backend; `FeatureGuard` fails open only on fetch *error*, not on an absent flag). `FEATURE_REPORTING` (also phantom) remapped to `FEATURE_REPORTING_ADVANCED` in the same pass.
- [10-07-A]: Canonical OPA action vocabulary is the rego short verb (`approve_po`, `close_po`, `approve`), not the dotted permission code. purchasing-service/finance-service Feign `AuthorizationClient` calls were sending `vendor.po.approve`/`vendor.po.close`/`finance.expense.approve` (permission-code shape) while every rego module keys on short verbs with `default allow := false` — every real PO/expense approval silently DENYed in production, masked because `PurchaseOrderApprovalIT`/`ExpenseApprovalIT` `@MockitoBean` the `AuthorizationClient`. Fixed by changing the 3 Java call sites (`OPA_ACTION_*` constants) rather than rewriting 5 rego modules + test suites. Dotted permission codes are unchanged and remain what `common.has_permission`/`@PreAuthorize` check.
- [10-15-A]: No shadcn `Select`/date primitives exist in the frontend (no `@radix-ui/react-select` dependency) despite plan wording assuming them; `PeriodPicker` and the analytics vendor selector are native `<select>`/`<input type="date">` styled to match the existing `Input` component — no new library added.
- [10-15-B]: `use-purchasing.ts` (owned by 10-12/10-13) has no `placeholderData` option to opt into TanStack's `keepPreviousData`; "keep previous data visible during refetch" is instead done at the page level via a small `useKeepPreviousData<T>` helper that calls `setState` conditionally during render (React's documented "store info from previous render" pattern, not `useEffect`, per the project's `react-hooks/set-state-in-effect` ESLint rule). Reusable pattern for any future page consuming a shared hook it can't edit.
- [10-15-C]: `apiSpendAnalyticsSchema` field names are `compareFrom`/`compareTo` (not `resolvedCompareFrom`/`resolvedCompareTo` as some plan prose assumed) — use the schema as source of truth over plan wording when they disagree.
- [10-16-A]: `EncryptionRequiredConfig` (purchasing-service) is a `BeanFactoryPostProcessor` + `EnvironmentAware` that checks BOTH the raw `restaurantos.encryption.key` property value (blank/unset) AND `EncryptionService` bean-definition presence — bean-presence alone is insufficient because `@ConditionalOnProperty` without `havingValue` treats a present-but-blank property as satisfying the condition, so a blank key still registers the bean and fails later with an unhelpful `SecretKeySpec` "Empty key" error instead of an actionable startup message. Reusable pattern for any future required-but-conditionally-shipped shared-lib bean.
- [10-09-A]: **CROSS-CUTTING BUG (shared-lib):** `GlobalExceptionHandler` had no `@ExceptionHandler` for `org.springframework.security.access.AccessDeniedException`, so it fell through to the generic `Exception.class` handler and returned 500 instead of 403. Because `@RestControllerAdvice` resolvers run inside `DispatcherServlet`'s exception resolution (before the exception could reach `ExceptionTranslationFilter`), this silently defeated `@PreAuthorize` on EVERY service sharing this handler (finance-service's `ExpenseController.approve`/`reject` included) — not just purchasing. Caught by the first real run of `PurchasingEndpointAuthorizationIT` (all 403-expecting assertions got 500). Fixed with a dedicated `@ExceptionHandler(AccessDeniedException.class)` returning 403/`PERMISSION_DENIED` (the code was `ACCESS_DENIED` on this branch until the 2026-07-14 main merge, which had independently fixed the same bug with `PERMISSION_DENIED` — the code main chose, since it matches every service's SecurityConfig#accessDeniedHandler and the frontend's USER_FACING_BY_CODE map). Full shared-lib rebuild + recompile of auth-service/finance-service/purchasing-service/pos-service/kitchen-service/gateway confirmed no regressions; finance-service's 6 pre-existing `Branch context required` IT failures (documented in Blockers, unrelated) are the only remaining red tests.
- [10-09-B]: `vendor.po.close` was referenced by `PurchaseOrderService.close` and the 10-07 `close_po` rego rule but was never seeded in auth-service at all — added in new changeset `031-purchasing-permissions.xml` (030 already applied everywhere, never edit it). OWNER/TENANT_ADMIN vendor.* grants had to be added explicitly (not via the SELECT-all-permissions trick) because 030's blanket OWNER/TENANT_ADMIN seed already executed against the permissions table as it existed at that point in time and does not retroactively pick up rows inserted by a later changeset.
- [10-09-C]: RBAC IT (`PurchasingEndpointAuthorizationIT`) built its `Authentication` directly (`UsernamePasswordAuthenticationToken` + `JwtClaims` principal + `SimpleGrantedAuthority` list, injected via `SecurityMockMvcRequestPostProcessors.authentication(...)`) rather than `SecurityMockMvcRequestPostProcessors.jwt()` — this exercises the exact object model `JwtAuthenticationFilter` builds in production while still running the real `@EnableMethodSecurity` interceptor through `@AutoConfigureMockMvc`. Required adding `spring-security-test` as a test dependency to `purchasing-service/pom.xml` (previously absent, unlike auth-service/authorization-service/gateway).
- [10-10-A]: PO/invoice/expense list endpoints return a plain `ApiResponse<List<Dto>>` (no `PageMeta`/pagination), per the plan's explicit task wording — deliberately NOT following `VendorController.list`'s paginated `page`/`size`/`PageMeta` style, even though its `branchId`-as-request-param signature convention was followed. 10-12/10-13/10-14 must build a non-paginated `z.array(...)` Zod schema against this contract, not a paginated one.
- [10-10-B]: List `tenantId` is always resolved server-side from `TenantContext.requireTenantId()`, never a request parameter — `branchId` remains the only tenant/branch-scoping request param, mirroring the existing detail-endpoint and `VendorController.list` pattern. This is structural (impossible-by-construction) tenant isolation, not just test coverage.
- [10-10-C]: List DTOs reuse each service's existing private `toDto(...)` mapper rather than a second list-specific mapper, so `GET /` and `GET /{id}` return byte-for-byte identical row shapes (including nested `lines`/`LineMatchStatus`) — one Zod schema serves both. Ordering column is `createdAt` (PO, expense) or the pre-existing `invoiceDate` (invoices, reusing `findByTenantIdAndBranchIdOrderByInvoiceDateDesc` rather than adding a redundant column).
- [10-17-A]: FIN-05 AR is IN scope (not descoped, reversing the plan's original checkpoint recommendation). Receivables are sourced from corporate/house accounts (restaurants bill corporate clients and regulars on account; settled later). Split across two phases because POS does not exist yet (Phase 7 is 0/4 plans): Phase 10 (10-18) builds the AR sub-ledger, customer/house-account entity, AR balances + AR aging, and a real internal seam `POST /internal/finance/ar/charges`; Phase 7 (07-09, new follow-up plan) wires the POS "charge to account" tender to that seam on order close. AR is NOT OPA-gated — a credit limit is a domain invariant on the customer account, not an approval workflow. FIN-05 flipped from false-green Complete back to In Progress in REQUIREMENTS.md until 10-18 merges.
- [10-12-A]: `apiPoLineSchema.qty` was `z.string()` but `PurchaseOrderDto.LineDto.qty` is a Java `BigDecimal` with no custom Jackson serializer (`SharedAutoConfiguration.sharedObjectMapper()` has none) — the real backend returns it as a JSON number, not a string. Coerced to `z.union([z.string(), z.number()]).transform(String)`. Latent bug, caught while reading the real DTO for the PO-journey schema (10-10-A precedent: read source, don't guess wire shape).
- [10-12-B]: `CreatePurchaseOrderRequest.Line` (real DTO) is `{ingredientId, qty, uom, unitPricePaisa}` — no `description` field, unlike some plan prose assumed. No ingredient-list endpoint/hook exists anywhere in the frontend yet, so `PurchaseOrderFormDialog`'s line rows take a free-text `ingredientId` UUID input rather than a picker.
- [10-12-C]: `PurchaseOrderDto.LineDto` has no received-to-date field — `MockGrnReceivePanel` cannot show a running per-line received total, only ordered qty; every input defaults to ordered qty and the user lowers it to express a partial. Flagged for 10-13/next verification pass; would need a backend DTO change, not a frontend one, if a future UAT case needs "X of Y received so far" visibility.
- [10-12-D]: All 5 PO action mutations (`useSubmitPurchaseOrder`/`useWithdrawPurchaseOrder`/`useApprovePurchaseOrder`/`useRejectPurchaseOrder`/`useSendPurchaseOrder`) are pinned `useMutation<PurchaseOrder, ApiError, _>` (04-02-C precedent: `use-switch-branch.ts`) so `purchase-orders/[id]/page.tsx` can branch on `error.code`/`error.status` (10-07's `APPROVAL_LIMIT_EXCEEDED`/`DUPLICATE_APPROVER`) without importing `@/lib/api-client`.
- [10-12-E]: **Environment note, not a plan decision:** this session's working tree was being edited live by a concurrent sibling plan executor (10-14). Two `git add`/`git commit` race conditions occurred (files from one plan's staged-but-uncommitted work landing in the other's commit, and vice versa via HEAD moving mid-session / `fatal: cannot lock ref 'HEAD'`). Resolved non-destructively (`git reset --soft HEAD~1` + selective unstage, never `--hard`, never force-push) with no content lost — verified by diffing file content against `HEAD` after every unexpected `git log` change. Recommended pattern for future concurrent gap-closure waves: commit immediately after `git add` with no intervening tool calls, and re-verify `git show --stat HEAD` right after every commit — a returned commit hash is not a reliable signal of that commit's final file set when multiple executors share one working tree.
- [10-08-A]: A `@Primary @Bean AuthorizationClient` real-OPA test double does NOT work in either purchasing-service's or finance-service's Spring test context — two independent Spring behaviors both produce `NoUniqueBeanDefinitionException`: `@MockitoBean`'s bean-override machinery marks its replacement definition `primary` unconditionally (hit in purchasing-service, whose `PurchasingTestBase` inherits `@MockitoBean AuthorizationClient`), and Spring Cloud OpenFeign registers every `@FeignClient` proxy bean `primary` by default regardless of any mock (hit in finance-service, which has no inherited mock at all). The working pattern instead uses (or adds) a `@MockitoBean AuthorizationClient` and wires it in `@BeforeEach` to delegate via `when(mock.authorize(any())).thenAnswer(inv -> real.authorize(inv.getArgument(0)))` to a manually-constructed real-OPA client — never stubbed with a canned answer, so every call still round-trips through the real Testcontainers OPA instance. Reusable pattern for any future real-external-service IT that needs to displace a Feign client or an inherited mock.
- [10-14-A]: `ExpenseDto.java`'s wire field is `rejectReason` (not `rejectionReason` as plan prose assumed), and `ApAgingBucketDto.java` carries no invoice-count field (label/minDays/maxDays/amountPaisa only) — both caught by reading the Java DTOs directly per 10-10-A's precedent. `apiExpenseListSchema`/`apiApAgingSchema` built against the real source.
- [10-14-B]: `mocks/server.ts` (not `mocks/handlers.ts`) is the real MSW handler-registration point — `handlers.ts` only holds auth/feature-flag fixtures; `purchasingHandlers`/`financeHandlers` are separately imported and spread into `setupServer(...)` in `server.ts`. Any future plan adding a new mocks file must register it there, not in `handlers.ts`.
- [10-14-C]: A per-row action table (approve/reject inline in a list, not on a detail page) needs its own row sub-component (e.g. `ExpenseRow`) so id-scoped TanStack mutation hooks (`useApproveExpense(id)`/`useRejectExpense(id)`) are called consistently per React component instance, never inside the parent's `.map()` callback body directly — reusable for any future approver-inbox-style list.
- [10-14-D]: **Environment note, not a plan decision, corroborating 10-12-E:** this session's shared working tree had multiple concurrent plan-executor agents (10-08, 10-12) committing simultaneously. Two of 10-14's three commits were caught with sibling files swept in between `git add` and `git commit` (a concurrent `git add`-style operation from another agent landing files in the index between commands); both fixed non-destructively via `git reset --soft HEAD~1` + re-add + `git commit -m "..." -- <exact paths>` (pathspec-scoped commit, which commits only the named paths regardless of what else is staged) — recommended as the standard commit idiom for any future concurrent gap-closure wave, safer than relying on `git add <files>` immediately followed by a bare `git commit`.
- [10-14-E]: At verification time, the shared long-running dev backend stack (gateway on 8080, finance-service on 8086) was unhealthy for reasons unrelated to any file this plan touched: gateway's RabbitMQ connection was `ACCESS_REFUSED` after a RabbitMQ container restart (see 10-10's Issues Encountered), and finance-service's running jar threw `NoClassDefFoundError`/`ClassNotFoundException` on Hibernate/httpclient5 classes (stale/partially-rebuilt fat jar vs. its current classpath). A genuine browser click-path could not be performed; verified instead via a real MSW-intercepted repository/hook/adapter/Zod round-trip (`finance-expense-journey.test.ts`, 7/7 green) plus clean `tsc`/`eslint`/`next build`. Both services need a restart/rebuild before any plan can do a real click-path — flagged in Blockers/Concerns below.
- [10-13-A]: `CreateVendorInvoiceRequest`/`CreateApPaymentRequest` (real Java DTOs) do NOT match the 10-13-PLAN.md context block's assumed shapes: neither carries `vendorId`/`branchId` (both server-derived — from the PO for invoices, from the invoice for payments), the PO field is `purchaseOrderId` not `poId`, and `CreateApPaymentRequest` has no `method` field (`bankAccountCode` instead, optional, server defaults to `"1110"`). Schemas built against the real DTOs, not the plan's prose — same class of correction as 10-10-A/10-12-A/10-14-A.
- [10-13-B]: `LineMatchStatus` (real backend enum) is `OK/QTY_OVER/QTY_UNDER/PRICE_OVER/PRICE_UNDER/MISSING_GRN/PENDING`, not the `MATCHED/PRICE_VARIANCE/QTY_VARIANCE/MISSING_GRN` vocabulary the plan's own context block assumed. `MatchStatusBadge` (ThreeWayMatchTable.tsx) extended to the real vocabulary plus `InvoiceStatus`'s `PENDING_MATCH/MATCHED/MISMATCHED/APPROVED_FOR_PAYMENT/PAID`, reused for both line- and invoice-level badges rather than a third badge component.
- [10-13-C]: `VendorInvoiceDto.LineDto` has no `poQty`/`poUnitPricePaisa`/`grnQty` fields (only `id/poLineId/qty/unitPricePaisa/lineTotalPaisa/matchStatus`) — the invoice-side counterpart of 10-12-C's PO-line received-to-date gap. `ThreeWayMatchTable`'s PO/GRN columns degrade to "—" against the real API; would need a backend DTO change to show real values.
- [10-13-D]: No `GET /payments` list endpoint exists (`ApPaymentController` is POST-only) — `PurchasingRepository` has no `listApPayments`; the AP payments page reads the invoice list filtered to `MATCHED`/`APPROVED_FOR_PAYMENT`/`PAID` instead.
- [10-13-E]: `ApPaymentService.create` always marks the invoice `PAID` regardless of `amountPaisa` sent — there is no partial-payment/outstanding-balance tracking server-side, even though the amount field is technically editable. Flagged rather than building a partial-payment UX the backend can't back up.
- [10-13-F]: `apiInvoiceLineSchema.qty` needed the same BigDecimal number|string coercion 10-12-A applied to `apiPoLineSchema.qty` — `VendorInvoiceDto.LineDto.qty` is also a Jackson-default-serialized `BigDecimal`.
- [10-13-G]: No permission-gating helper exists in this codebase for inline action buttons (only `useNavVisibility` for nav items — 10-11). `OverrideMatchDialog`'s button always renders; a 403 from a missing `vendor.invoice.override` grant surfaces as a toast rather than hiding the button proactively. A future `usePermission(code)` hook would let this and 10-12's PO action bar hide proactively instead.
- [10-13-H]: **Real click-path attempted, not achieved — environment note, not a plan defect.** Unlike 10-12's session (where `deploy/.env` was missing), this session found `gateway`/`auth-service`/`purchasing-service` JVMs already running (started by a concurrent sibling agent) but all three reported `DOWN`/500/503 on `/actuator/health`, and the running Next.js dev server timed out loading `/app/purchasing/invoices` (consistent with a page blocked on a DAL/proxy round-trip to a DOWN gateway). No browser-automation tool available. Verified instead via the same MSW-round-trip pattern as every other Phase 10 gap-closure plan this wave (`purchasing-invoice-journey.test.ts`, 4/4 green) plus clean `tsc`/`eslint`/`next build`.
- [10-18-A]: AR aging ages by charge `txn_date` with AP's exact bucket boundaries (0-30/31-60/61-90/91+); settlements allocated FIFO oldest-charge-first.
- [10-18-B]: AR is NOT OPA-gated — a credit limit is a domain invariant on the customer account, not an approval workflow. No new rego action verb introduced (10-07-A's vocabulary untouched).
- [10-18-C]: `customer_accounts` carries contact name/phone/email UNENCRYPTED (business-contact class, same as a vendor's contact — only vendor *bank accounts* go through `EncryptionService`, per 02-02/10-16). No bank-account field added; if one is ever added it MUST go through `EncryptionService`.
- [10-18-D]: `InternalTenantContextHelper` gained a branch-scoped `activate(tenantId, branchId)` overload — the pre-existing branchId-less `activate(tenantId)` leaves `TenantContext` without a branch, which is the ROOT CAUSE of the pre-existing "Branch context required" failures in `InternalAutoPostIT`/`JournalEntryImmutabilityIT`/`JournalEntryBalanceTriggerIT` (all three call `JournalEntryService.autoPostInternal` via the branchId-less overload). The new AR internal seam (`POST /internal/finance/ar/charges`) uses the NEW branch-scoped overload and is proven working by `InternalArChargeSeamIT` (3/3 green, including idempotency). The three pre-existing failing IT classes were left unchanged (still using the branchId-less overload) — a future gap-closure item could switch them to the new overload to actually fix that pre-existing bug class, but that was out of this plan's scope.
- [10-18-E]: `GET /api/v1/finance/ar/customer-accounts` is PAGINATED (`ApiResponse.paginated`, matching `AccountController`'s existing CoA-list pattern), deliberately NOT following 10-10-A's non-paginated `ApiResponse<List<Dto>>` contract — that decision was scoped explicitly to PO/invoice/expense lists; customer-accounts is a new resource type closer to the existing paginated accounts list.
- [10-18-F]: **Environment note, not a plan decision.** The shared dev stack (gateway/finance-service/auth-service, running as local `java -jar` processes, apparently restarted mid-session by a concurrent stack-repair agent — `restaurantos-rabbitmq` container showed a ~30-min-old restart) responds to `/actuator/health` but hangs (timeout, 0 bytes) on direct-to-service `/api/v1/**` calls; routing through the gateway (8080) works. A real login (`cashier@demo.local`/`Cashier#2026`/`demo`, documented in `scripts/DEV-STACK-RUNBOOK.md`) succeeded and returned a real JWT, and `POST /api/v1/finance/ar/customer-accounts` reached finance-service (not 404) but was rejected `403 FEATURE_DISABLED` — reproduced identically on the pre-existing, already-shipped `GET /api/v1/finance/expenses` AND on an unrelated module (`GET /api/v1/purchasing/vendors`), confirming this is a stack-wide, pre-existing tenant-feature-flag resolution problem, not caused by or fixable from within this plan. Privileged demo accounts that hold `finance.ar.manage` (`accountant@demo.local`, `owner@demo.local`) both require TOTP step-up at login with no available code — a second, independent blocker to completing the click-path even once FEATURE_DISABLED is fixed. Full detail in 10-18-SUMMARY.md Issues Encountered.
- [07-01-A]: Flyway (not Liquibase) for pos-service — mirrors [06-01-A].
- [07-01-B]: OutboxRepository NOT mocked in PosTestBase — ITs query actual DB rows to assert outbox events written in-transaction.
- [07-01-C]: ORD-YYYYMMDD-NNNN sequence uses PESSIMISTIC_WRITE on OrderSequenceRepository.findForUpdate.
- [07-01-D]: ORDER_CREATED emitted on DRAFT→OPEN (first addItem), not on createOrder — table reservation is a create-only step.
- [07-01-E]: null kdsStation resolved to "DEFAULT" string in ORDER_SENT_TO_KDS payload — KDS contract is explicit.
- [07-01-F]: Discount floor: effectiveDiscount = min(requested, lineSubtotal) — lineNet never goes below 0.
- [07-01-G]: Per-line tax HALF_UP on discounted net — not applied to order-level total directly.
- [07-01-H]: Frontend errors.ts UNKNOWN_ERROR_MSG constant added to fix noUncheckedIndexedAccess TS error (pre-existing bug).
- [07-02-A]: Fail-closed FinancePeriodClient — Finance unreachable or period LOCKED/CLOSED → PeriodLockedException (423); never close order against a potentially locked period.
- [07-02-B]: Split-tender remainder assigned to first share only (not distributed evenly) — deterministic, auditable, no floating-point drift.
- [07-02-C]: OpaClient mocked via @MockitoBean in ITs rather than running live OPA server — focused service-layer auth testing without infrastructure dependency.
- [07-02-D]: InternalPosController returns bare Long (not ApiResponse-wrapped) at GET /internal/orders/open-count — must match Finance PosInternalClient Feign contract exactly.
- [07-02-E]: variance_paisa as GENERATED ALWAYS AS DB column — ensures variance computed atomically in DB, not susceptible to app-layer rounding.
- [07-03-A]: Manual service worker (public/sw.js) instead of @serwist/next — avoids uncertain Next.js 16 plugin compatibility.
- [07-03-B]: clientOrderId in APPEND_ITEMS outbox op stores the target order UUID — used as orderId param in addItem() during replay.
- [07-03-C]: OfflineIndicator uses native browser online/offline events in effect — react-hooks/set-state-in-effect rule requires setState only in event callbacks.
- [07-03-D]: SyncStatusBadge renders null when pending=0 — E2E uses toBeHidden() to verify sync completion.
- [07-03-E]: Online-only guard throws synchronously in mutationFn — causes isError state and shows OFFLINE_ERROR in component error display.
- [07-04-A]: KITCHEN_STAFF role gets ONLY pos.kds.view + pos.kds.update — no pos.order.* or finance.* (isolation proven by KdsAccessIsolationIT + kds_test.rego).
- [07-04-B]: MANAGER gets pos.kds.view only (read-only oversight), not pos.kds.update.
- [07-04-C]: RabbitMQ topology (pos.order-ready.queue) declared in PosKitchenTopologyConfig @Configuration, not Flyway.
- [07-04-D]: KDS board always dark — does NOT respect useTheme() (kitchen readability at 2m).
- [07-04-E]: WebSocket merges ticket frames into TanStack Query cache; HTTP polls every 10s as fallback.
- [Phase 07-05]: getPeriodStatus changed from @Transactional(readOnly = true) to plain @Transactional to support idempotent auto-seed-on-miss fallback (reuses existing seedForTenant, no new seeding logic).
- [07-06-A]: OrderServiceImpl.createOrder sets cashierId/tillSessionId from tenantContext.getUserId() + open till lookup, using an intermediate final Order reference (finalOrder pattern) to satisfy lambda effective-finality.
- [07-06-B]: TillSession.variancePaisa @Generated event array covers both INSERT and UPDATE so Hibernate re-fetches the DB-computed column after closeTill's UPDATE.
- [Phase 07-07]: New changeset 043 (not editing 030/041) grants CASHIER pos.order.void.own — permission code already existed, was only missing the CASHIER role grant.
- [Phase 07-07]: New changesets 902/903 appended to 900-seed-auth-dev-data.xml (not editing 900/901) seed chef@demo.local/manager@demo.local demo users.
- [Phase 07-07]: Bcrypt hashes for the two new demo users independently verified via BCryptPasswordEncoder.matches() before seeding, rather than trusted blindly.
- [Phase 07-08]: 10 Dockerfiles were missing pos-service/kitchen-service pom.xml COPY lines, breaking Maven reactor validation on docker compose up --build; kitchen-service's own Dockerfile was already correct and platform-admin-service's src-only build pattern was left out of scope.
- [Phase 07-08]: pos-service (8084) and kitchen-service (8090) added to scripts/start-dev.ps1 and scripts/restart-service.ps1 as first-class dev-stack services, not as new docker-compose build: stanzas (host-run architecture preserved).
- [Phase 07.1-01]: Task 2/3 execution order swapped (Task 3 mechanical KdsItemStatus->OrderItemStatus reconciliation applied before Task 2 TDD verification) because Maven compiles the whole module before any test runs, and Task 1 alone leaves the module non-compiling by design. — Makes the TDD RED/GREEN gate meaningful under Maven's whole-module compilation model; no scope change.
- [Phase 07.1-01]: OrderDto.OrderItemDto.kdsStatus field name kept unchanged (type widened KdsItemStatus->OrderItemStatus) rather than renamed to itemStatus. — Avoids an extra JSON contract break this plan; frontend schema rename is a later plan per PATTERNS.md.
- [Phase 07.1]: TicketRoutingService.route() converted from skip-if-exists to append-to-existing-ticket (POS-12/KDS-03) — ProcessedEventService.tryProcess remains the sole event-redelivery dedup; ticket existence is no longer used as a dedup signal
- [Phase 07.1]: sendToKds is repeatable and per-fire idempotent; Order.derivedStatus is the sole kitchen-progress aggregate, always computed via OrderStatusDerivationService, never hand-set — Plan 07.1-03 wired the plan-01 derivation seam into every item-status mutation path (sendToKds, markItemServed, cancelItem, ORDER_READY consumer); Order.status keeps its settlement hand-sets for event-contract compatibility only
- [Phase 07.1-04]: Extracted OrderMapper (Order->OrderDto) into its own @Component to break a circular Spring bean dependency between OrderServiceImpl (needs TableService for table-status sync) and TableServiceImpl (needs a full OrderDto for TableDetailDto).
- [Phase 07.1-04]: Table status is now derived from order lifecycle via a single seam, TableService.syncStatusForOrder, invoked from every order mutation path (was previously scattered inline table.setStatus() calls).
- [Phase 07.1-04]: pos.order.view.all permission code checked but not yet seeded in auth-service DB - every caller defaults to own-orders-only scoping until a future plan grants it to MANAGER+.
- [Phase 07.1-04]: POS-14 void-403 root-caused as JWT staleness (no code bug found in OpaInput construction) - VoidOwnOrderIT proves the authorization path is correct given a current token; frontend fresh-login handling deferred to a later plan.
- [Phase 07.1-04]: GET /api/v1/pos/orders now returns OrderSummaryDto[] (was OrderDto[]) - breaking wire-contract change; frontend four-layer wiring deferred to a later plan per PATTERNS.md.
- [Phase 07.1-05]: apiOrderItemSchema keeps wire field kdsStatus (widened to 7-value); adapter renames to domain field itemStatus — backend never renamed the wire field per 07.1-01/03's own decision
- [Phase 07.1-05]: Order.derivedStatus (4-value, matches backend DerivedOrderStatus exactly) stays distinct from the 9-value settlement status; getOrderDisplayStatus() in pos.model.ts is the single seam merging both into the UI-SPEC's 7-state order-status value
- [Phase 07.1-05]: listOrders/useOrders removed outright and replaced with listOrderSummaries/useOrderSummaries — grep-confirmed zero callers, and the old method was provably broken against the live backend (GET /pos/orders now returns OrderSummaryDto[] per 07.1-04)
- [Phase 07.1-05]: Extended lib/offline/types.ts (OutboxOpType +UPDATE_INSTRUCTIONS) and sync-engine.ts's replay branch (neither in this plan's file list) so useUpdateInstructions is actually offline-safe as the plan's must_haves require
- [Phase 07.1-05]: kds.schema.ts ticket-item status matches kitchen-service's real 5-value TicketItemStatus (PENDING/ACCEPTED/PREPARING/COOKING/READY), not pos-service's 7-value OrderItemStatus; KdsTicket.orderNotes is a forward-declared, always-null field — backend KdsTicketDto has no such field yet (documented gap)
- [Phase ?]: [Phase 07.1-07] toLineItemStatusVariant() normalizes kitchen-service's legacy COOKING status to PREPARING at the render seam (kds.schema.ts's 5-value KdsItemStatus stayed as-is from 07.1-05, not widened in this frontend-component-only plan)
- [Phase ?]: [Phase 07.1-07] New-ticket fade-in uses animate-fade-in applied unconditionally + React keyed-mount semantics instead of a stateful seen-ticket-id tracker, after both a useRef-during-useMemo and a useState+useEffect variant were rejected by this repo's react-hooks/refs and react-hooks/set-state-in-effect eslint rules
- [Phase ?]: [Phase 07.1-07] sortKdsTickets() exported as a generic pure function from kds-board.tsx (receivedAt asc, tie ticket.id, computed once per batch via useMemo) — fixes the KDS 'cards bounce' UAT complaint since the sort key never reads mutable per-item status
- [Phase 07.1]: Item-cap bug is a rapid-tap order-creation race (no order-id dedup), not a numeric cap — fixed via ref-based ensureOrderId single-flight dedup + moving useAddItem's orderId from hook-argument to mutate-time binding
- [Phase 07.1]: useAddItem redesigned: orderId is now a per-call mutate variable instead of a hook-creation-time argument — eliminates the stale-closure hazard class and closes a pre-existing layer-boundary ESLint violation in pos-terminal.tsx
- [Phase 07.1-09]: SettlementActions renders once (drawer footer only), not duplicated near the header — UI-SPEC §7 mandates the shared component appear in exactly 3 places total across the phase; this drawer counts as one of those three
- [Phase 07.1-09]: Fixed order-summaries query-invalidation gap across 8 mutations (use-orders.ts/use-payments.ts) — Required for this plan's own closing/voiding-removes-it acceptance criterion to actually work
- [Phase ?]: [Phase 07.1-10]: OCCUPIED/NEEDS_BUSSING table taps never call onTableSelect (only AVAILABLE does) to avoid rebinding page-level selectedTableId to an already-occupied table; TableFloorView owns its own OrderTableDetailDrawer instance/state for that path.
- [Phase 07.2]: [07.2-01-A]: Left REQUIREMENTS.md Coverage running totals (112/112) untouched -- already stale pre-plan, out of scope for this bookkeeping-only plan.
- [Phase ?]: [07.2-02]: Changeset 044 grants finance.period.open explicitly to OWNER/TENANT_ADMIN/ACCOUNTANT (not relying on 036's wildcard SELECT, which is runOnChange=false and only ran once) -- RESEARCH.md Pitfall 4.
- [07.2-03]: Removed ProvisioningService Step 5's inner try/catch swallow and flipped provisioning.seed-coa.enabled's YAML default to true -- finance-seed failure now aborts onboarding (PROVISIONING_FAILED) instead of reaching ACTIVE with zero accounting periods; retry() deliberately left untouched (RESEARCH.md Pitfall 1), recovery deferred to plan 05's self-service endpoint.
- [07.2-03]: @Nested inner test class + @TestPropertySource used in ProvisioningSagaIT to override provisioning.seed-coa.enabled=true for a single test without a new top-level file or duplicating Testcontainers container startup.
- [07.2-04]: Gated getPeriodStatus's auto-seed-on-miss branch behind @Value("${finance.period.auto-seed-on-miss:true}") + matching FINANCE_PERIOD_AUTO_SEED_ON_MISS:true YAML default, with a WARN audit log (tenantId+date+fiscalYear) whenever it fires -- toggle-off surfaces PeriodNotFoundException with no seed side effect (FIN-09).
- [07.2-04]: AccountingPeriodAutoSeedToggleIT created as a standalone top-level test class (not @Nested) because FinanceTestBase does not pin this property via @DynamicPropertySource, so a plain @TestPropertySource cleanly overrides it for this one class.
- [Phase ?]: [07.2-05]: Provision-endpoint tests call provisioningService.provision(tenantId, fiscalYear) directly (the endpoint's exact delegate), not the PeriodController bean, because Spring method-security AOP enforces @PreAuthorize on every bean invocation even without an HTTP layer -- 403-gate coverage deferred to plan 02 IT + plan 06 live E2E.
- [Phase 07.2-07]: ProvisionPeriodDialog uses a local getProvisionErrorMessage() instead of formatUserFacingError from @/lib/api-client/errors, avoiding a documented components/** -> lib/api-client/** ESLint layer-boundary violation (docs/finance-eslint-backlog.md Issue 1); mirrors payment-panel.tsx's getChargeErrorMessage convention.
- [Phase 07.2-07]: ProvisionPeriodDialog's internal fiscalYear state resets via a parent-side key={fiscalYear} remount in periods/page.tsx, not useEffect+setState, per react-hooks/set-state-in-effect.
- [Phase 07.2-07]: E2E login() helper classifies a 'Sign-in failed / service temporarily unavailable' banner as Blocked (not FAIL), matching pos-settlement.spec.ts's 503/FallbackController convention -- discovered live this session (finance-service down, gateway 503).
- [07.2-06]: Root-caused platform-admin-service's 100% IT-suite failure to a hardcoded macOS-only DOCKER_HOST in pom.xml:171 (commit 55ae628, predates 07.2 entirely) -- corrects STATE.md's prior "session-level" hypothesis; not fixed (out of scope for verification-only Task 1), flagged as Pending Todo.
- [07.2-06]: Used `mvn -fae` (fail-at-end) instead of plain `verify` for the full IT suite -- plain verify fail-fasts on auth-service's known pre-existing flakiness and silently SKIPs finance-service/platform-admin-service, violating the "no silent skips" acceptance criterion.
- [07.2-06]: Confirmed PROVISIONING_SEED_COA_ENABLED live default is true (unset in deploy/.env; YAML default already flipped by 07.2-03) -- RESEARCH.md Assumption A1 resolved, no deploy-config gap.
- [Phase 07.3-01]: maybeCloseOrder is a no-op (returns order unchanged) rather than throwing when Paid+Served isn't both true or the order is already terminal -- safe to call unconditionally from recordPayment and markItemServed.
- [Phase 07.3-01]: closeOrder (legacy exact-tender) and maybeCloseOrder (derived Paid+Served close) share one private performClose(Order, paymentEntries) seam -- exactly ONE ORDER_CLOSED publish call site; closeOrder itself still does not persist OrderPayment rows (out of scope, only recordPayment does).
- [Phase 07.3-02]: KitchenItemStatusConsumer uses OrderItemStatus.ordinal() forward-only guard (generalizes OrderReadyConsumer's fixed-target ELIGIBLE-set pattern) since the incoming kitchen status varies per message — A simple membership set cannot express never-move-backward for every possible target status; ordinal comparison does.
- [Phase 07.3-02]: Dev-stack RabbitMQ requires RABBITMQ_USERNAME=restaurantos/RABBITMQ_PASSWORD=dev_rabbit_2026 (deploy/.env) for @RabbitListener context startup locally — Resolves the previously-documented ACCESS_REFUSED environmental blocker for kitchen-service/pos-service Testcontainers ITs; both full suites ran green with these exported.
- [Phase 07.3-03]: Menu taps are ALWAYS cart-only (never network), even post-send; adding more items to a fired order is Order Management's revision-fire flow (POS-21/D-06), not the terminal's
- [Phase 07.3-03]: New lib/hooks/pos/use-fire-to-kitchen.ts (mutate-time-orderId sendToKds sibling) added instead of editing use-orders.ts, which 07.3-06 owns this phase
- [Phase 07.3-04]: assignTable routes the previous table binding (no-op when null, the common case) AND the newly-assigned table through the SAME TableService.syncStatusForOrder seam -- never an inline table.setStatus() call; true table-to-table reassignment is not covered by this plan's tests
- [Phase 07.3-04]: listOrderSummaries default filter changed from !isTerminal(s) to !isTerminal(s) && s != DRAFT -- explicit statuses requests (incl. DRAFT/terminal) bypass the default and are unaffected
- [Phase 07.3-04]: OrderPaymentRepository.sumAmountByOrderIds batched interface-projection query added for listOrderSummaries -- one query per page instead of per row (N+1 avoidance)
- [Phase ?]: [07.3-06]: useOrder gets a flat 5s refetchInterval (not WebSocket) for POS-20 live sync; matches KDS board's own HTTP-poll fallback pattern
- [Phase ?]: [07.3-06]: order-table-detail-drawer rebuilt on raw Radix DialogPrimitive (not shared DialogContent) to drop its sm:max-w-sm default and become a large in-place panel (inset-4 sm:inset-6 lg:inset-10) for POS-25
- [Phase ?]: [07.3-06]: Playwright locator.isVisible({timeout}) does not auto-retry/wait -- genuine wait-for-async-element E2E checks must use expect(locator).toBeVisible({timeout}) or locator.waitFor
- [Phase 07.3-07]: GET /orders/{id} has no paymentStatus field — derivePaymentStatus() mirrors backend PaymentStatusDerivationService client-side from useOrderPayments sum vs order.totalPaisa, kept frontend-only
- [Phase 07.3-07]: recordPayment records ONE tender per call (backend has no multi-payment array endpoint outside legacy closeOrder); split-tender rows submit sequentially via mutateAsync
- [Phase 07.3-07]: Charge page never calls closeOrder directly — relies entirely on backend maybeCloseOrder seam to auto-close once Paid AND Served
- [Phase 07.3-05]: TicketRoutingService.ensureStation seeds a station row (branchId+code) for every station code a ticket routes to, not only DEFAULT -- backstopped by V1's uq_station_tenant_branch_code unique constraint
- [Phase 07.3-05]: KdsController.getStations auto-seeds a DEFAULT station on empty branch (mirrors finance 07.2 auto-seed-on-miss); item-status endpoint wraps existing markItemStatus rather than re-implementing transition logic
- [Phase ?]: [Phase 07.3-08]: Closed filter scoped to statuses=["CLOSED"] only (not full terminal set) -- matches the chips literal label; VOIDED/REFUNDED remain reachable via their own StatusBadge elsewhere.
- [Phase ?]: [Phase 07.3-08]: Closed filter uses a SEPARATE enabled-gated useOrderSummaries query instance rather than re-pointing the always-on active-list query, so useFadeOutList never misfires on a filter-driven fetch-scope switch.
- [Phase ?]: [Phase 07.3-08]: table-select-combobox.tsx gained an additive availableOnly prop (default false) instead of a new component -- Assign Table is the only availableOnly=true caller, order-panel.tsx unaffected.
- [Phase 07.3-09]: void/refund and till panels use a plain in-flow section (no Radix DialogPrimitive) mirroring 07.3-07's charge-summary.tsx pattern, not 07.3-06's Radix-Dialog-based order-table-detail-drawer.tsx pattern -- required so neither surface carries a [role=dialog], satisfying this plan's own executable no-dialog E2E backstop.
- [Phase 07.3-09]: till-session-bar.tsx panels replace the trigger row in place within the same session-scoped bar (still visible above all 3 POS tabs) rather than a portal/overlay panel.
- [Phase ?]: Deleted kds-board.tsx (superseded by station-picker/station-board/kds-item-column); moved sortKdsTickets into station-board.tsx — 07.3-10: kitchen/page.tsx became a station picker so the old multi-station KdsBoard had zero callers left
- [Phase ?]: kds-ticket-detail.tsx extended with optional canUpdate prop for per-item transition controls — 07.3-10 Task 3: avoids duplicating revision-grouping logic in kds-station-detail.tsx
- [Phase ?]: [07.3-11]: D-08 (locked by user) - DEPRECATE and REMOVE the legacy closeOrder tender-sum-only close bypass rather than gate/fix it in place; retired POST /orders/{id}/close to 410 Gone, deleted the service method, migrated 8 IT-fixture callers to a shared closeViaServeAndPay helper, deleted orphaned frontend PaymentPanel/useCloseOrder.
- [Phase ?]: [07.3-11]: PosTestBase.closeViaServeAndPay always re-fetches totalPaisa from the DB immediately before recordPayment (never trusts the caller-supplied OrderDto param) -- caught a real stale-order bug where OrderSummaryDtoIT's order variable was captured before addItem.
- [08-01-A]: inventory-service's V1__inventory_schema.sql applies ENABLE + FORCE ROW LEVEL SECURITY on all 11 domain tables from V1 (not retrofitted later) — first service in the repo to match the documented RLS convention exactly; finance/kitchen both omitted FORCE and needed follow-up hotfixes.
- [08-01-B]: application.yml's RabbitMQ listener kept at acknowledge-mode: manual per the plan's explicit instruction, even though kitchen-service's live config runs auto (after a prior manual-ack bug where no consumer called basicAck). No consumer exists yet in 08-01 — 08-02's OrderClosedConsumer must call basicAck/basicNack explicitly, or this should be revisited to auto.
- [08-01-C]: GitNexus MCP tools (impact/detect_changes) referenced in CLAUDE.md were not available in this execution's tool set; all 08-01 changes are additive (new module + pom.xml module registration + start-dev.ps1 append), so blast radius is inherently LOW regardless.
- [Phase ?]: TestFixtures builds JwtClaims + SecurityContextHolder auth directly instead of RSA-signed JWT strings, matching kitchen-service's in-process controller IT pattern
- [Phase ?]: SchemaMigrationIT sweeps FORCE RLS + tenant_isolation across all 11 domain tables, not just the plan-required single representative table
- [Phase 08]: [08-09]: inventory.rego view rule kept action-guarded (input.action == "inventory.item.view"), matching kds.rego's real shape and NOT the un-guarded snippet in 08-RESEARCH.md — the un-guarded form would let view-only principals pass the manage-action check. — Un-guarded version fails the plan's own required test (view-only denied manage action) and creates a real privilege-escalation gap.
- [Phase 08]: [08-09]: opa CLI unavailable on PATH; verified opa test/coverage via docker run openpolicyagent/opa:1.17.1 against policies/ (image already present locally) — PASS 104/104, 100% coverage.
- [Phase 08-03]: MockMvc + Spring Security test support (not direct controller-bean invocation) for inventory-service ITs that assert literal HTTP status codes (400/403) — mirrors finance-service's FinanceEndpointAuthorizationIT; kitchen-service's direct-bean style cannot exercise @Valid without class-level @Validated.
- [Phase 08-03]: MacCalculator D-02 oversell policy: a receipt landing on zero/negative on-hand resets MAC to the receipt's own unit cost rather than blending against a meaningless prior average.
- [Phase 08-03]: RecordOpeningBalanceRequest.unitCostPaisa is boxed Long (not primitive long) so @NotNull actually rejects a missing value instead of a Jackson-defaulted 0.
- [Phase 08-04]: resolveEffectiveRecipe(menuItemId, atInstant) plain-typed, decoupled from pos-service Order -- 08-05 passes order.getClosedAt() at its own call site
- [Phase ?]: DepletionService pre-sorts distinct ingredientId set (natural UUID order) before locking, never per-recipe-line lazy locking (Pitfall 6 deadlock avoidance). — 08-05
- [Phase ?]: COGS = effectiveBaseQty x avg_cost_paisa (aggregate MAC), never a lot's own receipt cost — FEFO governs which lots drop, MAC governs COGS (D-04/Pitfall 9). — 08-05
- [Phase ?]: ReceiveStockRequest.unitCostPaisa is boxed Long (not primitive) with @NotNull @Positive, mirroring RecordOpeningBalanceRequest's 08-03 precedent. — 08-06
- [Phase ?]: GrnPendingCountRepository.countPendingAsOf is a genuine tenant-scoped JPQL COUNT query filtered on a PENDING_GRN sentinel referenceType (not a hard-coded 0 literal) -- evaluates to 0 today since ReceiptService never writes that referenceType; Phase 10 purchasing will repoint the sentinel. — 08-06
- [Phase 08-07]: unit_cost_paisa on each StockTransferLine is captured from the SOURCE branch's avg_cost_paisa at ship time — the Inventory-in-Transit (1320) valuation TRANSFER_SHIPPED/RECEIVED/VARIANCE carry for Phase 9's finance consumer
- [Phase 08-07]: TRANSFER_VARIANCE publishes for ANY non-zero variance_qty, no auto-post threshold suppression — Phase 9 decides GL posting
- [Phase ?]: StockCountLineRepository added (Rule 2) — mirrors StockTransferLineRepository's flat-FK pattern; every line-entity in Phase 8 gets its own repository, never a JPA @OneToMany cascade collection. — 08-08
- [Phase ?]: ExpirySweepService.sweep() is a single @Transactional boundary (never per-tenant self-invoked @Transactional, which Spring's proxy silently skips); per-tenant RLS GUC switch uses TenantGucHelper.apply on the already-open connection, not tenantContext.set alone. — 08-08
- [Phase ?]: Documented (not silently worked around): the expiry sweep's cross-tenant discovery query is bound by the same FORCE RLS + NOBYPASSRLS constraint as every other stock_lots query — real cron-path cross-tenant dispatch across a cold fleet is a known gap requiring a future Rule-4 architectural decision. — 08-08
- [Phase 08.1-01]: MenuItemUpsertedPayload/MenuItemDeletedPayload field name+order locked exactly per D-02 - inventory-service's InventoryEventPayloads (08.1-02) must mirror field-for-field
- [Phase 08.1-01]: No new OPA/permission code for menu CRUD write endpoints - mirrors assignStation's class-level FEATURE_POS gate only (T-081-01 accepted)
- [Phase 08.1-01]: deleteItem is soft-delete only (deletedAt+active=false) - never a hard DELETE, so historical orders/recipes stay resolvable
- [Phase 08.1-02]: menu_item_catalog follows V1's FORCE-RLS convention (not V3's RLS-EXEMPT registry pattern) since it is read under tenant context on the API path and written under tenant context resolved from the envelope on the consumer path
- [Phase 08.1-02]: inventory.menu-item.queue is a deliberate one-queue/two-event-types exception (D-08) to this service's one-queue-per-event-type convention, dispatched by parsing eventType before choosing the payload class
- [Phase 08.1-02]: MenuItemNotFoundException gets its own 404 via a new local InventoryExceptionHandler advice bean rather than editing shared-lib's GlobalExceptionHandler, which always maps RestaurantOsException to 400
- [Phase ?]: Registered inventoryHandlers in mocks/server.ts (not handlers.ts) — matches the codebase's actual current MSW registration pattern
- [Phase ?]: e2e spec uses manager@demo.local (MANAGER role) — holds both inventory.item.view/manage with no TOTP
- [Phase 08.1-06]: TenantGucHelper.apply() inside process()'s existing @Transactional method, not a split non-transactional/transactional boundary restructure (lower blast radius across 10 shared-lib consumers)
- [Phase 08.1-06]: Fixed pre-existing shared-lib BaseIntegrationTest missing spring.liquibase.url (Rule 3 blocking-issue) that silently broke every shared-lib IT

### Pending Todos

- When planning future module phases, READ `Docs/RestaurantOS_UI_UX_Design_System.md` first; pull the relevant §7–8 module UX into that phase's plan (POS/KDS→7, Finance→6, Inventory→8, Vendor→10, HR→11, NLQ/Reports/Owner-dashboard→12).

- Confirm feature-flags endpoint path/shape `/api/v1/feature-flags` (04-01 D4 / 04-02-A) against live Phase-3 contract
- Confirm available-branches source/endpoint (e.g. `/api/v1/branches`) to replace the BranchSwitcher static stub (04-02-E)
- Wire Java static-analysis plugins (checkstyle/spotbugs/pmd) into the parent POM + make JaCoCo `check` data-driven from coverage-gates.json (04-03-E)
- Implement the real OpenAPI↔Zod drift check once backend SpringDoc OpenAPI exists (04-03-B / D5b)
- Run the CI pipeline on a live GitHub runner (validated locally by YAML parse + greps; actionlint/yamllint unavailable on dev host)
- Consider adding `@hookform/resolvers` to replace the hand-rolled resolver (04-02-D, optional)
- Update FE-03 wording (`middleware.ts` → `proxy.ts`) and reconcile spec §7.4 error catalogue with live auth-service codes
- Resolve Phase 1 SC5 gap (open from Phase 1 verification)

### Blockers/Concerns

- **Phase 1 SC5 gap:** `processed_events` consumer dedup not implemented — fix via `/gsd-plan-phase 1 --gaps` (non-blocking for Phase 3).
- **IT env:** Testcontainers on Colima requires `DOCKER_HOST` + `TESTCONTAINERS_RYUK_DISABLED=true`.
- **10-05 unverified at runtime:** ~~`ExpenseApprovalIT` (finance-service, FIN-05 OPA-limited expense approval) could not be executed in the 2026-07-12 execution sandbox — no working Docker daemon.~~ **RESOLVED (2026-07-12, pre-10-06 verification run):** a later sandbox with a live Docker daemon ran `ExpenseApprovalIT` for real — 4/4 tests green, confirmed by 10-06.
- **10-03 unverified at runtime:** ~~`SpendAnalyticsIT` and `VendorScorecardIT` (purchasing-service, PUR-06/PUR-05) could not be executed in the same Docker-less sandbox.~~
  - **RESOLVED by 10-04:** the 10-04 execution sandbox had a working Docker daemon; `mvn -pl services/purchasing-service failsafe:integration-test failsafe:verify` was run for real and all 18 purchasing ITs (including SpendAnalyticsIT and VendorScorecardIT) passed — BUILD SUCCESS, 0 failures, 0 errors.
- **Pre-existing frontend tsc errors (unrelated to Phase 10):** `frontend/lib/api-client/errors.ts` lines 129/134/137 fail `pnpm tsc --noEmit` under strict optional typing (`USER_FACING_BY_CODE` string-indexing). File untouched since commits `b02cadc`/`e79cdbd`, not owned by any Phase 10 gap plan. Does not block purchasing (all 10-04-modified frontend files compile clean). Needs a follow-up fix outside Phase 10.
- **finance-service pre-existing IT failure (found during 10-07, out of scope):** `JournalEntryImmutabilityIT`, `JournalEntryBalanceTriggerIT`, `InternalAutoPostIT` (6 tests total) fail with `IllegalStateException: Branch context required` in `JournalEntryServiceImpl.create`. Confirmed via `git worktree` at base commit `964446c` — pre-dates 10-07, unrelated to `ExpenseService`/OPA changes (`ExpenseApprovalIT`, which exercises the same `autoPostInternal` path with a properly branch-scoped `tenantContext`, passes 4/4). Needs its own gap-closure investigation.
- **10-12 real click-path NOT performed:** the plan's acceptance criterion (lesson 10-06-A) required a genuine browser click-through with a running gateway/auth-service/purchasing-service stack and a MANAGER login. This session's Docker infra was up (postgres/redis/opa/eureka/config-server/minio/mailpit) but no application services were running, `deploy/.env` was missing (blocking a quick `mvn spring-boot:run` boot), and no browser-automation tool was available to this agent. Verified instead: tsc/eslint/next-build clean, and a 6-test MSW round-trip suite against contracts read directly from the real backend DTOs (not guessed). The next session with a live full stack (or browser tool) should run the plan's Task 2/Task 3 manual click-path steps before UAT tests 2/3/12/13 are marked resolved.
- **10-14 real click-path NOT performed — shared dev backend stack unhealthy (unrelated to this plan):** by the time 10-14 reached verification, `gateway` (8080) was reporting `DOWN` (RabbitMQ `ACCESS_REFUSED` after a container restart) and `finance-service` (8086) was throwing `NoClassDefFoundError`/`ClassNotFoundException` on Hibernate/httpclient5 classes from a stale running jar — neither caused by this plan's frontend-only changes. Restarting either shared, long-running process risked disrupting 10-08's concurrent real-OPA IT run against the same finance-service, so it was not attempted. Verified instead: `finance-expense-journey.test.ts` (7/7, real MSW-intercepted repository/hook/adapter/Zod round-trip), clean `tsc`/`eslint`/`next build`, and the build's route manifest confirms `/app/finance/expenses`/`/app/finance/ap-aging` are real routes. **Action needed before UAT tests 9/16 are marked resolved:** rebuild+restart finance-service (`mvn -pl services/finance-service clean package` then relaunch the jar) and restart gateway with valid RabbitMQ credentials, then run the plan's Task 2/Task 3 manual click-path steps (over-limit approve -> destructive toast + no new JE; within-limit approve -> balanced JE in journal-entries page; AP aging Current-bucket total matches booked invoices).
- **10-13 real click-path NOT performed — shared dev backend stack unhealthy at check time (unrelated to this plan):** `gateway`/`auth-service`/`purchasing-service` JVMs were running (started by a concurrent sibling agent) but all three returned `DOWN`/500/503 on `/actuator/health`, and the running frontend dev server timed out loading a purchasing route. Verified instead: `purchasing-invoice-journey.test.ts` (4/4, real MSW-intercepted repository/hook/schema round-trip against contracts read from the real Java DTOs), clean `tsc`/`eslint`/`next build`, route manifest confirms `/app/purchasing/invoices`, `/app/purchasing/invoices/[id]`, and `/app/purchasing/payments` are real routes. **Action needed before UAT tests 4-8 are marked resolved:** get gateway/auth-service/purchasing-service to a genuinely healthy state (or use a browser-automation tool), then run the plan's Task 2/Task 3 manual click-path steps, including confirming the AP -> Bank journal entry in the finance GL.
- **10-18 real click-path NOT performed — stack-wide FEATURE_DISABLED at the gateway (unrelated to this plan's code, but STILL BLOCKING):** by the time 10-18 verified, the shared dev stack (gateway/finance-service/auth-service) was UP and responsive at `/actuator/health` and through the gateway for auth — a real login as `cashier@demo.local` succeeded and returned a real JWT — but EVERY module's API (finance's pre-existing `GET /api/v1/finance/expenses`, purchasing's `GET /api/v1/purchasing/vendors`, and the new `POST /api/v1/finance/ar/customer-accounts`) returned `403 FEATURE_DISABLED` at the gateway's feature-flag layer. This is a tenant-feature-flag resolution problem for the `demo` tenant (Redis cache / `tenant_features` seeding, possibly mid-repair — `git status` shows uncommitted changes to `gateway/src/.../FeatureFlagGlobalFilter.java` from a concurrent stack-repair agent this session), NOT specific to AR. Additionally, the demo accounts that actually hold `finance.ar.manage` (`accountant@demo.local`, `owner@demo.local`) both require TOTP step-up at login and no TOTP code/secret was available — a second, independent blocker. **Action needed before ANY module's UAT click-path can be marked resolved:** fix the demo tenant's feature-flag resolution stack-wide (not per-plan), and establish a working TOTP path (or a non-TOTP privileged demo account) for AR/finance/purchasing manage-level journeys. Full detail: 10-18-SUMMARY.md Issues Encountered.

- kitchen-service Testcontainers ITs (incl. new TicketRevisionRoutingIT) currently blocked by a pre-existing RabbitMQ ACCESS_REFUSED auth conflict on localhost:5672, confirmed environmental (baseline TicketRoutingIT fails identically). Human/CI run needed in an env without a competing local RabbitMQ broker.
- **Phase 07.2 Wave 1 post-merge gate findings (pre-existing, NOT caused by 07.2-01..05):** (1) auth-service `BranchSwitchIT`/`RefreshLogoutIT`/`StepUpLoginIT`/`TotpFlowIT` fail with 401/403 mismatches when run as part of the FULL auth-service suite but pass cleanly (0 failures) when run in isolation — a pre-existing test-order/shared-context flakiness, confirmed unrelated to this phase (of these 4 files were touched by any 07.2 plan; last touched 2026-06-24 in Phase 2). (2) finance-service `JournalEntryImmutabilityIT`/`JournalEntryBalanceTriggerIT`/`InternalAutoPostIT` fail with `IllegalStateException: Branch context required` — reproduced identically on the pre-phase-07.2 baseline commit (71925f5) via a throwaway worktree, confirming this predates the phase entirely (`JournalEntryServiceImpl.java` last touched in Phase 6, untouched by 07.2). (3) platform-admin-service's Testcontainers IT suite failed to bootstrap its Docker client strategy (`TestcontainersHostPropertyClientProviderStrategy could not be instantiated`) specifically in the orchestrator's own shell session — `docker ps` works fine directly, and each of plans 07.2-02/03/04/05's own executor sessions already ran their scoped Testcontainers-based tests green moments earlier on the same host, so this reads as a session-level Docker/Testcontainers bootstrap quirk, not a code defect. of these three findings blocked Wave 1 — `git diff --stat` confirmed only the 14 files owned by plans 02-05 changed. Recommend a human/CI run of the full three-service suite in a clean session before treating Phase 07.2 as fully verified (07.2-06 already restarts all three services + reruns the full suite as its Task 1, which should be the authoritative check).
- 07.2-07's live Playwright E2E run (finance-period-provisioning.spec.ts) was BLOCKED this session: finance-service process down / gateway 503 in the dev stack. Deferred to 07.2-06's restart-and-verify gate per plan.
- kitchen-service KdsController.getTickets: LazyInitializationException on unscoped GET (no @Transactional boundary) + unsorted/size=20 default Pageable lets accumulated stale PENDING test tickets (29+ on GRILL) push new tickets beyond page 1 -- blocks pos-kitchen-live-sync.spec.ts (POS-20) from a live PASS; out of scope for 07.3-06 (frontend-only), logged in 07.3 deferred-items.md
- 07.3-07 pos-settlement.spec.ts: S4 (pre-existing, unrelated - Send to Kitchen toast timing) and S7 (cascading) FAIL live on this dev branch; S5/S5b (new POS-22/23 charge-page assertions) correctly reach BLOCKED - POST /payments succeeds but GET /payments 503s at the gateway (same circuit-breaker gap as S2/S6). Recommend a re-run once these environmental gaps clear before treating POS-22/23 live UAT as fully closed.
- 07.3-09 pos-modal-revamp.spec.ts: void/refund stage BLOCKED live this session by a pos-service POST /orders/{id}/items response-relay hang -- the write completes near-instantly server-side (confirmed via direct DB row inspection) but the HTTP response never reaches the browser, reproduced 5x across a pos-service restart and a gateway restart. Not caused by this plan's files (pure frontend UI, no relationship to the addItem endpoint). Full diagnostic trail in deferred-items.md under `## 07.3-09`. Recommend a re-run once the dev-stack stabilizes to capture the live pos25-void-refund.png.

### Roadmap Evolution

- Phase 07.1 inserted after Phase 7: POS Production Operations & Item-Level Kitchen Tracking — upgrade POS from MVP to production-ready restaurant operations (order management, table-centric dine-in, item-level status, kitchen ticket revisions, cashier UX) (URGENT)
- Phase 07.2 inserted after Phase 7: Finance accounting-period provisioning — fixes silently-swallowed CoA/period seeding at tenant onboarding, adds self-service open-period endpoint, resolves parent-07 UAT blocker (423 PERIOD_LOCKED on fresh tenants) (URGENT)
- Phase 08.2 inserted after Phase 8: Inventory Master Data & Procurement Catalog — ingredient categories (3-level tree), ingredient/UOM CRUD UI, recipe view/edit + plate cost, vendor item catalog with effective-dated pricing, stock ops UI, catalog-driven PO picker (URGENT)

## Session Continuity

Last session: 2026-07-21T21:31:25.884Z
Stopped at: Phase 08.2 UI-SPEC approved (6/6 dimensions; commits cce64ef + 9297e68). Next: /gsd-plan-phase 08.2
Resume file: .planning/phases/08.2-inventory-master-data-procurement-catalog/08.2-UI-SPEC.md
None
Stopped at: Completed 10-15-PLAN.md (Purchasing analytics period picker + vendor selector — `PeriodPicker.tsx` created, `analytics/page.tsx` and `VendorScorecardCard.tsx` wired to the existing `useSpendAnalytics`/`useVendorScorecard` hooks, no data-layer files touched) — commits e55d880 (period picker + page wiring), 81a4d44 (vendor selector + outbound-param test), 0cc12df (real-render-path test hardening). tsc/eslint/next-build clean; purchasing-scoped vitest green (19 tests across 4 files). Closes UAT gaps 10/14/15.
Also stopped at (parallel plan): Completed 10-11-PLAN.md (Purchasing nav flag fix — FEATURE_PURCHASING -> FEATURE_VENDOR — + FeatureFlag-typed nav items + drift test reading backend Java off disk + purchasing landing page/5-tab shell) — commits 0fcf34e (flag fix), 9c39884 (drift test), 1a3bb6d (landing page + tabs). Negative control verified (reverting to FEATURE_PURCHASING fails all 3 drift tests). purchase-orders/invoices/payments list pages (10-12/10-13) not yet built — tabs/landing-page links to them will 404 until those plans land; documented in 10-11-SUMMARY.md as a deliberate seam, not a regression.
Also stopped at (parallel plan): Completed 10-16-PLAN.md (VendorService encryption fail-fast — `EncryptionRequiredConfig` + required `EncryptionService` constructor dependency + `VendorEncryptionFailFastIT`) — commits a3a5ad8 (Task 1: hard dependency + config), c99323b (Task 2: real-context fail-fast test + raw-JDBC plaintext check + blank-key gap fix). Manual negative control (temporarily restored old null-out branch) confirmed the plaintext-never-persisted test fails as expected; reverted. Full purchasing-service `mvn verify`: 38/38 green, no regressions. GitNexus MCP tools were unavailable in this session; manual caller-grep substituted (see 10-16-SUMMARY.md Issues Encountered) — `detect_changes` against main still recommended before merge.
Also stopped at (parallel plan): Completed 10-09-PLAN.md (RBAC gating — `@PreAuthorize` on all 18 public purchasing endpoints + `031-purchasing-permissions.xml` seed + `PurchasingEndpointAuthorizationIT`) — commits 3139927 (Task 1: permission seed), 64ac6a9 (Task 2: `@PreAuthorize` on all 6 public controllers), c2b2ecb (Task 3: RBAC IT + shared-lib `AccessDeniedException` bug fix). Negative control (removed `@PreAuthorize` from `ApPaymentController.create`) confirmed both `cashier_isForbidden_onEveryMutatingEndpoint[12]` and `everyPublicEndpointIsGated` fail as required; restored, 15/15 green. GitNexus MCP tools were unavailable in this session (not registered) — impact analysis on `VendorController` etc. was not run programmatically; changes were reviewed manually against the finance-service `ExpenseController` reference pattern instead.
Also stopped at (parallel plan): Completed 10-17-PLAN.md (FIN-05 AR scope decision record — REQUIREMENTS.md and ROADMAP.md docs-only) — commits 84b38da (Task 1: FIN-05 checklist item unchecked + traceability row Complete->In Progress), 95e69ce (Task 2: Phase 10 SC#4 restated falsifiably + Scope decisions note + plan list corrected to 18 + Phase 7 gained 07-05 line + 7th success criterion). Decision 10-17-A: AR is IN scope, sourced from corporate/house accounts, split Phase 10 (10-18)/Phase 7 (07-09). Verified via grep that no residual "descoped" claim contradicts the decision; no source code touched.
Also stopped at (parallel plan): Completed 10-10-PLAN.md (Purchasing/finance list endpoints — `GET /api/v1/purchasing/purchase-orders`, `GET /api/v1/purchasing/invoices`, `GET /api/v1/finance/expenses`, all tenant/branch-scoped via `TenantContext` (never a request param), `@PreAuthorize`-gated with existing permissions (`vendor.view`/`finance.journal.view`, no new permission rows), plain non-paginated `ApiResponse<List<Dto>>`) — commits 23a6339 (Task 1: PO list), 3378973 (Task 2: invoice list), 0bb66b5 (Task 3: expense list + `PurchasingListEndpointsIT` + `ExpenseApprovalIT` extension). 10-09's `everyPublicEndpointIsGated` reflection guard passed unchanged, proving the 3 new endpoints arrived gated correctly. `mvn verify`: purchasing-service full suite green (38+6/44 incl. new IT); finance-service `ExpenseApprovalIT` green 5/5 — only the 3 pre-existing "Branch context required" IT classes fail (unchanged scope, documented below). This is the backend prerequisite 10-12/10-13/10-14 need for their list pages; response contract documented in 10-10-SUMMARY.md.
Also stopped at (parallel plan): Completed 10-08-PLAN.md (Real-OPA integration tests for PO approve/close + expense approve — `PurchasingOpaPolicyIT` (6 tests) + `ExpenseOpaPolicyIT` (4 tests), both running against a real `openpolicyagent/opa:1.17.1` Testcontainer evaluating the real `policies/` bundle, replacing the mocked `AuthorizationClient` seam that hid the 10-07 action-string mismatch) — commits 7b4deb2 (Task 1: purchasing), 3f675f7 (Task 2: finance). Negative control performed twice (once per service): reverting the 10-07 action-string fix to the dotted permission code turns the allow test red both times (`ApprovalLimitExceededException`/`ExpenseApprovalLimitExceededException`), restoring it turns green. Decision 10-08-A: a `@Primary @Bean AuthorizationClient` real-OPA bean does not work in either service's Spring test context (MockitoBean forces primary in purchasing; Feign proxies are primary-by-default in finance) — both new ITs instead delegate an existing `@MockitoBean` to a manually-constructed real client via Mockito's `thenAnswer`, never stubbed with a canned answer. Full purchasing-service `mvn verify`: 50/50 green. Full finance-service `mvn verify`: 24 ran, 18 passed, only the 3 pre-existing "Branch context required" IT classes fail (unchanged, unrelated).
Also stopped at (parallel plan): Completed 10-12-PLAN.md (PO user journey — list page, create-PO dialog, full status-conditional action bar on PO detail (submit/approve/reject/withdraw/send), per-line goods receipt rewrite, 6-test MSW round-trip suite) — commits 147d6e1 (Task 1: data layer), be249de (Task 2: list/create/detail-actions UI), 65cea59 (Task 3: per-line receipt + journey test). Closes UAT gaps 2/3/12/13 in code; the plan's real-click-path acceptance criterion was NOT performed this session (no running backend services, no browser tool — see Blockers/Concerns and 10-12-SUMMARY.md Issues Encountered) and remains an open verification item. Decisions 10-12-A..E recorded above, including a latent `apiPoLineSchema.qty` type-mismatch bug fix and a note on two non-destructive git-race recoveries caused by a concurrent sibling executor (10-14) sharing this session's working tree.
Also stopped at (parallel plan): Completed 10-14-PLAN.md (FIN-05 frontend — expense create/approve/reject inbox at `/app/finance/expenses` + AP aging report at `/app/finance/ap-aging`, finance module tab bar (previously none existed), Zod schema/adapter/repository/hooks for both, 7-test MSW journey suite) — commits b34e200 (Task 1: data layer), 9e2202b (Task 2: expenses page + nav tabs), b0052bd (Task 3: AP aging page + journey test). Closes UAT gaps 9/16 in code. Decisions 10-14-A..E recorded above, including two plan-prose-vs-Java-DTO corrections (`rejectReason` field name, no invoice-count on AP aging buckets) and the real MSW-round-trip pattern used since a genuine browser click-path was blocked by an unrelated, already-unhealthy shared dev backend stack (gateway RabbitMQ auth failure, finance-service stale-jar `NoClassDefFoundError`) — see Blockers/Concerns and 10-14-SUMMARY.md Issues Encountered. Two git-race recoveries during commit (sibling files swept into the index between `git add`/`git commit`) fixed non-destructively via `git reset --soft HEAD~1` + pathspec-scoped `git commit -- <exact paths>`.
Also stopped at (parallel plan): Completed 10-13-PLAN.md (Vendor invoice + AP payment user journey — invoice list page (first inbound link `invoices/[id]` ever had), `VendorInvoiceFormDialog` (first caller of the previously-dead `PurchasingRepository.createInvoice`), `OverrideMatchDialog` (first consumer of `POST /invoices/{id}/override-match`), AP payments page + `ApPaymentDialog` (first consumer of `POST /api/v1/purchasing/payments`), 4-test MSW journey suite) — commits a0aaded (Task 1: data layer), 58f5647 (Task 2: invoice list/book/override UI), 8f6f765 (Task 3: payments page + journey test). Closes UAT gaps 4/5/6/7/8 in code. Decisions 10-13-A..H recorded above, including two write-payload shape corrections against the real Java DTOs (neither `CreateVendorInvoiceRequest` nor `CreateApPaymentRequest` carries `vendorId`/`branchId`, contradicting the plan's own context block), a `LineMatchStatus` vocabulary correction, and confirmation there is no partial-AP-payment support server-side. Real click-path NOT performed this session — shared backend stack (started by a concurrent sibling agent) reported DOWN health at check time; see Blockers/Concerns.
Completed 10-18-PLAN.md (FINAL plan in Phase 10's gap-closure wave — Accounts Receivable / house-corporate-account sub-ledger + internal POS-charge seam) — commits ce326c9 (Task 1: Flyway V6 customer_accounts + ar_transactions + entities + finance.ar.view/manage permissions), f24fa0d (Task 2: ArService + public AR API + THE PHASE 7 SEAM `POST /internal/finance/ar/charges` + real-Postgres ITs with 2 watched-RED negative controls + finance-service's first `@PreAuthorize` reflection guard), 8699b91 (Task 3: House Accounts + AR Aging frontend pages, extending 10-14's four-layer Finance data layer, 8-test MSW journey suite). Decisions 10-18-A..F recorded above. Full finance-service `mvn verify`: 40 ITs, 34 pass, only the same 3 pre-existing "Branch context required" failures remain unchanged. Real click-path NOT completed — blocked by a pre-existing, stack-wide `FEATURE_DISABLED` gateway response affecting every module (confirmed via real login + real JWT + real gateway routing, not an MSW claim); see Blockers/Concerns and 10-18-SUMMARY.md. **Phase 10's entire gap-closure wave (10-07..10-18) is now fully executed** — next step is a phase-level UAT/verification re-pass, not another execution plan.
Resume file: None
