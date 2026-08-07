# Phase 13 — deferred items

Out-of-scope discoveries logged rather than fixed, per the executor scope boundary (only issues
directly caused by the current task's changes are auto-fixed).

## From plan 13-06

### 1. `UserAdminDelegationIT` fails intermittently on macOS (user-service)

**Status:** pre-existing, environmental, NOT caused by 13-06.

`UserAdminDelegationIT.assignBranchRole_delegatesToAuthService_withInternalSecretHeader` and
`.wireMock_assignEndpoint_registersCallWithSecret` error with
`NoHttpResponse: The target server failed to respond`. The failure is on the `stubFor(...)` calls —
i.e. the test cannot reach WireMock's own admin API — not on anything user-service does.

**Measured, because a single paired run pointed the wrong way.** On the first comparison it failed
3/3 with 13-06's changes applied and passed 1/1 on the stashed pre-plan tree, which looks like
causation. Re-running the pre-plan tree three times gave **1 pass, 2 failures**. It is flaky and
independent of this plan; the apparent correlation was coincidence. 13-06 touches no user-service
file (`git diff --name-only HEAD` confirms).

**Likely cause and the one-line remedy.** `WireMockConfiguration.wireMockConfig().dynamicPort()`
binds the wildcard address, which is the exact condition `scripts/DEV-STACK-RUNBOOK.md` documents
under "The silent EOF": macOS's Application Firewall accepts the connection and closes it having
written zero bytes. `BaseIntegrationTest` already fixes this for Tomcat with
`r.add("server.address", () -> "127.0.0.1")`. The WireMock equivalent is
`.bindAddress("127.0.0.1")` in the same builder.

Not applied here: `services/user-service/src/test/.../UserAdminDelegationIT.java` is outside plan
13-06's file list, and the same change probably wants making across every WireMock-using test at
once rather than piecemeal.

### 2. platform-admin-service is currently red on this machine for the same reason

`mvn -pl services/platform-admin-service verify` → **40 run, 5 failures, 11 errors**, identically
with and without 13-06's changes (verified by stashing). Every error is
`Unexpected end of file from server executing POST http://localhost:<port>/internal/users/branches`
— the same silent-EOF symptom against WireMock — and `PlatformAuthIT`'s 5 failures are the login
assertions 13-05 recorded as green.

Nothing in 13-06 can affect these: they stub auth-service with WireMock rather than calling it.
Same remedy as item 1.

### 3. `_phase13-lib.sh` cannot be overridden from the environment

`scripts/e2e/_phase13-lib.sh` sources `deploy/.env` under `set -a`, which **overwrites** variables
the caller exported rather than deferring to them. Found while trying to force a failure with
`INTERNAL_SERVICE_SECRET=deliberately-wrong`: the run reported 19/19 PASS because the wrong secret
had been silently replaced by the real one.

Harmless today — no phase 13 script tries to pass a deliberately wrong secret; 13-06 asserts the
gate by sending *no* header at all, which is unaffected — but it is the "harness that quietly tests
the wrong thing" class, and a future negative test written the obvious way would silently assert
nothing. The fix is to use `: "${VAR:=default}"` semantics, or source `deploy/.env` only for names
not already set.

### 4. `AuthServiceImpl.DUMMY_HASH` is the bcrypt hash of a real seeded password

`DUMMY_HASH` (used to equalise timing when no user is found) is byte-identical to the seeded
`cashier@demo.local` hash for `Cashier#2026`, which also appears in
`scripts/e2e/phase13-roles-e2e.sh`. Not exploitable — the comparison result is discarded — but a
dummy credential that is also a live credential is a confusing thing to leave in a security-relevant
constant, and it would become a real problem if the constant were ever reused for anything else.
Cosmetic; noted while reading the login path.

## From plan 13-08

### 5. `auth_lookup_refresh_tenant` (changeset 052) bypasses RLS only by an ownership accident

**Status:** NOT broken in the current dev environment (verified: `/api/v1/auth/refresh` answers
200). A latent deployment landmine, and the highest-value item on this page.

`refresh_sessions` is `FORCE ROW LEVEL SECURITY`. Refresh and logout resolve a session by token hash
*before* any tenant GUC can exist, so they rely on 052's `SECURITY DEFINER` function to see the row.
`SECURITY DEFINER` runs a function as its **owner**, and `FORCE ROW LEVEL SECURITY` subjects even
the table's owner to the policy — so the function works only if its owner has `BYPASSRLS`.

Measured on the live `auth_db`:

```
auth_lookup_refresh_tenant         owner = postgres    rolbypassrls = true    -> works
auth_lookup_password_token_tenant  owner = auth_user   rolbypassrls = false   -> returns NULL
```

The second is 13-08's own attempt at the same idiom, created by Liquibase **as it runs today**. It
was withdrawn for this reason. **The implication is that 052 works because some earlier migration
run happened to execute as a superuser.** Reprovision `auth_db` so Liquibase creates it as
`auth_user`, and refresh and logout start failing with a generic 401 — silently, and with the whole
integration suite still green, because Testcontainers' Postgres user is a SUPERUSER.

Two possible remedies, both outside 13-08's file list:

1. **Deployment:** ensure `auth_lookup_refresh_tenant` is owned by a `BYPASSRLS` role, and pin that
   with a check (a startup assertion, or a changeset that `ALTER FUNCTION … OWNER TO` an explicit
   role) so it cannot silently regress.
2. **Code:** give refresh tokens the same `<tenantId>.<secret>` routing prefix 13-08 gave password
   tokens, and delete the function. No privileged database object, nothing that depends on who ran a
   migration. Costs no isolation — the stored hash covers the whole token, so editing the prefix
   matches nothing anywhere. This is a breaking change to the refresh-token format (every live
   session is invalidated once), which is why it was not done opportunistically.

### 6. TOTP bootstrap accepts a temporary password

`/api/v1/auth/2fa/bootstrap` verifies the password and does not consult `must_change_password`, so
a flagged account can enrol a second factor before it changes its password. 13-08 deliberately left
this open: gating it would break 13-06's seam script, and it closes nothing real — whoever holds the
temporary password can complete the forced change themselves and own the account either way.

Worth a deliberate decision by whoever owns **13-13** (admin-initiated reset), which creates the
same window on purpose. If the answer is "enrolment must follow the change", the gate belongs in
`AuthServiceImpl.authenticateForTotpBootstrap`, and both e2e scripts that enrol need reordering.

### 7. `refresh` does not re-check `is_active` (13-11)

13-11 made `AuthServiceImpl.login` refuse a deactivated or tombstoned account (it never read the
flag before), and applied the same refusal to `authenticateForTotpBootstrap`. **`refresh` does
not.** It validates the refresh session, resolves permissions and mints a new access token without
loading the user row at all.

It is closed in practice, not by luck: `UserLifecycleService.setActive(…, false)` revokes every
unrevoked refresh session in the same transaction, so there is no session left to present —
asserted live (1 → 0) and in `UserLifecycleIT`. The residual window is a session created *between*
the flag flip and the revoke, which one transaction makes very small and does not make impossible.

Not fixed here because `refresh` is on the hottest path in the service and adding a `users` read to
it is a performance decision, not a bug fix. Whoever owns it should decide between (a) one indexed
read of `is_active` per refresh, or (b) leaving it and documenting the revoke as the control. If
(a), it belongs beside `refreshSessionService.validate` and after the tenant GUC is set.

### 8. `user-service` has no Feign `ErrorDecoder` (13-07 finding #2, still open after 13-11)

Reported by 13-07 for `400 UNKNOWN_ROLE_CODE`; 13-11 added a second case,
`403 ROLE_CEILING_EXCEEDED`. Both are correct on `/internal/auth/**` and both reach a client as
`500 INTERNAL_ERROR`, because `FeignException` falls through user-service's generic handler. The
refusals are fail-closed — nothing is written — so this is a status-mapping defect, not a security
one, but a role picker cannot tell "you may not assign that" from "the platform broke".

Owned by **13-12**, which owns `UserAdminController`/`UserAdminService`. One `ErrorDecoder`, or an
`@ExceptionHandler(FeignException.class)` that re-emits 4xx with the upstream body, closes both.

### 9. 🔴 pos-service and purchasing-service leak every tenant's rows on their list endpoints (13-15)

**Found by the seed script, live, and not by reading code.** `scripts/seed_restaurantos.py` built
its menu for a freshly provisioned Saffron Grill, reconciled against the admin listing, and adopted
a *different tenant's* menu item id. Every order priced from it was then rejected. The same run
adopted another tenant's vendor and got `404 Vendor not found` on the next call, because the write
path IS tenant-scoped while the read path is not.

Measured on the live databases:

| table | `relrowsecurity` | `relforcerowsecurity` | owner | runtime role |
|---|---|---|---|---|
| `pos_db.menu_items` | `t` | **`f`** | `pos_user` | `pos_user` |
| `pos_db.menu_categories` | `t` | **`f`** | `pos_user` | `pos_user` |
| `pos_db.orders` | `t` | **`f`** | `pos_user` | `pos_user` |
| `purchasing_db.vendors` | `t` | **`f`** | `purchasing_user` | `purchasing_user` |
| `purchasing_db.purchase_orders` | `t` | **`f`** | `purchasing_user` | `purchasing_user` |
| `purchasing_db.vendor_invoices` | `t` | **`f`** | `purchasing_user` | `purchasing_user` |

PostgreSQL exempts a table's **owner** from its own row-level-security policies unless
`FORCE ROW LEVEL SECURITY` is set. Both services connect as the role that owns their tables, so
the policies are inert at runtime. And the queries carry no tenant predicate of their own —
`MenuItemRepository.findAllOrderByName` is `SELECT i FROM MenuItem i ORDER BY i.name`, and
`OrderRepository.findByClientOrderId` has no tenant clause either.

Contrast the tables this phase repaired: `auth_db.users`, `auth_db.user_branch_roles`,
`user_db.branches` and `finance_db.chart_of_accounts` are all `t | t`. This is the same class of
defect 13-02, 13-06 and 13-08 each found in their own service, in the two services nobody looked at.

**Live evidence.** The Saffron manager, whose token carries tenant `4f2783b6…`, sees 13 menu items
of which 2 are its own — including `Beef Nihari`, which belongs to the `test` tenant. Adding that
item to a Saffron order was accepted and priced it.

**Severity: high.** It is a cross-tenant data read, and via `findByClientOrderId` a cross-tenant
*write* target. Not exploited by anything shipped today only because no UI surfaces another
tenant's ids.

**Why 13-15 did not fix it.** It is two migrations plus a re-audit of every query path in two
services this plan's file list does not touch, and `ALTER TABLE … FORCE ROW LEVEL SECURITY` on a
service whose queries have never carried a tenant predicate is an availability risk that has to be
taken deliberately. The seed is instead made immune: every identifier it controls is a `uuid5`
scoped to the **tenant id**, and every reconciliation key is a marker containing that id, so a
neighbour's row can never be adopted. `scripts/seed_restaurantos.py` says so at both call sites.

**What closes it.** Per service: (a) `ALTER TABLE … ENABLE + FORCE ROW LEVEL SECURITY` for every
tenant-scoped table, (b) a tenant predicate in every finder that currently relies on the policy —
`findByClientOrderId` above all, since it is an idempotency key — and (c) an e2e that provisions two
real tenants and asserts each list endpoint returns only its own rows, with a control proving the
neighbour's rows exist. 13-12's `phase13-tenant-admin-users-e2e.sh` is the template.

### 10. `phase13-reset-hardening-e2e.sh` greps a fixed 400-line window of a growing log (13-15)

Its last assertion is `tail -400 "$AUTH_LOG" | grep -q 'restaurantos.auth.password-reset.delivery-mode'`.
`.dev-logs/auth-service.log` is appended to across sessions, and the script restarts auth-service
twice, so whether the startup warning is inside that window depends on how much unrelated output
happens to sit after it. Observed **30/1 then 31/0 on an immediate re-run with nothing changed**.

The precise fix is to record `wc -l` before the restart and grep only the lines added after it,
which cannot match an older startup either. Left to whoever owns 13-09's script;
`scripts/e2e/phase13-acceptance.sh` retries a red suite once and reports the retry rather than
hiding it, so this is visible instead of silently green.

### 11. Nothing purges `pos_db` / `purchasing_db` when a tenant is deleted (13-15)

13-CONTEXT already defers tenant data purge ("`DELETE` is a status flip today, no cross-service
erasure"). This is the observed consequence: after a tenant is removed and re-provisioned under the
same brand, its menu, orders, vendors and invoices remain, owned by a tenant id nothing resolves.
Combined with item 9 they are visible to whoever comes next. The seed works around it by scoping
every key to the tenant id; the underlying erasure is still owed.
