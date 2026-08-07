---
phase: 13-platform-tenant-access-repair
plan: 15
subsystem: authoritative-seed-and-phase-acceptance
status: complete
tags: [seed, acceptance, sc6, d-25, d-28, d-30, d-29a, rls, cross-tenant, rate-limit, idempotency]
requires:
  - running dev stack + gateway, auth, user, platform-admin, authorization, pos, inventory, purchasing, finance, reporting
  - "13-05: POST /api/v1/platform/auth/login and the project SuperAdmin migration"
  - "13-08: POST /api/v1/auth/change-password/forced and the 403 PASSWORD_CHANGE_REQUIRED gate"
  - "13-10: POST /api/v1/platform/tenants returning tempPassword"
  - "13-12: the public /api/v1/users surface"
  - "13-13: POST /api/v1/users/{id}/reset-password — the only working way to set a password"
  - "13-14: the tier-change and feature-toggle endpoints"
  - "13-16: the till binding at CASH settlement, which is what makes a waiter persona possible"
provides:
  - scripts/seed_restaurantos.py
  - scripts/seed_restaurantos.ps1
  - scripts/README-seed.md
  - scripts/e2e/phase13-acceptance.sh
  - .planning/phases/13-platform-tenant-access-repair/13-E2E-EVIDENCE.md
  - "phase13-roles-e2e.sh 23/1 -> 25/0 — the phase's last known failing assertion, closed"
affects:
  - "every later phase: a realistic multi-tenant environment in one idempotent command"
  - "Phase 14/19-21 frontend work: real logins for every role, documented in scripts/CREDENTIALS.md"
  - "deferred-items 9: a cross-tenant read in pos-service and purchasing-service, found by this plan"
tech-stack:
  added: []
  patterns:
    - verify a principal by logging it in, never by reading the row the login would have read
    - a verification that cannot fail is not a verification — ship the switch that breaks it
    - scope a deterministic identifier to the TENANT ID, or a deleted tenant answers for the new one
    - print the direct-write ledger even when it is empty, so an empty one is a statement
    - a rate limit exhausted by a previous suite reports as a product defect unless the harness asks
    - retry once and REPORT the retry; a silent retry is how a flaky suite becomes a permanent lie
    - carry each suite's baseline, or a suite that stops asserting things still reports zero failures
key-files:
  created:
    - scripts/seed_restaurantos.py
    - scripts/seed_restaurantos.ps1
    - scripts/README-seed.md
    - scripts/e2e/phase13-acceptance.sh
    - .planning/phases/13-platform-tenant-access-repair/13-E2E-EVIDENCE.md
  modified:
    - scripts/e2e/phase13-roles-e2e.sh
    - scripts/CREDENTIALS.md
    - .planning/phases/13-platform-tenant-access-repair/deferred-items.md
    - .gitignore
decisions: [D-25, D-27, D-28, D-30, D-29a]
requirements: [PLATFORM-01, PLATFORM-02, PLATFORM-04, PLATFORM-10, AUTH-01, USER-01, USER-02]
metrics:
  duration: ~4h
  completed: 2026-08-07
  tasks: 3
  commits: 4
---

# Phase 13 Plan 15: The Authoritative Seed, and the Phase's Acceptance Test — Summary

**`bash scripts/e2e/phase13-acceptance.sh` → PHASE 13 ACCEPTED. 14 suites, 413 live assertions,
0 failures, 0 retries, exit 0, 493 seconds.** Every number is an HTTP status or a JWT claim from a
request that crossed the real gateway. Nothing in this plan greps source.

And the assertion the phase had been carrying as a known exception since 13-02 —
`phase13-roles-e2e.sh` at **23 PASS / 1 FAIL** — is closed. It is **25 / 0**. The phase has no
remaining known failure.

---

## 1. ⚠️ Read this first: the seed's configuration was changed under me, mid-plan

**My brief and 13-CONTEXT's LOCKED decision both say three tenants with six personas each** —
eighteen personas, nineteen principals. That is what I built and verified: commit `bba1f78`,
**19 of 19 principals authenticated live**, three tenants (`saffron-grill` STARTER,
`zaitoon-kitchen` GROWTH, `marina-bay-dining` ENTERPRISE) with pairwise-different module sets.

