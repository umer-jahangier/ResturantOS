# Phase 26 — deferred items

Out-of-scope discoveries made while executing. Logged, not fixed, per the scope boundary.

---

## D-1 · Hibernate's `tenantFilter` does not scope `BranchEntity` reads

**Found:** 26-02 task 1, by `ReceiptConfigIT.anotherTenantsBranch_isNotFound` failing with 200
instead of 404 before the fix.

**What is true.** `BranchService.get` calls `branchRepository.findByIdAndDeletedAtIsNull(id)`,
which carries no tenant predicate and relies entirely on the RLS policy. Two things then coincide:

1. Testcontainers runs Postgres as a **superuser**, and a superuser bypasses even
   `FORCE ROW LEVEL SECURITY`, which `branches` does have (migration `011-enable-rls-branches`).
2. Hibernate's `@FilterDef`/`@Filter(name = "tenantFilter")` is declared on the
   `TenantAuditableEntity` **mapped superclass**, not on `BranchEntity`. Hibernate does not
   propagate a `@Filter` from a mapped superclass to the concrete entity, so
   `TenantFilterInterceptor.enableFilter("tenantFilter")` has nothing to attach to for this entity.

So in the integration harness there is nothing scoping a branch read at all. In **production** the
DB role is not a superuser and the RLS policy does hold, so this is not a live cross-tenant leak —
but it is exactly the "predicate in the query as well as the policy" that 26-CONTEXT requires, and
the application layer currently supplies neither for `branches`.

**Fixed only for this plan's surface.** 26-02 added
`BranchRepository.findByIdAndTenantIdAndDeletedAtIsNull` and `BranchService.getForCurrentTenant`,
used by `ReceiptConfigService`. `BranchService.get` itself was deliberately NOT narrowed: it is on
the branch read path, the internal provisioning path and the compensating-deactivation path, and
two of those run with the tenant taken from a request body rather than from a token. Narrowing it
belongs to a plan that can exercise all three.

**Worth checking beyond `branches`.** If `@Filter` on the mapped superclass is inert here, it is
inert for **every** entity extending `TenantAuditableEntity` across all twenty services. That is a
platform-wide question, not a printing one.

**Suggested owner:** a follow-up to 17b (RLS force rollout) or 18b (ABAC enforcement).

---

## D-2 · The receipt-config read is gated on `branch.manage`, which a cashier does not hold

**Found:** 26-02 task 2, while writing the controller.

26-02 instructs that BOTH endpoints carry the branch-management permission, and that is what
shipped — a user who may not edit a branch may not decide where its receipts print, and the body
carries the branch's internal network topology.

