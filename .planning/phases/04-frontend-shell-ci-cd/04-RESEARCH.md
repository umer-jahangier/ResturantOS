# Phase 4: Frontend Shell & CI/CD - Research

**Researched:** 2026-06-25
**Domain:** Next.js 16 App Router (Turbopack) + React 19 + TypeScript 5 strict + Tailwind CSS 4 frontend shell with a four-layer API abstraction, route-group/session protection, MSW auth mocks; plus a GitHub Actions quality-gated CI/CD pipeline (lint → test → build(signed) → schema-sync)
**Confidence:** HIGH for FACTS pinned by the spec (`Docs/`); MEDIUM for the fast-moving frontend stack mechanics (Next.js 16 / Tailwind 4 / shadcn / MSW), which were cross-checked against current (2026) sources and are flagged where the spec lags reality.

---

## Summary

Phase 4 is **greenfield** — there is **no frontend code on disk yet** (`frontend/` does not exist; no `package.json`, `next.config.*`, or `tsconfig.json` anywhere in the repo). This phase scaffolds a brand-new Next.js 16 app and a GitHub Actions pipeline. Unlike Phases 2–3 (≈70% assembly of a shipped `shared-lib`), Phase 4 builds almost everything from scratch, but the *shape* of what to build is exhaustively pre-specified in `Docs/RestaurantERP_SaaS_Specification.md` §P5.1–P5.2 (the four-layer architecture, file conventions, and even reference code for the API client, repository, schema, adapter, model, hooks, MSW test, and offline queue) and §D1.4 (the CI pipeline). The agent-spec `07-coding-standards.md` §7.2 locks the TypeScript/React conventions (file naming, import order, the ESLint `no-restricted-imports` rule, strict-mode/no-`any`).

The single most important currency finding: **Next.js 16 renamed `middleware.ts` → `proxy.ts`** (the exported function must be `proxy`, and it now runs on the **Node.js** runtime, not Edge). The spec and requirement FE-03 say "`middleware.ts`" because they predate this rename. Additionally, after CVE-2025-29927 the proxy/middleware layer must be used **only for optimistic redirects**, with real session validation in a server-only Data Access Layer (DAL). This directly shapes how FE-03 route protection is built (see Pitfall 1 + Decision D2).

A second key seam: the frontend's transport model is **access JWT in the response body (held in memory/Zustand) + an HttpOnly `Secure` `SameSite=Strict` refresh cookie** (spec §P7.1). The spec's reference `apiClient` (§P5.2.1) is **axios** with a request interceptor injecting `Authorization: Bearer` from an in-memory session and a response interceptor doing transparent refresh on 401. Because the access token is *not* a readable cookie, `proxy.ts` can only check **presence of the refresh cookie** for its optimistic redirect; per-route permission/feature checks happen in components via `PermissionGuard`/`FeatureGuard`.

Phase 4 depends on Phase 2 (auth-service) and Phase 3 (gateway) per the roadmap, but **does not require either to be running**: FE-07 mandates MSW mocks for auth so the shell is buildable/testable standalone. `NEXT_PUBLIC_API_BASE_URL` points at the gateway (`http://localhost:8080`).

**Primary recommendation:** Build along the roadmap's 2-plan split — **04-01** = Next.js shell (scaffold, Tailwind 4 + shadcn, route groups, `proxy.ts` + DAL, login/TOTP, BranchSwitcher, Feature/Permission guards, the full four-layer abstraction wired for the `auth`/`session`/`me` domain, MSW dev+test); **04-02** = GitHub Actions CI/CD (lint+tsc+eslint, vitest coverage gates, Java JaCoCo gates, OPA 100%, cosign-signed multi-arch images, schema-sync). Use the spec's reference code as the canonical pattern, but **transcribe FE-03 against `proxy.ts`, not `middleware.ts`**, and resolve the four decisions below before coding.

---

## Standard Stack

All choices below are **FACTS from the spec** (`§P5.1`, `§P5.7`, `§D1.4`) unless explicitly tagged **[RECOMMENDATION/DECISION]**. Versions are the current stable line verified against 2026 sources (Next 16.2.x, React 19.2.x, Tailwind 4.1.x, MSW 2.12+); pin exact patch versions at scaffold time via the package manager (do not hand-write guesses).

### Core (spec-mandated)
| Library | Version | Purpose | Why Standard (source) |
|---------|---------|---------|--------------|
| `next` | 16.x (App Router, Turbopack) | Framework, routing, RSC, `proxy.ts` | §P5.1 — "Next.js 16+ (App Router, Turbopack)"; requires Node ≥20 |
| `react` / `react-dom` | 19.x | UI runtime (no `forwardRef`; `use()`, `useActionState`) | §P5.1 |
| `typescript` | 5.x (strict) | Type safety; `tsc --noEmit` gate | §P5.1, FE-08, §7.2.6 |
| `tailwindcss` + `@tailwindcss/postcss` | 4.1.x | Styling, **CSS-first** (`@import "tailwindcss"` + `@theme` in `globals.css`, **NO `tailwind.config.js`**) | §P5.1 |
| `shadcn/ui` (CLI-managed) | latest (new-york style) | Radix-based components, white-label override | §P5.1 |
| `@tanstack/react-query` | v5 | **All** server state (Layer 3 hooks) | §P5.1, §7.2.4 |
| `zustand` | latest | Client state: auth session, active branch, offline queue, UI prefs **only** | §P5.1, §7.2.4 |
| `react-hook-form` + `zod` | latest / Zod 3.x | Form state; **Zod shared for form validation AND API response parsing** | §P5.1, §P5.2.5 |
| `axios` | latest | The single Layer-1 API client instance | §P5.2.1 (reference code) |
| `zod` | 3.x | Runtime response validation (`.parse()` before adapt) | §P5.2.5, FE-07 |

