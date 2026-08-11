---
phase: 19-admin-surfaces
plan: 01
subsystem: tenant-admin-frontend
status: complete
tags:
  [ga-003, ga-009, ga-019, user-management, settings, profile, role-ceiling, query-boundary, nav]
requires:
  - running dev stack (gateway, auth-service, user-service) + a seeded Floating Terrace tenant
  - "13-02: the rbac.user.manage / rbac.role.manage / branch.manage split off rbac.manage"
  - "13-04: POST /api/v1/auth/change-password"
  - "13-07: GET /api/v1/roles, ceiling-filtered, with ROLES_WITHHELD_ABOVE_CEILING"
  - "13-09 (D-31): self-service email reset ships disabled — no notification consumer"
  - "13-12: the public /api/v1/users lifecycle"
  - "13-13: POST /api/v1/users/{id}/reset-password"
  - "14b: QueryBoundary"
  - "20: design tokens + the nav permission-matrix regression gate"
provides:
  - "/app/users — dense roster, server-side search, active-only filter, paging, detail panel"
  - "/app/settings — branch details persisted through PUT /api/v1/branches/{id}"
  - "/app/profile — own identity, branch assignments, self-service password change"
  - "UserRepository / UserProfileRepository / SettingsRepository (Layer 2)"
  - "useUsers / useUserDetail / useAssignableRoles / useCreateUser / useUpdateUser / useDeactivateUser / useReactivateUser / useAdminResetPassword / useAssignBranchRole"
  - "useChangeOwnPassword, useBranchSettings, useTenantBranches, useUpdateBranchSettings"
  - "OneTimePasswordPanel — the single place a temporary password is rendered"
  - "RoleSelect — populated only from GET /api/v1/roles, reports the withheld COUNT"
  - "NavItem.permissionMode — `any` gating, so nav gates can match hasAnyAuthority endpoints"
affects:
  - "components/shared/sidebar-nav-items.ts, sidebar.tsx, top-bar.tsx, mobile-bottom-nav.tsx — shared shell, minimal edits (§7)"
  - "lib/hooks/auth/use-nav-visibility.ts — one argument forwarded"
  - "__tests__/shared/nav-permission-matrix.test.tsx — the gate this phase was told it would trip"
tech-stack:
  added: []
  patterns:
    - build only on endpoints that answer 200; where none exists, say so in the UI
    - a picker that is a privilege-escalation control must never have a client-side fallback list
    - a nav gate that does not match its endpoint's gate hides the screen from the role it is for
    - a one-time credential is never a toast, and never enters the query cache
    - the shared error map is wrong wherever a status code means something local
    - measure a "not persisted" claim in a browser before repeating it
key-files:
  created:
    - frontend/app/(tenant)/app/users/page.tsx
    - frontend/app/(tenant)/app/settings/page.tsx
    - frontend/app/(tenant)/app/profile/page.tsx
    - frontend/components/users/user-list.tsx
    - frontend/components/users/user-detail-panel.tsx
    - frontend/components/users/user-form-dialog.tsx
    - frontend/components/users/admin-reset-dialog.tsx
    - frontend/components/users/assign-role-dialog.tsx
    - frontend/components/users/role-select.tsx
    - frontend/components/users/one-time-password-panel.tsx
    - frontend/components/settings/branch-settings-form.tsx
    - frontend/components/settings/change-password-form.tsx
    - frontend/components/settings/profile-panel.tsx
    - frontend/lib/api-client/schemas/user.schema.ts
    - frontend/lib/api-client/schemas/settings.schema.ts
    - frontend/lib/models/user.model.ts
    - frontend/lib/models/tenant-settings.model.ts
    - frontend/lib/adapters/user.adapter.ts
    - frontend/lib/adapters/settings.adapter.ts
    - frontend/lib/repositories/user.repository.ts
    - frontend/lib/repositories/user-profile.repository.ts
    - frontend/lib/repositories/settings.repository.ts
    - frontend/lib/hooks/use-users.ts
    - frontend/lib/hooks/use-user-profile.ts
    - frontend/lib/hooks/use-tenant-settings.ts
    - frontend/__tests__/users/user-admin.test.tsx
    - frontend/__tests__/settings/change-password.test.tsx
    - frontend/__tests__/settings/branch-settings.test.ts
  modified:
    - frontend/components/shared/sidebar-nav-items.ts
    - frontend/components/shared/sidebar.tsx
    - frontend/components/shared/top-bar.tsx
    - frontend/components/shared/mobile-bottom-nav.tsx
    - frontend/lib/hooks/auth/use-nav-visibility.ts
    - frontend/components/settings/appearance-form.tsx
    - frontend/app/(tenant)/settings/appearance/page.tsx
    - frontend/__tests__/shared/nav-permission-matrix.test.tsx
