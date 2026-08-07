# ResturantOS — Executable Roadmap, Phase 14 onward

**Written:** 2026-08-07 · **Branch:** `phase-13-access-repair` @ `5fba4a9`
**Consolidates:** the ten adaptivity reports in this directory *and* the ten `erp-completion`
reports, including `../erp-completion/BUILD-PLAN.md`, which this document **supersedes and
extends**. Where the two swarms disagree, §2 resolves it explicitly and says why.

**Total honest effort: 423 dev-days raw, ~550 with the project's own historical rework
multiplier. That is 10–11 months with three engineers, ~7 months at the absolute floor.**
Anyone who needs a smaller number should read §7.5, not this sentence.

---

## 0. How to read this

Three words are used precisely, following BUILD-PLAN §0:

- **works** — a request was executed and the persisted result read back.
- **built** — the code exists and compiles. Nothing more.
- **unreachable** — built, and provably not callable by any real caller.

Claims re-verified in the working tree while writing this document:

```
grep -rn "setServiceChargePaisa" services/            → 0      (service charge is permanently zero)
grep -rn "menu-cache" frontend/{lib,components,app}   → 0      (offline menu cache has no callers)
grep -rln "new JwksKeyProvider" services/ gateway/    → 23     (the timeout-free client is fleet-wide)
grep -rl "micrometer-registry-prometheus" **/pom.xml  → 0      (/actuator/prometheus 404s everywhere)
grep -rln "hikari" services/*/src/main/resources/     → 0      (no pool is configured anywhere)
grep -rn "FORCE ROW LEVEL SECURITY" services/pos-service → 2   (pos_db is ENABLE, not FORCE)
```

Every "Definition of done" row in §6 is a shell command or a browser journey with a server-side
assertion. None is satisfied by inspection. That rule exists because this project once scored
24/24 on a phase that cited a controller which does not exist.

---

## 1. Foundation decisions that constrain everything

These are decided here, once, and every later phase inherits them. Changing one of them after
Phase 16 is a re-plan, not an edit.

### F1 — The tenant configuration model *(the foundation; everything else depends on it)*

**Configuration is federated by storage, unified by a compiled-in registry, and every key
declares which of two storage classes it uses.**

- **`SettingRegistry` in `shared-lib`** is the single catalogue of every configurable key:
  owner service, scope ceiling, JSON Schema, default, writer permission class, secret flag,
  unresolved-policy, and — new here — its **storage class**. It is compiled in, immutable,
  assembled from per-service `SettingModule` contributions, and fails fast at startup on a
  duplicate key or a key whose prefix contradicts its declared owner.

- **Storage class A — typed.** The value is a typed column on a table the owning service
  already owns, or on a purpose-built typed table. Used wherever the value is read on a hot
  path, participates in arithmetic, or has an invariant a database `CHECK` should enforce.
  Members: `user_db.tenant_profiles` (currency, timezone, locale, fiscal year, rounding,
  legal identity, NTN/STRN), `pos_db.service_profiles` (Phase 19),
  `pos_db.branch_guest_config` (Phase 36), `pos_db.pos_terminals` (Phase 32),
  `finance_db.tax_codes`/`tax_profiles`, `inventory_db.wastage_reasons` (Phase 26),
  and the five *existing* ad-hoc config tables (`hr_db.tax_config`,
  `hr_db.attendance_policies`, `purchasing_db.tenant_match_tolerances`,
  `purchasing_db.po_approval_tiers`, `crm_db.loyalty_tier_config`), which stay first-class
  and are registry-declared by pointer only.

- **Storage class B — generic.** A row in the owning service's `tenant_settings`
  (`tenant_id, scope_type, scope_id, setting_key, value JSONB, version`). Used for the long
  tail: branding, receipt template, business hours, display preferences, per-branch overrides
  of class-A defaults that have no arithmetic consumer.

Both classes are read and written through **one** API shape, produce **one** revision record,
share **one** cache-key discipline and **one** audit trail. The registry is what makes them one
system; the storage class is what keeps a tax rate out of a JSONB blob.

**Never in `platform_db`.** Its own migration mandates no RLS
(`010-create-platform-tables.xml:8-12`, PLATFORM-07), so putting tenant operational
configuration there would place every tenant's settings in the one database with no row-level
boundary — and would make a platform-admin restart stop restaurants taking orders, because the
gateway deliberately refuses when platform-admin cannot answer.

**The ownership rule that makes the map derivable rather than arbitrary:** *a setting's
invariants must be checkable inside its owner's own transaction. If they are not, it is owned
by the wrong service.* Cross-service synchronous validation on a settings write is forbidden —
it is a distributed transaction with no coordinator, and it is the exact shape of the shipped
bug where compensation could never fire because Feign cannot send PATCH.

### F2 — Scope, resolution, and what an unanswerable question means

- **Three scopes: `TENANT` → `BRANCH` → `TERMINAL`.** Platform defaults live in **code**, never
  as rows — a default stored as a row cannot be diffed, cannot ship in a migration, and makes
  "is this an override or an inheritance?" unanswerable. `scope_id` is `NOT NULL` with an
  all-zeros sentinel for TENANT scope, because a nullable column in a Postgres primary key does
  not enforce uniqueness.
- **Resolution is most-specific-first**, and every resolver terminates at a hardcoded fallback
  equal to today's shipped behaviour. A resolver that returns `Optional.empty()` and throws
  takes down every restaurant on deploy day.
- **Entitlement fails closed; configuration does not.** 13-03/D-33 stands unchanged: unknown
  tenant status ⇒ `503 TENANT_STATUS_UNAVAILABLE`, nothing cached, one lever
  (`restaurantos.fail-open-on-platform-down`) read in exactly one place. Configuration gets a
  **per-key** unresolved policy from a closed set declared in the registry —
  `DEFAULT` / `REFUSE` / `LAST_KNOWN`. "Could not determine a printer target" and "could not
  determine a tax rate" are not the same question. There is deliberately **no**
  `restaurantos.settings.fail-open` property: two levers that can disagree give an operator a
  configuration nobody has tested.
- **An unresolved value is never cached**, and `REFUSE` returns 503 with a distinct code —
  never 403, never a fabricated value. An operator must be able to tell "we could not tell"
  from "you may not".
- **Cache writes happen after commit, always with a TTL, and SET rather than DELETE**, with the
  transactional outbox as the durable backstop. This is a correction of two live defects in
  `FeatureFlagAdminService.invalidateBothKeyShapes` (writes Redis inside `@Transactional`; no
  TTL, so a poisoned entry never self-heals). Do not copy them.

### F3 — One channel column, one accept mechanism

Three separate designs proposed a column meaning "where did this order come from", with three
names and three value sets. There is exactly one:

```
orders.channel VARCHAR(24) NOT NULL DEFAULT 'POS_TERMINAL'
OrderChannel = {POS_TERMINAL, KIOSK, QR_TABLE, DRIVE_THRU_LANE, ONLINE, AGGREGATOR, PHONE}
```

`OrderType` remains **fulfilment** (where the food goes) and gains `DRIVE_THRU`. `channel` is
**origin**. A kiosk order can be takeaway or dine-in; that is precisely why drive-thru and
aggregator orders "do not fit" today. Neither `orders.source` (multi-POS design) nor a
4-value `channel` (guest design) is built.

**One accept mechanism:** `OrderStatus.PENDING_ACCEPT` plus `orders.accepted_at`/`accepted_by`,
used by both aggregator injection and guest surfaces running `FIRE_ON_STAFF_ACCEPT`. See §2 C3.

### F4 — Money and rates

- **Amounts are `BIGINT` paisa** in every column, every DTO and every event payload, including
  settings values, where they are JSON integers. **No registry schema may declare
  `type: "number"`** — closure-tested.
- **Rates are `NUMERIC(18,4)`**, ratifying the repo's own V12 decision: a per-gram cost of an
  ingredient bought by the kilo is genuinely fractional, and storing 6 where 6.2 belongs was a
  3.2% error compounded into every moving-average cost. In ClickHouse: `Int64` for amounts,
  `Decimal64(4)` for rates and quantities.
- **Percentages in configuration are integer basis points** (`service_charge_bps`), which keeps
  floats out of computation and out of event payloads.
- **Rounding happens once**, at the rate→amount boundary, through
  `MacCalculator.extendedCostPaisa` on the inventory side and a single tenant-configured mode
  on the POS side. `MoneyUtils.taxPerLine` FLOORs while `OrderPricingCalculator.perLineTax`
  rounds HALF_UP for the same quantity; §2 C11 settles it.

### F5 — Entitlement is central, operations are federated

- **`platform_db`** owns what the tenant bought and must not change: tier, feature flags
  (`is_override` survives a tier change in both directions — already shipped), quotas, billing
  state, invoices. No RLS, by mandate.
- **The owning service** owns how the restaurant works. FORCE RLS, tenant predicate in the
  query anyway (RLS is defence in depth, not the mechanism — `pos_db` proves why).
- **One quota table.** `platform_db.tenant_quotas (tenant_id, quota_key, limit_value BIGINT,
  source TIER|OVERRIDE)` replaces three competing proposals (four nullable `*_override` columns
  on `tenants`; a `tier_meter_limits` table; a separate `tenant_quotas`). Keyed by
  `quota_key` so a new meter is a row, not a migration. **`-1` is a forbidden stored value** —
  `FeatureFlagGlobalFilter` already uses `-1` as its in-memory "undeterminable" sentinel, and
  the collision would turn an outage into an unmetered Claude-backed endpoint.
- **Premium capability is gated by a platform feature flag; behaviour is configured by the
  tenant.** The platform sells `FEATURE_SELF_SERVICE`; the tenant chooses `BILL_FIRST`.

### F6 — A number is computed once and projected, never recomputed

The `businessDate` defect (pos derives it, puts it on the payload, reporting ignores the
payload and re-derives it with different rules) is the template for a whole class. Applied
forward:

- **Theoretical usage** is the sum of persisted `DEPLETION` movements — never a re-computation
  of Σ(recipe qty × units sold), because that would drift from the COGS finance already posted.
- **Usage variance** is computed by inventory-service, which owns the ledger and the counts,
  and *projected* into ClickHouse by reporting-service. Never computed twice. (§2 C5.)
- **Food-cost %** is a curated `nlq_metrics` entry with one hand-written SQL template, never a
  formula an LLM re-derives per question.
- **The resolved service-model knobs are stored on the row**; `preset` is provenance only and
  is never re-read at runtime, so a release that redefines `BILL_FIRST` cannot silently
  reconfigure 200 live venues at 7pm.

### F7 — Structural presence is not evidence

Every phase closes on executed commands and browser journeys whose output is pasted into the
phase summary. Any success criterion phrased as "X exists" is rewritten as "a request to X
returns Y and row Z is present" **before the phase is allowed to start**. Every new gate must
be **seen to fail once**, and the procedure that made it fail recorded in
`scripts/smoke/README.md`.

### F8 — Vocabulary closure is a build gate

Feature codes, permission codes, event routing keys, gateway routes and registry setting keys
are each closed sets with a build-failing closure test, modelled on the existing
`FeatureCodeClosureTest` and `PermissionCatalogClosureTest`. This is the only defence against
this project's highest-recurrence defect: a vocabulary mismatch produces a clean, confident 403
or a silent default, breaks no test, and throws nothing at startup. The frontend guard must
compare **set equality in both directions** — the existing `nav-feature-flags.test.ts` compares
against a union and therefore cannot detect a one-sided code.

### F9 — The test harness must differ from production in nothing that matters

Integration tests run as `NOSUPERUSER NOBYPASSRLS` with the app role **owning** the tables
(FORCE only binds an owner). Measured on this machine: Testcontainers' `withUsername(...)` sets
`POSTGRES_USER`, which the official image creates as a superuser, so a `FORCE RLS` table
accepts an INSERT with no tenant GUC — **every RLS assertion in every integration test is
currently vacuous.** A permanent negative control per service asserts `current_user` is neither
superuser nor BYPASSRLS. Triage rule during rollout: **a failure is a production bug until
proven otherwise; the forbidden repair is widening the role.**

### F10 — Bounded waits everywhere; no unbounded external call on a request path

The Phase 13 wedge was diagnosed wrongly (§2 C9). The verified mechanism is
`JwksKeyProvider.refresh()` — `private synchronized`, performing an HTTP GET through a
`RestClient.create()` with **no connect and no read timeout**, constructed in **23 places**
across services and gateway. One half-open socket parks a thread forever holding the monitor.
Forward rule: every outbound client has an explicit connect and read timeout; every scheduled
job is replica-safe; every service configures its pool; and no `synchronized` block contains
I/O. The one-day fix is pulled into Phase 14, not deferred to hardening.

---

## 2. Conflicts between the two swarms, resolved