### Supporting (spec-listed; some belong to later phases — scope carefully)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@tanstack/react-table` | v8 | Headless tables | When list views are built (mostly later module phases; shell may stub) |
| `recharts` | latest | Charts | Dashboard (Phase 12) — **out of Phase-4 scope** |
| `next-intl` | latest | i18n / locale routing | §P5.1 — include the provider in the shell; full message catalogues later |
| `next-themes` | latest | Dark/light (shadcn pattern) | Shell theming |
| `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css` | latest | shadcn/ui peer deps | Installed by shadcn init |
| `msw` | 2.x (≥2.12) | Auth mocks in **dev** (`setupWorker`) and **tests** (`setupServer`) | FE-07 (this phase) |
| `idb` + Workbox Service Worker | latest | Offline POS queue (`OfflineQueueRepository`) | §P5.2.6 — **POS Phase 7; out of Phase-4 scope** (shell may scaffold the type only) |
| `@testing-library/react`, `vitest`, `@vitejs/plugin-react`, `jsdom`/browser-mode | Vitest 4.x | Unit + MSW contract tests | §D1.4, §D2.2 |
| `playwright` | latest | E2E journeys | §D1.4 e2e runs **against staging** — pipeline scaffolding only this phase; full 50 journeys are cross-phase |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| axios (Layer 1) | native `fetch` wrapper | Spec reference code is axios with interceptors (transparent refresh, error normalisation). **Use axios** to match §P5.2.1; do not hand-roll fetch. |
| `proxy.ts` doing full JWT verify | optimistic cookie-presence check + server-only DAL | CVE-2025-29927 + Next 16 guidance: proxy is optimistic only. **Use DAL for real checks.** |
| Tailwind config JS | CSS-first `@theme` | Spec is explicit: **no `tailwind.config.js`**. Tailwind 4 default. |
| Jest | Vitest | Spec §D1.4 names `vitest run --coverage`. Use Vitest. |
| Storing access token in `localStorage` | in-memory (Zustand) + HttpOnly refresh cookie | XSS-exfiltration risk; spec keeps refresh HttpOnly and access short-lived in memory. **Memory + cookie.** |

**Installation (scaffold sequence — DECISION on package manager; recommend `pnpm`):**
```bash
# 1. Scaffold (run inside repo root, creates ./frontend)
pnpm create next-app@latest frontend --typescript --eslint --app --turbopack --import-alias "@/*"
#    (answer NO/YES to src-dir per Decision D1)
# 2. shadcn + Tailwind 4 (CSS-first)
cd frontend && pnpm dlx shadcn@latest init     # pick new-york; writes components.json (tailwind.config:"")
pnpm dlx shadcn@latest add button input form card dialog dropdown-menu sonner skeleton
# 3. App deps
pnpm add @tanstack/react-query zustand react-hook-form zod axios next-intl next-themes
# 4. Test/mocks
pnpm add -D vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom msw
pnpm dlx msw init public/ --save        # generates public/mockServiceWorker.js for dev worker
```

---

## Architecture Patterns

### Recommended Project Structure

The spec's import alias is `@/lib/*`, `@/components/*` (§P5.2, §7.2.2) and the schema-sync CI path is `frontend/lib/api-client/schemas/**` (§P5.2.5). The coding-standards ESLint override (§7.2.3) references `src/components/**/*`. **These two conventions conflict (root-`lib/` vs `src/`)** — see Decision D1. The structure below assumes the **spec-dominant `frontend/`-root layout (NO `src/`)** so the documented `@/lib/api-client/schemas` path and the schema-sync workflow match verbatim:

```
frontend/
├── app/                          # App Router; route GROUPS:
│   ├── (auth)/                   #   public auth pages (login, reset, 2fa)
│   │   └── login/page.tsx
│   ├── (platform)/               #   SuperAdmin area (protected)
│   │   └── layout.tsx
│   ├── (tenant)/                 #   tenant app (protected) — sidebar shell
│   │   └── layout.tsx
│   ├── layout.tsx                # root: Providers (QueryClient, theme, intl, MSW)
│   └── globals.css               # @import "tailwindcss"; @theme inline { ... } (NO tailwind.config.js)
├── proxy.ts                      # ← Next 16 (was middleware.ts): optimistic redirect only (FE-03)
├── components/
│   ├── ui/                       # shadcn primitives
│   ├── shared/                   # FeatureGuard, PermissionGuard, BranchSwitcher, Sidebar
│   └── {domain}/                 # feature components (consume hooks only)
├── lib/
│   ├── api-client/               # LAYER 1
│   │   ├── client.ts             #   axios instance (auth+tenant interceptors, refresh-on-401)
│   │   ├── request.ts            #   typed get/getPaginated/post/patch/del
│   │   ├── errors.ts             #   ApiError + parseApiError (error-code catalogue)
│   │   ├── types.ts              #   ApiSingleResponse / ApiPaginatedResponse / ApiWarning
│   │   └── schemas/{domain}.schema.ts   # Zod schemas (ONLY place that knows raw API field names)
│   ├── adapters/                 # LAYER 2a: {domain}.adapter.ts + shared.ts (toMoney/toLocalDate)
│   ├── models/                   # LAYER 2b: {domain}.model.ts (camelCase domain models)
│   ├── repositories/             # LAYER 2c: {domain}.repository.ts (call→parse→adapt)
│   ├── hooks/                    # LAYER 3: query-keys.ts + {domain}/use-*.ts
│   ├── auth/                     # session.ts (getSession/refreshSession), dal.ts (server-only)
│   └── utils.ts                  # shadcn cn()
├── mocks/                        # MSW: handlers.ts, browser.ts (dev), server.ts (vitest)
├── __tests__/                    # vitest + MSW contract tests, utils/query-wrapper.tsx
├── components.json               # shadcn (style:new-york, tailwind.config:"", cssVariables:true)
├── eslint.config.mjs             # no-restricted-imports (block api-client/repositories from components)
├── postcss.config.mjs            # @tailwindcss/postcss
├── vitest.config.ts
├── tsconfig.json                 # strict; paths @/* 
├── Dockerfile                    # multi-stage; cosign-signed in CI
└── package.json
```