decisions: [D-19-1, D-19-2, D-19-3, D-19-4, D-19-5, D-19-6, D-19-7]
closes: [GA-003, GA-009, GA-019]
metrics:
  duration: ~5h
  completed: 2026-08-11
  tasks: 4
  browser_assertions: 31
---

# Phase 19 Plan 01: Tenant Admin Surfaces — Summary

Three 404s became three working screens, on backends that were already proven and had **zero
frontend consumers**. No service was written, no endpoint was added, and every claim below is a
number from a command or a browser run in the state being reported.

**31 PASS / 0 FAIL** in a real browser across two personas, plus 635 unit tests green.

---

## 1. What the product looked like before, measured rather than recalled

Signed in as `admin@terrace.local` (TENANT_ADMIN), through the real gateway:

```
/app/users .................. 404      /app/settings ............. 404
/app/profile ................ 404      /settings/profile ......... 404
profile menu ................ ["Appearance", "Log out"]
sidebar Settings group ...... ["Appearance"]
```

Screenshots in `evidence/before/`. Meanwhile `GET /api/v1/users` answered **200 with 12 users**.

### One correction to the brief, and it is worth stating

The brief lists as work item 4: *"Dead nav links — `mobile-bottom-nav.tsx:51` and `top-bar.tsx`
point at `/app/settings` and `/settings/profile`, which do not exist."*

**They no longer did.** Phase 20-01 had already removed them, and both files say so in comments at
the site. The live measurement above is the proof: the profile menu was `Appearance | Log out` and
the mobile bar's fifth tab pointed at `/settings/appearance`. The links were not dangling — they had
been **deleted**, which is the defect register's own verdict on this area: *"the fix applied was to
delete the links."*

So the work was the inverse of what the brief describes: **restore the destinations, now that the
pages exist.** That is what §7 does.

---

## 2. Users — GA-003

`/app/users`. A dense roster with server-side search, an active-only filter and paging, beside a
detail panel carrying every action.

**Why a list + panel rather than one table with a role column.** `GET /api/v1/users` returns
summaries without assignments; roles come from `GET /api/v1/users/{id}`. A role column would be one
request per row. The panel asks once, for the row you opened.

Live, as TENANT_ADMIN:

| What was driven | Result |
|---|---|
| the roster loads | **12 rows** from the live tenant |
| search `phase19-probe-…` | **1 row** |
| create a user with branch + MANAGER | **201**, temporary password returned |
| the detail panel after create | names **MANAGER** on the chosen branch |
| admin reset, blank reason | button **disabled** — the API's 400 is never how you find out |
| admin reset with a reason | **200**, a second, **different** temporary password |
| the reset password at the login screen | lands on the **forced-change** screen |
| after the forced change | the account **signs in** |
| deactivate | detail reads **Deactivated**, Reactivate offered |
| "Active only" over the deactivated probe | **1 → 0 rows** — the filter does real work |

### The role ceiling, proved where it is reachable

The brief asked for a MANAGER to be shown not being offered OWNER. **A MANAGER cannot reach a role
picker**: measured, `GET /api/v1/roles` → **403** and `GET /api/v1/users` → **403** for
`manager@terrace.local`, whose token carries no `rbac.*` code at all. So the ceiling is proved on
the surface where it exists, and the MANAGER is used for the gate instead:

```
TENANT_ADMIN picker  = ACCOUNTANT, CASHIER, INVENTORY_MANAGER, KITCHEN_STAFF, MANAGER,
                       TENANT_ADMIN, WAITER          ← no OWNER
withheld notice      = "1 more role is not listed. A role can only be granted by someone who
                        already holds every permission it carries."     ← a COUNT, not a name

MANAGER  sidebar     = no Users, no Settings
MANAGER  → /app/users directly = "Access denied"
```

`RoleSelect` has no constant array and no fallback. On a catalogue failure it renders the error, not
an empty `<select>` — an empty picker says *"you may assign no roles"* when the truth is *"we could
not ask"*. All three are frozen in `__tests__/users/user-admin.test.tsx`.

### The one-time password

One component, `OneTimePasswordPanel`, used by both create and reset. `role="alert"`, never a toast,
never in the query cache, with a copy button whose **failure is reported** rather than swallowed —
an admin who believes they copied an unrecoverable credential and did not has lost it. It states:
*"This password will not be shown again. There is no way to retrieve it — only to issue a new one."*
When the new account holds no role it also says the account cannot sign in yet, rather than leaving
that to be discovered at the user's first attempt.

---

## 3. Settings — GA-009, and the "saves to localStorage and forgets" charge

### First: what Appearance actually did, driven in a browser

The brief says it *"saves to `localStorage` and forgets on reload"*. Measured:

```
save (Emerald #10b981 + a logo URL)  →  0 requests to /api/       localStorage written
reload, SAME browser                →  theme <link> IS injected — the app turns green
                                    →  the form reads "3b82f6" (blue), logo field EMPTY
a SECOND browser, same admin        →  default blue, no theme
```

It did not forget. It **half-remembered, in the worst direction**: the colour was re-applied by the
layout's theme injector while the form denied it, so the app was green and the form said blue, and
the logo URL went to storage that nothing on earth reads. The page copy — *"saved locally and will
be applied when you reload"* — was true enough to be believed and wrong enough to mislead.

Both halves are closed. The form now reads back what it wrote (via `useSyncExternalStore` with a
null server snapshot, because reading `localStorage` during the first client render of a
server-rendered form is a hydration mismatch — the same reason `(tenant)/layout.tsx` uses an effect).
And a notice sits **above** the controls, not under them:

> **Saved in this browser only.** There is no API to store a restaurant's branding yet, so this is
> not attached to your account: colleagues, and you on another device, will see the default colours.

A `localStorage` write that throws — private browsing, blocked site data — used to be swallowed with
`// silently skip` under a green "Saved successfully". It is now reported.

### Then: a settings screen that genuinely saves

There is no tenant-settings API. Measured as TENANT_ADMIN:

```
/api/v1/tenant-profile ......... 404      /api/v1/settings .......... 404
/api/v1/tenants/{id}/settings .. 404      /api/v1/onboarding ........ 404
/api/v1/tenants/{id}/theme ..... 404
GET/PUT /api/v1/branches/{id} .. 200
```

So `/app/settings` is built on `PUT /api/v1/branches/{id}` — user-service's `BranchController`,
gated on `hasAnyAuthority('rbac.manage','branch.manage')`. Live:

```
edit Phone → Save        →  exactly ONE PUT to /api/v1/branches/34cd6f62-…   (asserted, count == 1)
reload                   →  the field still reads "+92 21 4628872"
```

Three details that are the design rather than decoration:

- **Only changed fields are sent.** `BranchService.update` applies each field only when non-null
  (`if (req.name() != null) …`), verified live: `PUT {}` answered 200 and returned the branch
  byte-for-byte unchanged. Sending a full snapshot would make every untouched field a write and
  would revert a colleague's concurrent edit. Five cases frozen in
  `__tests__/settings/branch-settings.test.ts`, including the one that matters — a `null` stored
  value and an empty input are the same thing, so a blank field is not a write.
- **STRN and NTN are read-only, with the reason on screen.** `UpdateBranchRequest` declares no field
  for either. An editable box the API silently drops is the defect this phase exists to remove.
- **A gated entry, not an open one.** The nav item was previously ungated; leaving it so would offer
  every cashier a settings page whose only control 403s.

---

## 4. Profile — GA-019

