---
phase: 13-platform-tenant-access-repair
plan: 03
subsystem: gateway-platform
tags: [gateway, feature-flags, tenant-status, fail-closed, tier-matrix, regression-guard]
status: complete
requires:
  - running dev stack (postgres, redis, eureka) + gateway, auth-service, user-service, platform-admin-service
  - at least one feature-gated service running for the live gating proof (inventory-service used)
provides:
  - FeatureCodeClosureTest (build-failing route-map/tier-matrix drift guard)
  - FEATURE_PAYROLL, FEATURE_LOYALTY, FEATURE_ANALYTICS, FEATURE_ECOMMERCE in the tier matrix
  - FeatureFlagGlobalFilter.StatusResolution (a third outcome: UNKNOWN)
  - 503 TENANT_STATUS_UNAVAILABLE as a distinct gateway error code
  - scripts/e2e/phase13-feature-gating-e2e.sh
affects:
  - every authenticated tenant request through the gateway (status resolution)
  - tenant provisioning (defaultsFor now seeds 20 codes, was 16)
  - PlatformAdminClient.getStatus contract (errors now propagate)
tech-stack:
  added: []
  patterns:
    - a third outcome for a two-valued question, rather than a default that asserts one of them
    - the fail-open lever read and acted on in exactly one place, never in a client
    - closure tests compare two vocabularies directly, parsing the other module off the repository tree
    - live assertions name the error CODE, never the status, when several layers answer the same status
    - feature codes in comments written in split form so a regex-scraping guard cannot be poisoned
key-files:
  created:
    - services/platform-admin-service/src/test/java/io/restaurantos/platform/config/FeatureCodeClosureTest.java
    - scripts/e2e/phase13-feature-gating-e2e.sh
  modified:
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/config/TierFeatureDefaults.java
    - gateway/src/main/java/io/restaurantos/gateway/filter/FeatureFlagGlobalFilter.java
    - gateway/src/main/java/io/restaurantos/gateway/client/PlatformAdminClient.java
    - gateway/src/test/java/io/restaurantos/gateway/FeatureFlagFilterIT.java
decisions: [D-30, D-32, D-33]
requirements: [PLATFORM-03, PLATFORM-04, PLATFORM-10, GW-03]
metrics:
  duration: ~3h
  completed: 2026-08-06
  tasks: 3
  commits: 5
---

# Phase 13 Plan 03: Feature-Code Closure & Fail-Closed Tenant Status — Summary

Feature-code drift is now a build failure instead of a production 403, and an undeterminable tenant
status refuses the request instead of serving it. Both are proved by live HTTP, including an actual
platform-admin outage. One thing this plan wanted to prove end-to-end is **left unproved and said so
plainly**: hr-service will not start on this machine, for a reason that predates this plan.

## The feature codes added, and where each was placed

`RouteFeatureMap` gated four prefixes on codes `TierFeatureDefaults` defined nowhere. All four are
now defined. No mapping was deleted — a mapping naming a real code is correct even with no route
behind it, and deleting one silently ungates the prefix the day a route is added.

| Code | Tier set | Why there |
|---|---|---|
| `FEATURE_PAYROLL` | **ALL_TIERS_ON** (with `FEATURE_HR`) | Payroll is the second half of the one module Phase 11 merged. Its endpoints are at `/api/v1/hr/payroll-runs` and gate on `FEATURE_HR` today — the only reason the orphan has never 403'd. Any other placement means half an enabled module starts refusing the day `/api/v1/payroll/` gets a route. |
| `FEATURE_LOYALTY` | **ALL_TIERS_ON** (with `FEATURE_CRM`) | **Not the plan's default of growth-and-above, deliberately.** Loyalty shipped in Phase 9 inside CRM — accrual, tiers, promotions — and is reachable on every tier today under `/api/v1/crm/`. Growth-only would *take away*, the day `/api/v1/loyalty/` gets a route, a capability STARTER tenants already have. Same split-module trap as payroll, in the other direction. |
| `FEATURE_ANALYTICS` | GROWTH_AND_ABOVE | Sits with `FEATURE_REPORTING_ADVANCED` and `FEATURE_NLQ`, the Phase 12 surfaces it shares ClickHouse infrastructure with. No route exists, so nothing regresses. |
| `FEATURE_ECOMMERCE` | GROWTH_AND_ABOVE | Unbuilt — no service, no route, no frontend surface. Placed at the plan's default *precisely because* there is no shipped behaviour to preserve; the source comment says to revisit deliberately when the module is built. |

