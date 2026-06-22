# Requirements: RestaurantOS

**Defined:** 2026-06-22
**Core Value:** A tenant can run operations end-to-end (POS order → inventory depletion → balanced double-entry JE) with strict tenant/branch isolation and no accounting imbalance.

> Source of truth: `Docs/RestaurantERP_SaaS_Specification.md`, `Docs/RestaurantERP_UserStories_FlowDiagrams.md`, `Docs/agent-specs/01..11`. REQ-IDs trace to user stories (US-x.y) and business-logic rules (BLR-n) where applicable.

## v1 Requirements

### Infrastructure & Cross-Cutting (INFRA / XCUT)

- [ ] **INFRA-01**: `make dev-up` starts all infra (PostgreSQL 16, Redis 7, RabbitMQ 3.13, MinIO, OPA, Eureka, Config Server, ClickHouse, pgAdmin) with healthy status
- [ ] **INFRA-02**: DB init creates all 13 service databases and one least-privilege role per service with `SET ON PARAMETER app.current_tenant_id`
- [ ] **INFRA-03**: RabbitMQ topology (exchanges, queues, per-consumer DLQs) pre-created from definitions on first start
- [ ] **INFRA-04**: `generate-keys.sh` produces RS256 JWT keypair + AES-256 key into `.env`; `.env.example` documents every variable
- [ ] **INFRA-05**: CI pipeline runs lint → test (coverage gates: finance/inventory ≥75%, others ≥60%, OPA 100%) → build (signed images) → schema-sync, with no manual intervention
- [ ] **XCUT-01**: Every entity extends `TenantAuditableEntity`; every tenant-scoped table has an RLS changeset immediately after creation
- [ ] **XCUT-02**: `tenant_id` is never accepted from client input; always resolved from JWT
- [ ] **XCUT-03**: All money is `BIGINT` paisa end-to-end; display only via `MoneyUtils`; per-line floored tax with half-up rounding
- [ ] **XCUT-04**: All timestamps `TIMESTAMPTZ`/`Instant`; business-day boundary formula applied in reporting
- [ ] **XCUT-05**: Every event carries the standard envelope; every consumer is idempotent via `processed_events`; transactional outbox guarantees publish-on-commit
- [ ] **XCUT-06**: Standard `ApiResponse`/`ApiError` envelopes and error-code catalogue used everywhere; `GlobalExceptionHandler` maps every exception type

### Shared Library (LIB)

- [ ] **LIB-01**: `shared-lib` builds and is importable; provides `TenantAuditableEntity`, `TenantContext`, `TenantFilterInterceptor`
- [ ] **LIB-02**: Tenant context propagates correctly into `@Async` and RabbitMQ consumers (TaskDecorator / message processor)
- [ ] **LIB-03**: JWT filter, `RestaurantOsAuthentication`, JWKS fetch/cache provided
- [ ] **LIB-04**: `@RequiresFeature` + aspect + Redis-backed `FeatureFlagService` (5-min TTL)
- [ ] **LIB-05**: `OpaClient` + `OpaInput` (fail-closed, 2s timeout, branch-aware input)
- [ ] **LIB-06**: `IdempotencyService` (24h), `EventEnvelope`, `DomainEventPublisher` (outbox), `MoneyUtils`

### Platform Admin (PLATFORM)

- [ ] **PLATFORM-01**: SuperAdmin can provision a tenant (FD-1): seed features from tier, create Tenant Admin, HQ branch, seed COA, publish `TENANT_PROVISIONED`, welcome email, < 60s
- [ ] **PLATFORM-02**: SuperAdmin can list/paginate tenants with status, tier, usage
- [ ] **PLATFORM-03**: SuperAdmin can suspend/reactivate/cancel a tenant (status state machine)
- [ ] **PLATFORM-04**: SuperAdmin can update tenant feature flags (invalidates cache immediately)
- [ ] **PLATFORM-05**: SuperAdmin can impersonate a tenant user (JWT stamped `impersonated_by`, logged, 30-min expiry)
- [ ] **PLATFORM-06**: SuperAdmin can view platform telemetry
- [ ] **PLATFORM-07**: `platform_db` has no tenant scoping; only platform-admin-service connects to it

### Auth (AUTH)

