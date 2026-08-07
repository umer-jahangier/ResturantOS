# Gap audit — SuperAdmin platform console

**Audited** 2026-08-07 · branch `phase-13-access-repair` · live stack (frontend :3000, gateway :8080)
**Method** platform token obtained directly via `POST /api/v1/platform/auth/login`; backend surface
read from source; every frontend route probed over HTTP; rendered markup inspected; console and
network log read in-browser.

---

## Verdict in one line

**The SuperAdmin platform console does not exist.** `frontend/app/(platform)/` is two files and 23
lines of code. Fourteen SuperAdmin-facing backend endpoints shipped in plan 13-14 and **zero of them
have a UI**. Usage-against-entitlement is not merely missing from the UI — the data is never
collected, has no read endpoint, and the one aggregate query written for it has no callers.

The three capabilities the user named — subscriptions, allowed features, per-feature usage — score
**backend-only, backend-only, and not-built-at-all** respectively.

---

## 1. Which backend capabilities have a UI at all

**None. 0 of 14.**

The entire `(platform)` route group:

```
frontend/app/(platform)/layout.tsx                    14 lines — a header, no nav
frontend/app/(platform)/platform/dashboard/page.tsx    9 lines — a placeholder
```

Rendered output of the only page that resolves (`curl -b has_session=1 http://localhost:3000/platform/dashboard`):

```
RestaurantOS · Platform Admin  Platform Dashboard  SuperAdmin shell placeholder.
anchors: []      <nav> elements: 0
```

| # | Capability | Endpoint (file:line) | Live check | UI |
|---|---|---|---|---|
| 1 | Create tenant (provisioning saga) | `POST /tenants` — `PlatformAdminController.java:61` | — | **none** |
| 2 | List tenants | `GET /tenants` — `:80` | **200**, 8 tenants | **none** |
| 3 | Get one tenant | `GET /tenants/{id}` — `:91` | — | **none** |
| 4 | Edit subscription (`billingRef`, `trialEndsAt`, `renewsAt`) | `PATCH /tenants/{id}` — `:105` | — | **none** |
| 5 | **Change tier** | `POST /tenants/{id}/tier` — `:122` | — | **none** |
| 6 | Retry failed provisioning | `POST /tenants/{id}/retry-provisioning` — `:144` | — | **none** |
| 7 | **Suspend tenant** | `POST /tenants/{id}/suspend` — `:157` | — | **none** |
| 8 | Reactivate tenant | `POST /tenants/{id}/reactivate` — `:165` | — | **none** |
| 9 | Cancel tenant | `POST /tenants/{id}/cancel` — `:171` | — | **none** |
| 10 | Purge tenant | `DELETE /tenants/{id}` — `:179` | — | **none** |
| 11 | Read feature flags | `GET /tenants/{id}/features` — `:187` | **200**, 20 codes | **none** |
| 12 | **Toggle a feature** | `PATCH /tenants/{id}/features/{code}` — `:192` | — | **none** |
| 13 | Impersonate a tenant user | `POST /tenants/{id}/impersonate` — `:225` | — | **none** |
| 14 | Reset a tenant user's password | `POST /tenants/{id}/users/{uid}/reset-password` — `PlatformUserAdminController.java:90` | — | **none** |

All paths relative to `/api/v1/platform`, in
`services/platform-admin-service/src/main/java/io/restaurantos/platform/controller/`.

**The frontend contains no client for any of them.** Every occurrence of the string
`api/v1/platform` in `frontend/` lives under `e2e/` (test fixtures). `app/`, `lib/`, `components/`
and `hooks/` contain zero.

Observed live, proving the backend half is real and only the UI is absent:

```
GET /api/v1/platform/tenants           → 200  (8 tenants incl. floating-terrace, ENTERPRISE)
GET /api/v1/platform/tenants/{id}/features → 200  (20 FEATURE_* codes, all true)
POST /api/v1/platform/auth/login       → 200  (SUPER_ADMIN, token_type=platform)
```

---

## 2. Is usage-against-entitlement visible anywhere?

