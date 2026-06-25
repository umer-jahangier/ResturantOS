---
phase: 04-frontend-shell-ci-cd
verified: 2026-06-26T01:05:00Z
status: human_needed
score: 16/16 must-have truths verified in code (all 4 success criteria + FE-01..08 + INFRA-05 satisfied)
re_verification: false
gates_run_locally:
  tsc_noEmit: pass (0 errors)
  eslint: pass (0 errors/warnings)
  eslint_no_explicit_any: pass (0 violations)
  vitest: pass (5 files, 21 tests)
  vitest_coverage: 68.44% lines / 68.02% stmts / 60.39% branch (>= frontend gate 60)
  next_build: pass (routes /, /login, /app/dashboard, /platform/dashboard + Proxy middleware)
human_verification:
  - test: "Execute the CI pipeline on a live GitHub runner (push/PR)."
    expected: "lint -> test -> build -> schema-sync all green: Java `mvn -Pcoverage verify` + per-module JaCoCo gate, Vitest gate, OPA `opa test policies/ --coverage` == 100, multi-arch buildx, cosign keyless OIDC sign."
    why_human: "Java build, Testcontainers, OPA coverage, GHCR push and cosign OIDC signing cannot be exercised locally; only a live runner proves these gates actually pass."
  - test: "Manually drive login -> dashboard in a browser with MSW dev worker enabled."
    expected: "Login (incl. owner@demo.test TOTP step-up) sets has_session, proxy lets /app routes through, sidebar/branch-switcher render and behave; visiting /app/dashboard logged-out redirects to /login."
    why_human: "Visual rendering and the full interactive auth/redirect flow are not covered by an executing automated test (Playwright e2e is scaffold-only / continue-on-error)."
observations:
  - "Java checkstyle/spotbugs/pmd are NOT wired in the parent POM yet; the lint job runs a compile-only `mvn -DskipTests verify` fallback (documented in 04-03-SUMMARY)."
  - "OpenAPI<->Zod drift check is a documented placeholder (no maintained npm tool at execution time; backend SpringDoc is a Phase-3+ dependency) (D5b)."
  - "promote-to-prod is a deliberate manual GitHub `environment: production` approval gate (D6), not part of the automated core — by design."
  - "BranchSwitcher branch list + useFeatureFlags endpoint are Phase-4 stubs/MSW-mocked pending Phase-3 live contracts (documented)."
---

# Phase 4: Frontend Shell & CI/CD — Verification Report

**Phase Goal:** Deliver the Next.js shell with its enforced four-layer API abstraction and route protection, plus a fully automated quality-gated pipeline — completing the verified Sprint-1 "GO" set before any tenant business module is built.

**Verified:** 2026-06-26 (goal-backward, against actual code under `frontend/` and `.github/workflows/`, not SUMMARY claims)
**Status:** human_needed — **no code-level gaps found**; all 4 success criteria + FE-01..08 + INFRA-05 are satisfied in code, and every gate that can run locally is green. Two items genuinely require live confirmation (CI on a real runner; visual/interactive UI), which is the textbook `human_needed` trigger.

---

## Locally-executed gate results

| Gate | Command | Result |
|------|---------|--------|
| TypeScript strict, zero `any` | `tsc --noEmit` | ✅ 0 errors |
| ESLint flat config (FE-08) | `eslint .` | ✅ 0 problems |
| No explicit `any` | `eslint --rule no-explicit-any:error` | ✅ 0 violations |
| Unit/contract tests | `vitest run --coverage` | ✅ 5 files, 21 tests pass |
| Frontend coverage gate (≥60) | v8 coverage | ✅ 68.44% lines / 60.39% branch |
| Production build | `next build` | ✅ routes `/`, `/login`, `/app/dashboard`, `/platform/dashboard` + `Proxy (Middleware)` |

---

## Success Criteria

