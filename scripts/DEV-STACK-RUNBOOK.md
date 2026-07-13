# Dev Stack Runbook

Terse, factual notes from actually getting the stack healthy on 2026-07-13. Commands
below were run and verified; nothing aspirational.

## Cold start (from nothing running)

```bash
cd /Users/mac/ResturantOS
make dev-up                      # infra containers (postgres, redis, rabbitmq, minio,
                                  # opa, eureka, config-server, clickhouse, mailpit, pgadmin)
./scripts/start-dev.sh            # builds + starts all backend services + frontend
```

`start-dev.sh` rebuilds `auth-service, authorization-service, user-service,
platform-admin-service, audit-service, file-service, finance-service, gateway` by
default. `purchasing-service` and `kitchen-service` are NOT in that list — start them
separately:

```bash
source scripts/dev-env.sh && source scripts/local-service-env.sh
mvn -pl services/purchasing-service -am -DskipTests package -q
( source scripts/dev-env.sh; source scripts/local-service-env.sh; \
  exec java -jar services/purchasing-service/target/purchasing-service-1.0.0.jar ) \
  >>.dev-logs/purchasing-service.log 2>&1 &
```

Stop everything: `./scripts/start-dev.sh --stop`.

## Restarting one service without a full stack bounce

Never rebuild a module a sibling agent/session is actively editing — check
`git status <module>` and `ps aux | grep mvn` first. If the jar is already current
(check `ls -la target/*.jar` vs `find src -newer target/*.jar`), just restart the
process from the existing jar — do **not** run `mvn package` again:

```bash
kill -TERM <pid>                         # graceful stop, wait ~10s
( source scripts/dev-env.sh; source scripts/local-service-env.sh; \
  exec java -jar services/<name>/target/<name>-1.0.0.jar ) \
  >>.dev-logs/<name>.log 2>&1 &
disown
```

**IMPORTANT — do this in an actual bash context, not raw zsh.** See "Failure mode 1"
below: `scripts/local-service-env.sh` used to silently no-op under zsh. It's now
fixed (falls back to `git rev-parse --show-toplevel`), but always verify after
sourcing:

```bash
( source scripts/dev-env.sh; source scripts/local-service-env.sh; \
  echo "JWT_PUBLIC_KEY len: ${#JWT_PUBLIC_KEY}" )   # must be > 0, not "0"
```

## Known failure modes (root-caused 2026-07-13) and how to avoid them

### 1. Services silently boot with empty secrets when `local-service-env.sh` is
   sourced from zsh (macOS default shell)

**Symptom:** `password authentication failed for user "finance_user"` (Flyway),
`Failed to parse RSA public key` / `Missing key encoding` (auth-service JWT beans),
RabbitMQ `ACCESS_REFUSED` — even though `deploy/.env` has the right values.

**Root cause:** the script located itself via `${BASH_SOURCE[0]}`, which is unset
in zsh. `dirname ""` fell back to the caller's cwd instead of `scripts/`, so
`deploy/.env` was reported "missing," the guard printed a warning to stderr, and
Spring Boot's `${VAR:default}` placeholders silently resolved to their (often empty
or `guest`) defaults. No fatal shell error — the java process still launched, just
with a broken environment.

**Fix applied:** `scripts/local-service-env.sh` now falls back to
`git rev-parse --show-toplevel` when `BASH_SOURCE` is unset, so it works from bash
*or* zsh. Verify with the length-check snippet above before trusting a
restart.

### 2. `gateway` and `file-service` were missing `spring.rabbitmq.*` config entirely

**Symptom:** `ACCESS_REFUSED - Login was refused using authentication mechanism
PLAIN`, but `rabbitmqctl authenticate_user restaurantos <password>` on the
container succeeds, and every *other* service connects fine with the same
credentials.

**Root cause:** `gateway/src/main/resources/application.yml` and
`services/file-service/src/main/resources/application.yml` had a `spring.data.redis`
block but no `spring.rabbitmq` block, even though both pull in
`spring-boot-starter-amqp` transitively via `shared-lib`. With no explicit
`spring.rabbitmq.host/username/password`, Spring Boot's `RabbitAutoConfiguration`
falls back to its own hardcoded defaults: `localhost:5672`, `guest`/`guest`. The
`guest` account doesn't exist in this stack (`deploy/init/rabbitmq-definitions.json`
+ `RABBITMQ_DEFAULT_USER=restaurantos` replace it), so every connection is refused
— independent of what `RABBITMQ_HOST`/`RABBITMQ_PASSWORD` are set to in the shell.

