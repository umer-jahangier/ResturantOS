---
phase: 04-frontend-shell-ci-cd
plan: 01
subsystem: ui
tags: [nextjs16, react19, typescript, tailwind4, shadcn, tanstack-query, zustand, zod, msw, vitest, proxy, axios, docker]

# Dependency graph
requires:
  - phase: 02-authentication-authorization
    provides: "live auth contract — refresh_token cookie, login body/response shapes, JWT claims (tenant_id/branch_id/roles/permissions/attributes)"
  - phase: 03-api-gateway-platform-admin-tenant-user-management
    provides: "API gateway base URL all frontend traffic flows through; envelope ApiResponse<T>/ApiError"
provides:
  - "Next.js 16 (App Router, Turbopack) + React 19 + TS5-strict + Tailwind 4 CSS-first + shadcn (new-york) shell"
  - "Enforced four-layer API abstraction (component→hook→repository→request→client) for the auth/session domain"
  - "proxy.ts optimistic route protection + server-only DAL"
  - "ESLint flat-config import boundary (components/** cannot import api-client/repositories/axios)"
  - "MSW dev worker + Vitest server with auth+feature handlers"
  - "Zustand in-memory session + has_session marker + client-side JWT decode (no /me)"
  - "Multi-stage Dockerfile (standalone) + package scripts frozen for 04-03"
affects: [04-02-login-ui-guards-branchswitcher, 04-03-ci-cd-e2e]

# Tech tracking
tech-stack:
  added: [next@16.2.9, react@19.2.4, tailwindcss@4, "@tailwindcss/postcss@4", radix-ui@1.6.0, "@tanstack/react-query@5.101.1", zustand@5.0.14, react-hook-form@7.80.0, zod@4.4.3, axios@1.18.1, next-intl@4.13.0, next-themes@0.4.6, sonner@2.0.7, msw@2.14.6, vitest@4.1.9, "@vitest/coverage-v8@4.1.9", "@vitejs/plugin-react@6", "@testing-library/react@16", jsdom@29, prettier@3.8.4]
  patterns:
    - "Four-layer one-directional API abstraction with Zod parse-before-adapt in repositories"
    - "ESLint no-restricted-imports layer boundary on components/**"
    - "Optimistic proxy.ts (has_session marker) + server-only DAL as the real seam"
    - "Tailwind 4 CSS-first (@theme inline, OKLCH) — no tailwind.config.js"
    - "In-memory access token (Zustand) + HttpOnly refresh_token cookie; never localStorage"

key-files:
  created:
    - frontend/proxy.ts
    - frontend/lib/api-client/{client,request,errors,types}.ts
    - frontend/lib/api-client/schemas/auth.schema.ts
    - frontend/lib/adapters/{shared,auth.adapter}.ts
    - frontend/lib/models/auth.model.ts
    - frontend/lib/repositories/{session,feature}.repository.ts
    - frontend/lib/hooks/query-keys.ts
    - frontend/lib/hooks/auth/{use-login,use-refresh,use-logout}.ts
    - frontend/lib/auth/{session,jwt,dal}.ts
    - frontend/mocks/{handlers,browser,server}.ts
    - frontend/__tests__/lib/{session.repository,eslint-boundary}.test.ts
    - frontend/Dockerfile
  modified:
    - frontend/eslint.config.mjs
    - frontend/tsconfig.json
    - frontend/next.config.ts
    - frontend/app/globals.css
    - frontend/app/layout.tsx

key-decisions:
  - "middleware.ts → proxy.ts (Next 16 rename); FE-03 wording should be updated"
  - "has_session non-HttpOnly marker drives proxy.ts (refresh_token is HttpOnly Path=/api/v1/auth, invisible on app routes)"
  - "Auth contract confirmed: refresh_token cookie, {email,password,tenantSlug,totpCode?}, ApiResponse<{accessToken,expiresInSeconds,userId,tenantId,branchId}>; permissions from JWT decode, no /me"
  - "Removed shadcn radix-base @import \"shadcn/tailwind.css\" (uninstalled pkg broke Tailwind build); fixed self-referential --font-sans"

patterns-established:
  - "Repositories always .parse() (throw on drift), never the non-throwing variant"
  - "Adapters convert raw camelCase API shapes to domain models; raw field names never leak past the repository"
  - "Bearer-from-memory request interceptor + refresh-on-401 (guarded against auth-endpoint recursion)"

# Metrics
duration: ~95min
completed: 2026-06-26
---

# Phase 4 Plan 01: Frontend Shell + Four-Layer API Abstraction Summary

**Next.js 16 (Turbopack) + React 19 + Tailwind 4 CSS-first + shadcn shell with an enforced four-layer auth/session abstraction (Zod parse-before-adapt), proxy.ts optimistic protection + server-only DAL, an ESLint import boundary, and MSW dev+test wiring — builds clean under strict TS with zero `any`.**

## Performance

- **Duration:** ~95 min (heavy greenfield, ~60 files)
- **Completed:** 2026-06-26
- **Tasks:** 3
- **Files created/modified:** ~50 (excluding generated lockfile/worker)

