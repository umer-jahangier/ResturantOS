# Permission-code closure audit — referenced vs. seeded

**Date:** 2026-08-12 · **Branch:** `phase-13-access-repair` · **Scope:** report only, no `src/main` changes.
**Catalogue measured against:** live `auth_db.permissions` (73 rows) — and, separately, the Liquibase
changelog. They agree exactly, code for code. There is no migration/reality drift today.

---

## Headline

| Direction | Count | Severity |
|---|---|---|
| **Referenced but not seeded** (phantom codes) | **9** | 0 live production gates. 2 latent, 7 test-fixture. |
| **Seeded but never referenced** (dead permissions) | **1** | `pos.till.reconcile.override`, granted to 3 roles. |
| Backend gates naming a code that does not exist | **0** | |
| Frontend gates naming a code that does not exist | **2** | Both in an export nothing renders. |

**The list is small. The reason it is small is not the reason you would hope.**

`PermissionCatalogClosureTest` did not catch these nine. It also could not have — every one of them
sits on a surface its scanners do not read. On the two surfaces it *does* read (`@PreAuthorize` in
`services/**`, `has_permission()` in `policies/**`) there is genuinely zero drift: 66 Java codes and
34 Rego codes, all 73 present in the catalogue. The assertion was honest. Its **aperture** was the
defect. Section 4 is the part of this document that matters.

---

## 1. The two sets

**SEEDED — 73 codes.** Authoritative source is `services/auth-service/src/main/resources/db/changelog/`
(42 changesets). Verified two ways:

- Parsed from the changelog with both insert idioms (`<insert tableName="permissions">` and raw
  `INSERT INTO permissions … VALUES`, rollback bodies stripped): **73**.
- Queried from the running Postgres (`auth_db.permissions`): **73**.
- Set difference in both directions: **empty**. `DELETE FROM permissions` appears once, in
  `054-retire-orphan-pos-order-void.xml`, removing `pos.order.void`; the deletion is real in both.

`role_permissions` names exactly the same 73 codes — no orphan grants. Nothing outside auth-service
seeds permissions: the Flyway modules carry no `permissions` table, and `scripts/*.py` only *reads*
the catalogue (`create_finance_demo_user.py` inserts into `role_permissions`, referencing codes that
all exist).

**REFERENCED — 5 surfaces, all swept.**

| Surface | Codes | Phantoms |
|---|---:|---:|
| `@PreAuthorize` / `hasAnyAuthority` — `services/`, `gateway/`, `shared-lib/` (main only) | 66 | 0 |
| WebSocket handlers — `permissions.contains(…)` against the raw JWT claim | 3 | 0 |
| `policies/restaurantos/*.rego` — `common.has_permission(input, "…")` | 34 | 0 |
| Frontend — `PermissionGuard require=`, `useNavGroupVisibility`, nav config, dashboard presets | 34 | **2** |
| Gateway route/feature map | 0 permission codes (feature codes only; closed — see §5) | 0 |
| `policies/tests/*.rego` + Java `src/test` fixtures | — | **7** |

Every one of the 34 frontend dotted codes is seeded, and every frontend-gated code is *also* enforced
on the backend. There is no code the UI guards that the API leaves open.

---

## 2. Referenced but not seeded — the nine phantoms

### 2a. Latent production gates (2)

Both in `frontend/components/shared/sidebar-nav-items.ts`, in `platformNavItems`:

| Code | Line | Symptom if rendered |
|---|---|---|
| `platform:tenant:read` | 413 | "Tenants" nav item never draws for anyone, including SuperAdmin |
| `platform:admin` | 420 | "Platform Admin" nav item never draws for anyone, including SuperAdmin |

**Fix: replace the reference, do not seed.** These use a colon-delimited scheme that exists nowhere
else in the system — the catalogue is entirely `domain.resource.action`. The platform JWT does not
carry permission codes at all; `PlatformAdminController`, `PlatformUserAdminController` and
`PlatformAuthService` all gate on `@PreAuthorize("hasAuthority('SUPER_ADMIN')")`, a **role**. So the
right change is to gate these nav items the way the rest of the platform shell already does —
`platform-guard.tsx` uses `isEntitled` from `usePlatformSession()` — or on the `SUPER_ADMIN`
authority. Seeding `platform:admin` into the tenant catalogue would be wrong twice over: it is not a
tenant permission, and nothing would ever grant it.

**Currently latent, not live.** `platformNavItems` is imported by nothing —
`app/(platform)/layout.tsx` renders a bare header, and `platform-shell.tsx` only mentions the export
in a comment. So the phantom produces no visible symptom *today*. The day someone wires the SuperAdmin
sidebar, two of its items silently vanish and the cause will be four files away from the symptom.