- [ ] **AUTH-01**: User can log in with email + password + tenant slug (+ optional TOTP) per FD-2 (tenant-status check, bcrypt cost 12, lockout)
- [ ] **AUTH-02**: Service issues RS256 access JWT (15-min) and HttpOnly refresh session (7-day); `/.well-known/jwks.json` serves the public key
- [ ] **AUTH-03**: User can refresh session via HttpOnly cookie
- [ ] **AUTH-04**: User can log out (refresh session revoked)
- [ ] **AUTH-05**: User can switch branch (JWT reissued with new branch context)
- [ ] **AUTH-06**: User can request/perform password reset via emailed token
- [ ] **AUTH-07**: User can set up / verify / disable 2FA (TOTP); mandatory for `rbac.manage` and `finance.period.close`
- [ ] **AUTH-08**: `USER_LOGIN_SUCCEEDED` / `USER_LOGIN_FAILED` published on every attempt
- [ ] **AUTH-09**: `totp_secret` stored field-encrypted (AES-256-GCM)

### Authorization (AUTHZ)

- [ ] **AUTHZ-01**: Authorization Service proxies OPA decisions via `POST /internal/authorize`, fail-closed
- [ ] **AUTHZ-02**: Rego policies exist for common/pos/finance/vendor/rbac with `same_tenant`, `same_branch`, `has_permission` helpers
- [ ] **AUTHZ-03**: Every OPA policy enforces tenant AND branch isolation
- [ ] **AUTHZ-04**: OPA policy test suite passes at 100% coverage

### API Gateway (GW)

- [ ] **GW-01**: Gateway routes every public path prefix to its upstream with per-upstream circuit breaker
- [ ] **GW-02**: Gateway validates JWT on every request except auth/login, refresh, `/.well-known/*`, health; returns 401 when missing/invalid
- [ ] **GW-03**: Gateway resolves tenant (JWT claim or custom-domain Host) and propagates `X-Tenant-Id`
- [ ] **GW-04**: Gateway rate-limits (100/min/IP auth, 600/min/IP general) via Redis token bucket
- [ ] **GW-05**: Gateway enforces feature flags (403 `FEATURE_DISABLED` + `X-Upgrade-CTA-URL`) and NLQ quotas (429 `QUOTA_EXCEEDED`)
- [ ] **GW-06**: Nginx terminates TLS and forwards to the gateway

### User & Branch (USER)

- [ ] **USER-01**: Tenant Admin can CRUD branches (tenant-scoped)
- [ ] **USER-02**: Tenant Admin can manage user profiles and assign roles per branch
- [ ] **USER-03**: Internal endpoints expose branch details and computed user permissions for JWT issuance

### Frontend Shell (FE)

- [ ] **FE-01**: Next.js 14 App Router shell with TS strict, Tailwind, shadcn/ui, route groups (auth/platform/tenant)
- [ ] **FE-02**: Four-layer API abstraction (client/request/errors/types + schemas/adapters/models/repositories/hooks) wired
- [ ] **FE-03**: `middleware.ts` protects tenant and platform routes (redirect to login without valid session)
- [ ] **FE-04**: Login page (tenant slug from subdomain/`?tenant=`), conditional TOTP step
- [ ] **FE-05**: Sidebar nav conditioned on permissions + feature flags; BranchSwitcher reissues JWT and invalidates query cache
- [ ] **FE-06**: `FeatureGuard` and `PermissionGuard` components
- [ ] **FE-07**: MSW dev mocks for auth endpoints; every API response Zod-parsed before adaptation
- [ ] **FE-08**: Components never import `lib/api-client` or `lib/repositories` (ESLint enforced); zero `any`; `tsc --noEmit` clean

### POS (POS)

- [ ] **POS-01**: Staff can open a table/order and add items; order state machine enforced (DRAFT→OPEN→SENT_TO_KDS→…→CLOSED/VOIDED/REFUNDED)
- [ ] **POS-02**: Staff can send order to kitchen (`ORDER_SENT_TO_KDS`, station routing via `kds_station`)
- [ ] **POS-03**: Staff can take split-tender payments; 1-paisa rounding resolution defined; close is idempotent
- [ ] **POS-04**: Staff can void/refund per permission and OPA threshold; events published with idempotency
- [ ] **POS-05**: Discounts cannot push a line below zero
- [ ] **POS-06**: Till open/close with reconciliation; `TILL_OPENED`/`TILL_CLOSED`
- [ ] **POS-07**: Offline POS queues orders (Service Worker + IndexedDB) and syncs with `client_order_id` as idempotency key
- [ ] **POS-08**: `ORDER_CLOSED` published with `customerId` for downstream consumers

### Kitchen / KDS (KDS)

- [ ] **KDS-01**: Orders route to station queues; items progress PENDING→COOKING→READY
- [ ] **KDS-02**: `ORDER_READY` notifies POS

### Inventory (INV)