## Accomplishments
- Scaffolded a strict-TS Next.js 16 App Router shell with three route groups rendering at distinct URLs (`/login`, `/platform/dashboard`, `/app/dashboard`); `/` → `/login`.
- Instantiated the complete four-layer API abstraction against the **real** auth contract: axios client (Bearer-from-memory + refresh-on-401), typed request helpers, Zod schemas, adapters, domain models, session/feature repositories, TanStack hooks, branch-scoped query keys, Zustand session, and client-side JWT decode.
- `proxy.ts` (Next 16) optimistically redirects `/platform/*` & `/app/*` to `/login` on a missing `has_session` marker; server-only DAL (`await cookies()`) is the real seam.
- ESLint flat-config `no-restricted-imports` boundary blocks `components/**` from importing api-client/repositories/axios — proven by a green unit assertion.
- MSW intercepts login (conditional TOTP)/refresh/logout/switch-branch/feature-flags in both the dev worker and the Vitest server; the dev login sets the readable `has_session` marker alongside a virtual HttpOnly `refresh_token`.
- Multi-stage Dockerfile builds a Next standalone image successfully (`docker build` verified green).

## Task Commits

1. **Task 1: Scaffold + Tailwind 4 + shadcn + tooling + ESLint boundary + providers + route groups** — `5f00880` (feat)
2. **Task 2: Four-layer API abstraction for the auth/session domain** — `b02cadc` (feat)
3. **Task 3: proxy.ts + DAL + MSW + Vitest + Dockerfile + contract & boundary tests** — `c5f2e5c` (feat)

**Plan metadata:** _(this docs commit)_

## Verification Results
- `pnpm tsc --noEmit`: PASS (zero errors, zero `any`).
- `pnpm build`: PASS — `ƒ Proxy (Middleware)` registered; `.next/standalone/server.js` emitted.
- `pnpm lint`: PASS (ESLint 9 flat config incl. layer boundary).
- `pnpm vitest run --coverage`: PASS — 7 tests across 2 specs; coverage thresholds (≥60%) satisfied on the touched contract files.
- `docker build -f frontend/Dockerfile frontend`: PASS (image `restaurantos-frontend:04-01`).
- No `tailwind.config.*` (CSS-first); `@import "tailwindcss"` present in `globals.css`.

## Confirmed Auth Contract (D3)
- Refresh cookie: **`refresh_token`** (HttpOnly, Secure, SameSite=Strict, Path=`/api/v1/auth`).
- Login body: **`{email, password, tenantSlug, totpCode?}`** (camelCase).
- Login success: `ApiResponse<{accessToken, expiresInSeconds, userId, tenantId, branchId}>`.
- Refresh / switch-branch success: `{accessToken, expiresInSeconds}` (ids re-derived by decoding the new JWT).
- Envelope: `{data, meta, warnings[]}`; error: `{error:{code, message, details[], traceId}}` (camelCase on the wire — no global snake_case Jackson config exists).
- **No `/api/v1/me`** — roles/permissions/attributes come from decoding the in-memory access JWT (claims `sub`/`tenant_id`/`branch_id`/`roles`/`permissions`/`attributes`/`impersonated_by`).

## Live Auth-Service Error Codes (supersedes §7.4 catalogue)
- `UNAUTHENTICATED` **401** — bad credentials AND suspended/non-ACTIVE tenant (masked; there is deliberately NO `INVALID_CREDENTIALS`/`TENANT_SUSPENDED`).
- `ACCOUNT_LOCKED` **423 LOCKED** (not 401).
- `TOTP_REQUIRED` **401** (step-up).
- `BRANCH_ACCESS_DENIED` **403** (for the 04-02 BranchSwitcher).
- `PASSWORD_REUSE` **400**.
- `PERMISSION_DENIED`/`FEATURE_DISABLED`/`QUOTA_EXCEEDED`/`VALIDATION_FAILED` are Phase-3 GATEWAY/shared-lib codes (kept + labelled as gateway codes, not auth-service codes).
- **Contract-reconciliation item:** spec §7.4's generic error catalogue diverges from the live `AuthExceptionHandler` — recommend updating §7.4 to match the codes above.

## `has_session` Marker Mechanism
`refresh_token` is HttpOnly and `Path=/api/v1/auth`, so it is never sent on `/app`/`/platform` navigations and `proxy.ts` cannot read it. On login the client (and the MSW dev login handler) sets a broadly-scoped, non-HttpOnly `has_session=1; Path=/; SameSite=Strict` marker — the ONLY cookie `proxy.ts`/the DAL read. It is forgeable and a UX hint only; the real gate is the DAL + the gateway's 401 on the access token (CVE-2025-29927 — optimistic middleware is not a security boundary).

## Environment Variables (Doc 05)
- `NEXT_PUBLIC_API_BASE_URL` (gateway, default `http://localhost:8080`)
- `NEXT_PUBLIC_WS_BASE_URL` (default `ws://localhost:8080`)
- `NEXT_PUBLIC_ENABLE_MSW` (`"true"` enables the dev worker; never in prod)