**Fix applied:** added the same `spring.rabbitmq.host/port/username/password` block
(mirroring every other service, e.g. `services/auth-service/application.yml`) to
`gateway/application.yml` and `services/file-service/application.yml`. Rebuild with
`mvn -pl gateway -DskipTests package` / `mvn -pl services/file-service -DskipTests
package` after any further edit to these files — the fix only takes effect once the
jar is rebuilt.

### 3. `audit-service` was missing `spring.data.redis.*` config entirely

**Symptom:** `NOAUTH HELLO must be called with the client already authenticated`
from the reactive Redis health indicator, even though `REDIS_PASSWORD` is correct
in the shell and Redis itself accepts it (`redis-cli -a <password> ping` → `PONG`).

**Root cause:** same shape as #2, but for Redis —
`services/audit-service/src/main/resources/application.yml` had no
`spring.data.redis` block, so it connected to a password-protected Redis with no
password.

**Fix applied:** added the standard `spring.data.redis.host/port/password` block
(same pattern as every other service). Rebuild with `mvn -pl services/audit-service
-DskipTests package`.

### 4. RabbitMQ / ClickHouse restarts invalidate long-lived connections in
   already-running JVMs

**Symptom:** a service that was healthy for hours starts failing `ACCESS_REFUSED`
or similar after `docker restart restaurantos-rabbitmq` (or any infra container
restart) to free memory — even with fully correct credentials.

**Cause:** `CachingConnectionFactory` (and friends) don't always recover cleanly
from the broker disappearing and coming back with a fresh Erlang node identity.
Compare `docker inspect <container> --format '{{.State.StartedAt}}'` against the
Java process's start time (`ps -p <pid> -o lstart=`) — if the container restarted
*after* the process started, restart the process too. Don't waste time re-checking
credentials first; they're usually fine.

### 5. Rebuilding a jar while its process is still running corrupts the running
   JVM's classloader

**Symptom:** `NoClassDefFoundError` / `ClassNotFoundException` for classes deep
inside a library that is clearly on the classpath (e.g.
`org.apache.hc.core5.util.TimeValue$1`, `org.hibernate.engine.jdbc.spi.
SQLExceptionLogging`), sometimes preceded by `java.io.IOException: Zip 'Central
Directory File Header Record' not found at position N` in the logs.

**Cause:** `mvn package` overwrote the fat jar on disk while the old JVM still had
it open for lazy classloading. The `target/*.jar` mtime being *newer* than the
process start time (`ps -p <pid> -o lstart=`) is the tell.

**Fix:** just restart the process — the already-rebuilt jar on disk is fine, the
*running* JVM is the corrupted one. No new build needed unless source changed since
the jar's mtime (`find src -newer target/*.jar -name '*.java'`).

### 6. Turbopack's persistent disk cache can corrupt itself under memory pressure

**Symptom:** `pnpm dev` stays "up" (port 3000 listening) but every request hangs;
log is full of `Persisting failed: Another write batch or compaction is already
active` and a `panicked at ... Failed to restore task data (corrupted database or
bug)`.

**Fix:**
```bash
kill -9 <next-server pid>
rm -rf frontend/.next/dev/cache/turbopack
cd frontend && pnpm dev
```

## Memory constraint

This host has 8GB RAM and runs hot under the full stack (10 infra containers + 9
JVMs + Next.js + IDE). Watch `sysctl vm.swapusage` — under ~500MB free swap,
services start timing out and health checks that would otherwise pass in a few
seconds take 60-90s.

**Safe to stop when tight on RAM** (not needed for purchasing/finance UAT click-throughs):
```bash
docker stop restaurantos-clickhouse restaurantos-pgadmin   # ~1.3GB freed
```
Restart before anything that needs analytics/reporting or the pgAdmin UI:
```bash
docker start restaurantos-clickhouse restaurantos-pgadmin
```

**Never stop** `postgres`, `redis`, `rabbitmq`, `eureka`, `config-server` — every
backend service depends on at least one of these at boot.