| # | Conflict | Resolution | Why |
|---|---|---|---|
| **C1** | **Configuration storage.** `erp-completion/tenant-configurability.md §5` wants one typed-column `user_db.tenant_profiles` ("a typed column makes a missing value a compile error, not a null at runtime"). `adaptivity/tenant-config-model.md` wants a federated generic `tenant_settings` (JSONB) per owning DB plus a compiled-in registry. | **Both, split by storage class — F1.** The registry, scope model, revision table, cache discipline and unresolved-policy come from the adaptivity design. `tenant_profiles` and every other invariant-bearing table stay typed columns and are registry-declared class A. | The typed-column argument is exactly right for hot-path settings (tax, currency, rounding, service model) and exactly wrong for the long tail (branding, receipt template), where a migration per key is absurd. The registry argument is exactly right about governance, audit, provenance and one API — and its own design already exempts five existing typed tables, so the two are 90% compatible already. `onboarding.md` independently adopted `tenant_profiles`, which breaks the tie. |
| **C2** | **Order origin column.** `business-models` adds `orders.channel` + a 6-value `OrderChannel`; `self-checkout` adds `orders.channel VARCHAR(12)` with 4 values; `multi-pos-stations` adds `orders.source VARCHAR(20)` with 5 values. | **One column `orders.channel`, one 7-value enum — F3.** Landed in Phase 19. Phases 32 and 36 consume it; neither adds a column. | Three columns meaning the same thing is how a fact table ends up with three disagreeing answers to "how many kiosk orders". The enum must be a superset on day one because widening a `CHECK` later is a migration on the hottest table in the system. |
| **C3** | **Unaccepted orders.** `business-models` adds `OrderStatus.PENDING_ACCEPT`. `self-checkout` argues explicitly against touching `OrderStatus`/`OrderStateMachine` and models it as `guest_accepted_at IS NULL` on an OPEN order. | **`PENDING_ACCEPT`, one mechanism for both.** | The guest design's argument is cost-avoidance; the service-model design's is correctness — `listOrderSummaries` deliberately filters DRAFT, and an order that is neither DRAFT nor really open needs a state that answers "may the kitchen see this yet?" without a second predicate every consumer must remember. One status, one test matrix, one set of transitions. `business-models` lands first, so the guest design inherits it rather than the reverse. |
| **C4** | **Service charge units.** `business-models`: `service_charge_bps INT`. `tenant-configurability`: `service_charge_pct NUMERIC(5,2)`. `tenant-config-model`: `pos.service_charge_pct_bps`. | **Integer basis points — F4.** | Two of three, and it is the only form that keeps a float out of `ORDER_CLOSED`, which finance and reporting both consume. `NUMERIC` in a JSON event payload is how a rate becomes a double somewhere downstream. |
| **C5** | **Usage variance home.** `waste-inventory` computes it in inventory-service as `usage_variance_periods` (count-to-count, snapshot totals on close). `nlq-insights` computes it in reporting-service as a ClickHouse `stock_variance_facts` rollup anchored on `last_counted_at`. | **inventory-service computes; reporting-service projects.** One computation, exported over a new `/internal/inventory/variance-summary` seam, then written to `stock_variance_facts` for NLQ. | This is the `businessDate` defect waiting to happen again: two services deriving the same number from the same raw data with different period rules. Inventory owns the ledger, the counts, the per-category variance cap and the override audit trail — it is the only place the number can be *defended*. NLQ needs it in one wide fact table, which projection gives it. |
| **C6** | **Per-tenant limits.** `tenant-configurability §5.6`: four nullable `*_override` columns on `tenants`. `subscription-metering`: `tier_meter_limits` table *or* four columns. `tenant-config-model`: `tenant_quotas`. | **One `platform_db.tenant_quotas (tenant_id, quota_key, limit_value, source)` — F5.** The four `tenants.max_*` columns become a read-only projection for one release, then are dropped. | Four columns means a migration per new meter, and there are at least eight meters coming (orders, API calls, SMS, email, storage, NLQ, branches, users). `TenantSubscriptionService.changeTier` and `PlatformInternalController.getStatus` must read the new table *first*, or the gateway's quota path silently reverts to "undeterminable". |
| **C7** | **Multi-POS scope.** BUILD-PLAN Phase 28 estimates 10 days. `multi-pos-stations.md` estimates 22 and includes a live cross-branch menu-routing corruption bug, the KDS WebSocket branch-claim hole, and a till-uniqueness index swap. | **22 days, the adaptivity scope.** But the two *security* items — KDS WebSocket branch validation and the globally-unique `client_order_id` — are pulled forward into Phase 17. | BUILD-PLAN's 10 days did not know about `menu_items` being tenant-scoped while `stations` is branch-scoped, which silently re-routes an item for branch A when an admin at branch B assigns it. That is data corruption, not scope. The two security items are one day each and should not wait for a 22-day phase. |
| **C8** | **Guest ordering.** BUILD-PLAN §3.6 explicitly **defers** QR table ordering, online ordering and aggregators as "blocked on a commercial agreement or a payment-gateway merchant account". The user's requirement explicitly names self-checkout. | **Build it (Phase 36), split at the payment boundary.** `FIRE_ON_STAFF_ACCEPT` and pay-at-table need no PSP and no partner agreement, and are the recommended default anyway. Only `PAY_FIRST` and aggregator injection are gated on U8/U12. | BUILD-PLAN's deferral reasoning is sound for aggregators (a signed contract per aggregator) and wrong for QR-at-table, which is a menu, a cart and a staff tap. The safe default mode removes the entire "an unauthenticated stranger makes the kitchen cook food" loss class for one tap, so there is no reason to wait. |
| **C9** | **Why services wedge while `/actuator/health` returns 200.** BUILD-PLAN R2 and open task #12 attribute it to a liveness-only health probe and prescribe a readiness probe over the DB pool. `scalability-ops.md` refutes that against the live fleet. | **The scalability diagnosis wins; the readiness probe is still built, but it is not the fix.** Phase 14 adds timeouts to all 23 `JwksKeyProvider` construction sites and removes I/O from the `synchronized` block. Phase 37 adds the probes. | `/actuator/health` *does* include a `db` component running `isValid()` on a pooled connection, so a 4–21 ms 200 during the incident is positive evidence the pool was healthy — which retires pool exhaustion, `@Transactional`-across-Feign and consumer starvation in one step, since all three present as pool exhaustion. **A DB-backed readiness probe would not have caught this incident.** The endpoints that actually lie are `/actuator/health/liveness` and `/readiness`, which return a bare `{"status":"UP"}`. Note also: auth-service wedged too and cannot wedge this way (pre-seeded provider, zero outbound HTTP) — that remains **unexplained**, and this roadmap says so rather than inventing a cause. |
| **C10** | **Money typing for rates.** The standing project rule is "money is always BIGINT paisa". `waste-inventory` and `nlq-insights` both need fractional per-unit costs; the repo's own V12 migration already widened rates to `NUMERIC(18,4)`. | **Ratified as F4: amounts integral, rates fractional, rounding at one boundary.** | The rule was written about amounts and is correct about amounts. Applying it literally to rates already caused a measured 3.2% valuation error. Not a weakening of the rule — a statement of its scope. |
| **C11** | **Rounding mode.** `MoneyUtils.taxPerLine` FLOORs; `OrderPricingCalculator.perLineTax` rounds HALF_UP, for the same quantity. | **HALF_UP becomes the shipped default** and `pos.tax_rounding_mode` / `pos.tax_rounding_level` become class-A settings on `tenant_profiles`. `MoneyUtils.taxPerLine` is deleted rather than fixed. | Two implementations of the same rule is the defect; picking the one already on the live order path minimises behaviour change for existing tenants. This is a **change to posted money** and needs a regression corpus in Phase 16, not a silent merge. |
| **C12** | **Storage quota source of truth.** `file-service.TierStorageProperties` disagrees with `TierLimits` at every tier (CUSTOM enforced at one tenth), while `tenants.storage_gb` is read by nobody. | **Delete `TierStorageProperties`; file-service reads `storageGb` from the `StatusResponse` it already fetches.** Both sides change in the same PR. | This is exactly the bug 13-14 fixed for NLQ, still live for storage. 13-14 deviation #5 records that fixing only one side leaves the lower of two constants governing. |
| **C13** | **Feature taxonomy for guest surfaces.** `self-checkout` proposes `FEATURE_GUEST_ORDERING` in `ALL_TIERS_ON`; `business-models` proposes `FEATURE_SELF_SERVICE` + `FEATURE_CHANNEL_ORDERS` at GROWTH+; `FEATURE_ECOMMERCE` already exists, unbuilt, at GROWTH+. | **Two codes: `FEATURE_SELF_SERVICE` (kiosk + QR + online storefront, GROWTH+) and `FEATURE_CHANNEL_ORDERS` (aggregator + phone injection, GROWTH+). `FEATURE_ECOMMERCE` is retired in the same migration** — it is a phantom flag with a gateway prefix no service serves. | Three codes for two capabilities is how the phantom-flag bug ships a third time. `ALL_TIERS_ON` is rejected: a STARTER tenant 403ing on a surface they were never sold is indistinguishable from a bug only if the code exists — if the capability is genuinely premium, the CTA header is the right answer. |
| **C14** | **Presets.** `onboarding` has business-type presets (FINE_DINING/CAFE/QSR/BAR/CLOUD_KITCHEN/BAKERY) that seed defaults; `business-models` has service-model presets (ORDER_FIRST/BILL_FIRST/SELF_SERVICE/CHANNEL_INJECTED/QUICK_BILL). | **One preset system, two layers.** `tenant_profiles.business_type` is the *input*; it maps to a service-model preset plus a bundle of class-A defaults. Every preset value lands in a form field the operator sees before saving — never a hidden behaviour change. | A preset that silently does nothing is precisely the failure mode this project keeps hitting. Making business type visibly select a service-model preset also answers onboarding's own open question about which later steps to suppress. |
| **C15** | **Effort.** BUILD-PLAN totals 190 days for phases 14–29. The adaptivity reports total 330 days for ten workstreams. | **423 days for the merged programme**, after de-duplication (§7.1 shows the arithmetic per phase). | The two sets overlap by roughly 97 days — tenant config, multi-POS, statements-vs-facts, verification-vs-e2e and hardening-vs-scalability all appear in both. They are not additive, and neither total is right alone. |

---

## 3. The phases

Effort is **dev-days for one competent engineer**, excluding review, UAT and rework. §7 applies
the multiplier. Track letters group work that can proceed concurrently with different people.

### Milestone A — Trustworthy core *(nothing above this is trustworthy until it lands)*

---

#### Phase 14 — Money-path, event-bus and unbounded-wait repair · **5 days** · no dependencies · Track: spine

**Goal:** every closed order reaches the ledger balanced exactly once; a business exception
dead-letters instead of hot-looping; and no request thread can park forever on an untimed
socket.

**Services:** finance, purchasing, reporting, crm, audit, gateway, shared-lib.

**Scope:**
1. **W1** — `AutoPostingRecipeEngine.postOrderRevenue` credits `subtotal − discount` *and*
   debits the discount as contra-revenue. Credit **gross** `subtotalPaisa`, keep the
   `DR DISCOUNT` line. Add a parameterised unit test over `discount > 0`,
   `discount + serviceCharge`, and `discount == subtotal`.
2. **W2** — finance, crm and reporting have **no `spring.rabbitmq.listener` block at all**, so
   Spring's `default-requeue-rejected=true` applies and W1's failure requeues forever. Add
   `default-requeue-rejected: false` + bounded retry to all three, and to audit (the `#`
   catch-all for nine exchanges).
3. **W3** — delete the direct `financeInternalClient.autoPost` in `GrnReceiptSimulator`. One
   goods receipt currently posts `DR 1300 / CR 1700` twice under two different dedup keys.
4. **W5** — reporting must consume the payload's `businessDate` verbatim, as finance does,
   instead of re-deriving it with a different rule.
5. **F10 emergency fix** — add explicit connect/read timeouts to all **23** `JwksKeyProvider`
   construction sites (they use the static `RestClient.create()`, which bypasses Boot's
   configured builder), and move the HTTP call out of the `synchronized` block. Same for the
   OPA client (`SharedAutoConfiguration:165`) and `PlatformAdminFeatureResolver`, both of which
   are timeout-free on a request path.
6. Remove the insecure default `INTERNAL_SERVICE_SECRET:dev-internal-secret` so a context fails
   to start rather than starting insecure. It guards every `/internal/**` endpoint fleet-wide.
7. Delete the dead `/api/v1/authorization/**` gateway route; add DLQ monitors to finance (10),
   inventory (3), crm (2), reporting (3), audit (1); regenerate
   `deploy/init/rabbitmq-definitions.json` from the code-declared `Declarables`.

**Parallel with:** 20, 31 (different people, disjoint files).

---

#### Phase 15 — Verification spine and E2E harness · **10 days** · after 14 *(sequencing, see §4)* · Track: spine

**Goal:** CI can distinguish "works" from "compiles"; there is one independent signal against a
real running stack; and there are instruments to read when something wedges.

**Services:** all (test and CI only), plus `frontend/e2e`.

**Scope:**
1. `ddl-auto` parity closure test with a greppable exemption comment; flip the 11 mismatched
   test bases to `validate`. Do **not** phrase the rule as "always validate" — auth and
   authorization genuinely deploy `none`.
2. Feign verb closure test (fail any PATCH method whose configuration supplies no
   `feign.Client`), plus a transport-conformance test per configuration class using a JDK
   `java.net.httpserver` echo, plus an error-shape test asserting upstream 400/404/409 arrive
   as 400/404/409 rather than 500.
3. Promote `scripts/e2e/**` → `scripts/smoke/**` (7,356 lines of live-HTTP assertions currently
   filed as one-shot phase artifacts); add `run.sh --tier N` and the negative-control procedure.
4. **New CI job `stack-smoke`** — bring the compose stack up from just-built images and run
   tier 1. Today CI never starts more than one service, and every defect in §1.2 of BUILD-PLAN
   is a cross-process defect.
5. **Land the Playwright restructure already prototyped in `browser-e2e.md`:** four projects
   (`smoke` always-on and backend-free; `auth-setup` and `journeys` gated on `E2E_STACK=1`;
   `legacy` gated on `E2E_LEGACY=1`), the stdlib-TOTP + persona + gateway-client fixture layer,
   and 19 minted storage states. Measured working: `pnpm e2e:journeys` → 30 passed in 22s,
   three consecutive `--workers=4` runs green. **Remove `continue-on-error: true`.**
   Pin `@playwright/test` to exactly `1.61.1` (drop the caret) — browser binaries are
   version-locked.
6. Add `micrometer-registry-prometheus` (absent from **all** poms; `/actuator/prometheus` 404s
   fleet-wide) plus a CI assertion that it returns 200 with a non-zero body. Add tracing.
   Render `tenantId`/`traceId` into the log pattern — they are written to MDC today and appear
   in zero log lines. `hikaricp_connections_pending` and `tomcat_threads_busy` are exactly the
   two series that would have distinguished the two wedge mechanisms in seconds.
7. Fail the reactor on failsafe/surefire **errors**, not only failures. Settle the `shared-lib`
   test-jar packaging question — it determines every service's POM diff in Phase 18.

**Parallel with:** 16, 17, 20, 31.

---

#### Phase 16 — Tenant configuration spine · **22 days** · after 14; needs 15's harness to be trusted · Track: B · **THE FOUNDATION**

**Goal:** every ERP behaviour a restaurant would call "how we work" is a declared, scoped,
versioned, audited setting with a real consumer — and a plain settings screen proves it.

**Services:** shared-lib, user, pos, finance, platform-admin, gateway, frontend.

**Scope:**
1. **shared-lib settings kernel (~6 days — Phase 19 can start the moment this lands, not the
   whole phase):** `SettingDefinition` / `SettingRegistry` / `SettingModule` / `SettingInvariant`
   SPI; the two storage classes (F1); the resolver with F2 semantics; `tenant_settings` and
   `tenant_setting_revisions` migrations with `ENABLE + FORCE RLS` and an explicit `WITH CHECK`;
   `tenant_secrets` (bytea via the existing `EncryptedStringConverter`) with a **fail-fast
   startup gate on `restaurantos.encryption.key`**, because `EncryptionAutoConfiguration` is
   `@ConditionalOnProperty` and the converter's static field otherwise stays null and NPEs on
   the first write, during a sale.
2. **Three-line unblock, first commit:** add `ntn`/`fbrStrn` to `CreateBranchRequest` and
   `UpdateBranchRequest` and wire the setters in `BranchService`. Today the shipped FBR Tax
   Summary report reads two columns nothing can write except by SQL.
3. **`user_db.tenant_profiles`** (class A, typed): `legal_name`, `brand_name`, `business_type`,
   `country_code`, `base_currency`, `currency_display`, `default_timezone`, `default_locale`,
   `fiscal_year_start_month`, `fiscal_year_label_rule`, `cash_rounding`, `tax_rounding_mode`,
   `tax_rounding_level`, `prices_tax_inclusive`, `ntn`, `strn`, `registered_address`, plus
   jsonb **only** for `receipt_template` and `theme`. Resolution branch → tenant → code default,
   mirroring `BranchTimeZoneResolver`.
4. Wire `fiscal_year_start_month` into finance, replacing the hardcoded `PakistanFiscalYear`.
5. **Tax codes / tax profiles** in finance (`STANDARD/ZERO_RATED/EXEMPT/FURTHER_TAX`,
   effective-dated). `menu_items.tax_rate_code` becomes an FK-by-code; `tax_rate_pct` stays as
   the historical snapshot so past orders are not re-priced.
6. **Service charge (fixes W7):** `service_charge_bps`, `service_charge_applies_to`,
   `service_charge_taxable`, wired into `OrderPricingCalculator.aggregateOrderTotals`. **Run
   `impact` first** — `OrderServiceImpl:1013` recomputes the same total independently and both
   call sites must move together. `orders.service_charge_paisa` starts being written for the
   first time; this changes `totalPaisa`, which feeds payment-status derivation and the revenue
   posting.
7. **Rounding unification (C11)** with a regression corpus over historical orders.
8. `platform_db.tenant_quotas` (F5) + `tenant_features` backfill migration (a tenant whose tier
   never changes has no row for a code added after provisioning, so any new code silently 403s
   them). Add `/api/v1/pos/` → `FEATURE_POS` to `RouteFeatureMap` **after** the backfill.
9. Real branding: persist `theme` (brand colour + logo **file id** via the existing MinIO
   file-service); delete the `localStorage` stub in `appearance-form.tsx` and the
   `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` lookup in `use-tenant-brand.ts`, which resolves the
   *build's* tenant, not the signed-in one.