This was already recorded as **N5/M5** in `.planning/research/authz-audit/RESEARCH.md` (2026-08-07)
and again in `.planning/phases/19c-superadmin-console/deferred-items.md`. It has survived two audits
because no automated control looks at nav `permission:` values.

### 2b. Test-fixture phantoms (7)

Not broken gates. **Broken tests** — negative controls built from permissions no role holds, which
therefore prove less than they claim.

| Code | Sites | Real code that was meant |
|---|---|---|
| `finance.report.view` | `policies/tests/kds_test.rego:102,110,120,128`; `policies/tests/inventory_test.rego:84,92`; `services/kitchen-service/src/test/java/io/restaurantos/kitchen/KdsAccessIsolationIT.java:155,165` | `finance.journal.view` / `reporting.report.view` |
| `finance.period.manage` | `policies/tests/kds_test.rego:102,110`; `KdsAccessIsolationIT.java:155,165` | `finance.period.open` / `finance.period.close` |
| `pos.order.read` | `policies/tests/common_test.rego:45`; `pos_test.rego:63`; `rbac_test.rego:47` | `pos.order.view` |
| `branch.view` | `policies/tests/rbac_test.rego:115` | `branch.manage` (no read-only counterpart exists) |
| `rbac.user.view` | `policies/tests/rbac_test.rego:115` | `rbac.user.manage` (no read-only counterpart exists) |
| `pos.till.manage` | `services/pos-service/src/test/java/io/restaurantos/pos/CashPaymentRequiresTillIT.java:83,134` | `pos.till.open` / `pos.till.close` |
| `pos.orders.create` | `services/pos-service/src/test/java/io/restaurantos/pos/MenuStationRoutingIT.java:282` | `pos.order.create` (plural typo) |

**Fix: correct the reference in every case.** None of these should be seeded — each has a real
catalogue counterpart, and seeding a synonym would make the vocabulary worse.

**Why this is worth fixing rather than shrugging at.** Take the strongest example.
`policies/tests/kds_test.rego:99` is headed *"ACCOUNTANT (finance perms — no kds perms)"* and asserts
the KDS board denies them. The fixture grants `finance.report.view` and `finance.period.manage` —
**a user holding nothing at all.** The real ACCOUNTANT role holds 27 codes, and one of them is
`pos.order.view`. If `kds.rego` were ever changed to accept `pos.order.view` for `pos.kds.view`, this
test would still pass, because the user it denies is not an accountant; it is an empty set wearing an
accountant's label. The same applies to `KdsAccessIsolationIT.accountant_denied_view/update`.

`policies/tests/rbac_test.rego:112` is the sharpest instance, because its own comment states the
intent: *"The negative that matters most: holding a plausible-looking administration-adjacent code …
is still a deny. This is what a prefix match would have broken."* Two of its three "plausible-looking"
codes do not exist. The test still catches the specific prefix-match mutation it was written for, but
it does not do the thing its comment says it does.

### 2c. Named in a plan, never written (0 live references)

`pos.report.view` — the phase-37 plan specified it as the gate for the transaction register and
daily-takings screens. It does not exist. **This one was caught, by a human, at implementation time**,
and both controllers carry the reasoning in their Javadoc:

- `services/pos-service/src/main/java/io/restaurantos/pos/web/TransactionRegisterController.java:23` —
  *"The plan named `pos.report.view`. **That permission does not exist.** Checked against the seeded
  catalogue before wiring it."* Gates on `pos.order.view.all` OR `finance.journal.view` instead.
- `services/pos-service/src/main/java/io/restaurantos/pos/web/DailyTakingsController.java:19` — same,
  gating on `pos.order.view.all` / `finance.journal.view` / `pos.till.review`.

No fix needed. It is listed because it is the control group: the only mechanism that stopped a
phantom reaching production was a developer manually diffing the plan against the catalogue.

---

## 3. Seeded but never referenced — dead permissions

**Exactly one**, across every production and test surface:

| Code | Granted to | Status |
|---|---|---|
| `pos.till.reconcile.override` | MANAGER, OWNER, TENANT_ADMIN | Zero references in any `src/main`, any `.rego`, any frontend file |

Seeded by `041-pos-permissions.xml:57`, granted at `:146`. Intended (per `07-02-PLAN.md:172`) to permit
force-closing a till with a cash variance; the force-close path was never built. Already recorded as
**L2 / W3-2** in `.planning/research/authz-audit/RESEARCH.md` and **W-18b-04** in
`.planning/phases/18b-abac-enforcement/18b-CONTEXT.md`.

Recommendation: leave it. It grants nothing, it is harmless, and the reconcile-override feature is
still on the roadmap. The reason to track it is that a catalogue containing codes nothing checks is
the soil the *other* direction grows in — the next person writing a till screen has a plausible,
seeded, granted code sitting there and no way to tell it is inert.