**No — and it is worse than a missing screen. The number does not exist to be shown.**

Four independent breaks, each verified:

**(a) No read endpoint.** The public API has no usage route at all. Probed with a valid platform
token against `floating-terrace`:

```
GET /api/v1/platform/tenants/{id}/usage          → 404
GET /api/v1/platform/tenants/{id}/usage-summary  → 404
GET /api/v1/platform/tenants/{id}/entitlements   → 404
GET /api/v1/platform/tenants/{id}/limits         → 404
```

The only usage route in the codebase is `POST /internal/platform/tenants/{tenantId}/usage`
(`PlatformInternalController.java:106`) — service-to-service, **write-only**.

**(b) Nothing ever writes to it.** Grepping every service, gateway and shared-lib for
`/internal/platform` returns consumers of `/status`, `/features`, `/auth/verify` and `/slug` — and
**no consumer of `/usage`**. Confirmed against the live database:

```sql
platform_db=# select resource, count(*), sum(qty) from usage_records group by resource;
(0 rows)
```

**(c) The recorder returns the wrong number.** `UsageService.java:41` returns
`countByTenantIdAndResource` — the **row count** — where the caller and the DTO field name
(`newCount` → a running total) mean the summed quantity. Record a delta of 5 then a delta of 3 and
the API reports `2`. The correct aggregate exists one file away and is **dead code**:
`UsageRecordRepository.java:17` `sumQtyByTenantIdAndResource` has zero callers anywhere in the repo.
`UsageService.getTotal` (`UsageService.java:44`) likewise has zero callers.

**(d) The limit half is a hardcoded sentinel.** `PlatformInternalController.java:111`:

```java
return ResponseEntity.ok(ApiResponse.ok(new UsageRecordResponse(newCount, Long.MAX_VALUE)));
```

The response's `limit` field — the entitlement side of "usage against entitlement" — is
`Long.MAX_VALUE`, never the tenant's actual tier ceiling. The real ceilings live on the tenant row
(`maxBranches`, `maxUsers`, `storageGb`, `nlqQuota`, set by `TierLimits.java:37-44`) and are
returned by `GET /tenants`, but **no UI file reads any of those four field names** — grepping
`app/ components/ lib/` for `maxBranches|maxUsers|storageGb|nlqQuota|entitlement` returns nothing.
The only `quota` in the frontend is `components/nlq/NlqRejectionNotice.tsx:60`, which renders a 429
*after* the user is already blocked — a reactive error toast, not a usage display.

**The single usage-vs-limit comparison that exists in the whole system** is
`TenantSubscriptionService.usageViolations` (`TenantSubscriptionService.java:226`). It runs only at
tier-change time, checks **branches only** (the class comment at `:209-218` admits users, storage
and NLQ are unchecked because auth-service exposes no headcount), and its result is never surfaced
to any UI.

---

## 3. Are tenant creation, suspension and tier change reachable from the browser?

**No. All three are unreachable.** Route probe, `has_session` marker cookie set so the proxy admits
the request:

| URL | Status |
|---|---|
| `/platform/dashboard` | **200** — placeholder, 0 anchors, 0 `<nav>` |
| `/platform` | **404** |
| `/platform/tenants` | **404** |
| `/platform/tenants/{id}` | **404** |
| `/platform/subscriptions` | **404** |
| `/platform/features` | **404** |
| `/platform/usage` | **404** |

### The nav is dead twice over

`components/shared/sidebar-nav-items.ts:354-367` exports `platformNavItems`:

```ts
export const platformNavItems: NavItem[] = [
  { label: "Tenants", href: "/platform/tenants", icon: Building2, permission: "platform:tenant:read" },
  { label: "Platform Admin", href: "/platform/dashboard", icon: ShieldCheck, permission: "platform:admin" },
];
```

1. `/platform/tenants` **404s** — the destination was never built.
2. `platformNavItems` has **zero consumers in application code** (only `e2e/` references it), and
   `app/(platform)/layout.tsx` renders a bare `<header>` with no navigation. So the dead link never
   even renders — a SuperAdmin who reaches the dashboard sees no navigation at all and has no route
   out of it.