10. **A registry-driven settings UI** at `/app/settings`, rendering itself from
    `GET /api/v1/{owner}/settings/schema`. Unstyled beyond the current primitives — Phase 22
    restyles it. This is what makes the phase demonstrable before the design system exists.
11. Four closure tests (F8): setting-key ↔ registry, registry ↔ owner prefix, no `type:"number"`
    schema, frontend/backend set equality in both directions.

**API:** `GET|PUT|DELETE /api/v1/{owner}/settings/**` with `If-Match` optimistic concurrency
(409 on mismatch), `GET .../schema`, `GET .../revisions`, `POST .../revisions/{n}:restore`
(a **new** revision that re-runs full validation — a value valid in March may not be valid
today), `GET /internal/{owner}/settings/resolve` behind the existing `X-Internal-Service`
secret, `PUT /api/v1/platform/tenants/{id}/quotas/{key}` and `.../settings/{key}/lock`
(SUPER_ADMIN, platform token only). New gateway route `/api/v1/org/**` → user-service with
**no** `RouteFeatureMap` entry (core, ungated for ACTIVE tenants).

**Parallel with:** 17, 18, 20, 31.

---

#### Phase 17 — API reachability and boundary repair · **12 days** · after 14 · Track: B · **parallel with 16**

**Goal:** every built domain is callable, no shipped navigation 404s, and three live
authorization/boundary holes are closed.

**Services:** pos, kitchen, inventory, crm, audit, gateway, user.

**Scope:**
1. `LoyaltyController` — balance, manual adjust, tier config, and **the actually-missing
   behaviour: a `redeem` method on `LoyaltyService`.** Points accrue forever today with no way
   to spend them.
2. `ModifierController` + modifier selection on the order-line path, **and fix W4** — store the
   modifier *name* and a real `price_delta_paisa` in the snapshot instead of a raw UUID and a
   hardcoded 0, with a backfill. Requires new `ModifierRepository`/`ModifierGroupRepository`
   (neither exists) plus `min_select`/`max_select`/`required` validation.
3. `GET /counts` and `GET /counts/{id}` on `StockCountController` (posting a variance is
   currently write-only). Dining-table / floor-plan CRUD (there is **no** create endpoint for
   dining tables at all — this blocks onboarding). A public `/api/v1/audit/events` surface
   **plus the gateway route** (`grep -c audit gateway/application.yml` → 0).
4. Consumers, or documented deletion, for the alert events nobody listens to:
   `DEPLETION_INCOMPLETE`, `EXPIRY_ALERT`, `TRANSFER_VARIANCE`, `LOW_STOCK_ALERT`. The last is
   urgent — its queue has no TTL and no max-length and grows for the life of the broker.
   Journal the till cash variance (`TILL_CLOSED` carries `variancePaisa`; finance has no
   subscription; cash over/short is a P&L item).
5. **Security, pulled forward from Phases 32 and 36:**
   - `KdsWebSocketHandler.validateJwtAndPermission(token, branchId)` **never reads `branchId`** —
     any `pos.kds.view` holder can subscribe to any tenant's live board. Copy the correct check
     from `PosOrderWebSocketHandler:167-171`.
   - `/api/v1/pos/` is not in the gateway's `WS_UPGRADE_PATHS`, so the POS order WebSocket is
     unreachable through the gateway. Add it, and verify the KDS one actually works.
   - `orders.client_order_id` is **globally** unique and `findByClientOrderId` has no tenant
     predicate. Make it `UNIQUE (tenant_id, client_order_id)` and add the predicate — `pos_db`
     RLS is inert (§2 C9 sibling; `OrderRepository`'s own javadoc says so).
   - `idempotency_keys` PK is `idem_key` alone with no `tenant_id`, in **all 16 services**: two
     tenants using the same `Idempotency-Key` either collide into a 409 or, on a hash match, one
     receives the other's cached `response_json`. Change to `(tenant_id, idem_key)`.
   - The `/iclock/**` feature gate is **dead** — `FeatureFlagGlobalFilter` returns early when
     `X-Tenant-Id` is null, which is always true on a public path. Either enforce it inside
     hr-service or delete the three comments claiming it works.
   - Move `GET /api/v1/auth/tenants/{slug}` and `POST /api/v1/auth/refresh` off the credential
     rate-limit bucket (neither is a credential-guessing surface; together they cost two
     credential tokens per page navigation). The role-catalog route already sets this precedent.
6. Triage the remaining 23 orphaned routing keys — consume, or delete with a decision record —
   and add an event closure test so key #42 cannot ship orphaned.

**Parallel with:** 16, 18, 20, 31.

---

#### Phase 18 — RLS harness and FORCE rollout · **15 days** · after 15 · Track: D · **parallel with 16, 17, 19, 20**

**Goal:** integration tests run as `NOSUPERUSER NOBYPASSRLS`, and the databases where RLS is
currently inert are converted so it binds.

**Services:** all (test harness), plus `deploy/init` role topology.

**Scope:**
1. `RlsPostgresContainer` (bootstrap superuser stays separate; the app role is created
   post-start and **owns** the tables, because migrations run on the app datasource in
   production); one `testcontainers-roles.sql` per service; adopt `AbstractRlsCoverageTest`
   (which already exists in shared-lib and has exactly one caller — itself); a **permanent
   negative control** per service asserting `current_user` is neither superuser nor BYPASSRLS.
2. Roll out one service per PR in defect-density order: auth → user → platform-admin → hr →
   finance → inventory → pos → purchasing → crm → kitchen → file → reporting → nlq → audit.
   `file-service` needs an IT base class first — it has none, yet ships an RLS changeset.
3. **Convert `pos_db`, `kitchen_db`, `purchasing_db`, `authorization_db`, `audit_db` and
   `platform_db`'s tenant-bearing tables from `ENABLE` to `FORCE`**, with a non-owner runtime
   role. `pos-service` has 2 `FORCE` statements against 224 fleet-wide; `pos_user` owns its
   tables via Flyway, so RLS does not bind it and tenant isolation on the core transactional
   service is service-layer only. This is a prerequisite for Phase 36 (a public guest surface
   with no database backstop is not acceptable).
4. Carry `server.address=127.0.0.1` into every IT base class touched (the runbook records that
   every service base class other than auth/gateway still binds the wildcard, which breaks
   macOS-local runs).

**Expect red suites. That is the deliverable.** Triage rule per F9.

**Parallel with:** everything — this is test code plus one migration per service, one PR at a
time.

---

### Milestone B — Adaptable POS *(the headline requirement becomes demonstrable)*

---

#### Phase 19 — POS service models · **17 days** · after 16's shared-lib kernel (day ~8), not the whole phase · Track: B

**Goal:** one deployment runs order-first table service, bill-first counters, QSR, quick-bill
and kiosk-shaped venues, configured per branch and per order type — and three live bugs that
make every non-table-service model impossible are fixed.

**Services:** pos, shared-lib, platform-admin, auth (permissions), frontend.

**Scope:**
1. **`pos_db.service_profiles`** (class A) — a named preset resolving to explicit stored knobs:
   `fire_trigger`, `payment_timing`, `till_requirement`, `close_condition`, `allows_open_tab`,
   `requires_table`, `default_order_type`, `allowed_order_types[]`, `allowed_tenders[]`,
   `close_till_blocks_on`, `service_charge_bps`, `auto_gratuity_paisa`. Plus
   `service_profile_rules` for **per-order-type and per-channel overrides** — the common
   Pakistani café runs dine-in order-first and takeaway bill-first on the same terminal, and
   without layer 1 that venue must pick one and suffer.
2. Resolution most-specific-first across order-type rule → POS profile → branch → tenant →
   a hardcoded `ORDER_FIRST` fallback **equal to today's behaviour exactly**. Redis-cached with
   `tenantId` first in the key; explicit tenant predicate in every query.
3. **`ServiceModelPolicy`** owns the business guards. `OrderStateMachine` stays a static
   structural map (you cannot go CLOSED→OPEN regardless of venue) and
   `OrderStatusDerivationService.derive` stays pure and non-configurable — it answers "how far
   has the kitchen got", a fact about the kitchen, not a venue policy.
4. **Fixes three live defects:**
   - `sendToKds` has **no payment precondition of any kind**; the entire pay-before-fire
     guarantee lives in `charge-summary.tsx:162-176`. If the tab closes between the payment call
     and the fire call, the customer has paid and the kitchen never hears. Move it into
     `recordPayment` inside the existing `@Transactional` boundary, reusing `sendToKds`'s
     per-fire idempotency namespace — and **delete** the frontend block, because two independent
     fire triggers is how a kitchen gets two tickets.
   - `maybeCloseOrder` requires `derivedStatus == SERVED`, which only a human tapping
     "Mark Served" per line can produce, while the kitchen tops out at READY. A fully-paid QSR
     or kiosk sale therefore **never closes, never publishes `ORDER_CLOSED`, never posts
     revenue, and blocks its cashier's till.** `close_condition` fixes it; and
     `maybeCloseOrder` must be added to `OrderReadyConsumer`, which does not call it today.
   - The till requirement is welded to `PaymentMethod.CASH`. Generalise D-30 rather than
     reverse it: `NONE | CASH_ONLY` (today's default) `| ANY_TENDER` (the pre-13-16 hard rule,
     restored as a choice for cash-cage operations). Guard `NONE` three ways — a DB `CHECK`
     forbidding CASH in `allowed_tenders`, an allow-list assertion before any amount is applied,
     and a defensive throw in `recordPayment`.
5. **F3 lands here:** `orders.channel`, `OrderChannel`, `OrderType.DRIVE_THRU`,
   `OrderStatus.PENDING_ACCEPT`, `orders.accepted_at`/`accepted_by`, `DerivedOrderStatus.READY`.
6. `FEATURE_SELF_SERVICE` and `FEATURE_CHANNEL_ORDERS` into `TierFeatureDefaults` (GROWTH+),
   `FEATURE_ECOMMERCE` retired (C13). New permissions `pos.settings.view`/`pos.settings.manage`
   inserted into the catalogue **and granted** — `PermissionCatalogClosureTest` documents three
   past permissions that were checked or granted but never inserted, each producing a silently
   unreachable API.
7. Frontend: the profile-driven terminal — `order-type-toggle.tsx` stops hardcoding three
   options and excluding DELIVERY; `pos-terminal.tsx` stops defaulting to DINE_IN and stops
   always rendering all three of Send / Save Draft / Charge Now.

**Deliberately forward-declared, not shipped as live settings:** `receipt_trigger`,
`prints_kot`, `prints_queue_token`. No receipt entity, endpoint, template or print seam exists
in pos-service today; they belong to Phase 30.

**Parallel with:** 17, 18, 20.

---

#### Phase 20 — Design system foundation · **14 days** · no code dependencies · Track: C · **parallel with 14–19**

**Goal:** the product has a brand, a chart vocabulary, touch-sized controls and one grid.

**Services:** frontend only.

**Status of the blocker:** U7 (brand hue) is **already resolved** — `DESIGN-DECISIONS.md`
D-UI-01 records the user's explicit delegation. The palette must still be justified: WCAG 2.2
AA minimum (AAA for anything a cashier reads under time pressure), five chart series verified
under deuteranopia/protanopia simulation with lightness varied as well as hue, semantics that
do not collide with the brand hue, both themes, and an OKLCH ramp regenerable from one hue
value. Documented default if nothing better emerges: `oklch(0.55 0.11 178)` deep teal +
`oklch(0.72 0.14 55)` warm amber.

**Scope:**
1. **Token pass (~1 day, highest visible return in the programme):** `--primary` is
   `oklch(0.205 0 0)` — pure black, zero chroma — and all five `--chart-*` tokens are
   chroma-zero greys, so **no chart can visually distinguish two series today**. Real ramps,
   a sequential ramp for heatmaps, a diverging ramp for variance (till over/short, budget vs
   actual), `--kds-*` tokens, `-subtle`/`-border` variants replacing `status-badge.tsx`'s inline
   alpha maths, and a typography scale.
2. `touch` (44px) and `pos` (56px) sizes on Button; `touch` on Input/Select. Then **delete** the
   `.touch-target` utility — a class adding `min-height` on top of a fixed-height component is a
   silent-layout-bug factory.
3. Sweep the 26 raw-palette files onto tokens, KDS first (16 × `bg-gray-950`).
4. **Boundary hardening before anything lands in `app/**`:** extend the eslint
   `no-restricted-imports` rule from `components/**` to `app/**`; relocate the two purchasing
   const-enums that leak Layer 1 into pages.
5. Add the ~24 missing shadcn primitives. **Smoke-test `shadcn add table` first** — a reported
   registry 404 for `style: radix-nova`; fallback is copying the MIT source.
6. `recharts@3.10.1` + `shadcn add chart`, imported only in dashboard route segments and never
   on the POS path (Recharts pulls `@reduxjs/toolkit`). **Stay on
   `@tanstack/react-table@8.21.3`** — v9.0.0 shipped 2026-08-04 and its migration guide 404s.
   Add `@tanstack/react-virtual@3.14.9`.
7. Grow `data-table.tsx` into a real `DataGrid` **behind optional props** so all four existing
   call sites compile untouched: filtering (**fix W10 — `getFilteredRowModel` is called but
   never registered, so filtering can never work**), faceting, grouping, column visibility,
   sticky header, virtualisation, density, **all state in the URL**, server-side pagination,
   saved views.

**Parallel with:** everything in Milestone A and Phase 19.

---

#### Phase 21 — SuperAdmin console, subscriptions and usage metering · **24 days** · after 16, 20 · Track: B/C

**Goal:** a SuperAdmin can see and control what every tenant bought, what they are using, and
what they owe — and the metering is real rather than structurally present.

**Services:** platform-admin, gateway, auth, file, nlq, pos, frontend.

**Reality being corrected:** `usage_records`, `UsageRecordEntity`, `UsageService` and
`POST /internal/platform/tenants/{id}/usage` all exist and a repo-wide grep finds **zero callers
anywhere**. Not one row has ever been written — yet PLATFORM-06 is marked complete in
`REQUIREMENTS.md:41` and "✓ SATISFIED" in `03-VERIFICATION.md:144`. Three defects sit inside the
dead code (`record()` returns a row count instead of the `SUM(qty)` the never-called repository
method computes; the response limit is hardcoded `Long.MAX_VALUE`; `qty` is `NUMERIC(20,4)` for
meters that are all integral).

**Scope:**
1. **Meter registry split into COUNTERS (flows, per-period, reset) and GAUGES (levels, no
   period)** — the distinction the one-column `usage_records` schema can express neither of, and
   why the branch-count check had nowhere to live. New `usage_counters`, `usage_gauges`,
   `usage_alerts`, `subscription_changes`, `invoices`, `invoice_lines`. `usage_records` is
   superseded — **verify `SELECT count(*)` against a real database before dropping**, because
   "nothing in this codebase writes it" is a claim about code, not about production.
2. **Postgres first, Redis second** for event-sourced counters — the inversion of what
   nlq-service and file-service do today, and the reason a lost Redis write is currently a lost
   billing event with no record anywhere. A 5-minute reconciler repairs Redis from Postgres:
   `SET` for Postgres-first meters, `max(redis, db)` via Lua for NLQ, whose Redis key is a
   *reservation ledger* that a plain `SET` would erase mid-flight.
3. **Do not rename the three legacy Redis keys** (`nlq_quota:{t}:monthly_count`,
   `storage:bytes:{t}`, `tenant:nlq_quota:{t}`) — they are verbatim three-way contracts and
   13-14 documents that changing one side silently returns the others to a compiled-in
   constant. A `MeterKeyResolver` returns the legacy key per meter.
4. **Enforcement splits on who pays, not uniformly on fail-closed.** Entitlement questions
   always fail closed (13-03). Cost meters (NLQ, storage, SMS) fail closed. Revenue meters
   (orders, API calls) meter-warn-and-bill. Hard-blocking a POS at 5pm over a volume dispute is
   a commercial decision a human makes.
5. **ORDERS is metered at the `ORDER_CLOSED` consumer, never at the gateway** — a path counter
   would count attempts, retries and voids, and reusing the seam finance/inventory/CRM/reporting
   already consume means the meter cannot disagree with revenue.
6. **`tenants.billing_state` as a second axis, not new `tenants.status` values.**
   `FeatureFlagGlobalFilter.isActive()` accepts only the literal `"ACTIVE"`, so a TRIAL or
   PAST_DUE *status* would 403 that entire cohort the moment it is first written — one line,
   passing every existing test. The dunning job is the only translator from `billing_state` to
   `status`, and it calls the existing `TenantLifecycleService.suspend`.
   `SUSPENDED_ALLOWED_PREFIXES` is checked **after** the status resolves, never before —
   putting `/api/v1/billing/` into `PUBLIC_PREFIXES` would skip the status check for everyone.
7. **Delete `TierStorageProperties`** (C12). Add `GET /internal/auth/tenants/{id}/user-count` —
   13-14's "auth-service exposes no tenant user count" is now stale (`GET /internal/auth/users`
   already returns `meta.totalCount`), but a dedicated endpoint is ~1 day and closes the
   downgrade guard's user half without shipping a page of emails to answer one integer.
