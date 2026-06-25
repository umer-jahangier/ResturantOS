# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-22)

**Core value:** A restaurant tenant can run operations end-to-end — POS order → inventory depletion → balanced double-entry JE — with strict tenant/branch isolation and no accounting imbalance.
**Current focus:** Phase 4 — Frontend Shell & CI/CD

## Current Position

Phase: 4 of 12 (Frontend Shell & CI/CD)
Plan: 8 of 8 (gap-closure wave 3 complete — DS-05, DS-06, DS-07 all closed)
Status: Phase 4 complete (all 8 plans executed; DS-01..07 gap-closure done)
Last activity: 2026-06-26 — Completed 04-07-PLAN.md (DS-05 shell chrome: collapsible sidebar, TopBar, MobileBottomNav, DS-06 theme injection, DS-07 ThemeToggle mount)

Progress: [██████████████████░] 55% (18/33 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 13
- Phase 1: 4/4 plans executed; verification gaps_found (4/5) — SC5 gap open
- Phase 2: 3/3 plans executed; verification passed (5/5)
- Phase 3: 3/3 plans executed; verification passed (24/24)
- Phase 4: 8/8 plans executed; verification passing (tsc/lint/build green, gap-closure DS-01..07 all closed)

**By Phase:**

| Phase | Plans | Verify |
|-------|-------|--------|
| 01-infrastructure-foundation-shared-library | 4/4 | 4/5 gaps_found |
| 02-authentication-authorization | 3/3 | 5/5 passed |
| 03-api-gateway-platform-admin-tenant-user-management | 3/3 | 24/24 passed |
| 04-frontend-shell-ci-cd | 3/3 | 16/16 passed (UAT) |

**Recent Trend:**
- Last 5 plans: 03-02, 04-01, 04-02, 04-03
- Trend: Phase 4 complete — frontend shell + login/guards/BranchSwitcher, then quality-gated CI/CD (lint→test→build(cosign multi-arch)→schema-sync, data-driven coverage gates, Playwright scaffold). Sprint-1 "GO" CI set delivered.

*Updated after each plan completion*

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

### Pending Todos

- **Plan + execute the Phase-4 design-system shell gap-closure (DS-01..07):** `/gsd-plan-phase 4 --gaps` → reads 04-VERIFICATION.md `gaps:` (DS-SHELL-01..07) → creates `gap_closure: true` plans (04-04+) → `/gsd-execute-phase 4 --gaps-only`. New deps land in `frontend/package.json`: framer-motion, recharts, react-countup, cmdk, date-fns, react-dropzone, @tanstack/react-virtual, @tanstack/react-table, colorjs.io.
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

## Session Continuity

Last session: 2026-06-26
Stopped at: Completed 04-07-PLAN.md — Collapsible grouped Sidebar (brand area, collapse toggle, badges, tooltips), TopBar (breadcrumb/⌘K/notifications/ThemeToggle/profile), MobileBottomNav (5 guarded icons), integrated tenant layout (Suspense skeleton, DS-06 theme CSS injection); DS-05/06/07 all closed; tsc/lint/build green.
Resume file: None