But **26-09's client bridge runs in the POS tab as a cashier** and needs the agent's base URL.
It cannot call this endpoint. 26-09 will need either a slimmed cashier-readable projection
(agent URL and the terminal's own printer only) or to receive the agent URL through the session
bootstrap. Flagged here so 26-09 discovers it in planning rather than at the 403.

---

## D-3 · Two Jackson generations are live in the same process

**Found:** 26-02 task 2, debugging why the malformed-body handler reported no field path.

Spring Boot 4.0.7 uses **Jackson 3** (`tools.jackson.*`) for HTTP message conversion, while
`SharedAutoConfiguration.sharedObjectMapper` is a **Jackson 2** (`com.fasterxml.jackson.databind`)
`ObjectMapper` and both jars are on every service's classpath. Any code that inspects a
deserialisation failure, or that assumes the mapper Spring injects is the mapper MVC used, has to
account for both. `ReceiptConfigExceptionHandler` now handles both explicitly.

The two agreed byte-for-byte on the round-trip in `ReceiptConfigIT`, so this is a papercut rather
than a defect — but it is the kind that costs an hour every time somebody meets it.

---

## D-4 · Pre-existing frontend lint/format debt, untouched

`pnpm --dir frontend run lint` reports **10 warnings, 0 errors** — nine TanStack
`react-hooks/incompatible-library` warnings plus one in
`components/menu/__tests__/menu-item-image-field.test.tsx`. `format:check` reports six files with
style issues, all from the tables/menu-image work (`app/(tenant)/app/tables/*`,
`components/menu/MenuItemImageField.tsx`, `e2e/tables-and-menu-images.spec.ts`,
`__tests__/pos/tables-page.test.tsx`).

None are in files this phase touched, and none were made worse. Left alone per the scope boundary.

---

## D-5 · `pos-service` cannot be restarted right now, and its jar is NOT bootable

**Found:** after 26-05 task 3, checking whether a human could actually press "Print bill".

`bash scripts/check-stale-jars.sh` reports `STALE pos-service (pid 47292)` — the running process
predates the jar on disk. So **the live stack does not have 26-03's endpoints**, and a person
pressing Print bill today gets a 404. That blocks 26-05 task 4 (the Playwright spec) and task 5
(the human checkpoint).

**It is worse than stale.** `services/pos-service/target/pos-service-1.0.0.jar` is 294 KB with
**zero `BOOT-INF` entries** — a thin jar, not a Spring Boot executable one. My own test runs passed
`-Dspring-boot.repackage.skip=true` (to get past the duplicate-`.class` repackage failure), which
left it unbootable. `java -jar` on it fails with no main manifest attribute. **Restarting from this
jar would take pos-service DOWN, not bring it up.**

**Why I did not rebuild it.** `scripts/DEV-STACK-RUNBOOK.md` says: *"Never rebuild a module a
sibling agent/session is actively editing — check `git status <module>` and `ps aux | grep mvn`
first."* Both conditions are live:

- `services/pos-service/src/test/java/io/restaurantos/pos/CashPaymentRequiresTillIT.java` has an
  **uncommitted modification** that is not mine.
- A sibling `mvn verify -pl shared-lib -Dit.test=TenantFilterPropagationIT` was running at the time
  (that is the D-1 follow-up).

Rebuilding would either bake a sibling's in-flight test state into the artifact or collide with
their build over `shared-lib`.

**What needs to happen, in order:**

```bash
bash scripts/check-stale-jars.sh          # now also clears the duplicate " 2.class" files
mvn -pl services/pos-service -am package -DskipTests   # NO repackage.skip — the fat jar is the point
ls -la services/pos-service/target/pos-service-1.0.0.jar   # expect tens of MB, not 294 KB
kill -TERM 47292 && sleep 10
( source scripts/dev-env.sh; source scripts/local-service-env.sh; \
  exec java -jar services/pos-service/target/pos-service-1.0.0.jar ) \
  >>.dev-logs/pos-service.log 2>&1 &
disown
bash scripts/check-stale-jars.sh          # must report ok pos-service
```

Do this when no sibling is mid-edit in `services/pos-service`. Until then, every "does the bill
print" check is measuring a service that does not have the endpoint.

---

## D-6 · Two receipt-layout items, assigned to 26-12 (not the backlog)

Found by reading the real printed bill during 26-05 task 5.

### D-6a · `Tax (16.00%) [OTHER]` and `Tax` print the same figure twice

On a single-rate order the paper reads:

```
Tax (16.00%) [OTHER]             Rs 38.40
Tax                              Rs 38.40
```

A customer reading two tax lines on one bill has a reasonable question. **And the `[OTHER]` is
telling us something**: `ReceiptDocumentAssembler` falls back to the rate code `OTHER` when the
menu item has none, and it fired for every line.

**Checked, as instructed — it is a SEED-DATA gap, not only a display one.** `menu_items.tax_rate_code`
exists and is nullable (`V1__pos_schema.sql:39`), and **no seeder sets it**:
`grep -rn "taxRateCode" scripts/*.py` returns nothing. So every demo tenant's receipts will print
`[OTHER]` on every line, and Phase 27 will need real rate codes for FBR.

Two things for 26-12: suppress the redundant `Tax` total row when the breakdown has exactly one
line that already carries the same figure, and seed real rate codes.

### D-6b · `Discount Rs 0.00` and `Service charge Rs 0.00` always print

Suppress zero rows — **keeping any line a fiscal regime requires**. That caveat is not decoration:
some regimes require a tax line to appear even at zero, and Phase 27 is the plan that will know
which. Suppress the discount and service-charge rows now; leave the tax rows alone until 27 says.
