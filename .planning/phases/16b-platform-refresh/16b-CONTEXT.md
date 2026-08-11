# Phase 16b — Platform (SuperAdmin) refresh session

**Branch:** `phase-13-access-repair`
**Owner:** auth-service
**Predecessor:** 16a-01 (email-first login), 19c-01 (the console that exposed the problem)

---

## The problem, measured

Measured live on this stack before any change, against the real gateway on `:8080`:

```
$ curl -s -D - -X POST /api/v1/auth/login -d '{"email":"superadmin@softxlogic.com","password":"Test@123!"}'
HTTP/1.1 200 OK
Set-Cookie: refresh_token=; Path=/api/v1/auth; Max-Age=604800; HttpOnly; SameSite=Strict
                          ^ empty
```

The value is empty because `AuthServiceImpl.platformLoginResult` returns `new LoginResult(body, null)`
and `AuthController.login` unconditionally writes `refreshCookie(result.refreshToken(), …)`. There is
no branch — a null refresh token becomes an empty cookie rather than no cookie, which is why the
symptom reads as "a cookie that does not work" instead of "no cookie".

The consequence is not subtle. The access JWT is memory-only by design (`lib/auth/session.ts`:
"never localStorage"), so a full document load has nothing to rehydrate from. `SessionProvider`
calls `POST /api/v1/auth/refresh`, the empty cookie fails, and the browser lands on
`/login?reason=session_expired`. **Every reload, every deep link, every new tab.**

