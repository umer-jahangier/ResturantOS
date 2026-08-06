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
