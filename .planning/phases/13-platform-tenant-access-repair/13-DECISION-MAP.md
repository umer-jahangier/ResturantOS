# Phase 13 — Decision Map

`13-CONTEXT.md` records its decisions as prose under headings rather than as numbered items. This file
assigns each a stable id so plans can cite it and so decision coverage is auditable. **The source of
truth is `13-CONTEXT.md`** — this file only indexes it.

## Locked decisions

| ID | Decision (source: `13-CONTEXT.md`) | Plans |
|----|-------------------------------------|-------|
| D-01 | SuperAdmin authenticates against `platform_users` and reaches the platform API through the real gateway; all three blockers fixed, not one | 13-01, 13-05 |
| D-02 | Platform tokens carry a permission satisfying the existing gate; the gateway allows tenant-less tokens **only** on the platform prefix | 13-01 |
| D-03 | `superadmin@softxlogic.com` / `Test@123!`; the repository-committed seeded SuperAdmin must not remain usable | 13-05 |
| D-04 | The saga inserts the `auth_tenants` row | 13-06, 13-10 |
| D-05 | The saga writes the `user_branch_roles` OWNER assignment | 13-06, 13-10 |
| D-06 | Fix `extractBranchId` — it never matches the real response shape | 13-10 |
| D-07 | Send `isHq: true` for the first branch | 13-10 |
| D-08 | Surface the generated temp password to the caller | 13-10 |
| D-09 | Fix the `seed-coa.enabled` config-key mismatch | 13-10 |
| D-10 | Real compensation for branch + admin user, or an explicit documented manual-repair path | 13-10 |
| D-11 | Public tenant-scoped user API: list (paginated), get, create/invite, update, deactivate | 13-11, 13-12 |
| D-12 | Creation issues a temp password and sets `must_change_password=true` | 13-06, 13-11, 13-15 |
| D-13 | `roleCode` validated against the `roles` table on assignment | 13-06, 13-07, 13-11 |
| D-14 | Role catalog endpoint + permission catalog endpoint | 13-07 |
| D-15 | `POST /api/v1/auth/change-password` (self-service) | 13-04 |
| D-16 | Admin-initiated reset at both tiers | 13-13 |
| D-17 | `must_change_password` enforced at login | 13-08 |
| D-18 | Reset clears `failedLoginCount` / `lockedUntil` | 13-09, 13-13 |
| D-19 | Remove the raw reset token from the `outbox` payload | 13-09 |
| D-20 | Shared password-strength constraint in `shared-lib`, applied to every password-accepting DTO | 13-04 |
| D-21 | Per-account reset cooldown; invalidate outstanding tokens on new issue | 13-09 |
| D-22 | Seed a `WAITER` role — order taking, no till, no void, no refund | 13-02 |
| D-23 | `TENANT_ADMIN` must administer users and branches — **planner chose the split** (see 13-02) | 13-02 |
| D-24 | One role per branch enforced at the schema level — **planner chose the partial unique index** (see 13-02) | 13-02 |
| D-25 | One idempotent seed script: SuperAdmin, 3 tenants with differing modules, 6 personas each, non-empty data, self-verifying | 13-15 |

## Claude's discretion (resolved)

| ID | Decision | Resolution | Plans |
|----|----------|-----------|-------|
| D-26 | Where platform auth lives | platform-admin-service (owns `platform_db` per PLATFORM-07); auth-service signs the token (owns the RSA key) | 13-05 |
| D-27 | Seed-script language | Python 3 + psycopg2, matching `onboarding.py`, with a PowerShell launcher twin | 13-15 |
| D-28 | Seed script drives the real API vs direct writes | Real API wherever one now exists; direct writes enumerated and printed on every run | 13-15 |
| D-29 | Migration tooling per service | Follow the owning service (auth/user/platform = Liquibase) | 13-02, 13-05, 13-08, 13-11, 13-14 |

## Specific ideas from `13-CONTEXT.md`

| ID | Item | Plans |
|----|------|-------|
| D-30 | Verification must be a live end-to-end call per success criterion, never a source grep | every plan; 13-15 is the aggregate |
| D-31 | `notification-service` is an empty stub — implement or declare out of scope, but no silently dead flow | 13-09 (declared out of scope, made explicit and documented) |
| D-32 | `FEATURE_HR` / `FEATURE_PAYROLL` must exist in the tier matrix | 13-03 |
| D-33 | Tenant status enforcement must fail closed | 13-03 |
| D-34 | Impersonation logs the target as the actor — fix it | 13-14 |
| D-35 | Tenant subscription / tier management is in scope | 13-14 |

## Deferred — must NOT appear in any plan

Real billing/payment-provider integration · tenant data purge · platform-user management UI and
SUPPORT/BILLING staff roles · custom domain and per-tenant email config · MFA for platform users
(recorded as a named gap by 13-05, not implemented) · all frontend work (Phase 14) · UI/UX revamp
(Phase 15) · multi-POS and KDS/BDS (Phase 16) · P&L, balance sheet, COGS, exports (Phase 17).
