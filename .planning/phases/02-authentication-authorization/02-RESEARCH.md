# Phase 2: Authentication & Authorization - Research

**Researched:** 2026-06-23
**Domain:** Spring Security 7 auth (RS256 JWT/JWKS, refresh, TOTP, AES field-encryption) + OPA 1.x Rego ABAC, on Spring Boot 4.0.7 / JDK 25 / PostgreSQL 18 (RLS)
**Confidence:** HIGH (specs in `Docs/` fully specify this phase; cross-referenced against shipped shared-lib code on disk)

## Summary

Phase 2 stands up two new Maven modules — `services/auth-service` (port 8081, `auth_db`) and `services/authorization-service` (port 8083, also `auth_db`) — plus a new top-level `policies/` directory of OPA Rego. The auth-service issues RS256 access JWTs (15-min) + opaque HttpOnly refresh sessions (7-day), serves `/.well-known/jwks.json`, enforces bcrypt-12 + lockout, runs TOTP 2FA with an AES-256-GCM-encrypted secret, does password reset by emailed token, and publishes `USER_LOGIN_SUCCEEDED`/`USER_LOGIN_FAILED` via the transactional outbox. The authorization-service exposes `POST /internal/authorize`, proxying to OPA fail-closed on a 2s timeout. Branch isolation is enforced inside every Rego policy.

Almost everything is pre-specified. The shared-lib already ships the JWT validation primitives (`JwtAuthenticationFilter`, `JwksKeyProvider`, `JwtClaims`), the OPA client (`DefaultOpaClient`, `OpaInput`, `OpaClient`, `OpaDecision`), the transactional outbox (`DomainEventPublisher` + `OutboxRelay`, scheduled), `EventEnvelope`, and `TenantContext`. **Three spec'd classes are NOT yet on disk and must be built this phase:** `EncryptionService` + `EncryptedStringConverter` (AES-256-GCM field encryption, Doc 9 §9.5) and the `AuthorizationService` helper (Doc 9 §9.4). The SecurityFilterChain that wires the shipped filter is deliberately unwired (Phase-1 decision #6) and must be assembled in auth-service.

**Primary recommendation:** Build the three plans exactly along the roadmap split (02-01 core login/JWT/JWKS/refresh/lockout/events; 02-02 TOTP+reset+branch-switch; 02-03 authorization-service+Rego). Reuse shared-lib verbatim; do NOT re-implement JWT parsing, OPA calls, the outbox, or money/tenant primitives. Resolve the two hard seams up front: (a) how auth-service resolves a tenant slug→id+status before Phase 3's platform-admin-service exists, and (b) seeding users/roles/branches directly into `auth_db` via Liquibase `context="seed"` (Phase 3 will later own real provisioning).

## Standard Stack

All versions are inherited from the parent POM / shared-lib unless noted. Child modules MUST NOT pin versions already managed by the parent.

### Core (already managed — just declare without version)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `spring-boot-starter-web` | 4.0.7 (parent) | REST controllers | Project baseline |
| `spring-boot-starter-security` | 4.0.7 | SecurityFilterChain (Security 7 lambda DSL), **`BCryptPasswordEncoder` via transitive `spring-security-crypto`** | bcrypt-12 needs no extra dep |
| `spring-boot-starter-data-jpa` | 4.0.7 | `auth_db` entities/repos | RLS + Hibernate filter |
| `spring-boot-starter-amqp` | 4.0.7 (transitive via shared-lib) | RabbitTemplate for `OutboxRelay` | login events |
| `io.jsonwebtoken:jjwt-api/impl/jackson` | `0.12.6` (parent prop `jjwt.version`) | **sign** RS256 (auth) + verify (shared filter) | already used in shared-lib |
| `com.nimbusds:nimbus-jose-jwt` | `9.40` | build/serve JWKS JSON from the RSA public key | already in shared-lib pom |
| `io.restaurantos:shared-lib` | `1.0.0` | tenant/JWT/OPA/outbox primitives | mandatory base |