8. `TierLimits.Limits` gains the new ceilings as a **deliberate compile-time break** at both
   call sites — a ceiling nothing stamps is exactly the `storage_gb` bug.
9. **The SuperAdmin console frontend** — the entire platform plane is API-only today
   (`platform/dashboard/page.tsx` is nine lines, and `sidebar-nav-items.ts` links
   `/platform/tenants` without `comingSoon`, so it is a live 404). Tenant list/detail/create,
   lifecycle, tier change with a forced-over-limits confirmation, per-feature toggles,
   per-quota overrides, usage dashboards with `asOf` on every meter (a dashboard silently mixing
   real-time counters with 5-minute-stale gauges is how an operator makes a wrong call),
   threshold alerts, invoices with manual reconciliation, impersonation.
10. Server computes `pct` and the band enum; the client never re-derives them — thresholds are
    tenant-overridable, so a client computing `used/limit` is wrong for every tenant with an
    override.

**Parallel with:** 22, 24, 25, 31.

---

#### Phase 22 — Screen rebuilds · **16 days** · after 20 · Track: C

**Goal:** the five screens a buyer judges the product by.

**Services:** frontend only.

**Scope, in this order:**
1. **POS terminal** into `app/(operator)/pos/**`, escaping the padded, animated back-office
   shell. Vertical category column (a 40-category restaurant wraps horizontal pills into three
   rows and destroys the grid), 56px tiles, 360px ticket panel, 72px action buttons, roving
   tabindex + arrow-key grid navigation, a keyboard mode for counter billers. **Keep
   `cart-reducer.ts`, the lazy-persist `clientOrderId` idempotency, the offline outbox and the
   `sendInFlightRef` guard untouched.** Render the Phase 19 service profile: fire/charge actions
   appear per `fire_trigger`, tender list per `allowed_tenders`.
2. **Warm the offline menu cache** — `frontend/lib/offline/menu-cache.ts` has `saveMenu`/
   `getMenu` and **zero callers**, so a terminal that drops network cannot draw a menu and the
   well-built IndexedDB outbox behind it is unreachable. Calling it from the menu hook's
   `onSuccess` is the highest value-per-line change in the frontend.
3. **KDS board** into `app/(kitchen)/kitchen/**`, which removes the `min-h-screen` + `.dark`
   hacks as a side effect. Bump-bar focus model (USB bump bars enumerate as HID keyboards, so
   keyboard bindings *are* bump-bar support). Item lines at 22px, **modifiers bold and inline** —
   the current comma-joined truncated line is unreadable at two metres. **Keep
   `getAgingTreatment`'s `escalationThresholdSeconds` fraction logic exactly** — it is more
   principled than the industry's fixed 5/8-minute convention.
4. **Role dashboards** as a `PortletGrid` with Owner / Manager / Cashier presets shipped as
   *data*. An owner's dashboard answers "is the business healthy?"; a manager's answers "what
   needs me in the next five minutes?". The current four neutral cards serve neither.
5. Convert the ~30 hand-rolled `<table>` files to `DataGrid`, after proving it on three that
   stress different axes (PO list = facets + bulk approve; stock = inline edit + volume;
   journal entries = grouped rows + date-range facet).
6. **Shell and navigation last** — a two-tier space rail replacing the 25-item scroll, a global
   search reaching *business objects* not three hardcoded page names, the fixed profile menu,
   deleting the page transition, and closing the four dead links.
7. Restyle the Phase 16 settings screen.

**Parallel with:** 21, 24, 25, 31.

---

#### Phase 23 — Admin and missing-UI surfaces · **11 days** · after 17, 16, 20 · Track: B/C

**Goal:** every API with no caller has a screen, and the UI never lies about state.

**Services:** frontend, plus small API gaps in user/hr/pos.

**Scope:** wastage entry (**a restaurant cannot run food cost without spoilage, and
`inventory.repository.ts` has no `/wastage` call at all**); user/RBAC admin — create user,
assign per-branch role, deactivate (**nobody can create a staff login through the UI today**);
HR leave request and approval (the client functions are *already written* at
`hr.repository.ts:185-211` — this is pages only); branch CRUD including the new NTN/STRN fields;
POS station admin (the backend is built and `StationAdminIT`-covered, and
`pos.repository.ts` has **zero** station references); dining-table and floor-plan admin;
HR device registration; CRM feedback; file attachments. Plus the trust contract: a shared
`QueryBoundary` primitive with a lint rule so a failed query can never render as an empty state,
`error.tsx`/`loading.tsx`/`not-found.tsx`, a React error boundary, and the POS fire-to-kitchen
failure path that must not clear the cart.

**Also here:** the frontend has **no handling for `403 PASSWORD_CHANGE_REQUIRED`** (zero
matches repo-wide), which every provisioned admin's first login returns. Until this lands, no
newly provisioned tenant can log in through the browser at all — it blocks onboarding entirely.

**Parallel with:** 24, 25, 26, 31.

---

### Milestone C — Sell it and onboard it

---

#### Phase 24 — Real goods receipt · **8 days** · after 14, 15 · Track: B

**Goal:** goods receipt stops being a simulator.

**Services:** purchasing, inventory, finance.

**Scope:** a real `Grn`/`GrnLine` entity and receipt workflow with partial receipt, over/under
tolerance and reversal; `GET /internal/inventory/po-lines/{poLineId}/grn-summary` — **the
endpoint the Feign client has always declared and no service has ever served**; flip
`integration-mode` to `feign` and delete `MockGrnController` + `GrnReceiptSimulator`; three-way
match against real GRN data; replace purchasing's hardcoded account literals
(`1300`/`1700`/`1710`/`2100`) with `system_tag` resolution so a tenant-edited chart of accounts
cannot break it silently; carry a real `expiryDate` on `GrnLine` (hardcoded `null` today, which
is why the entire expiry subsystem is inert for purchased stock) and validate vendor
`pack_uom` against inventory's UOM registry at catalog-save time.

**Note:** `integration-mode` defaults to `mock` and no YAML anywhere sets it, so mock-receive is
**load-bearing for every stock lot in the system**. Flipping it without this phase 404s the
entire receiving flow.

**Parallel with:** 21, 22, 23, 25, 31.

---

#### Phase 25 — Notifications and alerting · **8 days** · after 17 · Track: B · needs **U6** for production only

**Goal:** the platform can tell somebody something.

**Services:** notification (built from nothing — it is `pom.xml` + `README.md` today).

**Scope:** a provider-adapter interface with a `LogOnlyAdapter` default and an SMTP adapter
pointed at the mailpit already running in `deploy/docker-compose.yml:210`; templates; consumers
for the six orphaned auth events (**password reset is end-to-end dead today** — tokens are
minted with no consumer to deliver them), `LOW_STOCK_ALERT`, `EXPIRY_ALERT`,
`DEPLETION_INCOMPLETE`, `TRANSFER_VARIANCE`, `TENANT_USAGE_THRESHOLD_CROSSED`; in-app
notification storage behind the stub bell in `top-bar.tsx`; retry and DLQ. Swap in the real
provider when U6 arrives — one config change.

**Parallel with:** 21, 22, 23, 24, 26, 31.

---

#### Phase 26 — Waste capture and control · **20 days** · after 17, 16 · Track: B

**Goal:** spoilage, over-portioning and staff meals are recordable, classifiable, approvable
and correctly journalled — and lots stay honest.

**Services:** inventory, finance, frontend.

**Scope:**
1. **`wastage_reasons` becomes a tenant-scoped table**, replacing the hardcoded `CHECK` in
   `V11__stock_wastage.sql` which cannot express `OVER_PORTIONING` or `PREP_ERROR` — the two
   reasons a food-cost investigation most needs. Flags: `is_controllable`, `in_food_cost`,
   `gl_account_id`, `approval_threshold_paisa`, `requires_photo`. **Exclude non-food-cost
   reasons (staff meal, marketing comp, training) from food-cost %**, or staff meals inflate
   food cost and managers learn to distrust the number.
2. **Approval above a tenant-set value**, with `approved_by != recorded_by` (purchasing's
   `DuplicateApproverException` is the existing precedent). **Move the stock immediately, gate
   the ledger** — the food is already in the bin, and a pending write-off that does not reduce
   `qty_on_hand` means book stock is knowingly wrong and the variance report silently absorbs
   the difference and blames it on theft. Hold `WASTAGE_RECORDED` (and therefore the journal
   entry) until approval; finance's existing `alreadyPosted(SOURCE_WASTAGE, wastageId)` dedupe
   makes that retry-safe. Reject by writing a compensating record with
   `reversal_of_wastage_id` — never a DELETE, never an in-place mutation.
3. **Per-line GL account codes on `WastageRecordedPayload`**, resolved by the existing
   `CategoryGlAccountResolver` with a reason-level override. This is what finally makes
   `ItemCategory.default_waste_account_id` — shipped in V8 — do anything, and stops a staff meal
   debiting Waste & Spoilage. Also: `WastageRecordedPayload` gains `lines[]`, the single
   highest-leverage event change in the programme (it currently collapses a multi-line write-off
   into one aggregate).
4. **Wastage touches lots.** `WastageService` has no `StockLotRepository` dependency at all,
   which is also why the nightly expiry sweep loops forever on any written-off lot. Reuse
   `DepletionService.walkFefoAndFloor` (already `public static` with its own test, precisely so
   it can be driven without a Spring context) and add
   `.thenComparing(StockLot::getReceivedAt)` so FEFO degrades to true FIFO for null-expiry lots
   instead of an arbitrary query order.
5. Derive expiry from `ingredients.shelf_life_days` when a receipt supplies none. Add the
   missing divide-by-zero guards: `recipe_lines.yield_pct` and `recipes.yield_servings` are both
   divisors and both currently permit `0`.
6. `stock_counts.count_type` (FULL/CYCLE/SPOT) — without it a three-line spot check is
   indistinguishable from a full inventory and the variance report is noise.
7. Dedicated OPA actions `inventory.wastage.record` / `.approve` / `.configure`. Today writing
   off stock and editing an ingredient are literally the same authority, at any value.
8. `depletion_gaps` persisted in the same transaction as depletion — uncovered sales. Without
   it the variance report blames a missing recipe on the kitchen and loses credibility the first
   time someone notices. **`DEPLETION_INCOMPLETE`'s unknown-UOM `IllegalStateException` becomes
   a skipped line folded into the event** — throwing DLQs the message and stops depleting the
   whole order.

**Parallel with:** 21, 22, 23, 24, 25, 31.

---

#### Phase 27 — Financial statements, COGS and exports · **15 days** · after 14, 24 · Track: B

**Goal:** an accountant can close a month.

**Services:** finance, reporting.

**Scope:** `journal_facts` and inventory fact tables plus consumers for currently-unconsumed
events; **P&L, Balance Sheet, labelled Trial Balance**; real COGS and gross margin on
sales-by-item (`ReportService.java:81` admits both are missing, and
`SalesFactWriter.java:91-93` writes literal NULL for `cogs_paisa`, `gross_margin_paisa` and
`category_name`); food-cost % and labour-cost %; stock valuation as-of a date; wastage; daily
cash-up / Z-report; tender mix; sales-by-category; purchase-spend-by-vendor; CSV **and** PDF
export on every report. Extend `ClickHouseSchemaGuard.REQUIRED_FACT_TABLES` in the same change
or the guard silently stops guarding.

**Parallel with:** 22, 23, 26, 28, 30, 31.

---

#### Phase 28 — Analytics facts and the NLQ metric layer · **24 days** · after 24, 26; needs 27's fact conventions · Track: B

**Goal:** the six owner questions in the brief become answerable, deterministically.

**Services:** reporting, nlq, inventory, pos, purchasing, shared-lib.

**Reality being extended:** nlq-service is real, working and well-defended — a 7-stage AST
pipeline with the tenant predicate injected *and proven by re-parse*, a locked-down
`nlq_readonly` ClickHouse user with per-table GRANTs, `NlqServiceIT` against real containers and
`SqlInjectionAttackTest` covering 25 adversarial cases. **The problem is not safety, it is
scope:** NLQ can see exactly four fact tables, reporting binds only `pos.topic` and
`purchasing.topic`, and none of the six questions is answerable today.

**Scope:**
1. **Never relax the SQL shape; widen the facts instead.** `requireSupportedShape` (single
   `PlainSelect`, no CTE/JOIN/subquery, bare `Table` FROM) is what makes the tenant predicate
   provable; allowing JOINs would mean proving it on every arm. Every new question must reduce
   to `SELECT … FROM <one wide fact> WHERE … GROUP BY … LIMIT n`.
2. **New ClickHouse facts:** `waste_facts` (one row per *line*), `inventory_movement_facts`,
   `stock_count_facts`, `order_cogs_facts`, `menu_item_pnl_facts` (nightly rollup),
   `daily_pnl_facts`, `purchase_price_facts`, `stock_position_facts`, `order_void_facts`, plus
   `stock_variance_facts` **projected from inventory's computed periods** (§2 C5). Plus
   `dim_ingredient` / `dim_menu_item` / `dim_user` / `dim_vendor` — because JOINs are forbidden
   the name must be in the fact, and because narration must not invent names the dimension must
   exist. "Ingredient 8f3c… cost you ₨12,400" is useless to an owner.
3. **A curated `nlq_metrics` routing layer** above free-form SQL, modelled on `ReportCatalog`'s
   proven pattern. Claude routes (metric code + params as structured JSON) instead of deriving
   formulas. Food-cost % has one correct formula, and a model re-deriving it per question ships
   numbers an owner acts on and that are wrong. Free-form survives as the long-tail fallback
   through the unchanged validator, logged separately so the routed/free-form ratio is
   measurable.
4. **Role-scoped `nlq_denied_columns`** replacing the single global PII deny-list, so identity
   columns (`voided_by`, `cashier_id`, `recorded_by`) can be readable by OWNER — who
   legitimately asks "which staff void the most orders" — and denied to MANAGER, instead of
   today's all-or-nothing that makes the question unanswerable for everyone. Note the current
   deny-list inspects `SELECT` items only.
5. **`nlq_table_features(table_name, feature_code)`** — orthogonal to the existing role-keyed
   `nlq_allowed_tables`, which V1 explicitly warns against adding RLS to. A table is queryable
   iff role is allowed **and** the tenant has the feature. No new feature codes needed.
