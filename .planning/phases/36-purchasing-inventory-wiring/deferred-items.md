# Phase 36 — deferred items

Things found while executing phase 36 that are **out of this phase's scope**. Recorded rather than
fixed, per the scope boundary: only issues directly caused by this phase's own changes are repaired
here.

---

## D-1 — `f72e012` broke every purchasing IT that makes two MockMvc requests

**Found:** 2026-08-11 ~23:04, running the purchasing suite for plan 36-04.
**Owner:** whoever owns commit `f72e012` (a concurrently running executor) / shared-lib.
**Not mine:** the commit landed at 23:02 today, minutes before the failing run, and touches no file
this phase edits.

`fix(security): a tokenless request kept its tenant, and the next one on that thread inherited it`
made `JwtAuthenticationFilter.doFilterInternal` clear `TenantContext` in a `finally` on the
**tokenless** path as well as the authenticated one. The fix itself is right — a leaked thread-local
tenant answering a later request is a genuine cross-tenant hazard, and the commit message documents
a live reproduction.

Its side effect is that purchasing's integration tests set the tenant **once**, in `@BeforeEach`, on
the test thread, and then drive MockMvc on that same thread with a `RequestPostProcessor`
authentication rather than a real Bearer token. The first request now clears the ThreadLocal, and
every request after it in the same test throws:

```
java.lang.IllegalStateException: TenantContext is empty: tenant id was not set on this thread
  at ...ExceptionTranslationFilter.doFilter
→ HTTP 500
```

**Evidence that this is the mechanism** — in `VendorItemCatalogIT`, exactly the multi-request tests
fail and exactly the single-request ones pass:

| Test | requests | result |
|---|---|---|
| `catalogListIssuesABoundedNumberOfQueries` | 2 | FAIL 500 |
| `vendorCategoryTagsAreReadableAndWritableAndAffectNoAuthorization` | 3 | FAIL 500 |
| `archivingACatalogItemRemovesItFromTheDefaultListButKeepsThePriceHistory` | 2+ | FAIL 500 |
| `viewOnlyPrincipalCannotCreateACatalogItem` | 1 | pass |
| `unauthenticatedIsRejected` | 1 | pass |
| `catalogIsScopedToTheCallersTenant` | 0 (service-level) | pass |

7 failures of 10, all in the multi-request group.

**The repair belongs to the test apparatus, not to the filter.** These tests should re-establish the
tenant per request — or drive MockMvc with a real token — rather than relying on a ThreadLocal
surviving a filter chain that is now correctly clearing it. Reverting `f72e012` to make them green
would restore a cross-tenant leak to fix a test.

**Not fixed here** because it is neither caused by nor repairable within phase 36's scope, and
touching another executor's in-flight security fix mid-flight is how two workstreams corrupt each
other.

---

## D-2 — `PurchasingOpaPolicyIT` cannot load its context (CGLIB)

**Found:** same run.
**Owner:** purchasing-service / build toolchain.

```
BeanDefinitionStoreException: Could not enhance configuration class
  [io.restaurantos.purchasing.opa.RealOpaTestConfig]. Consider declaring
  @Configuration(proxyBeanMethods=false) …
```

All 9 tests error on context load. Nothing in phase 36 touches `RealOpaTestConfig` or OPA wiring,
and the same suite's other 15 IT classes enhance their configurations fine. The remedy the message
itself suggests — `@Configuration(proxyBeanMethods = false)` — is a one-line change to a file this
phase has no business editing, and doing it here would bury a build-toolchain question inside a
purchasing repair.

---

## D-3 — Testcontainers Postgres intermittently fails to accept connections

**Found:** several runs on 2026-08-11.

```
FlywaySqlUnableToConnectToDbException: Unable to obtain connection from database
  (jdbc:postgresql://localhost:34936/purchasing_db) … Caused by: java.io.EOFException
```

The container is allocated a port and then is not reachable when Flyway connects, failing every IT
class in the module at once. It is intermittent — the same command succeeded on the next attempt —
and `TESTCONTAINERS_RYUK_DISABLED=true` is set for this module, so orphaned containers are not
reaped. Most likely Docker resource pressure with four executors running concurrently. Recorded so
that a future reader does not attribute a whole-module failure to a code change.

---

## D-4 — Items handed off by the 36-01 findings register

See `31-01-FINDINGS.md`, section "Handoff": the unconsumed `finance.invoice-matched.queue`, the
opaque 409 on a check-constraint violation in shared-lib's error envelope, the unmonitored
`inventory.grn-received.queue.dlq`, and `tenant_match_tolerances` carrying neither RLS nor FORCE.