The catalogue is otherwise unusually tight: 72 of 73 codes are enforced somewhere in `src/main`.

---

## 4. Why the existing closure tests did not catch this

> This is the finding. The list above will regrow; whether it does is decided here.

### 4.1 `PermissionCatalogClosureTest` — four blind spots, one of them structural

Before this audit the test read exactly two things:

```java
enforcedBySource.put("@PreAuthorize",    javaAuthorities());   // sources("services", ".java")
enforcedBySource.put("policies/*.rego",  regoPermissions());   // has_permission(input, "…")
```

**(a) Scope.** `sources("services", ".java")` never looked at `gateway/` or `shared-lib/` — both of
which contain authorization code (`JwtGlobalFilter`, `JwtAuthenticationFilter`). The frontend was
never in scope at all, and the frontend is where a phantom is *most* invisible: both
`PermissionGuard` and `useNavGroupVisibility` reduce to `permissions.includes(code)`, so an unseeded
code renders as "this user is not allowed" — no request, no 403, no log line, nothing to grep for.
Both live phantoms are here.

**(b) Idiom.** The regex pair was `has(?:Any)?Authority\((…)\)` plus `'([a-z…]+)'` — **single quotes
only**. Two consequences:

- The Spring Security `authorizeHttpRequests` DSL takes `.hasAuthority("code")` with *double* quotes.
  `SPEL_AUTHORITY` matches that call perfectly and then extracts nothing, silently dropping the gate.
  No such gate exists today; nothing prevented one.
- The three WebSocket handlers do not use SpEL at all — a `@PreAuthorize` cannot run on a socket
  upgrade — so they check the raw claim: `permissions.contains(VIEW_PERMISSION)` in
  `PosOrderWebSocketHandler:162`, `DashboardWebSocketHandler:151`, `KdsWebSocketHandler:143`. Three
  real authorization gates, invisible to this file for its entire existence. They happen to name
  seeded codes. That is luck, not coverage.

**(c) Fixtures.** `sources("policies", ".rego")` filters `src/test`, which `policies/tests/` does not
contain — so **all 8 Rego test files were already being read.** The `has_permission(input, "…")`
pattern simply never matched a `base_user([…])` list. Five of the seven fixture phantoms were sitting
inside the scanned file set, in text the scanner walked past. This is the purest form of the failure:
not "we did not look there", but "we looked and the pattern was shaped wrong".

**(d) Vacuity — the structural one.** The test asserted a floor on the **catalog**:

```java
assertThat(catalog).as("… an empty set means the scan broke …").hasSizeGreaterThan(40);
```

and asserted **nothing** about the enforced side. `missing` is built by subtracting the catalog from
the enforced set, so an empty enforced set yields an empty `missing` and a green build. And the
enforced side had a live path to empty: `REPO_ROOT` was `Path.of("..", "..")`, resolved against the
**JVM working directory** — correct only because surefire happens to fork with `basedir` =
`services/auth-service`. Nothing enforced that. A module move, a runner that forks from the reactor
root, or a rename of `services/` would make `sources()` resolve to a missing directory, and
`sources()` returns `List.of()` for a missing directory **without complaint**. The test would then
have compared nothing against the catalogue and passed, permanently, silently.

That is this repository's recurring defect exactly — a control that exists, passes review, passes its
own tests, and enforces nothing — reproduced *inside the countermeasure written to prevent it*.

**(e) No negative control.** `FeatureCodeClosureTest` has `driftIsReportedWithBothTheCodeAndItsPrefix`,
which runs the comparison against synthetic input and asserts it reports the offender. Nothing in
`PermissionCatalogClosureTest` ever demonstrated that its central `isEmpty()` was reachable.

### 4.2 `FeatureCodeClosureTest` — not at fault, wrong vocabulary

It closes `FEATURE_*` codes between `RouteFeatureMap` and `TierFeatureDefaults`, and it does that
well: size floors on both sides, a call-site count so an unparsed mapping fails loudly, a test for a
prefix with no route yet, and a real negative control. Verified: 14 gated feature codes, 20 in the
tier matrix, **0 orphans**. It has nothing to do with permission codes and never claimed to.

Its own docstring, however, contains the general lesson this audit re-proves. On why the frontend's
`nav-feature-flags.test.ts` does not cover the same ground: *that guard builds its backend set as the
**union** of two files, so a code present in only one of them is in the union and passes.* A closure
test is only as good as the question it asks, and a slightly-wrong question passes forever.

### 4.3 The frontend guards — one of them will actively conceal a phantom

- `frontend/__tests__/lib/nav-feature-flags.test.ts` closes **feature** codes against the backend
  files. No permission-code equivalent exists.
