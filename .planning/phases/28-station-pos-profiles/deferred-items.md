# Phase 28 — deferred / out-of-scope discoveries

Things found while executing phase 28 that are **not** phase 28's to fix. Recorded rather than
patched, per the scope boundary: only issues directly caused by this phase's own changes are
auto-fixed here.

---

## 1. `shared-lib` did not compile mid-session (another agent's in-flight edit)

**Found during:** 28-07, task 1.

```
shared-lib/src/main/java/io/restaurantos/shared/print/PrintDocument.java:[73,9] cannot find symbol
  symbol: class Ticket
```

`PrintDocument` is phase 26's thermal-printing work and was mid-edit in the shared working tree.
Phase 28 touches no file under `shared-lib/print`. Worked around by building kitchen-service
against the already-installed `shared-lib` artifact (`mvn -pl services/kitchen-service compile`,
without `-am`) rather than editing another agent's file.

**Action for whoever owns phase 26:** none required from 28 — noting it only so a later reader of
this phase's logs does not attribute the failure here.

---

## 2. `TenantGucTransactionalProbeIT` fails in a full-suite run, passes in isolation

**Found during:** 28-07, task 2, running the whole kitchen-service suite.

```
TenantGucTransactionalProbeIT.aClassLevelTransactionalTestChecksOutItsConnectionBeforeTheTenantIsSet
  The connection carries GUC '7c7b406e-…' — another tenant's, not this test's and not empty.
```

- `mvn verify -Dit.test=TenantGucTransactionalProbeIT` alone: **passes**.
- Full suite: **fails**.

**Why it is not phase 28's.** The file is another agent's *uncommitted* work (`git status` shows
`M`), and its own javadoc says it exists to document a pre-existing contradiction: Spring's
`TransactionalTestExecutionListener` checks a connection out — and `TenantAwareDataSource` decides
`app.current_tenant_id` on it — **before** `@BeforeEach` sets the tenant. In a shared JVM the pooled
connection therefore carries whichever tenant last borrowed it.

Phase 28 adds transactional integration tests to that JVM (`StationScopeIT`, `MenuStationRoutingIT`,
`PosTerminalAdminIT`, `StationTypeProjectionIT`), which changes *which* tenant is left on a pooled
connection. It does not change the mechanism, and the probe fails against any sufficiently populated
suite. Phase 28's own tests all pass, individually and in the full run.

**Action:** belongs with the agent who authored the probe. Recorded here so the failure is not
mistaken for a station-scope regression.

---

## 3. Six services were running code that was not on disk (session of 2026-08-12)

**Found during:** 28-11, live-stack verification.

`bash scripts/check-stale-jars.sh` reported **stale=6**: auth-service (jar built 56m after the
process started), user-service (46m), pos-service (10m), crm-service (6793m), file-service (361m),
reporting-service (6703m).

The user-facing symptom was a **503 on every `POST /api/v1/users`** whose real cause was masked:

```
Exception in thread "http-nio-8082-exec-15" java.lang.NoClassDefFoundError:
  ch/qos/logback/classic/spi/ThrowableProxy
Caused by: java.lang.ClassNotFoundException: ch.qos.logback.classic.spi.ThrowableProxy
```

That is a JVM lazily loading a class from a jar that has since been replaced. It fires **while
logging an error**, so the underlying exception is never printed — every failure on that service
became an opaque 503.

**Acted on:** auth-service, user-service and pos-service were restarted (they are what phase 28's
verification needs). After the restart, user creation worked first try.

**Left alone, deliberately:** crm-service, file-service and reporting-service. They are not phase
28's and restarting a service another agent may be mid-build on is worse than reporting it.

**Action for everyone sharing this tree:** after `mvn package`, RESTART the service. A rebuilt jar
under a running JVM does not fail loudly — it fails as a 503 with a logging error on top of it.

---

## 4. pos-service does not boot from the current working tree (phase 26's print agent)

**Found during:** 28-11, while restarting pos-service.

```
APPLICATION FAILED TO START
The dependencies of some of the beans in the application context form a cycle:
┌─────┐
|  printAgentCredentialFilter
↑     ↓
|  printAgentEnrolmentService
↑     ↓
|  posSecurityConfig
└─────┘
```

`PrintAgentCredentialFilter.java` is **untracked** and `PosSecurityConfig.java` is **modified** —
uncommitted phase 26 work. At committed `HEAD` the cycle does not exist.

Separately, `mvn -pl services/pos-service -DskipTests package` fails to compile the TEST sources:

```
PrintJobClaimIT.java:[22,63] package org.springframework.boot.test.autoconfigure.web.servlet does not exist
PrintJobClaimIT.java:[47,2] cannot find symbol: class AutoConfigureMockMvc
```

(`spring-boot-starter-test` does not bring `spring-test`'s MockMvc autoconfigure onto this module's
test classpath.)

**Worked around, not fixed:** pos-service was rebuilt in a **detached git worktree at `HEAD`** and is
running from that jar, so no in-flight source was touched and no agent's working tree was modified.
When the print-agent work is finished, rebuild and restart pos-service from the main tree.

**Action:** belongs to whoever owns phase 26's print agent. Phase 28 touches none of those files.

---

## 5. `__tests__/components/state-character.test.tsx` fails on a token that does not exist

**Found during:** 28-11, full frontend unit run.

```
Error: globals.css: `--sm` is not defined in scope `dark`
  at rawToken __tests__/lib/theme/css-tokens.ts:102
```

The test file is **untracked** — another agent added it during this session. It asserts a
`--sm` token in the dark scope that `app/globals.css` does not define yet. 2 of 1035 tests.

Phase 28 touches no CSS and no theme token. Recorded so the failure is not attributed here.

---

## 6. Frontend lint carries 11 pre-existing warnings

`npx eslint .` across the whole frontend reports 11 warnings, all `react-hooks/incompatible-library`
or `no-unused-vars`, in: `components/ui/data-table.tsx`, five inventory dialogs, two purchasing
dialogs, `components/menu/__tests__/menu-item-image-field.test.tsx`,
`app/(tenant)/app/inventory/recipes/[menuItemId]/page.tsx` and `e2e/journeys/reduced-motion.spec.ts`.

None is in a file phase 28 touched; every file phase 28 touched lints at zero warnings.
