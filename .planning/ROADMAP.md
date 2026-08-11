# Roadmap: RestaurantOS

## Overview

RestaurantOS is built bottom-up from its non-negotiable foundations to its event-driven business modules. The first four phases stand up the platform that everything else depends on — containerized infrastructure, the `shared-lib` that encodes tenancy/money/event invariants, authentication + OPA authorization, the API gateway, platform/tenant administration, the Next.js shell, and CI/CD — strictly before any tenant business module exists. Cross-cutting services (notifications, audit, files) then come online to consume the events the platform already publishes. From there the dependency graph drives the order: the General Ledger and Chart of Accounts are established before any auto-posting consumer; POS produces `ORDER_CLOSED`, which inventory depletion and the auto-posting engine consume to deliver the core value (order → stock depletion → balanced double-entry JE); purchasing, HR/payroll, and finally reporting + NLQ (which consume events from everything upstream) complete the system.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Infrastructure Foundation & Shared Library** - Dev infra up; `shared-lib` enforces tenancy/money/event invariants
- [x] **Phase 2: Authentication & Authorization** - Login/JWT/JWKS/2FA + OPA fail-closed ABAC with tenant+branch isolation
- [x] **Phase 3: API Gateway, Platform Admin & Tenant/User Management** - Gateway edge security + tenant provisioning + branch/role management
- [x] **Phase 4: Frontend Shell & CI/CD** - Next.js shell with four-layer API abstraction + quality-gated pipeline
- [ ] **Phase 5: Cross-Cutting Services (Notifications, Audit, Files)** - Event-driven email/in-app, immutable audit, MinIO storage
- [x] **Phase 6: Finance Core — General Ledger & Periods** - Seeded COA, balanced+immutable JEs, period locking
- [x] **Phase 7: Point of Sale & Kitchen Display** - Orders, split-tender, tills, offline sync, KDS routing (completed 2026-07-10)
- [x] **Phase 7.1: POS Production Operations & Item-Level Kitchen Tracking** *(INSERTED)* - Order management screen, table-centric dine-in, item-level status, kitchen ticket revisions, order/item instructions, cashier UX + wire payment/till/void UI (completed 2026-07-11)
- [ ] **Phase 07.2: Finance Accounting-Period Provisioning** *(INSERTED, URGENT)* - Guarantee open period at tenant onboarding, self-service open-period endpoint, configurable auto-seed fallback — resolves parent-07 UAT blocker (423 PERIOD_LOCKED on fresh tenants)
- [x] **Phase 07.3: POS & Kitchen Production Bug-Fixes & UX Revamp** *(INSERTED)* - Remove draft orders, real-time kitchen↔POS item-status sync, Paid-AND-Served close semantics, full-page settlement + KDS station-column redesign; production hardening from `bugs.md` testing feedback (completed 2026-07-12)
- [x] **Phase 8: Inventory & Recipe Management** - Versioned BOM, `ORDER_CLOSED` depletion with MAC, receipts/transfers/counts (completed 2026-07-18)
- [x] **Phase 08.1: POS-Inventory Depletion Activation** *(INSERTED)* - Activate the already-wired `ORDER_CLOSED`→depletion loop: POS menu-item sync → inventory catalog + recipe validation, recipe-builder UI, recipe-coverage + `DEPLETION_INCOMPLETE` observability, and a live depletion proof (completed 2026-07-19)
- [x] **Phase 08.2: Inventory Master Data & Procurement Catalog** *(INSERTED)* - Ingredient categories (3-level tree), ingredient/UOM CRUD UI, recipe view/revise with live plate cost, vendor item catalog with effective-dated pricing, stock-operations UI, catalog-driven PO line picker (completed 2026-07-24)
- [x] **Phase 9: Order-to-Ledger Auto-Posting & Customer Loyalty** - The core-value loop closes: balanced revenue+COGS JEs + loyalty (executed 2026-07-01; integration-repaired 2026-08-02)
- [x] **Phase 10: Purchasing & Accounts Payable** - Vendors, PO approval, GRN/3-way match, AP (mock-first; Phase 8 optional) — REOPENED 2026-07-13 by UAT code audit (10 gaps: 4 blockers) (completed 2026-07-19)
- [ ] **Phase 11: HR & Payroll** - Employees (encrypted PII), Pakistan tax/EOBI payroll, payroll JE
- [ ] **Phase 12: Reporting, Dashboards & NLQ** - ClickHouse ETL + FBR reports, realtime dashboard, validated NLQ
- [x] **Phase 13: Platform & Tenant Access Repair** - INSERTED, BLOCKER. SuperAdmin auth path, provisioning saga repair, user lifecycle CRUD, password management, WAITER role + admin rights, authoritative seed script (completed 2026-08-07)
- [x] ~~**Phase 14: Frontend Trust & Admin Surfaces**~~ SUPERSEDED -> absorbed into Phase 19 + 21. QueryBoundary/error-boundary contract, tenant-admin users/branches UI, password UI, SuperAdmin tenant console, POS fire-to-kitchen data-loss fix
- [x] ~~**Phase 15: UI/UX Revamp - ERP Design System**~~ SUPERSEDED -> absorbed into Phase 20 + 21. Token scales, layout primitives, form/data primitives, per-role dashboards, responsive + a11y baseline
- [x] ~~**Phase 16: Multi-POS Terminals & KDS/BDS Routing**~~ SUPERSEDED -> renumbered to Phase 28. POS terminal entity, order source/terminal attribution, per-branch item→station routing, station types (KITCHEN/BAR/EXPO), BDS
- [x] ~~**Phase 17: ERP Reporting Completeness**~~ SUPERSEDED -> renumbered to Phase 24. journal/inventory fact tables + consumers, P&L, balance sheet, COGS, stock valuation, Z-report, tender mix, exports

### RENUMBERED 2026-08-07 — ERP Completion Program

Two 11-agent research swarms plus an authorization audit produced 22 documents
(`.planning/research/`) and a consolidated 16-phase plan
(`.planning/research/erp-completion/BUILD-PLAN.md`). The old 14–17 above are **superseded**
and absorbed: old 14 → new 19+21, old 15 → new 20+21, old 16 → new 28, old 17 → new 24.

The renumbering exists because research found defects that must be fixed BEFORE the
feature work that was previously queued — most importantly that no discounted order has
ever posted to the ledger, and that the audit log is empty.

### ⚠ Phase-number collision, resolved 2026-08-07 — rename DONE 2026-08-11

I created six phase directories (`27`…`32`) for the production push **without checking that the
roadmap already owned those numbers**. Second numbering collision I have caused; the first was
Phase 22 double-booked for two different bodies of work. Caught by the phase-27 planner, which
refused to write a duplicate ROADMAP entry and escalated instead — the right call.

Two of the six turned out to be the **same work** the roadmap had already numbered, which is
worth more than the numbering fix: it means the roadmap was already asking for them.

| Directory | Collided with | Resolution |
|---|---|---|
| `28-station-pos-profiles` | 28 Multi-POS & KDS/BDS Routing | **Same phase** — keeps 28, scope merged |
| `25-biometric-terminals` | 30 Business-Model Adaptivity | **Is roadmap 25** (Biometric Attendance Repair) — renumber to 25 |
| `34-visual-design-language` | 27 FBR Digital Invoicing | → **34** |
| `35-hr-usability` | 29 Production Hardening | → **35** |
| `36-purchasing-inventory-wiring` | 31 Tenant Onboarding | → **36** |
| `37-finance-orders-integration` | 32 Subscription Metering | → **37** |

The rename landed 2026-08-11, once all six planners had reported — deferring it was the point,
because renaming a directory underneath a running planner destroys its work. It was mechanical:
`git mv` on the directory and on each `NN-*.md` inside, then a reference rewrite across all 64
tracked planning documents covering plan filenames, directory paths, `phase:` frontmatter and
`D-NN-NN` decision ids. **No plan content changed.**

Directory `30` is consequently free, and belongs to Phase 30 Business-Model Adaptivity, which is
what the roadmap always meant by it.

**Do not add a phase number without grepping this file first.** `gsd-tools query init.plan-phase`
resolves on the DIRECTORY, not the roadmap entry, so a collision is silent at creation time and
only surfaces when someone tries to plan the phase that lost.

#### Phase 36 — Purchasing & Inventory Wiring Repair 

**Goal:** An owner completes vendor → purchase order → approve → receive → invoice → three-way match
→ payment entirely in the UI, on data whose ingredient references are real and whose unit
conversions are arithmetically correct — with the permission model that blocked it examined rather
than widened.
**Requirements:** PIW-01 … PIW-06
**Plans:** 8 plans, 5 waves · **7 of 8 complete** (36-01 … 36-07); 36-08 is the human browser checkpoint

Plans:

- [x] 36-01-PLAN.md — drive the whole procure-to-pay chain live and record where it actually breaks *(wave 1)*
- [x] 36-02-PLAN.md — which permission purchasing demands, who should hold it, and the repair at its cause *(wave 2)*
- [x] 36-03-PLAN.md — approval limits set in the product and gating approval *(wave 2, independently shippable)*
- [x] 36-04-PLAN.md — a PO line must name a real ingredient in a unit inventory can convert *(wave 2)*
- [x] 36-05-PLAN.md — inventory master data: complete CRUD, asserted by a coverage matrix *(wave 2, independently shippable)*
- [x] 36-06-PLAN.md — one conversion resolver, hand-checkable, and a receipt that refuses instead of guessing *(wave 3)*
- [x] 36-07-PLAN.md — the seed creates purchasing data; `CREDENTIALS.md` tells the truth *(wave 4)*
- [ ] 36-08-PLAN.md — an owner completes the chain in the browser; phase acceptance *(wave 5)*

#### Phase 37 — Finance ↔ Orders Integration, Transactions & Guide 

**Goal:** An owner opens Finance and sees today's takings by tender, reconciled against what each till
counted, with every variance shown as a variance; opens any transaction to the order behind it and the
journal entries it produced, and any entry back to its order; reads real cost and margin figures; and
finds a Guide tab that explains every finance tab in plain language, where every behavioural claim it
makes is bound to a live test.
**Requirements:** FIN-11 … FIN-16, RPT-10, RPT-11
**Depends on:** 14 (money path, landed), 22b (financial wiring audit, landed)
**Plans:** 14 plans, 6 waves

Plans:

- [x] 37-01-PLAN.md — one display authority for paisa, pinned by vectors both stacks read *(wave 1, independently shippable)*
- [x] 37-02-PLAN.md — the verified-claim registry and its two-way gate *(wave 1, independently shippable)*
- [~] 37-03-PLAN.md — one business date, honoured by every consumer; the 73 misdated facts realigned *(wave 1, closes 22b D-7)* — **code fix landed; realignment migration authored but NOT applied, blocked at the plan's own human checkpoint**
- [x] 37-04-PLAN.md — a journal entry names its order, and an order names every entry it produced *(wave 1)*
- [ ] 37-05-PLAN.md — the queue no code declares, retired; a drift check that would have caught it *(wave 2, closes 22b D-9, independently shippable)*
- [ ] 37-06-PLAN.md — tender facts: the missing half of daily takings *(wave 2)*
- [ ] 37-07-PLAN.md — cost of sales attributed to the line that consumed it *(wave 2, closes 22b D-8 data half)*
- [~] 37-08-PLAN.md — the transaction register, at money-event grain, bounded and indexed *(wave 2)* — **query + endpoint live-verified; TransactionRegisterIT and the V13 index migration NOT written**
- [~] 37-09-PLAN.md — daily takings, reconciled, honest about what it cannot compute *(wave 3)* — **API live-verified in pos-service (till counts are not in ClickHouse); no screen (37-12) and no IT**
- [ ] 37-10-PLAN.md — cost and margin reported, with a check a mirrored error cannot pass *(wave 3)*
- [x] 37-11-PLAN.md — the Transactions tab, and the round trip to the ledger and back *(wave 3)*
- [x] 37-12-PLAN.md — the Takings landing screen; Finance stops opening on a chart of accounts *(wave 4)* — **live in a browser; the seeded Rs 36,730.95 overage renders as an overage. Also fixed: the finance module refused the branch manager who does the cash-up**
- [x] 37-13-PLAN.md — the Guide tab, rendered from the registry; an unproven sentence cannot be printed *(wave 5)* — **11 sections, 12 claims, gate green; the journey caught and corrected a false sentence. 37-03's and 37-08's claims LEFT OUT for want of proof**
- [ ] 37-14-PLAN.md — inode-identity freshness gate and the six-item phase acceptance *(wave 6)*

### Execution record — what has actually landed (2026-08-07)

**Complete and independently verified** (each number re-run by the orchestrator, not taken from
the executing agent):

