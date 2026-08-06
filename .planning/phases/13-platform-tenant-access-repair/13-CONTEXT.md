# Phase 13: Platform & Tenant Access Repair — Context

**Gathered:** 2026-08-06
**Status:** Ready for planning
**Source:** Production-readiness audit (`AUDIT-REPORT-2026-08-06.md`) + user direction

<domain>
## Phase Boundary

This phase makes **already-written code reachable**. Phases 2, 3 and 10 shipped a platform-admin API, a provisioning saga, and a per-branch RBAC write path that are individually well-built but jointly unusable at runtime. Nothing here is a new business module — it is the access layer that every other module depends on.

**In scope:** SuperAdmin authentication, tenant provisioning repair, tenant subscription/tier management, user lifecycle CRUD, per-branch role assignment, password management (self-service + admin-initiated), the `WAITER` role, tenant-admin authority, and one authoritative seed script.

**Out of scope (deliberately deferred to later phases):**
- All frontend work → Phase 14 (this phase delivers APIs + the seed script only, with one exception: nothing ships without a way to exercise it, so API-level verification is by script/curl, not UI)
- UI/UX revamp → Phase 15
- Multi-POS terminals, KDS/BDS routing → Phase 16
- P&L / balance sheet / COGS / exports → Phase 17
- HR & Payroll module internals → Phase 11 (merged from PR #3; audited separately)
</domain>

<decisions>
## Implementation Decisions

### LOCKED — SuperAdmin authentication (audit B1)
- SuperAdmin must authenticate against `platform_users` and reach `/api/v1/platform/**` through the **real gateway**, not a hand-minted test token.
- Three independent blockers must all be fixed, not just the first: (1) no login endpoint reads `platform_users`; (2) `JwtAuthenticationFilter` builds authorities from the `permissions` claim only, so `hasAuthority('SUPER_ADMIN')` can never be satisfied by a role claim; (3) `TenantResolutionSupport` errors on a token with no `tenant_id`, and `JwtGlobalFilter` turns that into a 401 — but a platform user is by definition tenant-less.
- Decision: platform tokens carry a **permission** (not merely a role) that satisfies the existing `@PreAuthorize` checks, and the gateway must explicitly allow tenant-less tokens **only** on `/api/v1/platform/**`. Do not weaken tenant resolution for any tenant-scoped route.
- SuperAdmin credentials for this project: `superadmin@softxlogic.com` / `Test@123!`. The existing seeded `superadmin@restaurantos.io` (password committed in `900-seed-platform-users.xml`) must not remain usable in a shippable configuration.

### LOCKED — Provisioning saga repair (audit B2)
A tenant created via `POST /api/v1/platform/tenants` must be able to log in immediately. Every one of these is required:
- Insert the `auth_tenants` row (login resolves tenant by slug; nothing in application code writes this today).
- Write the `user_branch_roles` OWNER assignment (without it `PermissionResolver` throws "User has no active branch assignments").
- Fix `extractBranchId` — it parses `{"data":{"id"}}` but the controller returns `{branchId}`, so it always falls through to `UUID.randomUUID()`, and that fake id becomes the outbox `aggregateId`.
- Send `isHq: true` for the first branch (currently omitted, so the "HQ" branch is persisted `isHq=false` — and `PermissionResolver` uses a hardcoded HQ UUID as its default-branch heuristic).
- Surface the generated temp password to the caller (the controller currently discards it and substitutes a hardcoded login URL, so nobody can ever log in as the new admin).
- Fix the `provisioning.seed-coa.enabled` vs `restaurantos.provisioning.seed-coa.enabled` key mismatch — the `@Value` never binds.
- Make compensation real for branch + admin-user (currently `log.warn` stubs) or explicitly document the manual-repair path.

### LOCKED — User lifecycle (audit B3)
- Add a public, tenant-scoped user API: list (paginated), get, create/invite, update, deactivate. None exists today.
- Creation issues a temp password and sets `must_change_password=true`.
- `roleCode` must be **validated against the `roles` table** on assignment — today an arbitrary string persists and silently yields a permissionless login.
- Add a role catalog endpoint (`GET /api/v1/roles`) and a permission catalog endpoint. A role-picker UI cannot exist without them.

### LOCKED — Passwords
- `POST /api/v1/auth/change-password` (self-service, verifies current password, reuses the existing history + reuse-rejection logic, revokes other sessions, clears `must_change_password`).
- Admin-initiated reset at both tiers (tenant admin → tenant user; SuperAdmin → tenant admin), setting a temp password + `must_change_password` + revoking sessions, and emitting an audit event.
- `must_change_password` must actually be **enforced at login** — it is currently written and never read.
- Reset must clear `failedLoginCount` / `lockedUntil` (a user who resets is otherwise still locked out with no explanation).
- 🔴 The raw reset token is currently written in plaintext into the `outbox` payload alongside the hashed copy. Remove it — emit only `{userId, email}` plus a short-lived handle, or have the consumer fetch the token over an internal channel.
- Add a shared password-strength constraint in `shared-lib` applied to every password-accepting DTO (policy today is `@Size(min=8)` on exactly one DTO).
- Add a per-account cooldown on reset requests and invalidate outstanding tokens when a new one is issued.

### LOCKED — Roles and tenant authority
- Seed a `WAITER` role: order create/update/send_to_kds/view, **no** till open/close, **no** void, **no** refund. Today table staff must be given `CASHIER`, which carries till control.
- `TENANT_ADMIN` must be able to administer users and branches — it is currently denied `rbac.manage`, which is the sole gate on both, so only `OWNER` can administer anything and "multiple admins per tenant" does not work.
- **Decision required from the planner:** either grant `TENANT_ADMIN` the existing `rbac.manage`, or split it into `rbac.user.manage` / `rbac.role.manage` / `branch.manage` and re-gate the controllers. Prefer the split — `rbac.manage` also triggers mandatory TOTP step-up at login, which would force TOTP on every tenant admin as a side effect. Whichever is chosen, state the consequence explicitly.
- A user currently may hold at most one role per branch; a second active row throws `IncorrectResultSizeDataAccessException` at login and there is no DB constraint preventing one. Either add the partial unique index or make the resolver aggregate multiple roles into a permission union. Pick one and enforce it at the schema level.

### LOCKED — Seed script
One idempotent, cross-platform script that produces:
- SuperAdmin `superadmin@softxlogic.com` / `Test@123!`
- 3 tenants with **deliberately different enabled module sets** (so feature-gating is actually exercised, not assumed)
- Per-tenant users covering Admin/Owner, Manager, Cashier, **Waiter**, Kitchen, Accountant
- Enough catalog + transactional data per tenant to make the dashboards and reports non-empty
- **The script must verify every persona's login itself and fail loudly if any cannot log in.** This is the acceptance test for the whole phase.

### Claude's Discretion
- Whether platform auth lives in auth-service or a dedicated controller in platform-admin-service.
- Exact seed-script language (existing seeders are Python + psycopg2; `scripts/onboarding.py` is the closest working analog and uses deterministic uuid5 ids — reuse that idempotency mechanism).
- Whether the seed script drives the repaired provisioning API or writes directly. **Preference: drive the real API wherever it now works** — that is what proves the repair. Direct DB writes only where no API exists, and each such case must be listed.
- Migration tooling per service (auth/user/platform = Liquibase; pos/finance/inventory/etc = Flyway). Follow the owning service's existing tool.

### Decisions taken DURING execution (supersede any earlier plan text that conflicts)

**D-29a — TENANT_ADMIN keeps its money-moving permissions and is TOTP-enrolled at creation.**
13-02 split user/branch administration off the umbrella `rbac.manage` permission as planned, and
verified the tenant-admin token no longer carries it. But `requiresTotpStepUp` also fires on
`finance.period.close` and `hr.payroll.approve`, which TENANT_ADMIN legitimately holds — so a tenant
admin is still prompted for step-up. That makes 13-02's must_have truth #2 unachievable as written.

Resolved by treating the truth as wrong, not the behaviour: **step-up on accounting-period close and
payroll approval is correct and stays.** Revoking those two codes would leave tenant admins unable to
run payroll or close a period at all, breaking the HR and finance modules for every tenant. Instead,
TOTP enrolment becomes part of tenant-admin creation, so the admin has a factor before they first
need it.

Consequences for later plans: **13-05** (platform login) and **13-08** (forced change) must account
for a first-login flow that can require TOTP enrolment; **13-15**'s seed script must enrol TOTP for
every tenant-admin persona it creates, or its own login verification will fail on exactly the persona
that matters most. Reversible: if the user prefers, revoke `finance.period.close` and
`hr.payroll.approve` from TENANT_ADMIN and grant them to a separate finance role instead.

**D-30 — The POS till binds at cash settlement, not at order creation.** See `13-16-PLAN.md`.
13-02's WAITER role is correctly granted `pos.order.create` with no till permission, but
`OrderServiceImpl.createOrder` requires the *creating* user to hold an OPEN till, so a waiter is
authorized to take an order and then refused with `409 NO_OPEN_TILL`. Order creation now binds a till
opportunistically; `PaymentMethod.CASH` settlement requires one. Net effect is stricter than today,
because a cash payment against a null-till order is currently accepted. Per-POS-profile configuration
of this rule is Phase 16 work, not Phase 13.

**13-16 must land before 13-15**, or the seed script's waiter persona cannot complete an order.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The audit that produced this phase
- `AUDIT-REPORT-2026-08-06.md` — §0 (blockers B1–B3), §2.1 passwords, §2.2 SuperAdmin, §2.3 users/roles. Every claim carries a `path:line`.

### Provisioning + platform admin
- `services/platform-admin-service/src/main/java/io/restaurantos/platformadmin/service/ProvisioningService.java` — the 6-step saga, `extractBranchId`, tier limits
- `services/platform-admin-service/src/main/java/io/restaurantos/platformadmin/controller/PlatformAdminController.java` — the API surface + the discarded temp password
- `services/platform-admin-service/src/main/java/io/restaurantos/platformadmin/config/TierFeatureDefaults.java` — feature catalog + tier matrix
- `services/platform-admin-service/src/main/resources/db/changelog/v1.0.0/900-seed-platform-users.xml` — the seeded SuperAdmin

### Auth + RBAC
- `services/auth-service/src/main/java/io/restaurantos/auth/service/AuthServiceImpl.java` — login, TOTP step-up, lockout
- `services/auth-service/src/main/java/io/restaurantos/auth/service/PermissionResolver.java` — default-branch heuristic + JWT permission computation
- `services/auth-service/src/main/resources/db/changelog/v1.0.0/030-create-roles-permissions.xml` — the role/permission seed and the `TENANT_ADMIN != rbac.manage` exclusion
- `shared-lib/src/main/java/io/restaurantos/shared/security/JwtAuthenticationFilter.java` — authorities built from `permissions` only
- `services/auth-service/src/main/java/io/restaurantos/auth/service/PasswordResetService.java` — reset flow + the plaintext-token-in-outbox defect

### Gateway
- `gateway/src/main/java/io/restaurantos/gateway/filter/JwtGlobalFilter.java`
- `gateway/src/main/java/io/restaurantos/gateway/support/TenantResolutionSupport.java` — tenant-less token handling
- `gateway/src/main/resources/application.yml` — routes + rate limits

### Seeding analogs
- `scripts/onboarding.py` — the de-facto working tenant-creation path (deterministic uuid5, bcrypt cost 12, RLS GUC handling)
- `scripts/seed_test_env.py` — most complete existing seeder
- `scripts/e2e/phase12-reporting-e2e.sh` — the only true API-driven seeding recipe (login helper, POS order lifecycle, purchasing lifecycle)
</canonical_refs>

<specifics>
## Specific Ideas

- The audit found `.planning/phases/03-*/03-VERIFICATION.md` scored Phase 3 **24/24 passed** while citing a controller that does not exist. Its verification was grep/structural — which is exactly why B1 went undetected for months. **This phase's verification must be a live end-to-end call per success criterion**, not a source-grep. The seed script's self-verification is the mechanism.
- `notification-service` has **zero source files** while being an active Maven module. Every email path (password reset, invites) is dead. This phase should either implement a minimal consumer or explicitly declare email out of scope and make the temp-password return path the delivery mechanism — but it must not leave a flow that silently does nothing.
- `RouteFeatureMap` gates prefixes on feature codes absent from `TierFeatureDefaults` (`FEATURE_PAYROLL`, `ANALYTICS`, `LOYALTY`, `ECOMMERCE`). With HR now merged, **`FEATURE_HR`/`FEATURE_PAYROLL` must be confirmed present in the tier matrix or every HR request 403s `FEATURE_DISABLED`.** This exact bug has already occurred twice in this repo.
- Tenant status enforcement fails open (`.defaultIfEmpty("ACTIVE")`). Suspension is the primary non-payment lever; fix it here since it is part of subscription management.
- Impersonation logs the target user as the actor. Fix while in this code.
</specifics>

<deferred>
## Deferred Ideas

- Real billing/payment-provider integration — out of scope; tier + limits + status only.
- Tenant data purge (`DELETE` is a status flip today, no cross-service erasure) — needs its own compliance-driven design.
- Platform-user management UI and SUPPORT/BILLING staff roles — Phase 14.
- Custom domain + per-tenant email config (columns exist, never read) — later.
- MFA for platform users (`platform_users` has no TOTP column) — flag as a known gap.
</deferred>

---

*Phase: 13-platform-tenant-access-repair*
*Context gathered: 2026-08-06 from source-level audit*
