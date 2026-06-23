---
phase: 02-authentication-authorization
plan: 01
subsystem: auth-service
tags: [spring-boot, java-25, jwt, rs256, jwks, bcrypt, rls, testcontainers, refresh-sessions, outbox]

dependency-graph:
  requires:
    - 01-04   # shared-lib JWT classes, outbox, TenantContext, Testcontainers patterns
  provides:
    - auth-service module (port 8081, auth_db)
    - POST /api/v1/auth/login, /refresh, /logout
    - GET /.well-known/jwks.json
    - SecurityFilterChain wiring shared-lib JwtAuthenticationFilter
    - NON-RLS auth_tenants slug lookup (Phase 2/3 seam)
    - Frozen JWT claim shape for 02-02/02-03
  affects:
    - 02-02: step-up TOTP, branch switch, password reset
    - 02-03: OPA input uses permissions/roles/attributes from JWT

tech-stack:
  added:
    - auth-service Spring Boot module
    - jjwt + nimbus-jose-jwt for signing/JWKS
    - Liquibase migrations for auth_db
    - Testcontainers IT harness (Postgres 18, Redis 8, RabbitMQ 4.3)
  patterns:
    - auth_tenants NON-RLS lookup before tenant GUC
    - login @Transactional(noRollbackFor auth failures) so lockout persists
    - refresh via HttpOnly cookie + refresh_sessions SHA-256 hash
    - USER_LOGIN_* via shared transactional outbox

key-files:
  created:
    - services/auth-service/** (full module)
    - services/auth-service/src/test/java/io/restaurantos/auth/integration/*.java
  modified:
    - pom.xml (auth-service module)
    - deploy/* (config-repo, Colima/docker tweaks)

commits:
  - 6de276f feat(02-01): scaffold auth-service module and auth_db migrations
  - df775fd feat(02-01): JWT signing JWKS and SecurityFilterChain
  - 851d9eb feat(02-01): login refresh logout with RLS and login events
  - ad38711 fix(02-01): persist lockout, permit logout, unique JWT jti
  - c6e204d test(02-01): auth login refresh logout and JWKS integration tests
  - 94779f3 fix(02-01): build and infra fixes for auth-service compilation

deviations:
  - Login failures rolled back with @Transactional — fixed with noRollbackFor on AuthenticationFailedException/AccountLockedException
  - /logout was not permitAll in SecurityFilterChain — added to public auth paths
  - Refresh reissued identical JWT within same second — added jti UUID per token
  - Colima: TESTCONTAINERS_RYUK_DISABLED=true + DOCKER_HOST required for ITs
  - Outbox relay logs NOT_FOUND for auth.topic in IT RabbitMQ (no topology pre-declared in Testcontainers) — events still land in outbox table; relay is best-effort in tests

seed-contract:
  tenant:
    id: a0000001-0000-4000-8000-000000000001
    slug: demo
  branches:
    - id: b0000001-0000-4000-8000-000000000001  # HQ/Main (default at login)
    - id: b0000002-0000-4000-8000-000000000002  # Branch 2
  users:
    - email: cashier@demo.local
      id: c0000001-0000-4000-8000-000000000001
      role: CASHIER (plain-login IT user; no rbac.manage / finance.period.close)
      password: Cashier#2026
    - email: owner@demo.local
      id: c0000002-0000-4000-8000-000000000002
      role: OWNER (privileged; for 02-02 step-up ITs)
      password: Owner#2026 (seed hash in Liquibase)
    - email: accountant@demo.local
      id: c0000003-0000-4000-8000-000000000003
      role: ACCOUNTANT (lockout IT user)
      password: Accountant#2026

jwt-claims-frozen:
  sub: user UUID
  tenant_id: tenant UUID string
  branch_id: active branch UUID string
  roles: [role codes]
  permissions: [permission codes from role_permissions]
  attributes: { approval_limit_paisa: BIGINT from user_branch_roles }
  header: kid (RS256)
  jti: unique per issuance

verification:
  command: "DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_RYUK_DISABLED=true mvn -pl services/auth-service verify"
  result: "5/5 ITs pass (AuthLoginIT×3, RefreshLogoutIT×1, JwksEndpointIT×1)"
  requirements: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-08 covered; AUTH-05/06/07/09 → 02-02; AUTHZ-* → 02-03
---

# Plan 02-01 Summary — Auth Service Core

## Objective

Stand up `auth-service` with login (email + password + tenant slug), RS256 JWT + JWKS, HttpOnly refresh sessions, bcrypt-12 lockout, and login events via the transactional outbox.

## What Was Built

- Full `auth-service` module with Liquibase migrations, RLS on tenant tables, NON-RLS `auth_tenants` lookup
- SecurityFilterChain wiring `JwtAuthenticationFilter` from shared-lib
- Login / refresh / logout endpoints with HttpOnly refresh cookie
- Five Testcontainers integration tests proving SC1 and the refresh/logout half of SC2

## Notes for Downstream Plans

- **02-02:** Use `cashier@demo.local` for non-step-up paths; `owner@demo.local` for step-up TOTP tests. Do not break plain login on cashier.
- **02-03:** OPA input should read `permissions`, `roles`, `tenant_id`, `branch_id`, `attributes.approval_limit_paisa` from JWT claims as frozen above.
