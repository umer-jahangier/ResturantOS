---
phase: 13-platform-tenant-access-repair
plan: 01
subsystem: auth-gateway
tags: [auth, gateway, platform-admin, rbac, jwt, b1]
status: complete
requires:
  - running dev infra (postgres, redis, rabbitmq, eureka)
provides:
  - role-derived Spring authorities (shared-lib JwtAuthenticationFilter)
  - JwtSigningService.signPlatformToken
  - PlatformTokenService
  - POST /internal/auth/platform-token
  - JwtGlobalFilter tenant-optional platform branch
  - gateway platform-auth-route (rate-limited)
  - PUBLIC_PATHS entries for 13-05 login and 13-08 forced change
  - scripts/e2e/_phase13-lib.sh
affects:
  - every service registering JwtAuthenticationFilter (auth, authorization, user, platform-admin, all business services)
  - every authenticated request through the gateway
tech-stack:
  added: []
  patterns:
    - authority derivation centralised in one filter method, never per-service
    - tenant exemption scoped at the caller, resolver contract left intact
    - live-HTTP verification harness instead of source scanning (D-30)
key-files:
  created:
    - services/auth-service/src/main/java/io/restaurantos/auth/service/PlatformTokenService.java
    - services/auth-service/src/main/java/io/restaurantos/auth/controller/PlatformTokenInternalController.java
    - services/auth-service/src/main/java/io/restaurantos/auth/exception/InvalidPlatformRoleException.java
    - services/auth-service/src/test/java/io/restaurantos/auth/service/PlatformTokenServiceTest.java
    - services/auth-service/src/test/java/io/restaurantos/auth/integration/PlatformTokenInternalIT.java
    - shared-lib/src/test/java/io/restaurantos/shared/security/JwtAuthenticationFilterTest.java
    - gateway/src/test/java/io/restaurantos/gateway/filter/JwtGlobalFilterTenantOptionalPathTest.java
    - scripts/e2e/_phase13-lib.sh
  modified:
    - shared-lib/src/main/java/io/restaurantos/shared/security/JwtAuthenticationFilter.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/JwtSigningService.java
    - services/auth-service/src/main/resources/application.yml
    - gateway/src/main/java/io/restaurantos/gateway/filter/JwtGlobalFilter.java
    - gateway/src/main/resources/application.yml
    - gateway/src/test/java/io/restaurantos/gateway/JwtGlobalFilterTest.java
decisions: [D-01, D-02, D-30]
requirements: [AUTH-01, AUTH-02, PLATFORM-01, PLATFORM-07]
metrics:
  duration: ~2h
  completed: 2026-08-06
  tasks: 3
  commits: 5
---

# Phase 13 Plan 01: Platform Token Path Repair — Summary

Two of blocker B1's three causes are now closed and proven live: a role claim yields a Spring
authority, and a tenant-less token is accepted on `/api/v1/platform/**` and rejected everywhere
else. A minted SuperAdmin token returns **200 with the real tenant list** through the real gateway.

## What B1 was, and what is closed

| # | Cause | Status | Closed by |
|---|-------|--------|-----------|
| 1 | No login endpoint reads `platform_users` | **still open — by design** | plan 13-05 |
| 2 | `JwtAuthenticationFilter` builds authorities from `permissions` only, so `hasAuthority('SUPER_ADMIN')` is unsatisfiable | **closed** | commit `12efa18` |
| 3 | `TenantResolutionSupport` errors on a tenant-less token; `JwtGlobalFilter` turns that into 401 | **closed** | commit `566b1a7` |

Cause 3 had a second half in auth-service that the plan folded in: `signAccessToken` dereferences
`claims.tenantId()` and `claims.branchId()` unguarded, so auth-service could not *mint* a
tenant-less token either. `signPlatformToken` (commit `9ddd711`) does.

`/internal/auth/platform-token` is the interim door until 13-05 lands the real login. It is
internal-secret gated and unrouted at the gateway.

## Task-by-task

### Task 1 — authorities from roles as well as permissions

`JwtAuthenticationFilter.toAuthorities` is now a deduplicated union of `permissions` and `roles`.
Strictly additive: it grants role-shaped authorities that were previously unreachable and revokes
nothing, so no permission-based gate anywhere changes behaviour. Both claims are read only after the
RS256 signature has been verified against JWKS.

