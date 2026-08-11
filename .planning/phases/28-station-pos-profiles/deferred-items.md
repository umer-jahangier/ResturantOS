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
