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
- [ ] **Phase 8: Inventory & Recipe Management** - Versioned BOM, `ORDER_CLOSED` depletion with MAC, receipts/transfers/counts
- [ ] **Phase 9: Order-to-Ledger Auto-Posting & Customer Loyalty** - The core-value loop closes: balanced revenue+COGS JEs + loyalty
- [ ] **Phase 10: Purchasing & Accounts Payable** - Vendors, PO approval, GRN/3-way match, AP (mock-first; Phase 8 optional) — REOPENED 2026-07-13 by UAT code audit (10 gaps: 4 blockers)
- [ ] **Phase 11: HR & Payroll** - Employees (encrypted PII), Pakistan tax/EOBI payroll, payroll JE
- [ ] **Phase 12: Reporting, Dashboards & NLQ** - ClickHouse ETL + FBR reports, realtime dashboard, validated NLQ

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

**Plans**: 8/8 complete; 07-09 pending (charge-to-account tender, SC7)

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
- [ ] 07-09: POS "charge to account" tender — on order close, call POST /internal/finance/ar/charges (Phase 10 / 10-18 seam) with the order's customerId + total; the receivable and its balanced JE (DR 1200 / CR revenue) are created by finance-service, not POS. Blocks FIN-05 from being fully Complete. [added 2026-07-13 by 10-17-A as 07-05; renumbered to 07-09 on the 2026-07-14 main merge, which had already shipped 07-05..07-08]

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

**Plans**: 9 plans (new `inventory-service` module; 4 waves)

Plans:
**Wave 1**

- [ ] 08-01-PLAN.md — Wave 1: Module foundation, complete FORCE-RLS schema, infra tables, processed-events + event payloads (INV-01/03/07 infra)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 08-02-PLAN.md — Wave 2: Testcontainers harness (InventoryTestBase/TestFixtures) + schema/RLS smoke IT
- [ ] 08-09-PLAN.md — Wave 2: OPA `inventory.rego` (view/manage on seeded permission codes, 100% covered) + `InventoryAuthorizationService` seam + `InventorySecurityConfig`/internal-secret filter (T-8-AC access-control foundation)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 08-03-PLAN.md — Wave 3: Stock domain model + ingredient/UOM/reorder masters + MAC calculator + opening balance + gateway route + OPA enforcement (INV-01, INV-07)
- [ ] 08-04-PLAN.md — Wave 3: Versioned recipes/BOM + effective-version-by-closedAt resolution (INV-02)

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 08-05-PLAN.md — Wave 4: `ORDER_CLOSED` depletion consumer — sorted pessimistic locks, FEFO walk, MAC COGS, idempotency, `STOCK_DEPLETED` (INV-03)
- [ ] 08-06-PLAN.md — Wave 4: Stock receipts (MAC recompute + `STOCK_RECEIVED`) + `GET /internal/grn/pending-count` finance seam (INV-04)
- [ ] 08-07-PLAN.md — Wave 4: Inter-branch transfers ship/receive with in-transit accounting + variance (INV-05)
- [ ] 08-08-PLAN.md — Wave 4: Stock counts + variance posting, low-stock alerts, nightly `@Scheduled` expiry sweep (INV-06)

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

**Plans**: 2 plans

Plans:

- [ ] 09-01: Auto-posting engine — order close (revenue+COGS), refund, wastage, stock count, transfer; idempotent
- [ ] 09-02: CRM — customers linked by `customer_id`, loyalty accrual/debit on close/refund, loyalty tiers, promotion engine, feedback collection

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

**Plans**: 4 plans

Plans:

- [ ] 11-01: Employees with field-encrypted `cnic`/`bank_account_no`
- [ ] 11-02: Payroll run (tax slabs + EOBI from `tax_config`), approval/payment, `PAYROLL_RUN_PAID` + JE
- [ ] 11-03: Shift scheduling (drag-drop), time & attendance (clock-in/out), leave/absence workflow, labour-cost % vs revenue
- [ ] 11-04: Biometric attendance — device registry, ADMS/iClock push adapter (Mode A) + USB bridge-agent ingest contract (Mode B), device-authenticated ingest, idempotent/offline-safe punches, quarantine, `ATTENDANCE_PUNCHED` (HR-07/08)

