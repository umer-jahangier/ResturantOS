# Scalability & Operability Assessment — ResturantOS

**Date:** 2026-08-07
**Branch:** `phase-13-access-repair`
**Scope:** production readiness of the 16-service Spring Boot fleet — the Phase 13 wedge defect, horizontal scaling, database, caching, observability, deployment.
**Method:** every claim below is tied to a file I opened or a command I ran against the live dev fleet. Where I could not verify something, it is marked **UNVERIFIED** and says what would settle it.

**Explicitly out of scope** (covered by the parallel swarm): FBR e-invoicing, POS thermal printing, biometric attendance, ERP module gaps, cross-module integration gaps, UI/UX direction, frontend component stack, tenant configurability, testing strategy.

---

## 0. Executive summary

| # | Finding | Severity | Verified? |
|---|---|---|---|
| F1 | The K8s-shaped probes (`/actuator/health/liveness`, `/readiness`) return `{"status":"UP"}` without touching DB, Redis, or Rabbit | **CRITICAL** | Yes — live |
| F2 | `JwksKeyProvider.refresh()` is `synchronized` and makes an HTTP call with **no connect or read timeout** — a single stalled socket wedges every authenticated request in the process | **CRITICAL** | Yes — code |
| F3 | The leading hypothesis for the wedge (Hikari pool exhaustion) is **refuted** by the evidence; the diagnosis in task #12 is wrong | **HIGH** | Yes — live |
| F4 | `OutboxRelay` has no row locking → N replicas each publish the same rows → N× duplicate events | **CRITICAL** | Yes — code |
| F5 | `OutboxRelay` holds a JDBC connection across up to 200 synchronous RabbitMQ sends inside `@Transactional` | **HIGH** | Yes — code |
| F6 | All `@Scheduled` jobs in a service share **one** thread (`scheduling-1`), and every job fires on every replica | **HIGH** | Yes — code + logs |
| F7 | WebSocket subscriber registries are in-process `ConcurrentHashMap`s → live POS/KDS/dashboard updates break at N>1 replicas | **CRITICAL** | Yes — code |
| F8 | `/actuator/prometheus` returns **404 on every service** — there are no metrics at all | **CRITICAL** | Yes — live |
| F9 | No distributed tracing dependency exists anywhere in the repo | **HIGH** | Yes — code |
| F10 | `tenantId`/`traceId` are written to MDC but appear in **zero** log lines | **HIGH** | Yes — logs |
| F11 | `idempotency_keys` has no tenant column and no RLS → cross-tenant key collision | **HIGH** | Yes — code + DDL |
| F12 | Zero Hikari configuration in 16 services; no connection-acquisition tuning, no leak detection | **HIGH** | Yes — code |
| F13 | `docker-compose.yml` contains **only infrastructure** — none of the 16 app services are deployable by any committed artifact | **CRITICAL** | Yes — code |
| F14 | No graceful shutdown anywhere → SIGTERM kills in-flight requests; zero-downtime deploys impossible | **HIGH** | Yes — code |
| F15 | Containers run as **root**, with no JVM heap/container flags | **MEDIUM** | Yes — code |

The single most important structural insight: **this system has no bounded-wait discipline.** Not one outbound HTTP client on a request path sets a timeout, no request has a deadline, no thread pool is sized, and the probe that would catch the resulting wedge is the one probe that cannot see it. F1+F2 are the same disease as the "dead code that looks alive" pattern this project has hit repeatedly — the difference is that here the dead thing is the *safety net*.

---

# PART 1 — The wedge (PRIORITY ONE)

## 1.1 The reported symptom

From task #12 (verbatim): observed on auth-service (13-05), user-service (13-05), finance-service (13-10), plus pos-service. `/actuator/health` answers in ~4–21 ms while every other path — including nonexistent ones — hangs indefinitely. A thread dump showed a fresh exec thread per request parking with ~0.04 ms CPU. A restart cleared it every time.

## 1.2 What I did

The dev fleet was running while I investigated (`.dev-pids.json`; nine JVMs listening on 8081–8096). I probed it directly rather than reasoning from the code alone.

```
port 8081  health: 200 in 0.010507s   | bogus-path: 401 in 0.002064s
port 8082  health: 200 in 0.012588s   | bogus-path: 401 in 0.002813s
port 8084  health: 200 in 0.022607s   | bogus-path: 403 in 0.016480s
...
port 8096  health: 200 in 0.014651s   | bogus-path: 401 in 0.003064s
```

Services were healthy at probe time, so I could not catch the wedge live. But I could answer the question that actually decides the diagnosis: **does `/actuator/health` touch the database?**

`platform-admin-service` sets `management.endpoint.health.show-details: always`
(`/Users/muhammadumer/Documents/Projects/ResturantOS/services/platform-admin-service/src/main/resources/application.yml:66-68`), so its response enumerates every registered indicator. `GET http://127.0.0.1:8096/actuator/health` returned:

```json
{
  "components": {
    "db":      { "status": "UP", "details": { "database": "PostgreSQL", "validationQuery": "isValid()" } },
    "redis":   { "status": "UP", "details": { "version": "8.2.7" } },
    "rabbit":  { "status": "UP", "details": { "version": "4.3.2" } },
    "discoveryComposite": { "status": "UP", ... },
    "diskSpace": { "status": "UP", ... },
    "livenessState":  { "status": "UP" },
    "readinessState": { "status": "UP" },
    "ping": { "status": "UP" }, "refreshScope": { "status": "UP" }, "ssl": { "status": "UP" }
  },
  "groups": [ "liveness", "readiness" ],
  "status": "UP"
}
```

## 1.3 This refutes the leading hypothesis

**The `db` component is present and it runs `isValid()` on a connection taken from the pool.** `DataSourceHealthIndicator` calls `dataSource.getConnection()` — and in these services that `DataSource` is the `TenantAwareDataSource` wrapper installed by `TenantAwareDataSourcePostProcessor` at `HIGHEST_PRECEDENCE` (`/Users/muhammadumer/Documents/Projects/ResturantOS/shared-lib/src/main/java/io/restaurantos/shared/config/TenantAwareDataSourcePostProcessor.java:15-30`), which delegates straight to Hikari (`.../shared-lib/src/main/java/io/restaurantos/shared/tenant/TenantAwareDataSource.java:52-55`).

So the aggregate `/actuator/health` **cannot** answer in 4–21 ms unless the Hikari pool has a free connection and Postgres is responsive.

> **Therefore: during the incident, the connection pool was NOT exhausted and Postgres was NOT the problem.**

That contradicts the hypothesis recorded in task #12 ("likely a Tomcat/Hikari thread or connection-pool exhaustion where the health endpoint is served without acquiring the exhausted resource") and the same hypothesis in my brief ("the health endpoint likely answers WITHOUT acquiring a pooled connection"). For the **aggregate** endpoint, that premise is false in this codebase.

