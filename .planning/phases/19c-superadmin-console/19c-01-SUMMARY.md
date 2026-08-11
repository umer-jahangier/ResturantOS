---
phase: 19c-superadmin-console
plan: 01
subsystem: platform-console
status: complete
tags:
  [superadmin, platform, feature-flags, is-override, entitlement, usage, authorization, ga-010, ga-002]
requires:
  - running dev stack (postgres, redis, gateway, auth-service, user-service, platform-admin-service)
  - "13-05: platform login; a platform user is tenant-less"
  - "13-14: tier management, feature toggles, tenant_features.is_override"
  - "13-10: provisioning saga with real compensation"
  - "13-03: tenant status fails closed"
  - "16a-01: email-first login routes a platform user to a platform token"
  - "14b: QueryBoundary — ERROR with retry, never an empty state"
  - "20: design tokens (UI-SPEC §7.5)"
provides:
  - "GET /api/v1/platform/tenants/{id}/features now returns featureStates[] with tierDefault, isOverride and a derived source"
  - "DELETE /api/v1/platform/tenants/{id}/features/{code}/override — the only way back from an override"
  - "GET /api/v1/platform/tenants/{id}/usage — usage against entitlement (was 404)"
  - "UsageService.limitFor / UsageService.meters"
  - "/platform/dashboard, /platform/tenants, /platform/tenants/{id} — the console"
  - "PlatformGuard — /platform/** requires tokenType=platform AND SUPER_ADMIN"
  - "frontend platform Layer 1-3: schema, adapter, model, repository, four hooks"
  - "e2e/journeys/superadmin-console.spec.ts (9 tests)"
affects:
  - "any future feature-flag UI — provenance is now on the wire, so nothing needs to duplicate the tier matrix"
  - "any consumer of the internal usage record endpoint — newCount is now a sum and limit is a real ceiling"
  - "GA-053 — platformNavItems' comingSoon flag on /platform/tenants is now stale"
tech-stack:
  added: []
  patterns:
    - a marker column that no API exposes cannot be acted on, however correct the logic reading it is
    - null and 0 are different claims; a metering API must be able to say "nobody counts this"
    - authorization cannot live where no role is readable — proxy.ts sees only a forgeable cookie
    - useSyncExternalStore(never, () => true, () => false) is the SSR-safe mounted flag; a reset-in-effect is both a lint error and a visible frame of stale state
    - an enforcement path is the wrong place to absorb a console's payload — widen a sibling instead
    - mount-scoped state beats effect-cleared state when the state is a confirmation gate or a credential
key-files:
  created:
    - services/platform-admin-service/src/test/java/io/restaurantos/platform/FeatureProvenanceAndUsageIT.java
    - frontend/app/(platform)/platform/tenants/page.tsx
    - frontend/app/(platform)/platform/tenants/[tenantId]/page.tsx
    - frontend/components/platform/platform-guard.tsx
    - frontend/components/platform/platform-shell.tsx
    - frontend/components/platform/feature-matrix.tsx
    - frontend/components/platform/usage-panel.tsx
    - frontend/components/platform/tenant-subscription-card.tsx
    - frontend/components/platform/create-tenant-dialog.tsx
    - frontend/components/platform/confirm-destructive-dialog.tsx
    - frontend/components/platform/tenant-badges.tsx
    - frontend/lib/models/platform.model.ts
    - frontend/lib/api-client/schemas/platform.schema.ts
    - frontend/lib/adapters/platform.adapter.ts
    - frontend/lib/repositories/platform.repository.ts
    - frontend/lib/hooks/use-platform-session.ts
    - frontend/lib/hooks/use-platform-tenants.ts
    - frontend/lib/hooks/use-platform-features.ts
    - frontend/lib/hooks/use-platform-usage.ts
    - frontend/e2e/journeys/superadmin-console.spec.ts
  modified:
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/dto/PlatformDtos.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/service/FeatureFlagAdminService.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/service/UsageService.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/repository/UsageRecordRepository.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/controller/PlatformAdminController.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/controller/PlatformInternalController.java
    - frontend/app/(platform)/layout.tsx
    - frontend/app/(platform)/platform/dashboard/page.tsx
