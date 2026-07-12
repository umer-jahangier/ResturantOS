# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-22)

**Core value:** A restaurant tenant can run operations end-to-end — POS order → inventory depletion → balanced double-entry JE — with strict tenant/branch isolation and no accounting imbalance.
**Current focus:** Phase 10 REOPENED, gap-closure wave in progress (11 plans, 10-07..10-17, 4 waves). 10-07 (wave 1) closed the root blocker: OPA action-string mismatch that made every real PO/expense approval return DENY. Waves 2-4 (10-08..10-17) remain: real-OPA ITs, @PreAuthorize gating, frontend journeys, VendorService encryption.

## Current Position

Phase: 10 of 12 (Purchasing & Accounts Payable) — REOPENED (UAT code audit found 10 gaps, 4 blockers)
Plan: 07 of 17 (gap-closure wave 1 of 4; 10-08..10-17 remain)
Status: 10-07 complete — canonical OPA action vocabulary adopted (rego short verbs), vendor.rego hardened with approval-limit comparison + close_po rule, distinct-approver constraint added to PoApprovalService, opa test policies/ green at 100% coverage (92/92). Plan 10-08 (real-OPA ITs proving this fix) next.
Last activity: 2026-07-13 — Completed 10-07 (OPA action-string mismatch fix + vendor.rego hardening + distinct-approver constraint — 3 tasks, 3 commits, ac63925/4e7b061/625b1fd)

Progress: [███████████████░░░░░░░] 52% (23/44 plans)

## Performance Metrics

**Velocity:**

- Total plans completed: 22
- Phase 1: 4/4 plans executed; verification gaps_found (4/5) — SC5 gap open
- Phase 2: 3/3 plans executed; verification passed (5/5)
- Phase 3: 3/3 plans executed; verification passed (24/24)
- Phase 4: 8/8 plans executed; verification passed (16/16 FE + 7/7 DS gap-closure; tsc/lint/vitest green)
- Phase 6: 2/2 plans executed (COMPLETE — periods + close/lock + Finance frontend)
- Phase 10: 7/17 plans executed (REOPENED, gap-closure wave 1 of 4 in progress — 10-07 fixed the OPA action-string mismatch root blocker)

**By Phase:**

| Phase                                                | Plans | Verify                                               |
| ---------------------------------------------------- | ----- | ---------------------------------------------------- |
| 01-infrastructure-foundation-shared-library          | 4/4   | 4/5 gaps_found                                       |
| 02-authentication-authorization                      | 3/3   | 5/5 passed                                           |
| 03-api-gateway-platform-admin-tenant-user-management | 3/3   | 24/24 passed                                         |
| 04-frontend-shell-ci-cd                              | 8/8   | 16/16 FE + 7/7 DS passed                             |
| 06-finance-core-general-ledger-periods               | 2/2   | complete                                             |
| 10-purchasing-accounts-payable                       | 7/17  | gap-closure in progress (10-07 done; 10-08..10-17 remain) |

**Recent Trend:**

- Last completed plan: 10-07
- Trend: Gap-closure wave 1 started. 10-07 fixed the root blocker (action-string mismatch masking every real OPA approval as DENY) and hardened vendor.rego with an approval-limit comparison + close_po rule; opa test policies/ green at 100% coverage (92/92, up from 82). Also fixed two unrelated pre-existing issues blocking that gate: a kds.rego action-guard bug and missing finance_test.rego coverage for manage_coa/view_journal. A pre-existing, out-of-scope finance-service IT failure (Branch context required in JournalEntryServiceImpl, 6 tests) was identified but left for a future gap-closure item. Plan 10-08 (real-OPA ITs) next.

_Updated after each plan completion_

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
- [10-07-A]: Canonical OPA action vocabulary is the rego short verb (`approve_po`, `close_po`, `approve`), not the dotted permission code. purchasing-service/finance-service Feign `AuthorizationClient` calls were sending `vendor.po.approve`/`vendor.po.close`/`finance.expense.approve` (permission-code shape) while every rego module keys on short verbs with `default allow := false` — every real PO/expense approval silently DENYed in production, masked because `PurchaseOrderApprovalIT`/`ExpenseApprovalIT` `@MockitoBean` the `AuthorizationClient`. Fixed by changing the 3 Java call sites (`OPA_ACTION_*` constants) rather than rewriting 5 rego modules + test suites. Dotted permission codes are unchanged and remain what `common.has_permission`/`@PreAuthorize` check.

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

## Session Continuity

Last session: 2026-07-13
Stopped at: Completed 10-07-PLAN.md (OPA action-string mismatch fix + vendor.rego hardening + distinct-approver constraint) — commits ac63925 (action vocabulary), 4e7b061 (vendor.rego + kds.rego + finance_test.rego), 625b1fd (distinct-approver constraint). opa test policies/ green at 100% coverage (92/92). Plan 10-08 (real-OPA integration tests proving this fix) is next.
Resume file: None
