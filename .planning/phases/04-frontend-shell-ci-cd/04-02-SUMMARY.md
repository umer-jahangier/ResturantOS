---
phase: 04-frontend-shell-ci-cd
plan: 02
subsystem: ui
tags: [nextjs16, react19, typescript, react-hook-form, zod, tanstack-query, zustand, jwt, msw, vitest, shadcn, lucide]

# Dependency graph
requires:
  - phase: 04-frontend-shell-ci-cd
    provides: "wave-1 shell — api-client/repository/hook/query-key/session/JWT-decode/MSW contracts; auth error-code guards; route-group + proxy structure (04-01)"
  - phase: 02-authentication-authorization
    provides: "live auth contract — login body {email,password,tenantSlug,totpCode?}, conditional-TOTP step-up, switch-branch JWT reissue, error codes"
provides:
  - "Login page: tenant-slug resolution (subdomain/?tenant=, awaited searchParams) + conditional-TOTP reveal+resubmit + live error mapping (FE-04)"
  - "PermissionGuard (decoded-JWT claims) + FeatureGuard (useFeatureFlags, D4) (FE-06)"
  - "Permission/feature-conditioned Sidebar composing both guards per nav item (FE-05)"
  - "BranchSwitcher: switch-branch JWT reissue → setSession → queryClient.clear(); BRANCH_ACCESS_DENIED handled without mutating session (FE-05, W3)"
  - "useCurrentUser / useFeatureFlags / useSwitchBranch Layer-3 hooks"
  - "Hand-rolled createZodResolver (no @hookform/resolvers dep)"
  - "MSW-backed Vitest suite: login conditional-TOTP, error mapping, branch-switch cache invalidation + denied path, guard visibility (FE-07 completion)"
affects: [04-03-ci-cd-e2e, future-module-phases]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Conditional-TOTP login: branch on the typed ApiError via inference (mutation onError) — components never import api-client (FE-08 boundary preserved)"
    - "Guards read in-memory JWT claims (PermissionGuard) and a branch-scoped useFeatureFlags query (FeatureGuard); FeatureGuard renders nothing while loading to avoid flash"
    - "Branch switch = setSession(reissued JWT) + queryClient.clear() (full clear is cheapest correct invalidation since all keys are branch-scoped)"
    - "Hand-rolled Zod→react-hook-form resolver to avoid adding a dependency owned by 04-03"

key-files:
  created:
    - frontend/lib/auth/tenant-slug.ts
    - frontend/lib/forms/zod-resolver.ts
    - frontend/components/auth/login-form.tsx
    - frontend/components/shared/permission-guard.tsx
    - frontend/components/shared/feature-guard.tsx
    - frontend/components/shared/sidebar.tsx
    - frontend/components/shared/sidebar-nav-items.ts
    - frontend/components/shared/branch-switcher.tsx
    - frontend/lib/hooks/auth/use-current-user.ts
    - frontend/lib/hooks/auth/use-feature-flags.ts
    - frontend/lib/hooks/auth/use-switch-branch.ts
    - frontend/__tests__/auth/login-form.test.tsx
    - frontend/__tests__/auth/branch-switcher.test.tsx
    - frontend/__tests__/shared/guards.test.tsx
    - frontend/__tests__/utils/auth-fixtures.ts
  modified:
    - frontend/app/(auth)/login/page.tsx
    - frontend/app/(tenant)/layout.tsx

key-decisions:
  - "FeatureGuard source = useFeatureFlags() → FeatureRepository.getFlags() (D4); flags are NOT in the JWT — gateway enforces server-side (403 FEATURE_DISABLED). Live /api/v1/feature-flags shape is a Phase-3 contract to confirm."
  - "Branch-switch invalidation = queryClient.clear() (full clear) rather than targeted per-key invalidation; documented for revisit."
  - "No separate active-branch store: the active branch IS session.branchId, set by setSession on the reissued JWT."
  - "Used a hand-rolled createZodResolver instead of @hookform/resolvers (package.json owned by 04-03)."
  - "Available branches in BranchSwitcher are a Phase-4 static stub; live list is a Phase-3 contract (e.g. /api/v1/branches)."

patterns-established:
  - "Components branch on ApiError guard methods via TanStack-mutation type inference — never import @/lib/api-client (FE-08 ESLint boundary stays green)."
  - "Nav config is a typed NavItem[] with optional permission+feature; Sidebar composes PermissionGuard(outer) + FeatureGuard(inner) per item."

# Metrics
duration: ~16min
completed: 2026-06-26
---

# Phase 4 Plan 02: Login UI, Guards & BranchSwitcher Summary

**Conditional-TOTP login (tenant-slug resolution + live UNAUTHENTICATED/ACCOUNT_LOCKED mapping), JWT-claims PermissionGuard + feature-flag FeatureGuard, a guard-composed Sidebar, and a BranchSwitcher that reissues the JWT and clears the branch-scoped query cache — all proven by an MSW-backed Vitest suite (21 tests green, coverage ≥60%, tsc/lint clean).**

## Performance

- **Duration:** ~16 min
- **Completed:** 2026-06-26
- **Tasks:** 3
- **Files created/modified:** 17

