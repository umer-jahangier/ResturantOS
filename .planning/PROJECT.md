# RestaurantOS

## What This Is

RestaurantOS is a production-grade, white-label, **multi-tenant SaaS ERP for the restaurant industry**, sold on a recurring subscription model. It is built as 16 Java 25 / Spring Boot 4 microservices plus a Python FastAPI NLQ service and a Next.js 16 frontend, communicating via RabbitMQ events and OpenFeign internal APIs. It serves three audiences: the **SuperAdmin** (platform operator — Praivox) who manages tenants/features/billing; the **Tenant Admin** (restaurant owner) who manages branches and staff; and **Branch Staff** (cashier, chef, manager, accountant, inventory/HR/CRM managers) who run daily operations.

## Core Value

A restaurant tenant can run real operations end-to-end — take an order at the POS, have it deplete inventory and auto-post a balanced double-entry journal entry, all correctly isolated to that tenant and branch — without any cross-tenant data leakage or accounting imbalance.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- [x] Inventory: stock, recipes/BOM, MAC (moving-average cost), `ORDER_CLOSED` depletion (FEFO, idempotent), receipts, inter-branch transfers, counts, low-stock/expiry alerts — *Validated in Phase 8 (2026-07-18): 9 plans, 5/5 success criteria, OPA 100%, INV-01..07*
- [x] POS→Inventory depletion loop activated & trustworthy: POS menu-item sync → inventory catalog + recipe `menu_item_id` validation, recipe-builder UI, recipe-coverage + `DEPLETION_INCOMPLETE` observability, and a live order→FEFO depletion→COGS proof; underlying shared-lib consumer-path FORCE-RLS GUC-ordering bug fixed so `@RabbitListener` inserts to FORCE-RLS tables persist (no SQLState 42501) — *Validated in Phase 08.1 (2026-07-19): 7 plans, 4/4 success criteria, live-verified, INV-09..12*

### Active

<!-- Current scope. Full requirement list with REQ-IDs lives in REQUIREMENTS.md. -->

- [ ] Multi-tenant isolation (Hibernate tenant filter + PostgreSQL RLS, `tenant_id` never client-supplied)
- [ ] All six business modules (POS, Inventory, Finance, Vendor, HR, CRM) — plus KDS — are core/mandatory: built for and shipped to every tenant; tier only seeds access defaults
- [ ] Platform Admin: tenant provisioning, feature flags, impersonation, telemetry, **SuperAdmin tier-independent per-tenant module enable/disable** (authoritative override; immediate cache invalidation; audited)
- [ ] Auth: login, RS256 JWT + JWKS, refresh sessions, 2FA, password reset, branch switch
- [ ] Authorization: OPA/ABAC (fail-closed) with tenant + branch checks, RBAC
- [ ] User/Branch management + internal endpoints
- [ ] POS: orders, tables, split-tender payments, till sessions, offline sync
- [ ] Kitchen Display System (station routing)
- [ ] Purchasing / Vendor & Supply Chain: vendors, POs, GRN, vendor-invoice 3-way match, performance scorecard, spend analytics
- [ ] Finance: GL, immutable balanced journal entries, AP/AR, period close, auto-posting recipes
- [ ] HR: employees, payroll (Pakistan tax slabs via config), shift scheduling, time & attendance (incl. biometric devices — LAN ADMS push + USB bridge agent, edge matching, no central raw biometrics), leave management, labour-cost % vs revenue
- [ ] CRM: customers, loyalty (Bronze/Silver/Gold tiers), promotion engine, feedback collection
- [ ] Reporting: ClickHouse ETL + named reports (FBR-compliant)
- [ ] NLQ: natural-language query with 7-stage SQL AST validation
- [ ] Notifications, Audit (7-year immutable), File storage (MinIO)
- [ ] Next.js frontend shell + four-layer API abstraction + per-module UIs
- [ ] CI/CD pipeline (lint, test w/ coverage gates, build, schema-sync)

### Out of Scope

<!-- Explicit boundaries. -->

- Mobile native apps — web-first (PWA/offline POS covers field use); native deferred.
- Designing new architecture/data models/contracts — already decided in the specs; this is implementation, not design.
- Multi-currency / non-Pakistan tax regimes in v1 — system is Pakistan-first (PKR paisa, FBR, EOBI/PESSI).
- Payment-gateway integrations beyond recording tenders — out of v1.

## Context

