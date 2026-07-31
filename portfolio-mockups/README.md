# RestaurantOS — portfolio gallery

Ten product screenshots of an AI-native, multi-tenant restaurant ERP.
Rendered at **3200×2000** (1600×1000 @2×) — drop `out/*.png` straight into a
portfolio gallery.

```
node capture.mjs        # render every screen
node capture.mjs 04     # render one
```

Sources are self-contained HTML in `src/` (no build step, no CDN). Playwright is
borrowed from `../frontend/node_modules`.

---

## Project blurb

> **RestaurantOS** — a white-label, multi-tenant SaaS ERP for restaurant groups.
> Twelve Java 25 / Spring Boot 4 services plus gateway, service registry and config
> server, behind a Next.js 16 front end, communicating over RabbitMQ with
> PostgreSQL row-level tenant isolation.
> Point of sale, kitchen display, inventory, procurement, and double-entry finance
> run as one event-driven loop — an order closing on the POS depletes stock by
> recipe and posts a balanced journal entry without anyone touching a spreadsheet.
> On top of that operating data sits an AI layer that forecasts demand, localises
> yield variance, reprices the menu against live plate cost, and answers plain-English
> questions through a seven-stage SQL validator.

**Stack** · Java 25 · Spring Boot 4.0.7 · Spring Cloud Gateway · PostgreSQL 18 (RLS) ·
RabbitMQ 4.3 · Redis 8.2 · ClickHouse 25.9 · OPA 1.17 / Rego · MinIO · Next.js 16 ·
React 19 · TypeScript · Tailwind 4 · Docker

Full write-up: [CASE-STUDY.md](CASE-STUDY.md)

---

## Captions

Each caption is written to stand alone under the image.

### 01 — AI Control Tower
> The operator's home screen. Every AI recommendation is ranked by verified rupee
> impact, carries a confidence meter, and links back to the rows that produced it —
> so a manager can act on it or argue with it. The panel on the right found
> Rs 1.24M of margin this month; 78% of it was accepted.

### 02 — Point of Sale
> A touch-first POS built for speed during a dinner rush: split tenders, per-line
> modifiers, and live stock state on the menu grid, so a cashier cannot sell an
> ingredient the kitchen has run out of. The AI upsell strip suggests pairings from
> measured attach rates rather than guesses.

### 03 — Kitchen Display System
> Station-routed tickets with per-item status and SLA-aware urgency colouring.
> The intelligence band predicts a bottleneck *before* it happens — reading queue
> depth against cooks on station — and proposes a re-route while there is still
> time to act on it.

### 04 — Demand Forecasting & Auto-Replenishment
> Order history, recipe bills of material, and vendor lead times combine into a
> per-ingredient demand forecast with an 80% prediction interval. When cover days
> fall below lead time, the system drafts the purchase order and shows its
> reasoning — the buyer approves rather than calculates.

### 05 — Yield Variance Intelligence
> Because every closed order depletes stock through its recipe, the system knows
> what usage *should* have been. Comparing that against physical counts localises
> the gap to a shift and a station, and separates over-portioning from spoilage
> and from theft — three problems with three different fixes.

### 06 — Menu Profit Engineering
> Live plate cost from moving-average ingredient cost, crossed with sales velocity,
> sorts the menu into Stars, Plowhorses, Puzzles and Dogs. The repricing simulator
> models the demand-elasticity cost of a price move before it reaches a printed menu.

### 07 — Ask Your Data
> Plain-English questions over the whole ERP. The interesting half is the right
> panel: generated SQL passes seven validation stages — AST parse, table allowlist,
> PII deny-list, injected tenant and branch predicates, row cap — before anything
> executes read-only. The model cannot reach another tenant's data even if it tries.

### 08 — Guest Intelligence
> Loyalty tiers, churn risk, and a next-best-offer per guest with a predicted
> redemption rate. Feedback is clustered into themes so "service was slow" becomes
> a countable trend with a representative quote attached.

### 09 — Finance: auto-posted double-entry
> The proof that this is an ERP and not a dashboard. A closed order emits one event;
> the ledger posts a balanced, immutable journal entry — revenue, GST payable, COGS,
> inventory — enforced by a database trigger, idempotent on the source event, and
> correctable only by reversal. Locked periods reject late postings outright.

### 10 — Vendor Intelligence
> Effective-dated contract pricing turns procurement into an analysable series:
> price creep gets detected, alternatives get compared on lead time and fill rate
> rather than headline price, and PO ↔ GRN ↔ invoice three-way match flags the
> variances a human should look at.

---

## Suggested gallery order

Lead with **01** (the hook), then **02** and **03** to establish that a real
operation runs on it, then the AI depth pieces **04 → 05 → 06**, then **07** for
engineering credibility on the AI side and **09** for it on the accounting side.
**08** and **10** round out module coverage.

If the gallery only takes four: **01, 04, 06, 09**.

---

## Note

These are design mockups for portfolio presentation. They depict the product's
intended surface; the underlying platform, event loop, and accounting engine are
implemented, while parts of the AI layer shown here are roadmap.
