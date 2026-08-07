# ResturantOS — Build Plan to Production

**Written:** 2026-08-07 · **Branch:** `phase-13-access-repair` @ `5fba4a9`
**Consolidates:** the ten research reports in this directory (`erp-gap-modules`, `erp-gap-integration`,
`tenant-configurability`, `testing-strategy`, `fbr-api`, `fbr-integration-design`, `pos-printing`,
`biometric-attendance`, `uiux-direction`, `uiux-stack`).
**Verification status:** every load-bearing claim in §1 was re-checked against the working tree while
writing this document. Commands and line numbers are given so you can re-check them yourself.

---

## 0. The rule this document is written under

This project has already been burned once by structural verification. A phase scored **24/24** while
citing a controller that does not exist, because every check asked "is the code there?" instead of
"does a request succeed?" (`scripts/e2e/_phase13-lib.sh:1-12`).

So: **structural presence is not evidence.** In this document,

- "**works**" means a request was executed and the persisted result was read back;
- "**built**" means the code exists and compiles — nothing more;
- "**unreachable**" means built, and provably not callable by any real caller.

Where a claim rests on reading rather than running, it says so. The Definition of Done (§5) is
written entirely as commands and browser journeys for the same reason.

---

## 1. Reality check

### 1.1 What is genuinely built and working

These are real, and they are more than most projects at this stage have. Do not rebuild them.

| Capability | Evidence it actually runs |
|---|---|
| **POS order → payment → close** | Single close seam `OrderServiceImpl.performClose` (:731); publishes exactly one `ORDER_CLOSED` (:780); fail-closed period gate via `FinancePeriodClient.assertPeriodOpen` |
| **ORDER_CLOSED → inventory depletion → COGS** | The healthiest chain in the system: effective-recipe resolution, UoM base conversion, sorted-UUID locking, FEFO lot walk, moving-average cost, per-category GL codes, producer/consumer sum reconciliation. Proof test exists: `services/inventory-service/src/test/java/io/restaurantos/inventory/LiveDepletionProofIT.java` |
| **HR payroll → finance, both legs** | `PayrollRunService` publishes approved + paid; `AutoPostingRecipeEngine:403-470` re-asserts `gross − lateArrival == net + tax + eobi + advances` and throws rather than posting a plausible number |
| **POS ↔ KDS** | Five keys out, two back, DLQ monitors on both ends, correct `default-requeue-rejected: false` on both sides |
| **Recipe costing** | `RecipeCostPreviewDto{batchCostPaisa, portionCostPaisa, yieldServings, foodCostPct}` off real moving-average cost — not a placeholder |
| **Purchasing: vendors, price lists, PO approval, 3-way match, AP payments** | Full API + UI, effective-dated pricing, price-change tracking |
| **Finance: GL, journals, periods, expenses, AR** | Full API + UI; deferred `trg_je_balance_on_post` trigger genuinely rejects unbalanced entries |
| **Biometric ADMS server side** | Four `/iclock/*` endpoints, defensive positional ATTLOG parser, encrypted per-device token, SECURITY DEFINER serial→tenant resolution, `ON CONFLICT` idempotency, quarantine-and-resolve with durable PIN mapping. **8/8 tests were run and passed during research** |
| **Transactional outbox pattern** | Non-RLS `event_outbox` in all 16 services, publish-inside-transaction, `processed_events` dedup with the action running *before* the marker |
| **Tenant feature flags** | 20 codes, per-tenant `is_override` that survives tier changes in both directions, dual Redis key invalidation, fail-closed gateway filter |
| **Frontend data architecture** | Enforced 4-layer split (schema → adapter → model → hook), TanStack Query, and a real IndexedDB offline outbox with attempts/DEAD dead-lettering |

### 1.2 What is built but WRONG — silent correctness defects

**This is the most dangerous category and it is the reason §1.1 must not be read as reassurance.**
Each of these is live code, on a money path, that no test covers.

| # | Defect | Location | Consequence |
|---|---|---|---|
| **W1** | Revenue JE credits `subtotal − discount` **and** debits the discount as contra-revenue. The discount is subtracted twice. | `AutoPostingRecipeEngine.java:100-116` — verified in the working tree: `long netRevenue = p.subtotalPaisa() - p.discountPaisa();` then a separate `DR DISCOUNT` line | `DR − CR = discountPaisa` on **every discounted order**. Trips the deferred `JE_UNBALANCED` trigger, so the order never reaches the ledger. |
| **W2** | finance, crm and reporting have **no `spring.rabbitmq.listener` block at all** — verified: `services/finance-service/src/main/resources/application.yml:30-34` stops at `password`, where pos-service:35-44 continues into `listener.simple.default-requeue-rejected: false` | Spring's default `default-requeue-rejected=true` | W1's failure requeues **forever** at redelivery speed instead of dead-lettering. Finance's ten declared DLQs are decorative. audit-service is the `#` catch-all for nine exchanges — one bad event stalls the entire audit trail. |
| **W3** | One goods receipt posts `DR 1300 / CR 1700` **twice** — a direct Feign `autoPost` at `GrnReceiptSimulator.java:111-121` *and* the `GRN_RECEIVED → STOCK_RECEIVED → postStockReceipt` chain. Dedup keys differ (`GRN,batchGrnId` vs `STOCK_RECEIPT,lotId`) so `alreadyPosted()` cannot catch it. | verified in tree | GR/IR carries a permanent, monotonically growing credit balance; inventory control doubles against the sub-ledger. Both entries balance individually, so nothing errors. |
| **W4** | `OrderServiceImpl.java:257` sets `oim.setModifierNameSnapshot(modifierId.toString())` | pos-service | The receipt snapshot stores a **UUID where the modifier name belongs**. Every historical order with a modifier has an unreadable line. |
| **W5** | `businessDate` is derived twice with different rules from the same event — pos uses UTC−4h and puts it on the payload; reporting **ignores the payload** and re-derives branch-local−4h | `shared-lib/.../time/BusinessDay.java:18` vs `reporting/support/BusinessDay.java:30` | For a UTC+5 branch, orders closed ~04:00–09:00 local land on different days in the GL and the sales dashboard. They cannot tie out, and no test compares them. |
| **W6** | `OutboxRelay` marks rows `SENT` unconditionally: no publisher confirms anywhere in the repo, no `FOR UPDATE SKIP LOCKED`/ShedLock, one throwing row rolls back the whole 200-row batch, **zero tests** | `shared-lib/.../event/OutboxRelay.java` (40 lines) | The outbox guarantees the row was *written*, not that the event was *delivered*. Two replicas double-publish. One poison row blocks every event behind it forever. |
| **W7** | `orders.service_charge_paisa` is summed into the total and **no code path ever sets it** (`grep setServiceChargePaisa services/` → nothing) | pos-service | Service charge is permanently zero — a feature that appears to exist in the schema and the JE recipe and is dead. |
| **W8** | Device-auth failures return **HTTP 500**, not 401 — the shared `@ExceptionHandler(Exception.class)` at `GlobalExceptionHandler.java:186` beats `DeviceAuthException`'s `@ResponseStatus` | hr-service; **verified at runtime during research** | A stack trace at ERROR level on every 3–8 second device poll. The gateway circuit breaker is configured for `503` only, so it never trips. |
| **W9** | An ATTLOG POST with `Content-Type: application/x-www-form-urlencoded` returns `200 OK` and writes **zero rows**, silently | hr-service; **verified at runtime** | Silent attendance data loss on a header the device chooses. |
| **W10** | `data-table.tsx:65` calls `table.getFilteredRowModel()` but never registers `getFilteredRowModel` in `useReactTable` | frontend | Filtering can never work, even if a filter UI were added. It silently falls back to the core row model. |

### 1.3 What is built but unreachable

Nine live API surfaces with **zero** frontend callers, five built domains with **no controller**, and
one whole service with **no gateway route**. Confirmed in the tree: `grep -c audit gateway/src/main/resources/application.yml` → **0**.

**Live API, no UI (`NO_UI`)** — the cheapest wins, the highest embarrassment risk:

| Surface | Service | Severity |
|---|---|---|
| `POST\|GET /api/v1/inventory/wastage` | inventory | **CRITICAL** — a restaurant cannot run food cost without spoilage |
| `/api/v1/users/**` (11 endpoints incl. branch-roles) | user | **CRITICAL** — nobody can create a staff login through the UI |
| `/api/v1/hr/leave/**` (9 endpoints; the client functions are *already written* at `hr.repository.ts:185-211`) | hr | IMPORTANT |
| `/api/v1/branches` CRUD | user | IMPORTANT |
| `/api/v1/platform/tenants/**` (13 endpoints) | platform-admin | IMPORTANT — and `sidebar-nav-items.ts` links `/platform/tenants` **without** `comingSoon`, so it is a live 404 |
| `/api/v1/pos/stations`, `/api/v1/hr/devices`, `/api/v1/crm/feedback`, `/api/v1/files/**` | pos, hr, crm, file | NICE_TO_HAVE |

**Built domain, no API (`NO_API`):**

| Domain | Missing |
|---|---|
| Loyalty — `LoyaltyService` accrues on `ORDER_CLOSED`, debits on refund, 3 entities, 2 consumers | No `LoyaltyController`, and **no `redeem` method at all**. Points accrue forever and can never be spent. |
| Modifiers — `Modifier`, `ModifierGroup`, `OrderItemModifier` entities exist and are written | No CRUD controller. "No onions" cannot be configured. See also W4. |
| Dining tables | `DiningTableRepository` has two finders. The floor plan can only be changed by a DBA. |
| Stock counts | `StockCountController` is `@PostMapping` only — a posted variance can never be re-read or audited. |
| Audit events | `AuditInternalController` only; **no gateway route to audit-service exists**. The 7-year immutable compliance trail is write-only. |

**Dead wiring found while inventorying:** `gateway/application.yml:147-150` routes
`/api/v1/authorization/**` to a service whose only controller is `@RequestMapping("/internal")`.
23 of 41 published routing keys have no functional consumer. `notification.low-stock.queue` is bound
with no consumer, no TTL and no max-length — it grows without bound for the life of the broker.
`InventoryGrnClient.java:18` declares `GET /internal/inventory/po-lines/{poLineId}/grn-summary`;
`grep -rn grn-summary --include=*.java` returns **only that declaration**. It is disabled today solely
because `integration-mode` defaults to `mock`.

### 1.4 What is missing entirely

| Missing | Owner | Severity |
|---|---|---|
| **Goods receipt is a simulator.** `GrnReceiptSimulator` is the only producer of `GRN_RECEIVED` in the repo; `MockGrnController` 404s unless `integration-mode=mock`, which is the **default** (`purchasing application.yml:72`). There is no `Grn` entity — only `MockGrnReceipt`. No partial receipt, no over/under tolerance, no reversal. | purchasing | **CRITICAL** |
| **Notifications.** `services/notification-service/` contains exactly two files: `README.md` and `pom.xml` with `<packaging>pom</packaging>` — verified. Password-reset tokens are minted with no consumer to deliver them. | notification | **CRITICAL** |
| **Financial statements and COGS.** `ReportCatalog.java:36-42` registers 7 reports, none of them statements. `ReportService.java:81` says outright that COGS and margin "are not yet available". No P&L, no balance sheet, no trial balance, no food-cost %, no labour-cost %. | finance + reporting | **CRITICAL** |
| **Any printing whatsoever.** No `window.print()`, no `@page`, no ESC/POS, no QR library anywhere in `frontend/` or `services/`. | new print agent + pos | **CRITICAL for a POS** |
| **Any FBR transmission.** `FbrTaxSummaryDto`'s own Javadoc: *"There is no FBR/IRIS e-filing API integration anywhere in the specs and NONE is built here."* | new | **CRITICAL if selling in Pakistan** |
| **A tenant settings home.** There is no `tenant_settings` / `org_settings` / `tenant_config` table anywhere. No currency, timezone default, tax profile, business hours, fiscal-year start, locale, or rounding rule is configurable. `tenants.theme_config` and `email_config` are declared and **never read by any code**. The appearance form persists to `localStorage` against an endpoint that does not exist. | user-service | **CRITICAL for "configurable per tenant"** |
| **NTN/STRN cannot be written.** `branches.ntn` and `branches.fbr_strn` exist and are read by the shipped FBR report, but neither DTO carries them and `BranchService` never calls the setters — verified: `grep setNtn services/user-service/src/main` → nothing. Settable only by direct SQL. | user-service | **HIGH, 3-line fix** |
| Reservations / waitlist, online-ordering storefront, delivery dispatch, aggregator integration, franchise/royalty, forecasting, HACCP, QR table ordering | new services | Deferred — see §3.6 |

### 1.5 The test harness is lying, and it is measurable

This is not a quality opinion; it was **measured on this machine** during research:

```
docker run -e POSTGRES_USER=auth_user -e POSTGRES_PASSWORD=test postgres:18
psql -Atc "select rolname, rolsuper, rolbypassrls from pg_roles where rolcanlogin"
→ auth_user | t | t          ← the ONLY login role in the cluster
```

Testcontainers' `withUsername("auth_user")` sets `POSTGRES_USER`, which the official image documents
as creating the role **with superuser power**. On a `FORCE ROW LEVEL SECURITY` table configured
exactly per `docs/conventions/rls-convention.md`, both `INSERT` and `SELECT` succeed **with no tenant
GUC set at all**.

There are **101 `FORCE ROW LEVEL SECURITY` statements across 57 tables** in this repo (verified). Every
RLS assertion in every integration test is currently vacuous. `deploy/init/05-hr-fn-owner.sql:20-23`
already names this defect in a comment. Nothing enforces it.

Alongside it: **25 test-side `ddl-auto` overrides** exist (verified), of which exactly one sets
`validate`; eleven modules deploy `validate` and test `none`; `file-service` has **no `src/test`
directory at all** yet ships an RLS changeset. Nineteen `@FeignClient` interfaces exist across eight
services and a PATCH-capable transport exists in **two**. Playwright's config is a one-journey scaffold
but `testDir: "./e2e"` runs all 14 specs, and the CI job carries `continue-on-error: true`. **CI never
starts more than one service at a time**, and every defect in this section is a cross-process defect.

**Coverage gates are orthogonal to all of it.** All five previously-shipped defects of this class lived
in *covered* lines. Do not respond to this with more coverage.

### 1.6 Honest summary

ResturantOS is roughly **65% of a restaurant ERP by surface area, and considerably less than that by
verified behaviour.** The transactional spine is real and well-built. What sits on top of it is a
mixture of finished work, finished work nobody can reach, and three money-path bugs that a single
discounted order would expose. The UI is a competent skeleton wearing the stock shadcn starter with
zero brand colour and 32-pixel controls on a touch product.

None of that is a rewrite. All of it is work.

---

## 2. Hard dependencies on the user

Nothing below can be produced by engineering. Each row states precisely what is needed, what it blocks,
and — importantly — **what can be built and verified with simulators while you wait**, so no phase
stalls on a dependency.

### 2.1 Blocking dependencies