It also rules out, for *this* incident:
- Hikari pool exhaustion (health would have blocked 30 s then returned 503).
- A `@Transactional` method holding a connection across a synchronous Feign/HTTP call — that manifests *as* pool exhaustion, so the same evidence excludes it. (It exists anyway — see F5, §2.2 — it just is not what wedged these four processes.)
- Postgres `max_connections` saturation — same reason. (`max_connections=300` is set explicitly, `deploy/docker-compose.yml:37`.)
- RabbitMQ consumer starvation — `rabbit` was UP in the aggregate, and Rabbit consumers run on their own listener container threads, not Tomcat exec threads.

## 1.4 But the brief's instinct is right — about a *different* endpoint

The `groups` array reveals `liveness` and `readiness` are registered. Those are the endpoints Spring Boot's own Kubernetes guidance tells you to point probes at. I tested them:

```
8096 /actuator/health/liveness  -> 200 0.012785s  body: {"status":"UP"}
8096 /actuator/health/readiness -> 200 0.002082s  body: {"status":"UP"}
8084 /actuator/health/liveness  -> 200 0.011987s  body: {"status":"UP"}
8084 /actuator/health/readiness -> 200 0.002146s  body: {"status":"UP"}
8082 /actuator/health/liveness  -> 200 0.017530s  body: {"status":"UP"}
8082 /actuator/health/readiness -> 200 0.002432s  body: {"status":"UP"}
```

**F1 (CRITICAL).** The default `liveness` group contains only `livenessState`; the default `readiness` group only `readinessState`. Both are pure in-JVM `ApplicationAvailability` enums. They never open a socket, never take a connection, and — once the context has started — return `UP` unconditionally until something explicitly publishes an availability-change event. Nothing in this repo ever publishes one: `grep -rln "readinessState\|livenessState\|probes"` across `services/`, `gateway/`, `shared-lib/` returns **only** `eureka-server`, `config-server`, and `gateway` `application.yml` files, and none of the 16 services.

So the precise, verified form of the claim is:

> `/actuator/health` (aggregate) tells the truth about the DB. `/actuator/health/liveness` and `/actuator/health/readiness` — the two a Kubernetes manifest would actually reference — are incapable of ever reporting anything but `UP`. A liveness probe on either would never restart a wedged pod, and a readiness probe on either would never pull it out of the Service endpoint list.

Because no service configures a probe path and there are no K8s manifests at all (§6), the wedge as observed was *also* invisible to whatever the operator was hitting — but the moment this ships on K8s using the documented probe paths, F1 becomes the permanent failure mode.

## 1.5 Root cause of the hang itself

Given the DB was healthy, the block must be upstream of it, in the servlet path. I enumerated everything that runs per-request:

`grep -rln "OncePerRequestFilter|implements Filter|FilterRegistrationBean|HandlerInterceptor|WebFilter"` over `services/*/src/main`, `gateway/src/main`, `shared-lib/src/main` yields exactly three kinds of component: the per-service `*InternalServiceFilter`, the shared `JwtAuthenticationFilter`, and the shared `TenantFilterInterceptor`.

- **`*InternalServiceFilter`** is eliminated: `shouldNotFilter` returns `true` for everything outside `/internal/`, and the body is a `MessageDigest.isEqual` comparison with no I/O (`/Users/muhammadumer/Documents/Projects/ResturantOS/services/pos-service/src/main/java/io/restaurantos/pos/config/PosInternalServiceFilter.java:31-33,38-51`).
- **`TenantFilterInterceptor`** is eliminated for 404s: it is a `HandlerInterceptor`, so it never runs when no handler matches (`.../shared-lib/src/main/java/io/restaurantos/shared/tenant/TenantFilterInterceptor.java:27-33`).
- **`JwtAuthenticationFilter`** is the one that matters.

### F2 (CRITICAL) — unbounded JWKS fetch behind a shared monitor

`/Users/muhammadumer/Documents/Projects/ResturantOS/shared-lib/src/main/java/io/restaurantos/shared/security/JwksKeyProvider.java`:

```java
public PublicKey getKey(String kid) {
    if (jwksUrl != null && (Instant.now().isAfter(lastFetch.plus(TTL)) || !cache.containsKey(kid))) {
        refresh();                                    // line 40-41
    }
    ...
}

private synchronized void refresh() {                 // line 48  <-- SHARED MONITOR
    ...
    String jwksJson = restClient.get().uri(jwksUrl).retrieve().body(String.class);   // line 52
    ...
}
```

Three properties combine into a process-wide wedge:

1. **The HTTP call has no connect timeout and no read timeout.** Thirteen services construct the provider as `new JwksKeyProvider(jwksUri, RestClient.create())` — e.g. `services/user-service/.../UserSecurityConfig.java:40`, `services/finance-service/.../FinanceSecurityConfig.java:29`, `services/pos-service/.../PosSecurityConfig.java:31`, plus crm, inventory, hr, kitchen, purchasing, reporting, file, nlq, platform-admin, and `gateway/.../GatewaySecurityConfig.java:49`. `RestClient.create()` is a **static** factory: it does not go through Boot's auto-configured `RestClient.Builder`, so `spring.http.client.*` defaults would not reach it even if they were set — and `grep -rn "spring.http.client"` across `services/` and `gateway/` returns nothing. Framework default is *no timeout*. A TCP connection that establishes and then goes silent (a half-open socket after a NAT/conntrack drop, a peer that accepted and then stalled) blocks the calling thread **forever**.
2. **`refresh()` is `synchronized`.** The first thread to stall owns the monitor for the life of the process. Every subsequent request that needs key resolution queues behind it and never returns.
3. **`refresh()` is reachable on the steady-state path, not just at startup.** Line 40 calls it whenever `!cache.containsKey(kid)` — i.e. on *any* token bearing an unknown `kid`, including a stale token after a key rotation, or a forged/garbage `kid`. An unauthenticated attacker can therefore trigger the fetch at will.

**Why `/actuator/health` is exempt.** A probe sends no `Authorization` header, so `JwtAuthenticationFilter.doFilterInternal` short-circuits at `.../JwtAuthenticationFilter.java:46-50` and never touches the provider. That is the mechanism behind "health is fast while everything else hangs" — and note it is *not* about actuator being special. It is about the probe not carrying a bearer token.

This mechanism fully explains **user-service, finance-service, and pos-service**.

### What it does NOT explain — stated plainly

**auth-service does not fit.** It builds its provider pre-seeded — `new JwksKeyProvider(props.getPublicKeyId(), rsaPublicKey)` (`/Users/muhammadumer/Documents/Projects/ResturantOS/services/auth-service/src/main/java/io/restaurantos/auth/config/JwtSigningConfig.java:29`) — which sets `jwksUrl = null` and `lastFetch = Instant.MAX`, so line 40's guard is never true and `refresh()` returns immediately at line 49. And auth-service makes **no outbound HTTP calls at all**: `grep -rn "RestClient|FeignClient|WebClient"` over `services/auth-service/src/main` returns nothing but the security-config import.

