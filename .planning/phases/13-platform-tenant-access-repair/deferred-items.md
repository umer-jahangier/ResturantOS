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