### Supporting (must ADD to the service POMs / shared-lib)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `dev.samstevens.totp:totp` | `1.7.1` | RFC-6238 TOTP secret gen, otpauth URI / QR, code verify with time-window | **02-02 (TOTP)** — recommended; see Don't Hand-Roll |
| `org.springframework.cloud:spring-cloud-starter-openfeign` | mgd by `spring-cloud.version` 2025.1.0 | OpenFeign clients (FeignSharedConfig already in shared-lib) | only if 02-03/02-02 calls another service internally; likely deferrable to Phase 3 |
| OPA CLI `openpolicyagent/opa:1.17.1` | container (already in docker-compose) | `opa test --coverage` | 02-03 policy tests (CI + local) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `dev.samstevens.totp` | hand-rolled `HmacSHA1` RFC-6238 | rejected — error-prone clock-skew/encoding edge cases (Don't Hand-Roll) |
| Opaque DB refresh sessions | refresh JWTs | spec is explicit: opaque row in `auth_db.refresh_sessions` + HttpOnly cookie — do NOT use a refresh JWT |
| auth-service fetching JWKS over HTTP from itself | pre-seed its own public key by `kid` | use the `JwksKeyProvider(String kid, PublicKey)` constructor already shipped — avoids a startup self-HTTP call |

**Installation (per new service module):** declare `shared-lib`, `spring-boot-starter-security`, `spring-boot-starter-data-jpa`, `liquibase-core`, `postgresql`, test deps (Testcontainers junit-jupiter/postgresql/rabbitmq, awaitility) — all versionless (parent-managed). Add `dev.samstevens.totp:totp:1.7.1` to auth-service only.

## Architecture Patterns

### Module / package layout (Doc 1 §1.1, Doc 7 §7.1.1)
Package tokens are fixed: auth-service = `io.restaurantos.auth`, authorization-service = `io.restaurantos.authz`. Layers: `.entity`, `.repository`, `.service`(+`ServiceImpl`), `.controller`, `.dto.request`/`.dto.response`, `.config`, `.event`.

```
services/auth-service/                    services/authorization-service/
  pom.xml                                   pom.xml
  src/main/java/io/restaurantos/auth/       src/main/java/io/restaurantos/authz/
    AuthServiceApplication.java               AuthorizationServiceApplication.java
    config/   (SecurityConfig, JwtSigningConfig, keys)   config/ (SecurityConfig, OpaConfig w/ 2s timeout)
    entity/   (UserEntity, RoleEntity, ...)  controller/ (InternalAuthorizeController)
    repository/                              service/    (uses shared AuthorizationService/OpaClient)
    service/  (Auth/Jwt/Totp/Refresh/...)
    controller/ (AuthController, JwksController)
    event/    (login-event publisher via outbox)
    dto/request, dto/response
  src/main/resources/db/changelog/...      src/main/resources/db/changelog/...
  src/test/java/io/restaurantos/auth/integration/ (BaseIntegrationTest, TestFixtures)

policies/                                  # NEW top-level dir; mounted RO into OPA container (docker-compose: ../policies:/policies)
  restaurantos/ common.rego pos.rego finance.rego vendor.rego rbac.rego
  tests/ common_test.rego pos_test.rego finance_test.rego vendor_test.rego rbac_test.rego
```

**Parent POM must be edited:** the live `pom.xml` declares only `shared-lib`, `eureka-server`, `config-server` (Phase-1 decision). Add `<module>services/auth-service</module>` and `<module>services/authorization-service</module>` to `<modules>` — omitting them means the reactor never builds them.

### Pattern 1: SecurityFilterChain (Spring Security 7 lambda DSL) — wires the shipped filter
**What:** Stateless API; 401/403 as JSON `ApiError`; CORS → JWT filter → authorize.
**When:** every Phase-2 service (auth + authz).
**Source:** Doc 9 §9.1 (verbatim canonical). Key points: `csrf(AbstractHttpConfigurer::disable)`, `SessionCreationPolicy.STATELESS`, `addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)`, `@EnableMethodSecurity`. permitAll list: `/actuator/health/**`, `/actuator/prometheus`, `/.well-known/jwks.json`, `/api/v1/auth/login`, `/api/v1/auth/refresh`, `/api/v1/auth/reset-password/**`. The auth-service builds the `JwtAuthenticationFilter` bean itself (shared-lib does NOT auto-wire it) using a `JwksKeyProvider` pre-seeded with its own public key by `kid`.

### Pattern 2: Login flow (Doc 9, Doc spec P7.1)
`POST /api/v1/auth/login` `{email, password, tenantSlug, totpCode?}`: 1) resolve tenant by slug → id + status, reject if not `ACTIVE`; 2) **set `app.current_tenant_id` GUC** then load user by email (RLS-scoped); 3) check lockout (`locked_until`); 4) constant-time bcrypt-12 compare; 5) if user's computed permissions require 2FA (`rbac.manage`/`finance.period.close`) or `totp_enabled`, require valid `totpCode` else 401 `TOTP_REQUIRED`; 6) compute roles/permissions/attributes for the active branch; 7) sign access JWT + insert `refresh_sessions` row + set HttpOnly cookie; 8) publish `USER_LOGIN_SUCCEEDED`. Lockout: 5 consecutive failures → `locked_until = now()+15min`; reset count on success.