The head comment records the invariant that any future authority source is added *there*, never
per-service — a service-local variant is how a gate comes to be enforced in one process and silently
inert in another, which is this defect's whole class.

**GitNexus impact — `JwtAuthenticationFilter`, upstream: 12 direct dependents, risk MEDIUM.**
`JwtConfig`/`SecurityConfig` in authorization-service, `JwtSigningConfig`/`SecurityConfig` in
auth-service, `PlatformSecurityConfig` in platform-admin-service, `UserSecurityConfig` in
user-service, plus the corresponding IMPORTS edges. Every one is a *registration* site — none reads
the authority set — so the blast radius is behavioural, not structural. `doFilterInternal` is not a
node in the graph (methods of this shape are not indexed), so the class-level result is the
authoritative one.

### Task 2 — mint a tenant-less platform token

- `JwtSigningService.signPlatformToken(userId, role, ttl)`. Tenant/branch claim keys **omitted**,
  not null-valued — both readers already treat absence as "no tenant", and a null-valued key would
  be a second encoding of the same fact for every future reader to keep getting right.
- Role carried in **both** `roles` and `permissions`. `roles` is its correct home and is now
  sufficient alone; `permissions` repeats it so the token also works against a service running an
  older shared-lib, and because no dotted permission code may be invented here —
  `PermissionCatalogClosureTest` scans `@PreAuthorize` expressions and would demand a tenant-RBAC
  catalog row for one that has no tenant meaning.
- `token_type: platform`; `totp_verified: false` stated explicitly (platform_users has no TOTP
  column — a known gap in 13-CONTEXT), so the fail-closed default is on the record.
- `PlatformTokenService` reads no database and verifies no password. It signs what
  platform-admin-service asserts over the internal channel. That is PLATFORM-07: only
  platform-admin-service connects to `platform_db`. The authorization is `InternalServiceFilter`'s
  constant-time secret, which already confers equivalent authority via `/internal/auth/service-token`
  and `.../impersonate` — so this endpoint widens no trust boundary, *provided* the gateway keeps
  mapping no route to `/internal/**`. Asserted live: 404.
- TTL `restaurantos.auth.platform-token-ttl-seconds`, default 900 — deliberately not
  `jwt.access-ttl-seconds` (3600).
- `signAccessToken`, `signServiceToken`, `signImpersonationToken` untouched, with a regression test
  pinning that a tenant token still carries `tenant_id`, `branch_id` and its step-up `totp_verified`.

### Task 3 — gateway exemption, rate-limited login route, harness

`TENANT_OPTIONAL_PATHS` has exactly one entry. `authorizeAndForward` forwards a tenant-less token
when — and only when — the path matches, and does **not** call `TenantResolutionSupport` on that
branch. Deliberately *not* "resolve, and fall back on failure": that shape would let any
tenant-scoped route through whenever resolution merely broke (Redis down, platform-admin
unreachable), converting an outage into an authorization bypass. `TenantResolutionSupport` is
untouched, so its contract stays honest and the exemption is bounded by construction.

`platform-auth-route` is declared before `platform-admin-route`; declaration order is the mechanism
(first match wins), so moving it below silently removes the throttle from a credential endpoint.

`scripts/e2e/_phase13-lib.sh` provides `curl_retry`, `curl_status`, `json_get`, `jwt_claims`,
`mint_platform_token`, `tenant_login`, `assert_status`, `assert_not_status`, `assert_contains`,
`phase13_summary`.

**GitNexus impact — `JwtGlobalFilter`, upstream: 0 dependents, risk LOW; `authorizeAndForward`: 1
(its own class), risk LOW.**
🔴 **This number is wrong in the way that matters and I am flagging it rather than accepting it.**
`JwtGlobalFilter` is a Spring `GlobalFilter` dispatched by the framework, so it has no static
callers to find; the graph reports LOW because nothing *calls* it, not because little depends on it.
The real blast radius is **every authenticated request that crosses the gateway** — I treated this
as CRITICAL and the change is fenced by 18 context-free predicate cases plus six live negative
assertions on tenant-scoped routes.

## Verification actually run

Every number below is from a command executed in the state being reported.

**Live — 25/25 PASS.** Gateway rebuilt (jar 19:32) and restarted (pid 87824) *before* any assertion,
per the plan's human-check.