### Pattern 1: The Four-Layer API Abstraction (FE-02, the core of this phase)
**What:** Strict one-directional dependency UI → hooks → repositories → api-client. A component may never import a layer below Layer 3.
**Data flow:** `component` → `use-X` hook (TanStack Query) → `XRepository.method()` → `request.get/post` (Layer 1 axios) → raw JSON → `apiXSchema.parse(raw)` (Zod, throws on drift) → `adaptX(parsed)` → domain model (camelCase, `Money` objects, `Date`) → back up to the component.
**Source:** §P5.2.1–P5.2.4 (full reference code for `client.ts`, `request.ts`, `errors.ts`, `types.ts`, `order.repository.ts`, `order.schema.ts`, `order.adapter.ts`, `shared.ts`, `order.model.ts`, `query-keys.ts`, `use-order.ts`, `use-close-order.ts`).
**Phase-4 instantiation:** there is no business domain yet, so build the abstraction end-to-end for the **auth/session/me domain** (login, refresh, logout, branch-switch, current-user/permissions, feature flags) — this proves all four layers and the Zod-parse-before-adapt rule against real auth contracts, and is exactly what FE-04/05/06/07 need.

### Pattern 2: Route groups + `proxy.ts` optimistic protection + server-only DAL (FE-03)
**What:** `app/(auth)` (public), `app/(platform)` + `app/(tenant)` (protected). `proxy.ts` (Next 16 rename of `middleware.ts`) runs an **optimistic** check — redirect to `/login` if the refresh cookie is absent — and the **real** validation lives in `lib/auth/dal.ts` (`import "server-only"`, `cache()`-wrapped) called by protected layouts/route handlers.
**When:** Every protected route group.
**Example (Next 16 proxy.ts — note function name `proxy`):**
```typescript
// proxy.ts  (Next.js 16 — replaces middleware.ts; runs on Node runtime)
// Source: Next.js 16 migration guidance (mswjs/Vercel docs, 2026) + spec FE-03 intent
import { NextRequest, NextResponse } from "next/server";

const PROTECTED = ["/dashboard", "/platform", "/tenant"]; // prefixes under (platform)/(tenant)

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED.some((p) => pathname.startsWith(p));
  // OPTIMISTIC ONLY: the access JWT is in memory, not a cookie; we can only see the refresh cookie.
  const hasSession = request.cookies.has("ros_refresh"); // name per auth-service Set-Cookie
  if (isProtected && !hasSession) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/dashboard/:path*", "/platform/:path*", "/tenant/:path*"] };
```
> The cookie name is a contract with auth-service's Set-Cookie (Phase 2 issues it on `/api/v1/auth` path). **DECISION D3:** confirm the exact cookie name; the spec says "HttpOnly refresh cookie" but does not name it. With MSW, the mock login handler must set a matching cookie so the optimistic redirect works in dev.

### Pattern 3: Login with conditional TOTP (FE-04, FD-2)
**What:** Login form; tenant slug resolved from **subdomain or `?tenant=`** (AC1, FD-2). `POST /api/v1/auth/login {email,password,tenant_slug,totp_code?}`. If the server returns **401 `TOTP_REQUIRED`** (only when `totp_enabled`), the form reveals the TOTP field and resubmits with `totp_code` (FD-2 steps O→P→Q→R). Error codes consumed: `TENANT_SUSPENDED` (403), `INVALID_CREDENTIALS` (401), `ACCOUNT_LOCKED` (401), `TOTP_REQUIRED` (401) — all from the §7.4 catalogue.
**Source:** §P7.1 Login Flow, FD-2 flowchart, §7.4 error catalogue, AC1–AC4 (user stories).

### Pattern 4: BranchSwitcher — JWT reissue + query-cache invalidation (FE-05)
**What:** `POST /api/v1/auth/switch-branch {branchId}` → new access JWT with updated `branch_id` and recomputed `permissions[]` (FD-2 AC4 / spec branch-switch). On success: store the new access token in the Zustand session, set active branch, and **invalidate the entire TanStack Query cache** (`queryClient.clear()` or invalidate all branch-scoped keys) because query keys are branch-scoped (`queryKeys.orders.all(branchId)`, §P5.2.3).
**Source:** §P5.2.3 query-keys (branchId in every key), AUTH-05, FE-05.