### Pattern 3: Transactional outbox for login events (already shipped)
Use the shared `EventPublisher` bean (`DomainEventPublisher`). `publish("auth.topic", "auth.user.login_succeeded", "USER_LOGIN_SUCCEEDED", branchId, payload)`. `OutboxRelay` (scheduled, in shared-lib auto-config) delivers post-commit. Payload (Doc 2 §2.3): `{userId|null, email, ip}`. Routing keys: `auth.user.login_succeeded`, `auth.user.login_failed`, `auth.user.locked`. The `audit.all-events.queue` is already bound to `auth.topic` with `#`.

### Anti-Patterns to Avoid
- **WebSecurityConfigurerAdapter / chained-method DSL / `antMatchers`** — removed in Security 7. Use the lambda DSL + `requestMatchers` (Doc 9 header note).
- **Rego pre-1.0 bodies without `if` / multi-value rules without `contains`** — rejected by OPA 1.x default (Rego v1). Every rule body uses `if`; `deny`/multi-value use `contains`.
- **Trusting a tenant id from header/body in `/internal/*`** — re-derive from the validated JWT (`TenantContext.requireTenantId()`); honor the `X-Internal-Service` shared secret (Doc 4 §4.1).
- **Re-implementing JWT parse, OPA HTTP, money, tenant GUC** — all shipped in shared-lib.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| RS256 verify + claims | custom JWT parser | shared-lib `JwtAuthenticationFilter` / `Jwts.parser()` (jjwt 0.12.6) | edge cases: kid peek, expiry, alg confusion |
| JWKS JSON | hand-built JSON | nimbus `RSAKey.Builder(...).keyID(kid).build()` → `JWKSet` | correct `n`/`e` base64url, `use`/`alg` |
| Password hashing | manual bcrypt/PBKDF2 | `new BCryptPasswordEncoder(12)` (spring-security-crypto) | constant-time, salt mgmt |
| TOTP | RFC-6238 from scratch | `dev.samstevens.totp` (`DefaultSecretGenerator`, `DefaultCodeVerifier`, `QrData`) | time-window/skew, otpauth URI |
| AES-256-GCM field crypto | new cipher code | implement the spec's `EncryptionService` + `EncryptedStringConverter` ONCE (Doc 9 §9.5) and reuse via `@Convert` | IV handling, GCM tag, key loading |
| OPA call + fail-closed | custom HTTP+JSON | shared-lib `DefaultOpaClient` / `OpaInput` (deny on any error) | BLR-5 fail-closed already encoded |
| Event publish + at-least-once | direct `rabbitTemplate` in tx | shared `DomainEventPublisher` (outbox) + `OutboxRelay` | transactional outbox, no double-encode |

**Key insight:** the spec was written specifically so agents do NOT invent their own JWT filter, OPA integration, or crypto — Doc 9 opens with that mandate. The phase is ~70% assembly of shipped pieces + 3 new spec'd classes + Rego.

## Common Pitfalls

### Pitfall 1: `EncryptionService`/`EncryptedStringConverter` not on disk yet
**What goes wrong:** AUTH-09 (`totp_secret` AES-256-GCM) assumes a shared converter exists; it does not (only `JwtProperties`, `RestaurantOsAuthentication`, `JwtClaims`, `JwksKeyProvider`, `JwtAuthenticationFilter` are in `shared-lib/security`). **Build them this phase** per Doc 9 §9.5 in `io.restaurantos.shared.security`, plus a bean wiring `EncryptionService` from `FIELD_ENCRYPTION_KEY` and a static `EncryptedStringConverter.init(...)`. Decide: add to shared-lib (preferred — HR/Purchasing reuse it later) vs. auth-service.