decisions: [D-19c-01, D-19c-02, D-19c-03, D-19c-04]
requirements: []
metrics:
  duration: ~4h
  completed: 2026-08-11
---

# Phase 19c Plan 01: SuperAdmin Platform Console Summary

Fourteen working platform endpoints had no browser and no authorization; the console now exists,
`/platform/**` requires SUPER_ADMIN, and the features API finally exposes the `is_override` column
that 13-14 added a year of reconciliation logic around.

## The finding, confirmed

**The features endpoint returned a bare `Map<String,Boolean>` with no `is_override` marker.**
Verified live before any code was written:

```
$ curl .../platform/tenants/{control-bistro}/features
{"data":{"features":{"FEATURE_CRM":false,"FEATURE_ANALYTICS":false, …}}}
```

Those two values are byte-identical on the wire. In the database they are not the same fact:

```
$ psql platform_db -c "select t.slug, f.feature_code, f.is_enabled, f.is_override
                        from tenant_features f join tenants t on t.id = f.tenant_id
                        where f.is_override = true"

                 slug                 | feature_code | is_enabled | is_override
--------------------------------------+--------------+------------+-------------
 control-bistro-isolation-test-tenant | FEATURE_CRM  | f          | t
 marina-bay-dining                    | FEATURE_CRM  | t          | t
 saffron-grill                        | FEATURE_NLQ  | t          | t
 zaitoon-kitchen                      | FEATURE_CRM  | f          | t
(4 rows)
```

Four rows of deliberate operator intent, invisible to every client. `FeatureFlagAdminService`
`.reconcileToTierDefaults` reads the column correctly and skips override rows in both directions —
the logic was right, and the API withheld the input that made it actionable. UI-SPEC §7.5's explicit
requirement, that "inherit tier (on)" and "force on" be distinguishable at a glance, was
unimplementable against that response shape.

### After

```
$ curl .../platform/tenants/{control-bistro}/features   # STARTER
code                               enabled  default  override  source
FEATURE_CRM                        False    True     True      OVERRIDE_REVOKE
TIER_DEFAULT rows (no operator decision): 19

$ curl .../platform/tenants/{saffron-grill}/features    # STARTER
FEATURE_NLQ                        True     False    True      OVERRIDE_GRANT
```

`source` is derived server-side from `enabled`, `tierDefault` and `is_override`, because the tier
matrix (`TierFeatureDefaults`) is backend state — a browser computing this would need its own copy,
and a duplicated matrix is wrong from the first time a code changes tier.

**Additive, never a replacement.** The legacy `features` map is still first in the payload, so
`phase13-subscription-e2e.sh:409` (which greps this body for `"FEATURE_X":true`) and the existing
Playwright lifecycle journey both still pass. The gateway's `/internal/**` twin is untouched: it
feeds enforcement, does not want provenance, and widening a route the whole product depends on to
serve a screen is how enforcement paths acquire bugs. `FeatureProvenanceAndUsageIT` asserts the
internal response still contains no `featureStates`.

## Usage: checked first, and it is empty

The instruction was to check whether any usage data exists before building a usage screen. Checked
twice; the answer is worse than "none":

```
$ psql platform_db -c "select count(*) from usage_records;"        →  0
$ redis-cli --scan --pattern 'nlq_quota:*' | wc -l                 →  0
```

Zero rows, zero producers, zero counter keys. And every read path a console would reach for was
absent — confirmed with a valid SUPER_ADMIN token:

```
GET /api/v1/platform/tenants/{id}/usage           → 404
GET /api/v1/platform/tenants/{id}/usage-summary   → 404
GET /api/v1/platform/tenants/{id}/entitlements    → 404
GET /api/v1/platform/tenants/{id}/limits          → 404
GET /api/v1/platform/usage                        → 404
```