Commit **`591cddd`**, by a concurrent agent working in the same tree, replaced that with **one
working tenant (`floating-terrace`, ENTERPRISE) plus one small isolation control, and eight
personas each**. Its message states that *the user named Floating Terrace as the real restaurant
and asked for the other tenants to be dropped*. That instruction was not visible to me.

**I did not undo it.** A later user instruction outranks my brief, I cannot verify it either way,
and reverting another agent's committed work on a claim I cannot check is worse than surfacing the
conflict. So:

- **what is verified in this summary and in `13-E2E-EVIDENCE.md` is what is on disk**: two
  tenants, eight personas each, **17 of 17 principals**;
- the three-tenant numbers are recorded too, because they were genuinely measured;
- **restoring three tenants is one list literal.** `TENANTS` in `scripts/seed_restaurantos.py`.
  Nothing else in the script changes — the phase structure, the reconciliation, the forced-change
  walk, the TOTP handling, the ledger and the verification loop are all configuration-independent.

**The newer shape is genuinely stronger in one respect and it deserves saying.** `TENANT_ADMIN`
and `INVENTORY_MANAGER` had **no seeded account at all** under my configuration — so the role that
the entire 13-11 / 13-12 privilege-ceiling work exists to constrain was the least exercised one in
the platform. Both now have a persona and both are verified live (`TENANT_ADMIN` at 64
permissions, `INVENTORY_MANAGER` at 5).

**Please arbitrate.** If three tenants with six personas is still what you want, say so and it is a
two-minute change.

---

## 2. What the seed does, and what it refuses to do

Four phases, each with a printed banner so a partial run is diagnosable:

| Phase | Does | As |
|---|---|---|
| `platform` | **verifies the SuperAdmin by logging in**, provisions tenants, sets tiers, applies deliberate feature overrides, **asserts the module sets differ** | `SUPER_ADMIN` |
| `personas` | reads the role catalog, creates every account through `POST /api/v1/users`, walks each through the real forced-change flow, enrols a factor for every account the platform challenges | the tenant `OWNER` |
| `business` | menu, units of measure, ingredients, a recipe, vendor → PO → GRN → invoice, and POS orders | **the role that owns each surface** |
| `verify` | authenticates **every** principal through the gateway; exits non-zero naming each failure | each persona, as itself |

**The SuperAdmin is never created.** It is owned by a migration; the script logs in and fails
naming that migration if refused. A seeder that silently re-creates what a migration owns is how
two sources of truth appear.

**The role catalog is read, not hardcoded.** A disagreement between `GET /api/v1/roles` and the
seed's expectations aborts the run naming the difference — because a `roleCode` that persists but
resolves to nothing yields a permissionless login, which is exactly the silent failure B3 is about.

**Business data is driven by the role whose permissions cover it.** The `MANAGER` builds the menu
(`pos.menu.manage`), the ingredients (`inventory.item.manage`) and the purchasing chain
(`vendor.*`). The `WAITER` takes every order holding **no till** — it cannot open one, and that is
the point of D-30 — and the `CASHIER` opens a till and settles them, CASH and CARD. A seeder that
does everything as the owner proves nothing about the other seven roles.

---

## 3. The verification loop, and the switch that breaks it

Each principal is three assertions, not one: the login succeeds, the token carries the **expected
role** and a **non-empty** permission list, and one endpoint gated on a permission **only that role
holds** answers **200** — not merely "not 403".

```
PASS  superadmin@softxlogic.com   roles=['SUPER_ADMIN']            GET /api/v1/platform/tenants -> 200
PASS  owner@terrace.local         OWNER              65 perms      /api/v1/users -> 200
PASS  admin@terrace.local         TENANT_ADMIN       64 perms      /api/v1/users -> 200
PASS  manager@terrace.local       MANAGER            49 perms      /api/v1/pos/menu/categories/admin -> 200
PASS  cashier@terrace.local       CASHIER            14 perms      /api/v1/pos/tills -> 200
PASS  waiter@terrace.local        WAITER              7 perms      /api/v1/pos/tables -> 200
PASS  kitchen@terrace.local       KITCHEN_STAFF       2 perms      /api/v1/pos/stations -> 200
PASS  accountant@terrace.local    ACCOUNTANT         24 perms      /api/v1/finance/accounts -> 200
PASS  storekeeper@terrace.local   INVENTORY_MANAGER   5 perms      /api/v1/inventory/ingredients -> 200
… eight more for the control tenant …
17 of 17 principals authenticated and reached a role-appropriate endpoint.
```