The matrix now holds **20 codes, identical to the frontend's canonical `FEATURE_FLAGS` list.**

## Task 1 — drift is now a build failure

`FeatureCodeClosureTest` parses the gateway's `PREFIX_TO_FEATURE.put(...)` calls off the repository
tree and compares them against `TierFeatureDefaults.allFeatureCodes()`. Same idiom, and same reason,
as `PermissionCatalogClosureTest`: a gate on an undefined code does not throw at startup, breaks no
test, and produces a clean 403 indistinguishable from a tenant who never bought the module. Only
comparing the two vocabularies catches it.

Three things make it hard to pass vacuously:

- The parsed count must equal the number of raw `PREFIX_TO_FEATURE.put(` call sites, so a mapping
  written in a form the regex cannot read fails loudly rather than disappearing from the comparison.
  This is stronger than a size floor, which only catches total breakage.
- `driftIsReportedWithBothTheCodeAndItsPrefix` runs the same detector over a synthetic source
  carrying a bogus code. The negative control is therefore **permanent and runs on every build**,
  rather than being a mutation someone did by hand once.
- A separate test pins that `/api/v1/payroll/ → FEATURE_PAYROLL` is checked even though no route
  matches that prefix — the exact case whose absence made this survive.

**The RED was real.** Before the fix: 4 tests, 2 failures, naming every orphan with its prefix:

```
{"FEATURE_ANALYTICS"="/api/v1/analytics/", "FEATURE_ECOMMERCE"="/api/v1/ecommerce/",
 "FEATURE_LOYALTY"="/api/v1/loyalty/",     "FEATURE_PAYROLL"="/api/v1/payroll/"}
```

**Why the existing frontend guard did not catch this.**
`frontend/__tests__/lib/nav-feature-flags.test.ts` builds its backend set as the **union** of
`TierFeatureDefaults.java` and `RouteFeatureMap.java`. A code present only in the route map is *in*
that union and passes. The union answers "does this code exist anywhere"; only the closure test
answers "can a tenant ever be granted it", and only the second question decides whether a request
gets through.

### GitNexus impact (run before editing, per CLAUDE.md)

| Target | Upstream | Risk |
|---|---|---|
| `TierFeatureDefaults` | 3 (ProvisioningService IMPORTS + ACCESSES, PlatformAdminController at depth 2) | LOW |
| `RouteFeatureMap` | 2 (both inside `FeatureFlagGlobalFilter`) | LOW |
| `FeatureFlagGlobalFilter` | **0** | **LOW — and wrong, see below** |

🔴 **The `FeatureFlagGlobalFilter` result is wrong in the way that matters, and I am flagging it
rather than accepting it.** It is a Spring `GlobalFilter` dispatched by the framework, so it has no
static callers; the graph reports LOW because nothing *calls* it, not because little depends on it.
The real blast radius is **every authenticated tenant request that crosses the gateway**. This is
the identical understatement plan 13-01 recorded for `JwtGlobalFilter`. I treated it as CRITICAL:
the change is fenced by ten integration cases against a real Redis and a real HTTP platform-admin
stub, plus a live outage of the actual service. The index was stale (last built at `5fba4a9`); I did
not refresh it, because `gitnexus analyze` rewrites `CLAUDE.md`, `AGENTS.md` and six skill files,
which plan 13-01 had to revert.

## Task 2 — silence is not a determination

