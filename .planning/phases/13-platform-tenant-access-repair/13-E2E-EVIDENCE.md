# Phase 13 — end-to-end evidence

**Reference run:** 2026-08-07, branch `phase-13-access-repair`
**Command:** `bash scripts/e2e/phase13-acceptance.sh`
**Environment:** local dev stack — PostgreSQL 18, Redis, RabbitMQ, OPA, Eureka, ClickHouse, all
under Docker; gateway, auth, user, platform-admin, pos, inventory, purchasing, finance, reporting
and hr running on the host from jars built from this branch.

---

## Why this document exists

The production-readiness audit's closing finding is quoted here in full because it is the reason
for every choice below:

> `.planning/phases/03-*/03-VERIFICATION.md` scored Phase 3 **24 / 24 passed** while citing a
> controller that does not exist.

That verification was **structural** — it grepped source. It is precisely why blocker B1, "no
SuperAdmin can authenticate", survived for months inside a phase marked complete. A grep cannot
tell an over-granted role from a correctly-granted one, cannot tell a registered route from a dead
one, and cannot tell a written flag from a read one.

**So every claim in this document is a live HTTP call through the real gateway, and every number
is the output of a command run in the state being reported.** Nothing here cites a file path as
evidence of behaviour. Where something is not proved, it says so.

---

## 1. The six ROADMAP success criteria, each mapped to a live assertion

### SC1 — a SuperAdmin authenticates against `platform_users` and reaches `/api/v1/platform/**`

**Live assertion.** `scripts/e2e/phase13-superadmin-e2e.sh`, and the seed's own verification:

```
POST http://localhost:8080/api/v1/platform/auth/login
     {"email":"superadmin@softxlogic.com","password":"Test@123!"}     -> 200

decoded token:  roles=["SUPER_ADMIN"]  permissions=["SUPER_ADMIN"]
                token_type="platform"  and NO tenant_id claim at all

GET  http://localhost:8080/api/v1/platform/tenants                     -> 200
```

All three of B1's independent blockers are refuted by that pair. The token is minted from
`platform_users` by a real password check; it satisfies `hasAuthority('SUPER_ADMIN')` because the
role is projected into the permission claim the filter actually reads; and it crosses the gateway
**with no `tenant_id`**, which `TenantResolutionSupport` used to turn into a 401.

**Control that makes it mean something:** the same script asserts a *tenant* token is refused 403
on the platform prefix. Without that, a 200 could equally mean the prefix is open.

### SC2 — a tenant provisioned through the saga can immediately log in

**Live assertion.** `scripts/e2e/phase13-provisioning-e2e.sh`, and every run of the seed, which
provisions its tenants this way and then logs their owners in:

```
POST /api/v1/platform/tenants  {"brandName":"Floating Terrace","adminEmail":"owner@terrace.local",
                                "tier":"ENTERPRISE"}                   -> 201
     -> {tenantId, slug:"floating-terrace", adminEmail, tempPassword, loginUrl}

POST /api/v1/auth/login   (temp password)                              -> 403 PASSWORD_CHANGE_REQUIRED
POST /api/v1/auth/change-password/forced                               -> 200
POST /api/v1/auth/login                                                -> 401 TOTP_ENROLLMENT_REQUIRED
POST /api/v1/auth/2fa/bootstrap  +  /verify                            -> 200
POST /api/v1/auth/login   (with a code)                                -> 200, roles=["OWNER"],
                                                                          65 permissions
GET  /api/v1/users                                                     -> 200
```

Each of B2's seven defects is closed by a step in that sequence rather than by inspection: the
`auth_tenants` row exists (login resolves the tenant by slug at all), the `user_branch_roles`
OWNER assignment exists (`PermissionResolver` resolves 65 permissions instead of throwing "user has
no active branch assignments"), the HQ branch is `is_hq=true` (the seed's `GET /api/v1/branches`
finds exactly one HQ, and dies if it does not), the branch id is the real one, and the temporary
password reached the caller — which is the only reason any of the rest could be attempted.