| # | What is needed | From whom | Blocks | Buildable meanwhile (no dependency) |
|---|---|---|---|---|
| **U1** | **A Pakistani sales-tax-registered NTN + STRN with `iris.fbr.gov.pk` credentials**, used to nominate PRAL (free, per SRO 69(I)/2025 r.150XF), submit our egress IPs, pass the sandbox scenarios, and obtain a **sandbox bearer token**. There is no developer self-service: verified by live `curl` that *every* endpoint — including read-only `/pdi/v1/provinces` — returns 401 without a token. | The business owner, or a pilot tenant | Any wire-level FBR work; caching the HS-code/UoM/rate reference tables | The entire request/response model transcribed from spec v1.12, the paisa→decimal-rupee serializer, the strict success predicate, `fbr_credentials` + `fbr_submissions` tables, shadow mode (build and persist `request_json`, never POST), and the 72-hour amendment cutoff in the void/refund UI |
| **U2** | **Static egress IP address(es)** for every environment that will talk to FBR, submitted to PRAL for whitelisting (~2 working hours to activate). Ephemeral autoscaling NAT IPs break the integration. | Infrastructure owner | FBR sandbox activation | Everything in U1's right-hand column; also the fixed-egress NAT/proxy itself |
| **U3** | **One 80 mm ESC/POS thermal printer + one cash drawer.** Three behaviours cannot be simulated: whether the model honours partial vs full cut (the Star spec says unsupported cut types silently degrade), the actual pulse the solenoid needs, and the true columns-per-line for the configured width and font. | Purchase — inexpensive | Final print verification only | The `PrintDocument` schema, the ESC/POS renderer with **golden-byte unit tests** (`1B 40` init, `1D 56 42 00` feed+partial cut, `1B 70 00 32 FA` drawer kick), the whole agent, the SQLite queue, server-side dispatch, the client bridge, and the `window.print()` CSS fallback |
| **U4** | **One ZKTeco K40/MB20-class terminal.** Six firmware questions no simulator answers: which `TransFlag` encoding is accepted (bitmask vs word list — a wrong value yields a device that connects then uploads nothing), whether an empty `getrequest` body is tolerated, what `Content-Type` the firmware sends, whether `/iclock/registry` is required, whether **any** firmware can carry a per-device secret, and the real field count. | Purchase — inexpensive | Go-live on real hardware | **Everything else.** `curl` with `--data-binary` and `$'...'` quoting is a complete device simulator. All four verified defects (W8, W9, empty `getrequest`, epoch timestamps) are fixable and testable today |
| **U5** | **A decision on device authentication** (see §4, R6). A stock ZKTeco terminal's ADMS menu accepts only a server address and port — it **cannot** send `?token=`, which the current resolver requires. Choose: (a) per-branch hostname whose reverse proxy injects the secret, (b) serial-only trust plus mTLS/IP-allowlist/VPN, or (c) route every device through the Mode B agent. | The customer's network owner | A real terminal ever authenticating | Everything in U4's right-hand column |
| **U6** | **An email/SMS provider account and credentials** (SMTP or transactional-email API key; a Pakistan SMS gateway). `deploy/docker-compose.yml:210` already runs mailpit, and `grep JavaMailSender\|SendGrid\|Twilio services/` returns **zero files**. | The business owner | Production delivery only | The whole notification-service against mailpit: templates, the consumer for all six orphaned auth events, the low-stock consumer that stops `notification.low-stock.queue` growing unbounded, retry, and a provider-adapter interface with a `LogOnlyAdapter` default |
| **U7** | **The brand hue.** `--primary` is `oklch(0.205 0 0)` — pure black, zero chroma — and all five `--chart-*` tokens are chroma-zero greys, so no chart can distinguish two series. Every ramp derives from this one decision. | The business owner | The token pass (~1 day of work, blocks the whole UI revamp) | Nothing. **This is the cheapest unblock in the document — ask today.** The research proposes `oklch(0.55 0.11 178)` deep teal + `oklch(0.72 0.14 55)` warm amber as a default if no answer comes back |

### 2.2 Decisions only the product owner can make

