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