### SC3 — a tenant admin manages users and per-branch roles through a public API

**Live assertion.** `scripts/e2e/phase13-tenant-admin-users-e2e.sh` (two genuinely provisioned
tenants, all five verbs asserted across the boundary), `phase13-role-catalog-e2e.sh`, and the seed,
which creates every non-provisioned account this way — seven per tenant — reading the role
catalog first:

```
GET  /api/v1/roles                                    -> 200, and the seed FAILS THE RUN if the
                                                          catalog does not offer every role it is
                                                          about to assign (measured live:
                                                          ACCOUNTANT, CASHIER, INVENTORY_MANAGER,
                                                          KITCHEN_STAFF, MANAGER, TENANT_ADMIN,
                                                          WAITER)
POST /api/v1/users  {email, fullName, locale, branchId, roleCode}   -> 201 + a one-time temp password
POST /api/v1/users/{id}/branch-roles  {branchId, roleCode}          -> 200 + displacedRoleCode
POST /api/v1/branches {name, isHq:false}                            -> 201
```

The role catalog is **read, not hardcoded**, and a disagreement between the catalog and the seed's
expectations aborts the run naming the difference. That is deliberate: a `roleCode` that persists
but resolves to nothing yields a login with an empty permission list, which is exactly the silent
failure B3 is about — and the verification loop below would catch it a second time, because it
asserts every token carries a **non-empty** permission list.

An unknown role code is refused **400 `UNKNOWN_ROLE_CODE`** with nothing written
(`phase13-tenant-admin-users-e2e.sh`).

### SC4 — password management

**Live assertion.** Four scripts, each proving a different half:

| Claim | Script | Assertion |
|---|---|---|
| a user changes their own password | `phase13-password-change-e2e.sh` | 200, old password then 401 |
| `must_change_password` forces a change at next login | `phase13-forced-change-e2e.sh` | `403 PASSWORD_CHANGE_REQUIRED` carrying a single-use change token; a wrong current password **spends** it |
| an admin resets another user's password | `phase13-admin-reset-e2e.sh` | 200 at both tiers, audit row read out of `event_outbox` naming actor ≠ target |
| a reset clears the login lockout | `phase13-admin-reset-e2e.sh` | five real wrong passwords → the **correct** password is refused `423`; after the reset the next login is `403 PASSWORD_CHANGE_REQUIRED`, **not** `423` |
| the raw reset token is not in the outbox | `phase13-reset-hardening-e2e.sh` | 0 rows match the raw value by **content**, not by key name |

**And the seed proves the same thing on every account it creates, all of which stay usable
afterwards.** Every created persona walked
`create → 403 PASSWORD_CHANGE_REQUIRED → forced change → login`, and every provisioned owner
walked it from the provisioning temporary password. No persona is left holding a temporary credential —
which is checked, not asserted: the verification loop logs each one in with its **documented**
password.

### SC5 — `WAITER` exists without till permissions, and `TENANT_ADMIN` can administer

**Live assertion.** `scripts/e2e/phase13-roles-e2e.sh`, both directions:

```
waiter token carries pos.order.create / update / view / send_to_kds        PASS
waiter token carries NO pos.till.*, NO pos.order.void*, NO pos.order.refund PASS
POST /api/v1/pos/orders          as the waiter                     -> 201
POST /api/v1/pos/tills           as the waiter                     -> 403

tenant admin token carries rbac.user.manage, rbac.role.manage, branch.manage  PASS
tenant admin token does NOT carry rbac.manage                                 PASS
POST /api/v1/branches            as the tenant admin               -> 201
DELETE /api/v1/branches/{id}     as the tenant admin               -> 204
```

**And it is proved end to end by the seed, which is the stronger claim.** A `WAITER` persona takes
three to seven real orders per tenant, adds lines, fires them to the KDS and serves them — holding
**no till**, because it cannot open one. A `CASHIER` persona opens a till and settles them. That is
D-30 exercised rather than described: a `CASH` tender by a user with no open till is refused
`409 NO_OPEN_TILL`, and the seed treats that refusal as its own fault, not the product's.