**"Not 403" was not good enough, and that is a correction I had to make to my own work.** The first
version passed `WAITER` and `KITCHEN_STAFF` on a **400** — `GET /api/v1/pos/tables` and
`/api/v1/pos/stations` both require a `branchId` query parameter, and a 400 satisfies "not a
refusal" while proving nothing at all about the caller's authority. Both now carry the branch and
answer 200, and any status ≥ 400 other than 403 is now itself a failure.

### It is proved able to fail (T-13-15-D)

```
$ python3 scripts/seed_restaurantos.py --corrupt-persona cashier@saffron.local
$ python3 scripts/seed_restaurantos.py --phase verify
  FAIL  cashier@saffron.local          401 UNAUTHENTICATED
  18 of 19 principals authenticated and reached a role-appropriate endpoint.
  THE SEED IS NOT COMPLETE. A partial seed is a failed seed.
    ✗ cashier@saffron.local: 401 UNAUTHENTICATED
$ echo $?   → 1
```

Exit 1, naming exactly that address and no other. Repaired afterwards **through the real
administrator-reset endpoint** (13-13), not by a database write:

```
$ python3 scripts/seed_restaurantos.py --phase personas
  ! cashier@saffron.local: 401 UNAUTHENTICATED — repairing through the administrator reset endpoint
  ✓ cashier@saffron.local: CASHIER, 14 permissions — ok
```

`--corrupt-persona` had to be fixed to work at all, and the reason is itself evidence: it first
reported "no user with address …" because `auth_db.users` is **FORCE** row-level security and
`auth_user` is `NOSUPERUSER NOBYPASSRLS`, so a statement without the right tenant GUC sees nothing —
even from psql. That is the correct posture, and §6 is about the two services where it is absent.

---

## 4. The direct-write ledger is EMPTY, and it says so out loud

Printed on every run. On the normal path:

```
  NONE. Every resource this run created or changed went through a real API at the
  gateway. There is nothing on this list, and that is stated explicitly rather than
  left to be inferred from an empty section.
```

Three writes exist in the script; **none is reachable on a normal run**:

| Write | Table | Why no API covers it | Replacement |
|---|---|---|---|
| clear an enrolled TOTP factor | `auth_db.users.totp_secret` | **recovery only.** No endpoint at any tier resets another user's second factor — 13-13's reset deliberately leaves TOTP intact, and is right to: a password reset replaces one factor, not both | an admin "revoke second factor" beside `POST /api/v1/users/{id}/reset-password`, gated and audited the same way |
| delete password history | `auth_db.password_history` | **recovery only.** `HISTORY_DEPTH` is 5, so an account that has already held its documented password cannot be returned to it | none, and none should exist — the reuse rule is a control on *human* password choice |
| break a password hash | `auth_db.users.password_hash` | **`--corrupt-persona` only** | none; deliberate fault injection |

**No business date is faked, and that took a decision.** Vendor invoices are dated across several
days through `invoiceDate`, a real request field — so period-scoped purchase reporting has more
than one day in it with no back-dating anywhere. Point-of-sale orders land on the current business
date and are **not** back-dated: `BusinessDay.of(closedAt)` derives it from the wall-clock close,
no endpoint accepts an override, and `business_date` is part of the ClickHouse fact tables'
`ORDER BY` and partition key so it cannot be mutated afterwards either. Faking it would have meant
hand-writing analytics rows, which is worse than the limitation. Stated in `13-E2E-EVIDENCE.md` §8
rather than glossed.

---

## 5. Idempotency, and the identifier bug that taught me why it matters

Three consecutive full runs from a clean slate:

| | run 1 (clean) | run 2 | run 3 |
|---|---|---|---|
| tenants | 3 provisioned | 3 reconciled, 0 duplicated | 3 reconciled |
| personas | 18 created and activated | 18 found, 0 created | 18 found, 0 created |
| settled orders | 3 / 5 / 7 | 3 / 5 / 7 | 3 / 5 / 7 |
| vendor invoices | 1 / 2 / 3 | 1 / 2 / 3 | 1 / 2 / 3 |
| principals | 19 / 19 | 19 / 19 | 19 / 19 |
| warnings | 0 | 0 | **0** |
| exit | 0 | 0 | 0 |

On the two-tenant configuration now on disk, re-running against an already-seeded stack:
**17 / 17, exit 0, no direct writes, 12 seconds.**