`/app/profile`: identity, branch assignments, and self-service password change. No permission guard —
the endpoint's authorization is "you are signed in" and its DTO has no field naming an account.

### There is no `/me`, so the page says so

```
GET /api/v1/auth/me ....... 404      GET /api/v1/me ............ 404
GET /api/v1/auth/profile .. 404
```

and the access token carries `sub, tenant_id, branch_id, roles, permissions, attributes,
totp_verified` — **no email**. So the panel assembles what can be known truthfully: roles,
permissions count and active branch from the JWT; branch assignments from `GET /api/v1/branches/mine`
(open to any authenticated user); and email, name and 2FA enrolment from `GET /api/v1/users/{self}`
**only when the caller holds an administration authority**, because everyone else gets a 403.

For the roles that cannot read their own row it says, in one sentence, that the platform has no
endpoint returning their account details — rather than rendering a blank field, which would claim
the value is empty. Verified live on the MANAGER probe.

### The password-change defect this found

Driven with a deliberately wrong current password, the form rendered:

> **Please sign in again.**

That is `formatUserFacingError`'s mapping for `UNAUTHENTICATED`, correct nearly everywhere and wrong
here: `changeOwnPassword` throws the same generic authentication failure when
`passwordEncoder.matches` fails, so on this one endpoint the code means *"that password is wrong"*.
The product was telling a signed-in user to do the one thing that could not help and hiding the one
thing they could fix. Now, measured after the fix:

> **That current password is not right. Check it and try again — a wrong guess here does not lock
> your account.**

The reassurance is true and was read out of auth-service, not assumed: `changeOwnPassword`
deliberately skips failed-attempt accounting so a stolen access token cannot be used to lock the real
owner out. `PASSWORD_REUSE` gets its own sentence, because "try again" is useless advice for a rule
that will refuse the same value forever. Mapped locally, not in the shared map — changing that would
make every genuinely expired session in the app say "check your current password".

### Success ends the session, and says so first

`changeOwnPassword` calls `revokeActiveRefreshSessions(userId)`, which revokes **every** unrevoked
refresh session including this browser's (`PasswordPolicyService:218-225`, read rather than assumed).
The access token then works until it expires and the next refresh fails. Leaving a user in that state
means the app logs them out minutes later for no reason they can see, so the form says up front that
every device will be signed out, and on success offers a deliberate sign-out.

Proved end to end on a throwaway account: create → forced change → sign in → wrong current password
refused → correct current password accepted → "Password changed", every session ended.

---

## 5. Defects found and closed while building

**(a) [Rule 1 — bug, shared file] The sidebar gated every nav item TWICE, with two different
semantics.** `NavGroupSection` computes visibility with `useNavGroupVisibility`; `GuardedNavItem`
then wraps the same link in a second `PermissionGuard` that defaulted to `mode="all"`. An item
declaring `permission: ["rbac.manage","rbac.user.manage"]` with `permissionMode: "any"` passed the
hook and was silently hidden by the guard — **for the one role it was written for**. Caught in the
browser, not by reading: the mobile bar (which uses the hook alone) showed Settings correctly while
the sidebar showed only Appearance. Fixed by forwarding `mode`. The double gate itself is the real
defect and is left named rather than removed, because collapsing the two touches every nav item at
once.

**(b) [Rule 1 — bug] The Users nav entry was gated on `rbac.manage` alone.** TENANT_ADMIN does not
hold it — 13-02 split user administration off it precisely so a tenant admin cannot mint an OWNER —
while the endpoint gates on `hasAnyAuthority('rbac.manage','rbac.user.manage')`. Shipping the page
under the old gate would have made it invisible to the role it exists for. `NavItem` gained
`permission?: string | string[]` and `permissionMode`.

**(c) [Rule 1 — bug] `UNAUTHENTICATED` rendered as "Please sign in again" on change-password.** §4.

**(d) [Rule 1 — bug] Uncontrolled→controlled input warning on `/app/settings`.** `useForm({values})`
alone leaves fields holding `undefined` until the query resolves. Observed in the browser console;
fixed with an explicit empty `defaultValues` alongside `values`.