**One correction recorded here rather than buried.** `phase13-roles-e2e.sh` sat at **23 PASS /
1 FAIL** for the whole phase. Its failing assertion was "tenant admin logs in with no TOTP
challenge" — the pre-**D-29a** claim. D-29a resolved that in favour of the *behaviour*: step-up on
`finance.period.close` and `hr.payroll.approve` is correct and stays, because revoking them would
leave tenant admins unable to run payroll or close a period at all. The assertion is therefore
inverted to the **shape** of the challenge — the admin IS challenged, and NOT because of
`rbac.manage`, which its token is still asserted not to carry — and the script now enrols its own
factor over the public bootstrap endpoints instead of requiring `generate_totp.py --enroll` to have
been run by hand. **It is 25 PASS / 0 FAIL.** The phase has no remaining known exception.

### SC6 — one idempotent seed script that verifies every persona's login itself

**This is the criterion the whole plan exists for, and it is the one that cannot be faked.**

```
$ python3 scripts/seed_restaurantos.py --phase verify

  PASS  superadmin@softxlogic.com   roles=['SUPER_ADMIN'] permissions=1  GET /api/v1/platform/tenants -> 200
  --- Floating Terrace (floating-terrace) ---
  PASS  owner@terrace.local         OWNER              65 permissions  /api/v1/users -> 200
  PASS  manager@terrace.local       MANAGER            49 permissions  /api/v1/pos/menu/categories/admin -> 200
  PASS  cashier@terrace.local       CASHIER            14 permissions  /api/v1/pos/tills -> 200
  PASS  waiter@terrace.local        WAITER              7 permissions  /api/v1/pos/tables -> 200
  PASS  kitchen@terrace.local       KITCHEN_STAFF       2 permissions  /api/v1/pos/stations -> 200
  PASS  accountant@terrace.local    ACCOUNTANT         24 permissions  /api/v1/finance/accounts -> 200
  PASS  admin@terrace.local         TENANT_ADMIN       64 permissions  /api/v1/users -> 200
  PASS  storekeeper@terrace.local   INVENTORY_MANAGER   5 permissions  /api/v1/inventory/ingredients -> 200
  --- Control Bistro (isolation test tenant) ---      … eight more, identical shape …

  17 of 17 principals authenticated and reached a role-appropriate endpoint.
```

Each line is three assertions, not one: the login succeeds through the real gateway, the returned
token carries the **expected role** and a **non-empty** permission list, and one endpoint gated on
a permission **only that role holds** answers 200 — not merely "not 403".
`GET /api/v1/pos/stations` is `KITCHEN_STAFF`'s only reachable POS read;
`GET /api/v1/inventory/ingredients` is `INVENTORY_MANAGER`'s.

**Two tenants with genuinely different enabled module sets**, asserted pairwise by the script
rather than assumed:

```
floating-terrace                        ENTERPRISE  20 features  tier default
control-bistro-isolation-test-tenant    STARTER      8 features  FEATURE_CRM forced OFF
                                                                 (ON in every tier by default)

terrace ⊖ control: only terrace = [ANALYTICS, AUDIT_EXPORT, CONSOLIDATED_REPORTING, CRM,
                                   CUSTOM_ROLES, ECOMMERCE, LOT_TRACKING, MULTI_BRANCH, NLQ,
                                   REPORTING_ADVANCED, WHATSAPP_NOTIFICATIONS,
                                   WHITE_LABEL_DOMAIN]
```

The `FEATURE_CRM` override matters more than it looks: tier alone leaves STARTER a strict **subset**
of ENTERPRISE, and a subset cannot distinguish "gating works" from "the lower tier simply has
fewer rows". Forcing a module that is ON in *every* tier to OFF for one tenant is what makes the
two sets incomparable.

