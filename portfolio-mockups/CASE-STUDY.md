# RestaurantOS — portfolio case study

Copy for a portfolio project page. Every figure below is drawn from the repository,
not estimated.

---

## Tagline

**An AI-native, multi-tenant ERP that runs a restaurant group end to end — from the
till to the general ledger.**

---

## Card blurb (~35 words)

A white-label SaaS ERP for restaurant chains. Point of sale, kitchen display,
inventory, procurement and double-entry finance run as one event-driven loop, with
an AI layer that forecasts demand and explains where margin is leaking.

---

## Short description (~120 words)

RestaurantOS is a production-grade, multi-tenant SaaS ERP for restaurant groups,
built as a Java 25 / Spring Boot 4 microservice platform behind a Next.js 16 front end.

Its central idea is that a restaurant's operational and financial records should be
the same records. Closing an order on the POS publishes one event; inventory depletes
the recipe bill of materials in FEFO order, finance posts a balanced double-entry
journal entry, and loyalty accrues — each step idempotent, tenant-isolated, and
auditable. No nightly reconciliation, no spreadsheet in the middle.

Because that operating data is clean and structured, an AI layer can sit on top of it
and do real work: forecast per-ingredient demand against vendor lead times, localise
yield variance to a shift and a station, reprice a dish against live plate cost, and
answer plain-English questions through a validated SQL pipeline.

---

## The problem

Restaurant groups run on a stack of disconnected tools: a POS that only counts sales,
inventory kept in spreadsheets, and an accountant reconstructing the month weeks after
it ended. The costly questions are therefore unanswerable in time to matter — *which
dish is quietly losing money now that chicken is up 14%*, *why does the kitchen use
more cheese than the recipes call for*, *what do I need to order before Thursday*.

They're unanswerable not because the maths is hard but because nothing connects the
sale to the recipe to the ledger. That connection was the design goal.

---

## What I built

Twelve Spring Boot services plus an API gateway, service registry, config server and a
shared library, coordinated over RabbitMQ and OpenFeign, targeting a 16-service design.

| Domain | What it does |
|---|---|
| **POS** | Orders, tables, split tenders, till sessions, offline-capable operation |
| **Kitchen Display** | Station-routed tickets with SLA tracking |
| **Inventory** | Stock, recipes/BOM, moving-average cost, FEFO depletion, transfers, counts |
| **Purchasing** | Vendors, POs with tiered approval, GRN, three-way match, scorecards |
| **Finance** | GL, immutable balanced journal entries, AP/AR, period close, auto-posting |
| **CRM** | Customers, loyalty tiers, promotions, feedback |
| **HR & Payroll** | Employees, Pakistan tax slabs, scheduling, biometric attendance |
| **Platform** | Tenant provisioning, feature flags, impersonation, telemetry |
| **Cross-cutting** | Auth (RS256 JWT + JWKS, 2FA), OPA authorization, audit, files, notifications |

---

## The engineering worth talking about

**Tenant isolation that survives the async boundary.** Isolation is enforced twice —
a Hibernate tenant filter and PostgreSQL row-level security — with `tenant_id` never
accepted from a client. The hard part wasn't the HTTP path; it was RabbitMQ consumers,
where the tenant context has to be re-established *before* any DML runs. A GUC-ordering
bug meant listener writes to FORCE-RLS tables were being rejected with SQLState 42501.
Fixing it in the shared message processor fixed it everywhere at once.

**Accounting correctness enforced by the database, not by discipline.** Money is
`BIGINT` paisa — never floating point. Journal entries balance under a deferred
constraint trigger, so an unbalanced entry physically cannot commit. Entries are
immutable; corrections are reversals. Posting is idempotent on `(tenant_id,
source_event_id)`, so a redelivered event is a no-op rather than a double-count.
Locked periods reject late postings with `423 PERIOD_LOCKED`.

**Event-driven consistency without distributed transactions.** A transactional outbox
guarantees an event is published if and only if its state change committed. Consumers
are idempotent, and a deliberately tolerant deserialiser lets producers add fields
without breaking subscribers — the alternative silently dropped payloads.

**Fail-closed authorization.** Every decision goes to Open Policy Agent as Rego policy
evaluated against tenant *and* branch, with a 2-second timeout that denies on failure.
Policies are covered by their own test suite at 100%.

**A validated NL→SQL path.** Generated SQL is never executed as written. It passes
seven stages — shape check, AST parse, table allowlist, PII deny-list, injected tenant
predicate, injected branch predicate, injected row cap — before running read-only under
a restricted role that Postgres RLS still applies to. The model writes the projection;
it never writes the predicates that scope it.

---

## Scale

| | |
|---|---|
| Java source files | 741 |
| Test classes (unit + Testcontainers integration) | 136 |
| Rego authorization policies | 14 (100% policy coverage gate) |
| Liquibase changelogs | 43 |
| TypeScript / TSX modules | 218 |
| Tracked requirements | 121 across 18 categories |
| Delivery phases | 15 |

Coverage gates in CI: finance and inventory ≥ 75%, other services ≥ 60%, OPA policies 100%.

---

## Technologies

**Backend** — Java 25 · Spring Boot 4.0.7 · Spring Cloud 2025.1.0 · Spring Cloud Gateway ·
Spring Security (RS256 JWT + JWKS) · Eureka · Spring Cloud Config · OpenFeign ·
Hibernate/JPA · MapStruct · Lombok · JJWT

**Data & messaging** — PostgreSQL 18 (row-level security) · Liquibase · RabbitMQ 4.3 ·
Redis 8.2 · ClickHouse 25.9 (analytics ETL) · MinIO (S3-compatible object storage)

**Authorization & policy** — Open Policy Agent 1.17 · Rego · ABAC + RBAC, fail-closed

**Frontend** — Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 (CSS-first, OKLCH
tokens) · Radix UI · TanStack Query + Table · Zustand · React Hook Form + Zod ·
next-intl · Framer Motion · IndexedDB + Workbox (offline POS)

**AI layer** — Claude for natural-language querying, behind a seven-stage SQL AST
validator; demand forecasting, yield-variance attribution and menu-margin optimisation
over the operational data model

**Testing & delivery** — JUnit · Testcontainers · Vitest · Testing Library · MSW ·
Playwright · Docker Compose · GitHub Actions with coverage gates

**Domain specifics** — Pakistan-first: PKR in paisa, FBR/SRB tax treatment,
July–June fiscal year, EOBI and income-tax slabs, CNIC and bank-account field encryption

---

## Status

The platform, event loop, multi-tenant isolation and double-entry accounting engine are
implemented and verified end to end — an order closed on the POS has been proven to
deplete stock by recipe in FEFO order and post a balanced journal entry. Inventory,
POS, kitchen, purchasing and finance modules are shipped; HR, CRM, reporting and the
natural-language query service are in progress.

The AI capabilities shown in the interface mockups are designed against this data model;
the forecasting, variance-attribution and NLQ services are roadmap rather than shipped.

---

## Suggested page structure

1. Hero — tagline + the AI Control Tower screenshot
2. Short description + tech chips
3. The problem (3 short paragraphs)
4. Screenshot gallery with the captions in `README.md`
5. "The engineering worth talking about" — the five subsections above
6. Scale table + full technology list
7. Honest status note
