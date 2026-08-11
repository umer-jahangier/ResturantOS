---
phase: 19-admin-surfaces
title: Tenant Admin Surfaces — Users, Settings, Profile
status: executing
created: 2026-08-11
branch: phase-13-access-repair
closes: [GA-003, GA-009, GA-019]
depends_on:
  - "13-02: the rbac.user.manage / rbac.role.manage / branch.manage split off rbac.manage"
  - "13-04: POST /api/v1/auth/change-password"
  - "13-07: GET /api/v1/roles — the ceiling-filtered assignable-role catalogue"
  - "13-09 (D-31): self-service email reset ships DISABLED — no notification consumer exists"
  - "13-12: the whole public /api/v1/users lifecycle"
  - "13-13: POST /api/v1/users/{id}/reset-password"
  - "14b: QueryBoundary — a failed request renders ERROR, never an empty state"
  - "20: the design tokens in globals.css and the nav permission-matrix regression gate"
---

# Phase 19 — Tenant Admin Surfaces

## The shape of the problem

Three of this product's most-reported gaps are the same gap. A complete, tested, tenant-isolated
backend exists, and **nothing in the app reaches it**.

| Gap | The backend | The frontend |
|---|---|---|
| **GA-003** | `/api/v1/users` — 10 endpoints, 56 live assertions across two provisioned tenants (13-12) | zero consumers; one `comingSoon: true` nav entry pointing at a 404 |
| **GA-009** | `PUT /api/v1/branches/{id}` — real, gated, persisting | `/app/settings` → 404, nav entry hidden so the owner cannot see it is missing |
| **GA-019** | `POST /api/v1/auth/change-password` — shipped and tested in 13-04 | only the FORCED variant wired; `/app/profile` and `/settings/profile` both 404 |

The defect register's own summary of the settings/profile situation is the sharpest statement of it:
*"The pages were never built and the fix applied was to delete the links."*

**So this phase writes no backend.** Its entire risk is in being honest about which endpoints exist,
and in refusing to invent the ones that do not.

## Measured before building — the whole basis for the design

Every number below was taken through the real gateway on 2026-08-11, signed in as
`admin@terrace.local` (TENANT_ADMIN) or `manager@terrace.local` (MANAGER).

**Routes, as TENANT_ADMIN, in a real browser:**

```
/app/users ................ 404      /app/settings ............. 404
/app/profile .............. 404      /settings/profile ......... 404
/settings/appearance ...... 200
profile menu .............. ["Appearance", "Log out"]
sidebar Settings group .... ["Appearance"]
```

**APIs that exist:**

```
GET  /api/v1/users?page=&size= ....... 200   (12 users in the seeded tenant)
GET  /api/v1/users/{id} .............. 200   (user + per-branch assignments)
GET  /api/v1/roles ................... 200   7 roles, warning ROLES_WITHHELD_ABOVE_CEILING (1)
GET  /api/v1/branches ................ 200   2 branches
PUT  /api/v1/branches/{id} ........... 200   patch semantics — `PUT {}` changed nothing
```

**APIs that do NOT exist** — this is the load-bearing measurement:

```
GET /api/v1/tenant-profile ........... 404      GET /api/v1/settings ......... 404
GET /api/v1/tenants/{id}/settings .... 404      GET /api/v1/onboarding ....... 404
GET /api/v1/tenants/{id}/theme ....... 404
GET /api/v1/auth/me .................. 404      GET /api/v1/me ............... 404
GET /api/v1/auth/profile ............. 404
```

**Authorization, from live tokens rather than from the RBAC docs:**

```
TENANT_ADMIN  68 permissions: rbac.user.manage, rbac.role.manage, branch.manage — and NOT rbac.manage
MANAGER       53 permissions: no rbac.* at all
              GET /api/v1/users → 403      GET /api/v1/roles → 403
```

That last block settles a question the brief raised. **A MANAGER cannot be "offered OWNER" in a role
picker, because a MANAGER cannot reach a role picker at all** — the catalogue endpoint refuses them.
The ceiling is therefore proved where it is actually reachable: a TENANT_ADMIN's picker, which must
contain no OWNER and must say that something was withheld without naming it.

**What Settings → Appearance really did**, driven in a browser rather than read from source:

```
save (Emerald #10b981 + a logo URL)  →  0 requests to /api/         localStorage written
reload, SAME browser                →  theme <link> injected (app turns green)
                                    →  form reads "3b82f6" (blue), logo field empty
a SECOND browser, same admin        →  default blue, no theme
```

So the screen was not simply "not persisted". It was **half-persisted in the worst direction**: the
colour was re-applied while the form denied it, and the logo URL was written to storage that nothing
reads. A user comparing the green app against the blue form cannot tell which one is lying.

## Decisions

**D-19-1 — Build only on endpoints that answer 200.** Where none exists, say so in the UI. No
`localStorage` stand-in dressed as a saved setting, no field the API will silently drop.

**D-19-2 — Settings is built on the branch record.** `PUT /api/v1/branches/{id}` is the one tenant
configuration endpoint that persists. `fbrStrn` and `ntn` are shown read-only because
`UpdateBranchRequest` has no field for them.

**D-19-3 — The role picker is populated from `GET /api/v1/roles` and never from a constant.** The
endpoint is already a privilege-escalation control (a role appears only if the caller holds every
permission it grants). A hardcoded list would be a second, weaker copy of that rule in the one place
an attacker can edit, and would be wrong the day a role is added.

**D-19-4 — Nav gates must match endpoint gates, `any` for `any`.** The Users entry was gated on
`rbac.manage` alone, which TENANT_ADMIN does not hold — the screen would have been invisible to the
role it exists for. Nav items gain a `permissionMode`.

**D-19-5 — A one-time password gets one component and is never a toast.** Create and admin-reset
both mint a credential that is unrecoverable. It is announced (`role="alert"`), copyable, and says
in words that it will not be shown again.

**D-19-6 — Users live at `/app/users`, not `/app/settings/users`.** The nav had pointed at the
latter for a page that was never built. Moving the entry is smaller than inventing a route to match
a placeholder.

**D-19-7 — Profile has no permission guard.** Its endpoint's authorization is "you are signed in"
and its target is the token's subject. For six of the eight seeded roles the profile menu was
`Log out` alone; a guard here would rebuild that.

## Out of scope, and named

- No tenant-settings, tenant-theme, `/me` or onboarding endpoint is written. Each is reported with
  its status code.
- Logo upload. `file-service` exists but no screen renders a tenant logo, so the field stays a
  labelled URL rather than becoming a working upload to nowhere.
- `approval_limit_paisa` (GA-004). It is displayed on a user's assignments; the create/assign APIs
  accept it but the policy question of who may raise it is not this phase's.
