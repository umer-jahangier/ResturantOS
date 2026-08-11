# Phase 19c — SuperAdmin Platform Console

## What this phase is

The platform control plane has fourteen working endpoints and no browser. `app/(platform)`
is 23 lines across two files — a header that says "RestaurantOS · Platform Admin" and one
sentence reading "SuperAdmin shell placeholder." Zero anchors, zero `<nav>`, zero calls to
`/api/v1/platform/**` outside `frontend/e2e/`.

Every plan in this repository that says "a SuperAdmin enables the flag" has, until now, been
describing a `curl`.

This phase builds the console, and fixes the two things about the backend that made a truthful
console impossible to write.

## The defects this closes

| ID | What | Evidence gathered live before writing any code |
|---|---|---|
| **GA-010** | Entire SuperAdmin console is a placeholder — 14 endpoints, 0 UI | `app/(platform)/platform/dashboard/page.tsx` (9 lines) + `layout.tsx` (14 lines) is the whole console |
| **GA-002** (platform variant) | `/platform/**` is *authenticated* but not *authorized* | `proxy.ts:51-58` gates the prefix on the presence of the `has_session` cookie and nothing else. `has_session` is non-HttpOnly, forgeable, and set for **every** logged-in user. A KITCHEN_STAFF session renders the SuperAdmin shell |
| **GA-049** | Feature toggles unreachable from the browser | `PATCH .../features/{code}` returns 200 live; no frontend caller exists |
| **GA-050** | Provision / suspend / reactivate / cancel unreachable | all five endpoints live; `/platform/tenants` → 404 |
| **GA-048** | Tier change + subscription editing unreachable | `POST .../tier` and `PATCH .../tenants/{id}` both live |
| **GA-051** | `UsageService.record` returns a row **count** where a summed **quantity** is meant | `UsageService.java:41` returns `countByTenantIdAndResource`. Record delta 5 then delta 3 → reports `2` |
| **GA-052** | Usage response hardcodes `limit` to `Long.MAX_VALUE` | `PlatformInternalController.java:111`. The real ceiling is on the tenant row and set by `TierLimits` |
| **GA-083** | Entitlement ceilings returned by the API, read by no UI | `maxBranches`/`maxUsers`/`storageGb`/`nlqQuota` come back on every tenant; grepping the frontend for all four → zero matches |

## The finding that shaped the backend work

**`GET /api/v1/platform/tenants/{id}/features` returns a bare `Map<String,Boolean>`.**
Verified live against the running gateway:

```
$ curl .../platform/tenants/5ae760de-.../features
{"data":{"features":{"FEATURE_CRM":false,"FEATURE_ANALYTICS":false, ...}}}
```

`FEATURE_CRM: false` and `FEATURE_ANALYTICS: false` are byte-identical in that response. In the
database they are **not the same fact**:

```
$ psql platform_db -c "select t.slug, f.feature_code, f.is_enabled, f.is_override
                        from tenant_features f join tenants t on t.id=f.tenant_id
                        where f.is_override = true"

                 slug                 | feature_code | is_enabled | is_override
--------------------------------------+--------------+------------+-------------
 control-bistro-isolation-test-tenant | FEATURE_CRM  | f          | t
 marina-bay-dining                    | FEATURE_CRM  | t          | t
 saffron-grill                        | FEATURE_NLQ  | t          | t
 zaitoon-kitchen                      | FEATURE_CRM  | f          | t
(4 rows)
```

`FEATURE_CRM` on control-bistro is **off because an operator turned it off**. `FEATURE_ANALYTICS`
is off because STARTER does not include it. Plan 13-14 added `tenant_features.is_override`
precisely so tier reconciliation would neither wipe a deliberate override nor refuse to disable
anything — and `FeatureFlagAdminService.reconcileToTierDefaults` reads it correctly, skipping
override rows in **both** directions.

But the API never exposes the column. So the console cannot render the one distinction the column
exists to carry, and UI-SPEC §7.5's explicit requirement — *"'Inherit tier (on)' and 'Force on'
must be visually distinguishable at a glance, because the difference determines what happens when
the tenant's plan changes"* — is unimplementable against the current response shape.

**Four rows of real, deliberate operator intent are invisible to every client.** That is the gap
this phase closes on the backend.

### How it is extended

Additively, and only on the SuperAdmin-facing endpoint.

`/internal/platform/tenants/{id}/features` is consumed by the **gateway** (`PlatformAdminClient`),
by `FeatureFlagPublicController`, and by three assertions in `TenantSubscriptionIT`. Its
`FeaturesResponse(Map<String,Boolean>)` shape is left untouched — changing it to serve a console
would be trading a working enforcement path for a screen.

The public endpoint keeps its `features` map (so `phase13-subscription-e2e.sh:409`'s
`assert_contains "\"${OVERRIDE_CODE}\":true"` and the Playwright journey's `toContain("FEATURE_")`
both still pass) and **gains** `tier` and a `featureStates` array carrying, per code:
`enabled` · `tierDefault` · `isOverride` · `source`.

`source` is the derived answer to the question the screen actually asks:

| `source` | Meaning |
|---|---|
| `TIER_DEFAULT` | no override; value equals the tier's default |
| `OVERRIDE_MATCHES_TIER` | operator set it, but it happens to agree with the tier — reverting changes nothing today, yet still survives the next tier change |
| `OVERRIDE_GRANT` | operator switched ON something the tier does not include |
| `OVERRIDE_REVOKE` | operator switched OFF something the tier does include |
| `UNSEEDED` | a code the tier matrix knows about with no row for this tenant |