## Accomplishments
- **Login (FE-04, SC1 login half):** server page awaits `searchParams` + `headers()` (Next 16) and resolves the tenant slug from `?tenant=` or the leftmost subdomain label (ignoring `www`/apex/`localhost`/IP); falls back to an inline restaurant-identifier input when neither yields a slug. The client `LoginForm` (react-hook-form + Zod) submits `{email,password,tenantSlug,totpCode?}` via `useLogin`, reveals+focuses the TOTP field on `TOTP_REQUIRED` and resubmits (FD-2 O→P→Q→R), maps the **generic** `UNAUTHENTICATED`(401) (never leaking "suspended") and `ACCOUNT_LOCKED`(423), shows a `session_expired` notice, and `router.push('/app/dashboard')` on success.
- **Guards (FE-06, SC2):** `PermissionGuard` (require / mode=all|any / fallback) gates on decoded-JWT `permissions`; `FeatureGuard` gates on `useFeatureFlags()` and renders nothing while loading.
- **Sidebar (FE-05, SC2):** typed `/app/*` + `/platform/*` nav config; each item wrapped in `PermissionGuard` AND `FeatureGuard` (items with neither always show); active-route highlight via `usePathname`.
- **BranchSwitcher (FE-05, W3, SC2):** dropdown calls `useSwitchBranch` → `setSession(reissued JWT)` + `queryClient.clear()`; a 403 `BRANCH_ACCESS_DENIED` surfaces a toast + inline error and leaves session/active-branch/cache intact.
- **Tests (FE-07, SC2/SC3):** three MSW-backed specs + a session fixture prove conditional-TOTP, live error mapping, branch-switch cache invalidation, the denied path, and guard visibility.

## Task Commits

1. **Task 1: Login page + tenant-slug + conditional TOTP** — `fec497c` (feat)
2. **Task 2: Guards + hooks + Sidebar + BranchSwitcher + tenant layout** — `5bfa827` (feat)
3. **Task 3: MSW-backed Vitest specs** — `8fff0c4` (test)

**Plan metadata:** _(this docs commit)_

## Verification Results
- `corepack pnpm exec tsc --noEmit`: PASS (zero errors, zero `any`).
- `corepack pnpm run lint`: PASS (ESLint layer boundary — components import Layer-3 hooks only).
- `corepack pnpm exec vitest run`: PASS — 21 tests across 5 files.
- `corepack pnpm exec vitest run --coverage`: PASS — overall 68% stmts / 60.4% branches / 69.9% funcs / 68.4% lines; per-file thresholds (session.repository.ts, auth.adapter.ts ≥60%) satisfied.
- Task greps: `await searchParams`, `isTotpRequired`, `resolveTenantSlug`, `useFeatureFlags`, `permissions`, `queryClient.clear`, `BRANCH_ACCESS_DENIED`, and Sidebar referencing both guards — all present.

## Decisions Made
See `key-decisions` frontmatter. Headlines:
- **D4 resolved:** FeatureGuard uses `useFeatureFlags()` (proactive UI hiding); the gateway remains authoritative (403 `FEATURE_DISABLED`). The live `/api/v1/feature-flags` shape stays a **Phase-3 contract to confirm**.
- **Cache invalidation:** `queryClient.clear()` (full clear) chosen over targeted per-key invalidation — simplest correct option since every server-state key is branch-scoped; revisit if a partial-clear optimisation is wanted.
- **Branch source:** BranchSwitcher branches are a Phase-4 static stub (ids match the MSW handler); the live list is a Phase-3 contract (e.g. `/api/v1/branches`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `@hookform/resolvers` not installed (and package.json is owned by 04-03)**
- **Found during:** Task 1 (wiring the Zod resolver to react-hook-form).
- **Issue:** The plan calls for a "zod resolver", but `@hookform/resolvers` is absent from `frontend/package.json`, which plan 04-03 owns for parallel-safety — I must not edit it.
- **Fix:** Added `frontend/lib/forms/zod-resolver.ts` — a tiny zero-dependency `createZodResolver` that runs `schema.safeParse` and maps issues to react-hook-form's error shape.
- **Verification:** `tsc --noEmit` + form validation tests pass.
- **Committed in:** `fec497c` (Task 1).

**Dependency note for 04-03 / orchestrator:** if a first-party resolver is preferred later, add `@hookform/resolvers` to `frontend/package.json` and swap `createZodResolver` for `zodResolver` from `@hookform/resolvers/zod`. Not required — the hand-rolled resolver is fully functional.

### Notes (planned, not deviations)
- "set the active branch" is satisfied by `setSession` (no separate active-branch store exists); documented above.
- TOTP `totpCode` is kept optional in the Zod schema and only sent when present; the reveal is driven by the `TOTP_REQUIRED` error, matching the contract.

---
**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** No scope creep. `frontend/package.json`, `.github/**`, `frontend/playwright.*`, and `frontend/e2e/**` were NOT touched (04-03 ownership respected).

## Issues Encountered
- Radix dropdown interaction in jsdom is flaky, so the branch-switch success/denied contracts are proven at the `useSwitchBranch` hook level (cache cleared + branchId updated on success; session/cache intact + toast on denial), plus a render assertion that `BranchSwitcher` shows the active branch. This reliably covers SC2/W3 without depending on portal pointer-event quirks.

## User Setup Required
None — no new external service configuration. (Feature flags + branch list are MSW/static stubs pending Phase-3 contract confirmation.)

## Next Phase Readiness
- **Ready for 04-03:** the authenticated UX (login, guards, Sidebar, BranchSwitcher) is complete and green under tsc/lint/vitest; 04-03 can layer CI/CD + Playwright E2E on top. `frontend/package.json` and the E2E/CI paths were left untouched.
- **Open items to confirm (Phase 3):** (a) live `/api/v1/feature-flags` path/shape (D4); (b) the available-branches source/endpoint (e.g. `/api/v1/branches`) replacing the static stub; (c) optional `@hookform/resolvers` adoption.

---
*Phase: 04-frontend-shell-ci-cd*
*Completed: 2026-06-26*