Phase 19c built the console on top of this and could not fix it (auth-service is not that
workstream's to edit). It pinned the defect instead — `superadmin-console.spec.ts` test F asserts
the cookie is empty and instructs whoever fixes it to delete the test — and worked around it by
reaching every platform screen through client-side navigation (`openTenant`, whose javadoc says
`page.goto` would fail and why). Both are this phase's to remove.

---

## The security bound this deliberately created, and why it cannot simply be dropped

The javadoc above `platformLoginResult` is not an oversight. It says:

> a control-plane token lives 15 minutes and has no renewal path, which is the only bound on a
> leaked SuperAdmin credential while `platform_users` still has no second-factor column. Issuing a
> 30-day refresh token here to make the console more comfortable would quietly remove that bound.

Both halves are true and both matter:

1. **`platform_users` genuinely has no TOTP column.** `JwtSigningService.signPlatformToken` hard-codes
   `totp_verified: false` with a comment saying so, and `PlatformTokenService` never loads a
   `platform_users` row at all — it signs what platform-admin-service asserts. There is no second
   factor to fall back on.
2. **15 minutes with no renewal really is the whole bound.** A stolen platform access token is
   useless after 900 seconds and there is nothing to extend it with.

So the comment is correct about the risk. What it did not work through is the browser consequence —
because when it was written (13-05, before 16a-01) the SuperAdmin had **no browser path at all**.
The console did not exist. Nothing depended on the session surviving a reload, so "re-authenticate"
cost nothing. It costs a full password round trip per reload now.

---

## The decision

**A short-lived, single-use rotating refresh session for platform users now; TOTP for
`platform_users` as a follow-up phase.**

| | Tenant path (unchanged) | Platform path (this phase) |
|---|---|---|
| Refresh TTL | 7 days — `JWT_REFRESH_TTL_SECONDS=604800`, read from the running JVM's environment, not from `application.yml` (whose default is 30 days and is overridden here) | **30 minutes** (`platform-refresh-ttl-seconds: 1800`) |
| Rotation | none — the token is reusable for its whole life | **single-use** — redeeming invalidates it |
| Replay | accepted (same token, new access token) | **refused**, and the whole session family revoked |
| Access TTL | 1 hour | 15 minutes (unchanged) |

### What this does and does not do to the exposure window

Exposure on a **stolen platform refresh cookie** goes from *nothing to steal* to **at most 30
minutes of idle life**, and single-use rotation means a thief and the real operator cannot both use
it: the second redemption of a given token is refused and revokes every live session for that
platform user, so the theft is self-limiting and self-announcing rather than silent.

That is a modest, deliberate widening — **not** the 30-day removal the comment warns against. The
number the comment names as unacceptable is 1,440× larger than the one chosen here. Stated
plainly so the trade is on the record: a SuperAdmin who leaves the console open all day now holds a
continuously-rotating credential rather than re-typing a password every 15 minutes, and the
compensating control for that is rotation-with-reuse-detection, not TTL alone.

**The javadoc gets rewritten, not left standing.** A comment asserting "no renewal path" above code
with a renewal path is worse than no comment, because the next reader trusts it.

---

## The constraint that shaped the implementation: `refresh_sessions` is tenant-scoped

```
 tenant_id | uuid | not null
Policies (forced row security enabled):
    POLICY "tenant_isolation"
      USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid))
```

A platform user has no tenant. Three options were considered:

| Option | Rejected because |
|---|---|
| `tenant_id NULL` for platform rows | The policy is `tenant_id = <uuid>`. `NULL = x` is NULL, which RLS reads as false — the row would be **invisible to everything, forever**. It would also make `auth_lookup_refresh_tenant` return NULL, which `bootstrapTenantGuc` treats as "invalid refresh session", and would break `verify-security-definer-owners.sh` (whose probe samples an arbitrary `refresh_sessions` row and asserts the function returns non-NULL — sampling a platform row would report a false failure). |
| A separate `platform_refresh_sessions` table | This is the "parallel infrastructure" the brief rules out unless necessary: a second entity, a second repository, a second RLS policy, and a **second `SECURITY DEFINER` lookup function** — which would mean a new migration touching exactly the class of function changeset 081's ownership guard exists to protect. |
| **Chosen:** same table, `scope` discriminator, reserved nil-UUID tenant | See below. |

### The chosen shape

`refresh_sessions` gains `scope VARCHAR(16) NOT NULL DEFAULT 'TENANT'`, and platform rows carry the
reserved nil UUID `00000000-0000-0000-0000-000000000000` as `tenant_id`. A **CHECK constraint binds
the two together** so the correlation is a storage-layer invariant rather than an application
convention:

```sql
CHECK ( (scope = 'TENANT'   AND tenant_id <> '00000000-0000-0000-0000-000000000000')
     OR (scope = 'PLATFORM' AND tenant_id  = '00000000-0000-0000-0000-000000000000') )
```

Why this is not a weakening of the tenant path:

- **The RLS policy is untouched and still does real work.** `gen_random_uuid()` cannot produce the
  nil UUID, and no row in `auth_tenants` carries it, so a platform row is invisible in every tenant
  context and every tenant row is invisible in the platform context. The nil UUID is not a bypass —
  it is a tenant namespace of exactly one, which nothing else can enter.
- **`auth_lookup_refresh_tenant` needs no migration.** It returns `tenant_id` for a token hash;
  for a platform row that is the nil UUID, which is non-NULL, so the existing function works
  unchanged. Changeset 081's ownership guard is never approached, and
  `verify-security-definer-owners.sh` keeps passing without edit.
- **`refresh_sessions` has no FK to `auth_tenants`** (verified on the live schema — `\d
  refresh_sessions` shows no foreign-key constraints), so the sentinel needs no phantom tenant row.
- **The discriminator is explicit, not inferred.** Code branches on `scope`, never on "is the tenant
  id the sentinel" — and the CHECK constraint makes the two statements impossible to disagree.

### The guardrail both directions

A platform refresh must never mint a tenant token and a tenant refresh must never mint a platform
token. Enforced in `AuthServiceImpl.refresh` by branching on `scope` **before** anything reads the
session, and asserted in both directions by test.

---

## Verification bar

Testcontainers runs as SUPERUSER and bypasses RLS entirely, so a green IT proves nothing about
scoping — every claim about the RLS behaviour here is measured against the live `auth_db` as the
real `auth_user` role, and every HTTP claim is measured through the real gateway with
`scripts/check-stale-jars.sh` clean first.

Acceptance: sign in at `/login` as `superadmin@softxlogic.com` with no tenant slug, **reload, and
stay signed in.**

---

## Out of scope, named

- **TOTP for `platform_users`** — the follow-up this phase's TTL choice is a bridge to. Until it
  lands, rotation + 30 minutes is the bound, and the rewritten javadoc says so.
- Tenant refresh rotation. The tenant path is proven; rotating it is a separate decision with its
  own multi-tab failure modes, and changing it here would put a proven path at risk for no gain to
  this phase's goal.