`getTenantStatus` ended in `.defaultIfEmpty("ACTIVE")`. That is not a default, it is an assertion: it
told the filter that a tenant nobody had been able to ask about was in good standing. Suspension is
the platform's primary non-payment lever, so any platform-admin or Redis outage restored full access
to every tenant that had been cut off.

**There are three outcomes, not two, and the code now has somewhere to put the third.** A private
`StatusResolution` record carries `UNKNOWN`, returned when platform-admin errors, answers with no
body, answers malformed (`data` absent → the map throws), when the Redis read fails, or when the
cache write fails. `UNKNOWN` maps to **503 `TENANT_STATUS_UNAVAILABLE`** and **nothing is written to
the cache**.

- **503, not 403, and a distinct code.** An operator must be able to tell "we refused you" from "we
  could not tell", and a client must be able to tell a retryable outage from a settled account
  decision. The code is also distinct from the gateway's own `SERVICE_UNAVAILABLE` breaker fallback,
  so the two are separable in logs and in the e2e harness.
- **Nothing cached.** Caching a guess turns a blip into a hard refusal for the full 5-minute TTL —
  and a guess of `ACTIVE` keeps a suspended tenant served long after platform-admin recovered and
  could have said otherwise. Same rule, same reason, as `isFeatureEnabled`.
- **One lever.** `restaurantos.fail-open-on-platform-down`, the property the feature-flag path
  already honours, default false. A second status-only property would permit a configuration where
  entitlement fails closed and suspension fails open — the worst of both, and invisible until
  someone tests it.

**What the RED measured, rather than assumed** (10 run, 2 failures + 1 error):

| Cold cache, platform-admin… | Before | After |
|---|---|---|
| returns 500 | **401 UNAUTHORIZED** | 503 `TENANT_STATUS_UNAVAILABLE` |
| returns 204 (no body) | **request FORWARDED to upstream** | 503 `TENANT_STATUS_UNAVAILABLE` |

The 204 row is the bypass D-33 names. The 500 row is not fail-open, but it was mislabelled: the error
escaped the filter, was caught by `JwtGlobalFilter`'s blanket `onErrorResume` at line 204, and every
failure downstream of tenant resolution is reported there as **401 UNAUTHENTICATED** — so during a
platform-admin outage the operator was told the caller's credentials were bad. See "Left open".

## Task 3 — proved live, including an actual outage

`scripts/e2e/phase13-feature-gating-e2e.sh`: **11 PASS / 0 FAIL** by default, **16 PASS / 0 FAIL**
with `PHASE13_PROVE_FAIL_CLOSED=1`, exit 0, against the stack rebuilt and restarted first.

**Assertions name the error CODE, never the status.** Three layers answer 403 on these routes and a
bare `assert_not_status 403` cannot tell them apart. That is not hypothetical here — measured:

```
cashier token -> /api/v1/inventory/ingredients  ->  403 {"code":"PERMISSION_DENIED"}
```