So auth-service wedged by some other route. **I could not determine what it was**, and I am not going to invent one. Candidates I could not test because the process is no longer in the failed state:

- **Lettuce/Redis.** auth-service uses Redis (`services/auth-service/src/main/resources/application.yml:22-26`). Lettuce's default command timeout is 60 s, not infinite, and `redis` was UP in the aggregate health — so this is *unlikely* but not excluded, because the aggregate was measured on a different service at a different time.
- **BCrypt at strength 12** (`services/auth-service/.../SecurityConfig.java`, `new BCryptPasswordEncoder(12)`) against an unbounded default Tomcat pool. This would show as *high* CPU, not 0.04 ms, so it does not match the dump — but it is a real capacity cliff on the login path regardless.
- **A misread thread dump.** "Parking with ~0.04 ms CPU" is also the exact signature of an **idle** Tomcat worker blocked in `ThreadPoolExecutor.getTask()` → `workQueue.take()`. If the dump was taken by sampling CPU rather than reading thread states, normal idle workers would look identical to wedged ones. Worth re-checking against the original artifact before treating "fresh thread per request parking" as established.

**Conclusion for Part 1: there are at least two distinct defects presenting identically, plus a third (F1) that guarantees neither is ever caught.** The correct engineering response is not to chase a single root cause but to remove the whole class — bound every wait, and make the probe capable of failing.

## 1.6 Fixes, in priority order

**(a) Make the readiness probe exercise the database.** Put `db` into the readiness group and leave `liveness` as pure process-liveness (a liveness probe that fails on a DB outage causes a fleet-wide restart storm). Add to every service's `application.yml`:

```yaml
management:
  endpoint:
    health:
      probes:
        enabled: true
      group:
        readiness:
          include: readinessState, db, redis
          additional-path: "server:/readyz"
        liveness:
          include: livenessState
  health:
    defaults:
      enabled: true
```

Point the K8s `readinessProbe` at `/actuator/health/readiness` and the `livenessProbe` at `/actuator/health/liveness`. Note `db`'s `isValid()` is cheap but *does* consume a pool slot — with `maximumPoolSize` at least 10 and a probe every 10 s this is fine, but it is exactly why (b) matters.

**(b) A liveness signal that catches F2.** A DB-backed readiness probe still would not have caught this incident, because the DB was fine. The wedge was thread starvation in the servlet layer. Two additions:
- Set `server.tomcat.threads.max` explicitly and export `tomcat.threads.busy` (needs F8 fixed first). Alert when busy/max > 0.9 for 60 s.
- Add a liveness `HealthIndicator` that fails when the request-thread pool has been saturated for longer than a threshold. This is the only check that distinguishes "wedged" from "healthy" for F2.

**(c) Connection-acquisition timeout + pool sizing.** No service configures Hikari at all (F12). Add to the shared config:

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: ${DB_POOL_MAX:10}
      minimum-idle: ${DB_POOL_MIN:2}
      connection-timeout: 3000        # fail fast, not 30s
      validation-timeout: 1000
      keepalive-time: 120000
      max-lifetime: 900000            # < any proxy/PgBouncer idle cutoff
      leak-detection-threshold: 20000 # logs the stack that held a connection too long
```

`connection-timeout: 3000` converts a 30-second stall into a fast 500, which is what makes the failure visible to a probe and to metrics instead of accumulating as invisible latency. `leak-detection-threshold` is what would have identified F5 on its own.

**(d) Request timeout — the actual fix for F2.** Two layers, both required:

1. **Bound the client.** Replace every `RestClient.create()` with a builder that sets timeouts, and stop using the static factory:
   ```java
   RestClient.builder()
       .requestFactory(ClientHttpRequestFactoryBuilder.jdk()
           .build(ClientHttpRequestFactorySettings.defaults()
               .withConnectTimeout(Duration.ofSeconds(2))
               .withReadTimeout(Duration.ofSeconds(3))))
       .build();
   ```
   This applies to `JwksKeyProvider` (13 call sites), `PlatformAdminFeatureResolver` (`shared-lib/.../PlatformAdminFeatureResolver.java:27-31` — also timeout-free, also on the request path via `FeatureFlagAspect`), and the OPA client (`shared-lib/.../SharedAutoConfiguration.java:165`, `RestClient.builder().baseUrl(opaUrl).build()` — no timeout).
2. **Remove the shared monitor.** Even with timeouts, `synchronized` serialises every cache miss through one thread. Replace `refresh()` with a single-flight that is bounded and non-blocking for losers — e.g. a `ReentrantLock` with `tryLock(200ms)` where a failed acquire serves the stale cached key rather than queueing, plus a scheduled background refresh so the request path never fetches. Fail-closed on an unknown `kid` (`401`) rather than blocking.

**(e) A hard request deadline.** Nothing bounds total request time today. Add a filter that runs requests with a deadline, or front every service with the gateway enforcing `spring.cloud.gateway.httpclient.response-timeout` — currently unset (`grep -n "httpclient|response-timeout|connect-timeout" gateway/src/main/resources/application.yml` returns nothing). The gateway declares Resilience4j circuit breakers (`gateway/src/main/resources/application.yml:452+`) but **no `timeoutDuration` on any instance**. Spring Cloud CircuitBreaker applies a 1 s TimeLimiter default, which *may* already bound circuit-broken routes — **UNVERIFIED**; confirm with a deliberately stalled upstream before relying on it. Routes without a `CircuitBreaker` filter are certainly unbounded.

**(f) Reproduce it deterministically.** Cheapest repro, no load needed:
```
# 1. Point a service's JWKS at a socket that accepts and never answers.
nc -l 9999 &                     # accepts, sends nothing, never closes
JWKS_URI=http://127.0.0.1:9999/jwks java -jar services/pos-service/target/pos-service-*.jar
# 2. Send one request with any Bearer token -> hangs forever.
# 3. curl /actuator/health -> 200 fast.   curl /actuator/health/liveness -> 200 fast.
# 4. Send 250 more tokened requests -> Tomcat's 200 threads exhaust; now everything hangs.
```
Step 4 is the missing link for "even nonexistent paths hang": once all 200 default Tomcat threads are parked in the monitor, unauthenticated requests never get a worker either. That is consistent with the report **if** the observation was made after saturation — and it also predicts that `/actuator/health` would eventually stop responding too. Worth confirming against the incident timeline.

---

# PART 2 — Horizontal scaling

## 2.1 State that prevents N replicas

### F7 (CRITICAL) — WebSocket subscriber registries are per-process

Three services keep live subscribers in a plain in-JVM map:

| File | Field |
|---|---|
| `services/pos-service/src/main/java/io/restaurantos/pos/ws/PosOrderWebSocketHandler.java:54` | `Map<String, List<WebSocketSession>> subscribers = new ConcurrentHashMap<>()` |
| `services/kitchen-service/src/main/java/io/restaurantos/kitchen/ws/KdsWebSocketHandler.java:39` | same |
| `services/reporting-service/src/main/java/io/restaurantos/reporting/ws/DashboardWebSocketHandler.java:50` | same |

With two replicas, a kitchen display connected to replica A never sees an order created on replica B. This is not degradation — it is silent, total loss of the live-update feature for roughly half of traffic, with no error surfaced anywhere. **This is a hard blocker for N>1 on pos, kitchen, and reporting.**

Fix: publish UI push events through Redis Pub/Sub (already a dependency in every service) or a Rabbit fanout, and have each replica forward to its own local sessions. Keep the local map as the last hop only. Tenant-scope the channel name (`ws:{tenantId}:{branchId}:orders`) so a fanout cannot cross tenants.

### F6 (HIGH) — `@Scheduled` fires on every replica, on one thread

`SharedAutoConfiguration` is annotated `@EnableScheduling` (`shared-lib/src/main/java/io/restaurantos/shared/config/SharedAutoConfiguration.java:50`) and **no `TaskScheduler` bean is defined anywhere**. Spring Boot's default scheduler pool size is 1. The dev logs confirm the single thread by name:

```
2026-07-17T12:01:59.597+05:00  WARN 53771 --- [pos-service] [   scheduling-1] org.hibernate.orm.jdbc.error :
  HikariPool-1 - Connection is not available, request timed out after 30002ms (total=0, active=0, idle=0, waiting=0)