> **⚠️ This differs from the plan and from the brief this agent was given, and the difference is
> not mine to resolve.** 13-CONTEXT's LOCKED decision and 13-15-PLAN both say **three** tenants
> with six personas each — eighteen personas, nineteen principals — and that is what this plan
> first delivered (commit `bba1f78`, verified 19/19 live). Commit `591cddd`, by a concurrent
> agent, replaced it with **one working tenant plus one isolation control and eight personas
> each**, stating in its message that the user named Floating Terrace as the real restaurant and
> asked for the other tenants to be dropped. That later instruction was not visible to this agent
> and has not been undone. **What is verified here is what is on disk.** If three tenants are
> still wanted, the configuration is one list literal — `TENANTS` in
> `scripts/seed_restaurantos.py` — and nothing else in the script changes.
>
> The newer shape is genuinely stronger in one respect and it is worth saying so: `TENANT_ADMIN`
> and `INVENTORY_MANAGER` previously had **no seeded account at all**, so the role the entire
> 13-11/13-12 privilege-ceiling work exists to constrain was the least exercised one in the
> platform. Both now have a persona and both are verified live.

---

## 2. The verification is proved able to FAIL

A verification that cannot fail is not a verification (T-13-15-D). Demonstrated, not asserted:

```
$ python3 scripts/seed_restaurantos.py --corrupt-persona cashier@saffron.local
  ! cashier@saffron.local's stored password hash has been deliberately replaced.

$ python3 scripts/seed_restaurantos.py --phase verify
  ...
  FAIL  cashier@saffron.local          401 UNAUTHENTICATED
  ...
  18 of 19 principals authenticated and reached a role-appropriate endpoint.

  THE SEED IS NOT COMPLETE. A partial seed is a failed seed.
    ✗ cashier@saffron.local: 401 UNAUTHENTICATED
$ echo $?
1
```

It exits **1**, and it names **exactly** the corrupted address and no other. Repaired afterwards
through the real administrator-reset endpoint:

```
$ python3 scripts/seed_restaurantos.py --phase personas
  ! cashier@saffron.local: 401 UNAUTHENTICATED — repairing through the administrator reset endpoint
  ✓ cashier@saffron.local: CASHIER, 14 permissions — ok
```

Note what the repair used: `POST /api/v1/users/{userId}/reset-password` — 13-13's endpoint, the
**only** working way to set a user's password now that self-service delivery ships disabled
(13-09 / D-31, `notification-service` has zero source files). The recovery path is itself a live
exercise of a repaired API, not a database write.

---

## 3. Idempotency

Three consecutive full runs against the same stack. The first from a clean slate:

Measured on the three-tenant configuration this plan first delivered, from a clean slate:

| | run 1 (clean) | run 2 | run 3 |
|---|---|---|---|
| tenants | 3 provisioned | 3 reconciled, none duplicated | 3 reconciled |
| personas | 18 created and activated | 18 found, 0 created | 18 found, 0 created |
| settled POS orders | 3 / 5 / 7 | 3 / 5 / 7 | 3 / 5 / 7 |
| vendor invoices | 1 / 2 / 3 | 1 / 2 / 3 | 1 / 2 / 3 |
| principals verified | 19 / 19 | 19 / 19 | 19 / 19 |
| exit code | 0 | 0 | 0 |
| warnings | 0 | 0 | 0 |
| elapsed | 50s | 36s | 33s |

And on the two-tenant configuration now on disk, re-running against an already-seeded stack:
**17 of 17 principals, exit 0, no direct writes, 12s** — every account found and reconciled,
nothing created, nothing duplicated.

Nothing is duplicated because every identifier the script controls is a `uuid5` over a stable name
— and, importantly, one **scoped to the tenant id** rather than to a tenant key. See §5.

---

## 4. The direct-write ledger

Printed on **every run**, and on the normal path it reads:

```
  NONE. Every resource this run created or changed went through a real API at the
  gateway. There is nothing on this list, and that is stated explicitly rather than
  left to be inferred from an empty section.
```

Three direct writes exist in the script and none is reachable on a normal run:

| Write | Table | Why no API covers it |
|---|---|---|
| clear an enrolled TOTP factor | `auth_db.users.totp_secret` | **recovery only.** No endpoint at any tier resets another user's second factor. 13-13's administrator reset deliberately leaves TOTP intact, and is right to — a password reset replaces one factor, not both. The replacement would be an admin "revoke second factor" beside `POST /api/v1/users/{userId}/reset-password`. |
| delete password history | `auth_db.password_history` | **recovery only.** `PasswordPolicyService.HISTORY_DEPTH` is 5, so a persona that has already held its documented password cannot be returned to it. Nothing can rescind history and nothing should — the rule is a control on *human* password choice. |
| replace a password hash with an unusable value | `auth_db.users.password_hash` | **`--corrupt-persona` only.** Deliberate fault injection, so §2 is possible. |

Everything else — tenant provisioning, tier changes, feature toggles, user creation, branch-role
assignment, branch creation, forced password change, TOTP enrolment, menu and category creation,
units of measure, ingredients, recipes, vendors, purchase orders, goods receipt, vendor invoices,
till opening, order creation, KDS dispatch, serving and settlement — goes through the public API at
the gateway.

**Historical business dates without a single direct write.** Vendor invoices are dated across
several days through `invoiceDate`, which is a real request field. Point-of-sale orders land on the
current business date and are **not** back-dated: `BusinessDay.of(closedAt)` derives it from the
wall-clock close time, no endpoint accepts an override, and `business_date` is part of the
ClickHouse fact tables' `ORDER BY` and partition key so it cannot be mutated afterwards either.
Faking it would have meant writing analytics rows by hand, which is worse than the limitation. A
report over the last thirty days is non-empty; a report over a month with no seeding in it is not,
and that is stated rather than papered over.

---

## 5. 🔴 A cross-tenant data exposure this plan's artifact found

**Recorded here because it is the most significant finding of this plan, and because it was found
the way the audit says findings have to be found: by driving the real API, not by reading code.**

The seed built a menu for a freshly provisioned Saffron Grill, reconciled against
`GET /api/v1/pos/menu/items/admin`, and **adopted a different tenant's menu item id.** Every order
priced from it was then rejected. The same run adopted another tenant's vendor from
`GET /api/v1/purchasing/vendors` and got `404 Vendor not found` on the next call — because the
write path is tenant-scoped while the read path is not.

Measured live, on the running databases:

| table | `relrowsecurity` | `relforcerowsecurity` | owner | runtime role |
|---|---|---|---|---|
| `pos_db.menu_items` | `t` | **`f`** | `pos_user` | `pos_user` |
| `pos_db.menu_categories` | `t` | **`f`** | `pos_user` | `pos_user` |
| `pos_db.orders` | `t` | **`f`** | `pos_user` | `pos_user` |
| `purchasing_db.vendors` | `t` | **`f`** | `purchasing_user` | `purchasing_user` |
| `purchasing_db.purchase_orders` | `t` | **`f`** | `purchasing_user` | `purchasing_user` |
| `purchasing_db.vendor_invoices` | `t` | **`f`** | `purchasing_user` | `purchasing_user` |

PostgreSQL exempts a table's **owner** from its own policies unless `FORCE ROW LEVEL SECURITY` is
set, and both services connect as the role that owns their tables. The queries carry no tenant
predicate of their own: `MenuItemRepository.findAllOrderByName` is
`SELECT i FROM MenuItem i ORDER BY i.name`, and `OrderRepository.findByClientOrderId` — the
**idempotency key** for order creation — has no tenant clause either.

Contrast the tables this phase repaired: `auth_db.users`, `auth_db.user_branch_roles`,
`user_db.branches` and `finance_db.chart_of_accounts` are all `t | t`. That difference is why a
`psql` session against `user_db.branches` without the tenant GUC returns nothing, and why the same
session against `pos_db.orders` returns every tenant's rows.

**The live evidence:**