**(e) [Rule 2 — honesty] The Appearance save swallowed storage failures.** §3.

---

## 6. What was NOT built, and its status code

Reported rather than worked around, per the brief:

| Wanted | Status | Consequence |
|---|---|---|
| tenant settings / profile object | `GET /api/v1/tenant-profile` **404** | Settings is built on the branch record |
| tenant theme persistence | `GET/PUT /api/v1/tenants/{id}/theme` **404** | Appearance stays per-browser and says so |
| self-profile endpoint | `GET /api/v1/auth/me` **404**, `/api/v1/me` **404**, `/api/v1/auth/profile` **404** | non-admins cannot be shown their own email; the page says why |
| onboarding state | `GET /api/v1/onboarding` **404** | untouched (GA-046) |
| tenant logo rendering | no consumer anywhere in the app | the field is kept and labelled as inert, not silently dropped |
| self-service email reset | ships **disabled** by D-31 (no notification consumer) | admin reset is the only reset, and the UI says no email is sent |

---

## 7. Shared files — every edit, and why it is the smallest one available

Four other agents were working concurrently. Each edit below is named because the brief asked for it.

| File | Edit |
|---|---|
| `components/shared/sidebar-nav-items.ts` | `NavItem.permission` widened to `string \| string[]`; `permissionMode` added; the Settings group's General and Users entries lose `comingSoon`, gain `any`-mode gates, and Users' href moves `/app/settings/users` → `/app/users` |
| `components/shared/sidebar.tsx` | **one argument**: `mode={item.permissionMode ?? "all"}` forwarded to the inner `PermissionGuard`. §5(a) |
| `components/shared/top-bar.tsx` | Profile and Settings restored to the profile menu and the ⌘K list, each gated as its page is |
| `components/shared/mobile-bottom-nav.tsx` | the fifth tab points at `/app/settings` (a real page now) instead of `/settings/appearance`, gated on permissions rather than a role list that would drift from the page's own guard |
| `lib/hooks/auth/use-nav-visibility.ts` | **two lines**: `item.permissionMode` passed to the existing `hasPermission`, which already accepted a mode |
| `__tests__/shared/nav-permission-matrix.test.tsx` | the regression gate this phase was told it would trip — see below |

### The nav gate, and the assertion its author left for this phase

That test carried a note: *"the two items `rbac.manage` would unlock (Settings → Users) are
`comingSoon: true` … Recorded here so that when `/app/settings/users` ships, THIS assertion is what
forces the split."* It shipped, and it did force it:

- The TENANT_ADMIN fixture gains `rbac.user.manage` and `branch.manage` — previously omitted because
  no nav item read them, which made the fixture describe a principal that does not exist.
- OWNER and TENANT_ADMIN now both see `General, Appearance, Users` — the same set for **different
  reasons**, which is the requirement rather than a coincidence.
- **A new control makes that assertion mean something**: strip the two narrow codes and the Settings
  group must collapse to `Appearance` alone. Without it, "TENANT_ADMIN sees Users" would pass just as
  happily against a nav that gates it on nothing.
- The dead-link list shrinks from `["/app/settings", "/app/settings/users", "/app/reporting"]` to
  `["/app/settings/users", "/app/reporting"]`.

MANAGER, ACCOUNTANT, CASHIER and KITCHEN_STAFF expectations are **unchanged**.

### Two staging notes, recorded rather than hidden

**1. A shared file was split by hunk.** `components/shared/sidebar-nav-items.ts` also contained phase
19b's uncommitted `Tables` entry. Rather than sweeping another agent's work into this commit — the
exact mis-attribution 13-12 recorded and regretted — the diff was split by hunk and only this plan's
three hunks were staged with `git apply --cached` on a filtered patch. Verified both times: the
staged diff contains **zero** lines mentioning `Armchair` or `/app/tables`, and 19b's work is
untouched in the working tree afterwards.

**2. The first commit was broken, and the fix is a second commit rather than an amend.** `cf28719`
committed `sidebar.tsx`, `mobile-bottom-nav.tsx` and the permission-matrix test — all of which read
`item.permissionMode` — while `sidebar-nav-items.ts`, which **declares** it, was lost from the index
between staging and commit. `HEAD` therefore did not typecheck for one commit. Caught by checking the
commit's contents afterwards rather than by trusting the staging step, and closed by `8319dbc`.