### Pitfall 2: login events vs. outbox `tenant_id NOT NULL` + `requireTenantId()`
**What goes wrong:** `DomainEventPublisher.publish` calls `tenantContext.requireTenantId()` and `event_outbox.tenant_id` is `NOT NULL`. A `USER_LOGIN_FAILED` for an unknown email or invalid slug has no resolved tenant → publish throws / cannot insert. **How to avoid:** resolve the tenant slug first; only publish login events once a tenant is known; for invalid-slug attempts either skip the event or use a sentinel tenant id. Flag the exact policy for the planner (see Open Questions).

### Pitfall 3: RLS vs. pre-tenant login lookup
**What goes wrong:** `auth_db.users` / `user_branch_roles` are tenant-scoped (`FORCE ROW LEVEL SECURITY`), but login must find the user before tenant context exists. **How to avoid:** the tenant-resolution lookup (slug→id+status) must be on a NON-RLS reference table; resolve tenant → `SELECT set_config('app.current_tenant_id', :tid, true)` → then query `users` under RLS. Never disable RLS on `users`.

### Pitfall 4: OPA 2s fail-closed timeout not configured
**What goes wrong:** `DefaultOpaClient`'s `RestClient` (built in `SharedAutoConfiguration.opaClient`) has NO explicit timeout; AUTHZ-01 requires deny on 2s OPA timeout. **How to avoid:** authorization-service must build/override an `OpaClient` (or RestClient `ClientHttpRequestFactory`) with connect+read timeout = 2s so a hang surfaces as an exception → `PermissionDeniedException` (deny). Verify with a test that stalls OPA.

### Pitfall 5: Rego v1 + 100% coverage
**What goes wrong:** missing `if`/`contains` → parse failure; uncovered rule branch → CI gate fails (`opa test policies/ --coverage --format=json | jq '.coverage'` must equal 100). **How to avoid:** every `allow`/`deny`/helper line must be exercised by a test (positive + negative, including cross-tenant and cross-branch denials). `common.rego` must expose `same_tenant`, `same_branch`, `has_permission` (SC5) — note the spec also shows `same_tenant_and_branch`; expose all and cover each.

### Pitfall 6: PEM keys are base64-encoded in `.env`
**What goes wrong:** `JWT_PRIVATE_KEY`/public key are base64-encoded PEM (not `\n`-escaped) per Phase-1 decision. Signing config must Base64-decode → PEM → PKCS8/X.509 → Key, mirroring how `JwksKeyProvider`/`JwtProperties` handle the public key.

### Pitfall 7: parent `<modules>` + reactor
Adding service modules before they exist breaks the build (Phase-1 lesson). Add the two module lines in the SAME plan that scaffolds each module.

## Code Examples

Verified patterns (sources cited). New code is illustrative for the planner, not to be pasted blindly.

### JWKS endpoint (nimbus) — serve the public key
```java
// Source: nimbus-jose-jwt 9.40 (already a shared-lib dep) + Doc 9 §9.2
// GET /.well-known/jwks.json (permitAll)
RSAKey jwk = new RSAKey.Builder((RSAPublicKey) publicKey)
        .keyID(jwtPublicKeyId)        // JWT_PUBLIC_KEY_ID, e.g. dev-key-1
        .keyUse(KeyUse.SIGNATURE)
        .algorithm(JWSAlgorithm.RS256)
        .build();
return new JWKSet(jwk).toJSONObject(true); // public-only JSON
```

### Access JWT signing (jjwt 0.12.6)
```java
// Source: jjwt 0.12.x; claims per spec P7.1 + JwtClaims record fields
String jwt = Jwts.builder()
    .header().keyId(jwtPublicKeyId).and()        // kid → JwtClaims.peekKid()
    .subject(userId.toString())
    .claim("tenant_id", tenantId.toString())
    .claim("branch_id", branchId.toString())     // changes on branch switch
    .claim("roles", roles)
    .claim("permissions", permissions)
    .claim("attributes", attributes)             // e.g. approval_limit_paisa
    // .claim("impersonated_by", ...) // Phase 3 impersonation; optional now
    .issuedAt(Date.from(now))
    .expiration(Date.from(now.plusSeconds(accessTtlSeconds))) // 900
    .signWith(rsaPrivateKey, Jwts.SIG.RS256)
    .compact();
```