`GET .../usage` was built against the real shape and **no number is invented**. The response
distinguishes three states a naive implementation collapses into the single lie `0`:

| State | Meaning | Rendered as |
|---|---|---|
| `metered, used = n` | really counted; `0` means zero happened | number + bar, `--warning` ≥ 80%, `--danger` ≥ 100% |
| `!metered, used = null` | nobody records this | **"Not metered — {reason}"**, no bar, no number |
| `unavailable, used = null` | a real meter that could not be read | "Could not be read — {reason}" |

Live, for floating-terrace:

```
resource       used   limit   metered  source
branches       2      50      true     user-service live count
users          None   500     false    auth-service exposes no per-tenant user count
storage_gb     None   100     false    no producer records storage usage
nlq_queries    None   50000   false    no counter exists — nlq-service has never incremented it
```

Exactly one dimension is genuinely countable, via the same user-service call
`TenantSubscriptionService.usageViolations` already trusts to refuse a downgrade — so this screen
and that safety check cannot disagree. An unreadable meter is marked `unavailable`, never `0`: the
same posture as 13-03's fail-closed tenant status.

The entitlement half **is** real and is shown. Those four ceilings had been returned by the API since
Phase 3 and read by nothing — grepping the frontend for `maxBranches`/`maxUsers`/`storageGb`/
`nlqQuota` returned zero matches (GA-083).

## Authorization: `/platform/**` was authenticated, never authorized

`proxy.ts:51-58` gates the prefix on the `has_session` cookie and nothing else — non-HttpOnly,
forgeable by design, and set for **every** logged-in user of every tenant. A KITCHEN_STAFF who
navigated to `/platform/dashboard` was served the SuperAdmin shell.

No tenant data leaked: the gateway refuses `/api/v1/platform/**` without SUPER_ADMIN and that
refusal is real. But a cook was shown a control plane with every panel failing 403 behind it.

The check lives in `app/(platform)/layout.tsx`, not `proxy.ts`, and **could not** live there: the
access JWT is memory-only and the refresh cookie is scoped to `Path=/api/v1/auth`, so no request the
proxy sees carries a role. A check there could only consult the forgeable marker — which is how this
class of bug is created rather than fixed.

`PlatformGuard` requires `tokenType === "platform"` **and** the `SUPER_ADMIN` claim, both from the
RS256-verified token. Both, because either alone admits something: `tokenType` would admit a future
non-SuperAdmin platform role, and the role claim alone would admit a tenant token that carried it.

Proven in a browser — a KITCHEN_STAFF session at `/platform/dashboard` and `/platform/tenants`
renders the refusal with **no platform chrome at all**: no chip, no nav, no tenant table
(`screenshots/06-tenant-persona-refused.png`).

## Also fixed, because the usage endpoint sits on top of them

- **GA-051** — `UsageService.record` returned `countByTenantIdAndResource`, the number of ROWS,
  surfaced as a running total. Record delta 5 then delta 3 and it answered **2**. Proven live before
  and after: `after delta 5 -> newCount 5`, `after delta 3 -> newCount 8`.
- **GA-052** — the same response hardcoded `Long.MAX_VALUE` as `limit`, discarding the entitlement
  half of usage-against-entitlement at the moment it becomes useful. Now the real tier ceiling:
  `{"newCount":8,"limit":50}` for an ENTERPRISE tenant's branches.

Both probe rows were deleted afterwards — `usage_records` is back to 0, because leaving fabricated
usage in the database would contradict the entire point of the screen.

## Decisions

**D-19c-01 — Extend the public features endpoint additively; leave the internal one alone.**
The internal twin is consumed by the gateway, `FeatureFlagPublicController` and three assertions in
`TenantSubscriptionIT`. None wants provenance. An `is_override` field on the enforcement path would
be payload nobody reads on the one route every request depends on.