**Every deterministic identifier is scoped to the tenant ID, not the tenant key — and that is a
bug fix, not a style choice.** `OrderServiceImpl.createOrder` is idempotent on `clientOrderId`, and
`findByClientOrderId` carries **no tenant predicate**. A client order id derived from a stable key
is therefore answered by whichever tenant used it first, *including one that has since been
deleted*. Measured: a freshly provisioned Saffron Grill was handed back a previous Saffron Grill's
order, and every read of it 404'd against the new branch. That is §6.

---

## 6. 🔴 The finding: pos-service and purchasing-service leak every tenant's rows

**Found by this plan's own artifact, live, the way the audit says findings have to be found.** The
seed built a menu, reconciled against `GET /api/v1/pos/menu/items/admin`, and adopted **a different
tenant's menu item id**. It then adopted another tenant's vendor from
`GET /api/v1/purchasing/vendors` and got `404 Vendor not found` on the next call — because the
write path IS tenant-scoped while the read path is not.

Measured on the live databases:

| table | `relrowsecurity` | `relforcerowsecurity` | owner | runtime role |
|---|---|---|---|---|
| `pos_db.menu_items` / `menu_categories` / `orders` | `t` | **`f`** | `pos_user` | `pos_user` |
| `purchasing_db.vendors` / `purchase_orders` / `vendor_invoices` | `t` | **`f`** | `purchasing_user` | `purchasing_user` |

PostgreSQL exempts a table's **owner** from its own policies unless `FORCE ROW LEVEL SECURITY` is
set, and both services connect as the owning role. The queries carry no tenant predicate either:
`MenuItemRepository.findAllOrderByName` is `SELECT i FROM MenuItem i ORDER BY i.name`.

```
saffron manager token: tenant_id = 4f2783b6-437f-4944-99da-29abe77f8db8
GET /api/v1/pos/menu/items/admin  ->  13 items, 2 of which are this tenant's,
                                      including "Beef Nihari" owned by the `test` tenant
POST /api/v1/pos/orders/{id}/items {menuItemId: <that item>}  ->  200, priced 110000 paisa
```

Contrast the tables this phase repaired: `auth_db.users`, `auth_db.user_branch_roles`,
`user_db.branches` and `finance_db.chart_of_accounts` are all `t | t`. This is the same class of
defect 13-02, 13-06 and 13-08 each found in their own service — in the two services nobody looked
at.

**Not fixed here, and the reason is stated rather than implied.** It is two migrations plus a
re-audit of every query path in two services this plan's file list does not touch, and
`ALTER TABLE … FORCE ROW LEVEL SECURITY` on a service whose queries have never carried a tenant
predicate is an availability decision (Rule 4), not a bug fix. Recorded as **item 9 in
`deferred-items.md`** with the exact remedy and in `13-E2E-EVIDENCE.md` §5 with the live evidence.
The seed is made **immune** — every reconciliation key is a marker containing the tenant id — and
both call sites say why in full.

---

## 7. `phase13-roles-e2e.sh`: 23 / 1 → 25 / 0

The phase's one remaining known failure. Its failing assertion was **"tenant admin logs in with no
TOTP challenge"** — the *pre-D-29a* claim. 13-02 left it failing deliberately rather than softening
it, which was right at the time.

**D-29a then resolved it in favour of the behaviour, not the assertion:** step-up on
`finance.period.close` and `hr.payroll.approve` is correct and stays, because revoking those two
codes would leave tenant admins unable to run payroll or close a period at all. So the assertion
was measuring something that had been decided against.

Inverted to the **shape** of the challenge, which is what is actually load-bearing:

- the tenant admin **IS** challenged — and that now fails if someone drops a money gate;
- and **NOT** because of `rbac.manage`, which its token is still asserted not to carry — so the
  D-23 regression the original test existed to catch is still caught, by the assertion right below.

And the script now **enrols its own factor over the public bootstrap endpoints**, the way 13-06's
and 13-13's do, instead of requiring `python3 scripts/generate_totp.py … --enroll` to have been run
by hand. A verification whose green depends on a human remembering something is not a verification.
Its `seed_persona` fixture also resets `totp_secret`/`totp_enabled`, because a previous run's factor
answers the enrolment with `TOTP_ALREADY_ENROLLED` and reports a fixture artefact as a product
failure.

---