Deriving it server-side rather than in the browser is deliberate: the tier→default matrix
(`TierFeatureDefaults`) is backend state that the frontend would otherwise have to duplicate, and
a duplicated matrix drifts the day a code moves tier.

## Usage against entitlement — what actually exists

The instruction was to check whether any usage data exists before building a usage screen. It was
checked, twice, and the answer is worse than "none":

```
$ psql platform_db -c "select count(*) from usage_records;"
 usage_rows
------------
          0

$ redis-cli --scan --pattern 'nlq_quota:*' | wc -l
       0
```

`usage_records` has zero rows and, per the audit, zero producers — grep for `/internal/platform`
finds consumers of `/status`, `/features`, `/auth/verify` and `/slug`, and **no consumer of
`/usage`**. The NLQ monthly counter the gateway enforces against
(`nlq_quota:{tenantId}:monthly_count`) has zero keys.

Additionally, all four read paths a console would want are absent — confirmed live with a valid
SUPER_ADMIN token:

```
GET /api/v1/platform/tenants/{id}/usage           → HTTP 404
GET /api/v1/platform/tenants/{id}/usage-summary   → HTTP 404
GET /api/v1/platform/tenants/{id}/entitlements    → HTTP 404
GET /api/v1/platform/tenants/{id}/limits          → HTTP 404
GET /api/v1/platform/usage                        → HTTP 404
```

**So no number is invented.** `GET .../usage` is built against the real shape, and the response
distinguishes three states that a naive implementation collapses into the single lie `0`:

- **`used: 0`, `metered: true`** — this resource is genuinely metered and nothing has happened yet.
- **`used: null`, `metered: false`** — nobody records this. The screen says *"Not metered"*, never `0`.
- **`used: null`, `unavailable: true`** — the count exists somewhere but could not be read right
  now. Same posture as 13-03's tenant status: **undeterminable is not zero and not permissive**.

Exactly one dimension is really countable today: **branches**, via
`GET /internal/users/tenants/{id}/branches`, which `TenantSubscriptionService.usageViolations`
already relies on for the downgrade check. Users are a named gap in that same method's javadoc
(auth_db owns `users` and auth-service exposes no tenant count), storage has no meter, and NLQ has
a counter with nothing writing to it.

The screen therefore shows one real meter and three honest "not metered" rows. That is the correct
outcome. A dashboard showing four fabricated numbers would be actively harmful — decisions get
made on it.

## The authorization gap, precisely

`proxy.ts` is explicit that it is not a security boundary, and it is right. The real chain is:

1. `proxy.ts` — first-pass redirect for browsers with no cookie
2. `SessionProvider` — proves the session by exchanging the HttpOnly refresh token
3. Gateway — refuses `/api/v1/platform/**` without `SUPER_ADMIN`

Step 3 is real and working, which is why **no tenant data leaks**. But nothing in that chain asks
*"is this principal a platform principal?"* before rendering the console, so a KITCHEN_STAFF who
navigates to `/platform/dashboard` gets the SuperAdmin shell — with every panel wired to an API
that will 403. The user sees a control plane they are not entitled to see, full of red errors.

The fix belongs in `app/(platform)/layout.tsx`, not in `proxy.ts`:

- The layout is inside this phase's ownership boundary; `proxy.ts` is shared.
- The layout is where the session is actually known. `proxy.ts` runs before any token exists —
  the access JWT is memory-only and the refresh cookie is scoped to `Path=/api/v1/auth`, so the
  proxy **cannot** read a role even in principle. Any role check there would have to trust a
  forgeable cookie, which is how this class of bug is created rather than fixed.

A platform session is identified by `tokenType === "platform"` **and** the `SUPER_ADMIN` role
claim, both taken from the RS256-verified access token. Both are required: `tokenType` alone would
admit a future platform role that is not SuperAdmin, and the role alone would admit a tenant token
that somehow carried the claim.

## Ownership

Written by this phase: `frontend/app/(platform)/**`, `frontend/components/platform/**`,
`frontend/lib/repositories/platform*.ts`, `frontend/lib/hooks/use-platform*.ts`,
`services/platform-admin-service/**`, `frontend/e2e/journeys/superadmin-console.spec.ts`,
`.planning/phases/19c-superadmin-console/**`.

Four other agents are concurrent. Two shared files this phase deliberately does **not** touch:

- **`lib/hooks/query-keys.ts`** — platform query keys are declared locally in
  `lib/hooks/use-platform-tenants.ts` instead. A shared registry edited by five agents at once is
  a merge conflict with no upside.
- **`components/shared/sidebar-nav-items.ts`** — `platformNavItems` still carries
  `comingSoon: true` on `/platform/tenants` (GA-053). That array has zero application-code
  consumers; the console ships its own nav in `components/platform/platform-shell.tsx`. Flipping
  the flag is left to whoever owns that file. Logged in `deferred-items.md`.

## House rules honoured

- Phase 20 tokens only — `--warning` top border + PLATFORM chip per UI-SPEC §7.5, no new colours
- `QueryBoundary` on every query; a failed request renders ERROR with retry, never an empty state
- 4-layer architecture: `app/**` and `components/**` import Layer-3 hooks only
- Fail-closed posture preserved: an undeterminable count is refused, not defaulted to 0
- Destructive actions (suspend, disable module) require typing the name of what they affect