```
saffron manager token: tenant_id = 4f2783b6-437f-4944-99da-29abe77f8db8
GET /api/v1/pos/menu/items/admin  ->  13 items, of which 2 belong to this tenant
                                      including "Beef Nihari", owned by the `test` tenant
POST /api/v1/pos/orders/{id}/items {menuItemId: <test tenant's item>}  ->  200, priced 110000 paisa
```

**Not fixed here**, and the reason is stated rather than implied: it is two migrations plus a
re-audit of every query path in two services this plan's file list does not touch, and
`ALTER TABLE … FORCE ROW LEVEL SECURITY` on a service whose queries have never carried a tenant
predicate is an availability decision, not a bug fix. It is recorded as item **9** in
`deferred-items.md` with the exact remedy. The seed is instead made **immune**: every identifier it
controls is scoped to the tenant id and every reconciliation key is a marker containing that id, so
a neighbour's row can never be adopted — and both call sites say why.

---

## 6. The acceptance runner

`scripts/e2e/phase13-acceptance.sh` is the artifact a reviewer runs to accept the phase. It runs
every phase 13 end-to-end script in dependency order, then the seed script in full — ending with
its verification of all nineteen principals — and reports one aggregate result.

Two things about it are worth knowing before reading a red result:

**It carries each suite's baseline.** "48 PASS / 0 FAIL" means nothing on its own: a script that
silently stopped asserting half of what it used to also reports zero failures. A count that
**drops** while still passing is a regression in the verification itself, and the runner flags it.

**It retries a red suite once, and reports the retry.** Two things in this phase are genuinely
timing-dependent against a live stack, and both were measured rather than assumed:

- the gateway's per-IP auth budget is a token bucket at **2/s with a burst of 100**, so an
  exhausted bucket needs ~50 seconds of quiet. `phase13-admin-reset-e2e.sh` spends five deliberate
  wrong-password logins building a real lockout, and run immediately after twelve other scripts it
  reported **36 PASS / 7 FAIL with every failure a 429** where a 401, 403 or 423 was expected —
  then **48 / 0** after a proper wait with nothing else changed;
- `phase13-reset-hardening-e2e.sh` restarts auth-service twice and then greps a fixed 400-line
  window of a log that is appended to across sessions. Observed **30 / 1**, then **31 / 0** on an
  immediate re-run. That is a defect in the assertion's window, recorded as item **10** in
  `deferred-items.md`.

A retry that silently converts red to green is how a flaky suite becomes a permanent lie, so a
suite that needed one is marked `PASS*` and listed under `RETRIED` in the summary.

---

## 7. The reference run

```
$ bash scripts/e2e/phase13-acceptance.sh

  repo    : /Users/muhammadumer/Documents/Projects/ResturantOS
  commit  : 42c898f
  gateway : http://localhost:8080
  started : 2026-08-07T02:00:54Z

  … 13-05 platform login                    PASS  21/0   18s
        cooling down 75s — this suite deliberately exhausts the gateway's auth budget
  … 13-06 auth/provisioning seam            PASS  20/0    3s
  … 13-02 roles: waiter + tenant admin      PASS  25/0    3s
  … 13-07 role catalog                      PASS  28/0    3s
  … 13-03 feature gating                    PASS  11/0    7s
  … 13-04 self-service password change      PASS  22/0    5s
  … 13-08 forced change at login            PASS  25/0    4s
  … 13-09 reset hardening                   PASS  31/0  131s
  … 13-10 provisioning saga                 PASS  27/0    5s
  … 13-11 user lifecycle                    PASS  48/0    4s
  … 13-12 tenant-admin user API             PASS  56/0   14s
  … 13-13 administrator reset               PASS  48/0   19s
  … 13-14 subscription and tier             PASS  51/0    7s

  scripts/seed_restaurantos.py — every seeded principal, each authenticated
  through the real gateway. Not by inspecting the database for expected rows.
  PASS  17 of 17 principals

  NONE. Every resource this run created or changed went through a real API at the
  gateway. There is nothing on this list, and that is stated explicitly rather than
  left to be inferred from an empty section.

================================================================================
  PHASE 13 ACCEPTANCE — RESULT
================================================================================
  SUITE                                    RESULT  PASS/FAIL BASELINE
  13-05 platform login                     PASS    21/0      21/0
  13-06 auth/provisioning seam             PASS    20/0      20/0
  13-02 roles: waiter + tenant admin       PASS    25/0      25/0
  13-07 role catalog                       PASS    28/0      28/0
  13-03 feature gating                     PASS    11/0      11/0
  13-04 self-service password change       PASS    22/0      22/0
  13-08 forced change at login             PASS    25/0      25/0
  13-09 reset hardening                    PASS    31/0      31/0
  13-10 provisioning saga                  PASS    27/0      27/0
  13-11 user lifecycle                     PASS    48/0      48/0
  13-12 tenant-admin user API              PASS    56/0      56/0
  13-13 administrator reset                PASS    48/0      48/0
  13-14 subscription and tier              PASS    51/0      51/0
  13-15 seed self-verification             PASS    17 of 17 principals

  live assertions:  413 passed, 0 failed
  suites:           14 run, 0 not green
  elapsed:          493s

  PHASE 13 ACCEPTED.
$ echo $?
0
```