## 8. The acceptance runner, and the two things that made it lie before it told the truth

`scripts/e2e/phase13-acceptance.sh` runs all thirteen phase-13 scripts and then the seed in full,
and reports one aggregate result. Three properties are deliberate:

**It carries each suite's baseline.** "48 PASS / 0 FAIL" means nothing alone — a script that
silently stopped asserting half of what it used to also reports zero failures. A count that
**drops** while still passing is a regression in the verification itself, and this is the only
place it is visible.

**It retries a red suite once and REPORTS the retry** (`PASS*`, plus a `RETRIED` section). A retry
that silently converts red to green is how a flaky suite becomes a permanent lie.

**It asks the gateway whether it is throttling before it starts.** Both of the following were
reported as product defects before being diagnosed, and both were the harness:

1. **`phase13-superadmin-e2e.sh` empties the auth budget on purpose.** Section 7 hammers
   `/api/v1/platform/auth/login` until it 429s — that IS one of its assertions and it is the right
   one to make. It tripped after **63 attempts** against a burst of 100. Run 15 seconds before the
   next suite, that left everything after it logging in against an empty bucket: **its own** later
   assertion went red at 19 / 1, and `phase13-admin-reset-e2e.sh` reported **36 / 7 with every
   failure a 429** where a 401, 403 or 423 was expected. Now: a declared 75-second cooldown for
   that suite, and a preflight that probes the endpoint and waits until it is not throttled rather
   than sleeping a fixed amount and hoping.
2. **`authorization-service` was not running**, and `phase13-feature-gating-e2e.sh` reported it as
   `403 PERMISSION_DENIED "Authorization service unavailable"` — a fail-closed OPA path behaving
   correctly. 8 / 3 → **11 / 0** once started.

**63 attempts, burst 100, `platform-auth-route`** is, incidentally, the only measured number this
phase has for `GW-03`'s rate limit. 13-04, 13-08, 13-09 and 13-13 all recorded it as inherited and
unmeasured.

---

## 9. Verification actually run

Every number is from a command executed in the state being reported.

| Suite | Result | Baseline |
|---|---|---|
| **`bash scripts/e2e/phase13-acceptance.sh`** | **413 PASS / 0 FAIL, 14 suites, 0 retries, exit 0, 493s** | — |
| ├ `phase13-superadmin-e2e.sh` (13-05) | **21 / 0** | 21 / 0 |
| ├ `phase13-auth-provisioning-seam-e2e.sh` (13-06) | **20 / 0** | 20 / 0 |
| ├ `phase13-roles-e2e.sh` (13-02) | **25 / 0** | was **23 / 1** |
| ├ `phase13-role-catalog-e2e.sh` (13-07) | **28 / 0** | 28 / 0 |
| ├ `phase13-feature-gating-e2e.sh` (13-03) | **11 / 0** | 11 / 0 |
| ├ `phase13-password-change-e2e.sh` (13-04) | **22 / 0** | 22 / 0 |
| ├ `phase13-forced-change-e2e.sh` (13-08) | **25 / 0** | 25 / 0 |
| ├ `phase13-reset-hardening-e2e.sh` (13-09) | **31 / 0** | 31 / 0 |
| ├ `phase13-provisioning-e2e.sh` (13-10) | **27 / 0** | 27 / 0 |
| ├ `phase13-user-lifecycle-e2e.sh` (13-11) | **48 / 0** | 48 / 0 |
| ├ `phase13-tenant-admin-users-e2e.sh` (13-12) | **56 / 0** | 56 / 0 |
| ├ `phase13-admin-reset-e2e.sh` (13-13) | **48 / 0** | 48 / 0 |
| ├ `phase13-subscription-e2e.sh` (13-14) | **51 / 0** | 51 / 0 |
| └ `seed_restaurantos.py` (13-15) | **17 / 17 principals**, exit 0 | all, none may fail |
| Seed, three-tenant configuration, ×3 consecutive from clean | **19 / 19** each, exit 0, 0 warnings | — |
| Seed, two-tenant configuration, re-run on a seeded stack | **17 / 17**, exit 0, 12s | — |
| `--corrupt-persona` then `--phase verify` | **18 / 19, exit 1**, naming exactly the corrupted address | — |
| Direct-write ledger, every green run | **empty** | — |

### The harness was proved able to fail, five separate times