```

Two consequences:
1. **One slow job stalls all of them.** The line above shows `scheduling-1` blocked for 30 s. Every other scheduled job in that process was frozen for those 30 s.
2. **Every job runs on every replica.** The full inventory:

| Job | File | Replica-safe? |
|---|---|---|
| `OutboxRelay.relay` `fixedDelay=1000` | `shared-lib/.../event/OutboxRelay.java:36` | **No** — see F4 |
| `DashboardTileService` `fixedDelay=1000` | `services/reporting-service/.../DashboardTileService.java:107` | **No** — in-memory `lastContext` map at line 58 |
| `LeaveAccrualScheduler` cron | `services/hr-service/.../LeaveAccrualScheduler.java:41` | **Yes** — idempotency was moved into `LeaveService.accrue` (documented at `LeaveService.java:177`) |
| `ExpirySweepService` nightly cron | `services/inventory-service/.../ExpirySweepService.java:84` | **UNVERIFIED** — single sweep query, likely idempotent, not confirmed |
| `AuditArchivalService` monthly cron | `services/audit-service/.../AuditArchivalService.java:39` | **UNVERIFIED** |

The HR accrual fix is the right pattern and the code comment states the principle correctly — "`@Scheduled` fires on every replica, so N replicas granted N × the leave". That lesson has not been generalised to the other four jobs.

Fix: (a) size the scheduler pool explicitly (`spring.task.scheduling.pool.size: 4`); (b) adopt **ShedLock** (JDBC-backed, one table, no new infrastructure) for every cron job that is not provably idempotent; (c) keep idempotency in the service method regardless — ShedLock is a lock, not a guarantee.

### F4 (CRITICAL) — the outbox relay duplicates events per replica

`shared-lib/src/main/java/io/restaurantos/shared/event/OutboxRelay.java:36-50`:

```java
@Scheduled(fixedDelay = 1000)
@Transactional
public void relay() {
    List<OutboxEntry> pending = outboxRepository.findTop200ByStatusOrderByCreatedAtAsc("PENDING");
    for (OutboxEntry e : pending) {
        ...
        rabbitTemplate.send(e.getExchange(), e.getRoutingKey(), message);
        e.setStatus("SENT");
        e.setSentAt(Instant.now());
    }
}
```

There is **no row locking**. `findTop200ByStatusOrderByCreatedAtAsc` is a plain `SELECT`. Two replicas polling on the same 1 s cadence read the same 200 rows and both call `rabbitTemplate.send` on all of them *before* either commits its `status='SENT'` update. The sends have already happened by the time the row lock serialises the writes.

The class doc says "At-least-once delivery". At N replicas it is **N-times-per-poll delivery** — and since the relay is in `shared-lib`, this applies to all 16 services simultaneously. Downstream consumers do have a `processed_events` table (`services/pos-service/src/main/resources/db/migration/V2__pos_infra_tables.sql:37-44`) keyed `(consumer, event_id)`, so idempotent consumers would absorb it — but that shifts a correctness guarantee onto every consumer being correct, and multiplies Rabbit load by N.

Fix: `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 200`. That is the standard outbox pattern and makes the relay horizontally scalable rather than merely survivable:
```java
@Query(value = "SELECT * FROM event_outbox WHERE status = 'PENDING' "
             + "ORDER BY created_at ASC LIMIT 200 FOR UPDATE SKIP LOCKED",
       nativeQuery = true)