The repo already knows: `frontend/e2e/fixtures/known-defects.ts:209-227` records this as **E2E-D3**,
and `e2e/journeys/superadmin-tenant-lifecycle.spec.ts:9-23` states the journey drives the API
instead of the UI "because there is no SuperAdmin UI to drive".

---

## 4. Login status (context, not a new finding)

The SuperAdmin still cannot reach the console through a browser. The login form posts to the
**tenant** endpoint, which rejects the platform credential:

```
POST /api/v1/auth/login   {"email":"superadmin@softxlogic.com","password":"Test@123!"}
  → 401 {"error":{"code":"UNAUTHENTICATED","message":"Invalid credentials"}}

POST /api/v1/platform/auth/login   (same credential)
  → 200 {"data":{"accessToken":"…","role":"SUPER_ADMIN","tokenType":"platform"}}
```

Control, proving auth-service is healthy rather than down:
`owner@terrace.local` + `Terrace#Owner1` + `floating-terrace` → **401 `TOTP_REQUIRED`** (the
credential verified; only the second factor is missing).

This is the in-flight 16a-01 unified-login work — `PlatformCredentialClient` and
`LoginIdentityResolver` are present in the running jar (rebuilt 07:27 **during** this audit), and
`proxy.ts:26-38` has already removed the `?tenant=` force-redirect. **Excluded from the gap list as
known and being fixed.** It is recorded here only because it compounds everything above: even when
the login lands, it lands on a placeholder.

### Environment note

`AUTH-SERVICE` was `DOWN` in Eureka at audit start; the process was alive but not serving on :8081
(health endpoint returned 200 from a stale instance while the port was dead — the failure mode
already tracked as "services wedge while /actuator/health still returns 200"). Restarted; all
findings above were re-verified afterwards.

---

## Findings

| ID | Title | Kind | Severity | Effort |
|---|---|---|---|---|
| SA-1 | Entire SuperAdmin console is a 9-line placeholder — 14 endpoints, 0 UI | BACKEND_NO_UI | BLOCKER | 12d |
| SA-2 | Per-feature usage is never recorded — 0 producers, 0 rows, no read endpoint | NEITHER_EXISTS | BLOCKER | 8d |
| SA-3 | Tier change / subscription editing unreachable from the browser | BACKEND_NO_UI | BLOCKER | 4d |
| SA-4 | Feature toggles unreachable from the browser | BACKEND_NO_UI | BLOCKER | 3d |
| SA-5 | Tenant creation, suspension, cancel, purge unreachable from the browser | BACKEND_NO_UI | HIGH | 4d |
| SA-6 | `/platform/tenants` nav item 404s, and the nav never renders | DEAD_LINK | HIGH | 0.5d |
| SA-7 | `UsageService.record` returns a row count where a summed quantity is meant | BROKEN_AT_RUNTIME | HIGH | 0.5d |
| SA-8 | Usage `limit` hardcoded to `Long.MAX_VALUE` instead of the tier ceiling | DATA_MISSING | HIGH | 1d |
| SA-9 | Entitlement ceilings returned by the API are read by no UI | DATA_MISSING | MEDIUM | 2d |
| SA-10 | Impersonation and tenant-user password reset have no UI | BACKEND_NO_UI | MEDIUM | 3d |

**Total ≈ 38 engineer-days** to make the console match the shipped backend.

### Suggested build order

1. **SA-6** (0.5d) — delete the dead nav entry or ship the page; stop advertising a 404.
2. **SA-3 + SA-5** (8d) — a tenant list and detail screen. This single screen unlocks create,
   suspend, reactivate, cancel, purge, tier change and subscription editing, because all seven
   endpoints already work and only need a form.
3. **SA-4** (3d) — a feature-toggle panel on the tenant detail screen.
4. **SA-7 + SA-8 + SA-2** (9.5d) — fix the aggregate, wire the real limit, then add producers in the
   domain services. Ordering matters: shipping a usage UI before producers exist would render zeros
   and read as a working screen.
5. **SA-9 + SA-10** (5d).