It is a follow-up and not an `--amend` deliberately: four agents are committing onto this branch, so
rewriting a shared tip to tidy history risks more than an honest second commit is worth. The lesson
worth carrying is the narrower one — **`git apply --cached` staging must be re-verified immediately
before `git commit`, not only after it**, because a concurrent `git add`/`git reset` in another agent's
shell can clear it in between.

**Commits:** `cf28719` (the surfaces) · `8319dbc` (the missing declaration).

---

## 8. Architecture and house rules

- **4-layer boundary**, ESLint-enforced across `app/**` and `components/**`: schemas (`lib/api-client/schemas`)
  → repositories + models + adapters → hooks → pages/components. No page or component imports a
  repository or the api-client; `lint` is clean of boundary errors.
- **`QueryBoundary` on every fetching surface** — the roster, the detail panel, branch settings, the
  branch pickers, the profile panels. Two paired assertions freeze the contract: a 500 renders the
  error **and must not** render "No users yet"; an empty 200 renders the empty state **and must not**
  render the error.
- **Design tokens only.** No new colours. The one-time-password panel uses `--primary-700` (the
  light-theme solid fill); warnings use the existing `warning` pair.
- **Never render a forbidden control.** `canAdministerUsers` (`rbac.manage | rbac.user.manage`) and
  `canAssignRoles` (`rbac.manage | rbac.role.manage`) are read **separately** rather than collapsed
  into one "is an admin" boolean, which would quietly re-merge the split 13-02 made.
- **Self-deactivation is withheld** with the reason stated where the button would be: the API permits
  it, but it revokes your own sessions mid-click.
- **No money is rendered.** `approvalLimitPaisa` is carried through the model as BIGINT paisa and is
  not displayed by this plan.

---

## 9. Verification actually run

All frontend gates from the repo root, on the state being reported.

| Gate | Result |
|---|---|
| `pnpm --dir frontend exec tsc --noEmit` | **clean** |
| `pnpm --dir frontend run lint` | **0 errors**, 11 warnings — all `react-hooks/incompatible-library` in inventory/purchasing/data-table, **none in a file this plan touched** |
| `pnpm --dir frontend run format:check` | 6 warnings, **all** in concurrent agents' files (`app/(tenant)/app/tables/**`, `components/menu/**`, `e2e/kds-and-dashboards.spec.ts`); every file this plan touched is clean |
| `pnpm --dir frontend exec vitest run` | **74 files, 635 tests, 0 failures** (was 73 / 631) |
| └ `__tests__/users/user-admin.test.tsx` | **8/8** (new) |
| └ `__tests__/settings/change-password.test.tsx` | **4/4** (new) |
| └ `__tests__/settings/branch-settings.test.ts` | **5/5** (new) |
| └ `__tests__/shared/nav-permission-matrix.test.tsx` | **11/11** (was 10; +1 control) |
| Browser suite, TENANT_ADMIN + a MANAGER probe | **31 PASS / 0 FAIL** |
| Browser, wrong-password re-verification after the fix | message correct, still signed in, password unchanged |
| Browser, mobile 390×844 | bottom nav `Dashboard, Orders, Menu, Finance, Settings`; `/app/settings` renders |
| Seeded credentials afterwards | `admin@terrace.local` / `Terrace#Admin1` **still works** — no seeded password was changed |

Screenshots: `evidence/before/` (10) and `evidence/after/` (20), including the create dialog with the
ceiling-filtered picker, both one-time-password panels, the saved settings form, the MANAGER's
`Access denied`, and the MANAGER's profile.

### Tenant left clean

The probe account `phase19-probe-*@terrace.local` was **deactivated** through the UI at the end (the
API has no hard delete; deactivation is the terminal state it offers). No other row was created and
no seeded persona was modified.

### Two things observed and NOT diagnosed