6. **Tenant opt-out for narration.** `ClaudeClient.narrate` unconditionally posts the question
   plus up to 20 result rows to `api.anthropic.com` with no redaction and no opt-out. For a
   product carrying FBR tax data this needs an explicit decision (U11) and a switch.
7. **Ship wave 0 first — it needs zero new capture:** the `DEPLETION_INCOMPLETE` consumer
   ("X% of your sales have no recipe") and till-variance-by-cashier. Both make every later COGS
   number trustworthy, and both are answerable from data already flowing.
8. `INVENTORY_MANAGER` currently has **no `nlq.query.run` grant** and an empty allowlist.
   Granting them waste/stock tables needs **both** a `role_permissions` row and allowlist rows —
   miss either and the feature is invisible and looks exactly like the one-wrong-JWT-claim
   failure this project has hit before.
9. Rollup jobs discover tenants from ClickHouse (`SELECT DISTINCT tenant_id …`), since
   ClickHouse has no RLS — simpler than cloning inventory's registry table. `ExpirySweepService`
   documents that a `@Scheduled` job sees zero tenants through FORCE RLS and "would silently
   no-op forever".

**Parallel with:** 29, 30, 31, 32.

---

#### Phase 29 — Guided tenant onboarding · **30 days** · after 16, 17, 19, 22, 23 · Track: B/C

**Goal:** a new tenant goes from provisioned to taking a real order, guided, resumable, and
without a DBA.

**Services:** user, pos, finance, inventory, frontend.

**Reality:** there is **no onboarding of any kind** — `frontend/` contains zero files matching
onboarding/wizard/setup-flow, no service has an onboarding-progress table or endpoint, and the
only two things that exist are a SuperAdmin-only provisioning saga and
`scripts/onboarding.py`, a 510-line dev seeder that writes three databases directly as superuser
and whose feature list has already drifted from `TierFeatureDefaults` (15 codes vs 20), so
seeded tenants silently 403 on the missing ones.

**Scope:**
1. **Two planes.** SuperAdmin provisioning stays the control plane; the onboarding product lives
   entirely in the tenant plane. `PlatformAdminController` is class-annotated `SUPER_ADMIN`, so
   no tenant owner can ever call it.
2. **A checklist of independently completable cards after a three-step mandatory prelude**
   (login, business profile, service model) — not a linear wizard. Only those three are linear
   because only those three genuinely constrain the next step; an artificial dependency is
   indistinguishable from a real one to the user.
3. **"You can take an order" is an explicit celebrated milestone** separating Activation
   (steps 1–8) from Optimisation (9–13). A café that never touches inventory or FBR must be able
   to reach 100% without a permanent red badge.
4. **Completion is DERIVED from real counts wherever a count exists** (menu items, tables,
   stations, users, recipe coverage, first closed order) and **declared** only for decisions that
   produce no row. Derivation is pull-on-demand (`POST /api/v1/onboarding/refresh` fans out over
   HTTP), not event-driven — an event consumer per step means a new outbox correlation per step
   for a screen visited a handful of times. **A failed derivation marks the step `unknown` with
   a reason, never silently `NOT_STARTED`** — reporting "you haven't built your menu" because
   pos-service blipped is the same class of lie as the deleted `requireBranchId` fallback.
5. **Business type selects a visible, editable preset bundle** (C14) — never a hidden behaviour
   change. Every preset value lands in a form field the operator sees before saving.
6. `user_db.onboarding_steps` with **ENABLE + FORCE** RLS (stated explicitly: a non-FORCE table
   would pass a Testcontainers test that proves nothing until Phase 18 lands).
7. **CSV menu import**: preview-then-commit with per-row diagnostics and an idempotent commit
   keyed by `uploadId`. All-or-nothing import on a 200-row menu is unusable, and a re-submitted
   commit must not double the menu. Parse decimal currency to `long` paisa once, at the edge,
   and reject >2 decimal places rather than rounding silently.
8. `tenant_payment_methods` (which of the enum a tenant enables, ordering, labels — the enum is
   compile-time today, and `charge-summary.tsx`'s literal silently omits `CHARGE_TO_ACCOUNT`);
   `dining_sections` (there is no floor/section/zone concept at all today); modifier admin
   (schema exists since V1, no API).
9. Reuse the existing permission codes `branch.manage`/`rbac.manage` rather than minting new
   dotted codes; feature flags **hide** inapplicable steps rather than showing them and letting
   them 403.
10. `scripts/onboarding.py` is kept and explicitly scoped as a CI fixture, with its drifted
    feature list replaced by a platform API call. It must not be generalised.

**Parallel with:** 28, 30, 31, 32, 33.

---

### Milestone D — Pakistan, hardware and depth

---

#### Phase 30 — Receipt and kitchen printing · **18 days** · after 16, 22 · needs **U3** for sign-off · Track: E

**Goal:** a receipt prints, the paper cuts, the drawer kicks, and the kitchen ticket prints even
when every browser tab is closed.

**Services:** new print-agent, pos, user, frontend.

**Architecture — do not relitigate.** All four browser-direct transports were checked and each
fails a hard till requirement: WebUSB is dead on Windows because `usbprint.sys` claims the
printer exclusively and it will never exist in Safari; Web Serial cannot see a USB
printer-class device and Firefox 151+ requires a per-site permission add-on; `window.print()`
cannot kick a drawer, cut, choose a printer or report success; browsers have no raw TCP.

**A per-branch print agent owning the ESC/POS renderer and a durable SQLite queue, fed identical
semantic `PrintDocument` JSON by both pos-service and the POS tab, reaching printers over
`socket://ip:9100`. The browser never emits a byte.**

**Scope:** the `PrintDocument` schema in shared-lib + a mirrored TS type; the renderer with
**golden-byte tests** (`1B 40` init, `1D 56 42 00` feed+partial cut, `1B 70 00 32 FA` drawer
kick) which need no printer; agent v1 (loopback + LAN listener, SQLite queue with the same
`MAX_ATTEMPTS = 5` dead-lettering as the frontend outbox, `/health`, `/printers`,
`/test-print`); **server-side dispatch on `POST /orders/{id}/close` and `/send-to-kds`** —
kitchen routing belongs on the server, which already knows station assignments, and this is the
single biggest reliability win because the kitchen prints even if the front-of-house tablet
died; the client bridge using `fetch(..., { targetAddressSpace: 'local' })` with explicit Chrome
Local-Network-Access denial handling; the `@page { size: 80mm auto; margin: 0 }` fallback; a
`receipt_config` admin UI with a Test Print and a **column-ruler calibration print** —
columns-per-line is measured per printer, never hardcoded. This is where Phase 19's
forward-declared `receipt_trigger` / `prints_kot` / `prints_queue_token` become live settings.

Do **not** make QZ Tray the architecture (silent printing needs a purchased certificate, it dies
when the tab closes, and it is one agent per machine). Support it as an optional adapter.

**Parallel with:** 28, 29, 31, 32, 33.

---

#### Phase 31 — Biometric attendance repair · **4 days** · after **U5** · Track: E · **parallel with everything**

**Goal:** the ADMS adapter a stock terminal can actually walk.

**Services:** hr, gateway.

**Scope:** implement U5's chosen authentication design (a stock ZKTeco terminal's ADMS menu
accepts only an address and a port — it **cannot** send `?token=`, which the current resolver
requires, so the integration is unimplementable as built); **W8** — device-auth failures return
HTTP 500 because the shared `@ExceptionHandler(Exception.class)` beats `DeviceAuthException`'s
`@ResponseStatus`, producing a stack trace at ERROR level on every 3–8 second poll while the
gateway circuit breaker (configured for 503) never trips; **W9** — an ATTLOG POST with
`Content-Type: application/x-www-form-urlencoded` returns `200 OK` and writes **zero rows**,
silently; return `OK` from an empty command queue; accept Unix-epoch timestamps and 3-field
lines rather than dropping them silently; set `restaurantos.hr.device-server-url` so
registration stops handing installers `https://REPLACE-WITH-GATEWAY-HOST/iclock`; per-device
timezone replacing the hardcoded `Asia/Karachi`; clock-skew and stale-device alerts; a human
double-punch debounce.

**The centrepiece deliverable is `AdmsHttpContractIT`** — a `RANDOM_PORT` test driving real HTTP
with `HttpClient` pinned to `HTTP_1_1`. The existing `AdmsIngestIT` calls the controller as a
Java method and therefore **cannot see any of these four defects.**

**Parallel with:** everything. hr-service + gateway only.

---

#### Phase 32 — Multi-POS terminals and KDS/BDS routing · **22 days** · after 19, 22 · Track: B

**Goal:** one branch runs several terminals with independent station routing, per-terminal till
binding and course firing.

**Services:** pos, kitchen, frontend.

**Scope:**
1. **Two entities, not one:** `pos_terminals` (profile — referenced by orders forever) and
   `pos_terminal_devices` (the physical binding — replaced when it breaks), mirroring the
   existing `AttendanceDeviceEntity` precedent.
2. `pos_terminal_categories` where **empty means serves everything** — the only encoding where
   a tenant who never opens the config screen keeps today's exact behaviour. State explicitly
   that the category list is a **UI filter, not an authorization boundary**; a real boundary
   belongs in OPA with its own rego and tests.
3. **`terminal_id` is an attribution hint, never an authorization input.** For financial
   decisions read the terminal from `till_sessions.terminal_id`, set at till-open time under
   the branch guard. Keep `orders.terminal_id` as the **origin** terminal and derive the
   **settlement** terminal via the till session — post-13-16 a waiter's handheld order is
   legitimately settled at a different counter, and overwriting one with the other destroys a
   true fact.
4. **`stations.station_type` (KITCHEN/BAR/EXPO) defaulting to KITCHEN** — the default *is* the
   back-compat story. **BDS is not a new service**: `station_code` is already opaque end to end,
   so kitchen-service already renders a BAR station. What is missing is the discriminator needed
   for board scoping, bartender permissioning and the admin's mental model. Reuse
   `StationBoard`; do not fork it.
5. **Fix the live cross-branch corruption:** `menu_items` is tenant-scoped with a single
   `station_id` column while `stations` is branch-scoped, so an admin at branch B assigning a
   station silently re-points the same item — and overwrites `kds_station` — for branch A.
   New `menu_item_station_routes` and `menu_category_station_routes` keyed
   `(tenant_id, branch_id, …)`; category routes collapse a 200-row chore into one row.
6. Swap `uq_open_till_per_cashier` for `uq_open_till_per_terminal`; replace the ambiguous
   `Optional` lookup with `resolveOpenTill(cashierId, terminalId)` throwing a new **409
   AMBIGUOUS_TILL** rather than silently picking a drawer — putting cash in the wrong drawer is
   worse than 13-16's bug of making it invisible. Shift handover closes A, opens B on the same
   terminal with A's counted cash as B's float, and re-points **only** orders with zero payments.
7. `order_items.course_no` with a nullable `courseNo` on `sendToKds` where null means "fire
   everything" — byte-identical to today, so no existing IT changes.
8. **Append `stationType` and `courseNo` to `KdsItemPayload` and kitchen-service's
   `OrderSentToKdsItem` in the SAME COMMIT** — the payload javadoc states field-name parity is
   the only enforcement and a mismatch silently drops every message. A staged two-commit rollout
   is a guaranteed outage.
