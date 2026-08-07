# Testing Strategy — catching the bug class this project keeps shipping

**Written:** 2026-08-07
**Scope:** the defect class "green in tests, broken in reality" across ResturantOS
**Grounding rule for this document:** every claim about this repo cites a file I read; every
external claim cites a URL I fetched; every measurement was run on this machine and the command is
shown. Where I could not verify something it says so in the text.

---

## 0. Name the class before designing against it

The five shipped defects in the brief are not five unrelated bugs. They are five instances of one
class:

> **The test harness differs from the deployed environment along the exact axis the code depends
> on, so the check that would have failed is switched off before the assertion runs.**

The tests were not weak. They were *correct assertions against a different system*.

| # | Defect | The axis the harness differed on | Where the difference lives |
|---|---|---|---|
| 1 | ≥6 write/read paths never worked under RLS (incl. tenant provisioning) | **Database identity** — tests connect as a Postgres SUPERUSER, production connects as `NOSUPERUSER NOBYPASSRLS` | `services/*/src/test/**/…TestBase.java` vs `deploy/init/02-create-roles.sql:17-31` |
| 2 | hr-service could not start at all | **Schema validation** — tests set `ddl-auto=none`, production sets `validate` | `services/hr-service/src/test/java/io/restaurantos/hr/HrTestBase.java:57` (now fixed) vs `services/hr-service/src/main/resources/application.yml:14` |
| 3 | The whole platform API was unreachable | **Reachability** — tests asserted against service internals/hand-minted tokens, production goes through the gateway | `.planning/phases/13-platform-tenant-access-repair/13-01-SUMMARY.md` B1 table |
| 4 | Feign compensation path was dead code | **Transport** — the test never used the real `feign.Client`, or never used the real verb | `13-10-SUMMARY.md:131-149`, `13-12-SUMMARY.md:360-380` |
| 5 | An audit row could never be written | **Persistence identity** — the test stopped at the publisher, never at a persisted row | `13-14-SUMMARY.md:203-208`, `13-13-SUMMARY.md:110-135` |

Two structural consequences follow, and they shape everything below:

1. **Coverage percentage is orthogonal to this class.** `.github/workflows/ci.yml:133-160` enforces
   per-module line coverage from `.github/workflows/coverage-gates.json`. Every one of these five
   defects lived in *covered* lines. Raising the gate would have caught none of them. Do not
   respond to this class with more coverage.
2. **Every fix is a fidelity fix, not a test-count fix.** The deliverable of this strategy is
   mostly *changes to existing harnesses*, plus a small number of guard tests that make the fidelity
   itself un-regressable.

There is already a house pattern for the second kind — "closure tests" that scan the codebase and
fail on a structural gap rather than a behavioural one:
`services/auth-service/src/test/java/io/restaurantos/auth/PermissionCatalogClosureTest.java`,
`services/pos-service/src/test/java/io/restaurantos/pos/web/ControllerAuthorizationClosureTest.java`,
`services/platform-admin-service/src/test/java/io/restaurantos/platform/config/FeatureCodeClosureTest.java`,
`services/finance-service/src/test/java/io/restaurantos/finance/autopost/TopologyClosureTest.java`.
This strategy adds four more in the same idiom. That is deliberate — it is the pattern the team
already reads and maintains.

---

## 1. Make integration tests run as a NON-SUPERUSER so RLS is genuinely exercised

### 1.1 Why the current setup is inert — measured, not asserted