### SC1 — Shell + route groups + protected redirect + tenant-aware login + conditional TOTP — ✅ MET
- `app/(auth)/login/page.tsx`, `app/(platform)/platform/dashboard/page.tsx`, `app/(tenant)/app/dashboard/page.tsx` exist; build emits real URLs `/login`, `/platform/dashboard`, `/app/dashboard`. `app/page.tsx` redirects `/` → `/login`.
- `frontend/proxy.ts:14-30` (NOT `middleware.ts`): `proxy()` redirects to `/login` when `has_session` cookie absent, matcher `["/platform/:path*","/app/:path*"]`. Build confirms `Proxy (Middleware)` registered.
- `app/(auth)/login/page.tsx:13-20` awaits `searchParams` + `headers()` and resolves the slug via `resolveTenantSlug({host, searchParam})` (`lib/auth/tenant-slug.ts` — subdomain or `?tenant=`).
- `components/auth/login-form.tsx:90-96` reveals the TOTP field on `error.isTotpRequired()` and resubmits.

### SC2 — Permission/Feature guards hide nav; BranchSwitcher reissues JWT + invalidates cache — ✅ MET
- `permission-guard.tsx:23-31` gates on decoded-JWT `permissions` (`useCurrentUser`); `feature-guard.tsx:18-28` gates on `useFeatureFlags()`.
- `sidebar.tsx:46-58` wraps each nav item in **both** `PermissionGuard` AND `FeatureGuard`.
- `lib/hooks/auth/use-switch-branch.ts:23-34` `onSuccess` → `setSession(session)` + `queryClient.clear()`; `onError` with `isBranchAccessDenied()` surfaces a toast WITHOUT mutating the session. `branch-switcher.tsx:44,69-72` wires it and shows the denied inline alert.

### SC3 — Zod-parse-before-adapt + MSW dev auth + ESLint boundary + strict tsc — ✅ MET
- `lib/repositories/session.repository.ts:12,17,26` calls `apiXSchema.parse(raw)` (throwing) **before** `adaptSession`/`adaptTokenSession` — `.safeParse` is not used to swallow drift.
- `mocks/handlers.ts` intercepts `/api/v1/auth/login|refresh|logout|switch-branch` + `/api/v1/feature-flags`; dev login sets non-HttpOnly `has_session=1; Path=/` (line 69) plus HttpOnly `refresh_token` (line 66); conditional `TOTP_REQUIRED` 401 (lines 58-60).
- `eslint.config.mjs:14-36` `no-restricted-imports` blocks `axios` + `@/lib/api-client/**` + `@/lib/repositories/**` from `components/**`; `__tests__/lib/eslint-boundary.test.ts` asserts the rule **fires** for a component importing a repository and does **not** fire for a Layer-3 hook (passes).
- `tsc --noEmit` passes with zero `any`.

### SC4 — CI lint→test→build→schema-sync, data-driven gates, signed images — ✅ MET (live-runner confirmation pending)
- `.github/workflows/ci.yml`: `lint` → `test (needs: lint)` → `build (needs: test)` → `schema-sync (needs: lint)`; `deploy-prod (needs: build, schema-sync)` is the manual gate. No manual intervention in the core path.
- Data-driven gates read from `coverage-gates.json` (java default 60, finance/inventory 75, frontend 60, opa 100): Java per-module JaCoCo CSV parser (lines 103-130), Vitest gate (147-151), OPA `--coverage` JSON must == 100 (161-171).
- `build` job: `id-token: write` + `packages: write` (217-220), QEMU+buildx `linux/amd64,linux/arm64` (270), cosign keyless sign of the pushed digest (280-284).
- `schema-sync`: `tsc --noEmit` over schemas (200-201) + documented OpenAPI↔Zod placeholder (203-206).

---

## Requirements Coverage