Not claimed — these are runs that produced FAIL lines and a non-zero exit in this session:
the corrupted-persona verify (18/19, exit 1); `phase13-superadmin-e2e.sh` at 19/1 against a
throttled gateway; `phase13-admin-reset-e2e.sh` at 36/7 for the same reason;
`phase13-feature-gating-e2e.sh` at 8/3 with authorization-service down; and
`phase13-reset-hardening-e2e.sh` at 30/1 on its bounded log window.

### Environment work, no source touched

`inventory-service` was found in the **wedged** state this phase has documented four times —
`/actuator/health` answering in 21 ms while every other path hung indefinitely and the gateway
returned 503. Restarted; it answered immediately afterwards. `purchasing-service`,
`reporting-service`, `hr-service`, `authorization-service` and `auth-service` were started or
restarted because they were not running. `deploy/clickhouse/apply.sh` was run: reporting-service
refuses to start without its four fact tables, and they had never been applied on this machine.

---

## 10. Deviations from plan

**1. [Superseded by a concurrent agent — surfaced, not resolved] The tenant and persona set.** §1.
Three tenants / six personas was built and verified at 19/19 (`bba1f78`); commit `591cddd` replaced
it. Not undone. Awaiting your arbitration.

**2. [Plan text superseded by D-29a] The plan asks the seed to "assert the tenant admin is NOT
challenged" for step-up.** D-29a — recorded in 13-CONTEXT under "Decisions taken DURING execution"
— overturned exactly that, and says instead that 13-15 "must enrol TOTP for every tenant-admin
persona it creates, or its own login verification will fail on exactly the persona that matters
most". The seed enrols rather than asserts, and it does so **by observation** — any persona the
platform answers `TOTP_ENROLLMENT_REQUIRED` gets a factor — rather than from a hardcoded role list.
That is what caught `ACCOUNTANT`: it holds `finance.period.close` and is challenged even though it
is not an administrator, which a role-based list would have missed.