If you must restart `rabbitmq` or `redis` while services are already running, plan
to restart every service that talks to them afterward (see failure mode #4) — don't
assume they'll reconnect on their own.

## Demo login credentials (seeded via Liquibase `context=seed`, already applied)

**UAT 2026-07-13 gap closure:** the `demo` tenant (auth_db.auth_tenants,
`a0000001-0000-4000-8000-000000000001`) had NO row in `platform_db.tenants` — every
demo login got `{"features":[]}` from `GET /api/v1/feature-flags`, hiding
POS/Finance/Purchasing/HR/CRM nav for EVERY role. Fixed by
`services/platform-admin-service/.../901-seed-demo-tenant.xml`, which seeds `demo`
with the same GROWTH-tier feature matrix as the `dev` tenant. Also, the only two
"privileged" seeded users (`owner@demo.local`, `accountant@demo.local`) are
permanently locked behind `401 TOTP_REQUIRED` with no enrolment path (see "TOTP
catch-22" below) — do not use them for UAT. Two loginable MANAGER accounts were
added instead (`services/auth-service/.../902-seed-purchasing-demo-users.xml`) that
hold the full `vendor.*` set (create/approve/send POs, receive GRNs, book/override
invoices, post payments) without triggering TOTP step-up.

| Role | Email | Password | tenantSlug | TOTP? | Can do |
|---|---|---|---|---|---|
| CASHIER | `cashier@demo.local` | `Cashier#2026` | `demo` | No | POS only (`pos.*`) |
| MANAGER #1 | `manager1@demo.local` | `Manager1#2026` | `demo` | No | Full `vendor.*` (create/approve/send PO, receive GRN, book/override invoice, post payment), POS, inventory |
| MANAGER #2 | `manager2@demo.local` | `Manager2#2026` | `demo` | No | Same as MANAGER #1 — a second, distinct identity so multi-tier PO approval (rule: same approver twice on one PO → 409) can actually be tested |
| Finance Viewer | `finance_demo@demo.local` | `Finance#2026` | `demo` | No | `finance.coa.view`, `finance.journal.post`, `finance.journal.view` |
| OWNER | `owner@demo.local` | `Owner#2026` | `demo` | **Always 401 `TOTP_REQUIRED` — unusable in this dev seed** | N/A |
| ACCOUNTANT | `accountant@demo.local` | `Accountant#2026` | `demo` | **Always 401 `TOTP_REQUIRED` — unusable in this dev seed** | N/A |

The previous version of this table said `accountant@demo.local` needs "no TOTP" —
**that was wrong** and cost a prior agent real time. Verified 2026-07-13: both
OWNER and ACCOUNTANT 401 `TOTP_REQUIRED` on every login attempt, `totp_secret` is
NULL for both (confirmed via `psql`), and `POST /api/v1/auth/2fa/setup` requires an
authenticated session that these accounts can never obtain — a hard catch-22, not a
soft gate. Use `manager1@demo.local` / `manager2@demo.local` for any purchasing/AP
approval journey instead.

### The TOTP catch-22 (known bug, not fixed here)

`AuthServiceImpl.requiresTotpStepUp()` forces TOTP step-up for any login holding
`rbac.manage` or `finance.period.close`, regardless of whether `totp_enabled` is
true or a secret is enrolled. For OWNER/ACCOUNTANT, `totp_enabled=false` and
`totp_secret=NULL`, so they can never log in to reach `/2fa/setup` and enrol —
the account is permanently bricked. The step-up invariant itself (privileged perms
require TOTP) is intentional and was NOT weakened. Arguably this IS a real product
bug — a first-login-must-enrol flow (issue a short-lived, enrolment-only token on
first login instead of a hard 401, force `/2fa/setup` before any other endpoint
works) would fix it properly. That's a real auth-flow change (new token type, new
enrolment-gated state) that touches more than the demo-data problem this pass was
scoped to fix, so it was left alone; the practical workaround for UAT is the seeded
MANAGER accounts above, which reach the same `vendor.*` permission surface without
the step-up trap (no `rbac.manage`/`finance.period.close`).

Verified working end-to-end through the gateway:
```bash
curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"manager1@demo.local","password":"Manager1#2026","tenantSlug":"demo"}'
# -> 200 {"data":{"accessToken":"...", ...}}
```

## Health check one-liner

```bash
for p in 8080:gateway 8081:auth 8082:user 8083:authz 8086:finance 8087:purchasing \
         8093:audit 8095:file 8096:platform-admin; do
  port=${p%%:*}; name=${p##*:}
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:$port/actuator/health)
  echo "$name ($port): $code"
done
curl -s -o /dev/null -w "frontend (3000): %{http_code}\n" --max-time 5 http://localhost:3000/
```
All should be `200` (frontend may be `307` — that's a redirect to `/login`, which is
healthy).
