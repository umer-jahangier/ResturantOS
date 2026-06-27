---
phase: 06-finance-core-general-ledger-periods
plan: "02"
subsystem: finance
tags:
  - java
  - spring-boot
  - jpa
  - feign
  - totp
  - testcontainers
  - react
  - nextjs
  - tanstack-query
  - tailwind
  - accounting-periods

dependency-graph:
  requires:
    - "06-01: finance-service scaffold, JE engine, GL service, COA seeding"
  provides:
    - "12-period seeding for Pakistan FY (Jul-Jun) via provisioning endpoint"
    - "Period close/lock with TOTP gate (X-TOTP-Verified header)"
    - "Feign stubs for POS/Inventory/Purchasing pre-close checks"
    - "GET /api/v1/finance/periods, POST /{id}/close, GET /internal/periods/current"
    - "7 Finance frontend pages at /app/finance/{accounts,accounts/[code],journal-entries,journal-entries/new,journal-entries/[id],gl,periods}"
    - "8 Finance components: DrCrCell, PeriodStatusChip, JournalEntryTable (keyboard nav), JournalEntryForm, AccountTable, GeneralLedger, PeriodCloseModal, FinanceEmptyState"
    - "4-layer API abstraction: Zod schemas -> repository -> hooks -> components"
  affects:
    - "Phase 7 (POS): implement PosInternalClient.getOpenOrderCount() real endpoint"
    - "Phase 8 (Inventory): implement InventoryInternalClient.getPendingGrnCount() real endpoint"
    - "Phase 10 (Purchasing): implement PurchasingInternalClient.getUnmatchedInvoiceCount() real endpoint"

tech-stack:
  added:
    - "Feign circuit breaker fallbacks (POS/Inventory/Purchasing stubs)"
  patterns:
    - "TOTP gate via request header (X-TOTP-Verified) read in controller, validated in service"
    - "Feign stub pattern: @FeignClient + fallback returning 0 for Phase-6 pre-checks"
    - "React 4-layer: Zod schema -> repository -> TanStack Query hook -> component (ESLint-enforced)"
    - "DrCrCell: font-mono tabular-nums w-32 text-right for all monetary display (DS 7.4)"
    - "PeriodStatusChip: explicit Tailwind color classes per status (OPEN=emerald, LOCKED=amber)"