- `frontend/__tests__/shared/nav-permission-matrix.test.tsx` freezes, for six role fixtures, the exact
  ordered set of nav items each sees. It is a good test, deliberately written out literally rather
  than snapshotted. But its permission sets are **hand-maintained string lists**. A nav item gated on
  a phantom is invisible to every fixture, so the expected-output list simply omits that item — and
  the test goes green having **recorded the broken behaviour as correct**. It is the mechanism by
  which `platform:tenant:read` and `platform:admin` would survive a UI rewrite.

### 4.4 What the other controls do cover

Worth stating so the gap is not overdrawn. This repo has real, working authorization controls:
`ControllerAuthorizationClosureTest` (every routable POS endpoint carries a gate),
`PolicyReachabilityTest` (every Rego rule has a caller — it took the bundle from 6/22 reachable to
21/22), `PurchasingPermissionReachabilityIT`, `FinanceEndpointAuthorizationIT`. The gap is specific:
**nothing checked the vocabulary on the frontend, in fixtures, or in the non-SpEL idioms.**

---

## 5. What was changed

Only `services/auth-service/src/test/java/io/restaurantos/auth/PermissionCatalogClosureTest.java`
(a test file). No `src/main` changes.

| Change | Closes |
|---|---|
| `REPO_ROOT` now walks up to the directory containing `services/` + `policies/`, and **throws** if not found | 4.1(d) — removes the silent-empty path |
| Per-source **floors** (≥60 Java, ≥30 Rego), asserted *before* the comparison | 4.1(d) — an empty scan now fails instead of passing |
| `driftIsReportedWithBothTheCodeAndItsSource` — negative control on synthetic input | 4.1(e) |
| Java scan extended to `gateway/` and `shared-lib/` | 4.1(a) |
| `QUOTED` accepts double quotes; new `CLAIM_CONTAINS` and `PERMISSION_CONSTANT` patterns for the WebSocket idiom | 4.1(b) |
| New `everyPermissionInAPolicyFixtureExistsInTheCatalog` — reads `base_user([…])` / `"permissions": […]` lists | 4.1(c) |
| New `everyFrontendNavPermissionExistsInTheCatalog` — reads `permission: "…"` from the nav config **as literal strings**, not through a dotted-code regex, because both live phantoms are colon-delimited and a house-convention regex would skip them | 4.1(a), 4.3 |
| `KNOWN_UNSEEDED` — the 7 phantoms the two new tests would fail on, listed with file, line and the correct code | Makes the debt a ratchet: the **eighth** phantom fails the build |

**5 tests, green**, and **verified capable of failing**: removing `finance.report.view` and
`platform:admin` from `KNOWN_UNSEEDED` produces

```
Expecting empty but was: {"inventory_test.rego"=["finance.report.view"], "kds_test.rego"=["finance.report.view"]}
Expecting empty but was: {"frontend/components/shared/sidebar-nav-items.ts"=["platform:admin"]}
```

`KNOWN_UNSEEDED` is debt, not an exemption. It exists so the build stays green for the nine agents
working concurrently while the list is still visible and shrinking. Every entry should be deleted as
its reference is corrected.

---

## 6. Recommended follow-ups (not done here)

Ordered by value, not effort.

1. **Correct the 7 fixture references** (§2b) and delete the matching `KNOWN_UNSEEDED` entries. Build
   each negative control from a permission the named role *actually holds* — `kds_test.rego`'s
   "ACCOUNTANT" should carry `finance.journal.view` and `pos.order.view`, because that is the set the
   rule must be proven to reject.
2. **Re-gate `platformNavItems`** (§2a) on `SUPER_ADMIN` or on `usePlatformSession().isEntitled`, to
   match what `PlatformAdminController` enforces. Do this before the SuperAdmin sidebar is wired, not
   after.
3. **Port the frontend check into the frontend.** The Java test now reads three `.tsx`/`.ts` files off
   disk, which works but fails in the wrong repo half. A vitest guard next to
   `nav-feature-flags.test.ts`, reading the changelog the same way that file already reads
   `TierFeatureDefaults.java`, would fail on the branch that introduces the drift.
4. **Add the vacuity floor + negative-control pattern to the other closure tests.**
   `PolicyReachabilityTest` and `ControllerAuthorizationClosureTest` were not audited for it here.
   The question to ask of each is not "does it pass" but "what input makes it pass while enforcing
   nothing".
5. **Decide `pos.till.reconcile.override`** (§3): build the force-close path or retire the code, as
   `054-retire-orphan-pos-order-void.xml` retired `pos.order.void`.
6. **Consider asserting the catalogue against the live DB** in an IT. Changelog and database agree
   today — verified, 73 = 73 — but nothing checks it, and this repo has diverged there before.