| Assertion | Result |
|---|---|
| `GET /api/v1/platform/tenants` + tenant-less SUPER_ADMIN token | **200**, real tenant list |
| Minted claims: `sub`, `token_type: platform`, `roles: [SUPER_ADMIN]`, no `tenant_id`, no `branch_id` | PASS |
| Same token on `/api/v1/pos/tills/current`, `/api/v1/orders`, `/api/v1/users/me`, `/api/v1/finance/accounts`, `/api/v1/hr/employees`, `/api/v1/inventory/ingredients` | **401** ×6 |
| Platform prefix with no / garbage / `Basic` Authorization | **401** ×3 |
| `/internal/auth/platform-token` no secret, wrong secret | **403** ×2 |
| unknown role → `INVALID_PLATFORM_ROLE`; missing id → `VALIDATION_FAILED` | PASS |
| `/internal/auth/platform-token` through the gateway | **404** (unrouted) |
| `cashier@demo.local` login through the gateway; token still carries `tenant_id`; still reaches POS (**422**, a business validation, not 401) | PASS |
| Tenant OWNER token on `/api/v1/platform/tenants` | **403** — the authority union over-grants nothing |
| `platform-auth-route` matched (`X-RateLimit-Burst-Capacity: 100`, `Replenish-Rate: 2`) | PASS |
| `/api/v1/auth/change-password/forced` reaches upstream; `/api/v1/auth/change-password` still gateway-401 | PASS |

**Unit tests**

| Suite | Result |
|---|---|
| `JwtAuthenticationFilterTest` | 7/7 pass (2 failed before the fix — the correct RED) |
| shared-lib full | 10/10 pass |
| `PlatformTokenServiceTest` | 9/9 pass |
| `JwtGlobalFilterTenantOptionalPathTest` | 18/18 pass |
| `GatewayResilienceConfigTest` | 3/3 pass |
| `PlatformAdminClientTest` | 4/4 pass |
| `mvn -DskipTests -T1C package` | **21/21 modules SUCCESS** |

**`detect_changes()`** (final working tree, per CLAUDE.md): 3 files, 34 symbols, 0 affected
processes, risk LOW. Every symbol in `JwtGlobalFilter` (line-shift artifacts). No unexpected file.

## Not passing, and not claimed to

### `JwtGlobalFilterTest` — the 5 new gateway cases

The whole class errors on this machine: **8/8 before this plan, 13/13 after, with zero assertion
failures in either state** — all `reactor.netty.http.client.PrematureCloseException`.
`JwtGlobalFilterWsUpgradeTest` is intermittent in the same way (5/5 green on one run, 5/5 errored on
the next), which matches the "13 of 20" the operator reported. Pre-existing, environmental,
reproducible on `origin/prod`. I did not fix it and did not weaken a test to hide it.

Because of that, the security-critical half of task 3 is *also* asserted by
`JwtGlobalFilterTenantOptionalPathTest`, which needs no context, no container and no network, and by
six live negative assertions.

**What I ruled out while diagnosing** (reported as requested, not fixed): it is not the client HTTP
version, not the hostname, and not test-ordering — a single test in isolation fails identically.
`JwtGlobalFilterWsUpgradeTest` has a near-identical `@SpringBootTest` setup and passes on some runs,
so the difference is not structural. Unresolved.

### auth-service integration tests

`PlatformTokenInternalIT` is committed but does **not** pass here. **Every POST-based auth-service IT
fails identically** with `HTTP/1.1 header parser received no bytes` (JDK `HttpClient` → Tomcat),
including `AuthLoginIT` and `AuthInternalBranchRoleIT` on entirely untouched code:

```
mvn -pl services/auth-service verify   →  Tests run: 31, Errors: 27
                                          (unit tests: 13/13 pass)
```

GET-only ITs (`JwksEndpointIT`) pass. Pre-existing and environmental. The endpoint's six behaviours
are instead proven by live HTTP above, which is stronger evidence than the IT would have been.

## Deviations from the plan

**1. [Rule 2 — security] Segment-boundary path matching plus `..` refusal.**
The plan said "a predicate testing a request path against it", implying `startsWith` (as
`isPublicPath` uses). A bare prefix test would admit `/api/v1/platformish`. WebFlux also does not
collapse dot segments, so `getPath().value()` is literally what the client sent — a path could carry
the platform prefix here and resolve elsewhere for anything downstream that *does* normalise.
`isTenantOptionalPath` matches on a segment boundary and refuses any `..` outright. Fail-closed: a
refused path falls through to ordinary tenant resolution, which 401s a tenant-less token.
Commit `566b1a7`.