key-files:
  created:
    - "services/finance-service/src/main/java/io/restaurantos/finance/service/AccountingPeriodService.java"
    - "services/finance-service/src/main/java/io/restaurantos/finance/service/AccountingPeriodServiceImpl.java"
    - "services/finance-service/src/main/java/io/restaurantos/finance/service/PeriodCloseService.java"
    - "services/finance-service/src/main/java/io/restaurantos/finance/dto/AccountingPeriodDto.java"
    - "services/finance-service/src/main/java/io/restaurantos/finance/mapper/PeriodMapper.java"
    - "services/finance-service/src/main/java/io/restaurantos/finance/web/PeriodController.java"
    - "services/finance-service/src/main/java/io/restaurantos/finance/feign/PosInternalClient.java"
    - "services/finance-service/src/main/java/io/restaurantos/finance/feign/PosInternalClientFallback.java"
    - "services/finance-service/src/main/java/io/restaurantos/finance/feign/InventoryInternalClient.java"
    - "services/finance-service/src/main/java/io/restaurantos/finance/feign/InventoryInternalClientFallback.java"
    - "services/finance-service/src/main/java/io/restaurantos/finance/feign/PurchasingInternalClient.java"
    - "services/finance-service/src/main/java/io/restaurantos/finance/feign/PurchasingInternalClientFallback.java"
    - "services/finance-service/src/main/java/io/restaurantos/finance/exception/TotpRequiredException.java"
    - "services/finance-service/src/main/java/io/restaurantos/finance/exception/PeriodAlreadyLockedException.java"
    - "services/finance-service/src/main/java/io/restaurantos/finance/exception/PeriodPreCheckException.java"
    - "services/finance-service/src/main/java/io/restaurantos/finance/exception/PeriodNotFoundException.java"
    - "services/finance-service/src/test/java/io/restaurantos/finance/AccountingPeriodIT.java"
    - "services/finance-service/src/test/java/io/restaurantos/finance/PeriodCloseServiceUnitTest.java"
    - "services/finance-service/src/test/resources/application.yml"
    - "frontend/lib/api-client/schemas/finance.schema.ts"
    - "frontend/lib/models/finance.model.ts"
    - "frontend/lib/adapters/finance.adapter.ts"
    - "frontend/lib/repositories/finance.repository.ts"
    - "frontend/lib/hooks/finance/use-accounts.ts"
    - "frontend/lib/hooks/finance/use-journal-entries.ts"
    - "frontend/lib/hooks/finance/use-periods.ts"
    - "frontend/lib/hooks/finance/use-gl.ts"
    - "frontend/components/finance/DrCrCell.tsx"
    - "frontend/components/finance/PeriodStatusChip.tsx"
    - "frontend/components/finance/FinanceEmptyState.tsx"
    - "frontend/components/finance/AccountTable.tsx"
    - "frontend/components/finance/JournalEntryTable.tsx"
    - "frontend/components/finance/JournalEntryForm.tsx"
    - "frontend/components/finance/GeneralLedger.tsx"
    - "frontend/components/finance/PeriodCloseModal.tsx"
    - "frontend/app/(tenant)/app/finance/accounts/page.tsx"
    - "frontend/app/(tenant)/app/finance/accounts/[code]/page.tsx"
    - "frontend/app/(tenant)/app/finance/journal-entries/page.tsx"
    - "frontend/app/(tenant)/app/finance/journal-entries/new/page.tsx"
    - "frontend/app/(tenant)/app/finance/journal-entries/[id]/page.tsx"
    - "frontend/app/(tenant)/app/finance/gl/page.tsx"
    - "frontend/app/(tenant)/app/finance/periods/page.tsx"
  modified:
    - "services/finance-service/src/main/java/io/restaurantos/finance/repository/AccountingPeriodRepository.java"
    - "services/finance-service/src/main/java/io/restaurantos/finance/service/ProvisioningService.java"
    - "services/finance-service/src/main/java/io/restaurantos/finance/service/JournalEntryServiceImpl.java"
    - "services/finance-service/src/main/java/io/restaurantos/finance/exception/FinanceGlobalExceptionHandler.java"
    - "services/finance-service/src/main/java/io/restaurantos/finance/config/FinanceSecurityConfig.java"
    - "services/finance-service/src/test/java/io/restaurantos/finance/FinanceTestBase.java"
    - "services/finance-service/src/test/java/io/restaurantos/finance/JournalEntryBalanceTriggerIT.java"
    - "services/finance-service/src/test/java/io/restaurantos/finance/JournalEntryImmutabilityIT.java"
    - "services/finance-service/src/test/java/io/restaurantos/finance/JournalEntryServiceUnitTest.java"
    - "frontend/lib/hooks/query-keys.ts"

decisions:
  - id: "06-02-A"
    description: "Pakistan FY formula: period 1 = July of (fiscalYear-1). Month = ((6 + periodNo - 1) % 12) + 1. Year = startCalYear for periods 1-6 (Jul-Dec), fiscalYear for periods 7-12 (Jan-Jun)"
  - id: "06-02-B"
    description: "TOTP gate via header-only in Phase 6. PeriodController reads X-TOTP-Verified=true; real TOTP verification integrated in Phase 2 auth-service step-up (02-02)"
  - id: "06-02-C"
    description: "Feign pre-close stubs return 0 with TODO comments for Phase 7/8/10. Circuit breaker fallback enabled via spring.cloud.openfeign.circuitbreaker.enabled=true"
  - id: "06-02-D"
    description: "Frontend layer architecture: Zod schema (api-client/schemas) → adapter → repository → TanStack Query hook → component. Matches existing auth pattern. ESLint boundary: components must not import repositories/api-client directly"
  - id: "06-02-E"
    description: "TenantContext cleared in ProvisioningService.provision() finally block — integration tests re-set context after each provision() call"
  - id: "06-02-F"
    description: "Frontend pages at /app/finance/* (not /dashboard/finance/*) — tenant app route group is (tenant)/app/ per proxy.ts PROTECTED=['/platform','/app']"