## Deviations from Plan

### Documented / planned deviations
**1. middleware.ts → proxy.ts (D2)** — Next 16 renamed `middleware.ts` to `proxy.ts` (exported fn `proxy`). FE-03 references `middleware.ts`; **recommend updating FE-03 wording** to `proxy.ts`. Implemented per D2.

### Auto-fixed Issues

**2. [Rule 3 - Blocking] shadcn radix-base injected an unresolved CSS import**
- **Found during:** Task 1 (first `pnpm build`).
- **Issue:** `shadcn init` (radix base) wrote `@import "shadcn/tailwind.css";` into `globals.css`, but the `shadcn` npm package is not a dependency → Turbopack `CssSyntaxError: Can't resolve 'shadcn/tailwind.css'`. Also `--font-sans: var(--font-sans)` was self-referential.
- **Fix:** Removed the dangling import; set `--font-sans: var(--font-geist-sans)`. All theme tokens were already inline.
- **Verification:** `pnpm build` succeeds; fonts resolve.
- **Committed in:** `5f00880`.

**3. [Rule 3 - Blocking] shadcn `form` component skipped by CLI**
- **Found during:** Task 1 (component add).
- **Issue:** The non-interactive `shadcn add form` exited without writing `components/ui/form.tsx`.
- **Fix:** Authored `form.tsx` manually for the radix-umbrella base (`import { Slot } from "radix-ui"`, react-hook-form Controller/FormProvider), matching the installed primitives.
- **Verification:** `tsc --noEmit` + `lint` pass.
- **Committed in:** `5f00880`.

**4. [Rule 3 - Blocking] pnpm 11 build-script policy + missing coverage provider**
- **Found during:** Tasks 1 & 3.
- **Issue:** pnpm 11 replaced `onlyBuiltDependencies` with an `allowBuilds` map and aborts installs on un-approved native build scripts; coverage thresholds needed `@vitest/coverage-v8`.
- **Fix:** Configured `pnpm-workspace.yaml allowBuilds` (sharp/unrs-resolver/@tailwindcss/oxide/esbuild true; @parcel/watcher/@swc/core/msw false); installed `@vitest/coverage-v8`. (pnpm itself was provided via a local corepack shim since it was not globally installed.)
- **Verification:** `pnpm install` clean; `vitest run --coverage` green.
- **Committed in:** `5f00880` / `c5f2e5c`.

**5. [Rule 1 - Bug] Mock UUIDs failed Zod v4 `.uuid()`**
- **Found during:** Task 3 (first test run).
- **Issue:** Zod v4 `.uuid()` enforces RFC version/variant nibbles; the placeholder mock UUIDs (`1111…`) were rejected.
- **Fix:** Used RFC-valid v4 UUIDs in the MSW handlers and the drift-test body.
- **Verification:** `session.repository.test.ts` green.
- **Committed in:** `c5f2e5c`.

**6. [Rule 1 - Bug] `HttpResponse` return annotation needed a type arg**
- **Found during:** Task 3 (`tsc`).
- **Fix:** Dropped the explicit `: HttpResponse` annotation on the `authError` helper (inferred).
- **Committed in:** `c5f2e5c`.

**Minor:** added a `.gitignore` exception for `.env.local.example`; removed the `components/ui/.gitkeep` placeholder once real components existed (the plan listed it for an empty dir).

---
**Total deviations:** 1 documented (proxy rename) + 5 auto-fixed (3 blocking, 2 bugs).
**Impact on plan:** All auto-fixes were necessary for a clean build/test; no scope creep. Tech stack and architecture as specified.

## Issues Encountered
- Tailwind 4 + shadcn radix-base emit a `shadcn/tailwind.css` import that assumes the `shadcn` runtime package — resolved by removing it (tokens are inline).
- Docker image build is slow (~100s) but succeeds end-to-end with the standalone output.

## User Setup Required
None — no external service configuration required for this plan. (Copy `frontend/.env.local.example` → `.env.local` for local dev; set `NEXT_PUBLIC_ENABLE_MSW=true` to use mocks.)

## Next Phase Readiness
- **Frozen for 04-02:** the api-client/repository/hook/query-key/session/MSW contracts, the auth error-code guards, and the route-group/proxy structure. The login page is a placeholder awaiting the real form + guards + BranchSwitcher.
- **Frozen for 04-03:** package scripts (`build`/`lint`/`typecheck`/`test:run`/`test:coverage`/`format:check`), the multi-stage `Dockerfile` (standalone), and `tsconfig` excluding `e2e/**` (E2E gets its own tsconfig in 04-03).
- **Open items to confirm:** (a) the feature-flags endpoint path/shape `/api/v1/feature-flags` (D4) against the live Phase-3 contract; (b) spec §7.4 error-catalogue reconciliation; (c) FE-03 `middleware.ts → proxy.ts` wording; (d) server-side DAL is presence-only — full server-side refresh/validation against the gateway is a later hardening step.

---
*Phase: 04-frontend-shell-ci-cd*
*Completed: 2026-06-26*