9. Fix the split-order `ORDER_READY` half-signal on the **consumer** side (treat it as "all
   stations done" and advance all eligible lines) rather than changing the payload.
10. **Never queue `sendToKds` offline** — firing is a message to a human at another machine, so
    queueing means the cashier sees "sent" and the kitchen sees nothing.

**Parallel with:** 28, 29, 30, 33.

---

#### Phase 33 — Usage variance and recipe costing · **22 days** · after 24, 26 · Track: B

**Goal:** an owner can see, in money, the gap between what the recipes say should have been used
and what was actually used — and can trust it.

**Services:** inventory, finance, reporting.

**Scope:**
1. `usage_variance_periods` + `usage_variance_lines`, computed as an aggregation over
   `inventory_movements` between two POSTED stock counts. **No new movement types, no new
   events, no new write path** — `DEPLETION` movements already *are* theoretical usage, so the
   report cannot disagree with the COGS finance already posted.
2. **Decompose into recorded waste, transfer variance, uncovered sales and unexplained, and rank
   by unexplained cost in paisa, not by percentage** — a 40% variance on saffron and a 2%
   variance on cooking oil can be the same money. Compute variance % against *theoretical usage*
   (the industry convention, and the only one where "3% variance on flour" means what a chef
   expects).
3. **State count coverage in the report header** ("127 of 214 items counted, 89% of stock
   value") and list uncounted items separately. An uncounted item has no variance, not a zero
   variance; folding it in is how these reports lose trust permanently.
4. **Never present unexplained variance as theft.** Present it as unexplained, ranked, with a
   confidence statement ("based on 2 counts 11 days apart") and the three candidate causes.
   Over-portioning and theft are not separable from the ledger.
5. Snapshot totals on period close, so a backdated movement cannot rewrite a period a manager
   was held to. Plus `GET /variance/preview` (last POSTED count to now) — a formal period close
   means the chef sees the number a week late, which matters more than it looks.
6. `recipe_cost_snapshots` **per recipe version and per branch** (MAC is per branch; a
   tenant-level plate cost is a fiction), giving the history that answers "why did this dish go
   from 28% to 34% in six weeks". **Suppress any plate cost with `excluded_line_count > 0` from
   aggregates** — a cost missing two ingredients is worse than no cost.
7. Report **both** food-cost percentages side by side — menu-engineering (Σ portion cost × units
   sold ÷ revenue) and actual (opening + purchases − closing ÷ revenue). The gap between them is
   the variance expressed as a percentage of sales, which is the single most useful number an
   owner can be handed.
8. `ingredients.default_yield_pct` becomes the default for a **new recipe line at authoring
   time** and is never applied again at depletion — multiplying both at runtime double-counts
   trim for every chef who already typed the trimmed weight, and is invisible when it happens.
9. Per-branch `ingredient_branch_pars` with most-specific-wins resolution, derived from trailing
   `|DEPLETION|` usage plus lead time and safety stock, surfaced as a **suggestion a manager
   accepts** rather than applied silently.
10. `/internal/inventory/variance-summary` for reporting-service to project (§2 C5).

**Parallel with:** 29, 30, 32, 34.

---

#### Phase 34 — Insight engine · **16 days** · after 28, 33 · Track: B

**Goal:** the system tells the owner what changed, unprompted.

**Services:** reporting, frontend.

**Scope:** `insight_rules` (tenant-overridable thresholds, `NULL tenant_id` = platform default)
and `insights` with **`dedupe_key (rule|branch|subject|period)` under a unique index**, per-subject
snooze, and minimum-volume guards on every ratio — an engine that re-raises the same finding
nightly gets muted by users within a week. Detectors: usage variance spike, waste ratio, margin
drop, void-rate sigma by staff, vendor price increase, stock-out risk. An `INSIGHT_RAISED` frame
on the existing dashboard WebSocket, throttled through the existing `TilePushThrottle`
leading-edge + trailing-flush contract. Acknowledge / dismiss / snooze with an audit trail.

**Parallel with:** 29, 30, 32, 35, 36.

---

#### Phase 35 — FBR / provincial digital invoicing · **20 days** · after **D1**, **U1**, **U2**, 16, 30 · Track: E

**Goal:** a closed sale is fiscalised without ever blocking the till.

**Services:** new fbr-service (or a finance-service module), pos, frontend.

**Prerequisite that is not code: resolve D1.** Restaurant sales are **services**, taxed
provincially at ~15% by SRB (Sindh) / PRA (Punjab), **not** by FBR — except in Islamabad Capital
Territory. The provincial e-invoicing APIs were not researched at all. **FBR DI may be the wrong
target for the sales side entirely.** Getting this wrong invalidates the whole 20-day
workstream. Design the submission table with a `regime` column so a second authority is a row
value, not a migration.

**Four schema unknowns must be closed against a live sandbox token, each of which forces a
rewrite if guessed:** what the QR encodes (the spec gives version 2.0 / 25×25 at 1.0 inch and
**nothing about the payload**); what an offline receipt must display in place of the fiscal
number; whether a seller-supplied invoice number is required (error codes say yes, the sample
JSON says no); and **how an unregistered walk-in diner satisfies the Required
`buyerBusinessName`/`buyerProvince`/`buyerAddress` fields** — the single most likely hard blocker
for restaurant use.

**Scope:** `fbr_credentials` (RLS, `api_token BYTEA` via the existing `EncryptedStringConverter`,
unique per tenant+branch+environment, defaulting to SANDBOX) with a **startup assertion on
`restaurantos.encryption.key`**; `fbr_submissions` with `UNIQUE (tenant_id, order_id,
document_type)` as the idempotency key, `request_json` **frozen at close and never recomputed**,
and the five-state `PENDING/IN_FLIGHT/FISCALISED/REJECTED/DEAD` machine — `REJECTED` (our data
is wrong, retrying never helps) is a different thing from `DEAD` (we could not reach them). One
guarded INSERT in `performClose` behind three fail-closed conditions (feature on **and** active
credential **and** non-null branch NTN), so nothing changes for any existing tenant.
**Ship in shadow mode first** — build and persist `request_json`, do not POST.

**Three non-negotiable client rules:**
- Success is `invoiceNumber` non-empty **AND every `invoiceStatuses[].statusCode == "00"`**.
  Never branch on the outer `statusCode` — the spec's own sample shows `"00"` on a *failed*
  invoice.
- **Failures arrive as HTTP 200.** Any client branching on `isSuccessful()` records rejected
  invoices as fiscalised.
- **The token selects the environment, not the URL.** A credential-selection bug silently files
  test invoices as real ones. Enforce `environment` ourselves.

**Never block the sale.** Rules 150T–150XD explicitly permit issuing offline and uploading
within 24 hours. `performClose` runs inside a transaction holding order locks, *after money has
been taken* — a PRAL slowdown there converts a third-party outage into a dead till. Model the
**72-hour amendment cutoff** in the void/refund UI: beyond it a void is a Commissioner petition,
not a system operation, and the UI must say so.

**Parallel with:** 32, 33, 34, 36.

---

### Milestone E — Guest surfaces and scale

---

#### Phase 36 — Guest ordering: QR at table, kiosk, online · **38 days** · after 18, 19, 22, 30 · needs **U8** for the PAY_FIRST half · Track: B/C

**Goal:** a diner orders from their own phone at the table, from a kiosk, or online — without
weakening the gateway's authentication boundary by one line.

**Services:** pos, auth, gateway, frontend.

**Scope:**
1. **Every guest device gets a real, signed, tenant-bearing RS256 JWT.** `TENANT_OPTIONAL_PATHS`
   stays at exactly one entry, `WS_UPGRADE_PATHS` is untouched, and only **two** fully-qualified,
   self-authenticating `PUBLIC_PATHS` entries are added: the session mint (gated by a 160-bit
   hashed QR/device token) and the PSP webhook (gated by HMAC over the raw body). Because the
   guest token carries `tenant_id`/`branch_id`, the gateway injects `X-Tenant-Id` normally and
   `FeatureFlagGlobalFilter` still enforces suspension and the feature flag — the exact thing a
   token-free guest surface would lose (and does lose today on `/iclock`, defect D1, fixed in
   Phase 17). Tighten `isPublicPath` to segment-boundary matching (verified safe for all 11
   current entries).
2. **Guest permissions are compiled into `signGuestToken` and are never a parameter**, mirroring
   `signPlatformToken`. The `permissions` claim holds no `pos.*` code, so all 50
   `@PreAuthorize`-gated `/api/v1/pos/**` mappings deny it. New `guest.*` permission rows
   granted to **no role, ever**, with an inverse test asserting no `role_permissions` insert
   references one.
3. **Two-level sessions:** `table_sessions` (per seating, shared cart, one open per table via a
   partial unique index) and `guest_sessions` (per device, individually revocable).
4. **`FIRE_ON_STAFF_ACCEPT` is the shipped default** — one tap removes the entire "unauthenticated
   stranger makes the kitchen cook food" loss class. Uses `PENDING_ACCEPT` (F3/C3). Guest orders
   are explicitly visible to any staff holding `pos.order.view` in the branch — otherwise a NULL
   `cashier_id` makes QR orders invisible to the very people who must accept them.
5. **Guest carts are a separate `guest_carts`/`guest_cart_items` pair, never DRAFT orders**, and
   `guest_cart_items` deliberately has **no price column** — a cached price goes stale against a
   menu edit, and a column that exists is a column something will eventually trust. Prices
   resolve at read and again at placement via `OrderPricingCalculator`.
6. **`createGuestOrder` as a second entry point sharing a private seam with `createOrder`** —
   because `createOrder` reads `tenantContext.getUserId()`, which for a guest token is the
   session id, and would write it into `orders.cashier_id` (no FK, so it would silently succeed)
   and poison the own-vs-all order filter.
7. **The browser never asserts payment:** order → server-created `guest_payment_intents` row with
   the amount copied from `orders.total_paisa` in-transaction → PSP → signed server-to-server
   webhook → **exact amount equality** → `recordPayment` → fire. A mismatch sets `MISMATCH` and
   alerts rather than recording a partial payment.
8. Adaptive polling with ETag for order status — not WebSocket (would widen the query-param-JWT
   boundary on the most hostile surface) and not SSE (blocked by the 5s `posCircuitBreaker`
   timelimiter, and that interaction is unverified). The in-store now-serving board is a
   **staff/branch device surface**, not a public one: a public endpoint listing every current
   order code for a branch is a free enumeration oracle.
9. Kiosk tokens live 5 minutes (vs 30 for QR/online) and are killed by a 45-second attract loop.
   Kiosk cash is unsupported, and the existing code already enforces it for the right reason.
10. Rate limiting is layered — nginx → gateway per-IP → pos-service per-session/table/branch,
    with the **authoritative** limits inside pos-service, because Pakistani carriers CGNAT
    heavily so a purely per-IP limit is both evadable by a botnet and harmful to one busy
    restaurant's guests. **Order buckets fail closed on a Redis outage while read buckets fail
    open** — browsing a menu during a blip should not break service; an unmetered order path is
    a loss event.
11. `branch_guest_config` with every surface defaulting **FALSE**. A customer-facing surface that
    turns itself on is a surprise nobody wants.

**Explicitly not configurable:** whether prices come from the server; whether the PSP webhook
signature is verified; whether tenant scoping applies; the kiosk TTL. *A setting that can disable
a security control is a security control that does not exist.*

**Prerequisites already handled elsewhere:** modifiers priced correctly (Phase 17 W4), `pos_db`
FORCE RLS (Phase 18), POS WebSocket route (Phase 17).

**Parallel with:** 34, 35, 37.

---

#### Phase 37 — Scalability and operability · **22 days** · after 15, 18 · Track: D

**Goal:** the fleet can run more than one replica of anything, and an operator can see why it is
unhappy.

**Services:** all, shared-lib, gateway, deploy.

**Scope:**
1. **Three pieces of per-process state block horizontal scaling:** the WebSocket subscriber maps
   in pos/kitchen/reporting; the outbox relay, which has a plain `SELECT` with **no row locking**
   and would N-times-publish every event; and single-threaded `@Scheduled` jobs firing on every
   replica. Fix: Redis pub/sub fan-out for sockets; `FOR UPDATE SKIP LOCKED` + publisher confirms
   + one row per transaction + `attempt_count`/`last_error` + the relay's **first tests**;
   ShedLock (JDBC) for crons, with idempotency staying in the service method because a lock is
   not a guarantee. `hr-013`'s `UNIQUE (tenant, subject, period)` is the existing replica-safe
   precedent and is preferred where it fits.
2. **Bounded waits, completed** (F10 landed the emergency half in 14): Hikari configuration in
   all 16 services (**zero configure it today**), request deadlines, graceful shutdown, a gateway
   `httpclient.response-timeout`, and `timeoutDuration` on the Resilience4j instances (none is
   set).
3. **Readiness and liveness that mean something.** `/actuator/health/liveness` and `/readiness`
   return a bare `{"status":"UP"}` on every service — verified live on three — and their default
   groups contain only in-JVM state enums that nothing in the repo ever publishes. Readiness
   (not liveness) carries the DB and Redis checks; a liveness probe failing on a DB outage causes
   a fleet-wide restart storm. Add a **thread-starvation liveness indicator** — because a
   DB-backed probe still would not have caught the actual incident.
4. Event-driven feature-flag invalidation (`TENANT_FEATURES_CHANGED` through the existing outbox)
   replacing the 300s TTL, so a SuperAdmin toggle takes effect in ~1s fleet-wide instead of
   drifting between gateway and service for up to five minutes.
5. **Deployment artifacts for the application tier, which do not exist.**
   `deploy/docker-compose.yml` contains only infrastructure — none of the 16 services. All 16
   Dockerfiles run as root, have no `HEALTHCHECK`, no JVM container flags, and rebuild the full
   reactor per image. Check `.dockerignore` exists (without it the build context includes a 4.7GB
   `.dev-logs/`).
6. Reconcile the session-scoped GUC design (`set_config` with `is_local=false`, deliberately
   chosen and documented) with PgBouncer transaction-mode pooling — the main lever for scaling 16
   services past one replica each against a 300-connection ceiling. **Naive adoption silently
   breaks RLS tenant isolation**; this is a design task, not a config change.
7. Resolve the **unexplained** auth-service wedge with a thread dump captured *during* a live
   wedge and read for thread **states** (BLOCKED vs WAITING vs TIMED_WAITING), not CPU time. Also
   re-read the original dump: "a fresh exec thread per request parking with ~0.04ms CPU" is
   equally the signature of *idle* Tomcat workers in `ThreadPoolExecutor.getTask()`.

**Parallel with:** 34, 35, 36.

---

#### Phase 38 — Production hardening and launch readiness · **10 days** · after all · Track: all

**Goal:** the system fails loudly and recovers.

**Scope:** queue-depth and DLQ-depth alerting; `SECURITY DEFINER` function-ownership verification
at deploy, promoted into the smoke suite; backup and restore rehearsal; a load smoke at expected
peak; secret rotation; the ten browser journeys in §6 all green and blocking; the meta-criterion
(F7) audited — every gate seen to fail once, with the procedure recorded.

---

## 4. Dependency graph

### 4.1 Real technical dependencies

```
14 Money/bus/timeouts ──┬──▶ 15 Verification spine ──┬──▶ 18 RLS + FORCE ──────────────┐
  (nothing blocks 14)   │                            │                                 │
                        │                            └──▶ 24 Real GRN ──┬──▶ 27 Statements
                        │                                               │
                        ├──▶ 16 TENANT CONFIG SPINE                     ├──▶ 33 Variance ──▶ 34 Insights
                        │      │  └─ kernel (day 8) ──▶ 19 Service models        ▲          ▲
                        │      │                            │                   │          │
                        │      ├──▶ 21 SuperAdmin+metering  │        26 Waste ───┘          │
                        │      ├──▶ 26 Waste control        │                               │
                        │      ├──▶ 30 Printing ◀───────────┼──── 22 Screens          28 Facts+NLQ
                        │      └──▶ 35 FBR ◀── 30           │           ▲                   ▲
                        │                                   │           │                   │
                        └──▶ 17 Reachability ──▶ 23 Admin UI ┘     20 Design system    24+26+27
                                   │                   │                 │
                                   ├──▶ 25 Notifications                 │
                                   └──▶ 36 Guest ◀── 18, 19, 22, 30      │
                                                                         │
                        19 + 22 ──▶ 32 Multi-POS/BDS                     │
                        16 + 17 + 19 + 22 + 23 ──▶ 29 ONBOARDING ◀───────┘
                        15 + 18 ──▶ 37 Scalability ──▶ 38 Launch readiness

31 Biometric — depends on U5 only. No code dependency on anything. Fully parallel.
20 Design system — depends on U7 (already delegated). No code dependency. Fully parallel.
```

**The critical path is `14 → 15 → 16 → 19 → 22 → 23 → 29` = 111 dev-days.** With the rework
multiplier that is ~144 days ≈ 29 weeks ≈ **7 months, and no amount of staffing shortens it.**

### 4.2 Why each real dependency is real

| Edge | Why it is technical, not preference |
|---|---|
| 16 → 19 | Service profiles are class-A settings; they need the registry SPI, revision table, cache discipline and scope resolver. Only the **kernel** (≈ day 8), not the whole phase. |
| 16 → 21 | Quotas are `tenant_quotas` rows and metering reads them. Without it the meter has no ceiling. |
| 16 → 30 | The print document renders `receipt_template` and branding from `tenant_profiles`. |
| 16 → 35 | The fiscal invoice needs tax codes and the NTN/STRN write path. |
| 17 → 36 | The POS WebSocket route, the tenant-scoped `client_order_id` and correctly-priced modifiers are all prerequisites the guest surface would otherwise ship broken on. |
| 18 → 36 | A public guest surface against a database where RLS is inert has no backstop. This one is a hard gate. |
| 19 → 32 | A terminal's service model *is* a service profile. Without 19 the terminal has nothing to configure. |
| 19 → 36 | Guest ordering is a service model. `PENDING_ACCEPT`, `channel` and `close_condition` all land in 19. |
| 20 → 22 | Screens need the primitives, tokens and DataGrid. |
| 24 → 33 | You cannot compute receipts-side variance from a simulator that hardcodes a null expiry. |
| 26 → 33 | Unexplained variance is `theoretical − actual − recorded waste`. Without recordable waste, "unexplained" absorbs it and the report accuses the wrong people. |
| 28 → 34 | Insights are detectors over the facts. |
| 22+23 → 29 | Onboarding drives every module's forms; it must not fork their validation. Also, until 23 handles `403 PASSWORD_CHANGE_REQUIRED`, a newly provisioned tenant cannot log in through the browser at all. |
| 30 → 35 | The fiscal receipt *is* the print document; the QR is stamped at dispatch. |

### 4.3 Sequencing preferences that are **not** technical dependencies

State these as preferences so nobody treats them as gates:

- **14 → 15.** The verification spine does not technically need the money fix. But landing an
  RLS-red suite on top of a live arithmetic defect makes harness-red and real-red
  indistinguishable, and 14 is five days. *Strong preference, real rationale.*
- **14 → 16, 14 → 17.** Convenience only. Both could start immediately with a second engineer.
- **15 → 24.** Preference. A real GRN is testable without the new harness.
- **17 → 25.** Partial. Notification-service can be built now against mailpit; only the
  consumer targets for `LOW_STOCK_ALERT` etc. need 17's triage.
- **20 after anything.** None. Phase 20 has *zero* code dependencies and U7 is already resolved.
  **It should start on day one with the frontend engineer.**
- **31 after anything.** None. hr-service and gateway only.
- **27 → 28.** Preference — 28 should reuse 27's fact-table conventions rather than invent a
  second set, but nothing technically blocks.

### 4.4 Parallel-safe groupings (for 2–4 engineers)

| Wave | Backend A | Backend B | Frontend | Harness/External |
|---|---|---|---|---|
| 1 | **14** | — | **20** | — |
| 2 | **16** | **17** | 20 cont. | **15** |
| 3 | **19** | **24**, **25** | **22** | **18**, **31** |
| 4 | **21** | **26** | 22 cont., **23** | 18 cont. |
| 5 | **27**, **33** | **28** | **29** | **30** |
| 6 | **34** | **32** | 29 cont. | **35** |
| 7 | **36** | **37** | 36 cont. | **38** |

---

## 5. What the user must supply, and when

| # | What | Needed by | Blocks | Buildable while waiting |
|---|---|---|---|---|
| **D1** | **Jurisdiction decision: FBR or provincial (SRB / PRA)?** Restaurant sales are *services*, taxed provincially at ~15%, **not** federally — except in Islamabad Capital Territory. The provincial e-invoicing APIs were **not researched at all**. | **Week 1** — it may require a separate research task with weeks of lead time, and it decides where Phase 35's 20 days go. | Phase 35 entirely | Everything jurisdiction-neutral: the credential store, the submission outbox with a `regime` column, the paisa→decimal-rupee serializer, the 72-hour amendment UI |
| **U1** | **A Pakistani sales-tax-registered NTN + STRN with `iris.fbr.gov.pk` credentials**, used to nominate PRAL (free, per SRO 69(I)/2025 r.150XF), submit egress IPs, pass the sandbox scenarios, and obtain a **sandbox bearer token.** There is no developer self-service — verified by live `curl` that *every* endpoint, including read-only `/pdi/v1/provinces`, returns 401 without a token. | **Month 2** (start the conversation week 1 — IRIS onboarding has a lead time) | Phase 35's wire work; the four blocking schema unknowns | Phase 35 shadow mode: build and persist `request_json`, never POST |
| **U2** | **Static egress IP(s)** for every environment that will talk to FBR, submitted to PRAL for whitelisting (~2 working hours to activate). Ephemeral autoscaling NAT IPs break the integration. | **Month 2**, with U1 | FBR sandbox activation | The fixed-egress NAT/proxy itself |
| **U3** | **One 80 mm ESC/POS thermal printer + one cash drawer.** Three behaviours cannot be simulated: whether the model honours partial vs full cut (unsupported cut types silently degrade), the actual solenoid pulse, and true columns-per-line. | **Month 4** (order month 3; inexpensive) | Phase 30 **sign-off only** | The whole of Phase 30: schema, renderer with golden-byte tests, agent, SQLite queue, server dispatch, client bridge, CSS fallback |
| **U4** | **One ZKTeco K40/MB20-class terminal.** Six firmware questions no simulator answers, including which `TransFlag` encoding is accepted (a wrong value yields a device that connects then uploads nothing) and whether any firmware can carry a per-device secret. | **Month 2** (order now; inexpensive) | Phase 31 **go-live only** | Everything else in Phase 31 — `curl` with `--data-binary` is a complete device simulator, and all four verified defects are fixable and testable today |
| **U5** | **A decision on device authentication.** A stock ZKTeco ADMS menu accepts only address and port — it **cannot** send `?token=`, which the current resolver requires. Choose: (a) per-branch hostname whose reverse proxy injects the secret, (b) serial-only trust plus mTLS/IP-allowlist/VPN, or (c) route every device through an agent. Needs the customer's network topology. | **Month 2**, before Phase 31 | A real terminal ever authenticating | Everything in U4's column. State the trade explicitly: serial-only trust means anyone who learns a serial can post punches for that tenant. |
| **U6** | **Email/SMS provider account and credentials** (SMTP or transactional-email API key; a Pakistan SMS gateway). `grep JavaMailSender\|SendGrid\|Twilio services/` returns **zero files**. | **Month 5**, Phase 25 production cutover | Production delivery only | The whole of Phase 25 against the mailpit already in compose |
| **U7** | **Brand hue.** ✅ **RESOLVED** — `DESIGN-DECISIONS.md` D-UI-01 records the explicit delegation. Confirm the proposed teal/amber or supply a hue; either way the ramp is regenerable from one value. | Done | — | Phase 20 is unblocked **now** |
| **U8** | **A payment-gateway merchant account** (JazzCash / Easypaisa / Raast / card acquirer) and its sandbox credentials, plus the webhook signing secret. **PSP contracts are entirely unread** — webhook payload shape, signature algorithm, retry semantics and the refund API are all *assumed* to follow the common pattern. | **Month 7**, Phase 36's PAY_FIRST half; also Phase 21's invoice reconciliation | Guest PAY_FIRST, kiosk pay, online checkout | All of Phase 36 in `FIRE_ON_STAFF_ACCEPT` and pay-at-table modes, which is the recommended default anyway. A `GuestPaymentProvider` interface isolates a wrong assumption to one adapter. |
| **U9** | **Commercial decisions on the new feature codes and meters:** tier placement of `FEATURE_SELF_SERVICE`, `FEATURE_CHANNEL_ORDERS` and any FBR code; per-meter enforcement mode (BLOCK vs BILL_OVERAGE); whether a refunded or voided order decrements the billing count; the dunning ladder timings. | **Month 4**, before Phase 21 closes | Nothing — defaults are shipped and are changeable | Phase 21 in full with the documented defaults |
| **U10** | **Two accounting rulings:** is service charge taxable under Pakistani rules, and does it apply pre- or post-discount? It changes `recomputeOrderTotals`' ordering. And: which Pakistan sales-tax rates should the tax step pre-seed? | **Month 3**, Phase 16 §6 | The service-charge computation order only | The columns, the API and the UI |
| **U11** | **A data-residency ruling on NLQ narration.** `ClaudeClient.narrate` unconditionally posts the question plus up to 20 result rows to `api.anthropic.com`, with no redaction and no opt-out, for a product carrying FBR tax data. | **Month 5**, before Phase 28 ships narration | Nothing — a per-tenant opt-out switch is cheap either way | The metric layer and every fact table |
| **U12** | **Signed aggregator partner agreements** (foodpanda / Careem / Uber Eats). API access is gated behind a contract per aggregator. | Only if aggregator injection is wanted | The `AGGREGATOR` channel's inbound half | The `channel` enum, `PENDING_ACCEPT`, and the internal injection endpoint — all shipped in 19 |

### 5.1 The three that matter most

1. **D1 (FBR vs provincial).** It can invalidate a 20-day workstream. It is a conversation with a
   tax advisor, not a coding task, and it should happen this week.
2. **U1 + U2 (NTN + PRAL sandbox token + static egress IPs).** Longest lead time in the
   programme, and *nothing* can be verified on the wire without them — verified by live `curl`
   that even read-only reference endpoints 401.
3. **U3 + U4 (thermal printer + ZKTeco terminal).** Both are inexpensive, both are the sole
   sign-off gate for an otherwise fully buildable phase, and both have shipping lead time. Order
   them this week; they cost less than a day of engineering.

---

## 6. Definition of done, per phase

Every row is a command whose exit status decides, or a browser journey with a **server-side**
assertion. Nothing is satisfied by inspection (F7). Output is pasted into the phase summary.

### Programme-wide gates (must stay green from the phase that introduces them onward)

```bash
mvn -Pcoverage verify                                   # BUILD SUCCESS
! grep -rl "<error" services/*/target/*-reports/        # zero surefire/failsafe ERRORS
mvn -o -pl shared-lib test -Dtest='DdlAutoParityClosureTest,FeignVerbClosureTest,EventClosureTest,SettingRegistryClosureTest'
mvn -o -pl gateway test -Dtest='RouteClosureTest'
mvn -o -pl services/platform-admin-service test -Dtest='FeatureCodeClosureTest'
mvn -o -pl services/auth-service test -Dtest='PermissionCatalogClosureTest'
docker compose -f deploy/docker-compose.yml up -d && scripts/smoke/run.sh --tier 1   # exit 0
```

### Per phase

| Phase | Done when |
|---|---|
| **14** | `psql -d finance_db -Atc "SELECT SUM(debit_paisa)-SUM(credit_paisa) FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id WHERE je.status='POSTED'"` → **0**, after an IT closes an order with `discount == subtotal`. · Forcing an unbalanced JE puts exactly 1 message on `finance.order-closed.queue.dlq` (`rabbitmqadmin get`) and the consumer thread is not spinning. · A GRN yields zero rows from `SELECT source_type,source_id,COUNT(*) … HAVING COUNT(*)>1`. · An order closed 06:00 local in a UTC+5 branch appears on the **same** day in the GL and the sales dashboard. · `grep -rn "RestClient.create()" services/ gateway/ shared-lib/` → 0. · A service with a `DROP`ped-packet JWKS host serves `/api/v1/pos/orders` in < 10s (was: forever). |
| **15** | `scripts/smoke/run.sh --tier 1` exits 0 against a fresh compose stack **and has been seen to fail** (`docker pause restaurantos-finance` → non-zero), with the procedure in `scripts/smoke/README.md`. · `grep -A5 "stack-smoke:" .github/workflows/ci.yml \| grep -c continue-on-error` → **0**. · `pnpm e2e` → 1 passed (backend-free); `E2E_STACK=1 pnpm e2e:journeys` → ≥30 passed, three consecutive `--workers=4` runs green. · `curl -s localhost:8084/actuator/prometheus \| grep -c hikaricp_connections_pending` → ≥1 on every service. · A log line from a tenant-scoped request contains both `tenantId` and `traceId`. |
| **16** | Browser journey: a tenant admin changes currency, timezone, fiscal-year start, tax code, service-charge bps and rounding mode at `/app/settings`; a new order priced afterwards reflects all six, **without a redeploy**. · `psql -d pos_db -Atc "SELECT count(*) FROM orders WHERE service_charge_paisa > 0"` → > 0 for a tenant with `service_charge_bps > 0` (it is **0 for every row ever** today). · `PUT` with a stale `If-Match` → **409**. · `POST .../revisions/{n}:restore` of a value that violates a current invariant → **409 SETTING_INVARIANT_VIOLATED**, not a silent restore. · `POST /api/v1/branches` with `ntn`+`fbrStrn` then `GET` returns them (today unwritable). · Zero rows from the `tenant_features` backfill check in §5.6 of BUILD-PLAN. · Settings-key closure test passes; no registry schema declares `type:"number"`. |
| **17** | Every one of the nine `NO_UI`/`NO_API` surfaces returns 2xx to a real authenticated request, listed in the summary with its response. · `node frontend/scripts/api-reachability-check.mjs` → 0 unreachable surfaces. · Loyalty: accrue → **redeem** → balance decreases (redeem does not exist today). · A modifier added to an order line stores its **name** and a non-zero `price_delta_paisa`. · A `pos.kds.view` token for branch A connecting to `WS /api/v1/kitchen/kds/{branchB}/{station}` is **refused** (accepted today). · Two tenants POSTing the same `Idempotency-Key` both succeed and neither sees the other's response. · `pnpm e2e --grep "no dead links"` passes. |
| **18** | `grep -rh "rls-harness" services/*/target/*-reports/ \| grep -c "rolsuper=false rolbypassrls=false"` equals the number of service modules with `src/test` (15). · `mvn -o verify -Dit.test='*RlsCoverageIT'` → 0 failures. · `psql -d pos_db -Atc "SELECT count(*) FROM pg_tables t JOIN pg_class c ON c.relname=t.tablename WHERE t.schemaname='public' AND NOT c.relforcerowsecurity"` → 0 for tenant-bearing tables. · Connecting as the runtime role with no tenant GUC returns **0 rows** from `orders` (returns rows today). |
| **19** | Browser journey ×3 on one deployment: a table-service branch (order → fire → serve → pay → close), a **bill-first** branch (pay → server fires automatically → close), and a **QSR** branch (pay → close with no "Mark Served" tap). All three produce a `POSTED` balanced JE. · `POST /send-to-kds` on an unpaid order under `payment_timing=BEFORE_FIRE` → **409 PAYMENT_REQUIRED_BEFORE_FIRE**. · `grep -rn "sendToKds" frontend/components/pos/charge-summary.tsx` → **0** (the client-side orchestration is deleted, not doubled). · A fully-paid QSR order reaches `CLOSED` and its cashier can close the till (blocked forever today). · A profile with `till_requirement=NONE` **cannot** be saved with CASH in `allowed_tenders` (DB CHECK). |
| **20** | `grep -rEc "bg-(gray\|slate\|zinc\|amber\|emerald\|red)-[0-9]" frontend/components frontend/app` → **0**. · A five-series chart is distinguishable under a deuteranopia simulation (screenshot in the summary) and in greyscale. · `pnpm e2e --grep "target size"` passes (every POS/KDS control ≥ 44px). · A `DataGrid` with a filter applied returns fewer rows than unfiltered (W10 — impossible today). · Lighthouse a11y ≥ 95 on POS, KDS and dashboard; axe zero criticals. |
| **21** | `psql -d platform_db -Atc "SELECT qty FROM usage_counters WHERE meter='ORDERS' AND tenant_id=…"` increments by exactly 1 per `ORDER_CLOSED`, and **survives `redis-cli FLUSHALL`** (today a flush grants every tenant a fresh month). · Browser journey: SuperAdmin lists tenants, opens one, changes tier, toggles one feature, raises one quota override, and sees usage with `asOf` — the tenant's next request reflects all of it. · A tenant at 85% of a cost meter gets `X-Usage-Warning`; at 100% a **429** with `X-Upgrade-CTA-URL`. · A tenant at 100% of ORDERS still **closes an order** and gets `X-Usage-Overage`. · `grep -rn "TierStorageProperties" services/` → **0**. · A tenant in `billing_state=PAST_DUE` still has `status=ACTIVE` and is **not** 403'd. |
| **22** | Browser journey: a cashier completes open till → 12-item order with modifiers → discounted cash settle → close till → Z-report entirely on a 1024×768 touch viewport with no horizontal scroll. · KDS at 2 m: modifiers legible (screenshot). · Offline journey: `context.setOffline(true)` → the menu **still renders** (blank today), items add, the order queues, reconnect drains it, and `orders` has exactly one row for that `clientOrderId`. · `grep -rl "<table" frontend/components frontend/app \| grep -v data-grid \| wc -l` → 0. |
| **23** | Browser journey: a tenant admin creates a user, assigns a per-branch role, that user logs in and their token carries exactly the expected permissions **and not more**. · A newly provisioned admin logs in, is shown the forced-password-change form, changes it, and lands on the dashboard (impossible today — zero frontend handling of `403 PASSWORD_CHANGE_REQUIRED`). · A manager records a wastage line and `psql -d inventory_db` shows the `stock_wastage_lines` row and a matching `WASTAGE` movement. · With the API returning 500, every list screen renders an **error**, never an empty state (lint rule enforced). |
| **24** | `integration-mode=feign`, `MockGrnController` and `GrnReceiptSimulator` deleted, and a two-manager PO → partial GRN → invoice → payment journey completes with `psql -d finance_db -Atc "SELECT balance_paisa FROM v_account_balances WHERE system_tag='GR_IR'"` → **0**. · A received lot has a non-null `expiry_date` derived from `shelf_life_days`. · `grep -rn "1300\|1700" services/purchasing-service/src/main` → 0 hardcoded account literals. |
| **25** | Password reset end-to-end: request → mailpit shows the message → the token redeems once → a second redemption fails. · `rabbitmqadmin get queue=notification.low-stock.queue` → 0 backlog after a `LOW_STOCK_ALERT` (unbounded growth today). |
| **26** | A write-off above the tenant's threshold enters `PENDING_APPROVAL`, `qty_on_hand` **drops immediately**, no JE exists yet; on approval exactly one JE appears with the **reason's** GL account. · `approved_by == recorded_by` → 409. · A rejection creates a compensating record; the original is unmodified. · `EXPIRY_ALERT` stops re-firing for a written-off lot (loops forever today). · A staff-meal write-off does **not** move food-cost %. |
| **27** | An accountant closes a month: Trial Balance sums to zero, P&L and Balance Sheet tie, COGS on sales-by-item is non-null (literal NULL today), and both export as CSV **and** PDF. |
| **28** | All six brief questions answered from the UI, each returning a `metricCode` for the routed ones. · An NLQ answer names ingredients by **name**, not UUID. · A MANAGER asking "which staff void the most orders" is denied; an OWNER is answered. · A tenant with narration opted out gets a table and no LLM call (`grep` the nlq log for zero narrate rows). · `ClickHouseSchemaGuard` fails on a missing new fact table (seen to fail). |
| **29** | **Browser journey, the headline:** a SuperAdmin provisions a tenant; that admin logs in for the first time, changes the forced password, completes business profile → service model → branch → tables → tax → menu (CSV import of 50 items, one row deliberately malformed and reported) → payments; reaches "You can take an order"; **and takes one**, which closes and posts a balanced JE. Timed, screenshotted, no SQL. · Re-running `POST /onboarding/refresh` with pos-service paused marks the menu step `unknown` with a reason — never `NOT_STARTED`. · Re-submitting the same CSV `uploadId` does **not** double the menu. |
| **30** | On real hardware (U3): a settled order prints an 80 mm receipt, the paper **partial-cuts**, the drawer **kicks**; a kitchen ticket prints with **every browser tab closed**; the agent survives a reboot with a queued job and prints it on restart; the column-ruler calibration print exists in the branch admin UI; the `window.print()` fallback produces a readable receipt with the agent stopped. Golden-byte tests pass with no hardware. |
| **31** | On real hardware (U4): a terminal configured with only address+port pushes a punch that lands in `attendance_punches` with the correct employee; the same batch replayed writes no second row and emits no second event; an unmapped PIN quarantines and resolving it re-ingests. · `AdmsHttpContractIT` green **including** the 401 case, the `application/x-www-form-urlencoded` case, the empty-`getrequest` case and the epoch-timestamp case — all four of which the existing `AdmsIngestIT` structurally cannot see. · A device set 20 minutes ahead raises a clock-skew alert. |
| **32** | Two terminals in one branch each hold an open till simultaneously (impossible today) and a Z-report per drawer reconciles. · A drink and a burger on one order produce two tickets on two boards. · An admin at branch B routes an item to a bar station and branch A's routing is **unchanged** (`psql` before/after — silently corrupted today). · A cashier with two open tills settling without a `terminalId` → **409 AMBIGUOUS_TILL**, never a silent pick. · Handover moves only zero-payment orders. |
| **33** | A variance period over a seeded month reports non-zero recorded waste, non-zero uncovered sales, and an unexplained figure that **equals** `theoretical − actual − waste − transfers` computed independently in SQL. · The header states count coverage. · Both food-cost percentages render and their gap equals the variance as a % of sales. · A recipe with an excluded line is **absent** from the aggregate, not counted as cheap. |
| **34** | An insight fires once for a seeded variance spike and does **not** re-fire the next night (dedupe key). · Snoozing suppresses it for the window. · An insight below the minimum-volume guard does not fire at all. |
| **35** | With a sandbox token (U1/U2): every scenario applicable to the tenant's Business Nature × Sector passes in sandbox; a closed sale produces a `FISCALISED` row with an `invoiceNumber`; the receipt carries the QR and the DI logo; **PRAL unreachable for 10 minutes does not block a single sale** (measured: close 20 orders during a `docker pause` of the stub) and the queued invoices fiscalise on recovery; a rejected invoice lands in `REJECTED` with its error code visible and is **not** retried; a void after 72 hours is refused with an explanation. |
| **36** | Browser journey on a mobile viewport: scan (navigate with a real QR token) → menu → cart → place → staff accepts on the POS → kitchen ticket → pay at table → close. Server assertions: `orders.channel='QR_TABLE'`, `cashier_id IS NULL`, and the order **visible** to a `pos.order.view` holder. · A guest token calling any `/api/v1/pos/**` endpoint → **403**, tested across all five guest permissions. · A guest token for table 5 requesting table 6's order → **404**, never 403. · A PSP webhook with a valid signature but a mismatched amount → status `MISMATCH`, **no payment recorded**. · A replayed webhook records exactly one payment. · Rotating a table's QR makes the old token 401 within one request. |
| **37** | Two replicas of pos-service, kitchen-service and reporting-service run simultaneously and: a WebSocket client connected to replica 1 receives an event published by replica 2; `SELECT event_id, count(*) FROM processed_events GROUP BY 1 HAVING count(*)>1` → zero rows; a scheduled sweep runs exactly once per period across both. · `curl /actuator/health/readiness` returns `DOWN` with the DB paused and `UP` after (returns a bare UP today). · A thread-starvation liveness indicator flips within 30s of a deliberately wedged pool. · `docker compose up` brings up all 16 **application** services (contains only infrastructure today). |
| **38** | All ten browser journeys green and blocking in CI. · A restore rehearsal from backup reaches a working stack. · A load smoke at expected peak holds p99 under target. · Every gate in this table has been **seen to fail once** and the procedure is recorded in `scripts/smoke/README.md`. |

---

## 7. Effort, honestly

### 7.1 Per phase, with de-duplication shown

| # | Phase | Days | Source(s) merged |
|---|---|---:|---|
| 14 | Money-path, event-bus, unbounded-wait repair | 5 | BUILD-PLAN 14 (5) + 1d of scalability-ops pulled forward, absorbed |
| 15 | Verification spine + E2E harness | 10 | BUILD-PLAN 15 (8) + browser-e2e harness half (4), overlap −2 |
| 16 | **Tenant configuration spine** | 22 | tenant-config-model (32) + BUILD-PLAN 17 (16), overlap −26 |
| 17 | API reachability + boundary repair | 12 | BUILD-PLAN 16 (10) + pulled-forward security items (2) |
| 18 | RLS harness + FORCE rollout | 15 | BUILD-PLAN 18 (13) + FORCE conversion (2) |
| 19 | **POS service models** | 17 | business-models (17) |
| 20 | Design system foundation | 14 | BUILD-PLAN 20 (14) |
| 21 | SuperAdmin console + subscriptions + metering | 24 | subscription-metering (26) + BUILD-PLAN 19 console slice (4), overlap −6 |
| 22 | Screen rebuilds | 16 | BUILD-PLAN 21 (16) |
| 23 | Admin + missing-UI surfaces | 11 | BUILD-PLAN 19 (15) minus the console slice |
| 24 | Real goods receipt | 8 | BUILD-PLAN 22 (8) |
| 25 | Notifications + alerting | 8 | BUILD-PLAN 23 (8) |
| 26 | Waste capture + control | 20 | waste-inventory waves 1–3 |
| 27 | Financial statements, COGS, exports | 15 | BUILD-PLAN 24 (15) |
| 28 | Analytics facts + NLQ metric layer | 24 | nlq-insights (56) minus insight engine (16) and deferred long tail (16) |
| 29 | **Guided tenant onboarding** | 30 | onboarding (45) minus prerequisites now owned by 16/17/19/23 (−15) |
| 30 | Receipt + kitchen printing | 18 | BUILD-PLAN 26 (18) |
| 31 | Biometric attendance repair | 4 | BUILD-PLAN 25 (4) |
| 32 | Multi-POS terminals + KDS/BDS | 22 | multi-pos-stations (22); BUILD-PLAN 28's 10 superseded (C7) |
| 33 | Usage variance + recipe costing | 22 | waste-inventory waves 4–6 |
| 34 | Insight engine | 16 | nlq-insights insight half |
| 35 | FBR / provincial digital invoicing | 20 | BUILD-PLAN 27 (20) |
| 36 | Guest ordering (QR / kiosk / online) | 38 | self-checkout (38.5) |
| 37 | Scalability + operability | 22 | scalability-ops (22); BUILD-PLAN 29's 10 absorbed |
| 38 | Production hardening + launch readiness | 10 | BUILD-PLAN 29 residue |
| | **Raw total** | **423** | (BUILD-PLAN 190 + adaptivity 330 = 520, minus ~97 overlap) |

### 7.2 The multiplier is not optional

423 dev-days is the **build** estimate: it excludes code review, UAT, rework, and the discovery
that always follows a real RLS rollout. This project's own history sets the number: Phase 10 was
reopened by a UAT audit with ten gaps including four blockers; Phase 13 was scoped as a repair
and grew to sixteen plans. **Apply 1.25–1.35×. Use 1.3.**

**≈ 550 dev-days delivered.**

### 7.3 Calendar

| Staffing | Calendar at 1.3×, 5-day weeks |
|---|---|
| 1 engineer | ~110 weeks — **25 months**. Not a viable plan. |
| 2 engineers on disjoint tracks | ~62 weeks — **~14 months** |
| **3 engineers** | ~44 weeks — **~10 months** |
| 4 engineers | ~35 weeks — **~8 months** |
| 5+ | No better than 4. The critical path `14→15→16→19→22→23→29` is 111 raw days ≈ **7 months** delivered, and no staffing shortens it. |

**Three engineers is the sensible target; four is the practical ceiling.**

### 7.4 What "demonstrable early" actually buys

| At | Elapsed (3 engineers) | What can be demonstrated |
|---|---|---|
| End of 14 + 15 | ~week 5 | Nothing new visible — but the ledger balances, the tests stop lying, and services stop wedging |
| End of 16 | ~week 10 | A tenant configures currency, timezone, fiscal year, tax, service charge and rounding through a real screen, and the next order reflects it |
| End of 19 | ~week 14 | **The headline claim.** Three branches on one deployment running order-first, bill-first and QSR — the same code, configured differently |
| End of 20 + 22 | ~week 18 | A branded, touch-sized POS and a legible KDS. The product stops looking like the shadcn starter |
| End of 21 | ~week 22 | The commercial loop: provision, tier, toggle features, meter usage, invoice |
| End of 29 | ~week 32 | A stranger signs up and takes their first order without an engineer |

### 7.5 If a smaller number is required

The defensible cut is **14 + 15 + 16 + 19 + 20 + 22 = 84 raw days ≈ 109 delivered**: ~22 weeks
solo, ~11 weeks with two engineers. That yields a system with a correct ledger, honest tests, a
real tenant-configuration spine, configurable service models, a brand, and rebuilt POS and KDS
screens — genuinely "adaptable to any food business", demonstrably so.

It would **not** have onboarding, SuperAdmin metering, printing, FBR, real GRN, notifications,
statements, NLQ depth, waste control or guest ordering. **It must be sold as such.** Do not
promise a complete ERP with three hardware/tax integrations, a full UI rebuild, guided
onboarding and guest ordering in a quarter.

---

## 8. Explicitly deferred

Not in this roadmap. Each addition displaces a phase explicitly and is recorded with the
displacement.

| Deferred | Why | Effort if pulled in |
|---|---|---|
| **Aggregator inbound** (foodpanda / Careem / Uber Eats) | Blocked on U12, a signed contract per aggregator. Do not scaffold against guessed schemas — the same rule that governs FBR. The `channel` enum, `PENDING_ACCEPT` and the internal injection endpoint all ship in Phase 19, so the receiving half is one adapter each. | ~8d per aggregator |
| **Delivery dispatch** (zones, riders, tracking) | A service in its own right; no design exists. | ~25d |
| **Reservations / waitlist** | No design exists. | ~15d |
| **Franchise / royalty / consolidated reporting** | `FEATURE_CONSOLIDATED_REPORTING` exists as a tier flag with nothing behind it. Needs a commercial model first. | ~20d |
| **Demand forecasting** | Needs ≥12 months of clean fact data, which Phase 28 begins producing. Not before. | ~20d |
| **HACCP / food-safety logs** | Regulatory scope not established. | ~12d |
| **Inventory depth II** — production/prep batches, portion audits, catch-weight receiving, lot-recall UI | The honest way to separate over-portioning from theft, and the only way to measure prep yield. Genuinely valuable; not before Phase 33 proves the variance report is trusted. | ~20d |
| **Per-tenant API rate limiting** | Today limits are per-IP and per-device-SN. `API_CALLS` as a billing meter (Phase 21) and as a rate limit (token bucket) are different features; only the first is designed. | ~6d |
| **Anniversary billing periods** | Phase 21 ships calendar-month with `renews_at` normalised to the 1st. Anniversary billing needs a per-tenant period embedded in a key shape that is a verbatim three-way contract. | ~8d |
| **Multi-country tax** (D4) | Determines whether the tax-code master is a table or a rules engine. Phase 16 ships the table. | ~15d |
| **BILLING platform role activation** | The schema permits it; `PlatformAuthService.MINTABLE_ROLE` refuses to mint a token for it, and `PlatformAdminController` is class-level SUPER_ADMIN, so a BILLING user can log in to nothing. Phase 21's dashboard is the first genuine use case. | ~4d |

---

## 9. Open questions this roadmap does not close

These are recorded so they are not mistaken for decided. Each names its owner and its deadline.

1. **What wedged auth-service?** The JWKS mechanism is structurally impossible there (pre-seeded
   provider, zero outbound HTTP). Needs a thread dump captured *during* a live wedge, read for
   thread states. **Owner: Phase 37. Deadline: before any production deploy.**
2. **Does production run the same DB role topology as `deploy/init/`?** The conclusion that RLS is
   inert in `pos_db` rests on `pos_user` owning the tables. If production uses a separate owner,
   RLS is live in prod and inert in dev/test — the worst combination. **Owner: Phase 18. Deadline:
   before Phase 18 starts.**
3. **Is a device-bound, user-less, branch-scoped token mintable by auth-service, and do
   `JwtAuthenticationFilter` and `TenantContext` tolerate a null `userId` end to end?**
   UNVERIFIED. If not, kiosk self-service is blocked on an auth-service change. **Owner: Phase 36.
   Deadline: before Phase 36 is planned.**
4. **Does a long-lived response survive `posCircuitBreaker`'s 5s timelimiter?** Decides SSE
   viability. The KDS WebSocket runs under an identically configured breaker and is *believed* to
   work — but the POS one provably does not, and "should" was wrong there. **Owner: Phase 17.**
5. **Where does the fiscal invoice number get issued for BILL_FIRST?** The customer walks away
   with a printed receipt before the food is cooked, so the fiscal document is issued at payment
   and a later void is a credit note, not a deletion. If FBR issuance is wired to `ORDER_CLOSED`
   only, every bill-first tenant hands out a non-fiscal slip. **Owner: jointly Phase 19 and Phase
   35. Must be settled before either freezes.**
6. **Should service charge apply pre- or post-discount, and is it taxable?** (U10) A finance
   question, and it changes `recomputeOrderTotals`' ordering. **Owner: Phase 16.**
7. **Weekly or monthly variance periods by default?** Weekly is far more actionable but demands a
   weekly full count many kitchens will not sustain. Cycle counting is the usual compromise and
   needs a design of its own. **Owner: Phase 33.**
8. **`nlq_query_log` retention.** It stores every question (free text, potentially personal) and
   every generated SQL forever, with no purge. **Owner: Phase 28.**
9. **Does `scripts/README-seed.md` exist?** `seed_restaurantos.py:66-69` promises it; it does not.
   When it lands it must point at `persona_password()` rather than restate a credential table —
   two hand-maintained copies is how the E2E suite starts lying. **Owner: Phase 15.**
10. **Nothing guards seed ↔ fixture drift.** `e2e/fixtures/personas.ts` mirrors
    `seed_restaurantos.py` by hand. A test parsing the Python constants and diffing them closes it
    cheaply. **Owner: Phase 15.**

---

*Written against `phase-13-access-repair` @ `5fba4a9`. Per `CLAUDE.md`, run
`impact({target, direction:"upstream"})` before editing any symbol named in this document —
`postOrderRevenue`, `aggregateOrderTotals`, `maybeCloseOrder`, `sendToKds`, `recordPayment`,
`TierLimits.applyTo`, `FeatureFlagAdminService.reconcileToTierDefaults` and `BranchService.update`
in particular — and `detect_changes()` before every commit. The GitNexus index is stale as of
`5fba4a9`.*