The official Postgres image documents that `POSTGRES_USER` "will create the specified user with
**superuser power** and a database with the same name"
(https://hub.docker.com/_/postgres). Testcontainers' `PostgreSQLContainer.withUsername(...)` sets
exactly that variable. So this, from
`services/auth-service/src/test/java/io/restaurantos/auth/integration/BaseIntegrationTest.java:33-37`:

```java
new PostgreSQLContainer<>(DockerImageName.parse("postgres:18"))
    .withDatabaseName("auth_db")
    .withUsername("auth_user")      // ← looks like production. Is a superuser.
    .withPassword("test-pass")
```

produces a role that *shares production's name and none of its constraints*. I verified this
directly:

```bash
docker run -d --rm -e POSTGRES_USER=auth_user -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=auth_db postgres:18
psql -U auth_user -d auth_db -Atc \
  "select rolname, rolsuper, rolbypassrls from pg_roles where rolcanlogin"
```
```
auth_user|t|t          ← the ONLY login role in the cluster. rolsuper AND rolbypassrls.
```

And with a table configured exactly per `docs/conventions/rls-convention.md` §1:

```
CREATE TABLE t (id int primary key, tenant_id uuid not null);
ALTER TABLE t ENABLE ROW LEVEL SECURITY;
ALTER TABLE t FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON t USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
INSERT INTO t VALUES (1, '…0001');                    → INSERT 0 1   (no GUC set)
SELECT count(*) FROM t;                                → 1           (no GUC set)
```

**Both the INSERT and the SELECT succeed with no tenant GUC at all.** There is no assertion any
integration test can write that will fail because of a missing or wrong tenant GUC. That is the
whole blind spot, in three lines.

A second consequence, which is worse and less obvious: because `POSTGRES_USER=auth_user` makes
`auth_user` the *bootstrap* superuser, **there is no `postgres` role in the cluster at all**. So the
harness cannot even model the production split between the superuser that owns
`deploy/init/*.sql`-created objects and the service role. That split is load-bearing —
`deploy/init/05-hr-fn-owner.sql` exists entirely because of it, and its own header comment already
names this exact test defect:

> "This is invisible to the integration suite: HrTestBase uses
> `PostgreSQLContainer.withUsername("hr_user")`, and Testcontainers makes `POSTGRES_USER` a
> SUPERUSER — so the tests exercise a role that FORCE RLS does not constrain."
> — `deploy/init/05-hr-fn-owner.sql:20-23`

The repo already knows. Nothing enforces it.

### 1.2 The pattern already exists in this repo and was never adopted

`shared-lib/src/test/resources/db/init-test-db.sql` does the right thing:

```sql
CREATE ROLE shared_test_user LOGIN PASSWORD 'test-pass' NOSUPERUSER NOBYPASSRLS;
GRANT ALL PRIVILEGES ON DATABASE shared_test_db TO shared_test_user;
GRANT USAGE, CREATE ON SCHEMA public TO shared_test_user;
```

wired via `withInitScript("db/init-test-db.sql")` in
`shared-lib/src/test/java/io/restaurantos/shared/integration/BaseIntegrationTest.java:30-32`.
So does `AbstractRlsCoverageTest`
(`shared-lib/src/test/java/io/restaurantos/shared/testsupport/AbstractRlsCoverageTest.java`), a
ready-made guard that fails when any `tenant_id`-bearing table lacks `FORCE ROW LEVEL SECURITY` and
a policy.

**Neither is used by a single service.** `AbstractRlsCoverageTest` has exactly one caller,
`shared-lib/src/test/java/io/restaurantos/shared/integration/SharedLibVerificationIT.java:141`, and
it is an anonymous subclass inside shared-lib's own test. The infrastructure was built and never
installed. Most of section 1 is adoption, not invention.

One caveat about the shared-lib version, which the service version must **not** copy: it points
`spring.liquibase.user` at the container superuser
(`shared-lib/.../BaseIntegrationTest.java:53-55`) while the app connects as `shared_test_user`. That
makes the *superuser* the table owner, so the app role is a plain non-owner and only
`ENABLE ROW LEVEL SECURITY` is being exercised — `FORCE` is never the thing doing the work.
Production is the opposite: Liquibase runs on the app datasource, so `auth_user` **owns** the tables
and `FORCE` is precisely what binds it (`13-02-SUMMARY.md:120-128` measured this on the live dev DB).
The service harness must run migrations as the app role.

### 1.3 The configuration

Add one class to `shared-lib`'s **test-jar** (see §1.6 for the packaging note) and one SQL resource
per service.

**`shared-lib/src/test/java/io/restaurantos/shared/testsupport/RlsPostgresContainer.java`**

```java
package io.restaurantos.shared.testsupport;

import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * A Postgres container whose APPLICATION role is NOSUPERUSER NOBYPASSRLS, mirroring
 * deploy/init/02-create-roles.sql, so FORCE ROW LEVEL SECURITY is actually enforced in tests.
 *
 * The container's own bootstrap user stays the default ("test"). That is deliberate and load-bearing:
 *   - POSTGRES_USER is created WITH SUPERUSER POWER (https://hub.docker.com/_/postgres), so naming
 *     it "auth_user" produces a superuser called auth_user, not a service role. Measured:
 *     rolsuper=t, rolbypassrls=t.
 *   - If POSTGRES_USER is the service role, it is the ONLY superuser in the cluster and cannot be
 *     demoted (a role cannot revoke its own superuser bit with no other superuser present), so the
 *     "just ALTER ROLE it afterwards" shortcut does not exist.
 *   - Keeping a separate bootstrap superuser also reproduces production's ownership split, which
 *     deploy/init/04-auth-refresh-lookup-owner.sql and 05-hr-fn-owner.sql depend on.
 *
 * The app role OWNS the schema, because migrations run on the app datasource in production
 * (services/hr-service/src/main/resources/application.yml has no separate spring.liquibase.user).
 * FORCE ROW LEVEL SECURITY is what binds an owner; a non-owner would pass on ENABLE alone and the
 * harness would still be lying, just less.
 */
public final class RlsPostgresContainer {

    private RlsPostgresContainer() {}

    /**
     * @param image        e.g. "postgres:18"
     * @param databaseName e.g. "auth_db"
     * @param appRole      the production service role name, e.g. "auth_user"
     * @param initScript   classpath path to the role-bootstrap SQL, e.g. "db/testcontainers-roles.sql"
     */
    public static PostgreSQLContainer<?> create(
            String image, String databaseName, String appRole, String initScript) {
        return new PostgreSQLContainer<>(DockerImageName.parse(image))
                .withDatabaseName(databaseName)
                // Bootstrap superuser — NOT the app role. Defaults kept explicit for readability.
                .withUsername("tc_bootstrap")
                .withPassword("tc_bootstrap")
                // Runs after container start, over JDBC, as the bootstrap superuser.
                .withInitScript(initScript);
    }

    /** JDBC URL for the app role. Same database, different principal. */
    public static String appJdbcUrl(PostgreSQLContainer<?> c) {
        String url = c.getJdbcUrl();
        return url + (url.contains("?") ? "&" : "?") + "sslmode=disable&tcpKeepAlive=true";
    }
}
```

**`services/auth-service/src/test/resources/db/testcontainers-roles.sql`** (one per service, three
lines differ)

```sql
-- Mirrors deploy/init/02-create-roles.sql + 03-grant-schema-privileges.sql for ONE database.
--
-- NOTE: Testcontainers' withInitScript executes this over a JDBC connection, not through psql.
-- Write plain SQL only — the \c and \set meta-commands used in deploy/init/*.sql are psql
-- features and will not work here. That is why this is a separate file and not a symlink.
CREATE ROLE auth_user LOGIN PASSWORD 'test-pass' NOSUPERUSER NOBYPASSRLS;

GRANT ALL PRIVILEGES ON DATABASE auth_db TO auth_user;
GRANT ALL    ON SCHEMA public TO auth_user;
GRANT CREATE ON SCHEMA public TO auth_user;   -- PG15+ revokes CREATE on public from PUBLIC
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO auth_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO auth_user;

-- Services with a second, narrower runtime role model it here too, or the least-privilege
-- posture is untested. audit-service's audit_writer is INSERT-only
-- (deploy/init/02-create-roles.sql:36-37, 03-grant-schema-privileges.sql:75-77):
-- CREATE ROLE audit_writer LOGIN PASSWORD 'test-pass' NOSUPERUSER NOBYPASSRLS;
-- GRANT USAGE ON SCHEMA public TO audit_writer;
```

**Base-class change** (shown for `auth-service`; identical shape in every service base):

```java
static final PostgreSQLContainer<?> POSTGRES = RlsPostgresContainer.create(
        "postgres:18", "auth_db", "auth_user", "db/testcontainers-roles.sql");

@DynamicPropertySource
static void props(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url",      () -> RlsPostgresContainer.appJdbcUrl(POSTGRES));
    r.add("spring.datasource.username", () -> "auth_user");   // NOT POSTGRES::getUsername
    r.add("spring.datasource.password", () -> "test-pass");
    // Do NOT set spring.liquibase.user / spring.flyway.user. Migrations must run on the app
    // datasource so the app role OWNS the tables, exactly as in production. Overriding them to the
    // bootstrap superuser is the single easiest way to silently re-open this hole.
    r.add("spring.jpa.hibernate.ddl-auto", () -> "validate");  // see §2
    r.add("server.address",               () -> "127.0.0.1"); // keep — DEV-STACK-RUNBOOK.md
    …
}
```

### 1.4 Proof the configuration does what it claims — end to end, measured

I ran the exact recommended shape against `postgres:18`:

```
step 1 — init script, post-start, as the bootstrap superuser
  auth_user  super=false  bypassrls=false
  test       super=true   bypassrls=true

step 2 — migrations AS auth_user (CREATE TABLE / ENABLE / FORCE / CREATE POLICY)   → OK

step 3 — the application, AS auth_user
  INSERT with no tenant GUC        → ERROR: new row violates row-level security policy for table "users"
  INSERT with the correct GUC      → INSERT 0 1
  SELECT with the correct GUC      → 1 row
  SELECT under a DIFFERENT tenant  → 0 rows
```

Compare with §1.1's superuser run, same DDL: insert succeeded, select returned the row, no GUC
anywhere. The container config is the entire difference.

### 1.5 The bonus checks this unlocks — and they matter more than the RLS assertions

Once the app role is genuinely constrained, three defect families that are *currently untestable*
become ordinary test failures:

**(a) The `SECURITY DEFINER` owner trap.** Measured on the same container:

```
SECURITY DEFINER function owned by the app role (NOSUPERUSER)  → 0
same function, owned by the superuser                          → 1
```

This is precisely the live-database finding in `13-08-SUMMARY.md:267-273`
(`auth_lookup_refresh_tenant` owner=`postgres` bypassrls=true vs
`auth_lookup_password_token_tenant` owner=`auth_user` bypassrls=false) and the reason
`deploy/init/04-auth-refresh-lookup-owner.sql`, `deploy/init/05-hr-fn-owner.sql` and
`deploy/scripts/verify-security-definer-owners.sh` exist. That shell script's own header says it
checks *behaviour, not ownership*, "because a future function that is owned correctly but declared
SECURITY INVOKER by mistake would pass an ownership check and fail this." **Port that probe into the
IT suite**: for each `SECURITY DEFINER` function, call it as the app role and assert it returns rows.
Under the current superuser harness that assertion is vacuous; under this one it is real.

**(b) GRANT drift.** `docs/conventions/rls-convention.md` §1 mandates
`GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO <svc>_user` in every RLS changeset. A superuser
needs no grants, so a forgotten `GRANT` is invisible today and is a hard failure in production. With
a non-owner-privilege-checked role it fails in the IT.

**(c) The `tenant_id` predicate that must be in the query too.** `13-07-SUMMARY.md:186-194` and
`13-12-SUMMARY.md:162-165` both record the same reasoning: isolation is enforced in the SQL *as well
as* the policy, because the policy is inert under Testcontainers. Once the policy is live, a test can
distinguish "the query filters" from "the policy filters" by toggling the GUC — which is the only way
to know whether the belt or the braces is actually holding the trousers up.

### 1.6 Packaging, rollout, and the honest cost

- **Packaging.** `RlsPostgresContainer` and `AbstractRlsCoverageTest` live in `shared-lib/src/test`,
  which is not on any service's test classpath today. Either wire `maven-jar-plugin`'s `test-jar`
  goal in `shared-lib/pom.xml` and add a `<type>test-jar</type><scope>test</scope>` dependency in
  each service, or move the two classes to `shared-lib/src/main/java/.../testsupport` with
  `testcontainers`/`junit-jupiter` at `provided` scope. **I did not verify which of these the build
  currently supports** — `shared-lib/pom.xml` was not inspected for a `test-jar` execution. Settle it
  before planning, it changes every service's POM diff.
- **This will turn suites red, and that is the deliverable.** `13-06`, `13-08`, `13-09`, `13-11`
  and `13-12` each fixed *production* code that had never once run under RLS. Their tests still
  do not cover it. Expect failures concentrated in: writes with no GUC set, GUC set on a different
  connection than the statement (`13-11-SUMMARY.md:203` — "GUC first … so the GUC and the statements
  share one connection"), and missing `GRANT`s. Triage rule: **a test failure here is a production
  bug until proven otherwise.** The forbidden repair is widening the role.
- **Rollout order** (highest defect density first, from the phase-13 record):
  `auth-service` → `user-service` → `platform-admin-service` → `hr-service` → `finance-service` →
  `inventory-service` → `pos-service` → `purchasing-service` → `crm-service` → `kitchen-service` →
  `file-service` → `reporting-service` → `nlq-service` → `audit-service`.
- **Adopt `AbstractRlsCoverageTest` in every service in the same commit as that service's container
  change.** 101 `FORCE ROW LEVEL SECURITY` statements exist across 57 distinct tables in
  `services/*/src/main/resources/db/**`; the guard is what keeps table #58 from shipping without one.
- **`file-service` has no `src/test` directory at all** yet deploys with `ddl-auto: validate`
  (`services/file-service/src/main/resources/application.yml:14`) and has an RLS changeset
  (`db/changelog/v1.0.0/011-enable-rls-file-metadata.xml`). It needs an IT base class before it can
  adopt any of this.

### 1.7 The negative control — non-negotiable

`scripts/DEV-STACK-RUNBOOK.md:106-122` establishes the house standard: a gate is not trusted until
it has been *seen to fail*. Do the same here. Add one test, permanently, per service:

```java
/**
 * NEGATIVE CONTROL. If this test ever passes, the harness has silently become a superuser again
 * and every RLS assertion in this module is vacuous. Do not delete it; do not "fix" it by
 * widening the role.
 */
@Test
void theApplicationRoleIsNotASuperuserAndCannotBypassRls() {
    Object[] r = (Object[]) em.createNativeQuery(
        "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user").getSingleResult();
    assertThat(r[0]).as("current_user is a SUPERUSER — RLS is inert").isEqualTo(false);
    assertThat(r[1]).as("current_user has BYPASSRLS — RLS is inert").isEqualTo(false);
}

@Test
void aWriteWithNoTenantGucIsRejected() {   // the assertion that was impossible before
    clearTenantGuc();
    assertThatThrownBy(() -> repo.saveAndFlush(aRow()))
        .hasMessageContaining("row-level security policy");
}
```

---

## 2. Assert JPA-to-schema agreement everywhere

### 2.1 Current state

| Setting | Count | Where |
|---|---|---|
| `ddl-auto: validate` in **main** config | 13 modules | audit, crm, file, finance, hr, inventory, kitchen, nlq, platform-admin, pos, purchasing, reporting, user |
| `ddl-auto: none` in **main** config | 2 modules | `services/auth-service/src/main/resources/application.yml:14`, `services/authorization-service/src/main/resources/application.yml:16` |
| `ddl-auto` forced to `none` in **test** config | 22 sites across 13 modules (incl. shared-lib) | listed below |
| `ddl-auto` forced to `validate` in **test** config | **1 site** | `services/hr-service/src/test/java/io/restaurantos/hr/HrTestBase.java:57` |

The 22 test-side overrides to `none`: `services/audit-service/.../AuditConsumerIT.java:77`,
`AuditImmutabilityIT.java:62`; `services/auth-service/.../integration/BaseIntegrationTest.java:92`;
`services/authorization-service/.../integration/BaseIntegrationTest.java:126`,
`OpaTimeoutFailClosedIT.java:68`; `services/crm-service/.../CrmLoyaltyIT.java:60`,
`PromotionEngineIT.java:42`; `services/finance-service/.../FinanceTestBase.java:54`,
`autopost/AutoPostingITBase.java:44`; `services/inventory-service/.../InventoryTestBase.java:75`;
`services/kitchen-service/.../KitchenTestBase.java:50`;
`services/nlq-service/.../NlqServiceIT.java:165`;
`services/platform-admin-service/.../BasePlatformIT.java:127` and
`src/test/resources/application-test.yml:16`; `services/pos-service/.../PosTestBase.java:63`;
`services/purchasing-service/.../PurchasingTestBase.java:47`;
`services/reporting-service/.../EtlPipelineIT.java:147`, `FbrTaxSummaryIT.java:257`,
`ReportServiceIT.java:237`, `ws/DashboardPushIT.java:161`;
`services/user-service/.../BaseUserIT.java:89` and `src/test/resources/application-test.yml:7`;
`shared-lib/.../integration/BaseIntegrationTest.java:57` and
`src/test/resources/application.properties:4`.

**Eleven modules currently deploy with `validate` and test with `none`** — audit, crm, finance,
inventory, kitchen, nlq, platform-admin, pos, purchasing, reporting, user. (A twelfth,
`file-service`, deploys `validate` and has **no `src/test` directory at all**.) Every one of them can
ship hr-service's exact defect. The hr-service comment already spells out the mechanism and the cost
(`HrTestBase.java:44-56`, and the entity side at
`services/hr-service/src/main/java/io/restaurantos/hr/entity/TaxConfigEntity.java:52-54`:
`NUMERIC(6,3)` in the changelog vs `double`/`float8` in the entity).

### 2.2 The rule

> **A test's `spring.jpa.hibernate.ddl-auto` must equal its module's deployed value. `none` is
> permitted only where the module deploys with `none`, and only with a comment naming why.**

Do not phrase it as "always validate" — auth-service and authorization-service genuinely deploy with
`none`, and a blanket rule would push someone to change *production* config to satisfy a test. Those
two should move to `validate` in main config as a separate, deliberate change (they are the two
modules with the densest RLS/entity surface in the system, so the drift risk is highest there), but
that is a decision, not a test-strategy edict.

### 2.3 Enforcement — a closure test, not a convention

A convention in `docs/` did not stop 22 overrides. Add a build-level guard in the same idiom as the
existing `*ClosureTest` family:

**`shared-lib/src/test/java/io/restaurantos/shared/testsupport/DdlAutoParityClosureTest.java`** (or a
`lint`-job Python step — see §6; either is fine, but exactly one must exist)

```
For each module M under services/ and the reactor root:
  deployed := ddl-auto in M/src/main/resources/application*.yml   (default: Spring's own default)
  for each occurrence O of `spring.jpa.hibernate.ddl-auto` under M/src/test/**:
      FAIL unless value(O) == deployed
        OR the line is preceded by a `// DDL-AUTO-PARITY-EXEMPT: <reason>` comment
FAIL if any module under services/ has a Spring Boot IT base class that sets NO ddl-auto at all
  and whose deployed value is `validate` (silent inheritance is fine, but be explicit — the point
  is that a reader can see the parity without cross-referencing two files).
```

The exemption marker is required, greppable, and reviewable. `HrTestBase.java:44-56` is the model for
what an acceptable comment looks like: it names the concrete defect the setting prevented.

### 2.4 What `validate` does and does not catch

Be honest about the ceiling, or the gate will be over-trusted:

- **Catches:** missing table, missing column, wrong SQL type (the `NUMERIC(6,3)` vs `float8` case),
  wrong nullability in the direction Hibernate checks.
- **Does not catch:** a column present in the schema that no entity maps; check constraints;
  defaults; index presence; the RLS posture (that is §1's `AbstractRlsCoverageTest`); trigger and
  function correctness (that is §1.5(a)).
- **Requires** that the IT boots a real Spring context against a real migrated database. A
  `@DataJpaTest` with an in-memory replacement proves nothing here. Every service's IT base already
  runs its real Liquibase/Flyway against Testcontainers, so this is free — it is one property.

### 2.5 The companion guard: "the service can actually start"

`validate` catches mapping drift. It does not catch the *other* half of hr-service's Phase-11 story:
a duplicate `@EnableJpaAuditing` on `HrServiceApplication` that failed every context load with
`BeanDefinitionOverrideException: 'jpaAuditingHandler'` (`scripts/DEV-STACK-RUNBOOK.md:534-545`).
That runbook section ends with the operational tell:

> "a suite that errors during context load still reports `Tests run: N` — with `Errors: N` beside it."

So add, per service, one trivially small IT that does nothing but load the full application context
with the deployed profile, **and** make CI fail on failsafe *errors*, not only failures (§6).

---

## 3. Contract tests for Feign clients — unsendable verbs and shape drift

### 3.1 The two distinct failure modes

**(a) Unsendable verb.** `feign.Client.Default` is built on `HttpURLConnection`, whose method
allow-list is fixed (GET, POST, HEAD, OPTIONS, PUT, DELETE, TRACE) and has never included PATCH; it
throws before a byte reaches the network. Confirmed externally
(https://github.com/OpenFeign/feign/issues/1171,
https://github.com/spring-cloud/spring-cloud-openfeign/issues/366,
https://www.baeldung.com/openfeign-http-patch-request) and observed twice in this repo:
`13-10-SUMMARY.md:131-149` (the tenant-status compensation in platform-admin-service:
`RetryableException: Invalid HTTP method: PATCH`) and `13-12-SUMMARY.md:360-380` (user-service's
profile update). Both were fixed with a hand-rolled `feign.Client` over `java.net.http.HttpClient`
rather than adding `feign-hc5`/`feign-okhttp`:
`services/platform-admin-service/src/main/java/io/restaurantos/platform/client/FeignSharedConfig.java`
and `services/user-service/src/main/java/io/restaurantos/user/client/JdkHttpFeignClient.java`.

Critically, **both fixes are scoped to a single `configuration = …` class**
(`13-12-SUMMARY.md:145-149` explains why: a global `@Bean feign.Client` would silently replace the
client of any Feign interface added later). That scoping is correct and it is also a trap: main
source declares **19 `@FeignClient` interfaces across 8 services** (file, finance ×3, inventory,
platform-admin ×3, pos ×3, purchasing ×6, reporting, user), and a PATCH-capable transport exists in
only **two** of those eight — platform-admin (`FeignSharedConfig`) and user-service
(`FeignInternalConfig` / `JdkHttpFeignClient`). The next PATCH added anywhere in the other six
services reproduces the bug exactly.

**(b) Shape drift.** `extractBranchId` parsed `{"data":{"id"}}` while the producer returned a bare
`{"branchId"}`, so it never matched and `UUID.randomUUID()` fired on every provision, becoming the
outbox `aggregateId` (`13-10-SUMMARY.md:94`). A mock-based consumer test encodes the consumer's
belief about the producer, so it agrees with the bug.

### 3.2 Layer 1 — transport conformance test (zero new dependencies, catches (a) exactly)

One test per Feign `configuration` class. It asserts the *transport*, not the business call.

```java
/**
 * Feign's default transport (HttpURLConnection) cannot send PATCH — it throws before the network.
 * This test sends a real PATCH over a real socket using the client this service's Feign
 * configuration actually supplies. If someone deletes JdkHttpFeignClient, or adds a Feign client
 * that does not import this configuration, this goes red instead of a compensation path going
 * silently dead. See 13-10-SUMMARY §1 and 13-12-SUMMARY §5(b).
 */
@Test
void theConfiguredFeignClientCanSendEveryVerbTheInterfacesDeclare() throws Exception {
    // A bare HttpServer on 127.0.0.1 that echoes back the method it received.
    // (No WireMock needed; java.net.httpserver.HttpServer is in the JDK.)
    for (String verb : List.of("GET", "POST", "PUT", "PATCH", "DELETE")) {
        Response res = feignClientUnderTest.execute(requestWithMethod(verb, echoUrl), options);
        assertThat(res.status()).as("verb %s could not be sent", verb).isEqualTo(200);
        assertThat(bodyOf(res)).isEqualTo(verb);
    }
}
```

### 3.3 Layer 2 — a verb/transport closure test (catches the *next* one)

The transport test above proves the two fixed services. This one proves the other nineteen. Same
idiom as `ControllerAuthorizationClosureTest`:

```
Scan every @FeignClient interface on the classpath.
For each method, resolve its HTTP verb (@PatchMapping / @RequestMapping(method=PATCH) / …).
If the verb is PATCH:
    resolve the interface's `configuration` attribute;
    FAIL unless that configuration class declares a `feign.Client` bean
    (i.e. is not relying on feign.Client.Default).
Report every offender in one run.
```

This is the cheapest possible guard for the exact defect and needs nothing that is not already on the
classpath. It is also the honest scope: it proves *sendability*, not correctness.

### 3.4 Layer 3 — provider-verified shape, one seam at a time

Shape drift needs the producer in the loop. Three options, in increasing cost:

1. **Shared DTO record in `shared-lib`** for each internal seam, referenced by *both* the controller
   and the `@FeignClient` return type. A producer-side rename becomes a compile error in the
   consumer. 13-10 already reached for this — "a typed Feign return turns a producer-side rename
   into a compile error, not a silent parse miss" (`13-10-SUMMARY.md:26`) — but typed the return
   *inside platform-admin-service*, so the two sides can still drift apart. Promoting the record to
   `shared-lib` closes it. **Cheapest, highest value, do this first.**
2. **Provider contract test.** In the *producer* module, one IT per internal endpoint that asserts
   the exact JSON key set (not just status), e.g.
   `assertThat(json.keySet()).containsExactlyInAnyOrder("branchId")`. Cheap, and it fails on the
   producer side where the rename happens.
3. **Consumer-driven contracts (Pact or Spring Cloud Contract).** Neither is on this classpath — I
   checked the root `pom.xml` (`testcontainers-bom 1.21.4`, no Pact, no `spring-cloud-contract`).
   Adding one is a real dependency decision, and the phase-13 record shows a standing constraint
   against casual dependency additions (`13-10-SUMMARY.md:410-411`: "no package of any kind was
   installed, in any ecosystem"). **My recommendation: do not add one yet.** Options 1 + 2 cover the
   observed defect at a fraction of the cost. Revisit if a third shape-drift incident occurs.

There is also an existing asset to keep: `scripts/e2e/phase13-auth-provisioning-seam-e2e.sh` (406
lines) already drives the platform-admin ↔ auth-service seam over live HTTP. Promote it into the
post-deploy smoke suite (§5) rather than duplicating it.

### 3.5 Layer 4 — error-shape contract

`13-12-SUMMARY.md:99-150` records the second Feign failure mode: no `ErrorDecoder`, so a
`FeignException` (an ordinary `RuntimeException`) hit shared-lib's catch-all and an upstream **400
became a 500**. `13-07-SUMMARY.md:238-242` records the same thing independently. That is a contract
too, and it is testable with a stub producer: for each internal client, assert that upstream 400 /
404 / 409 arrive at the caller as 400 / 404 / 409, not 500. Cover it once per `configuration` class
alongside §3.2 — `services/user-service/.../UpstreamErrorDecoder.java` already exists to be tested.

---

## 4. Browser-level E2E: Playwright vs Cypress, and the ten journeys

### 4.1 Recommendation: **Playwright**. Keep it; invest in it.

This is not a close call for this stack, and three of the four reasons are repo facts rather than
preferences:

1. **It is already here and already in CI.** `frontend/package.json` has
   `@playwright/test ^1.61.1` and `"e2e": "playwright test"`; `frontend/playwright.config.ts` exists;
   `.github/workflows/ci.yml:357-385` has an `e2e` job that installs chromium and runs it; there are
   14 spec files under `frontend/e2e/`. `scripts/DEV-STACK-RUNBOOK.md:139-143` records a Playwright
   cold-boot journey used as real evidence. Switching to Cypress would discard all of that to solve
   no stated problem.
2. **This system's journeys are multi-origin.** The frontend is `localhost:3000`, the gateway is
   `localhost:8080`, and the runbook already documents a direct `XMLHttpRequest` from the page to
   `http://localhost:8080/api/v1/branches/mine`
   (`scripts/DEV-STACK-RUNBOOK.md:160-165`). Cypress requires `cy.origin()` wrapping for multiple
   origins in one test and additionally requires that *all URLs navigated to within a single test use
   the same port* (https://docs.cypress.io/app/guides/cross-origin-testing). Playwright has no
   equivalent constraint.
3. **Multi-role journeys need cheap role switching.** Several of the ten below need two identities in
   one scenario (the two-manager PO approval rule; SuperAdmin provisions → tenant admin logs in).
   Playwright's documented pattern is a `setup` project writing one `storageState` file per role,
   with `dependencies: ['setup']` and `test.use({ storageState: 'playwright/.auth/admin.json' })` per
   file, plus separate `BrowserContext`s when two roles must interact inside one test
   (https://playwright.dev/docs/auth).
4. **API + browser in one runner.** `APIRequestContext` / the `request` fixture sends arbitrary HTTP
   verbs and shares `storageState` with browser contexts
   (https://playwright.dev/docs/api-testing), so seeding preconditions and asserting server-side
   post-conditions happens in the same test file as the click-through. Given this project's whole
   lesson is "assert the persisted row, not the publisher" (`13-13-SUMMARY.md:110-125`), that
   matters: the E2E can click *and* verify the row.

**What to change about the current Playwright setup** (it is a scaffold, and the config says so):

- **The config and the spec directory have diverged.** `frontend/playwright.config.ts` describes
  itself as a scaffold with "ONE smoke journey" and starts *only* the frontend
  (`webServer: pnpm build && pnpm start`) — which is why `frontend/e2e/smoke.spec.ts` asserts a
  redirect enforced by `proxy.ts` with no backend at all. But `testDir: "./e2e"` and the single
  `chromium` project mean `pnpm e2e` runs **all 14** specs, and the other 13 (pos-settlement,
  purchasing-payment, kds-stations, finance-period-provisioning, …) plainly need a full stack.
  *Inference, not verified:* those 13 must be failing in CI, and `continue-on-error: true` is
  hiding it. **Confirm against an actual CI run before planning** — if true, the `e2e` job is
  currently a permanently-red no-op, which is a textbook instance of the very bug class this
  document is about. Fix by splitting into two projects: `e2e-local` (`testMatch` the frontend-only
  specs, keeps the webServer) and `e2e-stack` (`baseURL` pointed at a brought-up stack, no
  webServer).
- `.github/workflows/ci.yml:361` sets `continue-on-error: true` on the `e2e` job. A non-blocking
  gate is not a gate. See §6.
- Add `storageState` role fixtures for the personas in `scripts/DEV-STACK-RUNBOOK.md:348-354`
  (`cashier@demo.local`, `manager1@demo.local`, `manager2@demo.local`, `finance_demo@demo.local`).
  Note the runbook's correction: `owner@demo.local` and `accountant@demo.local` are **permanently
  401 `TOTP_REQUIRED`** with no enrolment path (the "TOTP catch-22",
  `scripts/DEV-STACK-RUNBOOK.md:364-378`) — do not build journeys on them until the first-login
  enrolment flow exists.

### 4.2 The ten highest-value journeys

Ranked by (defect density observed in phases 11–13) × (business consequence of silent breakage).
Each names what it must assert *server-side*, because "the UI rendered" is the assertion that let
these bugs through.

| # | Journey | Why it is top-ten | Must also assert |
|---|---|---|---|
| 1 | **SuperAdmin provisions a tenant → the new tenant admin logs in and lands on a populated dashboard** | Blocker B2's whole surface. The saga had six independent defects (`13-CONTEXT.md:32-39`); the acceptance criterion the phase itself chose was "a tenant created via the API must be able to log in immediately" | `auth_tenants` row exists; `user_branch_roles` OWNER row exists; first branch has `is_hq=true`; the temp password is actually returned to the caller |
| 2 | **Forced password change on first login → old password rejected → session works** | `must_change_password` was written and never read (`13-CONTEXT.md:50`); the whole flow is new in 13-08 | the login gate actually blocks other endpoints before the change; other sessions revoked |
| 3 | **Forgot password → email/temp-credential → reset → login** | "reset-confirm had never once succeeded against an RLS-enforcing database" (`13-08-SUMMARY.md:22`). Also the highest-traffic self-service path in any ERP | a persisted single-use token row; second redemption fails; `failed_login_count`/`locked_until` cleared |
| 4 | **Cashier: open till → take order → cash settle → close till → X/Z totals** | The money path. Also where D-30 changed till binding semantics (`13-CONTEXT.md:96-102`) | journal/AR rows written, not just a success toast |
| 5 | **Waiter: create order → send to KDS → kitchen bumps it → status reflected on the floor** | The `WAITER` role is brand new; the till-binding change (D-30) exists *because* a waiter could be authorized to take an order then refused `409 NO_OPEN_TILL` | the waiter holds no till permission and the order still completes |
| 6 | **Two-manager purchase-order approval → GRN receipt → invoice → payment** | The runbook seeds `manager2@demo.local` specifically so "same approver twice on one PO → 409" can be tested (`DEV-STACK-RUNBOOK.md:351`). Multi-identity, multi-service, money-moving | the 409 on self-approval; inventory movement rows; AP posting |
| 7 | **Tenant admin creates a user, assigns a per-branch role, user logs in with exactly those permissions** | B3. `roleCode` used to persist any arbitrary string and yield a permissionless login (`13-CONTEXT.md:44`); the assign-side privilege ceiling is still an open task | the role exists in the `roles` table; the new user's token carries the expected permission set and *not* more |
| 8 | **Feature gating: two tenants on different tiers see different navigation** | This exact bug has occurred **twice** already (`13-CONTEXT.md:144`); the `demo` tenant once got `{"features":[]}`, hiding POS/Finance/Purchasing/HR/CRM for every role (`DEV-STACK-RUNBOOK.md:333-341`) | `GET /api/v1/feature-flags` payload differs per tenant; a gated route 403s `FEATURE_DISABLED` for the tenant without it |
| 9 | **Tenant suspension → login refused → reinstatement → login works** | Suspension is "the platform's primary non-payment lever" and status enforcement failed open via `.defaultIfEmpty("ACTIVE")` (`13-CONTEXT.md:145`); the propagation ran over the PATCH that Feign could not send | the auth-side tenant status actually changed (the compensation path), not just the platform-side row |
| 10 | **Cross-tenant isolation: authenticated as tenant A, every tenant-B identifier returns 404/403** | The single highest-consequence failure in a multi-tenant ERP, and the one the superuser harness structurally could not test | a list endpoint, a get-by-id, a PATCH and a DELETE, each with a tenant-B id (`13-12-SUMMARY.md:184` shows the shape) |

**Two runners-up, worth adding once the ten are stable:** impersonation (SuperAdmin → tenant user,
with the audit row asserted as *persisted* and naming the real actor — `13-13-SUMMARY.md:117-135`),
and POS offline/reconnect (`frontend/e2e/pos-offline.spec.ts` already exists).

**Journeys 1, 3, 9 and 10 must be executed as a mix of UI and `request`-fixture calls.** Some of what
they assert has no UI yet (all frontend work is Phase 14, `13-CONTEXT.md:14`). Writing them
API-first now and adding the click-through later keeps them useful immediately.

---

## 5. A smoke suite that runs against the REAL running stack after deploy

### 5.1 Design rules, derived from what actually failed here

1. **Every assertion is an HTTP request against the gateway.** Not a source grep, not a service port.
   This is already the house rule and it has a written rationale worth preserving verbatim in the new
   suite's header — `scripts/e2e/_phase13-lib.sh:1-12` and
   `scripts/e2e/phase13-superadmin-e2e.sh:4-11`: Phase 3's verification scored 24/24 while citing a
   controller that does not exist, because every check was structural.
2. **`/actuator/health` 200 is a precondition, never a result.** There is an open, recorded risk
   that services "wedge while `/actuator/health` still returns 200" (project task #12). The smoke
   suite must transact, not ping.
3. **It must be able to fail.** Prove it once, the way
   `scripts/DEV-STACK-RUNBOOK.md:106-122` proved the health gate (`docker pause`), and record the
   negative control in the suite's README.
4. **It must be non-destructive and re-runnable** against a real environment: uuid5-deterministic
   ids and idempotent seeds, following `scripts/onboarding.py` (`13-CONTEXT.md:72`).
5. **It must name the failing hop.** The gateway's Resilience4j fallback can answer a *healthy*
   backend's first request after idle with `SERVICE_UNAVAILABLE`; `_phase13-lib.sh` already retries
   exactly once and treats a second as real. Keep that; do not let it become a loop.

### 5.2 Composition

**Tier 0 — readiness gate (fail fast, ~15s).** The existing loop in
`scripts/DEV-STACK-RUNBOOK.md:390-398` over `8080 gateway, 8081 auth, 8082 user, 8083 authz,
8086 finance, 8087 purchasing, 8093 audit, 8095 file, 8096 platform-admin` plus frontend `:3000`.
Precondition only.

**Tier 1 — transactional smoke (~90s, blocking).** Twelve assertions, all through `:8080`:

| # | Assertion | Guards |
|---|---|---|
| 1 | SuperAdmin login returns a token with no `tenant_id` claim | B1 cause 3 |
| 2 | That token reaches `GET /api/v1/platform/tenants` → 200 with a real list | B1 causes 1+2 |
| 3 | A tenant token is **refused** on `/api/v1/platform/**` | the exemption did not become a hole |
| 4 | A tenant-scoped route still 401s a tenant-less token | ditto, other direction |
| 5 | Each seeded persona logs in (cashier, manager1, manager2, finance) | the phase's own acceptance test (`13-CONTEXT.md:68`) |
| 6 | `GET /api/v1/feature-flags` is non-empty and **differs between two tenants** | the twice-shipped gating bug |
| 7 | A `PATCH` through the gateway to a real internal-compensation path succeeds | Feign transport (§3) — a verb-level canary |
| 8 | A write + read-back on one RLS table per service returns the row | RLS GUC wiring in the deployed config |
| 9 | Cross-tenant read with tenant A's token for tenant B's id → 404/403 | isolation |
| 10 | Each `SECURITY DEFINER` function returns >0 rows when called as the service role | `deploy/scripts/verify-security-definer-owners.sh`, promoted to post-deploy |
| 11 | A published domain event produces a **persisted** row (outbox → consumer → table) | the "stops at the publisher" class (`13-13-SUMMARY.md:117`) |
| 12 | Liquibase/Flyway: zero pending changesets, zero `MARK_RAN` surprises, no held locks | `scripts/unlock-liquibase-locks.ps1` exists because this happens |

**Tier 2 — browser smoke (~3 min, blocking).** Playwright `e2e-stack` project, journeys 1, 4 and 8
from §4.2 only. Keep it small; the full suite is a nightly/staging concern.

**Tier 3 — nightly against staging.** All ten journeys plus the phase-13 API scripts.

### 5.3 Reuse, don't rewrite

`scripts/e2e/` already contains 7,356 lines of exactly this kind of assertion, including a shared
harness (`_phase13-lib.sh`, 336 lines) with `curl_retry`, `assert_status`, `mint_platform_token`
and a `phase13_summary` that exits non-zero. The work is not writing a smoke suite; it is
**promoting the phase-13 scripts from one-shot phase verification into a permanent, named,
CI-invoked suite**:

```
scripts/smoke/
  run.sh                 # tier 0 → tier 1 → tier 2, --tier N to stop early
  lib.sh                 # _phase13-lib.sh, renamed and de-phased
  00-readiness.sh
  10-platform-auth.sh    # from phase13-superadmin-e2e.sh
  11-provisioning.sh     # from phase13-provisioning-e2e.sh
  12-passwords.sh        # from phase13-{forced-change,admin-reset,reset-hardening}-e2e.sh
  13-feature-gating.sh   # from phase13-feature-gating-e2e.sh
  14-user-lifecycle.sh   # from phase13-{user-lifecycle,tenant-admin-users}-e2e.sh
  15-rls-and-definers.sh # from deploy/scripts/verify-security-definer-owners.sh
  README.md              # incl. the negative-control procedure (rule 3 above)
```

They are already written to the right standard; they are just filed as phase artifacts, so nothing
runs them again after the phase closes. That filing is itself an instance of the bug class.

---

## 6. What CI must add

Read: `.github/workflows/ci.yml` (402 lines) and `.github/workflows/coverage-gates.json`.
What is already good: full-reactor `mvn -Pcoverage verify` so ITs really run (`ci.yml:124`);
data-driven per-module coverage gates (`ci.yml:133-160`); OPA at exactly 100% (`ci.yml:190-201`);
the Dockerfile reactor-POM closure check (`ci.yml:56-78`) — which is, notably, already a guard test
against a "green in CI, broken at image build" defect, i.e. the team has done this before and it
worked.

### 6.1 Blocking changes

| # | Change | Where | Why |
|---|---|---|---|
| 1 | **Split the `e2e` job in two and remove `continue-on-error: true`** | `ci.yml:357-385` | A non-blocking gate is not a gate. Run `e2e-local` (frontend-only specs) blocking on every PR; run `e2e-stack` in the new `stack-smoke` job (#6). See §4.1 — the job may be permanently red today and hidden by that flag; confirm first. |
| 2 | **Add a `ddl-auto` parity step to `lint`** | new step after `ci.yml:78` | §2.3. Same Python-inline idiom as the Dockerfile check right above it. Cheap, fast, no Docker. |
| 3 | **Fail the build on failsafe/surefire *errors*, not only failures** | `ci.yml:124` | `DEV-STACK-RUNBOOK.md:543-545`: "a suite that errors during context load still reports `Tests run: N` — with `Errors: N` beside it". Verify Maven's current behaviour for this reactor before writing the step — I did not confirm whether any module sets `testFailureIgnore`. |
| 4 | **Assert the IT database role is non-superuser** | new step in `test`, after `mvn verify` | §1.7's negative control is per-module; this is the belt: parse surefire/failsafe reports (or a marker file the base class writes) and fail if any module's ITs ran as a superuser. Without it, one reverted base class silently re-opens the hole everywhere. |
| 5 | **Publish JUnit XML as a check-run artifact** | `test` job | Today a red suite is a wall of Maven log. Errors-vs-failures (#3) is unreadable without it. |

### 6.2 New jobs

| # | Job | Trigger | Content |
|---|---|---|---|
| 6 | **`stack-smoke`** | `push` to `main`, after `build` | Bring the stack up from the images just built (compose), run `scripts/smoke/run.sh --tier 1`. This is the single largest gap: **CI today never starts more than one service at a time.** Every one of the five defects in the brief is a cross-process or cross-boundary defect. |
| 7 | **`migration-fidelity`** | PR + push | Run each service's migrations against a fresh Postgres **as the non-superuser role** (§1.3's init script, no Spring), then run `AbstractRlsCoverageTest`'s query standalone and the `SECURITY DEFINER` functional probe from `deploy/scripts/verify-security-definer-owners.sh`. Catches grant/ownership/RLS drift without booting a JVM per service. |
| 8 | **`contract`** | PR + push | §3.2/§3.3 transport + verb-closure tests, and §3.5 error-shape tests. Fast, no Docker beyond a loopback `HttpServer`. Can fold into `test` if job count matters. |

### 6.3 One thing to leave alone

Do **not** raise `coverage-gates.json` as a response to this bug class. §0 explains why. If anything,
add a gate on *journeys covered* (10/10 in §4.2) and *smoke assertions passing* (12/12 in §5.2) —
counts of behaviours, not lines.

---

## 7. Sequencing, and what this strategy does not cover

**Order matters** — some of these gates will be red on arrival, and landing them in the wrong order
buries the signal:

1. §2 `ddl-auto` parity (cheap, mechanical, low breakage, immediate value).
2. §3.2/§3.3 Feign transport + closure tests (cheap, zero new deps, closes an active defect class).
3. §5 promote `scripts/e2e/**` → `scripts/smoke/**` and add CI job #6 (`stack-smoke`). **Do this
   before §1** — it gives an independent signal against the real stack while the IT harness is being
   rebuilt, so a §1-induced red suite can be distinguished from a real regression.
4. §1 non-superuser containers, one service at a time in the §1.6 order, each with its negative
   control and `AbstractRlsCoverageTest`. This is the long pole and the highest value.
5. §4 the ten journeys, as UI arrives in Phase 14.

**Not covered here, deliberately:**

- **Performance, load and soak.** Nothing in the observed defect class is a performance defect.
- **The macOS-local Testcontainers problems** (colima port forwarding, `TESTCONTAINERS_RYUK_DISABLED`,
  the wildcard-bind ALF EOF). Already root-caused and documented at
  `scripts/DEV-STACK-RUNBOOK.md:402-530`; `server.address=127.0.0.1` must be carried into every IT
  base class touched by §1 (the runbook notes at line 516 that **every service base class other than
  auth/gateway still binds to the wildcard**). CI is unaffected — Linux, no ALF.
- **Whether `shared-lib` currently produces a `test-jar`.** Flagged as unverified in §1.6; it
  determines the packaging of `RlsPostgresContainer` and `AbstractRlsCoverageTest` and therefore
  every service's POM diff.
- **Adding Pact / Spring Cloud Contract.** Recommended *against* for now (§3.4), with the trigger
  condition stated: a third shape-drift incident.
- **The TOTP catch-22** (`DEV-STACK-RUNBOOK.md:364-378`). It blocks two personas from every E2E
  journey. It is a product bug, not a test-strategy item, but journeys 1, 2 and 7 are partially
  blocked until a first-login enrolment flow exists.

---

## Appendix — measurements run for this document

All on this machine, 2026-08-07, Docker 29.5.2 (Ubuntu 24.04.4 LTS VM), image `postgres:18`.
Containers were removed afterwards.

```
A. Testcontainers-style POSTGRES_USER=auth_user
   pg_roles → auth_user | rolsuper=t | rolbypassrls=t     (only login role in the cluster)
   FORCE RLS table, no tenant GUC:  INSERT → OK,  SELECT → 1 row
   ⇒ every RLS assertion in the current suites is vacuous.

B. Recommended shape: bootstrap superuser "test" + app role created post-start
   pg_roles → auth_user  super=false bypassrls=false
              test       super=true  bypassrls=true
   Migrations run AS auth_user (auth_user owns the tables, as in production)
   INSERT, no GUC                → ERROR: new row violates row-level security policy for table "users"
   INSERT, correct GUC           → INSERT 0 1
   SELECT, correct GUC           → 1 row
   SELECT, different tenant GUC  → 0 rows

C. SECURITY DEFINER owner trap (same container as B's predecessor)
   function owned by the app role (NOSUPERUSER) → 0
   function owned by the superuser              → 1
   ⇒ matches the live-DB finding in 13-08-SUMMARY.md:267-273 and the rationale in
     deploy/scripts/verify-security-definer-owners.sh.
```

External sources fetched: https://hub.docker.com/_/postgres ·
https://java.testcontainers.org/modules/databases/jdbc/ ·
https://java.testcontainers.org/modules/databases/postgres/ ·
https://playwright.dev/docs/auth · https://playwright.dev/docs/api-testing ·
https://docs.cypress.io/app/guides/cross-origin-testing ·
https://github.com/OpenFeign/feign/issues/1171 ·
https://github.com/spring-cloud/spring-cloud-openfeign/issues/366 ·
https://www.baeldung.com/openfeign-http-patch-request