**D-19c-02 — Derive `source` on the server.**
The alternative is shipping `is_override` raw and letting the browser compare it against a
client-side copy of the tier matrix. That copy drifts silently the day a code moves tier, and the
symptom would be a console confidently mislabelling which overrides survive a tier change.

**D-19c-03 — `used` is nullable end to end, with no `?? 0` anywhere.**
Schema, adapter, model and component all preserve null. `meterPercent` returns null rather than 0 so
the component cannot render a 0%-width bar, which reads as "nothing used" rather than "not measured".

**D-19c-04 — Omit MRR, last-active, and the Users and Audit tabs UI-SPEC §7.5 sketches.**
No API serves any of them: there is no billing amount or activity timestamp on the tenant row, no
per-tenant user list reachable from the platform plane, and `GET /api/v1/audit/events` returns 404
(GA-102, and 8093 answered `000` throughout this work). Four working tabs beside two that greet the
operator with an error is worse than three panels that all work.

## Deviations from plan

**1. [Rule 2 — missing critical functionality] Added `DELETE .../features/{code}/override`**
`setFeature` marks the row as an override on **every** call, by design. Without a clear path an
operator who flipped a switch by mistake has silently pinned that module against every future
upgrade and downgrade, with no way back through any interface. UI-SPEC §7.5 asks for a revert
control; there was no endpoint behind it. Clears the marker and resets the value to the tier default
in one transaction, re-writing both Redis key shapes only when the value actually moves.
Commit `eda6f63`.

**2. [Rule 1 — bug] GA-051 and GA-052 in `UsageService` / `PlatformInternalController`**
Directly under the usage endpoint being built: a read API reporting a row count as a quantity, and
`Long.MAX_VALUE` where the ceiling belongs, would have made the new screen wrong on its first real
data. Commit `eda6f63`.

**3. [Rule 1 — bug] `PlatformGuard` had a hydration mismatch**
The first version tested `typeof window !== "undefined"` in the render body — the first item in
React's own list of causes. The browser E2E observability guard caught it on the first run and
failed the test that was otherwise passing. Replaced with a `useSyncExternalStore`-based mounted
flag. The same fix corrected a second bug: the wait condition keyed on `!isEntitled`, which would
have left a tenant user on a spinner forever instead of telling them the truth. Commit `32ea1dc`.

**4. [Rule 3 — blocking] Two reset-in-effect lint errors**
`ConfirmDestructiveDialog` and `CreateTenantDialog` cleared state in an effect on open, which the
repo's `react-hooks/set-state-in-effect` rule rejects. Restructured so the body mounts only while
open. That is better than a lint workaround on both counts: a reset-on-open effect runs a render
*after* the dialog is visible, so there is one frame in which the previous attempt's typed
confirmation is on screen and satisfying the gate — and the one-time password no longer lives in
component state after the dialog closes.

**5. Files created outside the literal ownership list, all new, none shared**
`lib/models/platform.model.ts`, `lib/api-client/schemas/platform.schema.ts` and
`lib/adapters/platform.adapter.ts`. The 4-layer architecture requires them and they collide with
nobody. Two shared files were deliberately **not** touched: `lib/hooks/query-keys.ts` (platform keys
are declared locally in `use-platform-tenants.ts` — that registry is branch-scoped and a platform
session has no branch) and `components/shared/sidebar-nav-items.ts` (logged in `deferred-items.md`).

**6. Kept the dashboard `<h1>` as "Platform Dashboard"**
`unified-login.spec.ts` asserts that exact heading as the proof a SuperAdmin has a browser path at
all. A better noun was not worth turning a green regression test red.

## What the browser proved

`bash scripts/e2e/browser-e2e.sh --grep "SuperAdmin platform console"` — **9 passed (24.4s)**,
against the live stack.