**Every suite matches its baseline exactly, no suite needed a retry, and the direct-write ledger
is empty.** `phase13-roles-e2e.sh` is the one number that moved, from **23 / 1** — the phase's last
known failing assertion — to **25 / 0**. See SC5 for what changed and why the change is a
correction rather than a relaxation.

### The two rate-limit findings behind that clean run, both measured

Neither was a product defect, and both were reported as one before being diagnosed:

1. **`phase13-superadmin-e2e.sh` empties the gateway's auth budget on purpose.** Its section 7
   hammers `/api/v1/platform/auth/login` until it gets a 429 — that IS one of its assertions, and
   it is the right one to make. It tripped after **63 attempts** against a burst of 100. Run 15
   seconds before the next suite, that left every following script logging the SuperAdmin in
   against an empty bucket. Measured: **its own** later assertion ("could not log
   `cashier@demo.local` in") went red at 19 / 1, and `phase13-admin-reset-e2e.sh` reported
   **36 / 7 with every failure a 429** where a 401, 403 or 423 was expected. The runner now
   declares a 75-second cooldown for that suite and, before the first one, **asks the endpoint
   whether it is throttling and waits until it is not** rather than sleeping a fixed amount and
   hoping.
2. **`authorization-service` was not running**, and `phase13-feature-gating-e2e.sh` reported that
   as **403 `PERMISSION_DENIED` "Authorization service unavailable"** on three assertions — 8 / 3.
   That is a fail-closed OPA path behaving correctly. Started; 11 / 0.

Both are recorded here because "the suite went red and then green" is worthless without the reason,
and because the first one is a live measurement of a control (`GW-03`'s rate limit) that no other
document in this phase has a number for: **63 attempts, burst 100, `platform-auth-route`.**

---

## 8. What is NOT proved here

Stated plainly, because a verification document that only lists its successes is the document the
audit was complaining about.

1. **Point-of-sale activity in a prior accounting period.** §4. Reports over the last thirty days
   are non-empty; a report over a month with no seeding in it is empty, and no direct write was
   made to change that.
2. **The cross-tenant exposure in §5 is open.** The seed is immune to it; the platform is not.
3. **`platform_users` has no second factor.** The SuperAdmin logs in with a password alone. 13-CONTEXT
   lists this as a known gap and it is unchanged.
4. **Self-service password reset ships disabled** (13-09 / D-31). `notification-service` has zero
   source files, so no email can be sent. Administrator-initiated reset is the working recovery
   path, and the seed proves it works by using it.
5. **The e2e scripts were run against a stack a concurrent agent was also rebuilding.** Where a
   service was found down or wedged it was restarted and the run repeated; every number reported is
   from a command executed in the state being reported, and any run that was interrupted is named
   rather than quietly replaced.
6. **No load, concurrency or performance claim is made.** The seed is single-threaded and its
   volumes are development-scale.