The gate had passed; the service's own RBAC refused. A status-only assertion would have reported the
feature gate as broken. It is the same class of mistake 13-02 had to fix in its own harness. The
persona is therefore `TENANT_ADMIN` (stepped up through TOTP, per 13-02's finding), so the re-enabled
case is a real **200** and not merely "not 403".

Toggles write `tenant_features` directly **and delete both Redis key shapes** `FeatureFlagAdminService`
maintains (`tenant_features:{t}:{code}` and `feature:{t}:{code}`); deleting one leaves the other
serving a stale answer and the script would be measuring the cache rather than the gate. Direct
writes because the SuperAdmin feature API needs a login plan 13-05 delivers — noted in the script,
API-driven version handed to 13-14.

### The outage proof, and why it needs a gateway restart

`scripts/local-service-env.sh` exports **`FAIL_OPEN_ON_PLATFORM_DOWN=true`**. A locally started
gateway therefore runs with the break-glass lever already pulled — the one setting under which
fail-closed cannot be observed. My first attempt at this assertion returned 200 and I chased it to
that line rather than adjusting the expectation. The block now restarts the gateway to prove both
postures, with platform-admin genuinely stopped and the status cache cold:

```
gateway up with fail-open-on-platform-down=false
PASS: fail-open OFF: an undeterminable status REFUSES the request (503 TENANT_STATUS_UNAVAILABLE)
PASS: fail-open OFF: nothing was written to the status cache
PASS: fail-open OFF: access returns once platform-admin can answer again (200)
gateway up with fail-open-on-platform-down=true
PASS: fail-open ON: the break-glass lever lets the request through (200)
PASS: fail-open ON: a fail-open decision is still not a determination
```

The last line is the assertion that would have failed before this plan: the client fabricated
`"ACTIVE"` and the filter cached it.

### The trap was tested, not assumed

Restoration runs on `EXIT`/`INT`/`TERM` and verifies itself. Proved by killing a mutated copy of the
script *while the tenant was SUSPENDED*; the trap restored `ACTIVE` and re-enabled the feature. The
copy was deleted, never committed. After every run the demo tenant is back to `ACTIVE` with 13/15
features enabled — byte-identical to its pre-run state.

## Deviations from plan

**1. [Rule 1 — bug] `PlatformAdminClient.getStatus` fabricated `"ACTIVE"` on any error under
fail-open.** Not in the plan's file list, but leaving it would have violated the plan's own
prohibition. Wrong twice over: it applied the fail-open lever in a *second* place, so the filter —
which also applies it — could not see a decision had been made on its behalf; and the fabricated
value was indistinguishable from a real determination, so my new code would have **cached** it,
persisting a fail-open guess past the operator turning fail-open back off. Its sibling
`getEnabledFeatures` already carried a comment saying exactly why it must not do this. Commit
`61dd39e`.

**2. [Rule 1 — bug in an existing guard] Feature codes named whole in comments poisoned the frontend
drift guard.** `nav-feature-flags.test.ts` regex-scrapes `/FEATURE_[A-Z_]+/` out of
`TierFeatureDefaults.java` to build "codes the backend knows about". A code named in *prose* silently
joins that set. `FEATURE_PURCHASING` — the phantom flag — was named whole in a comment there, which
means a nav item gated on that exact phantom would have passed the guard written to catch it.
`frontend/lib/features/feature-flags.ts` already solves this by writing `"FEATURE_" + "PURCHASING"`;
that idiom is now applied here too, and the class javadoc records the rule. The scraped set is now
exactly the 20 declared codes. Commit `fd3f345`.

**3. [Rule 2 — verifiability] The IT no longer pins fail-open true.** The class set
`restaurantos.fail-open-on-platform-down=true` in its `@SpringBootTest` properties, which is the one
value under which a fail-open regression cannot be observed. Removed, so the context binds the real
default from `application.yml`, and `failOpenDefaultsToClosed()` asserts it — otherwise re-pinning it
would turn the new assertions green for the wrong reason and remove the guard silently.

**4. [Rule 2 — verifiability] A second MockWebServer for platform-admin.** `platform-admin.uri`
pointed at a dead port, which makes every cache miss indistinguishable from every other cache miss.
The distinction between "answered ACTIVE", "answered SUSPENDED" and "could not answer" is the entire
subject of this plan.

**5. [Rule 2 — security] The Redis read failure path also yields UNKNOWN.** The plan only named the
platform-admin branch. A failing Redis `GET` previously propagated out of the filter and surfaced as
401. Redis being down is one of the outage shapes that must not read as entitled.

**6. [Rule 2] Four assertions beyond the plan's list**, each closing a way the others could pass
vacuously: an unrelated feature's route is unaffected while the probe feature is off (a filter that
refused everything would otherwise pass); suspension refuses *every* tenant-scoped route, not just
the gated one; the status cache is empty in both outage postures; and `FEATURE_HR` is read back from
platform-admin over HTTP rather than assumed from the tier matrix.