| Phase | Delivered | Evidence |
|---|---|---|
| **13** Platform & Tenant Access | 16 plans; blockers B1/B2/B3 | 413 live assertions, 0 failures |
| **14** Money path | Discounted orders had never reached the ledger | `DR=89600 CR=77600` → balanced |
| **14b** Truth & trust | 22 screens showed "empty" on failure | nav 6 → 19 items under a 503 |
| **15** Audit trail | Four independent defects | **0 rows → 2,600** |
| **15c** Browser E2E | Playwright harness | 50/56 live; found 7 product defects |
| **16a** Unified login | Email-first, no tenant slug | SuperAdmin can log in — first time ever |
| **17b** RLS FORCE rollout | Live cross-tenant read AND write | 78 rows/16 tenants → 10 rows/1 tenant |
| **18b** ABAC enforcement | 16 of 22 policy rules enforced nothing | cross-branch salary access closed |
| **20** Design system | OKLCH tokens, CVD-verified charts | contrast machine-checked, rendered |

**Executing in parallel, and WITHOUT a PLAN.md** — recorded as a process deviation rather than
hidden. These were driven from `.planning/research/gap-audit/DEFECT-REGISTER.md` (103 defects,
file-and-line evidence) instead of a plan, so `gsd-executor` did the work but updated none of
the GSD bookkeeping. Not back-filling the plans: a plan written after the work is a record of
what happened dressed as a decision taken beforehand. See the process note in `STATE.md`.

- [ ] **Phase 19: Admin Surfaces** - user management, settings, profile *(no PLAN.md)*
- [ ] **Phase 19b: Tables & Menu Images** - table CRUD, first file upload in the product *(no PLAN.md)*
- [ ] **Phase 19c: SuperAdmin Console** - tenants, tiers, features, usage *(no PLAN.md)*
- [ ] **Phase 21: Screen Rebuilds** - KDS board + role dashboards on the design system *(no PLAN.md)*
- [ ] **Phase 22b: Financial Wiring** - every money path proven with persisted data *(no PLAN.md)*

**Everything after these goes through `/gsd-plan-phase` before `/gsd-execute-phase`.**

**Spine (strictly serial — everything else depends on these):**

- [x] **Phase 14: Money-Path & Event-Bus Repair** - 5d. Discounted orders never posted revenue (debits exceed credits by the discount, `JE_UNBALANCED` rejects, and four services requeue the rejection forever). GR/IR double-post. *(executing)*
- [ ] **Phase 15: Verification Spine** - 8d. Non-superuser RLS harness, `ddl-auto=validate` everywhere, Feign contract tests, policy-reachability test. The countermeasure to seven "green tests over broken reality" defects.
- [x] **Phase 15b: Audit Trail Repair** - `audit_events` had 0 rows: hard-coded event source, allow-list/publisher name mismatch hiding voids and refunds, `audit_writer` unable to SELECT, user-service publishing nothing. *(executing)*

**Track C — truth and trust (parallel with 14, no dependencies):**

- [x] **Phase 14b: Truth & Trust Triage** - 3d · **COMPLETE** (1/1 plan). The Tier 0 slice of
  `.planning/research/gap-audit/DEFECT-REGISTER.md` §4.2: sixteen defects that made a working
  product look broken and empty. A failed request rendered the EMPTY state on 11 of 15 list screens
  (GA-001, now a shared `QueryBoundary` across 22 screens); one 503 on `/api/v1/feature-flags`
  deleted 8 of 11 nav items (GA-002); journal-entry totals were 100× too large (GA-007);
  `LOYALTY_POINTS` was a selectable tender with no balance check — free food that also corrupted the
  GL (GA-006); and **a new tenant's owner could not log in at all**, because TOTP enrolment had no UI
  and the error told the sole account holder to ask an administrator who does not exist (GA-008).
  Plus GA-023, GA-032, GA-053, GA-059, GA-078, GA-091–096. Evidence: 26/26 live browser assertions

  + before/after screenshots. See `phases/14b-truth-and-trust/`.

**Track B — backend reachability and configurability (parallel):**

- [ ] **Phase 16: API Reachability Repair** - 10d. Nine live API surfaces have zero frontend callers; five built domains have no controller (loyalty accrues points that can never be redeemed); audit-service has no gateway route.
- [ ] **Phase 17: Tenant Configuration Spine** - 16d. The load-bearing decision: where tenant settings live across 16 separate databases. Service model, tax profile, branding, printers, FBR credentials, quotas.
- [ ] **Phase 22: Real Goods Receipt** - 8d · needs 14, 15
- [ ] **Phase 23: Notifications & Alerting** - 8d · needs 16. Unblocks self-service password reset, which ships disabled today.
- [ ] **Phase 24: Financial Statements, COGS & Exports** - 15d · needs 14, 22

**Track C — UI/UX revamp (parallel with B):**

- [x] **Phase 20: Design System Foundation** - 14d. OKLCH ramps, five CVD-verified chart colours, both themes, component inventory. Brand colour delegated by the user (D-UI-01). *(UI-SPEC in progress)*
- [ ] *(Phase 21 listed above under the execution record — executing.)* Full scope: POS order screen (target: an order in under 10s), KDS/BDS board, role dashboards, the dense-table pattern serving 30+ screens.
- [ ] *(Phase 19 is listed above under the execution record — admin surfaces, executing)*

**Track D — security depth (parallel):**

- [ ] **Phase 18: RLS Harness Rollout** - 13d · needs 15. All 101 `FORCE ROW LEVEL SECURITY` statements across 57 tables are vacuous in every test today.
- [ ] **Phase 18b: ABAC Enforcement** - 6 of 22 OPA rules are reachable at runtime. `hr.rego` is a dead letter, so a manager at one branch can read and modify salaries at another.

**Adaptivity — the "works for any business" requirement:**

- [ ] **Phase 30: Business-Model Adaptivity** - order-first, bill-first, self-checkout, QR-at-table; the order lifecycle differs per model.
- [ ] **Phase 31: Tenant Onboarding** - guided, resumable setup driving the real Phase 13 APIs.
- [ ] **Phase 32: Subscription Metering** - per-feature usage counters, soft/hard quotas, trial→past-due→suspended.
- [ ] **Phase 33: NLQ Insights & Waste Control** - theoretical-vs-actual variance, the highest-value inventory feature for a restaurant.
- [ ] **Phase 34: Visual Design Language** - glass, depth and motion on top of phase 20's tokens. **PARTIAL (2026-08-12): 6 of 8 plans complete, 2 partial.** Landed: zoning spine + containment and print-safety gates (34-01), composite-aware contrast + solid-first glass/depth tokens (34-02), motion vocabulary + two-direction reduced-motion gate (34-03), surface primitives + dependency budget (34-04), data-state character (34-05), SPEC + POS latency (79-99ms) + bundle delta (34-08). Partial: dashboard portlets (34-06 — no chart reveal or count-up), login/console/settings (34-07). **Outstanding: the chart reveal, the count-up, the dashboard-specific tests, and re-running the three KDS assertions once kitchen-service is back up.**

- [ ] **Phase 28: Multi-POS Terminals & KDS/BDS Routing** - 10d · needs 21. No user dependency.

**DEFERRED TO LAST — blocked on user-supplied credentials or hardware (2026-08-07).**
Moved to the end at the user's direction so nothing in the critical path waits on them.
Each is built and tested against simulators/protocol fixtures first, so the user-supplied
item is needed only for final sign-off, not to start:

- [ ] **Phase 30: Biometric Terminals (ZKTeco)** - originally estimated 4d as "Biometric Attendance Repair"; **~9-11d as planned** (see the effort note under the plan list). ADMS/iClock ingest already largely exists; the remaining work is testable by crafting the raw HTTP a terminal sends. **U5** (a ZKTeco terminal) needed only to confirm firmware quirks. *(Phase directory: `25-biometric-terminals`. This entry was numbered 25 while the directory was numbered 30; renumbered here to match.)*

  **Goal:** A restaurant owner registers a biometric terminal from the product, the terminal pushes
  attendance that lands on the right employee, an unattributed punch is retained and resolvable
  rather than lost, a replayed batch never double-counts, and a terminal that stops talking is
  reported before payroll notices.
  **Requirements:** HR-07, BIO-01 … BIO-06
  **Plans:** 13 plans, 8 waves — **6 complete (25-01, 25-03, 25-04, 25-05, 25-06, 25-08), 7 outstanding.** See 25-CLOUD-TOPOLOGY-GAPS.md for four things the remaining plans do not yet cover

  Plans:

  - [x] 25-01-PLAN.md — the executable audit: what works, what is decorative, what is missing *(wave 1)*
  - [ ] 25-02-PLAN.md — the ADMS device simulator and the phase's shell harness *(wave 1)*
  - [x] 25-03-PLAN.md — the device columns a managed, observable, per-device-configured terminal needs *(wave 1)*
  - [x] 25-04-PLAN.md — device-auth refusals answer 401, and the log flood they caused is bounded *(wave 2)*
  - [x] 25-05-PLAN.md — read the bytes whatever the header says; a parser that reports outcomes *(wave 2)*
  - [x] 25-06-PLAN.md — three destinations and no fourth: quarantine reasons, deduplication, dismissal *(wave 3)*
  - [ ] 25-07-PLAN.md — per-device handshake, a durable command queue, and a closed command set *(wave 3)*
  - [x] 25-08-PLAN.md — how a stock terminal authenticates; the honest feature gate *(wave 3, blocking decision)*
  - [ ] 25-09-PLAN.md — the full device lifecycle API, and branch isolation this surface never had *(wave 4)*
  - [ ] 25-10-PLAN.md — device health, the silence sweep and clock-drift measurement *(wave 5)*
  - [ ] 25-11-PLAN.md — the terminals screen, and silence that travels with the navigation *(wave 6)*
  - [ ] 25-12-PLAN.md — the mapping screen and the unattributed-punch queue *(wave 7)*
  - [ ] 25-13-PLAN.md — the live proof and the U5 hardware sign-off list *(wave 8)*

  **Effort note:** research's 4-day estimate covered the defect fixes to the existing ADMS adapter and
  nothing else. 30-CONTEXT's definition of done is materially broader — a management UI, a health and
  alerting system, a mapping surface, a device simulator and an authentication story a stock terminal
  can walk. Plans 30-01, 30-04, 30-05, 30-06 and 30-07 are roughly the original 4 days. The remainder
  is new scope that the context asks for, not overrun. If the phase must be cut, 30-12 is the plan to
  defer, and the consequence is that the unattributed queue stays where it is today — a four-column
  table at the bottom of the attendance screen with no place for a line the parser could not read.

  **One decision 30-CONTEXT did not lock**, surfaced at a blocking checkpoint in 30-08: a stock ZKTeco
  terminal's configuration menu offers only a server address and a port, so it cannot present the
  query-parameter token this implementation requires. Verified live on 2026-08-11 — the exact boot
  request a terminal sends is refused. The phase's six definition-of-done items can all be met while a
  physical terminal still cannot connect, so the authentication mode is chosen by a human before the
  modes are built.

  **Touches the gateway.** Plan 30-04 adds the server-error status to the two device routes' circuit
  breakers. Plan 30-08 corrects comments and a route-map entry that describe a feature gate the
  gateway cannot perform on this path, moving the check into hr-service where the tenant is known, and
  fixes the bridge route's rate-limit key. Neither plan adds or removes a public path.