### Pattern 5: PermissionGuard (JWT claims) and FeatureGuard (tenant features) (FE-06)
**What:** `PermissionGuard` reads `permissions[]` from the **decoded access-JWT claims** (permissions ARE in the JWT — §P7.1 payload) and renders children only if the required permission is present. `FeatureGuard` checks whether a `FEATURE_*` flag is enabled for the tenant.
**Critical FACT:** **feature flags are NOT in the JWT.** They are enforced server-side at the gateway against `tenant_features` (Redis, 5-min TTL) returning 403 `FEATURE_DISABLED` (§"Feature Flag Enforcement", GW-05). The JWT carries `roles`, `permissions`, `attributes` only. **DECISION D4:** the frontend therefore needs a source for feature flags for *proactive* UI hiding. Options: (a) a `GET /api/v1/me` / `GET /api/v1/tenants/me/features` endpoint that returns enabled flags (recommended; spec doesn't define one explicitly → flag as a contract to confirm with Phase 3); (b) treat the gateway's 403 `FEATURE_DISABLED` as the only enforcement and have `FeatureGuard` consume a flags map fetched once and cached. Recommend (a) via a `useFeatureFlags()` hook backed by a repository; in Phase 4 the MSW handler supplies the flags so the guard is testable. Sidebar nav (FE-05) composes both guards: an item shows only if its permission is held AND its feature is enabled.

### Anti-Patterns to Avoid
- **Calling the API client or repositories from a component.** Enforced by ESLint `no-restricted-imports` (§7.2.3). Components use hooks only.
- **Putting server data in Zustand.** Server state is TanStack Query only (§7.2.4).
- **`.safeParse()` to swallow schema drift.** Use `.parse()` so ZodErrors surface (§P5.2.8).
- **Dividing paisa by 100 in a component.** Always `Money.formatted` from the adapter (§7.2.5).
- **`any` / `as` / `!`.** Strict mode; `as` only inside an adapter with a comment; `!` only in tests (§7.2.6).
- **Treating `proxy.ts` as the security boundary.** It's optimistic UX only (CVE-2025-29927). Real auth = server-only DAL.
- **Writing `tailwind.config.js`.** Tailwind 4 CSS-first; tokens live in `@theme` in `globals.css`.
- **Using sync `cookies()`/`headers()`.** Next 16 removed the sync fallback — always `await cookies()` / `await headers()`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP client, auth header, refresh-on-401 | custom fetch wrapper | the spec's axios `apiClient` with interceptors (§P5.2.1) | transparent refresh, error normalisation, trace-id already designed |
| API error typing | per-call error parsing | `ApiError` + `parseApiError` mapping the §7.4 code catalogue | components branch on `isQuotaExceeded()`/`isPermissionDenied()` etc. |
| Server-state cache, refetch, optimistic updates | bespoke state in Zustand/Redux | TanStack Query v5 hooks + `queryKeys` registry | §7.2.4 mandate; cache invalidation consistency |
| Response shape validation | manual `typeof` checks | Zod `.parse()` in repositories (§P5.2.5) | runtime drift detection → ZodError → GlitchTip |
| API mocking (dev + tests) | fake servers / fetch stubs | MSW 2.x (`setupWorker` dev, `setupServer` vitest) | §P5.1/§D2.2; intercepts at network layer, exercises schema+adapter+hook |
| UI primitives (dialog, dropdown, form) | hand-built a11y components | shadcn/ui (Radix) | §P5.1; accessible, white-label-friendly |
| Route protection redirect | bespoke auth gating in every page | `proxy.ts` optimistic + server-only DAL | Next 16 pattern; avoids per-page boilerplate and CVE bypass |
| Money formatting | `paisa/100` math in components | `toMoney()` adapter → `Money.formatted` (Intl `en-PK`/PKR) | §7.2.5; one source of truth |
| Container image signing | custom GPG flow | `cosign sign` in CI | §D1.4, OWASP A08 (§"A08 Software Integrity") |
| OpenAPI↔Zod drift detection | manual diffing | `openapi-to-zod-check` schema-sync job | §P5.2.5 / §D1.4 reference workflow |

**Key insight:** §P5.2 was written so agents transcribe/adapt the reference code rather than invent an architecture. The only genuinely new design work this phase is (a) instantiating the abstraction for the auth/session domain, (b) adapting FE-03 to `proxy.ts`+DAL, and (c) the GitHub Actions pipeline.

---

## Common Pitfalls

### Pitfall 1: `middleware.ts` was renamed to `proxy.ts` in Next.js 16
**What goes wrong:** Following FE-03 / the spec literally creates `middleware.ts` with `export function middleware()`. In Next.js 16 the convention is `proxy.ts` exporting `proxy`, running on the **Node.js** runtime. A `middleware.ts` may be ignored or warn during the 16.x migration window.
**Why it happens:** Spec/requirements predate Next 16.1's rename.
**How to avoid:** Create `proxy.ts` with `export function proxy(req)`. Note this deviation in the plan/SUMMARY and (recommend) update FE-03's wording. Keep it optimistic-only.
**Warning signs:** Build warnings about deprecated `middleware`; protection not firing.

### Pitfall 2: `proxy.ts` cannot see the access token (it's in memory, not a cookie)
**What goes wrong:** Trying to read/verify the access JWT in `proxy.ts` for route protection — it isn't in cookies (spec keeps only the refresh token in an HttpOnly cookie; access token rides in the response body / `Authorization` header).
**Why it happens:** Mixing the cookie-session mental model with this header-bearer + HttpOnly-refresh model.
**How to avoid:** `proxy.ts` checks **presence of the refresh cookie** only; real validation (and permission/feature gating) happens after hydration via the DAL + guards. Ensure the MSW dev login handler sets the same cookie name.

### Pitfall 3: Tailwind 4 CSS-first — no `tailwind.config.js`
**What goes wrong:** Scaffolding with a JS config (Tailwind 3 habit) or three `@tailwind` directives; shadcn 2.3+ expects `@import "tailwindcss"` + `@theme inline`, OKLCH tokens, `@tailwindcss/postcss`, and `components.json` with `tailwind.config: ""`.
**How to avoid:** Use `globals.css` with `@import "tailwindcss";` and an `@theme inline { … }` block mapping CSS vars to tokens; configure PostCSS with `@tailwindcss/postcss`. Let `shadcn init` scaffold this.
**Warning signs:** Styles not applying; CLI complaining it can't find a Tailwind config; color mismatches (HSL vs OKLCH).

### Pitfall 4: Async `cookies()`/`headers()`/`params`/`searchParams` (Next 16)
**What goes wrong:** `const c = cookies()` crashes at runtime — Next 16 removed the sync fallback.
**How to avoid:** Always `const c = await cookies();` in Server Components, Route Handlers, and the DAL. `params`/`searchParams` props are Promises — `await` them. The login page reading `?tenant=` must `await searchParams`.

### Pitfall 5: ESLint boundary rule must actually target the components dir
**What goes wrong:** The `no-restricted-imports` rule from §7.2.3 lists `src/components/**/*` in its override, but the spec-dominant layout has `components/` at the `frontend/` root (no `src/`). If the override glob doesn't match the real path, the FE-08 boundary is unenforced.
**How to avoid:** Align the ESLint `overrides.files` glob with the chosen layout (Decision D1) — e.g. `components/**/*` for root layout. Add a CI check (a deliberately-bad import) or a unit assertion proving the rule fires. Also block bare `axios` imports outside `lib/api-client`.
**Warning signs:** A component importing `@/lib/repositories/...` lints clean.

### Pitfall 6: ESLint 9 flat config + Next/TypeScript plugins
**What goes wrong:** Next 16 scaffolds ESLint **9 flat config** (`eslint.config.mjs`); the spec's rule snippet is legacy `.eslintrc` JSON. Pasting it verbatim fails.
**How to avoid:** Translate the `no-restricted-imports` + `import/order` rules into flat-config form; keep `eslint-config-next` and the TS plugin. Verify `eslint` + `tsc --noEmit` both run clean (FE-08).

### Pitfall 7: MSW needs different integrations for dev vs test (and a generated worker file)
**What goes wrong:** Reusing one MSW setup everywhere; forgetting `public/mockServiceWorker.js`; MSW leaking into production.
**How to avoid:** `mocks/browser.ts` (`setupWorker`) started from a client `MSWProvider` **gated behind an env flag** (e.g. `NEXT_PUBLIC_ENABLE_MSW`/`NODE_ENV`); `mocks/server.ts` (`setupServer`) used in `vitest` setup (`server.listen()` / `resetHandlers()` / `close()`); shared `mocks/handlers.ts`. Run `msw init public/` to generate the worker. Never enable in prod builds.
**Warning signs:** 404s for `mockServiceWorker.js`; mocks active in `next build` output.

### Pitfall 8: schema-sync job path + tool availability
**What goes wrong:** The §P5.2.5 workflow hard-codes `frontend/lib/api-client/schemas/**` and `npx openapi-to-zod-check`. If the layout uses `src/`, the path is wrong; and `openapi-to-zod-check` may not be a real/maintained package.
**How to avoid:** Keep schemas at `frontend/lib/api-client/schemas/**` (root layout) so the spec path matches. **Verify `openapi-to-zod-check` exists** at plan time; if not, the schema-sync gate degrades to (a) `tsc --noEmit` on the schemas dir (always works) + (b) a documented placeholder for OpenAPI diffing. Backend OpenAPI specs are produced by SpringDoc (Phase 3+), so full cross-repo diffing may be a Phase-4 stub that hardens later. Flag as Decision D5.

### Pitfall 9: Coverage gates apply per-area, not globally
**What goes wrong:** Configuring one global Vitest/JaCoCo threshold misses the spec's **per-module** gates: finance/inventory ≥75%, others ≥60%, OPA 100% (§D1.4, §D2.1, PROJECT.md). In Phase 4 only the **frontend** and the already-built Java modules exist.
**How to avoid:** Frontend Vitest threshold ≥60% (it's an "other" area). Java JaCoCo per-module thresholds (auth/authz ≥70% per Phase-2 research; finance/inventory ≥75% when those phases land — the pipeline must support per-module config, not a single number). OPA `opa test policies/ --coverage` must equal 100%. Make the pipeline's gate config data-driven so later phases raise thresholds without rewriting it.

### Pitfall 10: cosign signing needs keys/OIDC + GHCR push
**What goes wrong:** `cosign sign` fails in CI without a key or keyless OIDC identity, or without GHCR write permissions.
**How to avoid:** Use cosign **keyless** (GitHub OIDC, `id-token: write` permission) signing against GHCR; or a `COSIGN_PRIVATE_KEY`/`COSIGN_PASSWORD` secret. Push tags `{sha}`, `{semver}`, `{branch}-latest` (§D1.4). Multi-arch (amd64+arm64) via `docker buildx`.

---

## Code Examples

Verified patterns. The four-layer reference implementations are transcribed/adapted from §P5.2 (cited inline); the proxy/MSW/Tailwind snippets are from current 2026 sources.

### Layer-1 axios client (transparent refresh) — adapt from spec
```typescript
// lib/api-client/client.ts — Source: Docs/.../Specification.md §P5.2.1
import axios, { AxiosError } from "axios";
import { getSession, refreshSession } from "@/lib/auth/session";
import { parseApiError } from "./errors";

export const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL,   // gateway, e.g. http://localhost:8080
  timeout: 30_000,
  withCredentials: true,                            // send the HttpOnly refresh cookie on /refresh
  headers: { "Content-Type": "application/json" },
});
apiClient.interceptors.request.use(async (config) => {
  const session = await getSession();
  if (session?.accessToken) config.headers.Authorization = `Bearer ${session.accessToken}`;
  config.headers["X-Request-Id"] = crypto.randomUUID();
  return config;
});
apiClient.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    if (error.response?.status === 401 && !(error.config as any)?._retry) {
      const ok = await refreshSession();              // POST /api/v1/auth/refresh (cookie)
      if (ok) { (error.config as any)._retry = true; return apiClient(error.config!); }
      if (typeof window !== "undefined") window.location.href = "/login?reason=session_expired";
    }
    return Promise.reject(parseApiError(error));
  }
);
```

### Repository with Zod-parse-before-adapt (the FE-07 contract)
```typescript
// lib/repositories/session.repository.ts — pattern from §P5.2.2
import { post, get } from "@/lib/api-client/request";
import { apiLoginSchema, apiMeSchema } from "@/lib/api-client/schemas/auth.schema";
import { adaptSession, adaptMe } from "@/lib/adapters/auth.adapter";
import { LoginBody, Session, CurrentUser } from "@/lib/models/auth.model";

export class SessionRepository {
  private static base = "/api/v1/auth";
  static async login(body: LoginBody): Promise<Session> {
    const raw = await post<LoginBody, unknown>(`${this.base}/login`, body);
    return adaptSession(apiLoginSchema.parse(raw));   // throws ZodError on shape drift
  }
  static async me(): Promise<CurrentUser> {
    const raw = await get<unknown>("/api/v1/me");
    return adaptMe(apiMeSchema.parse(raw));
  }
}
```

### Next 16 `proxy.ts` (optimistic) + server-only DAL
```typescript
// lib/auth/dal.ts — the REAL boundary (Source: Next 16 auth guidance 2026)
import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";

export const getServerSession = cache(async () => {
  const jar = await cookies();                 // MUST await in Next 16
  const refresh = jar.get("ros_refresh")?.value;
  if (!refresh) return null;
  // Optionally call gateway /api/v1/auth/refresh server-side to obtain a fresh access token,
  // or treat presence as "logged-in for SSR shell" and let the client hydrate the session.
  return { hasRefresh: true };
});
```

### MSW: dev worker + vitest server + a contract test
```typescript
// mocks/handlers.ts — Source: MSW v2 docs (2026) + spec §P5.2.7
import { http, HttpResponse } from "msw";
export const handlers = [
  http.post("/api/v1/auth/login", async ({ request }) => {
    const body = (await request.json()) as { totp_code?: string; email: string };
    // simulate conditional TOTP (FD-2)
    if (body.email === "owner@demo.local" && !body.totp_code) {
      return HttpResponse.json({ error: { code: "TOTP_REQUIRED", message: "TOTP required" } }, { status: 401 });
    }
    return HttpResponse.json(
      { data: { access_token: "test.jwt.token", expires_in: 900, user: { id: "u1", permissions: ["pos.order.create"] } } },
      { status: 200, headers: { "Set-Cookie": "ros_refresh=mock; HttpOnly; Path=/api/v1/auth; SameSite=Strict" } }
    );
  }),
];
// mocks/server.ts (vitest):  export const server = setupServer(...handlers)
// mocks/browser.ts (dev):    export const worker = setupWorker(...handlers)
```

### Tailwind 4 CSS-first entry (no JS config)
```css
/* app/globals.css — Source: shadcn Tailwind v4 docs (2026) */
@import "tailwindcss";
@import "tw-animate-css";
@custom-variant dark (&:is(.dark *));
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  /* …map shadcn tokens… */
}
:root { --background: oklch(1 0 0); --foreground: oklch(0.145 0 0); /* … */ }
.dark { --background: oklch(0.145 0 0); --foreground: oklch(0.985 0 0); /* … */ }
```

### GitHub Actions pipeline shape (transcribe §D1.4)
```yaml
# .github/workflows/ci.yml — Source: Specification §D1.4
name: CI
on: { pull_request: {}, push: { branches: [main] } }
jobs:
  lint:
    # Java: checkstyle/spotbugs/pmd ;  TS: eslint + prettier + tsc --noEmit ;  schema-sync
  test:
    # Java: mvn verify (JUnit5 + Testcontainers) with per-module JaCoCo gates
    # TS:   vitest run --coverage (MSW contract tests), threshold >=60%
    # OPA:  opa test policies/ --coverage  (==100%)
    # gates: finance/inventory >=75%; others >=60%; OPA 100%
  build:
    permissions: { contents: read, packages: write, id-token: write }  # id-token for cosign keyless
    # docker buildx (amd64+arm64) -> push GHCR {sha},{semver},{branch}-latest -> cosign sign
  schema-sync:
    # tsc --noEmit on frontend/lib/api-client/schemas + openapi-to-zod-check (verify tool exists)
```

---

## State of the Art

| Old Approach (spec wording) | Current Approach (2026) | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `middleware.ts` / `export function middleware` | `proxy.ts` / `export function proxy`, Node runtime | Next.js 16.1 | **FE-03 must target `proxy.ts`** |
| Sync `cookies()`/`headers()`/`params` | async (`await`) — sync fallback removed | Next.js 15→16 | DAL/login page must `await` |
| `tailwind.config.js` + `@tailwind base/components/utilities` | CSS-first `@import "tailwindcss"` + `@theme inline`, OKLCH | Tailwind 4 | no JS config; shadcn 2.3+ expects it |
| shadcn with `forwardRef`, HSL tokens, `default` style | no `forwardRef`, `data-slot`, OKLCH, `new-york` default, `sonner` (toast deprecated) | shadcn 2.3 / React 19 | use new-york + sonner |
| `.eslintrc` JSON | ESLint 9 flat config (`eslint.config.mjs`) | ESLint 9 / Next 16 | translate the boundary rule |
| Middleware as auth boundary | optimistic redirect + server-only DAL | CVE-2025-29927 (2025) | never trust proxy for security |
| Jest | Vitest (`vitest run --coverage`) | spec choice | test runner = Vitest |

**Deprecated/outdated to avoid:** `tailwind.config.js`; sync request APIs; `forwardRef` in new components; the shadcn `toast` (use `sonner`); legacy `.eslintrc` JSON; assuming `middleware.ts` in Next 16.

---

## Open Questions / Decisions for the Planner

1. **D1 — `frontend/` root layout vs `src/`.** Spec import paths (`@/lib/api-client/schemas`) and the schema-sync CI path (`frontend/lib/api-client/schemas/**`) imply **no `src/`**; the coding-standards ESLint override references `src/components/**`. *Recommendation:* use the **`frontend/` root layout (no `src/`)** so the documented paths and schema-sync workflow match verbatim; fix the ESLint override glob to `components/**` accordingly. (Self-consistent; lowest friction with the spec's reference code.)

2. **D2 — FE-03 route protection mechanism.** *Recommendation:* implement `proxy.ts` (optimistic refresh-cookie presence redirect) + a server-only `lib/auth/dal.ts` for real validation; document the `middleware.ts→proxy.ts` deviation and suggest updating FE-03 wording. Protected groups: `(platform)`, `(tenant)`; public: `(auth)`.

3. **D3 — Refresh cookie name + login response contract.** Spec says "HttpOnly refresh cookie" and shows the access JWT in the body but does not name the cookie or pin the exact `LoginResponse` JSON for the frontend. *Recommendation:* define a Zod `apiLoginSchema` for `{ access_token, expires_in, user{...} }`, choose a cookie name (e.g. `ros_refresh`), and make MSW set it; confirm against auth-service's actual Set-Cookie (Phase 2 `02-01-SUMMARY` / `AuthServiceImpl`) before integrating live.

4. **D4 — Feature-flag source for `FeatureGuard`.** Feature flags are NOT in the JWT (gateway-enforced via `tenant_features`). *Recommendation:* add a `useFeatureFlags()` hook backed by a repository hitting a `GET /api/v1/me` or `/tenants/me/features` endpoint (returning enabled `FEATURE_*`), mocked by MSW in Phase 4; flag the endpoint as a contract to confirm/define with Phase 3. `PermissionGuard` reads `permissions[]` from decoded JWT claims (no extra call).

5. **D5 — `schema-sync` tooling.** The `openapi-to-zod-check` package in the spec workflow is unverified. *Recommendation:* implement schema-sync as (a) `tsc --noEmit` over `frontend/lib/api-client/schemas` (always works, satisfies FE-08's "schemas typecheck") plus (b) a best-effort OpenAPI↔Zod diff if a maintained tool exists at plan time; otherwise document a placeholder. Backend OpenAPI (SpringDoc) availability is a Phase-3+ dependency, so full cross-repo diffing may harden in a later phase.

6. **D6 — E2E (Playwright) scope.** §D1.4 runs ~50 Playwright journeys **against staging**, which spans every later phase. *Recommendation:* Phase 4 scaffolds the Playwright config + the `e2e` job wiring and maybe 1–2 smoke journeys (login redirect), but the full journey suite is explicitly cross-phase, not a Phase-4 deliverable. Confirm INFRA-05's "no manual intervention" is satisfied by the lint→test→build→schema-sync core (the promote-prod gate is a manual GitHub approval **by design**, §D1.4).

7. **D7 — Scope guards for later-phase features.** §P5.2.6 offline queue (Workbox/IndexedDB) is **POS Phase 7**; charts (Recharts) are **Phase 12**; TanStack Table-heavy lists are module phases. *Recommendation:* the shell may declare the `OfflineQueueRepository` *type/interface* for completeness but should not implement the Service Worker. Keep Phase 4 to the shell + auth domain + guards + CI.

---

## Sequencing / Dependency Notes (for the 2 plans)

- **04-01 (Next.js shell)** lands first and is self-contained via MSW: scaffold (Next 16 + Tailwind 4 + shadcn, Decisions D1/D3), four-layer abstraction instantiated for the auth/session/me domain (FE-02/07), `proxy.ts` + DAL route protection (FE-03/D2), login + conditional TOTP (FE-04), Sidebar + BranchSwitcher + Feature/Permission guards (FE-05/06/D4), ESLint boundary + strict tsc (FE-08), MSW dev+test + Vitest contract tests (FE-07). Does **not** require a running gateway/auth-service.
- **04-02 (CI/CD)** wires GitHub Actions (INFRA-05): lint (eslint+prettier+`tsc --noEmit`, Java checkstyle/spotbugs/pmd), test (Vitest coverage ≥60%, Java per-module JaCoCo, OPA 100%), build (buildx multi-arch + cosign-signed GHCR images), schema-sync (D5). Can be developed in parallel with 04-01 but its frontend test/lint steps depend on 04-01's package scripts existing; sequence 04-01 → 04-02 (or land the FE `package.json` scripts early).
- **Cross-cutting:** This phase completes the Sprint-1 "GO" set (PROJECT.md Key Decisions). Live integration against Phase 2/3 services is validated later (staging e2e); Phase 4 proves the shell against mocks.

---

## Sources

### Primary (HIGH confidence)
- `Docs/RestaurantERP_SaaS_Specification.md` §P5.1 (frontend stack), §P5.2.1–P5.2.8 (four-layer abstraction + full reference code, schema registry, offline queue, MSW tests, conventions), §P5.7 (delivery: GHCR/GitHub Actions/Nginx), §P7.1 (token strategy, JWT payload, login flow, password policy), §"Feature Flag Enforcement"/§CC.6 (`tenant_features`, `@RequiresFeature`), §D1.4 (CI/CD pipeline), §D2.1–D2.2 (coverage gates, frontend testing), §"A08 Software Integrity" (cosign).
- `Docs/RestaurantERP_UserStories_FlowDiagrams.md` §FD-2 (auth & token flow, conditional TOTP, tenant-slug resolution), AC1–AC4 (login/branch-switch acceptance).
- `Docs/agent-specs/07-coding-standards.md` §7.2 (TS/React file naming, import order, `no-restricted-imports` boundary, state mgmt, money display, strict/no-`any`), §7.4 (error-code catalogue).
- `Docs/agent-specs/05-environment-variables.md` (`NEXT_PUBLIC_API_BASE_URL`/`WS_BASE_URL`/`GLITCHTIP_DSN`; JWT TTLs).
- `.planning/PROJECT.md` (tech-stack constraints, quality gates), `.planning/ROADMAP.md` Phase 4 (goal, success criteria, 2-plan split), `.planning/REQUIREMENTS.md` FE-01..08, INFRA-05.
- `.planning/phases/02-authentication-authorization/02-RESEARCH.md` + `02-01-PLAN.md` (auth contracts the FE consumes: JWT claims, refresh cookie, branch switch; RESEARCH.md format/depth template).
- On-disk verification: no `frontend/`, `package.json`, `next.config.*`, or `tsconfig.json` exist (Glob); `gateway/` Phase-3 scaffold and `deploy/nginx/nginx.conf` are present (git status).

### Secondary (MEDIUM confidence — current 2026 web sources, cross-verified)
- Next.js 16 `middleware.ts → proxy.ts` rename, Node runtime, async `cookies()`/`headers()`, optimistic-proxy + DAL pattern, CVE-2025-29927 (WorkOS "Next.js App Router authentication guide 2026"; dev.to migration guides; iurii.rogulia.fi migration guide) — multiple independent sources agree.
- shadcn/ui + Tailwind 4 + React 19 setup (CSS-first `@theme inline`, OKLCH, `new-york`, `@tailwindcss/postcss`, `components.json` `tailwind.config:""`, `sonner`) — official shadcn Tailwind-v4 docs + GitHub discussion #6714 + CREA.MBA Next-16 styling guides.
- MSW v2 dev (`setupWorker`) vs vitest (`setupServer`) integration, `msw init public/`, env-gated provider, Next 16 example (`laststance/next-msw-integration`: Next 16 / React 19 / MSW 2.12 / Vitest 4 / Tailwind 4) — official MSW docs + reference repo.

### Tertiary (LOW confidence — verify at plan time)
- Exact current patch versions (Next 16.2.x, React 19.2.x, Tailwind 4.1.x, MSW 2.12+) — pin via the package manager at scaffold.
- `openapi-to-zod-check` existence/maintenance — must be verified before relying on it for schema-sync (Decision D5).

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library is spec-named; versions cross-checked against 2026 sources (pin exact patches at scaffold).
- Architecture (four-layer, route groups, guards): HIGH — full reference code in §P5.2 + §7.2 conventions.
- Auth integration mechanics: HIGH for the JWT/refresh/TOTP/branch-switch contracts (spec §P7.1 / FD-2); MEDIUM for the `proxy.ts` realisation (spec lags Next 16 — verified via current sources).
- CI/CD: HIGH for the pipeline shape (§D1.4) and gates (§D2.1); MEDIUM for `schema-sync` tooling and cosign keyless specifics.
- Pitfalls: HIGH — derived from spec + verified Next 16 / Tailwind 4 / MSW current behaviour and on-disk reality (greenfield).

**Research date:** 2026-06-25
**Valid until:** ~2026-07-25 for the spec-pinned facts; ~2026-07-09 for the fast-moving frontend stack (Next 16 / Tailwind 4 / shadcn / MSW move quickly — re-verify versions and the proxy/middleware convention at plan time).