### Phase 12: Reporting, Dashboards & NLQ

**Goal**: Turn the system's events into insight safely — ClickHouse-backed reports (including FBR), a realtime dashboard, and a natural-language query path that is read-only and tenant/branch-safe by construction.
**Depends on**: Phase 7, Phase 8, Phase 9
**Requirements**: RPT-01, RPT-02, NLQ-01, NLQ-02
**Success Criteria** (what must be TRUE):

  1. Events ETL into ClickHouse analytics facts and named reports — including the FBR Tax Summary — return within their P95 latency targets, using the business-day boundary formula.
  2. The dashboard WebSocket pushes updates within 5 seconds of `ORDER_CLOSED`/`TILL_CLOSED`.
  3. An NLQ request converts NL→SQL via Claude and passes 7-stage AST validation (shape, parse, table allowlist, PII deny-list, tenant filter, branch filter, limit inject); a query missing the tenant or branch filter is rejected.
  4. NLQ enforces read-only execution, 5s timeout, row cap, per-tenant monthly + per-user hourly quotas, a 60s result cache, and stamps impersonation in `nlq_query_log`.

**Plans**: 11 plans

Note: `nlq-service` is **Java / Spring Boot** (user decision), not Python — it reuses the proven shared-lib + Eureka + Config Server + internal-JWT wiring, and uses JSqlParser (not sqlglot) for the 7-stage AST validation.

Plans:

- [ ] 12-01: Platform seams — reporting-service + nlq-service scaffolds, gateway routes, FEATURE_NLQ flag fix, deploy/env
- [ ] 12-02: ClickHouse analytics schema + locked-down nlq_readonly user (verified against the live 25.9 container)
- [ ] 12-03: ETL — ORDER_CLOSED / TILL_CLOSED / VENDOR_INVOICE_MATCHED into ClickHouse facts, business-day boundary, idempotent
- [ ] 12-04: NLQ 7-stage SQL AST validation pipeline (TDD, JSqlParser, adversarial suite)
- [ ] 12-05: Named reports + FBR Tax Summary (output tax − input tax = net payable)
- [ ] 12-06: Realtime dashboard WebSocket (<5s of close events) with per-tile throttle
- [ ] 12-07: NLQ execution — Claude NL→SQL, read-only executor, quotas, 60s cache, impersonation-stamped audit log
- [ ] 12-08: Frontend — reports, FBR page, realtime dashboard
- [ ] 12-09: Frontend — NLQ ask page with honest rejection UX
- [ ] 12-10: Real-stack end-to-end proof + requirements reconciliation
- [ ] 12-11: auth-service permission seeding (reporting.* + nlq.query.run) wired into db.changelog-master.xml

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12

With `parallelization: true`, after Phase 9 closes the core-value loop, Phases 10 and 11 may proceed in parallel (both depend only on already-completed phases); Phase 12 runs last as it consumes events from POS/Inventory/Finance.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Infrastructure Foundation & Shared Library | 0/4 | Not started | - |
| 2. Authentication & Authorization | 0/3 | Not started | - |
| 3. API Gateway, Platform Admin & Tenant/User Mgmt | 0/3 | Not started | - |
| 4. Frontend Shell & CI/CD | 3/3 | Complete | 2026-06-25 |
| 5. Cross-Cutting Services (Notifications, Audit, Files) | 0/3 | Not started | - |
| 6. Finance Core — General Ledger & Periods | 0/2 | Not started | - |
| 7. Point of Sale & Kitchen Display | 8/8 | Complete   | 2026-07-10 |
| 7.1. POS Production Operations & Item-Level Kitchen Tracking *(INSERTED)* | 10/10 | Complete    | 2026-07-11 |
| 8. Inventory & Recipe Management | 0/3 | Not started | - |
| 9. Order-to-Ledger Auto-Posting & Customer Loyalty | 0/2 | Not started | - |
| 10. Purchasing & Accounts Payable | 6/6 | **Reopened — UAT gaps** | - |
| 11. HR & Payroll | 0/4 | Not started | - |
| 12. Reporting, Dashboards & NLQ | 0/3 | Not started | - |