- [ ] **Phase 26: Receipt & Kitchen Printing** - 18d planned, **~21d as planned** (see the note under the plan list). Buildable against an ESC/POS emulator; **U3** (an 80mm printer) settles cut degradation, drawer pulse and columns-per-line, which no simulator answers.

  **Goal:** A cashier settles an order and hands the customer a correctly totalled printed bill — in
  any browser with no hardware at all, and silently on thermal paper with a cut and a cash-drawer
  kick where a printer exists — while the kitchen gets its ticket whether or not a browser is open.
  **Requirements:** PRINT-01 … PRINT-08
  **Plans:** 12 plans, 7 waves

  Plans:

  - [ ] 26-01-PLAN.md — the print document contract and the one place paisa becomes a string *(wave 1)*
  - [ ] 26-02-PLAN.md — typed per-terminal printer configuration in `receipt_config` *(wave 1)*
  - [ ] 26-03-PLAN.md — receipt issuance: assembler, `print_jobs` durable record, endpoints *(wave 2)*
  - [ ] 26-04-PLAN.md — the ESC/POS renderer and the emulator that proves the bytes *(wave 2)*
  - [ ] 26-05-PLAN.md — the 80 mm HTML bill and the FBR placeholder regions *(wave 3, independently shippable)*
  - [ ] 26-06-PLAN.md — the print agent: durable queue, transports, health *(wave 3)*
  - [ ] 26-07-PLAN.md — kitchen ticket, station-routed, dispatched after commit *(wave 3)*
  - [ ] 26-08-PLAN.md — reprint: identical body, unmistakable banner *(wave 4)*
  - [ ] 26-09-PLAN.md — the browser→agent bridge and the fallback ladder *(wave 4)*
  - [ ] 26-10-PLAN.md — printer configuration UI, test print, column ruler *(wave 5)*
  - [ ] 26-11-PLAN.md — agent enrolment and the pull channel *(wave 6)*
  - [ ] 26-12-PLAN.md — the live proof and the U3 hardware sign-off list *(wave 7)*

  **Touches the gateway.** Plan 26-11 adds one exact-match path list, one matcher and one branch to
  `JwtGlobalFilter.java` so the on-premise print agent can claim its work without a user JWT — the
  same shape as the existing device-authenticated attendance ingest. `PUBLIC_PATHS` cannot express
  it, because that list is matched by a bare `startsWith`. The existing lists are unmodified and a
  new gateway test asserts their contents and sizes permanently.

  **Effort note:** plans 26-01 through 26-10 and 26-12 fit the 18-day estimate. Plan 26-11 (the
  agent's cloud pull channel, which is what lets a kitchen ticket print with every browser closed)
  adds roughly 3 days and was not in the original estimate. It is planned because research §9.3
  decision 4 names it the single biggest reliability win available here; if the phase must be cut,
  26-11 is the plan to defer, and the consequence is that kitchen tickets drain through the browser
  and stop when the last tab closes.

  **Independently shippable:** 26-01 → 26-03 → 26-05 alone delivers a printed bill in any browser
  with no hardware, no agent and no install. That is the Tier 1 slice the defect register puts on
  the shortest path to demo-able, and nothing after it is required for a restaurant to hand a
  customer paper.

- [ ] **Phase 27: FBR Digital Invoicing** - 20d. **LAST.** Verified by live curl that every FBR endpoint — including read-only lookups — 401s without a taxpayer-issued token, so nothing beyond the offline queue and payload mapping can be validated without **U1/U2** (NTN + PRAL sandbox credentials + static egress IPs for whitelisting).

**Close-out:**

- [ ] **Phase 29: Production Hardening** - 10d · needs all. Includes root-causing the wedged-service defect: four services entered a state where `/actuator/health` returns 200 while every other path hangs, so a liveness probe would never restart them.

**Effort: ~190 dev-days raw, ~1.3× with review and rework.** Roughly 11 months solo,
6.5 with two engineers, ~5 with three — the serial spine caps further parallel gain.
A defensible real-life-testing milestone is 14+15+16+20+21+25 at ~57 days, shipping
without printing, FBR, real GRN, notifications or financial statements.

**Blocked on the user:** U1/U2 FBR NTN + PRAL sandbox credentials · U3 an 80mm ESC/POS
printer · U5 a ZKTeco terminal · U6 an SMTP/SMS provider for production notifications.
U7 (brand colour) is RESOLVED — delegated to the designer, see D-UI-01.

## Phase Details

### Phase 1: Infrastructure Foundation & Shared Library

**Goal**: Stand up the complete dev infrastructure and the `shared-lib` so that every downstream service inherits multi-tenant isolation, BIGINT-paisa money handling, and the event/outbox primitives by default — with nothing tenant-business yet built.
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, XCUT-01, XCUT-02, XCUT-03, XCUT-04, XCUT-05, XCUT-06, LIB-01, LIB-02, LIB-03, LIB-04, LIB-05, LIB-06
**Success Criteria** (what must be TRUE):

  1. `make dev-up` brings PostgreSQL 18, Redis 8, RabbitMQ 4.3, MinIO, OPA 1.17, Eureka, Config Server, ClickHouse 25.9 and pgAdmin to healthy; `psql` shows all 13 service databases, each owned by a least-privilege role that has the `app.current_tenant_id` SET parameter.
  2. The RabbitMQ management UI shows every exchange, queue, and per-consumer DLQ pre-created on first start; `generate-keys.sh` writes an RS256 keypair + AES-256 key into `.env`, and `.env.example` documents every variable.
  3. A sample service importing `shared-lib` resolves `TenantAuditableEntity`, `TenantContext`, `MoneyUtils`, `OpaClient`, `IdempotencyService`, and `DomainEventPublisher`, and tenant context propagates intact through an `@Async` call and a RabbitMQ consumer.
  4. A unit test proves `MoneyUtils` computes per-line floored tax with half-up rounding on `BIGINT` paisa, and a tenant-scoped table created without an immediate RLS changeset fails the migration/build check.
  5. A published domain event carries the standard envelope and is delivered exactly once to an idempotent consumer (duplicate delivery is a no-op via `processed_events`), proving the transactional outbox publishes on commit.

**Plans**: 4 plans

Plans:

- [ ] 01-01-PLAN.md (wave 1) — docker-compose infra (9 services incl. locally-built eureka/config) + Maven parent POM scaffold + `make dev-up`
- [ ] 01-02-PLAN.md (wave 2) — DB init (13 databases + least-privilege roles), RLS convention, `TenantAuditableEntity`, RLS-or-fail guard
- [ ] 01-03-PLAN.md (wave 2) — RabbitMQ full topology (`definitions.json`), `generate-keys.sh` (RS256 + AES-256), `.env`/`.env.example`
- [ ] 01-04-PLAN.md (wave 3) — `shared-lib` (tenant context/async + RabbitMQ propagation, feature flags, OPA, idempotency, outbox, MoneyUtils, JWT classes) + §8.9 infra tables + Testcontainers harness (SC3/SC4/SC5)

### Phase 2: Authentication & Authorization

**Goal**: A user can securely obtain a verifiable identity (RS256 JWT + JWKS, refresh, branch context, 2FA) and every access decision is mediated by a fail-closed OPA policy that enforces tenant AND branch isolation.
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, AUTH-08, AUTH-09, AUTHZ-01, AUTHZ-02, AUTHZ-03, AUTHZ-04
**Success Criteria** (what must be TRUE):

  1. A seeded user logs in with email + password + tenant slug and receives a 15-minute RS256 access JWT plus a 7-day HttpOnly refresh cookie; `/.well-known/jwks.json` serves the public key; bcrypt cost 12 and lockout are enforced.
  2. Refresh succeeds via the HttpOnly cookie, logout revokes the refresh session, and branch switch reissues a JWT with the new branch context; every attempt publishes `USER_LOGIN_SUCCEEDED` or `USER_LOGIN_FAILED`.
  3. A user sets up and verifies TOTP (the `totp_secret` is stored AES-256-GCM encrypted); `rbac.manage` and `finance.period.close` are refused without a valid TOTP step, and password reset via emailed token works.
  4. `POST /internal/authorize` returns an OPA decision that denies cross-tenant and cross-branch access and fails closed (deny) on OPA timeout (2s).
  5. `opa test` reports 100% policy coverage across common/pos/finance/vendor/rbac, with `same_tenant`, `same_branch`, and `has_permission` helpers exercised.

**Plans**: 3 plans

Plans:

- [x] 02-01: Auth service — login, RS256 JWT + JWKS, refresh sessions, lockout, login events
- [x] 02-02: 2FA (TOTP, encrypted), password reset, branch switch
- [x] 02-03: Authorization service + OPA Rego policies (tenant+branch, 100% coverage)

### Phase 3: API Gateway, Platform Admin & Tenant/User Management

**Goal**: The platform edge is secured and operable — the gateway authenticates/route/rate-limits every request, the SuperAdmin can provision and operate tenants, and Tenant Admins can manage branches and per-branch roles that feed JWT issuance.
**Depends on**: Phase 2
**Requirements**: GW-01, GW-02, GW-03, GW-04, GW-05, GW-06, PLATFORM-01, PLATFORM-02, PLATFORM-03, PLATFORM-04, PLATFORM-05, PLATFORM-06, PLATFORM-07, PLATFORM-10, USER-01, USER-02, USER-03
**Success Criteria** (what must be TRUE):

  1. A request with a missing/invalid JWT to any protected route returns 401 at the gateway, while `auth/login`, refresh, `/.well-known/*`, and health pass through; the gateway resolves the tenant (JWT claim or custom-domain Host) and propagates `X-Tenant-Id`.
  2. The gateway routes each public prefix to its upstream behind per-upstream circuit breakers, rate-limits (100/min/IP auth, 600/min/IP general) via Redis token bucket, returns 403 `FEATURE_DISABLED` with `X-Upgrade-CTA-URL` for disabled features, and 429 `QUOTA_EXCEEDED` for NLQ over quota; Nginx terminates TLS in front.
  3. A SuperAdmin provisions a tenant in under 60s — tier features seeded, Tenant Admin + HQ branch created, COA seeded, `TENANT_PROVISIONED` published — and can list/paginate tenants, suspend/reactivate/cancel, update feature flags (cache invalidated immediately), impersonate (JWT stamped `impersonated_by`, 30-min expiry, logged), and view telemetry.
  4. `platform_db` contains no `tenant_id` columns and only platform-admin-service can connect to it.
  5. A Tenant Admin CRUDs branches and assigns roles per branch, and the internal endpoints return branch details + computed user permissions used for JWT issuance.
  6. A SuperAdmin can enable or disable any module (`FEATURE_*`) for any tenant independent of its tier — granting a module above the tenant's tier or revoking one — and the change persists on `tenant_features`, invalidates the Redis cache immediately, is audited, and is enforced at both the gateway and the `@RequiresFeature` aspect; the six primary modules + KDS default ON in all tiers.

**Plans**: 3 plans

Plans:

- [x] 03-01-PLAN.md (wave 1) — API gateway: routing, JWT validation, tenant resolution, rate limits, feature/quota enforcement, Nginx TLS (GW-01..06)
- [x] 03-03-PLAN.md (wave 2) — User & branch service: branch CRUD (RLS), per-branch role assignment delegated to auth-service, internal branch/permission endpoints feeding JWT issuance (USER-01..03)
- [x] 03-02-PLAN.md (wave 3) — Platform admin service: provisioning saga (FD-1), lifecycle, feature flags + tier-independent module enable/disable with immediate dual-key cache invalidation (PLATFORM-10), impersonation, telemetry, non-RLS `platform_db` (PLATFORM-01..07)

### Phase 4: Frontend Shell & CI/CD

**Goal**: Deliver the Next.js shell with its enforced four-layer API abstraction and route protection, and a fully automated quality-gated pipeline — completing the verified Sprint-1 "GO" set before any tenant business module is built.
**Depends on**: Phase 2, Phase 3
**Requirements**: FE-01, FE-02, FE-03, FE-04, FE-05, FE-06, FE-07, FE-08, INFRA-05
**Success Criteria** (what must be TRUE):

  1. The shell renders auth/platform/tenant route groups; visiting a tenant or platform route without a valid session redirects to login; the login page reads the tenant slug from subdomain/`?tenant=` and shows the conditional TOTP step.
  2. Sidebar nav plus `FeatureGuard`/`PermissionGuard` hide items by permission and feature flag; `BranchSwitcher` reissues the JWT and invalidates the query cache.
  3. Every API response is Zod-parsed through the four-layer abstraction before adaptation, MSW mocks back auth in dev, ESLint blocks components importing `lib/api-client` or `lib/repositories`, and `tsc --noEmit` passes with zero `any`.
  4. The CI pipeline runs lint → test → build → schema-sync with no manual intervention, enforcing coverage gates (finance/inventory ≥75%, others ≥60%, OPA 100%) and producing signed images.

**Plans**: 3 plans

Plans:

- [x] 04-01-PLAN.md (wave 1) — Next.js 16 shell: scaffold + Tailwind 4/shadcn, route groups, `proxy.ts` + DAL protection, four-layer API abstraction (auth domain), MSW dev+test, ESLint boundary + strict tsc (FE-01/02/03/07-infra/08)
- [x] 04-02-PLAN.md (wave 2) — Auth UX & guards: login + conditional TOTP, PermissionGuard/FeatureGuard, permission/feature-conditioned Sidebar, BranchSwitcher (JWT reissue + cache invalidation), MSW contract tests (FE-04/05/06/07)
- [x] 04-03-PLAN.md (wave 2) — CI/CD pipeline: lint → test → build → schema-sync, data-driven coverage gates (finance/inventory ≥75%, others ≥60%, OPA 100%), cosign-signed multi-arch GHCR images, Playwright scaffold (INFRA-05)

**Gap-closure plans (design system shell — DS-01..07, `gap_closure: true`):**

- [x] 04-04-PLAN.md (wave 1) — Design tokens + keyframes + deps + WCAG validator + ThemeToggle + StatusAnnouncer (DS-01, DS-07)
- [x] 04-05-PLAN.md (wave 2) — Skeleton system + PageTransition + motion variants (DS-02, DS-03)
- [x] 04-06-PLAN.md (wave 2) — Core UI primitives: CommandPalette, AnimatedNumber, StatusBadge, MoneyDisplay, DataTable, EmptyState (DS-04)
- [x] 04-08-PLAN.md (wave 2) — Tenant theming: OKLCH palette gen, `/api/theme`, Settings→Appearance (DS-06)
- [x] 04-07-PLAN.md (wave 3) — Shell chrome: Sidebar + TopBar + MobileBottomNav + theme injection (DS-05, DS-06 inject, DS-07 mount)

### Phase 5: Cross-Cutting Services (Notifications, Audit, Files)

**Goal**: Bring the cross-cutting consumers online to act on the events the platform already publishes — templated notifications, an immutable audit trail, and tenant-scoped file storage.
**Depends on**: Phase 1, Phase 3
**Requirements**: NOTIF-01, AUDIT-01, FILE-01
**Success Criteria** (what must be TRUE):

  1. A triggering event (e.g., tenant provisioning, password reset, low-stock, PO approval) produces a templated per-tenant email and an in-app notification.
  2. Significant actions (login, impersonation, provisioning, voids/refunds) are written to an append-only audit log with 7-year retention/archival and cannot be mutated or deleted.
  3. A user uploads a file to MinIO scoped to their tenant, and an upload that would exceed the tenant's quota is rejected.

**Plans**: 3 plans

Plans:

- [ ] 05-01: Notification service — templated email + in-app, rules engine, event consumers
- [ ] 05-02: Audit service — immutable log, 7-year retention/archival
- [ ] 05-03: File service — MinIO storage, per-tenant quota enforcement

### Phase 6: Finance Core — General Ledger & Periods

**Goal**: Establish the immutable, balanced double-entry ledger and accounting periods that every auto-posting consumer depends on — before any consumer exists to post into it.
**Depends on**: Phase 1, Phase 3
**Requirements**: FIN-01, FIN-02, FIN-04, FIN-06
**Success Criteria** (what must be TRUE):

  1. Each provisioned tenant has the Pakistan Chart of Accounts seeded, and accounts are queryable.
  2. A manual journal entry that does not balance is rejected by the deferred DB trigger; posted entries are immutable and can only be corrected by a reversal entry.
  3. 12 accounting periods per fiscal year (Pakistan Jul–Jun) are seeded, and closing a period sets it LOCKED only after internal-API pre-checks pass (no cross-service SQL).
  4. Any attempt to post to a LOCKED period returns 423 `PERIOD_LOCKED`.

**Plans:** 2/2 plans complete

Plans:

- [x] 06-01-PLAN.md — Finance service scaffold + COA seeding (55 accounts) + balanced/immutable JE engine (deferred trigger, reversal-only) + GL API + IT suite (Wave 1)
- [x] 06-02-PLAN.md — Accounting periods (Jul–Jun) + period close/lock (TOTP-gated, Feign stubs) + Finance frontend pages §7.4 (Wave 2, depends on 06-01)

### Phase 7: Point of Sale & Kitchen Display

**Goal**: Staff can run the floor end-to-end — open orders, route to the kitchen, take split-tender payments, manage tills, and operate offline — emitting the events (`ORDER_CLOSED`, `TILL_*`) that downstream modules consume.
**Depends on**: Phase 3
**Requirements**: POS-01, POS-02, POS-03, POS-04, POS-05, POS-06, POS-07, POS-08, KDS-01, KDS-02
**Success Criteria** (what must be TRUE):

  1. Staff open a table/order and add items with the order state machine enforced (DRAFT→OPEN→SENT_TO_KDS→…→CLOSED/VOIDED/REFUNDED), and a discount can never push a line below zero.
  2. Sending an order to the kitchen publishes `ORDER_SENT_TO_KDS` and routes items to station queues that progress PENDING→COOKING→READY, with `ORDER_READY` notifying POS.
  3. Split-tender payments close an order with defined 1-paisa rounding resolution and an idempotent close; voids/refunds respect permission + OPA thresholds and publish idempotent events.
  4. Till open/close reconciles cash and emits `TILL_OPENED`/`TILL_CLOSED`, and `ORDER_CLOSED` is published carrying `customerId`.
  5. An order taken while offline (Service Worker + IndexedDB) syncs once connectivity returns using `client_order_id` as the idempotency key, creating no duplicate orders.
  6. A dedicated kitchen-only role (`KITCHEN_STAFF`, perms `pos.kds.view`/`pos.kds.update` only) is strictly isolated: kitchen logins are blocked from POS/finance, cashier/finance logins are blocked from the KDS REST + WebSocket, and the owner sees everything — enforced fail-closed via OPA and proven in both directions.
  7. An order can be closed with a "charge to account" tender against a corporate/house account, creating an AR receivable in finance-service (FIN-05) rather than a cash/card settlement.

**Plans**: 9/9 complete (07-09 charge-to-account tender shipped 2026-08-02)

Plans:

- [x] 07-01: Orders, tables, order state machine, discount floor + POS permissions (CASHIER/MANAGER)
- [x] 07-02: Split-tender payments, idempotent close, voids/refunds, tills, period-lock 423, pos.rego
- [x] 07-03: Offline POS — Service Worker + IndexedDB sync with `client_order_id`
- [x] 07-04: Kitchen Display System — station routing, item progression, `ORDER_READY` + KITCHEN_STAFF role & strict access isolation

Gap-closure plans (UAT-diagnosed, `gap_closure: true`):

- [x] 07-05-PLAN.md (wave 1) — finance-service: Pakistan-fiscal-year bug + auto-seed-on-miss fallback for accounting periods (fixes permanent 423 PERIOD_LOCKED on fresh tenants)
- [x] 07-06-PLAN.md (wave 1) — pos-service: Order.cashierId/tillSessionId never set at creation (till-close open-orders gate was a no-op; void.own created_by could never match) + TillSession variance staleness fix
- [x] 07-07-PLAN.md (wave 1) — auth-service: CASHIER granted pos.order.void.own + KITCHEN_STAFF/MANAGER demo seed users (chef@demo.local / manager@demo.local)
- [x] 07-08-PLAN.md (wave 1) — Dockerfile module pom.xml COPY fixes (cold-start `docker compose up --build`) + pos-service/kitchen-service wired into start-dev.ps1/restart-service.ps1
- [x] 07-09: POS "charge to account" tender — on order close, call POST /internal/finance/ar/charges (Phase 10 / 10-18 seam) with the order's customerId + total; the receivable and its balanced JE (DR 1200 / CR revenue) are created by finance-service, not POS. Blocks FIN-05 from being fully Complete. [added 2026-07-13 by 10-17-A as 07-05; renumbered to 07-09 on the 2026-07-14 main merge, which had already shipped 07-05..07-08]

### Phase 07.2: Finance accounting-period provisioning — guarantee open period at tenant onboarding, self-service period-open endpoint + calendar-based provisioning UI, configurable auto-seed fallback (INSERTED)

**Goal:** Guarantee every ACTIVE tenant has an open accounting period covering the current business date; provide a permissioned self-service endpoint AND a calendar-based frontend UI to provision/open periods for any fiscal year; and make the existing silent auto-seed fallback configurable and audited — resolving the 423 PERIOD_LOCKED blocker on fresh tenants without changing pos-service's fail-closed behavior.
**Requirements**: FIN-07, FIN-08, FIN-09, FIN-10
**Depends on:** Phase 7
**Success Criteria** (what must be TRUE):

  1. A finance-seeding failure during tenant onboarding aborts the saga (tenant → PROVISIONING_FAILED) instead of silently continuing to ACTIVE with zero accounting periods (FIN-07).
  2. An OWNER/TENANT_ADMIN/ACCOUNTANT can call `POST /api/v1/finance/periods/provision` (gated `finance.period.open`, tenantId from JWT only) to idempotently provision their own tenant's CoA + periods (FIN-08).
  3. The `getPeriodStatus` auto-seed-on-miss fallback is config-gated (`finance.period.auto-seed-on-miss`, default on dev/staging, off prod) with a WARN audit line when it fires (FIN-09).
  4. On the running dev stack (services restarted onto current jars, `/actuator/health` UP), a POS order-close for a period-less tenant no longer returns 423 PERIOD_LOCKED.
  5. A permissioned user can browse to any fiscal year (past, current, or future — computed dynamically, never hardcoded) in the Finance → Periods UI and provision/open it via a calendar-based preview dialog before confirming (FIN-10).

**Plans:** 6/7 plans executed

Plans:
**Wave 1**

- [x] 07.2-01-PLAN.md — Bookkeeping reconciliation: mark Phase 6 / FIN-01,02,04,06 complete + register FIN-07/08/09/10 in REQUIREMENTS.md (Wave 1, docs-only)
- [x] 07.2-02-PLAN.md — auth-service: changeset 044 `finance.period.open` permission (OWNER/TENANT_ADMIN/ACCOUNTANT grants) + master-changelog include + DB-assertion IT (Wave 1)
- [x] 07.2-03-PLAN.md — platform-admin-service: harden onboarding Step 5 (fail-fast, no swallow) + flip seed-coa default true + stubFinanceSeedCoaFail + saga-failure IT (Wave 1)
- [x] 07.2-04-PLAN.md — finance-service: config-gate `getPeriodStatus` auto-seed-on-miss (`finance.period.auto-seed-on-miss`) + WARN audit + toggle-off IT (Wave 1)
- [x] 07.2-05-PLAN.md — finance-service: `POST /api/v1/finance/periods/provision` endpoint (permissioned, JWT-tenant-scoped, idempotent) + happy-path/idempotency ITs (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 07.2-07-PLAN.md — frontend: calendar-based "Provision Periods" UI — dynamic fiscal-year navigator + 12-period preview dialog, permissioned (`finance.period.open`), wired into `/app/finance/periods` (Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 07.2-06-PLAN.md — Phase verification: restart 3 services + /actuator/health + full IT suite + live 423-resolution E2E + permission-gate + frontend provisioning click-through (Wave 3, human-verify checkpoint)

### Phase 07.1: POS Production Operations & Item-Level Kitchen Tracking (INSERTED)

**Goal**: Upgrade the POS from a working MVP into a production-ready restaurant operations surface — a table-centric dine-in flow, an active-order management screen, item-level kitchen status (with the order status *derived* from its items), industry-standard "add items to an existing order" kitchen ticket revisions, order/item special instructions, a redesigned fast cashier terminal, and a KDS that shows stable cards with item-level status, revisions, and instructions — while wiring the already-built payment/till/void UI that the Phase-7 UAT found was never rendered.
**Depends on**: Phase 7
**Requirements**: POS-09, POS-10, POS-11, POS-12, POS-13, POS-14, POS-15, KDS-03
**Success Criteria** (what must be TRUE):

  1. A cashier can open a dedicated Order Management screen that lists active orders (their own or all branch orders per permission) with derived status, and can open, edit, reopen, and take payment on any active order; an order stays OPEN until it is paid and closed.
  2. The table floor view is the primary dine-in entry point: selecting a table shows its current active order, order status, assigned server/cashier, and a live bill summary, and every dine-in order is linked to a table.
  3. Every order line carries its own status (PENDING → SENT → ACCEPTED → PREPARING → READY → SERVED, or CANCELLED), and the order's overall status (DRAFT / IN_PROGRESS / PARTIALLY_SERVED / SERVED / CLOSED) is derived from its line statuses rather than set independently.
  4. A cashier can add items to an already-sent order and send ONLY the newly-added items to the kitchen as a new revision; previously-sent or served lines are never resent, and the order keeps a revision history (Rev 1, Rev 2, …) — implemented per researched industry-standard POS behavior.
  5. Orders and individual items accept special instructions (e.g. "no onions", "medium rare"), captured at create/edit time and surfaced to the kitchen on the ticket and order-detail view.
  6. The KDS board renders stable (non-jumping) cards, lets staff open a ticket to view full order detail + instructions, visually distinguishes newly-added revision items from earlier ones, and shows per-item status rather than only a single order-level status.
  7. The cashier terminal is usable for real service — the already-built PaymentPanel, TillSessionBar, and VoidRefundDialog are rendered and reachable (a cashier can charge, open/close a till, and void/refund through the UI), the void 403 and the offline sync-badge-not-updating gaps from the Phase-7 UAT are closed, and the first-item / item-cap add bugs are fixed, with fast order creation, quick item search, and clear status indicators.

**Plans**: 10/10 plans complete

Plans:

- [x] 07.1-01-PLAN.md (wave 1) — POS-11 foundation: 7-value OrderItemStatus + revision fields + DerivedOrderStatus + NEEDS_BUSSING + V4 migration + pure OrderStatusDerivationService (unit-tested)
- [x] 07.1-02-PLAN.md (wave 1) — kitchen-service revisions/KDS-03 backend: KdsTicketItem revision fields + V3 migration + append-not-skip TicketRoutingService + additive payload mirror + ticket-detail endpoint + TicketRevisionRoutingIT
- [x] 07.1-03-PLAN.md (wave 2) — POS-12/11/13 pos-service: fire-only-PENDING sendToKds + revision stamp + clientFireId idempotency + loosened guards + item serve/cancel + instructions edit + derivation wiring + 3 ITs
- [x] 07.1-04-PLAN.md (wave 3) — POS-09/10/14 backend: non-terminal order list + OrderSummaryDto + permission-gated own/all-branch + table→active-order lookup + createOrder tableId + table lifecycle + void-403 fix + 2 ITs
- [x] 07.1-05-PLAN.md (wave 4) — Frontend four-layer data extension (schema/model/adapter/repository/hooks) + StatusBadge icon system + revision-chip + clientFireId header
- [x] 07.1-06-PLAN.md (wave 5) — POS-14/15: shared Settlement Actions + OrderPanel redesign + page-level TillSessionBar + 3-tab scaffold + sync-badge fix + void-403 UX (human-verify checkpoint)
- [x] 07.1-07-PLAN.md (wave 5) — KDS-03 board: 7-state per-item status + revision pills + stable non-jumping sort + ticket-detail view + Kitchen Notes
- [x] 07.1-08-PLAN.md (wave 6) — POS-15 terminal: menu search + investigated item-cap/first-item fixes + tableId binding
- [x] 07.1-09-PLAN.md (wave 6) — POS-09: shared Order/Table Detail drawer + Order Management screen (DataTable, filters, permission-gated toggle, non-closed-never-disappears)
- [x] 07.1-10-PLAN.md (wave 7) — POS-10: table-centric floor view (semantic tokens, 3-state lifecycle, tap-to-start-order / tap-to-open-shared-drawer)

### Phase 07.3: POS & Kitchen Production Bug-Fixes & UX Revamp

**Goal:** Turn the Phase-7.1 POS/KDS into a production-grade surface by fixing the 16 issues from testing (`bugs.md`): eliminate draft-order persistence, merge item quantities, make table optional with an order-type selector, reset the terminal after send with charge gated on send, propagate per-item kitchen status back to POS in real time, fire only newly-added items from Order Management as a revision, replace modal-heavy flows (payment, order/table detail, void/refund, till, KDS detail) with dedicated full-page/large views, decouple payment from close so an order closes only when Paid AND Served, surface closed/paid orders with search + payment status + item-quantity + assign-table, remove the stray connectivity 404, and redesign the KDS into station-isolated New/Started/Preparing/Ready item-status columns with subtle prioritization — without regressing the Phase-7.1 revision/derivation model or the cross-service messaging contracts.
**Depends on:** Phase 7.1
**Requirements**: POS-16, POS-17, POS-18, POS-19, POS-20, POS-21, POS-22, POS-23, POS-24, POS-25, POS-26, KDS-04, KDS-05
**Success Criteria** (what must be TRUE):

  1. Tapping menu items never creates a DB order; an order is persisted only on Send-to-Kitchen or Charge, `DRAFT` is gone from user-visible flows, and no empty/abandoned orders appear in any list (POS-16); repeated taps of the same item merge to ×N with ± controls unless modifiers/notes differ (POS-17).
  2. A cashier can create Dine-in/Takeaway/Pickup orders with the table optional via a searchable Available/Occupied selector (POS-18); after Send to Kitchen the terminal can be cleared for the next customer and Charge Now is enabled only once the order is sent (POS-19).
  3. When the kitchen advances an item, the POS reflects the new per-item status in real time without a manual reopen (POS-20); items added to an existing order from Order Management persist instantly, fire only the new items as a new revision, and a manual Refresh exists (POS-21).
  4. Charge Now is a dedicated full-page/large view with full order + payment analytics and payment history (POS-22); recording payment sets payment status and persists `OrderPayment` without closing, and an order closes only when BOTH Paid AND Served, enforced on the payment and serve flows (POS-23).
  5. Order Management shows closed/paid orders with filters + search + payment-status badges, an item-quantity column replacing Cover, and an Assign-Table action; duplicate payment is blocked while paid orders stay accessible (POS-24); the payment, detail, void/refund, and till surfaces are dedicated pages/large panels, not modals (POS-25); the console no longer logs the `/pos/menu/categories` 404 (POS-26).
  6. The KDS shows each station in an isolated view with New/Started/Preparing/Ready item-status columns (mixed statuses per order), slim cards (order#/table/time/items), and a dedicated detail page; stations are seeded so the board renders and the table number shows on tickets (KDS-04); long-running orders auto-highlight subtly and the board scales for many orders (KDS-05).

**Plans:** 11/11 plans complete

Cross-cutting truths (goal-backward): no DB order exists until Send/Charge; derivedStatus only via
OrderStatusDerivationService; table status only via TableService.syncStatusForOrder; cross-service
event field-name parity (message actually consumed, not dropped); an order closes only when Paid AND
Served.

Plans:

**Wave 1**

- [x] 07.3-01-PLAN.md (wave 1) — Settlement backend: persist OrderPayment, GET payments, PaymentStatus derivation, single maybeCloseOrder(Paid&&Served) seam (POS-23, POS-22)
- [x] 07.3-02-PLAN.md (wave 1) — Kitchen→POS item-status event: KITCHEN_ITEM_STATUS_CHANGED emit + pos consumer (parity, idempotent, no downgrade) (POS-20)
- [x] 07.3-03-PLAN.md (wave 1) — Order-taking client cart + order-type/table selector + reset + charge-gating + PICKUP order type (POS-16, POS-17, POS-18, POS-19)

**Wave 2**

- [x] 07.3-04-PLAN.md (wave 2) — pos-service: OrderSummaryDto extension + assign-table + exclude-DRAFT + sendToKds tableNumber emit (POS-24, POS-16, KDS-04)
- [x] 07.3-05-PLAN.md (wave 2) — KDS-04 kitchen backend: item-status endpoint + table-number propagation (V5) + DEFAULT-station seeding (KDS-04)
- [x] 07.3-06-PLAN.md (wave 2) — Frontend live-sync + add-to-existing revision fire + manual Refresh + detail-drawer panelization (POS-20, POS-21, POS-25)
- [x] 07.3-07-PLAN.md (wave 2) — Full-page Charge surface + payment-status badge + payment history (POS-22, POS-23, POS-25)

**Wave 3**

- [x] 07.3-08-PLAN.md (wave 3) — Order Management UI completeness: filters/search/payment-badge/item-quantity/assign-table (POS-24)
- [x] 07.3-09-PLAN.md (wave 3) — Modal→page sweep: void/refund + till panels + connectivity-404 removal (POS-25, POS-26)
- [x] 07.3-10-PLAN.md (wave 3) — KDS station-board redesign: item-status columns + slim card + detail page + subtle prioritization (KDS-04, KDS-05)

**Gap Closure** (from 07.3-VERIFICATION.md — BLOCKER: legacy close-path Paid-AND-Served bypass)

- [x] 07.3-11-PLAN.md (wave 1) — Retire legacy POST /orders/{id}/close to 410 Gone + delete the closeOrder tender-sum bypass so maybeCloseOrder (Paid AND Served) is the only close path; migrate 7 IT fixtures; delete orphaned PaymentPanel/useCloseOrder dead code (POS-23)

### Phase 8: Inventory & Recipe Management

**Goal**: Inventory tracks stock and valuation accurately and reacts to sales — versioned recipes drive `ORDER_CLOSED` depletion with moving-average cost, and receipts/transfers/counts keep MAC and quantities correct.
**Depends on**: Phase 6, Phase 7
**Requirements**: INV-01, INV-02, INV-03, INV-04, INV-05, INV-06, INV-07
**Success Criteria** (what must be TRUE):

  1. Managers manage ingredients, UOM, and reorder points, and opening stock is recorded via an `OPENING_BALANCE` movement.
  2. Recipes/BOM are versioned, and depletion uses the recipe version that was effective at order time.
  3. On `ORDER_CLOSED` the inventory consumer depletes stock with `SELECT FOR UPDATE`, maintains moving-average cost, and is idempotent on duplicate delivery.
  4. Stock receipts update MAC and publish `STOCK_RECEIVED`, and transfers ship/receive with in-transit accounting and variance handling.
  5. Stock counts post variances, and low-stock and expiry alerts fire.

**Plans**: 9/9 plans complete

Plans:
**Wave 1**

- [x] 08-01-PLAN.md — Wave 1: Module foundation, complete FORCE-RLS schema, infra tables, processed-events + event payloads (INV-01/03/07 infra)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 08-02-PLAN.md — Wave 2: Testcontainers harness (InventoryTestBase/TestFixtures) + schema/RLS smoke IT
- [x] 08-09-PLAN.md — Wave 2: OPA `inventory.rego` (view/manage on seeded permission codes, 100% covered) + `InventoryAuthorizationService` seam + `InventorySecurityConfig`/internal-secret filter (T-8-AC access-control foundation)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 08-03-PLAN.md — Wave 3: Stock domain model + ingredient/UOM/reorder masters + MAC calculator + opening balance + gateway route + OPA enforcement (INV-01, INV-07)
- [x] 08-04-PLAN.md — Wave 3: Versioned recipes/BOM + effective-version-by-closedAt resolution (INV-02)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 08-05-PLAN.md — Wave 4: `ORDER_CLOSED` depletion consumer — sorted pessimistic locks, FEFO walk, MAC COGS, idempotency, `STOCK_DEPLETED` (INV-03)
- [x] 08-06-PLAN.md — Wave 4: Stock receipts (MAC recompute + `STOCK_RECEIVED`) + `GET /internal/grn/pending-count` finance seam (INV-04)
- [x] 08-07-PLAN.md — Wave 4: Inter-branch transfers ship/receive with in-transit accounting + variance (INV-05)
- [x] 08-08-PLAN.md — Wave 4: Stock counts + variance posting, low-stock alerts, nightly `@Scheduled` expiry sweep (INV-06)

### Phase 08.1: POS-Inventory Depletion Activation (INSERTED)

**Goal**: The already-wired `ORDER_CLOSED`→depletion loop (built in Phase 8) becomes functional and trustworthy — POS menu items sync to inventory so recipes attach to real `menu_item_id`s with validation, operators author recipes via a UI, recipe coverage and un-recipe'd sales are surfaced instead of silently skipped, and a live order demonstrably depletes stock with correct COGS.
**Depends on**: Phase 08
**Requirements**: INV-09, INV-10, INV-11, INV-12
**Success Criteria** (what must be TRUE):

  1. POS publishes `MENU_ITEM_UPSERTED`/`MENU_ITEM_DELETED` on menu-item changes (plus a backfill/republish for existing items); inventory maintains a `menu_item_catalog` read-model from those events, and recipe creation rejects a `menu_item_id` not present/active in the catalog.
  2. An operator can author a versioned recipe (menu item → ingredient lines with quantity + UOM + `effectiveFrom`) through the `/app/inventory` recipe-builder UI, selecting from the real synced menu-item catalog.
  3. A recipe-coverage report shows which active menu items lack an effective recipe; when a sold line has no effective recipe at `closedAt`, depletion still processes the covered lines and publishes `DEPLETION_INCOMPLETE` (no silent no-op).
  4. A live POS order (create → add → fire → pay → serve → `ORDER_CLOSED`) depletes stock FEFO, writes a `DEPLETION` movement, and emits `STOCK_DEPLETED` with correct aggregate-MAC `totalCogsPaisa`.

**Scope note**: Finance consuming `STOCK_DEPLETED` to post the COGS journal entry is **out of scope** here — that lands in Phase 9 (Order-to-Ledger Auto-Posting). This phase publishes the event; Phase 9 subscribes. Depletion trigger stays `ORDER_CLOSED` (Paid AND Served); kitchen-service stays out of the inventory loop.

**Plans:** 7/7 plans complete

Plans:

- [x] 08.1-01-PLAN.md (wave 1) — pos-service: menu-item create/update/activate/deactivate/delete + MENU_ITEM_UPSERTED/MENU_ITEM_DELETED publish + republish backfill endpoint (D-02, D-05, INV-09)
- [x] 08.1-02-PLAN.md (wave 2) — inventory-service: menu_item_catalog read-model + MenuItemCatalogConsumer (D-07, D-08) + GET /menu-items + RecipeService.createVersion catalog validation (404 MENU_ITEM_NOT_FOUND) (INV-09)
- [x] 08.1-03-PLAN.md (wave 3) — inventory-service: GET /recipes/coverage + DepletionService DEPLETION_INCOMPLETE signal (removes the silent all-empty no-op, D-03) (INV-11)
- [x] 08.1-04-PLAN.md (wave 4) — frontend: `/app/inventory` recipe-builder UI (menu-item picker, ingredient lines) + coverage dashboard, four-layer pattern (D-04, INV-10)
- [x] 08.1-05-PLAN.md (wave 5) — live end-to-end depletion proof: real order lifecycle -> catalog sync -> validated recipe -> real consumer -> FEFO + aggregate-MAC COGS (INV-12)
- [x] 08.1-06-PLAN.md (wave 1, gap-closure) — fix shared-lib TenantAwareMessageProcessor RLS-GUC checkout-ordering bug (consumer inserts to FORCE-RLS tables rejected 42501) + non-superuser regression IT + fleet blast-radius/sibling-loop verification (INV-09, INV-12)
- [x] 08.1-07-PLAN.md (wave 2, gap-closure) — live dev-stack re-verification: redeploy fixed inventory-service, re-emit MENU_ITEM_UPSERTED, confirm menu_item_catalog populates (10 items) + recipe-builder UI click-through (INV-09, INV-10)

### Phase 08.2: Inventory Master Data & Procurement Catalog (INSERTED)

**Goal**: The inventory and procurement modules become operable by a restaurant manager without SQL — ingredients and their categories are first-class, editable master data; recipes can be viewed and revised with live plate cost; vendors carry a real item catalog with effective-dated pricing; and a purchase order line is chosen from that catalog instead of a hand-typed UUID. Phases 8/08.1/10 delivered the backend spine and proved the depletion loop; this phase closes the master-data and UI gap that leaves 11 backend endpoints with no consumer.
**Depends on**: Phase 8, Phase 08.1, Phase 10
**Requirements**: INV-01 (re-open — UI), INV-13, INV-14, INV-15, PUR-07, PUR-08
**Success Criteria** (what must be TRUE):

  1. A manager creates, edits, re-parents and archives ingredient categories in a tree capped at 3 levels, and every ingredient carries exactly one required primary category; archiving a category in use is refused rather than cascading.
  2. A manager creates, searches, edits and archives ingredients entirely through `/app/inventory/ingredients` — including purchase/stock/recipe UOM with conversions, par level, reorder point, storage location and allergens — with no hard delete once stock movements exist.
  3. An existing recipe's ingredient lines are viewable, and a revision can be authored pre-filled from the current version (never a destructive edit), with a live plate-cost panel showing batch cost, cost per portion, food-cost % and each line's share of plate cost.
  4. The coverage report distinguishes "no recipe" from "recipe scheduled from `<date>`", so a future-dated recipe is visibly pending instead of silently uncounted.
  5. A vendor is linked to the ingredients it supplies through a vendor item catalog (vendor SKU, pack size, purchase UOM, MOQ, lead time) with append-only effective-dated pricing, plus category tags used only to filter and suggest — never to authorize a purchase.
  6. A purchase-order line is selected with a search-as-you-type picker showing pack size, vendor SKU and contract price, filtered to the vendor's catalog/categories; the hand-typed ingredient UUID field is gone.
  7. Spend-by-category analytics is computed from real ingredient categories — `MockIngredientCategoryResolver` and its static `spend-category-map.yml` are deleted, not bypassed.
  8. Stock receipts, transfers, counts and opening balances are all driveable from the UI, and on-hand stock per branch is readable through a real endpoint (`ingredient_branch_stock` has no controller today).

**Scope note**: Additive Flyway migrations only — `ingredients` evolves in place so existing stock lots, inventory movements and MAC history stay intact. The `ORDER_CLOSED` depletion loop proven in 08.1 must remain green throughout. Nested prep/sub-recipes are modelled (`item_type`, `produced_by_recipe_id`) but full prep-recipe authoring may defer.

**Plans:** 20/20 plans complete

Plans:

- [x] 08.2-01-PLAN.md
- [x] 08.2-02-PLAN.md
- [x] 08.2-03-PLAN.md
- [x] 08.2-04-PLAN.md
- [x] 08.2-05-PLAN.md
- [x] 08.2-06-PLAN.md
- [x] 08.2-07-PLAN.md
- [x] 08.2-08-PLAN.md
- [x] 08.2-09-PLAN.md
- [x] 08.2-10-PLAN.md
- [x] 08.2-11-PLAN.md
- [x] 08.2-12-PLAN.md
- [x] 08.2-13-PLAN.md
- [x] 08.2-14-PLAN.md
- [x] 08.2-15-PLAN.md
- [x] 08.2-16-PLAN.md
- [x] 08.2-17-PLAN.md
- [x] 08.2-18-PLAN.md
- [x] 08.2-19-PLAN.md
- [x] 08.2-20-PLAN.md

**Wave 1** *(no dependencies — migrations, read seams and shared foundations run in parallel)*

- [x] 08.2-01: Flyway V5 — `item_categories` self-referencing tree hard-capped at 3 levels by DB trigger + required `ingredients.category_id` backfilled from legacy free-text column (INV-13)
- [x] 08.2-02: First read path for `ingredient_branch_stock` — on-hand stock per branch (INV-15)
- [x] 08.2-03: Recipe coverage distinguishes "no recipe" from "recipe scheduled from `<date>`" — closes the origin bug (INV-15)
- [x] 08.2-04: Purchasing Flyway V5 — `vendor_items` + append-only effective-dated `vendor_item_price` (PUR-07, PUR-08)
- [x] 08.2-05: Shared frontend foundation — new primitives, `calendarDateToInstant` extraction + local-midnight regression test, query keys (INV-13, INV-14, INV-15, PUR-07, PUR-08)
- [x] 08.2-20: Carried-over infra defects — gateway `resilience4j` circuitbreaker instances for inventory/purchasing/pos/kitchen + `start-dev.sh`/`local-service-env.sh` parity (INV-15, PUR-08)

**Wave 2** *(blocked on Wave 1 — APIs over the new schema)*

- [x] 08.2-06: Category tree API — CRUD, re-parent with cycle + depth validation, archive-with-refusal (INV-13)
- [x] 08.2-07: Non-persisting recipe cost-preview endpoint for the live plate-cost panel (INV-15)
- [x] 08.2-08: `VendorItem` service + controller with append-only pricing (PUR-07)

**Wave 3** *(blocked on Wave 2)*

- [x] 08.2-09: Ingredient master data — additive V6 columns, per-item UOM conversions, three distinct yield numbers incl. `recipes.net_yield_pct` (INV-01, INV-14, PUR-08)
- [x] 08.2-10: Purchase-order line accepts `vendorItemId` and derives ingredient / unit / price server-side (PUR-08)

**Wave 4** *(blocked on Wave 3 — analytics cutover + frontend data layers)*

- [x] 08.2-11: Delete `MockIngredientCategoryResolver` + `spend-category-map.yml`; spend-by-category computed from real categories (PUR-08)
- [x] 08.2-12: Inventory frontend data layer — Zod schemas, adapters, repositories, TanStack hooks (INV-01, INV-13, INV-14, INV-15)
- [x] 08.2-13: Purchasing frontend data layer — vendor catalog + catalog-driven PO line (PUR-07, PUR-08)

**Wave 5** *(blocked on Wave 4 — user-facing screens)*

- [x] 08.2-14: Ingredient-category management screen — recursive 3-level tree, create/edit, reparent, archive (INV-13)
- [x] 08.2-15: Ingredient master-data screen — searchable/filterable grid + grouped create-or-edit dialog (INV-01, INV-14)
- [x] 08.2-16: Recipe detail + revision-authoring page with live plate-cost panel (INV-15)
- [x] 08.2-17: Stock screen — on-hand read view + receipts, transfers, counts, opening balances (INV-15)
- [x] 08.2-18: Vendor detail — catalog section, price-change history, filter-only category tags (PUR-07)
- [x] 08.2-19: Catalog picker replaces the hand-typed ingredient UUID on the PO line (PUR-08)

### Phase 9: Order-to-Ledger Auto-Posting & Customer Loyalty

**Goal**: Close the core-value loop — when an order closes, a balanced revenue + COGS journal entry is auto-posted idempotently, and customer loyalty reacts to the same event.
**Depends on**: Phase 6, Phase 7, Phase 8
**Requirements**: FIN-03, CRM-01, CRM-02, CRM-03, CRM-04, CRM-05
**Success Criteria** (what must be TRUE):

  1. On `ORDER_CLOSED` the finance consumer auto-posts a balanced revenue + COGS journal entry, and refund/wastage/stock-count/transfer events each post their own balanced entries.
  2. Re-delivering the same source event produces no duplicate journal entry (idempotent via `posted_source_events`).
  3. Customers can be created and managed and are linked to orders via `customer_id`.
  4. Loyalty points accrue on `ORDER_CLOSED` and are debited back on refund.
  5. Loyalty tiers (Bronze/Silver/Gold) upgrade on configurable thresholds; a time-limited, item/tier-specific promotion applies at POS; and post-order customer feedback is captured and reportable.

**Plans**: 2/2 plans complete

**Integration status (2026-08-02):** Phase 9 was authored on a branch that contained neither
pos-service nor inventory-service — its own verification report says so — so its consumers were
written against an assumed contract. Four seams (count variance, transfer ship/receive, wastage,
stock receipt) consumed, acked and posted nothing until the 2026-08-02 integration repair moved the
payload records into `shared-lib`. See the Phase 7–10 integration audit.

Plans:

- [x] 09-01: Auto-posting engine — order close (revenue+COGS), refund, wastage, stock count, transfer; idempotent
- [x] 09-02: CRM — customers linked by `customer_id`, loyalty accrual/debit on close/refund, loyalty tiers, promotion engine, feedback collection

### Phase 10: Purchasing & Accounts Payable

**Goal**: Procurement runs end-to-end with financial integrity — vendors, approval-gated POs, GRN that posts GR/IR, 3-way matched vendor invoices feeding AP, and OPA-limited expense approvals.
**Depends on**: Phase 6, Phase 8
**Requirements**: PUR-01, PUR-02, PUR-03, PUR-04, PUR-05, PUR-06, FIN-05
**Success Criteria** (what must be TRUE):

  1. Managers manage vendors with the bank account stored field-encrypted.
  2. A PO moves DRAFT→PENDING_APPROVAL→APPROVED→SENT→…→CLOSED with tiered approval enforced by OPA.
  3. A GRN receipt posts GR/IR, and a vendor-invoice 3-way match creates AP; payment posts and publishes `AP_PAYMENT_PROCESSED`.
  4. AP balances are tracked (aging report + OPA-limited expense approval), AND AR balances are tracked:
   a corporate/house customer account can be charged, its balance and AR aging are queryable, every charge
   and settlement posts a balanced journal entry against account 1200, and the internal seam
   POST /internal/finance/ar/charges that Phase 7's POS "charge to account" tender will call is implemented
   and integration-tested. (Scope decided 2026-07-13, 10-17-A — see FIN-05.)

  5. A vendor performance scorecard reports lead-time adherence, fill rate, and price variance per vendor, and spend analytics aggregate spend by vendor and category with period comparison.

**Plans**: 26 plans (10-01..10-06 shipped; 10-07..10-18 = gap closure round 1; 10-19..10-26 = gap closure round 2 after the 2026-07-14 real-browser UAT)
**Status**: REOPENED 2026-07-14 (round 2) — real-browser UAT scored ~3 pass / 10 journeys. All 12 round-1 gap-closure plans were green (unit + real-Postgres ITs + real-OPA container ITs) and the module still did not work: no PO could be approved by anyone (internal authorize call path 401s), expense create failed 100%, PO/invoice detail pages hung on Loading forever, and a cashier saw the whole Purchasing module. Backend ITs verified the callee; nothing verified the caller, the browser, or the persona. See 10-UAT-2.md.
**Scope decisions**: 2026-07-13 (10-17-A) — FIN-05's AR clause is IN scope, not descoped. Receivables
are sourced from corporate/house accounts. Phase 10 owns the AR ledger + the internal charge seam;
Phase 7 owns the POS "charge to account" tender that calls it, because POS does not exist yet (Phase 7
is 0/4 plans) and an AR ledger with no writer would be an always-empty sub-ledger.

Plans:

- [x] 10-01: Vendors (encrypted bank account) + PO lifecycle with tiered OPA approval + mock GRN foundation
- [x] 10-02: Mock GRN → GR/IR, vendor-invoice 3-way match → AP/payment, AP aging (FIN-05 partial), MSW frontend
- [x] 10-03: PUR-06 spend analytics (vendor/category + period comparison) + PUR-05 price-variance metric [wave 3]
- [x] 10-04: PUR-02 gap closure — PO CLOSED transition (close + OPA-gated short-close, PO_CLOSED event) [wave 3]
- [x] 10-05: FIN-05 gap closure — Expense entity + OPA-limited expense approval in finance-service [wave 3]
- [x] 10-06: Requirement-doc reconciliation — re-derive PUR-01..06 + FIN-05 status from actual coverage [wave 4]

Gap-closure plans (2026-07-13):

- [ ] 10-07-PLAN.md — Canonical OPA action vocabulary + vendor.rego approval-limit & close_po rules + distinct-approver [wave 1]
- [ ] 10-08-PLAN.md — Real-OPA container ITs for PO approve/close + expense approve (replace the mocked AuthorizationClient) [wave 2]
- [ ] 10-09-PLAN.md — @PreAuthorize on all 18 purchasing endpoints + seed missing permissions + Cashier-403 IT [wave 1]
- [ ] 10-10-PLAN.md — Missing backend list endpoints: POs, vendor invoices, expenses [wave 2]
- [ ] 10-11-PLAN.md — Nav fix FEATURE_PURCHASING -> FEATURE_VENDOR + canonical flag set + drift test + purchasing shell [wave 1]
- [ ] 10-12-PLAN.md — PO UI journeys (list/create/submit/approve/reject/send) + per-line partial receipt [wave 3]
- [ ] 10-13-PLAN.md — Invoice UI journeys (list/book/override-match) + AP payment UI [wave 4]
- [ ] 10-14-PLAN.md — FIN-05 UI: expense create/approve/reject + AP aging page [wave 3]
- [ ] 10-15-PLAN.md — Analytics period picker + vendor selector [wave 1]
- [ ] 10-16-PLAN.md — Vendor bank-account encryption fails fast instead of silently nulling [wave 1]
- [ ] 10-17-PLAN.md — FIN-05 AR scope decision record: AR IS in scope (corporate/house accounts), split Phase 10 / Phase 7 [wave 1]
- [ ] 10-18-PLAN.md — AR sub-ledger: house/corporate customer accounts, charges + settlements, AR balances + AR aging, and the internal POS charge seam [wave 5]

Gap-closure plans, round 2 (2026-07-14) — every plan ends in a real-browser journey assertion as a real seeded persona:

- [ ] 10-19-PLAN.md — Dev-stack reproducibility: RabbitMQ zero-users root cause (load_definitions suppresses DEFAULT_USER bootstrap), repair `make dev-up`, health-gated one-command bring-up [wave 1]
- [ ] 10-20-PLAN.md — Bug 4: Next-15 async `params` on PO + invoice detail pages, fixed as a codebase-wide class with a build-failing guard [wave 2]
- [ ] 10-21-PLAN.md — Bug 3: frontend RBAC parity — PermissionGuard + nav `permission: vendor.view` + guard test (cashier no longer sees Purchasing) [wave 2]
- [ ] 10-22-PLAN.md — Bug 2: isolate + fix expense-create account validation (suspected cross-tenant read leak / COA never provisioned for the demo tenant) [wave 2]
- [ ] 10-23-PLAN.md — Bug 5: vendor create idempotency via the existing shared-lib IdempotencyService seam [wave 2]
- [ ] 10-24-PLAN.md — AR persona gap: seed an AR-capable persona so 10-18's write path can be driven; TOTP enrolment lockout formally deferred to Phase 2 [wave 2]
- [ ] 10-25-PLAN.md — Bug 1 (CRITICAL): InternalServiceFilter never authenticates → every PO approval 401s (masked as 503); + call-path ITs that test the CALLER [wave 3]
- [ ] 10-26-PLAN.md — Playwright E2E journey suite: all 10 UAT journeys as real personas against the real stack, enforced in CI [wave 4]

### Phase 11: HR & Payroll

**Goal**: Run compliant Pakistan payroll — employees with encrypted PII, config-driven income-tax/EOBI computation, and approved payroll that posts a balanced journal entry.
**Depends on**: Phase 6
**Requirements**: HR-01, HR-02, HR-03, HR-04, HR-05, HR-06, HR-07, HR-08
**Success Criteria** (what must be TRUE):

  1. Employees are managed with `cnic` and `bank_account_no` stored field-encrypted.
  2. A payroll run computes Pakistan income-tax slabs + EOBI from the config-driven annual `tax_config`.
  3. Payroll approval/payment posts a balanced JE and publishes `PAYROLL_RUN_PAID`, which Finance consumes.
  4. Managers schedule role-based shifts on a drag-and-drop calendar per branch; staff clock in/out and request leave through an approval workflow, and late-arrival deductions feed the payroll run.
  5. Labour cost as a % of revenue is reported by shift and by branch.
  6. A registered biometric device — a network terminal pushing ADMS/iClock over HTTPS or a USB reader via the local bridge agent — ingests a punch through the device-authenticated path (no user JWT; tenant/branch resolved from `attendance_devices`); the punch is idempotent on replay, survives device offline buffering, stores device + server timestamps, quarantines unmapped users, persists to `attendance_punches`, publishes `ATTENDANCE_PUNCHED`, and feeds attendance/payroll. Matching is at the edge; no raw biometrics are stored centrally.

**Plans**: 12 plans (5 waves)

Plans:

- [x] 11-01-PLAN.md — hr-service scaffold: module + FORCE-RLS hr_db schema + shared-infra tables + Testcontainers IT base (wave 1)
- [x] 11-02-PLAN.md — Infra registration: gateway hr-route/circuit-breaker + dev/restart PowerShell scripts (wave 1)
- [x] 11-03-PLAN.md — auth-service HR permission seed (9 `hr.*` perms + role grants) (wave 1)
- [x] 11-04-PLAN.md — Employees with field-encrypted `cnic`/`bank_account_no` + `EMPLOYEE_JOINED/LEFT` + OPA `hr.rego` (HR-01) (wave 2)
- [x] 11-05-PLAN.md — [TDD] `tax_config` + `SlabTaxCalculator` + `EobiCalculator` + FY2025-26 seed (HR-02 math) (wave 2)
- [x] 11-10-PLAN.md — Device registry + gateway JWT-exempt device-auth path class + `DeviceAuthResolver` (HR-07) (wave 2)
- [x] 11-06-PLAN.md — Payroll run lifecycle + compute + Idempotency-Key + TOTP approval + `PAYROLL_RUN_APPROVED/PAID` (HR-02/03) (wave 3)
- [x] 11-07-PLAN.md — Shift scheduling backend + time & attendance (clock-in/out) + leave workflow (HR-04 backend/HR-05) (wave 3)
- [x] 11-08-PLAN.md — finance-service payroll auto-post recipe + consumers + payroll-paid queue (HR-03) (wave 4)
- [x] 11-09-PLAN.md — Late-arrival deduction feed + labour-cost % by shift/branch (HR-05/HR-06) (wave 4)
- [x] 11-11-PLAN.md — ADMS/iClock adapter (Mode A) + USB bridge ingest (Mode B) + idempotent punches + quarantine + `ATTENDANCE_PUNCHED` (HR-07/08) (wave 4)
- [x] 11-12-PLAN.md — HR frontend: employee/payroll/attendance pages + drag-drop shift calendar via four-layer API (HR-04 UI) (wave 5)

### Phase 12: Reporting, Dashboards & NLQ

**Goal**: Turn the system's events into insight safely — ClickHouse-backed reports (including FBR), a realtime dashboard, and a natural-language query path that is read-only and tenant/branch-safe by construction.
**Depends on**: Phase 7, Phase 8, Phase 9
**Requirements**: RPT-01, RPT-02, NLQ-01, NLQ-02
**Success Criteria** (what must be TRUE):

  1. Events ETL into ClickHouse analytics facts and named reports — including the FBR Tax Summary — return within their P95 latency targets, using the business-day boundary formula.
  2. The dashboard WebSocket pushes updates within 5 seconds of `ORDER_CLOSED`/`TILL_CLOSED`.
  3. An NLQ request converts NL→SQL via Claude and passes 7-stage AST validation (shape, parse, table allowlist, PII deny-list, tenant filter, branch filter, limit inject); a query missing the tenant or branch filter is rejected.
  4. NLQ enforces read-only execution, 5s timeout, row cap, per-tenant monthly + per-user hourly quotas, a 60s result cache, and stamps impersonation in `nlq_query_log`.

**Plans**: 11 plans + 5 gap-closure plans (12-12..12-16, closing the real live-only gaps 12-10 found + the browser WS-target gap from 12-UAT)

Note: `nlq-service` is **Java / Spring Boot** (user decision), not Python — it reuses the proven shared-lib + Eureka + Config Server + internal-JWT wiring, and uses JSqlParser (not sqlglot) for the 7-stage AST validation.

Plans:

- [x] 12-01: Platform seams — reporting-service + nlq-service scaffolds, gateway routes, FEATURE_NLQ flag fix, deploy/env
- [x] 12-02: ClickHouse analytics schema + locked-down nlq_readonly user (verified against the live 25.9 container)
- [x] 12-03: ETL — ORDER_CLOSED / TILL_CLOSED / VENDOR_INVOICE_MATCHED into ClickHouse facts, business-day boundary, idempotent
- [x] 12-04: NLQ 7-stage SQL AST validation pipeline (TDD, JSqlParser, adversarial suite)
- [x] 12-05: Named reports + FBR Tax Summary (output tax − input tax = net payable)
- [x] 12-06: Realtime dashboard WebSocket (<5s of close events) with per-tile throttle
- [x] 12-07: NLQ execution — Claude NL→SQL, read-only executor, quotas, 60s cache, impersonation-stamped audit log
- [x] 12-08: Frontend — reports, FBR page, realtime dashboard
- [x] 12-09: Frontend — NLQ ask page with honest rejection UX
- [x] 12-10: Real-stack end-to-end proof + requirements reconciliation
- [x] 12-11: auth-service permission seeding (reporting.* + nlq.query.run) wired into db.changelog-master.xml

Gap-closure plans (from 12-10 real-stack E2E findings — run with `/gsd-execute-phase 12 --gaps-only`):

- [ ] 12-12: GAP A — gateway JwtGlobalFilter WS-upgrade query-param JWT fallback (unblocks dashboard WS + KDS through the real gateway; RPT-02 blocker)
- [ ] 12-13: GAP B — user-service getBranch derives tenant GUC from the forwarded JWT (FBR ntn/fbrStrn non-null live)
- [ ] 12-14: GAP C — auth-service impersonation issuance sets tenant GUC before findById (platform-admin threads tenantId); real endpoint returns a token + stamp lands live
- [ ] 12-15: GAP D — correct stale Anthropic model IDs in deploy/.env; runnable real-key round-trip recipe (live proof honestly deferred)
- [ ] 12-16: UAT Test 3+4 — route the 3 browser WS hooks through NEXT_PUBLIC_WS_BASE_URL (gateway :8080) instead of unset NEXT_PUBLIC_*_WS_URL (localhost:3000); static guard + real-browser push proof

### Phase 13: Platform & Tenant Access Repair

**Goal**: Every advertised access path is actually reachable at runtime — a SuperAdmin can authenticate and manage tenants, a tenant provisioned through the real saga can log in, a tenant admin can create and manage users, and every user can manage their own password.
**Depends on**: Phases 2, 3
**Source**: `AUDIT-REPORT-2026-08-06.md` §0 (B1–B3), §2.1–2.3
**Success Criteria** (what must be TRUE):

  1. A SuperAdmin authenticates against `platform_users` and receives a token that satisfies the `/api/v1/platform/**` authorization checks through the real gateway, including with no `tenant_id` claim.
  2. A tenant provisioned via `POST /api/v1/platform/tenants` can immediately log in as its admin — `auth_tenants` row created, `user_branch_roles` OWNER assignment written, HQ branch flagged `is_hq=true`, real branch id parsed (not a random UUID), and the temp password delivered to the caller.
  3. A tenant admin creates, lists, edits, and deactivates users through a public API, assigns per-branch roles from a role catalog endpoint, and an unknown `roleCode` is rejected with 400.
  4. A logged-in user changes their own password; an admin resets another user's password; `must_change_password` forces a change at next login; reset clears the login lockout; the raw reset token no longer appears in the `outbox` payload.
  5. A `WAITER` role exists with order-taking but not till permissions, and `TENANT_ADMIN` can administer users and branches (multiple admins per tenant work).
  6. One idempotent seed script produces: SuperAdmin `superadmin@softxlogic.com`, 3 tenants with differing enabled modules, and per-tenant users covering Admin/Manager/Cashier/Waiter/Kitchen/Accountant — and every seeded persona's login is verified by the script itself.

**Requirements**: AUTH-01, AUTH-02, AUTH-06, PLATFORM-01, PLATFORM-02, PLATFORM-03, PLATFORM-04, PLATFORM-05, PLATFORM-06, PLATFORM-07, PLATFORM-10, USER-01, USER-02, USER-03, GW-02, GW-03
**Decisions**: see `.planning/phases/13-platform-tenant-access-repair/13-DECISION-MAP.md` (D-01..D-35)

**Plans**: 16/16 plans complete

Plans:

- [x] 13-01-PLAN.md (wave 1) — JWT authorities from roles, tenant-less platform token minting, gateway platform-prefix exemption + live-HTTP harness (SC1, B1)
- [x] 13-02-PLAN.md (wave 1) — WAITER role, TENANT_ADMIN authority split, one-active-role-per-branch DB invariant, hardcoded HQ UUID removed (SC5)
- [x] 13-03-PLAN.md (wave 1) — feature-code closure test + FEATURE_PAYROLL backfill, fail-closed tenant status (regression guards)
- [x] 13-04-PLAN.md (wave 1) — shared password-strength constraint, extracted password policy, self-service change-password (SC4)
- [x] 13-05-PLAN.md (wave 2) — platform login endpoint reading `platform_users`, SuperAdmin credential rotation (SC1, B1 closed)
- [x] 13-06-PLAN.md (wave 2) — auth-service provisioning seam: `auth_tenants` upsert, OWNER branch-role on provision-admin, roleCode validation (SC2)
- [x] 13-07-PLAN.md (wave 2) — role catalog + permission catalog endpoints, gateway reachability (SC3)
- [x] 13-08-PLAN.md (wave 2) — `must_change_password` enforced at login, single-use hashed change tokens, public forced-change endpoint (SC4)
- [x] 13-09-PLAN.md (wave 2) — reset hardening: outbox token redaction, lockout clear, per-account cooldown, single live token, honest delivery mode (SC4)
- [x] 13-10-PLAN.md (wave 3) — provisioning saga repair: real branch id, isHq, COA key, auth tenant + OWNER, temp password surfaced, real compensation (SC2, B2 closed)
- [x] 13-11-PLAN.md (wave 3) — auth-service user lifecycle API + per-tenant email uniqueness (SC3)
- [x] 13-12-PLAN.md (wave 4) — public `/api/v1/users` tenant-admin surface with role ceiling and tenant isolation (SC3, B3 closed)
- [x] 13-14-PLAN.md (wave 4) — subscription/tier management, provisioning retry, impersonation actor fix, per-tenant NLQ quota
- [x] 13-13-PLAN.md (wave 5) — admin-initiated password reset at both tiers with correct audit actor (SC4)
- [x] 13-16-PLAN.md (wave 5) — POS till binds at cash settlement, not at order creation; unblocks 13-02's WAITER role (SC5, D-30) — **must land before 13-15**
- [x] 13-15-PLAN.md (wave 6) — authoritative self-verifying seed script + phase acceptance runner + E2E evidence (SC6)

### Phase 14: Frontend Trust & Admin Surfaces

**Goal**: The UI never lies about state, never silently loses data, and exposes the admin surfaces Phase 13 made reachable.
**Depends on**: Phase 13
**Source**: `AUDIT-REPORT-2026-08-06.md` §2.6 (C1–C4), §2.2, §2.3
**Success Criteria**:

  1. A failed query can no longer render as an empty state anywhere — enforced by a shared async boundary primitive plus a lint rule, verified on the POS till, KDS board, AP/AR aging, and order-suggestion surfaces.
  2. `error.tsx`, `loading.tsx`, `not-found.tsx` and a React error boundary exist; a render-time throw no longer white-screens the app.
  3. POS fire-to-kitchen failure surfaces an error and does not clear the cart.
  4. Tenant-admin pages exist for users, per-branch roles, and branches; SuperAdmin pages exist for tenant list/detail/create, lifecycle, and module toggles.
  5. Password UI exists: forgot, reset, forced-change, and change-password-in-settings.
  6. Dead links (`/app/settings`, `/settings/profile`) are removed or built, and mobile nav + ⌘K honour the same gating as the sidebar.

**Plans**: TBD

### Phase 15: UI/UX Revamp — ERP Design System

**Goal**: A clean, professional, consistent ERP interface built on real design tokens and shared primitives, with per-role dashboards.
**Depends on**: Phase 14
**Source**: `AUDIT-REPORT-2026-08-06.md` §2.6 "Design-system debt" + "What a revamp must standardize first"
**Success Criteria**:

  1. Token scales exist for spacing, typography, elevation and z-index (not just colour and radius), and a KDS token set replaces the raw greys.
  2. `PageHeader`, `PageShell`/`Section`, and `ModuleTabs` primitives exist and are adopted by every page — one `<h1>` scale, one page-padding owner, `aria-current` on tabs.
  3. A `Select` primitive replaces all 45 native `<select>`; `DataTable` replaces the hand-rolled tables with accessible, keyboard-operable sort and real pagination; one `StatusBadge` and one `StatCard` replace the 7 and 4 variants.
  4. Dark mode is complete — no raw palette literals without variants — and tenant branding reaches more than `--primary`, with per-tenant brand names.
  5. Each role has a dashboard showing only its permitted modules, and post-login routing sends each role to the right landing page.
  6. Responsive + a11y baseline: every page usable at mobile width; tables carry `scope="col"`; POS touch targets ≥44px.

**Plans**: TBD

### Phase 28: Stations, POS Profiles & Staff Assignment

*(Planned 2026-08-11 as `28-station-pos-profiles`. Previously numbered Phase 16.)*

**Goal**: A tenant admin can create a station, create a dedicated POS terminal that offers its own slice of the menu, and assign a staff member to a station — entirely in the UI — and an order spanning food and drink reaches the kitchen and the bar as two separate tickets.
**Depends on**: Phase 13 (WAITER role, till rule), Phase 19b (table + station CRUD)
**Source**: `AUDIT-REPORT-2026-08-06.md` §2.4, `.planning/research/adaptivity/multi-pos-stations.md`, `28-CONTEXT.md` (D-28-01…06)
**Success Criteria**:

  1. `pos_terminals` exists (tenant+branch scoped, coded, named, activatable) with admin CRUD and UI; an order records `terminal_id` and a `source` channel.
  2. `stations.station_type` distinguishes the destination kinds and is projected into kitchen-service; boards request only their own type.
  3. `menu_item_station_routes` allows a tenant-scoped menu item to route to a different station per branch, with category-level fallback; a station admin UI and a menu-item→station picker exist.
  4. **DEFERRED — recommended as its own phase.** Till sessions binding to a terminal requires the `uq_open_till_per_cashier` index swap, which is a breaking change on the money path. Phase 28 records order attribution only and leaves the 13-16 cash-till rule untouched (D-28-06).
  5. The KDS WebSocket validates the tenant and branch claims (parity with the POS socket).
  6. Configurable end to end: a combined food+drink POS and a split POS/bar-counter setup can each be configured through the UI, and orders reach the right display in both cases.

**Plans**: 14 plans across 5 waves

Plans:

- [x] 28-01-PLAN.md (wave 1) — user→station assignment in auth_db, carried in the JWT `attributes` map; `pos.terminals.admin` permission (D-28-02)
- [x] 28-02-PLAN.md (wave 1) — `stations.station_type` end to end: pos entity, event payload parity, kitchen projection (D-28-01)
- [x] 28-03-PLAN.md (wave 1) — KDS WebSocket validates tenant and branch; closes a live cross-tenant read (SC5)
- [x] 28-04-PLAN.md (wave 2) — `pos_terminals` + menu-scope and station-set join tables, admin CRUD behind `pos.terminals.admin` (D-28-03)
- [x] 28-05-PLAN.md (wave 2) — per-branch `menu_item/category_station_routes` + `StationRoutingResolver`; closes the cross-branch overwrite (SC3)
- [x] 28-06-PLAN.md (wave 2) — station admin UI; the backend CRUD gets its first caller (D-28-05)
- [x] 28-07-PLAN.md (wave 2) — kitchen-service enforces the station scope on tickets, station list and socket; no assignment means everything (D-28-02)
- [ ] 28-08-PLAN.md (wave 3) — split-ticket proof on a real spanning order + `ORDER_READY` cross-station fix (D-28-04)
- [ ] 28-09-PLAN.md (wave 3) — terminal admin UI with the menu-scope picker (D-28-03)
- [ ] 28-10-PLAN.md (wave 3) — menu-item and category→station routing UI (D-28-04, D-28-05)
- [x] 28-11-PLAN.md (wave 3) — station assignment in the user create/edit form (D-28-02) — **the user's stated gap**
- [ ] 28-12-PLAN.md (wave 3) — `orders.terminal_id` + `source`, branch-validated; till rule untouched (D-28-06)
- [ ] 28-13-PLAN.md (wave 4) — POS terminal selection and menu-grid scoping (D-28-03)
- [ ] 28-14-PLAN.md (wave 5) — browser proof of the whole definition of done + live gateway script (D-28-05)

### Phase 17: ERP Reporting Completeness

**Goal**: Admins get comprehensive reports across every module, not just sales and tax.
**Depends on**: Phases 13, 15
**Source**: `AUDIT-REPORT-2026-08-06.md` §2.5
**Success Criteria**:

  1. `journal_facts` and inventory fact tables exist with consumers for the currently-unconsumed domain events (stock depletion/receipt/wastage/variance/transfer, journal posted, period closed, GRN, refund, void).
  2. P&L, Balance Sheet, and a labelled Trial Balance are available for a selected period.
  3. COGS and gross margin are real values, not NULL, on sales-by-item.
  4. Stock valuation (as-of date), low-stock/reorder, and wastage reports are admin-reachable.
  5. Daily cash-up / Z-report, payment-tender mix, sales-by-category, and purchase-spend-by-vendor exist.
  6. Every report exports to CSV and PDF, and the advertised "E to export" handler works.

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17

Phases 13–17 were inserted 2026-08-06 from a source-level production-readiness audit (`AUDIT-REPORT-2026-08-06.md`). Phase 13 is a hard blocker for all of them: it repairs three access paths that are fully coded but unreachable at runtime. Phase 16 may proceed in parallel with 14/15 once 13 lands. Phase 11 (HR & Payroll) is owned by another developer and is out of scope for this sequence.

With `parallelization: true`, after Phase 9 closes the core-value loop, Phases 10 and 11 may proceed in parallel (both depend only on already-completed phases); Phase 12 runs last as it consumes events from POS/Inventory/Finance.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Infrastructure Foundation & Shared Library | 0/4 | Not started | - |
| 2. Authentication & Authorization | 0/3 | Not started | - |
| 3. API Gateway, Platform Admin & Tenant/User Mgmt | 0/3 | Not started | - |
| 4. Frontend Shell & CI/CD | 3/3 | Complete | 2026-06-25 |
| 5. Cross-Cutting Services (Notifications, Audit, Files) | 0/3 | Not started | - |
| 6. Finance Core — General Ledger & Periods | 0/2 | Not started | - |
| 7. Point of Sale & Kitchen Display | 9/9 | Complete   | 2026-08-02 |
| 7.1. POS Production Operations & Item-Level Kitchen Tracking *(INSERTED)* | 10/10 | Complete    | 2026-07-11 |
| 8. Inventory & Recipe Management | 9/9 | Complete    | 2026-07-18 |
| 9. Order-to-Ledger Auto-Posting & Customer Loyalty | 2/2 | Complete (integration-repaired 2026-08-02) | 2026-08-02 |
| 10. Purchasing & Accounts Payable | 6/6 | **Reopened — UAT gaps** | - |
| 11. HR & Payroll | 12/12 executed | **Executed — runtime verification pending** (all ITs + `opa test` deferred to a Docker CI pass; 11-12 blocking UAT outstanding) | 2026-08-06 |
| 12. Reporting, Dashboards & NLQ | 11/11 (+5 gap plans 12-12..12-16 pending) | **Executed — 5 gap-closure plans queued (RPT-02 gateway WS, FBR RLS, impersonation RLS, NLQ model, browser WS-target)** | 2026-07-21 |
| 13. Platform & Tenant Access Repair *(INSERTED, BLOCKER)* | 16/16 | Complete   | 2026-08-07 |
| 14. Frontend Trust & Admin Surfaces *(INSERTED)* | 0/TBD | Not started | - |
| 15. UI/UX Revamp — ERP Design System *(INSERTED)* | 0/TBD | Not started | - |
| 16. Multi-POS Terminals & KDS/BDS Routing *(INSERTED)* | 0/TBD | Not started | - |
| 17. ERP Reporting Completeness *(INSERTED)* | 0/TBD | Not started | - |