1. **The gateway's `auth-route` opened its circuit twice** under my probe traffic, answering
   `SERVICE_UNAVAILABLE` to login for 1–5 minutes. It is the per-IP bucket the runbook describes
   (`replenish 2/s, burst 100`) shared with four concurrent agents. Waited out; not investigated.
2. **`/api/v1/branches/**` hung at the gateway for ~3 minutes** while user-service answered `200`
   **directly on :8082** and Eureka showed it `UP`. Anonymous requests still 401'd instantly, so the
   filter chain was fine. This is failure mode #1 in `scripts/e2e/browser-e2e.sh`'s preflight (a
   wedged route behind a healthy `/actuator/health`). It cleared on its own. Recorded, not diagnosed.

### GitNexus, per CLAUDE.md

The MCP tools were not available in this session and **no result is reported from them**. The index
is stale (last built at `5fba4a9`) and was not refreshed, for the reason 13-01 through 13-13 all
gave: `gitnexus analyze` rewrites `CLAUDE.md`, `AGENTS.md` and six skill files. `detect_changes` was
not used and **no clean result is claimed from it** — 13-07 and 13-11 both recorded that it answers
"No changes detected" against a dirty tree, and this tree has four agents in it. Blast radius was
established by reading; the hook surfaced related symbols on several calls and is what pointed at
`hasPermission`'s two call sites. The two edits carrying real risk:

| Target | Change | Risk actually taken |
|---|---|---|
| `NavItem.permission` (type widened) | additive | MEDIUM in blast radius — every nav item in the app. Covered by the permission matrix, which asserts the exact visible set for six roles plus the new stripped-codes control. |
| `GuardedNavItem`'s `PermissionGuard` | `mode` forwarded | LOW — `mode` defaults to `"all"`, so every pre-existing single-code item is byte-identical in behaviour. |

---

## Known stubs

None. Every screen this plan created is wired to a live endpoint and was driven against one. The two
places where the platform has nothing to wire to — tenant-wide appearance, and a non-admin's own
email address — render an explicit statement of that fact rather than a placeholder, and both
statements are asserted in the browser run.

## Threat flags

- **T-19-A (privilege escalation through the role picker)** — the picker is populated only by
  `GET /api/v1/roles`, which is ceiling-filtered server-side. No constant list, no fallback, no
  client-side re-filtering. Asserted live (TENANT_ADMIN is offered no OWNER) and by test (the option
  list equals exactly what the server sent).
- **T-19-B (the ceiling leaking what it withholds)** — the withheld notice renders a COUNT parsed
  from the envelope warning and is asserted to contain no role name.
- **T-19-C (a forbidden control being rendered)** — user-lifecycle and role-assignment authorities are
  read separately, matching 13-02's split. Proved live: a MANAGER sees neither Users nor Settings in
  the nav and is refused at `/app/users`.
- **T-19-D (a one-time credential outliving its dialog)** — held in component state only, never in the
  query cache, never in a toast, never auto-dismissed. Copy failure is surfaced.
- **T-19-E (a client naming its own tenant)** — no request shape in this plan declares a tenant field.
  Scope comes from the verified JWT; 13-12 asserted a body carrying a foreign tenant is dropped.
- **T-19-F (a password field on a user form)** — none exists on create or edit. The PATCH endpoint
  refuses `password` / `newPassword` / `passwordHash` / `temp_password` with a 400, so such an input
  could only ever produce an error and would teach an admin the wrong model.
- **T-19-G (supply chain)** — did not arise. **No package of any kind was installed, in any
  ecosystem.**

## Self-Check: PASSED

All 28 created files exist on disk (checked individually, 28/28 FOUND). Both commits exist in
`git log`: `cf28719` and `8319dbc`. All 8 modified files carry this plan's changes and no other
plan's, verified hunk by hunk before staging (§7). `HEAD`'s nav contract was re-checked after the
second commit and is self-consistent — `sidebar-nav-items.ts` declares `permissionMode`, and
`sidebar.tsx`, `mobile-bottom-nav.tsx` and `use-nav-visibility.ts` all read it; `tsc --noEmit` is
clean and the 32 nav/users/settings tests pass. Every number in §9 came from a command executed in
the reported state.