| Req | Description | Status | Evidence |
|-----|-------------|--------|----------|
| FE-01 | Next.js shell + route groups + strict tooling | ✅ MET | `app/(auth|platform|tenant)/**`, `tsc`/`build` green, Tailwind 4 CSS-first (`globals.css:1` `@import "tailwindcss"`, no `tailwind.config.*`) |
| FE-02 | Four-layer API abstraction | ✅ MET | `lib/api-client/{client,request,errors,types}.ts` → `lib/repositories/*` (.parse) → `lib/adapters/*` → `lib/hooks/auth/*` |
| FE-03 | Route protection | ✅ MET | `proxy.ts` matcher+redirect; `lib/auth/dal.ts` `server-only` DAL via `cookies()` |
| FE-04 | Login + tenant slug + conditional TOTP | ✅ MET | `login/page.tsx` + `login-form.tsx` (TOTP reveal; 401/423 mapping) |
| FE-05 | Permission/feature nav + BranchSwitcher JWT reissue + cache invalidation | ✅ MET | `sidebar.tsx`, `branch-switcher.tsx`, `use-switch-branch.ts` (`queryClient.clear()`) |
| FE-06 | FeatureGuard / PermissionGuard | ✅ MET | `permission-guard.tsx` (JWT claims), `feature-guard.tsx` (`useFeatureFlags`) |
| FE-07 | MSW dev+test, Zod-parse-before-adapt | ✅ MET | `mocks/{browser,server,handlers}.ts`; repository `.parse()` |
| FE-08 | ESLint boundary + zero-`any` + clean tsc | ✅ MET | `eslint.config.mjs` + boundary test fires; `tsc`/`eslint`/no-`any` green |
| INFRA-05 | Automated lint→test→build→schema-sync, gates, signed images | ✅ MET (code) / ⏳ live-runner confirmation | `ci.yml` + `coverage-gates.json` (see SC4) |

---

## Must-Have Scorecard

| Plan | Truths | Artifacts | Key links | Verified |
|------|--------|-----------|-----------|----------|
| 04-01 | 6 | 6 | 3 | ✅ all (proxy.ts, client.ts, session.repository.ts, eslint.config.mjs, globals.css, handlers.ts) |
| 04-02 | 5 | 4 | 3 | ✅ all (login-form.tsx, permission-guard.tsx, feature-guard.tsx, branch-switcher.tsx) |
| 04-03 | 5 | 3 | 2 | ✅ all (ci.yml, coverage-gates.json, playwright.config.ts) |
| **Total** | **16** | **13** | **8** | **16/16 truths verified in code** |

All 13 required artifacts pass Level 1 (exist), Level 2 (substantive — no stubs in the verified paths beyond the intentionally documented BranchSwitcher branch list / feature-flag endpoint), and Level 3 (wired — imported and used; build + tests exercise them).

---

## Anti-Patterns / Notes

| Item | Severity | Note |
|------|----------|------|
| Java checkstyle/spotbugs/pmd not in parent POM | ℹ️ Info | Lint job uses compile-only fallback; documented deferral, gate ready to swap in |
| OpenAPI↔Zod drift = placeholder | ℹ️ Info | No maintained npm tool at execution time; SpringDoc is Phase-3+ (D5b) |
| promote-to-prod manual approval | ℹ️ Info | Deliberate `environment: production` gate (D6) — by design, not a failure |
| BranchSwitcher static branches / feature-flag endpoint mocked | ℹ️ Info | Phase-4 stub pending Phase-3 live contracts; documented in SUMMARYs |

These are documented, deliberate, non-blocking deferrals and do not fail the phase.

## Gaps Summary

**No code-level gaps.** Every success criterion and requirement is satisfied in the actual code, and all locally-runnable gates (tsc, eslint, no-`any`, vitest+coverage, next build, ESLint-boundary test) are green. The `human_needed` status reflects only two residual confirmations that cannot be exercised locally: (1) the CI pipeline executing green on a live GitHub runner (Java/JaCoCo/OPA/Testcontainers/cosign), and (2) a manual visual + interactive pass of the login→dashboard flow.

---

_Verified: 2026-06-26 · Verifier: Claude (gsd-verifier)_