### OPA authorize via shared AuthorizationService (build this helper — Doc 9 §9.4)
```java
// io.restaurantos.shared.authz.AuthorizationService — NOT yet on disk; build it.
public void authorize(String module, String action, OpaInput.Resource resource) {
    JwtClaims c = (JwtClaims) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
    OpaInput input = OpaInput.builder()
        .user(new OpaInput.User(c.subject(), c.tenantId(), c.branchId(), c.permissions(), c.attributes()))
        .resource(resource).action(action)
        .environment(new OpaInput.Environment(Instant.now(), null)).build();
    if (!opaClient.evaluate(module, input).allow())
        throw new PermissionDeniedException("Not permitted: " + module + "." + action);
}
```

### Rego helpers (common.rego) — Rego v1 / OPA 1.x
```rego
package restaurantos.common
same_tenant(input) if { input.resource.tenant_id == input.user.tenant_id }
same_branch(input) if { input.resource.branch_id == input.user.branch_id }
same_tenant_and_branch(input) if { same_tenant(input); same_branch(input) }
has_permission(input, perm) if { some p in input.user.permissions; p == perm }
```
(Branch-isolation note: every module policy MUST include `same_tenant`/`same_branch` except explicit tenant-wide actions like `finance.period.close`, which use `same_tenant` only — Doc 9 §9.4, MAJOR-11 fix.)

## Data Model

All auth tables live in **`auth_db`** (owned by auth-service AND authorization-service; `DB_NAME=auth_db`, role `auth_user`). All tenant-scoped tables get the RLS changeset immediately after `createTable` (Doc 8 §8.6) and the five audit columns (Doc 8 §8.4). Money is BIGINT paisa, timestamps `TIMESTAMPTZ`, Liquibase XML only.

### New migrations needed (none exist yet — `auth_db` is empty after Phase 1)
| Table | Scope/RLS | Key columns | Notes / source |
|-------|-----------|-------------|----------------|
| **tenant lookup** (e.g. `auth_tenants` or mirror) | **NOT RLS** (reference) | `id, slug UNIQUE, status` | Phase-2 seam: lets login resolve slug→id+status before Phase 3's `platform_db`. See Open Q1. |
| `users` | RLS (tenant_id) | `id, tenant_id, email, password_hash, full_name, locale, totp_secret BYTEA (AES-GCM), totp_enabled BOOL, is_active, failed_login_count INT, locked_until TIMESTAMPTZ, last_login_at` + audit | AUTH-01/07/09; `totp_secret` via `EncryptedStringConverter` |
| `refresh_sessions` | RLS (tenant_id) | `id, tenant_id, user_id, token_hash, branch_id, expires_at, revoked_at, user_agent, ip, created_at` | AUTH-02/03/04; opaque token hashed at rest (P7.1) |
| `password_reset_tokens` | RLS (tenant_id) | `id, tenant_id, user_id, token_hash, expires_at (30 min), used_at` | AUTH-06; single-use |
| `password_history` | RLS (tenant_id) | `id, tenant_id, user_id, password_hash, created_at` | policy: cannot reuse last 5 (P7.1) |
| `roles` | system rows + tenant custom | `id, tenant_id (null for system), code, name, is_system` | seeded system roles (Doc 8 §8.7) |
| `permissions` (catalogue) | system | `code, module, description` | catalogue from Appendix B.1–B.10 |
| `role_permissions` | system + tenant | `role_id|role_code, permission_code` | computes JWT `permissions` |
| `user_branch_roles` | RLS (tenant_id) | `id, tenant_id, user_id→users(id), branch_id, role_code, is_active, UNIQUE(tenant_id,user_id,branch_id,role_code)` | spec M7.2 — **in `auth_db`** |
| `event_outbox` | NOT RLS (shared infra) | per Doc 8 §8.9 (`OutboxEntry`) | auth publishes login events; `GRANT ... TO auth_user` |

**ABAC attributes** (`approval_limit_paisa`, `employment_type`, `department_id`): `employment_type`/`department_id` originate in HR (Phase 11). For Phase 2 store `approval_limit_paisa` (and any seedable attrs) on `user_branch_roles` or a small `user_attributes` table; flag the rest as out-of-scope (Open Q3).

**Shared-infra needs:** auth-service needs `event_outbox` only. It does NOT consume events in Phase 2 → no `processed_events`. Login is not `Idempotency-Key`-driven → no `idempotency_keys` required.

