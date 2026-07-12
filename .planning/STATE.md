---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 07.3
current_phase_name: pos-kitchen-production-bug-fixes-ux-revamp
status: executing
stopped_at: Completed 07.3-05-PLAN.md
last_updated: "2026-07-12T14:32:54.390Z"
last_activity: 2026-07-12
last_activity_desc: Completed 07.3-05-PLAN.md
progress:
  total_phases: 15
  completed_phases: 7
  total_plans: 59
  completed_plans: 52
  percent: 47
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-22)

**Core value:** A restaurant tenant can run operations end-to-end — POS order → inventory depletion → balanced double-entry JE — with strict tenant/branch isolation and no accounting imbalance.
**Current focus:** Phase 07.3 — pos-kitchen-production-bug-fixes-ux-revamp

## Current Position

Phase: 07.3 (pos-kitchen-production-bug-fixes-ux-revamp) — EXECUTING
Plans: 10 plans across 3 waves — 7/10 complete (07.3-01 done: PaymentStatus derivation,
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
pre-existing S4 fire-toast timing gap, both out of scope, logged in deferred-items.md)
Status: Executing Phase 07.3
Last activity: 2026-07-12 — Completed 07.3-05-PLAN.md

Phase 07.2 (finance-accounting-period-provisioning-guarantee-open-period) — 6/7 plans complete
(07.2-01, 07.2-02, 07.2-03, 07.2-04, 07.2-05, 07.2-07 done; 07.2-06 IN PROGRESS — Task 1/2 done,
Task 2 blocking human-verify checkpoint AWAITING USER, unrelated to Phase 07.3)

Phase 07 (point-of-sale-kitchen-display) — COMPLETE (8/8 plans; verification human_needed, recommended complete)

## Performance Metrics

**Velocity:**

- Total plans completed: 27
- Phase 1: 4/4 plans executed; verification gaps_found (4/5) — SC5 gap open
- Phase 2: 3/3 plans executed; verification passed (5/5)
- Phase 3: 3/3 plans executed; verification passed (24/24)
- Phase 4: 8/8 plans executed; verification passed (16/16 FE + 7/7 DS gap-closure; tsc/lint/vitest green)
- Phase 6: 2/2 plans executed (COMPLETE — periods + close/lock + Finance frontend)

**By Phase:**

| Phase | Plans | Verify |
|-------|-------|--------|
| 01-infrastructure-foundation-shared-library | 4/4 | 4/5 gaps_found |
| 02-authentication-authorization | 3/3 | 5/5 passed |
| 03-api-gateway-platform-admin-tenant-user-management | 3/3 | 24/24 passed |
| 04-frontend-shell-ci-cd | 8/8 | 16/16 FE + 7/7 DS passed |
| 06-finance-core-general-ledger-periods | 2/2 | complete |
| 07-point-of-sale-kitchen-display | 4/4 | pending phase verify |

**Recent Trend:**

- Last completed plan: 07-04
- Trend: Phase 7 complete — pos-service (orders/tills/payments/ORDER_CLOSED), offline PWA (IndexedDB outbox + FIFO sync), kitchen-service (station routing + ORDER_READY), KITCHEN_STAFF role isolation, always-dark WebSocket KDS board with sidebar gating. KDS vitest 6/6 green.

*Updated after each plan completion*
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
- [06-02-D]: Frontend follows existing 4-layer pattern: Zod schema → adapter → repository → TanStack Query hook → component (ESLint-enforced by no-restricted-imports on components/**).
- [06-02-E]: Integration tests re-set TenantContext after provision() calls (finally block clears it); pattern: tenantContext.set(tenantId, null, null, null) after each provision().
- [06-02-F]: Finance pages at /app/finance/* (tenant route group is (tenant)/app/*); proxy.ts PROTECTED=['/platform','/app'].
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
- kitchen-service Testcontainers ITs (incl. new TicketRevisionRoutingIT) currently blocked by a pre-existing RabbitMQ ACCESS_REFUSED auth conflict on localhost:5672, confirmed environmental (baseline TicketRoutingIT fails identically). Human/CI run needed in an env without a competing local RabbitMQ broker.
- **Phase 07.2 Wave 1 post-merge gate findings (pre-existing, NOT caused by 07.2-01..05):** (1) auth-service `BranchSwitchIT`/`RefreshLogoutIT`/`StepUpLoginIT`/`TotpFlowIT` fail with 401/403 mismatches when run as part of the FULL auth-service suite but pass cleanly (0 failures) when run in isolation — a pre-existing test-order/shared-context flakiness, confirmed unrelated to this phase (of these 4 files were touched by any 07.2 plan; last touched 2026-06-24 in Phase 2). (2) finance-service `JournalEntryImmutabilityIT`/`JournalEntryBalanceTriggerIT`/`InternalAutoPostIT` fail with `IllegalStateException: Branch context required` — reproduced identically on the pre-phase-07.2 baseline commit (71925f5) via a throwaway worktree, confirming this predates the phase entirely (`JournalEntryServiceImpl.java` last touched in Phase 6, untouched by 07.2). (3) platform-admin-service's Testcontainers IT suite failed to bootstrap its Docker client strategy (`TestcontainersHostPropertyClientProviderStrategy could not be instantiated`) specifically in the orchestrator's own shell session — `docker ps` works fine directly, and each of plans 07.2-02/03/04/05's own executor sessions already ran their scoped Testcontainers-based tests green moments earlier on the same host, so this reads as a session-level Docker/Testcontainers bootstrap quirk, not a code defect. of these three findings blocked Wave 1 — `git diff --stat` confirmed only the 14 files owned by plans 02-05 changed. Recommend a human/CI run of the full three-service suite in a clean session before treating Phase 07.2 as fully verified (07.2-06 already restarts all three services + reruns the full suite as its Task 1, which should be the authoritative check).
- 07.2-07's live Playwright E2E run (finance-period-provisioning.spec.ts) was BLOCKED this session: finance-service process down / gateway 503 in the dev stack. Deferred to 07.2-06's restart-and-verify gate per plan.
- kitchen-service KdsController.getTickets: LazyInitializationException on unscoped GET (no @Transactional boundary) + unsorted/size=20 default Pageable lets accumulated stale PENDING test tickets (29+ on GRILL) push new tickets beyond page 1 -- blocks pos-kitchen-live-sync.spec.ts (POS-20) from a live PASS; out of scope for 07.3-06 (frontend-only), logged in 07.3 deferred-items.md
- 07.3-07 pos-settlement.spec.ts: S4 (pre-existing, unrelated - Send to Kitchen toast timing) and S7 (cascading) FAIL live on this dev branch; S5/S5b (new POS-22/23 charge-page assertions) correctly reach BLOCKED - POST /payments succeeds but GET /payments 503s at the gateway (same circuit-breaker gap as S2/S6). Recommend a re-run once these environmental gaps clear before treating POS-22/23 live UAT as fully closed.

### Roadmap Evolution

- Phase 07.1 inserted after Phase 7: POS Production Operations & Item-Level Kitchen Tracking — upgrade POS from MVP to production-ready restaurant operations (order management, table-centric dine-in, item-level status, kitchen ticket revisions, cashier UX) (URGENT)
- Phase 07.2 inserted after Phase 7: Finance accounting-period provisioning — fixes silently-swallowed CoA/period seeding at tenant onboarding, adds self-service open-period endpoint, resolves parent-07 UAT blocker (423 PERIOD_LOCKED on fresh tenants) (URGENT)

## Session Continuity

Last session: 2026-07-12T14:32:54.370Z
Stopped at: Completed 07.3-05-PLAN.md
Resume file: None