**3. [Rule 1 — bug, out of the plan's file list] `phase13-roles-e2e.sh`.** §7. The plan's brief
offered "either wire that into the script or record it explicitly as the known exception". Wired.

**4. [Rule 1 — bug, in my own work, found by running it] Four defects in the seed, each reported
here because each produced a confident wrong answer first:**
- the single-order read omitted the **required** `branchId` query parameter, so every read 400'd
  and the run reported "order has a zero total" — blaming settlement for a defect in the fetch;
- deterministic ids were keyed on the tenant *key*, so a re-provisioned tenant was handed a deleted
  tenant's order through the un-scoped `findByClientOrderId`;
- `409 TOTP_ALREADY_ENROLLED` for **one** address was `die()` — a fatal that reported nothing about
  the other sixteen principals. It is now the recovery path, because login's
  `401 TOTP_ENROLLMENT_REQUIRED` and bootstrap's 409 read *different columns*, and an account with
  `totp_enabled` set and no secret is stuck between them with no endpoint able to free it;
- `--corrupt-persona` set a zero tenant GUC against a FORCE-RLS table and silently matched nothing.

**5. [Rule 2 — verifiability] "Not 403" was replaced by "200".** §3. Two of the eight role checks
were passing on a 400.

**6. [Rule 3 — environment, no source touched] Six services started or restarted, and the
ClickHouse schema applied.** §9.

**7. [Scope — file list] `scripts/CREDENTIALS.md` and `.gitignore` beyond the plan's list.**
`CREDENTIALS.md` is the concurrent agent's credential sheet; I corrected one factual claim in it
(it said `TENANT_ADMIN` holds `rbac.manage` — 13-02 split that off deliberately, and
`phase13-roles-e2e.sh` asserts its absence; the step-up comes from the two money codes). Rather
than duplicate it, **`scripts/README-seed.md` was rewritten as the operational guide and defers to
it for every credential** — two documents listing the same passwords is precisely how a pair drifts
and one starts lying. `.gitignore` gains `.seed-state/`, which holds live server-minted TOTP
secrets.

**8. [Process — a concurrent agent in the same tree]** Services were stopped and rebuilt under me
repeatedly (auth-service down mid-run, platform-admin-service killed by a jar overwrite,
authorization-service absent), and eight commits from other work landed during this plan. Every
commit here stages and commits in **one** invocation with explicit pathspecs, so nothing of theirs
was swept in — the failure mode 13-12 recorded. Two acceptance runs were abandoned mid-flight
because of this and are named rather than quietly replaced.

---

## 11. Left open, and not claimed to work

1. **The cross-tenant read in pos-service and purchasing-service is open.** §6, deferred item 9.
   The seed is immune; the platform is not.
2. **Point-of-sale activity in a prior accounting period.** §4. Reports over the last thirty days
   are non-empty; a report over an unseeded month is empty, and nothing was faked to change that.
3. **`phase13-reset-hardening-e2e.sh` greps a fixed 400-line window of a growing log.** Observed
   30/1 then 31/0 with nothing changed. Deferred item 10; the precise fix is to record `wc -l`
   before the restart and grep only what follows.
4. **Nothing purges `pos_db` / `purchasing_db` when a tenant is deleted.** Deferred item 11;
   13-CONTEXT already defers tenant purge, and this is its observed consequence.
5. **`platform_users` has no second factor.** The SuperAdmin logs in with a password alone.
   Unchanged known gap.
6. **No load, concurrency or performance claim.** The seed is single-threaded at development scale.

---

## Known stubs

**None.** Every function in the seed is reachable and exercised on a normal run, except the three
recovery paths in §4 — and each of those was exercised deliberately during this plan
(`--corrupt-persona` → repair; a lost `.seed-state` → factor cleared and re-enrolled).

## Threat flags

- **T-13-15-A** (development credentials in the repository) — confined to `scripts/CREDENTIALS.md`,
  with `README-seed.md` deferring to it rather than duplicating. Both open with a rotate-before-
  deployment banner. No credential is embedded in a migration.
- **T-13-15-B** (direct writes bypassing validation) — the ledger prints on **every** run and is
  **empty** on every green one. Three writes exist, each recovery-only, each naming the owning
  service and the endpoint that would replace it.
- **T-13-15-C** (seeding a production-like target) — the script refuses unless the gateway host is
  local or in `SEED_ALLOWED_HOSTS`, and `--i-know-what-i-am-doing` is required otherwise. The
  refusal names the host and says why.
- **T-13-15-D** (a verification that cannot fail) — **demonstrated**, §3: exit 1, naming exactly
  the corrupted address.
- **T-13-15-E** (credentials in output) — the script prints principal identifiers and outcomes and
  **never** a password or a token. Verified by reading every `print` in the file.
- **T-13-15-F** (seeding volume) — accepted as planned; development-scale, host-restricted.
- **T-13-15-SC** — **no package of any kind was installed, in any ecosystem.** TOTP, JSON, HTTP and
  base32 are all standard library, which is why the script has no `requirements.txt` and why
  `phase13-roles-e2e.sh`'s new TOTP helper is six lines of `hmac` rather than `pyotp`.

## GitNexus, per CLAUDE.md

The index is stale (last built at `5fba4a9`) and was **not** refreshed, for the reason 13-01
through 13-14 all gave: `gitnexus analyze` rewrites `CLAUDE.md`, `AGENTS.md` and six skill files,
which 13-01 had to revert. The MCP tools were not available in this session and I am not reporting
a result I did not obtain; the pre-tool hook surfaced related symbols on several calls and is noted
where it mattered.

**No production Java source was modified by this plan** — the blast radius is scripts and
documents, and the one behavioural change (`phase13-roles-e2e.sh`) is a test harness whose only
consumer is `phase13-acceptance.sh`, run at 25/0. `detect_changes` was not used and I am **not**
reporting a clean result from it; 13-07, 13-11, 13-12 and 13-13 all recorded that it answers "No
changes detected" against a dirty tree, so its silence carries no information — and this tree is
dirty with a concurrent agent's work throughout. Scope was reviewed with `git status --short`
before each commit, and every commit names its files explicitly with a `--` pathspec so nothing of
the other agent's could be swept in.

## Self-Check: PASSED

All five created files exist on disk: `scripts/seed_restaurantos.py`,
`scripts/seed_restaurantos.ps1`, `scripts/README-seed.md`, `scripts/e2e/phase13-acceptance.sh`,
`.planning/phases/13-platform-tenant-access-repair/13-E2E-EVIDENCE.md`.

All four commits exist in `git log`: `bba1f78` (the seed), `13f62c9` (launcher, credential guide,
acceptance runner, the roles-e2e correction), `be7b588` (the TOTP recovery path, the evidence
record, deferred items 9–11), `42c898f` (the rate-limit handling in the runner).