```
✓ 1 auth-setup › resolve tenant slugs from the platform API (388ms)
✓ 2 auth-setup › mint a storage state for every seeded persona (9.8s)
✓ 3 auth-setup › mint a storage state for the SuperAdmin (561ms)
✓ 4 A · the console has navigation and lists real tenants (2.3s)
✓ 5 B · a tenant persona is REFUSED at /platform/** (763ms)
✓ 6 C · an override is visibly distinguished from a tier default (2.3s)
✓ 7 D · toggling a module changes what that tenant's users can reach (3.8s)
✓ 8 E · usage reports what is measured and refuses to invent the rest (2.2s)
✓ 9 F · PINNED DEFECT: a platform login issues no usable refresh token (810ms)
```

Test D is the end-to-end claim: it establishes `403 FEATURE_DISABLED` for the zaitoon manager
first, enables CRM **through the console UI**, polls until the gateway stops refusing that same
user's same request, then restores the seeded state exactly (`is_enabled=f, is_override=t` — not via
the Revert control, which would clear the marker and leave CRM ON) and re-asserts the 403, so the
three other specs depending on that fixture keep passing.

Regression checks: `unified-login` **8/8** (including the SuperAdmin console landing), and
`role-visibility-matrix`'s `OWNER is refused /platform/dashboard` still green.

Screenshots in `screenshots/`: the console, tenant list, the Zaitoon override row beside a
tier-default row, the honest usage panel, the suspend confirmation naming the tenant, and the
tenant-persona refusal.

## A defect found and pinned, not fixed

**A SuperAdmin cannot reload, deep-link, or open a platform page in a new tab.**

```
platform login:  Set-Cookie: refresh_token=;         Path=/api/v1/auth; Max-Age=604800; HttpOnly
tenant login:    Set-Cookie: refresh_token=eyJhbGci… Path=/api/v1/auth; Max-Age=604800; HttpOnly
```

The platform login issues an **empty** refresh token. The access token is memory-only by design, so
any full document load has nothing to rehydrate from and `SessionProvider` redirects to
`/login?reason=session_expired`. Found the hard way: `page.goto('/platform/tenants/{id}')` after a
successful login landed on the sign-in form.

13-05 states this is deliberate ("a platform session re-authenticates rather than refreshes, so no
long-lived platform credential exists to be stolen") — a defensible posture whose browser
consequence was never worked through, because before 16a-01 the SuperAdmin had no browser path at
all. The fix belongs in auth-service, which this workstream does not own. Test F pins it and tells
whoever fixes it to delete the test and the click-through workaround.

## Endpoints the console needs that do not exist

| Endpoint | Status | Consequence |
|---|---|---|
| `GET .../tenants/{id}/usage-summary`, `/entitlements`, `/limits` | **404** | Not needed — `/usage` now covers it |
| `GET /api/v1/audit/events` | **404** (8093 answered `000` throughout) | No Audit tab |
| per-tenant user list from the platform plane | none exists | No Users tab; GA-084's password-reset UI has nowhere to live |
| any billing amount / MRR | no field on any platform response | No revenue tile |
| any tenant activity timestamp | none | No "last active" column |

## Known stubs

None. Every screen is wired to a live endpoint verified with a real SUPER_ADMIN token. Where data
does not exist the screen says so in words and names the reason — that is the honest empty state
this phase was asked for, not a stub.

## CI gates

```
pnpm --dir frontend run format:check   — clean for every file this phase owns
pnpm --dir frontend run lint           — 0 errors (10 pre-existing warnings, none in platform files)
pnpm --dir frontend exec tsc --noEmit  — clean
mvn -pl services/platform-admin-service verify — 89 tests, 0 failures, 0 errors (11 new)
```

## Self-Check: PASSED

All 20 created files verified present on disk. All three commits verified in `git log`:
`eda6f63` (backend), `c8786d3` (console), `32ea1dc` (browser proof + guard fix + artifacts).