- **Source of truth (superior to any prompt):**
  - `Docs/RestaurantERP_SaaS_Specification.md` — full PRD + technical spec (architecture, 16 services, data models, security, deployment).
  - `Docs/RestaurantERP_UserStories_FlowDiagrams.md` — 51 user stories w/ acceptance criteria, 20 Mermaid flow diagrams, 10 business-logic rule sets, checklists.
  - `Docs/agent-specs/01..11` — agent-ready implementation docs we generated and verified: project scaffold, event schema registry, shared-lib spec, internal API contracts, env vars, dev docker-compose, coding standards, DB migration guide (Liquibase), security implementation guide, test architecture, seed data.
- A Pre-Sprint Readiness review was completed; critical fixes (async tenant propagation, JE balance trigger timing, cross-service DB access via Feign, OPA branch isolation, transactional outbox, shared infra-table migrations) are already baked into `Docs/agent-specs/`.
- Decision protocol when uncertain: re-read spec → check acceptance criteria → choose conservative/secure option → verify financial arithmetic → otherwise stop and ask. Never invent field names, endpoints, env vars, or skip security checks.

## Constraints

- **Tech stack**: Java 25 LTS, Spring Boot 4.0.x (Spring Framework 7 / Spring Security 7), Spring Cloud 2025.1.x Oakwood (Gateway/Config/Eureka), JPA/Hibernate 7, Liquibase, MapStruct 1.7.0.Beta1, Lombok 1.18.38+; Next.js 16 App Router (Turbopack) + React 19 + TypeScript 5 strict + Tailwind CSS 4 (CSS-first); Python 3.14 + FastAPI 0.138+ for NLQ. PostgreSQL 18, Redis 8, RabbitMQ 4.3 (quorum queues), MinIO, ClickHouse 25.9, OPA 1.17 (Rego v1). Latest stable versions across the board; Spring Boot stays on 4.0.x until Spring Cloud certifies 4.1. No downgrades.
- **Tenancy**: every tenant-scoped table has RLS enabled immediately after creation; every entity extends `TenantAuditableEntity`; `platform_db` has no `tenant_id` and is touched only by platform-admin-service.
- **Money**: all monetary values are `BIGINT` paisa (Java `Long`); never `Double`/`Float`/`DECIMAL`; tax floored per line with half-up rounding; display only via `MoneyUtils`.
- **Accounting**: journal entries are balanced (DB trigger) and immutable; corrections via reversal only; auto-posting idempotent via `posted_source_events`.
- **Boundaries**: no cross-service SQL; cross-service via `/internal/*` REST (OpenFeign) or RabbitMQ; consumers idempotent via `processed_events`; DLQ per consumer.
- **Security**: JWT validated at gateway AND each service (defence in depth); OPA fail-closed; bcrypt cost 12; AES-256-GCM field encryption for `totp_secret`, `cnic`, `bank_account_no`.
- **Time**: `TIMESTAMPTZ` (UTC) in DB, `Instant` in Java; business-day boundary = `DATE(opened_at AT TIME ZONE branch.timezone - INTERVAL '4 hours')`.
- **Quality gates (CI)**: finance + inventory ≥ 75% line coverage, all others ≥ 60%; OPA policies 100% coverage.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Specs in `Docs/` are the single source of truth, superior to prompts | Avoid hallucination; all design is already decided | — Pending |
| Skip GSD research phase | Domain/stack/architecture fully specified + 11 agent-specs already produced | ✓ Good |
| Comprehensive roadmap, parallel execution, all quality gates, Quality (Opus) profile | Production ERP; correctness > speed | — Pending |
| Phase 1 scope = infra + shared-lib + Auth + Gateway + Platform Admin + User/Authz(OPA) + Next.js shell + CI/CD | Matches readiness report's Sprint-1 GO set | — Pending |

---
*Last updated: 2026-07-19 — Phase 08.1 (POS-Inventory Depletion Activation) complete: the ORDER_CLOSED→depletion loop is now functional and trustworthy end-to-end (POS menu-item sync, catalog-validated recipes, recipe-builder UI, coverage/DEPLETION_INCOMPLETE observability, live depletion proof); fixed the shared-lib consumer-path FORCE-RLS GUC-ordering bug (42501) blocking all @RabbitListener writes to FORCE-RLS tables.*
*Prior: 2026-07-18 — Phase 8 (Inventory & Recipe Management) complete: inventory-service shipped (versioned recipes, MAC valuation, ORDER_CLOSED depletion, receipts/transfers/counts, alerts); Inventory moved Active → Validated*
