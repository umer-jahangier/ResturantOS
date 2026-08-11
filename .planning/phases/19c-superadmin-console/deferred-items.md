# Deferred items — Phase 19c

Found while building the SuperAdmin console. None of these are fixed here: each is either outside
this phase's file ownership or outside the current task's scope, and the SCOPE BOUNDARY rule says
log rather than fix.

---

## 1. A SuperAdmin cannot reload, deep-link, or open a platform page in a new tab

**Severity: high — it makes the console this phase just built awkward to use.**

Measured live:

```
$ curl -D - -o /dev/null -X POST /api/v1/auth/login -d '{"email":"superadmin@…"}'
Set-Cookie: refresh_token=;         Path=/api/v1/auth; Max-Age=604800; HttpOnly; SameSite=Strict

$ curl -D - -o /dev/null -X POST /api/v1/auth/login -d '{"email":"manager@terrace.local",…}'
Set-Cookie: refresh_token=eyJhbGci…  Path=/api/v1/auth; Max-Age=604800; HttpOnly; SameSite=Strict
```

The platform login sets an **empty** refresh token. The access token is memory-only by design, so
any full document load has nothing to rehydrate from: `SessionProvider` calls `/auth/refresh`, the
empty cookie fails, and the browser lands on `/login?reason=session_expired`.

Reproduced in a browser: sign in as SuperAdmin, then `page.goto('/platform/tenants/{id}')` →
"Your session expired. Please sign in again."

13-05 states a platform session deliberately has no refresh token ("it re-authenticates rather than
refreshes, so no long-lived platform credential exists to be stolen"). That is a defensible posture
whose browser consequence was never worked through — before 16a-01 the SuperAdmin had no browser
path at all, so nothing depended on the session surviving a reload.

**Owner:** auth-service (not this phase's). **Pinned by:** `superadmin-console.spec.ts` test F,
which asserts the empty cookie and instructs the reader to delete it once a real token appears.
**Workaround in place:** every platform screen is reached by client-side navigation.

---

## 2. `platformNavItems` still marks `/platform/tenants` as `comingSoon` (GA-053)

`components/shared/sidebar-nav-items.ts:355-360` carries `comingSoon: true` with a comment saying
"Phase 21 builds this screen". The screen is built. The flag should be dropped and the
`platform:tenant:read` / `platform:admin` entries pointed at the live routes.

Not changed here: that file is owned by a concurrent workstream. It has zero application-code
consumers today (the console ships its own nav in `components/platform/platform-shell.tsx`), so the
stale flag is currently inert.

---

## 3. `/api/v1/pos/tills` returns 403 PERMISSION_DENIED for OWNER and WAITER on their dashboard

Two pre-existing journey failures, unrelated to this phase and in another workstream's area:

```
role-visibility-matrix › OWNER sees exactly its permitted navigation   ✘
role-visibility-matrix › WAITER sees exactly its permitted navigation  ✘

403 GET /api/v1/pos/tills?cashierId=…&status=OPEN
{"error":{"code":"PERMISSION_DENIED", …}}
```

An OWNER being refused their own tills is a permission-catalog gap, not a feature-flag one — this
phase changed nothing in POS or RBAC. The rest of that spec (including
`OWNER is refused /platform/dashboard`) passes.

---

## 4. audit-service (8093) and nlq-service (8094) answer nothing while listed UP

`curl /actuator/health` → `000` on both, for the whole of this phase's work. This is GA-102, already
recorded. It is why the tenant detail screen ships no Audit tab: `GET /api/v1/audit/events` cannot
be called, and a tab whose only behaviour is an error is worse than no tab.

---

## 5. Usage metering still has zero producers

This phase built the **read** side (`GET .../usage`) and fixed the two write-side defects
(GA-051 sum-vs-count, GA-052 the `Long.MAX_VALUE` limit). It did not add producers, because that
means touching every metered service — all of which belong to other workstreams.

Until a producer exists the console honestly reports three of four dimensions as "Not metered".
The remaining work, per resource:

| Resource | What is needed |
|---|---|
| `users` | auth-service must expose a per-tenant user count; `users` lives in auth_db and has none |
| `storage_gb` | file-service must emit usage on upload/delete |
| `nlq_queries` | nlq-service must increment `nlq_quota:{tenantId}:monthly_count`, which the gateway already throttles against |
| `branches` | **done** — real live count via user-service |

---

## 6. Impersonation and tenant-user password reset still have no UI (GA-084)

`POST .../tenants/{id}/impersonate` and `POST .../tenants/{tid}/users/{uid}/reset-password` both
exist and are SUPER_ADMIN-gated. Neither has a screen.

Deliberately out of scope here. UI-SPEC §7.5 requires impersonation to carry a persistent
non-dismissable `--danger` banner **across every screen** reading "Impersonating {tenant} · {reason}
· [Exit impersonation]". That banner has to live in the tenant shell — `app/(tenant)/layout.tsx` —
which another workstream owns this cycle. Shipping the button without the banner would let an
operator act as somebody else with no standing indication that they are doing so, which is worse
than not shipping it.