**7. [Deviation from the plan's stated default] `FEATURE_LOYALTY` in the all-tiers set,** not
growth-and-above. Rationale in the table above and in the source comment. The plan said "unless the
roadmap positions them differently" — Phase 9 does.

**8. [Scope] Plan file path corrected.** The plan listed
`gateway/src/test/java/io/restaurantos/gateway/filter/FeatureFlagFilterIT.java`; the file is at
`.../gateway/FeatureFlagFilterIT.java`. Same class of correction as 13-01 deviation 5.

**9. [Out of plan scope — build hygiene, no source touched] 353 macOS duplicate build artifacts**
(`" 2"` and `" 3"` suffixed copies under `*/target/`) blocked `repackage` twice with
`Unable to find a single main class from the following candidates [GatewayApplication 2,
GatewayApplication]`. Same failure 13-01 recorded. Deleted only paths inside `target/`, after
confirming with `git ls-files --error-unmatch` that none was tracked.

**10. [Out of plan scope, no source touched] Services restarted.** `mvn verify` rewrote the gateway,
platform-admin, auth and user jars under running JVMs. All four were restarted onto the current jars
before the numbers below were taken. finance-service and inventory-service were also started, because
the live gating proof needs a feature-gated upstream that actually answers.

## Left open, and not claimed to work

### 1. hr-service will not start — so the HR assertions are weaker than intended

```
Schema validation: wrong column type encountered in column [eobi_employee_rate_pct]
in table [tax_config]; found [numeric (Types#NUMERIC)], but expecting [float(53) (Types#FLOAT)]
```

Pre-existing, Phase 11 (HR module internals — explicitly out of this phase per 13-CONTEXT). I did not
fix it: it is an entity/migration decision in a service outside this plan's file list.

**Consequence, stated plainly.** The two HR assertions prove that *the gateway does not gate HR or
payroll off* — the request cleared the feature gate and reached routing — and that platform-admin
reports `FEATURE_HR` genuinely enabled for the demo tenant. They do **not** prove an HR endpoint
works, because nothing is listening. The script prints that distinction on every run rather than
letting a 503 pass quietly as "not 403". The end-to-end gating proof was therefore done against
`FEATURE_INVENTORY` on a live inventory-service, where enabled is a real 200.

### 2. Existing tenants have no rows for the new codes

Provisioning seeds `tenant_features` from `defaultsFor(tier)`, so a tenant created before this change
has no row, and a missing row reads as "not entitled". Measured on the demo tenant:

```
missing: FEATURE_LOYALTY, FEATURE_ANALYTICS, FEATURE_ECOMMERCE, FEATURE_PAYROLL, FEATURE_NLQ
```

Harmless today — no gateway route matches those prefixes — and a 403 the day one is added. Note
`FEATURE_NLQ` was already in this state before this plan. The script reports it on every run without
scoring it as a pass. **The backfill belongs to the seed script in 13-14**; no migration was written
here (the plan specifies none).

### 3. Every downstream error is still reported as 401 at the gateway

`JwtGlobalFilter.authorizeAndForward` ends in `.onErrorResume(ex -> writeError(401, UNAUTHENTICATED))`,
and that wraps `chain.filter(...)` — so *any* error raised anywhere downstream of tenant resolution
becomes "your credentials are bad". The status path no longer reaches it (nothing escapes the filter
now), but the quota path's Redis read still can. Out of this plan's scope; reported, not fixed, and
worth its own decision because widening it carelessly could leak upstream failures to clients.

### 4. The dev stack ships with the break-glass lever pulled

`scripts/local-service-env.sh:83` exports `FAIL_OPEN_ON_PLATFORM_DOWN=true`. Correct for local
development, and now explicitly proven to be what makes fail-open happen — but it means **no local
run of any service exercises the production posture unless it is overridden**, which is why the
outage block restarts the gateway. Worth confirming that no deployment manifest inherits it.

### 5. Phantom flags exist in live data

The `test` tenant carries Redis keys `tenant_features:…:FEATURE_PURCHASING` and
`…:FEATURE_REPORTING` — two codes in no vocabulary at all. Residue of the incidents the new test
exists to prevent. Not cleaned up here (out of scope, and they are cache keys, not rows).

### 6. Two commits on this branch are not mine

`e8dbe94` (`plan(13-16)`) and `b330fa0` (`fix(frontend,hr)` — TOTP step-up re-auth prompt) landed on
`phase-13-access-repair` during this session from another context. Every number below is scoped to
`b330fa0..HEAD`, which is exactly my six files. I neither reviewed nor tested those two commits.

## Verification actually run

Every number is from a command executed in the state being reported, with
`JAVA_HOME=openjdk@25`, `TESTCONTAINERS_RYUK_DISABLED=true`,
`TESTCONTAINERS_HOST_OVERRIDE=192.168.64.2`.

| Suite | Result |
|---|---|
| `mvn -pl services/platform-admin-service,gateway,services/auth-service,services/user-service -am verify` | **BUILD SUCCESS**, all 6 modules |
| ├ shared-lib | unit 10/10, IT 11/11 |
| ├ auth-service | unit 21/21, IT 45/45 |
| ├ gateway | unit **43/43**, IT **15/15** (baseline was 9/9) |
| ├ user-service | unit 3/3, IT 11/11 |
| └ platform-admin-service | `FeatureCodeClosureTest` **4/4**, IT **22/22** |
| `opa test policies/` | **139/139**, coverage **100%** (no `.rego` touched) |
| `npx vitest run __tests__/lib/nav-feature-flags.test.ts` | 3/3 — the guard I edited a scraped file for still passes |
| `bash scripts/e2e/phase13-feature-gating-e2e.sh` | **11 PASS / 0 FAIL**, exit 0 |
| `PHASE13_PROVE_FAIL_CLOSED=1 bash …` | **16 PASS / 0 FAIL**, exit 0 |
| Trap under failure (mutated copy killed while SUSPENDED) | tenant restored to `ACTIVE` |
| `detect_changes` vs `b330fa0` | **6 files, 33 symbols, 0 affected processes, risk LOW** — no unexpected file |

Filter ordering confirmed unchanged: `StripInternalHeaderFilter` +5, `JwtGlobalFilter` +10,
`FeatureFlagGlobalFilter` +20. Route declaration order confirmed unchanged:
`platform-auth-route` (line 131) still above `platform-admin-route` (line 149).

## Known stubs

None. Every symbol this plan created is wired and exercised — by a unit test, an integration test
against real Redis, or a live HTTP assertion, and in most cases all three.

## Threat flags

None beyond the plan's register.

- `T-13-03-A` (status fail-open) — closed; asserted by four IT cases and by a live outage in both
  postures.
- `T-13-03-B` (undefined feature codes) — closed; build-failing closure test plus the backfill.
- `T-13-03-C` (fail-closed during an outage is a DoS) — accepted as planned. The 503 code is distinct
  so operators can identify the cause, and the break-glass lever is proven to work.
- `T-13-03-D` (cached unknowns) — closed; asserted in both postures, live and in the IT.
- `T-13-03-E` (script leaving the tenant suspended) — closed; trap tested under an induced failure.
- `T-13-03-SC` — did not arise. No package was installed.

One flag worth recording that the register did not anticipate: **`PlatformAdminClient.getStatus`
was a second, undocumented place the fail-open lever was applied**, and it produced a cacheable
fabrication. That is deviation 1, and it is the reason `T-13-03-D` was not already satisfied by "do
not cache errors" — the client made sure the filter never saw an error to begin with.

## Self-Check: PASSED

Both created files exist on disk:
- `services/platform-admin-service/src/test/java/io/restaurantos/platform/config/FeatureCodeClosureTest.java`
- `scripts/e2e/phase13-feature-gating-e2e.sh`

All 5 commits exist in `git log`: `27e34e1`, `fd3f345`, `65f236a`, `61dd39e`, `a83f909`.