**Ownership vs Phase 3:** Phase 3 introduces platform-admin-service (`platform_db`: `tenants`, `platform_users`, feature flags, real provisioning via FD-1) and user-service (`user_db`: `branches`). In Phase 3, branches move to user-service and provisioning calls auth-service's `/internal/auth/tenants/{tenantId}/provision-admin`. Phase 2's `auth_db` `user_branch_roles`/`roles` remain auth-owned. The Phase-2 tenant-lookup table is a temporary seam that Phase 3's gateway/platform integration supersedes (gateway resolves tenant; auth checks status via platform internal endpoint).

## JWT / JWKS / Refresh / Branch-Switch Mechanics

- **Claims** (P7.1, matches `JwtClaims` record): `sub`(userId), `tenant_id`, `branch_id`, `roles[]`, `permissions[]`, `attributes{}`, `iat`, `exp`; optional `impersonated_by` (Phase 3). `kid` header = `JWT_PUBLIC_KEY_ID`.
- **Lifetimes:** access 15 min (`JWT_ACCESS_TTL_SECONDS=900`), refresh 7 days (`JWT_REFRESH_TTL_SECONDS=604800`).
- **Signing key:** `JWT_PRIVATE_KEY` (base64 PEM) loaded by auth-service only; public key → JWKS + auth-service's own `JwksKeyProvider(kid, publicKey)` self-seed.
- **Refresh cookie:** HttpOnly, Secure, SameSite=Strict, path scoped to `/api/v1/auth`; value = opaque random (≥256-bit); store only `token_hash`. `/refresh` reads cookie → validate session (not revoked, not expired) → reissue access JWT (rotate refresh optional).
- **Logout (AUTH-04):** set `revoked_at` on the session row; clear cookie.
- **Branch switch (AUTH-05):** `POST /api/v1/auth/switch-branch {branchId}` (authenticated) → verify the user has an active `user_branch_roles` row for `branchId` → recompute permissions for that branch → reissue access JWT with new `branch_id`/`permissions` (keep refresh session). Branch ids are seeded in Phase 2; Phase 3's user-service supplies real branch details via `/internal/users/branches/{branchId}`.

## TOTP + Field Encryption + Step-Up

- **Setup/verify/disable (AUTH-07):** `POST /api/v1/auth/2fa/setup` generates a secret (`dev.samstevens.totp` `DefaultSecretGenerator`), returns an `otpauth://` URI / QR for the authenticator; `.../2fa/verify {code}` confirms and sets `totp_enabled=true`; `.../2fa/disable` clears it (require a fresh code).
- **AES-256-GCM (AUTH-09):** `totp_secret` column is `BYTEA`; encrypt with `EncryptedStringConverter` (`@Convert`) backed by `EncryptionService(FIELD_ENCRYPTION_KEY)` (base64 32-byte key). Build both classes per Doc 9 §9.5.
- **Step-up for `rbac.manage` / `finance.period.close` (AUTH-07, SC3):** spec says 2FA is mandatory for roles holding these permissions. Recommended Phase-2 interpretation (no rbac/finance endpoints exist yet): at login, if the user's computed permissions include `rbac.manage` or `finance.period.close`, a valid `totpCode` is REQUIRED (401 `TOTP_REQUIRED` otherwise) and the user must have TOTP enrolled. Optionally add a `POST /api/v1/auth/2fa/step-up` returning a short-lived step-up marker for later modules. Confirm exact contract with planner (Open Q2).

## OPA Integration (authorization-service, 02-03)

- **Endpoint:** `POST /internal/authorize` (JWT + `X-Internal-Service` secret per Doc 4 §4.1). Request carries module/action/resource (build an `OpaInput`); response `{allow: boolean}`. Fail-closed (deny) on any OPA error or 2s timeout (AUTHZ-01, BLR-5).
- **OPA call shape:** `DefaultOpaClient` POSTs `/v1/data/restaurantos/{module}/allow`. Configure the OPA `RestClient` with a 2s connect+read timeout (Pitfall 4).
- **Rego packages (AUTHZ-02):** `restaurantos.common|pos|finance|vendor|rbac` in `policies/restaurantos/`. Every policy enforces tenant AND branch isolation via `common.same_tenant`/`same_branch` (AUTHZ-03), except tenant-wide actions (`finance.period.close`) which use `same_tenant` only.
- **Coverage (AUTHZ-04, SC5):** `policies/tests/*_test.rego`; CI gate = 100% (`opa test policies/ --coverage --format=json | jq '.coverage'`). Cover positive + cross-tenant + cross-branch denials and each helper.
- **OPA loads from `/policies`** (docker-compose mounts `../policies:/policies:ro`, OPA `1.17.1`). Creating the `policies/` dir is part of 02-03.