List<OutboxEntry> claimPending();
```

### F5 (HIGH) — synchronous network I/O inside `@Transactional`

The same method holds a JDBC connection across up to **200 sequential `rabbitTemplate.send()` calls**. This is precisely the "`@Transactional` method making a synchronous outbound call while holding a connection" pattern the brief asked me to look for — it is AMQP rather than Feign, which is why a Feign-focused search misses it. With a default pool of 10 and Rabbit responding slowly, one relay tick can hold a connection for seconds while `scheduling-1` is blocked.

Fix: claim rows in a short transaction, publish outside it, mark sent in a second short transaction. Or use publisher confirms with a bounded batch.

### 2.2 Other blocking-call-in-transaction sites

I checked whether the classic HTTP-in-transaction pattern exists on the request path. `FeatureFlagAspect` → `RedisFeatureFlagService.isEnabled` → `PlatformAdminFeatureResolver.enabledFeatures` performs a synchronous, **timeout-free** HTTP GET to platform-admin (`shared-lib/.../PlatformAdminFeatureResolver.java:35-38`). Whether that lands inside an open transaction depends on whether the `@RequiresFeature` aspect runs inside or outside `@Transactional` — aspect ordering is not configured, so **UNVERIFIED**. It is unbounded either way, which is the more important point: a slow platform-admin stalls every feature-gated endpoint in all 13 services that configure `restaurantos.platform-admin.uri`.

`RedisFeatureFlagService` does handle failure sensibly — it denies without caching the failure (`shared-lib/.../RedisFeatureFlagService.java:70-76`), and the comment explains why. That is good; the missing piece is only the timeout.

## 2.3 Stateless-ness that *is* correct

Credit where due, verified:
- `SessionCreationPolicy.STATELESS` in every security config — no sticky sessions needed.
- `spring.jpa.open-in-view: false` in all four services I read — connections are not held for view rendering.
- Gateway rate limiting is Redis-backed (`RequestRateLimiter` with `redis-rate-limiter.*`, `gateway/src/main/resources/application.yml:50-53, 80-83, 179-182, 353-372`), so limits are fleet-wide rather than per-replica.
- `TenantAwareDataSource` resets both GUCs on `close()` before the connection returns to the pool (`TenantAwareDataSource.java:114-127`), with a documented rationale for why they are session-scoped rather than transaction-local. This is correct and load-bearing for RLS under pooling.

---

# PART 3 — Database

## 3.1 Connection budget

**F12.** `grep -rn -i "hikari|maximum-pool-size|connection-timeout|leak-detection"` across all `*.yml`/`*.java` (excluding `target/`) returns exactly **two hits, both comments** in `deploy/docker-compose.yml:36`. There is no Hikari configuration in any of the 16 services.

Every service therefore runs the HikariCP defaults: `maximumPoolSize=10`, `minimumIdle=10`, `connectionTimeout=30000`, `maxLifetime=1800000`, `leakDetectionThreshold=0` (off).

Budget at one replica each:

| | Connections |
|---|---|
| 16 services × 10 | 160 |
| Postgres `max_connections` (`deploy/docker-compose.yml:37`) | 300 |
| Headroom | 140 |

At **two** replicas: 320 > 300 — the fleet cannot scale to 2× without exhausting Postgres. At three: 480. The compose comment already documents that the default 100 broke at ~12 services; the 300 ceiling buys exactly one replica each and no more.

Also note `minimumIdle` defaults to `maximumPoolSize`, so all 160 connections are opened eagerly at startup and held idle forever, whether or not there is traffic.

**Recommendations:**
1. Set `maximum-pool-size` per service by actual concurrency, not uniformly. Most of these services are low-traffic (audit, file, nlq, notification): pool 4. Hot paths (pos, auth, user, reporting): pool 15–20.
2. Set `minimum-idle` well below max (2–4) so idle replicas do not hoard.
3. **Introduce PgBouncer in `transaction` pooling mode.** This is the single change that makes N replicas viable — it decouples app-side pool count from server-side backend count. One caveat that matters here specifically: **transaction-mode pooling is incompatible with session-scoped GUCs.** `TenantAwareDataSource` deliberately uses `set_config(..., false)` (session scope) with a documented reason — the GUC must survive the `BEGIN` Spring issues after checkout (`TenantAwareDataSource.java:20-34`). Under PgBouncer transaction mode, a session GUC set before `BEGIN` is not guaranteed to be on the same backend. **This needs design work before PgBouncer can be adopted**; the likely resolution is to set the GUC as the first statement *inside* the transaction rather than at checkout. Flagging it because adopting PgBouncer naively would silently break tenant isolation — exactly the failure class this project keeps hitting.
4. Raise `max_connections` only as a stopgap; each Postgres backend costs ~5–10 MB.

## 3.2 Read replicas

Per-service databases mean routing must be per service. Highest value, in order:

1. **reporting-service** — pure read aggregation feeding dashboards, plus a `fixedDelay=1000` tile refresh (`DashboardTileService.java:107`) hammering the primary every second per replica. Best candidate by a wide margin.
2. **nlq-service** — natural-language query; already has a ClickHouse path (`deploy/clickhouse/`), so analytical load may already be diverted. **UNVERIFIED** how much still hits Postgres.
3. **audit-service** — append-heavy writes, read-only queries; reads to a replica.
4. **pos-service menu reads** — `menu_items`, `menu_categories`, `modifiers` are read-mostly reference data, but they are read in the same request as order writes, so replica lag would show as a stale menu. Prefer caching (§4) over a replica here.

**Do not** put finance-service or pos-service order/payment paths on a replica: read-your-writes matters and replica lag would surface as "I just paid and it says unpaid".

Implementation note: with RLS keyed on `current_setting('app.current_tenant_id')`, a replica route must go through the same `TenantAwareDataSource` wrapper or RLS fails **open or closed unpredictably**. Any `@Transactional(readOnly=true)`-based routing DataSource must be installed *underneath* `TenantAwareDataSourcePostProcessor`, not beside it — the post-processor wraps whatever `DataSource` bean it finds (`TenantAwareDataSourcePostProcessor.java:26-28`), so ordering must be asserted by a test, not assumed.

## 3.3 Tenant isolation gaps found while looking at pooling

Not my primary scope but directly load-bearing for "must not leak across tenants":

**F11 (HIGH).** `idempotency_keys` is `PRIMARY KEY (idem_key)` with **no tenant column** and is explicitly non-RLS (`services/pos-service/src/main/resources/db/migration/V2__pos_infra_tables.sql:2, 24-31`). `DefaultIdempotencyService` looks up by bare key (`repository.findById(key)`, `shared-lib/.../DefaultIdempotencyService.java:24, 47, 57`). So for two tenants using the same `Idempotency-Key` value:
- Different request hashes → tenant B gets `IdempotencyConflictException` (409) caused by tenant A. Cross-tenant denial of service.
- Same hash → `checkAndLock` returns `false` and the caller serves the cached response. Callers that do exactly this include `services/pos-service/.../OrderServiceImpl.java:416-420` and `:640-649`, `services/hr-service/.../PayrollRunController.java:106-110`, `services/platform-admin-service/.../ProvisioningService.java:165-170`. **Tenant A's response body can be returned to tenant B.**

Fix: make the key `(tenant_id, idem_key)` and add the tenant to the lookup. Low effort, high severity.

**Uneven RLS coverage.** `FORCE ROW LEVEL SECURITY` occurrence counts by service: auth 26, inventory 33, hr 15, finance 14, crm 6, user 2, file 2, **pos 1**, reporting 1, nlq 1, and **zero** in purchasing, kitchen, authorization, audit, platform-admin. pos-service uses `ENABLE ROW LEVEL SECURITY` on its tables (`V1__pos_schema.sql:26`, `V3__pos_tills_payments.sql:28,56,76`) — but `ENABLE` without `FORCE` **does not apply to the table owner**. If migrations create tables as `pos_user` and the app connects as `pos_user`, RLS is bypassed entirely for every pos table. I did not confirm table ownership at runtime — **UNVERIFIED**, and it is the single highest-value thing to check next. Task #7 ("Close the Testcontainers superuser blind spot for RLS") suggests the test harness cannot currently catch this.

---

# PART 4 — Caching

## 4.1 What exists

| Cache | Where | Invalidation |
|---|---|---|
| Feature flags | Redis, `feature:{tenantId}:{code}`, 300 s TTL (`RedisFeatureFlagService.java:45,62-67`) | **TTL only** |
| JWKS public keys | In-process `ConcurrentHashMap`, 3600 s TTL (`JwksKeyProvider.java:22-24`) | TTL only |
| Dashboard tile context | In-process `ConcurrentHashMap<UUID, BranchContext>` (`DashboardTileService.java:58`) | none |
| Tile push throttle | In-process `ConcurrentHashMap` + `newKeySet()` (`reporting/ws/TilePushThrottle.java:32-33`) | none |

There is **no Spring `@Cacheable` usage anywhere** and no `CacheManager` bean — `grep -rn "@Cacheable|Caffeine|CacheManager"` returns nothing outside the raw maps above. So there is no general-purpose caching layer; every read hits Postgres.

## 4.2 Problems

**Feature flags invalidate only by TTL.** platform-admin owns `tenant_features` and the gateway enforces per-tenant flags. When a SuperAdmin toggles a feature or changes a tier, up to **300 seconds** pass before the 13 services honouring `restaurantos.platform-admin.uri` notice — and each service caches independently, so they flip at different moments. During that window the gateway and the service can disagree: the gateway admits a request its target service then 403s. For a billing-adjacent control (tier upgrade → feature on) that is a visible product defect, not just staleness.

Fix: publish a `TENANT_FEATURES_CHANGED` event from platform-admin through the existing outbox/Rabbit bus; each service evicts `feature:{tenantId}:*` on receipt. Keep the TTL as a backstop. This is cheap — the bus and the outbox already exist.

**The per-tenant key pattern is right but the eviction primitive is missing.** Keys are `feature:{tenantId}:{featureCode}` — correctly tenant-scoped, no leak. But there is no way to evict a whole tenant without `SCAN`, which is why event-driven eviction needs a Redis SET of known codes per tenant, or a per-tenant version counter folded into the key (`feature:{tenantId}:v{n}:{code}`) so a version bump invalidates everything atomically. The version-counter approach is preferable: O(1), no SCAN, no key enumeration.

**`TilePushThrottle` is per-replica.** With N replicas, a throttle intended to cap dashboard pushes at one per interval permits N per interval. Move to a Redis `SET key val NX PX interval`.

**JWKS caching is fine in principle** (public keys, long TTL, per-process is acceptable) — the defect is the blocking refresh (F2), not the cache.

## 4.3 What to add

Given per-service Postgres and heavy read amplification on reference data, the highest-value additions are:
1. Menu/catalogue read cache in pos-service (`menu_items`, `menu_categories`, `modifiers`, `branch_menu_overrides`) — keyed `{tenantId}:{branchId}`, evicted on the menu-changed event.
2. Permission/role resolution cache in authorization-service, if OPA is queried per request (`DefaultOpaClient` — and note its `RestClient` has **no timeout**, `SharedAutoConfiguration.java:165`).
3. **Rule:** every cache key must begin with `tenantId`, and no cache may be populated from a query executed without the tenant GUC set. A cache built on a relay/scheduler thread (no `TenantContext`) would be tenant-blind — `TenantAwareDataSource.configureTenant` returns the connection unmodified when the context is empty (`TenantAwareDataSource.java:63-66`).

---

# PART 5 — Observability

## 5.1 F8 (CRITICAL) — there are no metrics

Every service exposes `management.endpoints.web.exposure.include: health,prometheus`. I tested it:

```
port 8084 /actuator/prometheus -> 404  bytes=105
port 8082 /actuator/prometheus -> 404  bytes=105
port 8096 /actuator/prometheus -> 404  bytes=105
```

`micrometer-registry-prometheus` is not on the classpath — `grep -rn "micrometer|tracing|zipkin|opentelemetry|logstash"` across the root `pom.xml` and all module POMs returns **only** `logstash-logback-encoder` in `shared-lib/pom.xml:112-113`.

This is the project's signature failure mode again: configuration that is structurally present, reviewed, and completely dead. There is no request rate, no error rate, no latency histogram, no `hikaricp_connections_pending`, no `tomcat_threads_busy`, no JVM heap or GC metric — for any service. **A production incident today would be debugged with `tail` on a 400 MB text file.**

Note the direct link to Part 1: `hikaricp_connections_pending` and `tomcat_threads_busy` are exactly the two series that would have diagnosed the wedge in seconds and distinguished the two mechanisms.

Fix: add `micrometer-registry-prometheus` to the parent POM's `<dependencies>` so all modules inherit it, and add a CI smoke assertion that `/actuator/prometheus` returns 200 with a non-zero body. The 404 above should have been a test.

## 5.2 F9 (HIGH) — no distributed tracing

No `micrometer-tracing`, no Brave, no OpenTelemetry, no Zipkin. With 16 services, a gateway, RabbitMQ, and a synchronous Feign/RestClient mesh, there is no way to answer "where did this 4-second request spend its time".

`JwtAuthenticationFilter` does propagate a correlation id: it reads `X-Request-Id` and falls back to a random UUID (`JwtAuthenticationFilter.java:80-81`). But it only puts it in MDC — it does not forward it on outbound calls, so the id does not survive a hop. `ApiError` carries a `traceId` field (`shared-lib/.../api/ApiError.java:7-13`) populated from MDC (`GlobalExceptionHandler.java:31`), so errors returned to clients contain an id that **appears in no log line** (§5.3) and correlates with nothing.

Fix: `spring-boot-starter-actuator` + `micrometer-tracing-bridge-otel` + `opentelemetry-exporter-otlp`; propagate W3C `traceparent`; instrument the Rabbit producer/consumer so async hops join the trace. Until then, at minimum forward `X-Request-Id` on every outbound `RestClient`/Feign call via an interceptor.

## 5.3 F10 (HIGH) — MDC is populated but never printed

`JwtAuthenticationFilter` writes `tenantId` and `traceId` into MDC (lines 79-81). There is **no `logback-spring.xml` anywhere** in the repo (`find . -name "logback*.xml"` excluding `target/` returns nothing), so Spring Boot's default console pattern applies — and it does not include MDC. Confirmed against a real log:

```
$ grep -a -c "tenantId" .dev-logs/auth-service.log
0
```

Zero occurrences in 434 KB of log. `logstash-logback-encoder` is declared in `shared-lib/pom.xml` and never used. So the tenant id and trace id are computed on every request and discarded.

Fix: add `logback-spring.xml` to `shared-lib/src/main/resources` emitting JSON via the encoder already on the classpath, including `tenantId`, `traceId`, `userId`, `service`, `level`, `logger`. This is a ~20-line file that turns the existing MDC work from dead into load-bearing.

## 5.4 Log volume and retention

`.dev-logs/` holds 4.7 GB across 21 files — `pos-service.log` 412 MB, `audit-service.log` 292 MB, `finance-service.log` 258 MB, `purchasing-service.log` 258 MB, `platform-admin-service.log` 255 MB, `user-service.log` 254 MB, `gateway.log` 159 MB. `pos-service.log` alone has 2,958,061 lines.

Much of it is one repeated failure — 32,164 occurrences of `Connection is not available, request timed out after 30002ms (total=0, active=0, idle=0, waiting=0)` in each of pos, user, finance, purchasing, and platform-admin. `total=0, active=0, idle=0` means Hikari could not open a *single* connection: Postgres was down or unreachable, and `scheduling-1` retried every second for hours, logging a full stack trace each time.

Two lessons: (1) a dead dependency produces unbounded log growth because nothing rate-limits the relay's failure path; (2) the relay retries forever with no backoff. Add exponential backoff and log-once-per-window on the relay failure path, plus rotation with a size cap.

## 5.5 What a production incident needs, and does not have

| Capability | Status |
|---|---|
| Request rate / error rate / p99 latency per service | **Missing** (F8) |
| DB pool saturation (`hikaricp_connections_pending`) | **Missing** (F8) — would have diagnosed Part 1 |
| Thread pool saturation (`tomcat_threads_busy`) | **Missing** (F8) — would have diagnosed Part 1 |
| Distributed trace across gateway → service → Rabbit | **Missing** (F9) |
| Correlated, structured logs | **Missing** (F10) |
| Per-tenant metrics (noisy-neighbour attribution) | **Missing** |
| Outbox lag (pending rows, oldest pending age) | **Missing** — critical for a transactional outbox |
| Rabbit queue depth / DLQ depth | **Missing** |
| Health aggregate | **Present and honest** (§1.2) |
| Probe endpoints | **Present and dishonest** (F1) |

Outbox lag deserves emphasis: with F4 and F5 unfixed, the outbox is both the correctness bottleneck and completely unmonitored. A `pending` backlog is invisible until a user reports missing data.

---

# PART 6 — Deployment

## 6.1 F13 (CRITICAL) — nothing deploys the application tier

`deploy/docker-compose.yml` defines: `postgres`, `redis`, `rabbitmq`, `minio`, `opa`, `eureka`, `config-server`, `clickhouse`, `mailpit`, `pgadmin`. **None of the 16 application services appear in it.**

There are 21 Dockerfiles (one per service, plus frontend, gateway, eureka, config-server), so images can be built. But there is no compose entry, no Kubernetes manifest, no Helm chart, no kustomization — `find . -name "*.yaml" -path "*k8s*" -o -name "Chart.yaml" -o -name "kustomization*"` returns nothing.

So: the fleet currently runs only as 16 `java -jar` processes on a developer laptop, driven by `scripts/` and `.dev-pids.json`. **There is no deployment artifact for production at all.** Everything else in this section is downstream of that.

## 6.2 Dockerfile issues

Reading `services/pos-service/Dockerfile` (all 16 follow the same template):

- **F15 — runs as root.** No `USER` directive. `ENTRYPOINT ["java", "-jar", "/app/app.jar"]`.
- **No JVM container flags.** No `-XX:MaxRAMPercentage`. The JVM will default to 25% of container memory, wasting most of the limit, and there is no `-XX:+ExitOnOutOfMemoryError`, so an OOM leaves a zombie JVM that the (dishonest) liveness probe reports as healthy — F1 again.
- **No `HEALTHCHECK`.** `wget` is installed via `apt-get` specifically for a healthcheck that is not defined in the file and not defined in compose (the app services are not in compose at all).
- **Build inefficiency.** Every image copies all 19 module POMs and runs `mvn dependency:go-offline` for the whole reactor, then builds `-pl <service> -am`. Sixteen images each rebuild `shared-lib` from source. A shared base image with `shared-lib` pre-installed would cut build time and image count dramatically.
- `RUN mvn ... dependency:go-offline ... || true` — swallows failure, so a broken dependency resolution surfaces later as a confusing compile error.
- **No `.dockerignore`** observed at repo root — build context includes `.dev-logs/` (4.7 GB) unless excluded elsewhere. **UNVERIFIED** whether one exists per-module; worth checking, as it would make every build pathologically slow.

## 6.3 Secrets

Handled correctly for dev, and I want to be precise about this rather than reflexively critical. `.gitignore` excludes `deploy/.env`, `deploy/.pgpass`, `*.pem`, and `deploy/init/rabbitmq-definitions.json` (rendered from a committed template), with comments explaining why. `git ls-files` confirms none are tracked. `.seed-state/` is excluded because it holds server-minted TOTP secrets.

**What is missing for production:** every service resolves credentials from plain environment variables with insecure defaults baked into `application.yml` — `${DB_PASSWORD:auth_pass}`, `${RABBITMQ_PASSWORD:guest}`, `${INTERNAL_SERVICE_SECRET:dev-internal-secret}` (`services/auth-service/src/main/resources/application.yml:10, 31, 48`). A deployment that forgets to set `INTERNAL_SERVICE_SECRET` silently falls back to `dev-internal-secret` — and that secret is the **only** thing guarding every `/internal/**` endpoint across the fleet (`PosInternalServiceFilter.java:38-51`). That is a fail-open default on the highest-privilege API surface.

Recommendations:
1. **Remove every insecure default.** Use `${INTERNAL_SERVICE_SECRET}` with no fallback so the context fails to start rather than starting insecure. Fail-fast beats fail-open.
2. External secret store (Vault / AWS Secrets Manager / K8s Secrets + CSI) rather than env vars.
3. `JWT_PRIVATE_KEY` is base64 in an env var (`application.yml:82`) — move to a mounted secret and plan key rotation, which the JWKS `kid` mechanism already supports.

## 6.4 Migrations on startup

Both mechanisms run in-process at boot: Flyway in pos/finance/purchasing/kitchen/inventory/nlq/reporting (`spring.flyway.enabled: true`, e.g. `services/pos-service/src/main/resources/application.yml:21-24`) and Liquibase in auth/user/hr/crm/audit/file/platform-admin (`spring.liquibase.change-log`, e.g. `services/auth-service/.../application.yml:19-21`).

Consequences for a real rollout:
- **Scale-up races.** N replicas starting together all attempt migration. Flyway and Liquibase both take locks, so this is *usually* safe — but it serialises startup, and a pod killed mid-migration can leave a stuck `DATABASECHANGELOGLOCK` row that blocks every subsequent start until manually cleared. This is a well-known Liquibase failure mode and there is no automated recovery here.
- **No expand/contract discipline.** Rolling deploys require migrations that are backward-compatible with the previous version (add columns nullable, never rename/drop in the same release). `spring.jpa.hibernate.ddl-auto: validate` in most services means an old replica will **fail to start** against a newly-migrated schema — so a rollback after a breaking migration is impossible.
- **`deploy/pending-migrations/`** exists as a directory, which suggests manual migration steps outside the automated path. **UNVERIFIED** what governs it.

Recommendation: move migrations out of application startup into an explicit pre-deploy step (K8s Job / init container that runs once), set `spring.flyway.enabled=false` / `spring.liquibase.enabled=false` in the app, and enforce expand-contract in review.

## 6.5 F14 (HIGH) — zero-downtime is not possible today

`grep -rn "shutdown: graceful|timeout-per-shutdown|lifecycle"` across `services/` and `gateway/` returns **nothing**. Spring Boot defaults to immediate shutdown, so SIGTERM drops in-flight requests. Combined with:
- no readiness gate that actually de-registers before shutdown (F1),
- Eureka's registry propagation delay (30 s default heartbeat/refresh, `eureka.client.service-url` configured but no lease timing tuned),
- no `preStop` hook (no K8s manifests at all),

every deploy drops requests. Minimum fix:

```yaml
server:
  shutdown: graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```
plus a `preStop` sleep long enough for Eureka/Service endpoint propagation, and readiness flipped to `OUT_OF_SERVICE` before the JVM begins shutting down.

**Eureka in Kubernetes is itself questionable.** Client-side discovery duplicates what a K8s Service already provides, and its stale-registry behaviour (instances served for ~90 s after death) is a well-known source of exactly the "requests routed to a dead pod" symptom. Since the gateway already has Resilience4j circuit breakers, consider dropping Eureka in favour of K8s DNS on migration. Flagging as a decision, not a defect.

## 6.6 Deployment checklist — what is missing

| Requirement | Status |
|---|---|
| Deployment manifests for the 16 services | **Absent** (F13) |
| Health/readiness split that can fail | **Present but inert** (F1) |
| Secrets management beyond env vars | Absent; dev hygiene is good |
| No insecure secret defaults | **Absent** — fail-open `dev-internal-secret` |
| Migrations decoupled from startup | Absent |
| Graceful shutdown | **Absent** (F14) |
| Non-root containers | **Absent** (F15) |
| Resource requests/limits + JVM container flags | Absent |
| Horizontal Pod Autoscaler | Absent (needs metrics — F8) |
| Log aggregation | Absent (needs structured logs — F10) |
| PodDisruptionBudget / anti-affinity | Absent |

---

# PART 7 — Prioritised remediation

### P0 — before any production traffic
1. **F2** — timeouts on every `RestClient`; remove the `synchronized` refresh from the request path. *(~1 day)*
2. **F1** — readiness group that includes `db`; liveness that can detect thread starvation. *(~1 day)*
3. **F8** — add `micrometer-registry-prometheus`; CI assertion that `/actuator/prometheus` returns 200. *(~0.5 day)*
4. **F4** — `FOR UPDATE SKIP LOCKED` in the outbox relay. *(~0.5 day)*
5. **F13** — real deployment manifests for the 16 services. *(~3 days)*
6. **F11** — tenant-scope the idempotency key. *(~0.5 day)*
7. Remove fail-open secret defaults, `INTERNAL_SERVICE_SECRET` above all. *(~0.5 day)*
8. Verify pos-service RLS is `FORCE`, not just `ENABLE` (§3.3). *(~0.5 day)*

### P1 — before scaling past one replica per service
9. **F7** — Redis Pub/Sub fan-out for WebSocket pushes. *(~2 days)*
10. **F6** — ShedLock on non-idempotent crons; size the scheduler pool. *(~1 day)*
11. **F12** — Hikari sizing, `connection-timeout`, leak detection. *(~0.5 day)*
12. **F14** — graceful shutdown + preStop. *(~0.5 day)*
13. **F10** — `logback-spring.xml` with JSON + MDC. *(~0.5 day)*
14. **F5** — publish outside the transaction. *(~1 day)*

### P2 — operational maturity
15. **F9** — OpenTelemetry tracing. *(~2 days)*
16. Migrations as a pre-deploy job; expand/contract policy. *(~1 day)*
17. Event-driven feature-flag invalidation. *(~1 day)*
18. PgBouncer — after resolving the session-GUC conflict (§3.1). *(~2 days + design)*
19. **F15** — non-root containers, JVM container flags, shared base image. *(~1 day)*
20. Read replica for reporting-service. *(~2 days)*

---

# Appendix A — Verification log

**Verified by running against the live fleet:**
- `/actuator/health` aggregate on 8096 includes `db` (`validationQuery: isValid()`), `redis`, `rabbit`, `discoveryComposite` — all UP.
- `/actuator/health/liveness` and `/actuator/health/readiness` return bare `{"status":"UP"}` on 8096, 8084, 8082.
- `/actuator/prometheus` returns **404** on 8084, 8082, 8096.
- Nine services responding on 8081–8096; health 10–124 ms, bogus paths 401/403 in 2–46 ms.
- `grep -a -c "tenantId" .dev-logs/auth-service.log` → **0**.
- 32,164 `Connection is not available` lines in each of five service logs; sample shows `[scheduling-1]` and `total=0, active=0, idle=0, waiting=0`.

**Verified by reading source** (paths cited inline throughout): `JwksKeyProvider`, `JwtAuthenticationFilter`, `SharedAutoConfiguration`, `TenantAwareDataSource`, `TenantAwareDataSourcePostProcessor`, `TenantFilterInterceptor`, `OutboxRelay`, `RedisFeatureFlagService`, `PlatformAdminFeatureResolver`, `DefaultIdempotencyService`, the four affected services' security configs, `JwtSigningConfig`, `PosInternalServiceFilter`, `pos-service/Dockerfile`, `deploy/docker-compose.yml`, `deploy/nginx/nginx.conf`, `.gitignore`, root `pom.xml`, and all 16 `application.yml` files.

**Verified absent** (grep across `services/`, `gateway/`, `shared-lib/`, excluding `target/` and `.claude/worktrees/`): any Hikari configuration; any `spring.http.client.*`; any `server.tomcat.*`; any `server.shutdown: graceful`; any custom `HealthIndicator`; any `@Cacheable`/`CacheManager`; any micrometer/tracing/otel dependency; any `logback*.xml`; any K8s/Helm/kustomize manifest; any application service in `docker-compose.yml`.

# Appendix B — What I could NOT verify

1. **The mechanism that wedged auth-service.** The JWKS mechanism (F2) is structurally impossible there (§1.5). I have no verified explanation. Needs a thread dump taken *during* a live wedge, read for thread *states* (BLOCKED vs WAITING vs TIMED_WAITING), not CPU time.
2. **Whether the original thread dump showed genuinely wedged threads.** "Parking with ~0.04 ms CPU" is also the signature of idle Tomcat workers in `getTask()`. The raw artifact should be re-read before this detail is treated as established.
3. **Whether `FeatureFlagAspect` runs inside or outside `@Transactional`.** Aspect ordering is unconfigured; determines whether the timeout-free platform-admin call holds a DB connection.
4. **Whether pos-service tables are owner-bypassed for RLS.** `ENABLE` without `FORCE` plus `pos_user` ownership would disable RLS entirely. Requires `\d+` against a live database, or a test connecting as `pos_user` with no tenant GUC.
5. **Whether the gateway's Resilience4j default 1 s TimeLimiter actually bounds circuit-broken routes.** No `timeoutDuration` is configured; the framework default may or may not apply. Test with a deliberately stalled upstream.
6. **Idempotency of `ExpirySweepService` and `AuditArchivalService`** under concurrent replica execution.
7. **`deploy/pending-migrations/`** — purpose and whether it implies manual production steps.
8. **Presence of `.dockerignore`** files.