| # | Decision | Why it cannot be deferred |
|---|---|---|
| **D1** | **Jurisdiction: FBR or provincial?** Restaurant sales are **services**, taxed provincially at ~15% by SRB (Sindh) / PRA (Punjab), **not** by FBR — except in Islamabad Capital Territory. The provincial e-invoicing APIs were **not researched at all**. FBR DI may be the wrong target for the sales side entirely. | Getting this wrong invalidates the whole 20-day FBR workstream. **Resolve before writing a line of FBR code.** |
| **D2** | Tier placement of `FEATURE_FBR_DIGITAL_INVOICING`. FBR DI is a *legal obligation* above a turnover threshold, not a premium add-on, so gating it behind GROWTH may be commercially wrong. | Changes the flag's tier set and therefore `FeatureCodeClosureTest` |
| **D3** | Whether ResturantOS becomes a **licensed integrator** (SRO 69(I)/2025 rr.150XE–150XQ; needs PASHA/ICAP certification + 3 years audited accounts). That could replace per-tenant tokens with one platform token and would **invert** the credential design. | Recommendation: no. But decide explicitly — per-tenant tokens are the safe default that works either way |
| **D4** | Whether tax must generalise beyond Pakistan. Determines whether the tax-code master is a table or a rules engine. | Changes the Phase 17 data model |
| **D5** | Charting library (research recommends `recharts@3.10.1` because shadcn's chart component *is* Recharts and the `var(--chart-N)` contract is already half-wired in `globals.css`). | Blocks the dashboard rebuild |
| **D6** | Whether the operator-editable POS tile layout (Square's model) is in v1 — it needs a backend surface to persist per-branch tile position/size/colour. | Scope of the POS rebuild |
| **D7** | Whether `/app/settings`, `/app/settings/users`, `/settings/profile` and `/app/reporting` get built or the links get deleted. Four routes are linked from **shipped** navigation and do not exist. | Either way it is a one-line change; leaving it is a live 404 |

### 2.3 Things that are *not* blocked and are often assumed to be

- **The entire testing strategy.** No credentials, no hardware, no paid accounts. All buildable now.
- **The FBR schema work.** The full spec is a free public PDF; only the *wire* is blocked.
- **The biometric repair.** The server side exists and its 8 tests pass; `curl` is a complete simulator.
- **The print renderer.** Golden-byte tests need no printer.
- **Everything in §1.2, §1.3 and most of §1.4.**

---

## 3. Phased plan

### 3.1 Reconciliation with the existing ROADMAP

`.planning/ROADMAP.md` already sketches Phases 14–17. This plan **supersedes and expands** them. The
mapping — update ROADMAP.md to match before starting:

| Old phase | Lands in |
|---|---|
| 14 — Frontend Trust & Admin Surfaces | **19** (admin surfaces + trust contract), plus the dead-link fix in **21** |
| 15 — UI/UX Revamp — ERP Design System | **20** (foundation) + **21** (screen rebuilds) |
| 16 — Multi-POS Terminals & KDS/BDS Routing | **28** (unchanged in content, moved later — it depends on the station work in 21) |
| 17 — ERP Reporting Completeness | **24** |

### 3.2 Ordering principle

Three rules, applied in order:

1. **Money bugs first.** W1–W3 are live arithmetic defects. Five days.
2. **Then the instruments.** Until the harness stops lying (§1.5), *nothing after this point can be
   trusted as done*. But land the independent smoke signal **before** rebuilding the IT harness, so a
   harness-induced red suite can be told apart from a real regression.
3. **Then unblockers before user-visible value.** Reachability and configuration are prerequisites for
   the admin UI, the receipt renderer and FBR alike.

### 3.3 The phases

Effort is **dev-days for one competent engineer**, excluding review, UAT and rework. §3.7 applies the
multiplier.

---

#### Phase 14 — Money-Path & Event-Bus Repair · **5 days** · no dependencies

**Goal:** every order that closes reaches the ledger balanced, exactly once, and a business exception
lands in a DLQ instead of a hot loop.

**Scope:**
1. Fix W1: credit **gross** `p.subtotalPaisa()` in `postOrderRevenue`, keeping the `DR DISCOUNT` contra
   line. Then `DR = total + discount = subtotal + tax + sc = CR` for all inputs.
2. Add a unit test over `postOrderRevenue` asserting `sum(debits) == sum(credits)` across a table of
   cases **including `discount > 0`, `discount + serviceCharge`, and `discount == subtotal`**. Today
   `grep discountPaisa services/finance-service/src/test` returns one hit and it is a doc comment.
3. Fix W2: add `spring.rabbitmq.listener.simple: {acknowledge-mode: auto, default-requeue-rejected:
   false, retry: {enabled: true, max-attempts: 3}}` to **finance, crm, reporting**; add
   `default-requeue-rejected: false` to audit. Without this half, the next unbalanced entry silently
   re-creates the loop.
4. Fix W3: delete the direct `financeInternalClient.autoPost` at `GrnReceiptSimulator.java:111-121`.
   The purchasing-side entry is the redundant one — it hardcodes `1300`/`1700` and cannot follow a
   tenant-edited chart of accounts, where the inventory chain resolves by `system_tag`.
5. Delete the dead `/api/v1/authorization/**` gateway route.
6. Add DLQ monitors to finance (10 DLQs), inventory (3), crm (2), reporting (3), audit (1) — copy
   `PosDeadLetterMonitor`.
7. Fix W5: make reporting consume the payload's `businessDate` verbatim, as finance does. Add a test
   asserting GL and reporting agree for an order closed at 06:00 local in a UTC+5 branch.
8. Regenerate `deploy/init/rabbitmq-definitions.json` from the code-declared `Declarables` — eight
   queues exist in code and not in that file.

**Done when:** an IT closes a discounted order and reads back a **posted, balanced** journal entry;
an IT forces a business exception in finance and asserts the message lands in the DLQ; a GRN produces
exactly one `DR 1300 / CR 1700` pair.

> Per CLAUDE.md, run `impact({target: "postOrderRevenue", direction: "upstream"})` before editing.

---

#### Phase 15 — Verification Spine · **8 days** · depends on 14

**Goal:** CI can distinguish "works" from "compiles", and there is one independent signal against a
real running stack.

**Scope:**
1. **ddl-auto parity** — a closure test (same idiom as `PermissionCatalogClosureTest`) asserting every
   test's `ddl-auto` equals its module's deployed value, with a greppable
   `// DDL-AUTO-PARITY-EXEMPT: <reason>` escape. Flip the 11 mismatched bases to `validate`. Do **not**
   phrase the rule as "always validate" — auth and authorization genuinely deploy `none`.
2. **Feign verb closure test** — scan every `@FeignClient`; fail any PATCH method whose `configuration`
   class supplies no `feign.Client` bean. Plus a transport-conformance test per configuration class
   using a JDK `java.net.httpserver` echo (zero new dependencies), and an error-shape test asserting
   upstream 400/404/409 arrive as 400/404/409, not 500.
3. **Promote `scripts/e2e/**` → `scripts/smoke/**`** — 7,356 lines of live-HTTP assertions are currently
   filed as one-shot phase artifacts. De-phase `_phase13-lib.sh`, add `run.sh --tier N`, and write the
   negative-control procedure into its README.
4. **New CI job `stack-smoke`** — bring the compose stack up from the just-built images and run tier 1.
   This is the single largest gap: CI today never starts more than one service.
5. Split the Playwright job into `e2e-local` (frontend-only specs, keeps the `webServer`) and
   `e2e-stack` (points at the brought-up stack). **Remove `continue-on-error: true`.** First confirm
   whether that job is currently red and masked — if so, it is itself an instance of this bug class.
6. Fail the reactor on failsafe/surefire **errors**, not only failures. Publish JUnit XML.
7. Settle the `shared-lib` test-jar packaging question — it determines every service's POM diff in
   Phase 18.

**Done when:** `scripts/smoke/run.sh --tier 1` exits 0 against a fresh compose stack **and has been
seen to fail** (`docker pause` one service, per the runbook's own standard).

---

#### Phase 16 — API Reachability Repair · **10 days** · depends on 14 · **parallel with 17**

**Goal:** every built domain is callable, and no shipped navigation 404s.

**Scope:**
1. `LoyaltyController` — balance, manual adjust, tier config, and **the actually-missing behaviour: a
   `redeem` method on `LoyaltyService`.** Points currently accrue forever with no way to spend them.
2. `ModifierController` + modifier selection on the order-line path, **and fix W4** — store the modifier
   *name* in the snapshot, with a backfill for existing rows.
3. `GET /counts` and `GET /counts/{id}` on `StockCountController`.
4. A public `/api/v1/audit/events` surface on audit-service **plus the gateway route** (there is none).
5. Dining-table / floor-plan CRUD.
6. Consumers (or explicit, documented deletion) for the alert events nobody listens to:
   `DEPLETION_INCOMPLETE`, `EXPIRY_ALERT`, `TRANSFER_VARIANCE`, `LOW_STOCK_ALERT`. `LOW_STOCK_ALERT`
   is urgent — its queue has no TTL and no max-length.
7. Journal the till cash variance (`TILL_CLOSED` carries `variancePaisa` and finance has no
   subscription; cash over/short is a P&L item).
8. Triage the remaining 23 orphaned routing keys: consume, or delete with a decision record. Add a
   closure test so key #42 cannot ship orphaned.

---

#### Phase 17 — Tenant Configuration Spine · **16 days** · depends on 14 · **parallel with 16**

**Goal:** a SuperAdmin can configure every ERP behaviour per tenant, and the settings have real
consumers.

**Scope:**
1. **Three-line unblock first:** add `ntn`/`fbrStrn` to `CreateBranchRequest`/`UpdateBranchRequest` and
   wire the setters in `BranchService`. This unblocks the already-shipped FBR Tax Summary report,
   which today reads columns nobody can write except by SQL.
2. **`tenant_features` backfill migration** — a tenant whose tier never changes has no rows for codes
   added after provisioning, so any new code silently 403s them (13-14-SUMMARY "Left open" #5).
3. **New RLS-scoped `user_db.tenant_profiles`**, one row per tenant, **typed columns — not EAV**:
   `base_currency`, `default_timezone`, `default_locale`, `fiscal_year_start_month`,
   `fiscal_year_label_rule`, `cash_rounding`, `tax_rounding_mode`, `tax_rounding_level`,
   `prices_tax_inclusive`, `ntn`, `strn`, `legal_name`, `registered_address`, plus jsonb **only** for
   `receipt_template` and `theme`. Exposed as `GET/PATCH /api/v1/tenants/me/profile` + an internal
   variant. Resolution order **branch → tenant → app-property default**, mirroring
   `BranchTimeZoneResolver`.
4. Wire `fiscal_year_start_month` into finance, replacing the hardcoded `PakistanFiscalYear`.
5. **Tax codes / tax profile** in finance (`tax_codes`, `tax_profiles`, effective-dated, with
   `STANDARD/ZERO_RATED/EXEMPT/FURTHER_TAX` kinds). `menu_items.tax_rate_code` — already a free-text
   column — becomes an FK-by-code; `tax_rate_pct` stays as the historical snapshot.
6. **Service charge** — fix W7: `service_charge_pct`, `service_charge_applies_to`,
   `service_charge_taxable`, wired into `OrderPricingCalculator.aggregateOrderTotals`. **Run `impact`
   first** — `OrderServiceImpl:1013` recomputes the same total independently and both call sites must
   move together.
7. **Per-tenant limit overrides** — four nullable `*_override` columns on `platform_db.tenants`, same
   null-means-tier-derived idiom as `tenant_features.is_override`. The spec asks for this
   (`Specification.md:149`) and the tier table currently forbids it.
8. Add `/api/v1/pos/` → `FEATURE_POS` to `RouteFeatureMap` — **after** the backfill, or every existing
   tenant 403s. The flagship module is currently ungated.
9. Enforce the nine tier-only codes with no route via the existing `@RequiresFeature` aspect inside
   their owning services — they are cross-cutting capabilities, not path prefixes.
10. Real branding: persist `theme` (brand colour + logo **file id**, stored via the existing MinIO
    file-service) and delete the `localStorage` stub in `appearance-form.tsx`.

---

#### Phase 18 — RLS Harness Rollout · **13 days** · depends on 15 · **parallel with 17, 19, 20**

**Goal:** integration tests run as `NOSUPERUSER NOBYPASSRLS`, so the 101 `FORCE RLS` statements are
actually exercised.

**Scope:** `RlsPostgresContainer` (bootstrap superuser stays separate; the app role is created
post-start and **owns** the tables, because migrations run on the app datasource in production);
one `testcontainers-roles.sql` per service; adopt `AbstractRlsCoverageTest` (which already exists in
`shared-lib` and has exactly one caller — itself); and a **permanent negative control** per service
asserting `current_user` is not a superuser and has no BYPASSRLS. Roll out one service per PR in
defect-density order: auth → user → platform-admin → hr → finance → inventory → pos → purchasing →
crm → kitchen → file → reporting → nlq → audit. `file-service` needs an IT base class first — it has
none.

**Expect red suites. That is the deliverable.** Triage rule: **a failure here is a production bug until
proven otherwise.** The forbidden repair is widening the role.

This also unlocks three currently-untestable defect families: the `SECURITY DEFINER` owner trap
(measured: same function returns 0 rows owned by the app role, 1 owned by the superuser), missing
`GRANT`s (a superuser needs none), and telling "the query filters" from "the policy filters".

---

#### Phase 19 — Admin & Missing-UI Surfaces · **15 days** · depends on 16, 17

**Goal:** every API from §1.3 has a screen, and the UI never lies about state.

**Scope:** wastage entry; user/RBAC admin (create user, assign per-branch role, deactivate);
HR leave request + approval (**the client functions are already written** at `hr.repository.ts:185-211`
— this is pages only); branch CRUD; the SuperAdmin tenant console (list, detail, create, lifecycle,
tier, per-feature toggles, per-tenant limit overrides, impersonation); POS station admin; HR device
registration; CRM feedback; file attachments. Plus the trust contract from the old Phase 14: a shared
`QueryBoundary` primitive with a lint rule so a failed query can never render as an empty state,
`error.tsx`/`loading.tsx`/`not-found.tsx`, a React error boundary, and the POS fire-to-kitchen failure
path that must not clear the cart.

---

#### Phase 20 — Design System Foundation · **14 days** · depends on U7 · **parallel with 16–19**

**Goal:** the product has a brand, a chart vocabulary, touch-sized controls, and one grid.

**Scope:**
1. **Token pass** (~1 day, highest visible return in the document): real OKLCH `--primary`, five
   distinguishable `--chart-*` hues, a sequential ramp for heatmaps, a diverging ramp for variance
   (till over/short, budget vs actual), `--kds-*` tokens, `-subtle`/`-border` variants replacing
   `status-badge.tsx`'s inline `/15` and `/30` alpha maths, and a typography scale.
2. `touch` (h-11 = 44px) and `pos` (h-14) sizes on Button; `touch` on Input/Select. Then **delete** the
   `.touch-target` utility — a class that adds `min-height` on top of a fixed-height component is a
   silent-layout-bug factory.
3. Sweep the 26 raw-palette files onto tokens, KDS first (16 × `bg-gray-950`).
4. **Boundary hardening first, before any of the above lands in `app/**`:** extend the eslint
   `no-restricted-imports` rule from `components/**` to `app/**` and relocate the two purchasing const-enums
   that currently leak Layer 1 into pages, reusing the `@/lib/errors` neutral-barrel pattern.
5. Add the ~24 missing shadcn primitives (Table, Select, Tabs, Sheet, Badge, Checkbox, Combobox,
   Calendar, ScrollArea, Pagination, Breadcrumb, Sidebar, AlertDialog…). **Smoke-test `shadcn add table`
   first** — there is a reported registry 404 for `style: radix-nova`; the fallback is copying the MIT
   source.
6. Add `recharts@3.10.1` + `shadcn add chart`. Greenfield — no before-state to regress. Import charts
   only in dashboard route segments, never on the POS path (Recharts pulls `@reduxjs/toolkit`).
7. Add `@tanstack/react-virtual@3.14.9`. **Stay on `@tanstack/react-table@8.21.3`** — v9.0.0 shipped
   2026-08-04 and its migration guide 404s.
8. Grow `data-table.tsx` into a real `DataGrid` **behind optional props** so all 4 existing call sites
   compile untouched: filtering (**fix W10 — register `getFilteredRowModel`**), faceting, grouping,
   column visibility, sticky header, virtualisation, density, **all state in the URL**, server-side
   pagination, saved views.

---

#### Phase 21 — Screen Rebuilds · **16 days** · depends on 20

**Goal:** the five screens a buyer judges the product by.

**Scope, in this order:**
1. **POS terminal** into its own route group `app/(operator)/pos/**`, escaping the padded, animated
   back-office shell. Vertical category column (a 40-category restaurant wraps horizontal pills into
   three rows and destroys the grid), 56px tiles, 360px ticket panel, 72px action buttons, roving
   tabindex + arrow-key grid navigation, a keyboard mode for counter billers. **Keep `cart-reducer.ts`,
   the lazy-persist `clientOrderId` idempotency, the offline outbox and the `sendInFlightRef` guard
   untouched.**
2. **KDS board** into `app/(kitchen)/kitchen/**` — which removes the `min-h-screen` + `.dark` hacks as a
   side effect. Add the bump-bar focus model (position number on every ticket, a persistent focused
   index, Toast's documented traversal order — USB bump bars enumerate as HID keyboards, so keyboard
   bindings *are* bump-bar support). Item lines at 22px, **modifiers bold and inline**; the current
   comma-joined truncated line is unreadable at two metres. **Keep `getAgingTreatment`'s
   `escalationThresholdSeconds` fraction logic exactly** — it is more principled than the industry's
   fixed 5/8-minute convention.
3. **Role dashboards** as a `PortletGrid` with Owner / Manager / Cashier presets shipped as *data*.
   An owner's dashboard answers "is the business healthy?"; a manager's answers "what needs me in the
   next five minutes?". The current four neutral cards serve neither.
4. **Convert the ~30 hand-rolled `<table>` files** to `DataGrid`, module by module, after proving it on
   three that stress different axes (PO list = facets + bulk approve; stock = inline edit + row
   decorations + volume; journal entries = grouped rows + date-range facet).
5. **Shell + navigation last** — the two-tier space rail replacing the 25-item scroll, a global search
   that reaches *business objects* not three hardcoded page names, the fixed profile menu, deleting
   the page transition, and closing D7's four dead links.

---

#### Phase 22 — Real Goods Receipt · **8 days** · depends on 14, 15

**Goal:** goods receipt stops being a simulator.

**Scope:** a real `Grn`/`GrnLine` entity and receipt workflow with partial receipt, over/under
tolerance and reversal; `GET /internal/inventory/po-lines/{poLineId}/grn-summary` — **the endpoint the
Feign client has always declared and no service has ever served**; flip `integration-mode` to `feign`
and delete `MockGrnController` + `GrnReceiptSimulator`; three-way match against real GRN data.
Replace purchasing's hardcoded account literals (`1300`/`1700`/`1710`/`2100`) with `system_tag`
resolution so a tenant-edited chart of accounts cannot break it silently.

---

#### Phase 23 — Notifications & Alerting · **8 days** · depends on 16 · needs **U6** for production only

**Goal:** the platform can tell somebody something.

**Scope:** build `notification-service` for real (it is `pom.xml` + `README.md` today). A provider-
adapter interface with a `LogOnlyAdapter` default and an SMTP adapter pointed at the existing mailpit;
templates; consumers for the six orphaned auth events (password reset **end-to-end dead** today),
`LOW_STOCK_ALERT` (its queue grows unbounded), `EXPIRY_ALERT`, `DEPLETION_INCOMPLETE`,
`TRANSFER_VARIANCE`; in-app notification storage behind the stub bell in `top-bar.tsx`; retry and DLQ.
Swap in the real provider when U6 arrives — one config change.

---

#### Phase 24 — Financial Statements, COGS & Exports · **15 days** · depends on 14, 22

**Goal:** an accountant can close a month.

**Scope:** `journal_facts` and inventory fact tables plus consumers for the currently-unconsumed
events; **P&L, Balance Sheet, labelled Trial Balance**; real COGS and gross margin on sales-by-item
(`ReportService.java:81` admits both are missing); food-cost % and labour-cost %; stock valuation
as-of a date; wastage; daily cash-up / Z-report; tender mix; sales-by-category; purchase-spend-by-vendor;
CSV **and** PDF export on every report.

---

#### Phase 25 — Biometric Attendance Repair · **4 days** · depends on **U5** · **parallel with everything**

**Goal:** the ADMS adapter a stock terminal can actually walk.

**Scope:** implement U5's chosen authentication design; fix W8 (`@ExceptionHandler(DeviceAuthException)`
returning 401 in `HrExceptionHandler`, pinned by a MockMvc test beside `TotpRequiredResponseTest`);
fix W9 (read the body from the input stream, or skip form parsing on `/iclock/**`); return `OK` from an
empty command queue; accept Unix-epoch timestamps and 3-field lines rather than dropping them silently;
set `restaurantos.hr.device-server-url` so registration stops handing installers
`https://REPLACE-WITH-GATEWAY-HOST/iclock`; per-device timezone column replacing the hardcoded
`Asia/Karachi`; a clock-skew alert off `server_received_at − device_reported_at`; a stale-device alert
off `last_seen_at`; a human double-punch debounce; **either enforce or delete** the `FEATURE_HR` claim
on `/iclock/**` (three comments assert a gate that is inert).

**The centrepiece deliverable is `AdmsHttpContractIT`** — a `RANDOM_PORT` test driving real HTTP
(`HttpClient` pinned to `HTTP_1_1`, or every request fails with "header parser received no bytes").
`AdmsIngestIT` calls the controller as a Java method and therefore **cannot see any of these four
defects.**

---

#### Phase 26 — Receipt & Kitchen Printing · **18 days** · depends on 17, 21 · needs **U3** for sign-off

**Goal:** a receipt prints, the paper cuts, the drawer kicks, and the kitchen ticket prints even when
every browser tab is closed.

**Architecture** (do not relitigate — all four browser-direct transports were checked and each fails a
hard till requirement: WebUSB is dead on Windows because `usbprint.sys` claims the printer exclusively
and it will never exist in Safari; Web Serial cannot see a USB printer-class device and Firefox 151+
requires each user to install a site-permission add-on; `window.print()` cannot kick a drawer, cut,
choose a printer or report success; browsers have no raw TCP):

**A per-branch print agent that owns the ESC/POS renderer and a durable SQLite queue, fed identical
semantic `PrintDocument` JSON by both pos-service and the POS tab, reaching printers over
`socket://ip:9100`.** The browser never emits a byte.

**Scope:** the `PrintDocument` schema in shared-lib + a mirrored TS type; the renderer with golden-byte
tests; agent v1 (loopback + LAN listener, SQLite queue, `/health`, `/printers`, `/test-print`);
server-side dispatch on `POST /orders/{id}/close` and `/send-to-kds` (**kitchen routing belongs on the
server, which already knows station assignments — this is the single biggest reliability win**); the
client bridge using `fetch(..., { targetAddressSpace: 'local' })` with explicit Chrome Local-Network-Access
denial handling; the `@page { size: 80mm auto; margin: 0 }` fallback; and a `receipt_config` admin UI
with a Test Print and a **column-ruler calibration print** — columns-per-line is measured per printer,
never hardcoded.

Do **not** make QZ Tray the architecture (silent printing needs a purchased certificate, it dies when
the tab closes, and it is one agent per machine). Support it as an optional adapter if a customer
already runs it.

---

#### Phase 27 — FBR Digital Invoicing · **20 days** · depends on **D1, U1, U2, 17, 26**

**Goal:** a closed sale is fiscalised without ever blocking the till.

**Prerequisite that is not code:** resolve **D1** (FBR vs provincial SRB/PRA — restaurant sales are
services). Then close the four schema unknowns against a live sandbox token, each of which forces a
rewrite if guessed: what the QR encodes (the spec gives version 2.0/25×25 at 1.0 inch and **nothing
about the payload**), what an offline receipt must display in place of the fiscal number, whether a
seller-supplied invoice number is required (error codes say yes, the sample JSON says no), and **how an
unregistered walk-in diner satisfies the Required `buyerBusinessName`/`buyerProvince`/`buyerAddress`
fields** — the single most likely hard blocker for restaurant use.

**Scope:** `fbr_credentials` (RLS, `api_token BYTEA` via the existing `EncryptedStringConverter`, unique
per tenant+branch+environment, environment defaulting to SANDBOX) — with a **startup assertion on
`restaurantos.encryption.key`**, because `EncryptionAutoConfiguration` is `@ConditionalOnProperty` and
will otherwise NPE on the first write, during a sale. `fbr_submissions` with
`UNIQUE (tenant_id, order_id, document_type)` as the idempotency key, `request_json` **frozen at close
and never recomputed**, `attempts`/`next_attempt_at`, and the five-state
`PENDING/IN_FLIGHT/FISCALISED/REJECTED/DEAD` machine — `REJECTED` (our data is wrong, retrying never
helps) is a different thing from `DEAD` (we could not reach them). One guarded INSERT in
`performClose`, behind three fail-closed conditions (feature on **and** active credential **and**
non-null branch NTN) so nothing changes for any existing tenant. **Ship in shadow mode first** — build
and persist `request_json`, do not POST — and validate against real closed orders before wiring the
worker.

**Three non-negotiable client rules:**
- Success is `invoiceNumber` non-empty **AND every `invoiceStatuses[].statusCode == "00"`**. Never
  branch on the outer `statusCode` — the spec's own sample shows `"00"` on a *failed* invoice.
- **Failures arrive as HTTP 200.** Any client branching on `isSuccessful()` records rejected invoices
  as fiscalised.
- The **token selects the environment, not the URL.** A credential-selection bug silently files test
  invoices as real ones. Enforce `environment` ourselves.

**Never block the sale.** Rules 150T–150XD explicitly permit issuing offline and uploading within 24
hours. `performClose` runs inside a transaction holding order locks, after money has been taken — a
PRAL slowdown there converts a third-party outage into a dead till.

Model the **72-hour amendment cutoff** in the void/refund UI: beyond it, a void is a Commissioner
petition, not a system operation, and the UI must say so.

---

#### Phase 28 — Multi-POS Terminals & KDS/BDS Routing · **10 days** · depends on 21

**Goal:** one branch runs several terminals, and food and drink route to the right display.

**Scope:** unchanged from the existing ROADMAP Phase 16 — `pos_terminals` with admin CRUD,
`terminal_id` + `source` on orders, `stations.station_type` (KITCHEN/BAR/EXPO), a BDS route reusing
the board, per-branch `menu_item_station_routes` with category fallback, till sessions bound to a
terminal (with a data-migration plan for the `uq_open_till_per_cashier` swap), and KDS WebSocket
branch-claim validation at parity with the POS socket.

---

#### Phase 29 — Production Hardening · **10 days** · depends on all

**Goal:** the system fails loudly and recovers.

**Scope:** fix W6 — publisher confirms on the outbox relay, `FOR UPDATE SKIP LOCKED` or ShedLock,
one row per transaction, a `FAILED` status with an attempt counter, and the relay's **first tests**.
Replace liveness-only health with a readiness probe that detects a wedged service (open task #12:
services wedge while `/actuator/health` returns 200) — probe the DB pool, the Rabbit channel and the
consumer's last-processed timestamp. Verify `SECURITY DEFINER` function ownership at deploy
(`deploy/scripts/verify-security-definer-owners.sh`, promoted into the smoke suite). Queue-depth and
DLQ-depth alerting. Backup/restore rehearsal. A load smoke at expected peak.

### 3.4 What runs in parallel

Disjoint services, so these can run concurrently with two or three engineers:

```
Serial spine (nothing else is trustworthy until these land):
  14 Money-Path ──▶ 15 Verification Spine
                          │
        ┌─────────────────┼──────────────────┬─────────────────────┐
        ▼                 ▼                  ▼                     ▼
 Track B (backend)   Track C (frontend)  Track D (harness)   Track E (external)
  16 Reachability     20 Design System     18 RLS Rollout      25 Biometric  (needs U5)
  17 Tenant Config    21 Screen Rebuilds   (1 service/PR,      26 Printing   (needs U3)
  22 Real GRN            │                  interleaves)       27 FBR        (needs D1,U1,U2)
  23 Notifications       │
  24 Statements          │
        └────────┬───────┘
                 ▼
          19 Admin & Missing UI   (needs 16+17 for APIs, 20 for primitives)
                 ▼
          28 Multi-POS / BDS
                 ▼
          29 Production Hardening
```

**Genuinely parallel-safe pairs:** 16 ∥ 17 (different services); 20 ∥ 16/17 (frontend vs backend);
18 ∥ anything (test code only, one service per PR); 25 ∥ anything (hr-service + gateway only);
22 ∥ 23 (purchasing/inventory vs notification).

**Not parallel-safe:** 19 after 16+17+20 (it consumes all three); 21 after 20 (primitives first);
26 after 17 (`receipt_config` and `tenant_profiles`); 27 after 26 (the fiscal receipt is the print
document) and after 17 (tax codes).

### 3.5 Effort summary

| Phase | Days | Track |
|---|---:|---|
| 14 Money-Path & Event-Bus Repair | 5 | spine |
| 15 Verification Spine | 8 | spine |
| 16 API Reachability Repair | 10 | B |
| 17 Tenant Configuration Spine | 16 | B |
| 18 RLS Harness Rollout | 13 | D |
| 19 Admin & Missing-UI Surfaces | 15 | B/C |
| 20 Design System Foundation | 14 | C |
| 21 Screen Rebuilds | 16 | C |
| 22 Real Goods Receipt | 8 | B |
| 23 Notifications & Alerting | 8 | B |
| 24 Financial Statements & Exports | 15 | B |
| 25 Biometric Attendance Repair | 4 | E |
| 26 Receipt & Kitchen Printing | 18 | E |
| 27 FBR Digital Invoicing | 20 | E |
| 28 Multi-POS Terminals & BDS | 10 | B |
| 29 Production Hardening | 10 | all |
| **Raw total** | **190** | |

### 3.6 Explicitly deferred (not in this plan)

Reservations/waitlist, online-ordering storefront, delivery dispatch (zones, riders), aggregator
integration (foodpanda / Uber Eats / Talabat / Careem), franchise/royalty/consolidation, demand
forecasting, HACCP logs, QR table ordering. Every one is IMPORTANT for a buyer and every one is
blocked on a commercial agreement or a payment-gateway merchant account the user must obtain first.
Aggregator API access in particular is gated behind a signed contract per aggregator.

### 3.7 The honest timeline

190 dev-days is the *build* estimate. It excludes code review, UAT, rework, and the discovery that
always follows a real RLS rollout. This project's own history sets the multiplier: Phase 10 was
reopened by a UAT audit with ten gaps including four blockers; Phase 13 was scoped as a repair and
grew to sixteen plans. **Apply 1.25–1.35×.**

| Staffing | Calendar (at 1.3×, 5-day weeks) |
|---|---|
| 1 engineer | **~49 weeks — roughly 11 months** |
| 2 engineers on disjoint tracks | **~28 weeks — roughly 6.5 months** |
| 3 engineers | **~21 weeks — roughly 5 months** (serial spine and 19's dependencies cap the gain) |

Three engineers is close to the floor. Phases 14→15 are serial by construction, and Phase 19 needs
16, 17 and 20 all finished. Adding a fourth engineer buys little.

**Do not promise a complete ERP with three hardware/tax integrations and a full UI rebuild in a
quarter.** If a demo-quality milestone is needed sooner, the defensible cut is
**14 + 15 + 16 + 20 + 21 + 25** — roughly 57 dev-days, ~14 weeks solo — which yields a system with a
correct ledger, honest tests, no dead APIs, a real brand and rebuilt POS/KDS screens. It would not
have printing, FBR, real GRN, notifications or financial statements, and it must be sold as such.

---

## 4. Risk register

| # | Risk | Likelihood × Impact | Concrete mitigation |
|---|---|---|---|
| **R1** | **RLS is invisible under Testcontainers' superuser.** Measured: `rolsuper=t rolbypassrls=t`, and a `FORCE RLS` table accepts an INSERT with no tenant GUC. Every RLS assertion across 101 statements / 57 tables is vacuous today. | High × Catastrophic (cross-tenant leakage in a multi-tenant ERP) | Phase 18. Keep a **separate bootstrap superuser**; create the app role post-start as `NOSUPERUSER NOBYPASSRLS`; run migrations **on the app datasource** so the app role owns the tables (`FORCE` only binds an owner). Ship a **permanent negative control** per service asserting `current_user` is neither superuser nor BYPASSRLS, plus a CI step that fails if any module's ITs ran as a superuser. **Triage rule: a failure is a production bug until proven otherwise; the forbidden repair is widening the role.** |
| **R2** | **Services wedge while `/actuator/health` returns 200** (already logged as open task #12). Liveness passes, the consumer thread is dead, orders stop reaching the ledger, nobody is paged. | Medium × Critical | Phase 29. Readiness must probe the DB pool, the Rabbit channel and **the consumer's last-processed timestamp**, not just process liveness. Smoke-suite rule: **`/actuator/health` 200 is a precondition, never a result** — every tier-1 assertion transacts through the gateway and reads back a persisted row. Alert on queue depth and DLQ depth. |
| **R3** | **Green tests over broken reality.** The named class: *the harness differs from production along the exact axis the code depends on.* Five shipped defects, all in covered lines. It will recur. | High × High | Phases 15 + 18. The counter is fidelity, not coverage: ddl-auto parity closure test; Feign verb/transport closure test; non-superuser containers; and **`stack-smoke` in CI, which is the first job that ever starts more than one service.** Add gates on *behaviours* — 10/10 journeys, 12/12 smoke assertions — and **do not raise `coverage-gates.json` in response.** Every new gate must be **seen to fail once** before it is trusted (`docker pause`, per the runbook). |
| **R4** | **The discount JE ships to a real tenant.** One discounted order → unbalanced entry → `JE_UNBALANCED` → infinite requeue (because finance has no listener config) → revenue silently missing from the ledger while a consumer thread spins. | Certain if unfixed × Critical | Phase 14, both halves together. The arithmetic fix alone is insufficient — without `default-requeue-rejected: false` the next unbalanced entry re-creates the loop instead of surfacing in a DLQ. Gate with a parameterised unit test including `discount == subtotal`. |
| **R5** | **FBR is the wrong jurisdiction.** Restaurant sales are *services*, taxed provincially by SRB/PRA, not federally — except in ICT. The provincial APIs were not researched. A 20-day workstream could target the wrong authority. | Medium × Very High | **Resolve D1 before Phase 27 starts.** Commission a short provincial-API research task and obtain the primary text of SRO 288(I)/2026 (reported to name restaurants directly). Meanwhile build only what is jurisdiction-neutral: the credential store, the submission outbox, the paisa→decimal serializer, the 72-hour UI. Design the submission table with a `regime` column so a second authority is a row value, not a migration. |
| **R6** | **No stock ZKTeco terminal can authenticate.** The device menu offers only address and port; the resolver requires `?token=`, and `verifyToken` returns false on null. The integration is unimplementable as built. | Certain × High | **U5 is a design decision, not a coding task — escalate now.** It needs the customer's network topology. Meanwhile Phase 25 fixes everything else and `AdmsHttpContractIT` locks the protocol. Whichever option is chosen, state the trade explicitly: serial-only trust means anyone who learns a serial can post punches for that tenant. |
| **R7** | **Outbox delivery is unconfirmed and unlocked.** Rows are marked `SENT` before any confirm; no distributed lock, so N replicas publish N times; one poison row rolls back the batch forever. Zero tests on 40 lines carrying every domain event. | Medium × High (rises with replica count) | Phase 29. Publisher confirms, `FOR UPDATE SKIP LOCKED`, one row per transaction, `FAILED` + attempts, and tests. **Determine the actual replica count first** — `deploy/docker-compose.yml` contains no application services, so nobody currently knows the deployed topology. Consumers dedupe via `processed_events`, but the 23 orphaned keys have no dedup at all. |
| **R8** | **Scope creep back into the deferred list.** "Complete ERP" invites reservations, online ordering, delivery and aggregators mid-flight. Each is blocked on a commercial agreement and each is a multi-week service. | High × High (schedule) | §3.6 is a contract. Any addition displaces a phase explicitly and is recorded with the displacement. Aggregators specifically cannot start before signed partner agreements exist — do not scaffold against guessed schemas, the same rule that governs FBR. |
| **R9** | **The UI revamp stalls on one unanswered question.** Every ramp derives from the brand hue; every chart from the library choice. The token pass is ~1 day and gates ~30 days of work behind it. | Medium × Medium | **Ask for U7 and D5 today; they are one email.** If no answer within a week, adopt the documented defaults (`oklch(0.55 0.11 178)` teal + amber accent; recharts 3.10.1), ship, and treat a later brand change as a token-file edit — which is exactly what the token architecture is for. |
| **R10** | **A phase declares itself done on structural evidence.** The failure that produced 24/24 for a nonexistent controller. It is the single most likely way this plan fails while appearing to succeed. | Medium × Critical | §5 is written entirely as commands and browser journeys. No phase closes without its DoD rows executed and their **output pasted into the phase summary**. `detect_changes()` before every commit, per CLAUDE.md. Any success criterion phrased as "X exists" is rewritten as "a request to X returns Y and row Z is present" before the phase is allowed to start. |

---

## 5. Definition of done

Every item is a command whose exit status decides, or a browser journey with a server-side assertion.
Nothing here is satisfied by inspection.

### 5.1 Build and test integrity

```bash
# 1. Full reactor green, ITs included
mvn -Pcoverage verify
# → BUILD SUCCESS

# 2. Zero failsafe/surefire ERRORS, not just zero failures
#    (a suite that errors during context load still reports "Tests run: N")
! grep -rl "<error" services/*/target/*-reports/ shared-lib/target/*-reports/ gateway/target/*-reports/

# 3. Every service's ITs ran as a NON-superuser
grep -rh "rls-harness" services/*/target/*-reports/ | grep -c "rolsuper=false rolbypassrls=false"
# → equals the number of service modules with a src/test directory (15)

# 4. Every tenant_id-bearing table has FORCE RLS + a policy (AbstractRlsCoverageTest, per service)
mvn -o verify -Dit.test='*RlsCoverageIT'    # → 0 failures

# 5. ddl-auto parity
mvn -o -pl shared-lib test -Dtest='DdlAutoParityClosureTest'    # → passes

# 6. No PATCH Feign method without a PATCH-capable transport
mvn -o -pl shared-lib test -Dtest='FeignVerbClosureTest'        # → passes

# 7. No published routing key without a consumer or a recorded decision
mvn -o -pl shared-lib test -Dtest='EventClosureTest'            # → passes
```

### 5.2 The stack actually runs

```bash
# 8. Every service boots and the smoke suite transacts through the gateway
docker compose -f deploy/docker-compose.yml up -d && scripts/smoke/run.sh --tier 1
# → 12/12 assertions pass, exit 0

# 9. The gate can fail (negative control — run once, record in scripts/smoke/README.md)
docker pause restaurantos-finance && scripts/smoke/run.sh --tier 1   # → non-zero exit

# 10. CI's stack-smoke job is green on main and is NOT continue-on-error
grep -A5 "stack-smoke:" .github/workflows/ci.yml | grep -c "continue-on-error"   # → 0

# 11. Zero pending migrations, zero held Liquibase locks in every database
scripts/smoke/15-rls-and-definers.sh    # → exit 0

# 12. Every SECURITY DEFINER function returns rows when called as the service role
deploy/scripts/verify-security-definer-owners.sh    # → exit 0
```

### 5.3 Money is correct

```bash
# 13. A discounted order reaches the ledger, balanced
mvn -o -pl services/finance-service verify -Dit.test='OrderCloseAutoPostingIT'
psql -d finance_db -Atc "
  SELECT SUM(debit_paisa) - SUM(credit_paisa) FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id WHERE je.status='POSTED'"
# → 0   (for every tenant, every period)

# 14. A goods receipt posts exactly once
psql -d finance_db -Atc "
  SELECT source_type, source_id, COUNT(*) FROM journal_entries
  WHERE source_type IN ('GRN','STOCK_RECEIPT') GROUP BY 1,2 HAVING COUNT(*)>1"
# → zero rows

# 15. GR/IR nets to ~zero after receipt + invoice
psql -d finance_db -Atc "SELECT balance_paisa FROM v_account_balances WHERE system_tag='GR_IR'"
# → 0 for every fully-invoiced PO

# 16. A business exception dead-letters instead of looping
#     (force an unbalanced JE; assert depth on finance.order-closed.queue.dlq == 1
#      and the consumer thread is not spinning)
rabbitmqadmin get queue=finance.order-closed.queue.dlq    # → 1 message

# 17. GL and the sales dashboard agree on business date
#     order closed 06:00 local in a UTC+5 branch appears on the SAME day in both
```

### 5.4 Nothing is unreachable

```bash
# 18. Every /api/v1 controller path has a gateway route
mvn -o -pl gateway test -Dtest='RouteClosureTest'      # → passes

# 19. Every gateway route reaches a real controller (no dead routes)
#     included in the same closure test

# 20. Every live API surface has a frontend caller OR an explicit deferral record
node frontend/scripts/api-reachability-check.mjs       # → 0 unreachable surfaces
```

### 5.5 Browser journeys (Playwright `e2e-stack`, all 10 green and blocking)

Each asserts **server-side state**, not that the UI rendered.

| # | Journey | Server-side assertion |
|---|---|---|
| 1 | SuperAdmin provisions a tenant → its admin logs in and lands on a populated dashboard | `auth_tenants` row; `user_branch_roles` OWNER row; HQ branch `is_hq=true`; temp password returned to the caller |
| 2 | Forced password change on first login | The gate blocks other endpoints before the change; other sessions revoked |
| 3 | Forgot password → reset → login | Single-use token row persisted; second redemption fails; lockout cleared |
| 4 | Cashier: open till → order → **discounted** cash settle → close till → Z-report | Balanced posted JE exists; till variance journalled |
| 5 | Waiter: create order → send to KDS → kitchen bumps → floor reflects it | Waiter holds no till permission and the order still completes |
| 6 | Two-manager PO approval → **real GRN** → invoice → payment | 409 on self-approval; inventory movement rows; AP posting; GR/IR clears |
| 7 | Tenant admin creates a user, assigns a per-branch role, that user logs in | The token carries exactly the expected permissions and **not more** |
| 8 | Two tenants on different tiers see different navigation | `GET /api/v1/feature-flags` differs; a gated route 403s `FEATURE_DISABLED` |
| 9 | Tenant suspension → login refused → reinstatement → login works | The **auth-side** tenant status changed (the compensation path), not just the platform row |
| 10 | Cross-tenant isolation: authenticated as A, every B identifier 404/403s | Tested on a list, a get-by-id, a PATCH **and** a DELETE |

### 5.6 Per-tenant configurability

```bash
# 21. A SuperAdmin can change every configurable ERP behaviour for one tenant through the UI,
#     and it takes effect without a redeploy. Verified by journey:
#     currency, timezone, locale, fiscal-year start, tax codes, service charge,
#     rounding, receipt template, branding, all 20 feature flags, all 4 tier limits.

# 22. Feature flags are enforced, not decorative
for code in $(cat feature-codes.txt); do
  # each code either has a RouteFeatureMap prefix OR a @RequiresFeature usage
done
mvn -o -pl services/platform-admin-service test -Dtest='FeatureCodeClosureTest'   # → passes
# and FEATURE_POS off ⇒ /api/v1/pos/orders returns 403 FEATURE_DISABLED

# 23. Every tenant has a row for every feature code (the backfill actually ran)
psql -d platform_db -Atc "
  SELECT t.id FROM tenants t CROSS JOIN (SELECT DISTINCT feature_code FROM tenant_features) c
  LEFT JOIN tenant_features tf ON tf.tenant_id=t.id AND tf.feature_code=c.feature_code
  WHERE tf.tenant_id IS NULL"
# → zero rows
```

### 5.7 The three external integrations

| Integration | Done means |
|---|---|
| **Printing** | On real hardware (U3): a settled order prints an 80 mm receipt, the paper **partial-cuts**, the drawer **kicks**; a kitchen ticket prints with **every browser tab closed**; the agent survives a reboot with a queued job and prints it on restart; a Test Print and a column-ruler calibration print exist in the branch admin UI; the `window.print()` fallback produces a readable receipt when the agent is stopped. |
| **Biometric** | On real hardware (U4): a terminal configured with only address+port pushes a punch that lands in `attendance_punches` with the correct employee; the same batch replayed writes no second row and emits no second event; an unmapped PIN quarantines and resolving it re-ingests; `AdmsHttpContractIT` is green including the 401, form-urlencoded, empty-`getrequest` and epoch-timestamp cases; a clock-skew alert fires on a device set 20 minutes ahead. |
| **FBR** | With a sandbox token (U1/U2): every scenario applicable to the tenant's Business Nature × Sector passes in sandbox; a closed sale produces a `FISCALISED` row with an `invoiceNumber`; the receipt carries the QR and the DI logo; **PRAL unreachable for 10 minutes does not block a single sale**, and the queued invoices fiscalise on recovery; a rejected invoice lands in `REJECTED` with its error code visible to an operator and is **not** retried; a void after 72 hours is refused by the UI with an explanation. |

### 5.8 Interface quality

```bash
# 24. Zero raw Tailwind palette classes outside the token layer
grep -rEc "bg-(gray|slate|zinc|amber|emerald|red)-[0-9]" frontend/components frontend/app   # → 0

# 25. No hand-rolled <table> outside DataGrid
grep -rl "<table" frontend/components frontend/app | grep -v data-grid | wc -l              # → 0

# 26. Every interactive control on POS and KDS is ≥44px  (axe + a Playwright bounding-box assertion)
pnpm e2e --grep "target size"                                                               # → passes

# 27. Zero dead links in shipped navigation
pnpm e2e --grep "no dead links"                                                             # → passes

# 28. Lighthouse a11y ≥ 95 on POS, KDS and the dashboard; axe reports zero criticals
```

### 5.9 The meta-criterion

**Every gate above has been seen to fail at least once**, and the procedure that made it fail is
recorded in `scripts/smoke/README.md`. A gate that has never failed is not known to be a gate — that
is the lesson of the 24/24 score, and it is the one thing in this document that must not be skipped.

---

## 6. Immediate next actions

1. **Today, by email:** ask for **U7** (brand hue) and **D5** (chart library). One reply unblocks
   ~30 days of Phase 20/21 work.
2. **Today:** start the **U1** conversation — an NTN holder must begin IRIS onboarding, and **U2**
   static egress IPs must be provisioned. The whitelisting alone has a lead time.
3. **This week:** order the **U3** printer and the **U4** ZKTeco terminal. They are cheap and both are
   on the critical path for a phase that is otherwise fully buildable.
4. **This week:** escalate **U5** (device authentication) and **D1** (FBR vs provincial). Neither is a
   coding task and both invalidate work if answered late.
5. **Start Phase 14 now.** It depends on nothing, it is five days, and it is the difference between a
   ledger that balances and one that does not.
6. **Update `.planning/ROADMAP.md`** to the §3.1 mapping before any phase work begins, so there is one
   phase numbering in the project rather than two.