## Testing

- **Reuse the Phase-1 harness pattern (Doc 10 §10.1–10.2):** each service gets a `BaseIntegrationTest` (Testcontainers Postgres `auth_db`/Redis/RabbitMQ, Liquibase on start, tenant context per test) and a `TestFixtures` that mints RS256 JWTs with a test key (test security config trusts `TestFixtures.keys().getPublic()`). Repository tests must `set_config('app.current_tenant_id', :tid, false)` because RLS is FORCEd.
- **Auth-specific tests:** login success/lockout/TOTP-required; refresh/logout/branch-switch reissue; JWKS serves a parseable key; password reset round-trip; outbox publishes `USER_LOGIN_SUCCEEDED/FAILED` (assert via `event_outbox` row or RabbitMQ consumer with Awaitility, §10.3).
- **OPA:** `opa test policies/ -v` locally; coverage 100% in CI.
- **Coverage gates (Doc 10 §10.7):** auth-service & authorization-service ≥ **70%** line (JaCoCo `-Pcoverage`); OPA **100%**. shared-lib additions ≥70%.

## State of the Art

| Old Approach | Current Approach | When | Impact |
|--------------|------------------|------|--------|
| Security 5/6 `WebSecurityConfigurerAdapter`, `antMatchers` | Security 7 lambda DSL, `requestMatchers`, `Customizer.withDefaults()` | Spring Security 7 / Boot 4.0 | use only the new style (Doc 9) |
| Rego pre-1.0 (bodies without `if`) | Rego v1 default (`if`/`contains`) | OPA 1.0+ (project on 1.17.1) | all policies must be v1 |
| `spring-boot-starter-aop` | `spring-boot-starter-aspectj` | Boot 4.0 rename | already reflected in shared-lib |

## Open Questions

1. **Tenant slug→id+status resolution before Phase 3.** `platform_db.tenants` is owned by platform-admin-service (Phase 3), which doesn't exist yet. Phase 2 still must resolve a slug and check `ACTIVE`.
   - Known: login needs tenant id (for RLS + JWT) and status.
   - Unclear: own a small NON-RLS lookup table in `auth_db` seeded for dev vs. defer status checks.
   - **Recommendation:** add a minimal NON-RLS `auth_tenants(id, slug UNIQUE, status)` lookup in `auth_db`, seeded via Liquibase `context="seed"`; Phase 3 later replaces status checks with a platform internal call. Lowest-risk, keeps SC1 testable now.

2. **Step-up 2FA contract.** Exact mechanism for "`rbac.manage`/`finance.period.close` refused without a valid TOTP step" (SC3).
   - **Recommendation:** Phase 2 enforces mandatory TOTP at login for users holding those permissions (no such endpoints exist yet); optionally stub a `2fa/step-up` endpoint. Confirm before planning 02-02.

3. **ABAC attribute sourcing.** `employment_type`/`department_id` come from HR (Phase 11). For Phase 2, only `approval_limit_paisa` is realistically seedable.
   - **Recommendation:** store `approval_limit_paisa` on `user_branch_roles` (or `user_attributes`); seed it; treat HR-sourced attributes as out-of-scope, emit empty/absent.

4. **Where do `EncryptionService`/`EncryptedStringConverter`/shared `AuthorizationService` live?** Spec packages them under `io.restaurantos.shared.*`.
   - **Recommendation:** add to **shared-lib** (HR/Purchasing reuse encryption later; gateway/services reuse authorize). Bump shared-lib only with additive changes; run `gitnexus_impact` before editing `SharedAutoConfiguration`.

5. **Login-event tenant for invalid-slug failures** (Pitfall 2). Recommendation: publish `USER_LOGIN_FAILED` only after tenant resolved; skip (or sentinel-tenant) for unknown slug. Decide the exact rule for SC2's "every attempt publishes…".

