# Deferred items — Phase 16b

Found while adding the platform refresh session. Not fixed here: each is outside this phase's file
ownership or outside its scope, and the rule is log rather than fix.

---

## 1. `deploy/scripts/verify-security-definer-owners.sh` fails on `hr_db.resolve_device`

**Severity: high — it is a deployment gate, and it exits non-zero.**

Measured after this phase's migration, on the live stack:

```
OK    auth_db: public.auth_lookup_refresh_tenant owner=postgres, definer context resolves a real row as auth_user
OK    auth_db: public.auth_lookup_login_candidates owner=postgres, definer context resolves a real row as auth_user
FAIL  hr_db: public.resolve_device returned NULL as hr_user for a row that exists — RLS is not being
      bypassed. Refresh/logout (or device auth) fails silently for every user.
OK    hr_db: public.hr_tenant_ids owner=postgres, SECURITY DEFINER (no-arg; structural check only)
----------------------------------------
checked=4 repaired=0 failed=1
```

**Not caused by this phase, and the evidence is specific rather than assumed:**

- It is in `hr_db`. 16b-01 touches `auth_db` only.
- This phase creates, alters and reassigns **no** `SECURITY DEFINER` function at all — deliberately,
  because the nil-UUID sentinel keeps changeset 052's existing function working unmodified. Both
  `auth_db` entries pass.
- `git diff` for this phase contains no `services/hr-service` and no `deploy/` change.

**And the usual explanation does not fit.** The ownership trap the script was written for is a
function owned by the service role; this one is already correct on both counts:

```
$ psql -d hr_db -tAc "SELECT a.rolname, p.prosecdef FROM pg_proc p JOIN pg_authid a ON a.oid=p.proowner
                       WHERE p.oid=to_regprocedure('public.resolve_device(TEXT)');"
postgres|t
```

Owner `postgres`, `prosecdef = t`. So it is not an ownership or a `SECURITY INVOKER` problem — the
function is structurally correct and its BODY returns NULL for a `device_token` sampled straight out
of `attendance_devices`. That points at the function's own query (a join or predicate that no longer
matches the table), not at RLS plumbing.

**Owner:** hr-service. **Do not "fix" it by relaxing the script** — the script is right, and it is
the thing that would otherwise let this ship silently.

---

## 2. Stale duplicate build artifacts across `services/auth-service/target/`

`target/classes` and `target/test-classes` contained space-suffixed copies of compiled classes —
`AuthServiceApplication 2.class`, `AuthServiceApplication 3.class`, `TestFixtures 2.class` and
around a hundred more. They broke two builds outright before this phase's work could be verified:

```
[ERROR] io/restaurantos/auth/integration/TestFixtures 2 (wrong name: io/restaurantos/auth/integration/TestFixtures)
[ERROR] Unable to find a single main class from the following candidates
        [io.restaurantos.auth.AuthServiceApplication 2, io.restaurantos.auth.AuthServiceApplication 3,
         io.restaurantos.auth.AuthServiceApplication]
```

**Nothing in `src/` is affected** — `find services/*/src -name "* [0-9].java"` returns nothing, and
none are tracked by git. They are a filesystem duplication event (the ` 2` suffix is Finder's /
iCloud's) landing in build output only, and `mvn clean` clears them.

Cleared for auth-service here because it was blocking. **Not swept repo-wide**, which is the deferred
part: other services' `target/` directories are likely to carry the same copies and will fail the
same way on their next build. Worth a one-line check in the dev runbook, since the error message
names a "wrong name" class and gives no hint that the cause is a duplicated file.