metrics:
  duration: "~60 minutes"
  completed: "2026-06-27"

---

# Phase 6 Plan 02: Accounting Periods + Period Close + Finance Frontend Summary

**One-liner:** 12-period Pakistan FY seeding + TOTP-gated close/lock with Feign stubs, plus 7 finance pages and 8 components following DS §7.4 (font-mono/tabular-nums, PeriodStatusChip, keyboard nav).

## What Was Built

### Task 1: Backend — Accounting Period Service + Close/Lock + Feign Stubs

**Accounting Period Seeding (`AccountingPeriodServiceImpl.seedForTenant`):**
- Pakistan FY formula: period 1 = July `fiscalYear-1`, period 12 = June `fiscalYear`
- `month = ((6 + periodNo - 1) % 12) + 1` — verified: P1→7, P6→12, P7→1, P12→6
- Idempotent: `existsByTenantIdAndFiscalYearAndPeriodNo` prevents duplicates
- Tenant-aware: all repository methods prefixed with `findByTenantIdAnd...`

**Period Close Service (`PeriodCloseService.close`):**
- TOTP gate: `totpVerified=false` → throws `TotpRequiredException` → 403 `TOTP_REQUIRED`
- Already-locked check: → 409 `PERIOD_ALREADY_LOCKED`
- Pre-close Feign checks: POS open orders, Inventory pending GRNs, Purchasing unmatched invoices
- All three stubs return `0` in Phase 6 (TODO Phase 7/8/10)
- On success: sets `status=LOCKED`, `lockedBy`, `lockedAt`

**Period Controller endpoints:**
- `GET /api/v1/finance/periods` → list by fiscalYear and/or status
- `GET /api/v1/finance/periods/{id}` → single period
- `POST /api/v1/finance/periods/{id}/close` → TOTP-gated close
- `GET /internal/periods/current?tenantId=` → current OPEN period (no OPA)

**Feign Stubs (Phase 6):**
- `PosInternalClient.getOpenOrderCount()` → fallback returns `0L`
- `InventoryInternalClient.getPendingGrnCount()` → fallback returns `0L`
- `PurchasingInternalClient.getUnmatchedInvoiceCount()` → fallback returns `0L`
- Circuit breaker enabled: `spring.cloud.openfeign.circuitbreaker.enabled=true`

**Tests (all green):**
- `AccountingPeriodIT` (5 tests): seed 12 periods, idempotency, close happy path, 423 on locked period, 403 without TOTP
- `PeriodCloseServiceUnitTest` (3 tests): stubs=0 → success, POS returns 5 → precheck fails, totpVerified=false → TotpRequired

### Task 2: Frontend — 7 Finance Pages + 8 Components

**4-Layer Architecture (ESLint-enforced):**
1. `lib/api-client/schemas/finance.schema.ts` — Zod schemas (AccountDto, JournalEntryDto, AccountingPeriodDto, GlBalanceDto)
2. `lib/adapters/finance.adapter.ts` + `lib/repositories/finance.repository.ts` — parse + adapt
3. `lib/hooks/finance/use-*.ts` — TanStack Query hooks
4. `components/finance/*.tsx` + `app/(tenant)/app/finance/**` — UI layer

**Design System §7.4 compliance:**
- `DrCrCell`: `font-mono tabular-nums w-32 text-right` for all debit/credit columns
- `PeriodStatusChip`: `bg-emerald-100 text-emerald-800` (OPEN), `bg-amber-100 text-amber-800` (LOCKED)
- `JournalEntryTable`: `tabIndex=0` on rows, `onKeyDown` handler (Enter→detail, E→export stub)
- `GeneralLedger`: click net balance → `/app/finance/accounts/[code]?periodId=...`
- `MoneyDisplay` reused inside `DrCrCell`