- [ ] **INV-01**: Manager can manage ingredients, UOM, reorder points
- [ ] **INV-02**: Recipes/BOM versioned; depletion uses the recipe version effective at order time
- [ ] **INV-03**: `ORDER_CLOSED` consumer depletes stock with `SELECT FOR UPDATE`, MAC maintained
- [ ] **INV-04**: Stock receipts update MAC; `STOCK_RECEIVED` published
- [ ] **INV-05**: Stock transfers (ship/receive) with in-transit accounting and variance handling
- [ ] **INV-06**: Stock counts with variance posting; low-stock and expiry alerts
- [ ] **INV-07**: Opening stock recorded via `OPENING_BALANCE` movement

### Purchasing (PUR)

- [ ] **PUR-01**: Manager can manage vendors (bank account field-encrypted)
- [ ] **PUR-02**: PO lifecycle DRAFT→PENDING_APPROVAL→APPROVED→SENT→…→CLOSED with tiered approval (OPA)
- [ ] **PUR-03**: GRN receipt posts GR/IR
- [ ] **PUR-04**: Vendor-invoice 3-way match → AP; payment posts and `AP_PAYMENT_PROCESSED`

### Finance (FIN)

- [ ] **FIN-01**: Pakistan COA seeded per tenant; accounts queryable
- [ ] **FIN-02**: Journal entries are balanced (DB deferred trigger) and immutable; reversal-only corrections
- [ ] **FIN-03**: Auto-posting recipes for order close (revenue + COGS), refund, GR/IR, vendor invoice/payment, expense, wastage, stock count, transfer, payroll — all balanced and idempotent via `posted_source_events`
- [ ] **FIN-04**: Accounting periods (12/FY, Pakistan Jul–Jun) seeded; period close sets LOCKED with pre-checks via internal APIs (no cross-service SQL)
- [ ] **FIN-05**: AP/AR tracked; expense approval respects OPA approval limits
- [ ] **FIN-06**: Posting to a locked period returns 423 `PERIOD_LOCKED`

### HR & Payroll (HR)

- [ ] **HR-01**: Manage employees (`cnic`, `bank_account_no` field-encrypted)
- [ ] **HR-02**: Payroll run lifecycle; Pakistan income-tax slabs + EOBI from `tax_config` (annual, config-driven)
- [ ] **HR-03**: Payroll approval/payment posts JE; `PAYROLL_RUN_PAID` consumed by Finance

### CRM (CRM)

- [ ] **CRM-01**: Manage customers; link to orders via `customer_id`
- [ ] **CRM-02**: Loyalty points accrue on `ORDER_CLOSED` and are debited back on refund

### Reporting & NLQ (RPT / NLQ)

- [ ] **RPT-01**: ClickHouse ETL from events into analytics facts; named reports (incl. FBR Tax Summary) within P95 latency targets
- [ ] **RPT-02**: Dashboard WebSocket pushes within 5s of `ORDER_CLOSED`/`TILL_CLOSED`
- [ ] **NLQ-01**: NLQ converts NL→SQL via Claude with 7-stage AST validation (shape, parse, table allowlist, PII deny-list, tenant filter, branch filter, limit inject)
- [ ] **NLQ-02**: NLQ enforces read-only, 5s timeout, row cap, per-tenant monthly + per-user hourly quotas; result cache 60s; impersonation stamped in `nlq_query_log`

### Notifications, Audit, Files (NOTIF / AUDIT / FILE)

- [ ] **NOTIF-01**: Templated email + in-app notifications per tenant; rules for low-stock, PO approval, etc.
- [ ] **AUDIT-01**: Immutable audit log of significant actions, 7-year retention with archival
- [ ] **FILE-01**: MinIO-backed file storage with per-tenant quota enforcement

## v2 Requirements

### Tier-gated / Advanced

- **NOTIF-02**: WhatsApp notifications (GROWTH+)
- **NOTIF-03**: SMS notifications (ENTERPRISE)
- **PLATFORM-08**: White-label custom domain (DNS verify + Nginx vhost + Let's Encrypt)
- **PLATFORM-09**: Public API access (ENTERPRISE)
- **INV-08**: Lot/batch tracking (GROWTH+)
- **RPT-03**: Consolidated multi-branch reporting (GROWTH+)
- **AUTHZ-05**: Custom roles (GROWTH+)
- **AUDIT-02**: Audit export (GROWTH+)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Native mobile apps | Web-first; offline POS PWA covers field use |
| New architecture/data-model/contract design | Already decided in specs; this is implementation |
| Multi-currency / non-PK tax regimes | Pakistan-first product (PKR paisa, FBR, EOBI/PESSI) |
| External payment-gateway processing | v1 records tenders only |

## Traceability

Populated during roadmap creation (see ROADMAP.md).

**Coverage:**
- v1 requirements: ~80 across 18 categories
- Mapped to phases: (pending roadmap)
- Unmapped: (pending roadmap)

---
*Requirements defined: 2026-06-22*
*Last updated: 2026-06-22 after initial definition*