**2. [Rule 2 — preserving a stated invariant] `X-TOTP-Verified` still injected on the tenant-optional
branch.** The plan said to forward "with only the user-id header — plus the impersonation header
when present". Doing that literally would reintroduce exactly the absence the recent step-up work
eliminated ("written on every authenticated request, including the false case, so the upstream reads
a value this gateway authored rather than an absence it has to interpret"). Identity-header
construction is now factored into `identityHeaders()` so the two branches cannot drift; the only
difference between them is `X-Tenant-Id`. Commit `566b1a7`.

**3. [Rule 2 — verifiability] `JwtGlobalFilterTenantOptionalPathTest` added.** Not in the plan. The
most security-critical property of this change is which paths are exempt, and it must not be
assertable only through a class that cannot execute here. Commit `566b1a7`.

**4. [Rule 1 — bug] `_phase13-lib.sh` repo-root fallback.** `${BASH_SOURCE[0]}` is unset under zsh,
macOS's default shell. Without a fallback, sourcing the harness from zsh silently computes the wrong
root, silently fails to read `deploy/.env`, silently uses the placeholder internal secret, and
silently 403s — the identical failure `DEV-STACK-RUNBOOK.md` records for `local-service-env.sh`
("Known failure modes" #1). I hit it during verification. Now falls back to `git rev-parse
--show-toplevel` and hard-errors if the root cannot be confirmed. A harness that can quietly test the
wrong thing is worse than no harness. Commit `566b1a7`.

**5. [Scope] Plan file paths corrected.** The plan listed
`gateway/src/test/java/io/restaurantos/gateway/filter/JwtGlobalFilterTest.java`; the file is at
`.../gateway/JwtGlobalFilterTest.java`. Likewise `PlatformAdminController` is under
`io/restaurantos/platform/`, not `io/restaurantos/platformadmin/`.

**6. [Out of plan scope — build hygiene, no source touched] 929 macOS `" 2"` duplicate files under
`*/target/` blocked `mvn package`** (`Unable to find a single main class from the following
candidates [ReportingServiceApplication 2, ReportingServiceApplication]` × 6 modules). Stale,
untracked build output from a prior file-copy event. Deleted only the `" 2"` paths inside `target/`;
no tracked file touched. After that: 21/21 SUCCESS.

**7. [Reverted]** `gitnexus analyze` (run to refresh the stale index — it was at commit `207a034`
from June) rewrote `CLAUDE.md`, `AGENTS.md` and six `.claude/skills/gitnexus/*/SKILL.md`. Out of this
plan's scope; reverted with `git checkout --` on those files. The refreshed index itself is retained
(it is gitignored) and is what `detect_changes` above ran against.

## Known stubs

None. Every symbol this plan created is wired and exercised by a live assertion.

## Threat flags

None beyond the plan's register. `T-13-01-A`, `-B`, `-BF` and `-D` each have a live negative
assertion; `T-13-01-C` is covered by `JwtAuthenticationFilterTest`. `T-13-01-SC` did not arise — no
package was installed.

## Left open

- **B1 cause 1** — `PlatformUserRepository.findByEmail` still has no production caller. Plan 13-05.
  Until then a platform token is only obtainable over the internal secret channel.
- `PlatformTokenInternalIT` and the five new `JwtGlobalFilterTest` cases are red on this machine for
  pre-existing environmental reasons. They should be checked in CI (Linux) before this branch merges
  — the live evidence covers the behaviour, but not the CI signal.
- The auth-service POST-IT failure (27/31) and the gateway `PrematureCloseException` are both
  unresolved and both block honest integration testing on macOS. They deserve their own
  investigation; I time-boxed mine and reported what I ruled out.
- `owner@demo.local` cannot log in in this database: `TOTP_ENROLLMENT_REQUIRED`. Unrelated to this
  plan (the account has no enrolled secret); the regression check used `cashier@demo.local`, which
  exercises the identical tenant-resolution path.
- `.planning/STATE.md` still reads `current_phase: 10`. Not advanced here: no `gsd-tools` is
  installed in this repo and hand-editing a counter that describes a different phase would make the
  file less true, not more.

## Self-Check: PASSED

All 8 created files exist on disk. All 5 commits (`48c4d6b`, `12efa18`, `980b735`, `9ddd711`,
`566b1a7`) exist in `git log`.