**Pages:**
| URL | Page | Component |
|-----|------|-----------|
| `/app/finance/periods` | Periods list | PeriodStatusChip + PeriodCloseModal |
| `/app/finance/accounts` | COA table | AccountTable (type filter) |
| `/app/finance/accounts/[code]` | Account detail | Account metadata + status badge |
| `/app/finance/journal-entries` | JE list | JournalEntryTable (keyboard nav) |
| `/app/finance/journal-entries/new` | New JE form | JournalEntryForm (DR=CR live check) |
| `/app/finance/journal-entries/[id]` | JE detail | DrCrCell lines + Post/Reverse buttons |
| `/app/finance/gl` | General Ledger | GeneralLedger (period selector + drill-down) |

**Build verification:**
- `pnpm build` exits 0 ✓
- `pnpm lint` 0 errors (1 pre-existing warning in data-table.tsx) ✓

## Deviations from Plan

### Auto-fixed Issues (from prior session — carried through)

**[Rule 3 - Blocking] Frontend path mismatch**
- **Found during:** Task 2 setup
- **Issue:** Plan referenced `apps/web/src/...` paths; actual project has `frontend/` at root with structure `lib/api-client/`, `lib/repositories/`, `lib/hooks/`, `components/`, `app/(tenant)/app/`
- **Fix:** Mapped all plan paths to the actual project structure, following the existing 4-layer architecture (Zod → adapter → repository → hook → component) rather than the plan's simplified `lib/api/` → `lib/queries/` description
- **Files modified:** All frontend files created at correct paths

**[Rule 1 - Bug] TenantContext cleared in ProvisioningService.provision() finally block**
- **Found during:** Task 1 integration tests
- **Issue:** `provision()` clears `TenantContext` in its `finally` block; test methods that called `provisioningService.provision()` lost tenant context for subsequent assertions
- **Fix:** Added `tenantContext.set(tenantId, null, null, null)` after each `provision()` call in `AccountingPeriodIT`
- **Commit:** `67eef48`

**[Rule 3 - Blocking] FinanceSecurityConfig missing JwksKeyProvider and JwtAuthenticationFilter beans**
- **Found during:** Task 1 test context startup
- **Issue:** `finance-service` had no `@Bean` definitions for security beans, causing `NoSuchBeanDefinitionException`
- **Fix:** Added `@Bean` methods for `JwksKeyProvider` and `JwtAuthenticationFilter` in `FinanceSecurityConfig`; broke circular dependency by injecting `JwtAuthenticationFilter` as method parameter to `securityFilterChain`
- **Commit:** `67eef48`

**[Rule 3 - Blocking] Flyway not running in test context**
- **Found during:** Task 1 integration tests
- **Issue:** Spring's auto-configured Flyway didn't run before test context load → `relation "chart_of_accounts" does not exist`
- **Fix:** Added explicit `@BeforeAll applyMigrations()` in `FinanceTestBase` using `Flyway.configure().clean().migrate()`; disabled Spring's Flyway in test via `spring.flyway.enabled=false`
- **Commit:** `67eef48`

## Decisions Made

| ID | Decision |
|----|----------|
| 06-02-A | Pakistan FY formula: `month = ((6 + periodNo - 1) % 12) + 1`; P1=Jul, P12=Jun |
| 06-02-B | TOTP gate via header only in Phase 6; real step-up from Phase 2 auth-service (02-02) |
| 06-02-C | Feign pre-close stubs return 0 with TODO Phase 7/8/10; circuit breaker enabled |
| 06-02-D | Frontend follows existing 4-layer pattern (Zod→adapter→repository→hook→component) |
| 06-02-E | Integration tests re-set TenantContext after provision() calls due to finally-block clearing |
| 06-02-F | Finance pages at `/app/finance/*` matching existing tenant app route group `/app/*` |

## Next Phase Readiness

Phase 6 is now complete. The following are ready for Phase 7+ work:
- Feign stubs are stubbed at `0` with clear TODO comments pointing to implementing phases
- All 7 finance pages are accessible at `/app/finance/*`
- The Period close TOTP flow requires the Phase 2 auth step-up to be wired (currently header-only stub)
- `/internal/periods/current?tenantId=` endpoint ready for POS auto-posting (Phase 7)