## Sequencing / Dependency Notes (for the 3 plans)

- **02-01 (core)** must land first: scaffold auth-service module (+ parent POM edit), `auth_db` migrations (tenant lookup, users, roles/permissions/role_permissions, user_branch_roles, refresh_sessions, event_outbox + RLS + seed), SecurityFilterChain wiring the shipped filter, JWT signing + JWKS, login/refresh/logout, bcrypt-12 + lockout, login events via outbox. Resolve Open Q1 here.
- **02-02 (2FA/reset/branch-switch)** depends on 02-01's user model + JWT issuance. Adds `EncryptionService`/`EncryptedStringConverter` (Open Q4), TOTP, `password_reset_tokens`+`password_history`, branch-switch reissue. Resolve Open Q2 here.
- **02-03 (authz + Rego)** is largely independent of 02-02 and can proceed in parallel once 02-01 defines JWT claims/permissions shape: scaffold authorization-service (+ parent POM edit), `POST /internal/authorize` with 2s fail-closed OPA timeout, `policies/` Rego (common/pos/finance/vendor/rbac) + tests to 100% coverage. Build the shared `AuthorizationService` helper here (or in shared-lib, Open Q4).
- **Cross-cutting:** notification delivery of reset/welcome emails is Phase 5 — Phase 2 only publishes the triggering events to the outbox. `processed_events` consumer-dedup gap from Phase 1 is NOT in scope.

## Sources

### Primary (HIGH confidence)
- `Docs/agent-specs/09-security-implementation-guide.md` — SecurityFilterChain, JWT filter/JWKS, OPA pattern, Rego samples, AES-256-GCM field encryption (§9.1–9.6).
- `Docs/agent-specs/04-internal-api-contracts.md` — auth-service internal endpoints, `X-Internal-Service`/JWT convention, FeignSharedConfig (2s timeout).
- `Docs/agent-specs/05-environment-variables.md` — JWT_*, FIELD_ENCRYPTION_KEY, OPA_URL, INTERNAL_SERVICE_SECRET, per-service ports/DB names.
- `Docs/agent-specs/02-event-schema-registry.md` — `auth.topic`, `USER_LOGIN_*` payloads, envelope, idempotency.
- `Docs/agent-specs/08-database-migration-guide.md` — Liquibase XML, RLS changeset, shared-infra tables (§8.9), seed conventions.
- `Docs/agent-specs/10-test-architecture-guide.md` — BaseIntegrationTest, TestFixtures, OPA coverage, coverage gates.
- `Docs/agent-specs/07-coding-standards.md`, `01-project-scaffold.md` — package/layer naming, parent POM, module list.
- `Docs/RestaurantERP_SaaS_Specification.md` — P7.1/P7.2 (token strategy, login flow, password policy, OPA flow), `auth_db` `user_branch_roles` (M7.2), Appendix B permissions + B.10 grid, Appendix C feature flags.
- `Docs/agent-specs/11-seed-data-specification.md` — seed users/roles/branches (note: tenant data normally via provisioning API = Phase 3).
- On-disk code: `shared-lib/src/main/java/io/restaurantos/shared/{security,authz,event,tenant,config}/*` (verified shipped vs. missing), `deploy/docker-compose.yml` (OPA 1.17.1 mounting `../policies`), `deploy/init/rabbitmq-definitions.json` (`auth.topic` + audit binding), `pom.xml` (Phase-1 module list), `.planning/STATE.md` + `ROADMAP.md`.

### Secondary (MEDIUM confidence)
- `dev.samstevens.totp` library recommendation (widely-used Java TOTP lib; verify exact 1.7.x at plan time via the build).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions inherited/verified from parent POM + shared-lib pom; only TOTP lib is an external add (MEDIUM).
- Architecture/data model: HIGH — fully specified across Docs 9/8/04/02 + main spec; cross-checked against on-disk shared-lib.
- Pitfalls: HIGH — derived from on-disk reality (missing classes, outbox `requireTenantId`, OPA timeout, RLS pre-login) + Phase-1 STATE decisions.
- Seams/open questions: MEDIUM — Phase 2/3 boundary (tenant resolution, provisioning, branches) requires a planner decision; recommendations given.

**Research date:** 2026-06-23
**Valid until:** ~2026-07-23 (stable internal specs; re-check only the external TOTP dep version).
