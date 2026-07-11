# Requirements: RestaurantOS

**Defined:** 2026-06-22
**Core Value:** A tenant can run operations end-to-end (POS order → inventory depletion → balanced double-entry JE) with strict tenant/branch isolation and no accounting imbalance.

> Source of truth: `Docs/RestaurantERP_SaaS_Specification.md`, `Docs/RestaurantERP_UserStories_FlowDiagrams.md`, `Docs/agent-specs/01..11`. REQ-IDs trace to user stories (US-x.y) and business-logic rules (BLR-n) where applicable.

## v1 Requirements

### Infrastructure & Cross-Cutting (INFRA / XCUT)

- [ ] **INFRA-01**: `make dev-up` starts all infra (PostgreSQL 18, Redis 8, RabbitMQ 4.3, MinIO, OPA 1.17, Eureka, Config Server, ClickHouse 25.9, pgAdmin) with healthy status
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

- [x] **PLATFORM-01**: SuperAdmin can provision a tenant (FD-1): seed features from tier, create Tenant Admin, HQ branch, seed COA, publish `TENANT_PROVISIONED`, welcome email, < 60s
- [x] **PLATFORM-02**: SuperAdmin can list/paginate tenants with status, tier, usage
- [x] **PLATFORM-03**: SuperAdmin can suspend/reactivate/cancel a tenant (status state machine)
- [x] **PLATFORM-04**: SuperAdmin can update tenant feature flags (invalidates cache immediately)
- [x] **PLATFORM-10**: Every business module is built for every tenant; SuperAdmin can enable/disable ANY module (`FEATURE_*`) for ANY tenant independent of subscription tier (tier seeds defaults at provisioning, SuperAdmin override is authoritative — can grant above tier or revoke). Override persists on `tenant_features`, invalidates Redis cache immediately, is audited, and is enforced identically at the gateway and the `@RequiresFeature` aspect. The six primary modules (`FEATURE_POS`, `FEATURE_INVENTORY`, `FEATURE_FINANCE`, `FEATURE_VENDOR`, `FEATURE_HR`, `FEATURE_CRM`) + `FEATURE_KDS` default ON in all tiers
- [x] **PLATFORM-05**: SuperAdmin can impersonate a tenant user (JWT stamped `impersonated_by`, logged, 30-min expiry)
- [x] **PLATFORM-06**: SuperAdmin can view platform telemetry
- [x] **PLATFORM-07**: `platform_db` has no tenant scoping; only platform-admin-service connects to it

### Auth (AUTH)

- [x] **AUTH-01**: User can log in with email + password + tenant slug (+ optional TOTP) per FD-2 (tenant-status check, bcrypt cost 12, lockout)
- [x] **AUTH-02**: Service issues RS256 access JWT (15-min) and HttpOnly refresh session (7-day); `/.well-known/jwks.json` serves the public key
- [x] **AUTH-03**: User can refresh session via HttpOnly cookie
- [x] **AUTH-04**: User can log out (refresh session revoked)
- [x] **AUTH-05**: User can switch branch (JWT reissued with new branch context)
- [x] **AUTH-06**: User can request/perform password reset via emailed token
- [x] **AUTH-07**: User can set up / verify / disable 2FA (TOTP); mandatory for `rbac.manage` and `finance.period.close`
- [x] **AUTH-08**: `USER_LOGIN_SUCCEEDED` / `USER_LOGIN_FAILED` published on every attempt
- [x] **AUTH-09**: `totp_secret` stored field-encrypted (AES-256-GCM)

### Authorization (AUTHZ)

- [x] **AUTHZ-01**: Authorization Service proxies OPA decisions via `POST /internal/authorize`, fail-closed
- [x] **AUTHZ-02**: Rego policies exist for common/pos/finance/vendor/rbac with `same_tenant`, `same_branch`, `has_permission` helpers
- [x] **AUTHZ-03**: Every OPA policy enforces tenant AND branch isolation
- [x] **AUTHZ-04**: OPA policy test suite passes at 100% coverage

### API Gateway (GW)

- [x] **GW-01**: Gateway routes every public path prefix to its upstream with per-upstream circuit breaker
- [x] **GW-02**: Gateway validates JWT on every request except auth/login, refresh, `/.well-known/*`, health, and the **device-authenticated** ingest path class (`/iclock/*`, `/internal/attendance/ingest`) which is JWT-exempt but verifies a per-device token/HMAC and resolves tenant/branch from the device registry; returns 401 when missing/invalid
- [x] **GW-03**: Gateway resolves tenant (JWT claim or custom-domain Host) and propagates `X-Tenant-Id`
- [x] **GW-04**: Gateway rate-limits (100/min/IP auth, 600/min/IP general) via Redis token bucket
- [x] **GW-05**: Gateway enforces feature flags (403 `FEATURE_DISABLED` + `X-Upgrade-CTA-URL`) and NLQ quotas (429 `QUOTA_EXCEEDED`)
- [x] **GW-06**: Nginx terminates TLS and forwards to the gateway

### User & Branch (USER)

- [x] **USER-01**: Tenant Admin can CRUD branches (tenant-scoped)
- [x] **USER-02**: Tenant Admin can manage user profiles and assign roles per branch
- [x] **USER-03**: Internal endpoints expose branch details and computed user permissions for JWT issuance

### Frontend Shell (FE)

- [ ] **FE-01**: Next.js 16 App Router shell with TS strict, Tailwind CSS 4, shadcn/ui, route groups (auth/platform/tenant)
- [ ] **FE-02**: Four-layer API abstraction (client/request/errors/types + schemas/adapters/models/repositories/hooks) wired
- [ ] **FE-03**: `middleware.ts` protects tenant and platform routes (redirect to login without valid session)
- [ ] **FE-04**: Login page (tenant slug from subdomain/`?tenant=`), conditional TOTP step
- [ ] **FE-05**: Sidebar nav conditioned on permissions + feature flags; BranchSwitcher reissues JWT and invalidates query cache
- [ ] **FE-06**: `FeatureGuard` and `PermissionGuard` components
- [ ] **FE-07**: MSW dev mocks for auth endpoints; every API response Zod-parsed before adaptation
- [ ] **FE-08**: Components never import `lib/api-client` or `lib/repositories` (ESLint enforced); zero `any`; `tsc --noEmit` clean

### Design System — Shell (DS)

> Adopted 2026-06-26 from `Docs/RestaurantOS_UI_UX_Design_System.md` (authoritative; stack-adapted to Next 16 + Tailwind 4 CSS-first + OKLCH + flat dir + four-layer boundary). Shell-level DS requirements are a **Phase-4 design-system gap-closure**. Module-specific UX (POS/KDS/Finance/Inventory/NLQ/Reports/HR/Vendor §7–8) folds into the respective module phases (5–12), tracked under those modules' requirements.

- [x] **DS-01**: Design tokens complete in `globals.css` (Tailwind 4 `@theme`, OKLCH) — semantic `--warning/--success/--info` (+fg) + DS keyframes/utilities (skeleton-shimmer, count-up, slide-in-right, fade-in, scale-in, bounce-subtle); `prefers-reduced-motion` honored
- [x] **DS-02**: Skeleton-first loading — `Skeleton` primitive + per-view skeletons mirroring loaded shape; no spinners/blank on data states (Rule 1)
- [x] **DS-03**: Motion — `framer-motion` `PageTransition` on every page + §9 micro-interaction catalogue (reduced-motion safe)
- [x] **DS-04**: Core primitives — Command palette (`cmdk` ⌘K), `AnimatedNumber` (`react-countup`), `StatusBadge`, `MoneyDisplay` (paisa→PKR, Rule 2), `DataTable` (`@tanstack/react-table`), `EmptyState` (§14)
- [x] **DS-05**: Shell chrome — grouped/branded collapsible Sidebar (keeps PermissionGuard+FeatureGuard composition) + Top Bar (breadcrumb, notifications, profile/theme, ⌘K) + mobile bottom-nav
- [x] **DS-06**: Tenant theming — OKLCH palette generator (`colorjs.io`), `/api/theme` route + layout injection, Settings→Appearance UI + 6 presets + logo upload + WCAG-AA colour validator
- [x] **DS-07**: A11y + dark-mode polish — focus-visible rings, 44px touch-target floor, `aria-live` status, light/dark/system toggle UI (WCAG 2.1 AA, §11–12)

### POS (POS)

- [x] **POS-01**: Staff can open a table/order and add items; order state machine enforced (DRAFT→OPEN→SENT_TO_KDS→…→CLOSED/VOIDED/REFUNDED)
- [x] **POS-02**: Staff can send order to kitchen (`ORDER_SENT_TO_KDS`, station routing via `kds_station`)
- [x] **POS-03**: Staff can take split-tender payments; 1-paisa rounding resolution defined; close is idempotent
- [x] **POS-04**: Staff can void/refund per permission and OPA threshold; events published with idempotency
- [x] **POS-05**: Discounts cannot push a line below zero
- [x] **POS-06**: Till open/close with reconciliation; `TILL_OPENED`/`TILL_CLOSED`
- [x] **POS-07**: Offline POS queues orders (Service Worker + IndexedDB) and syncs with `client_order_id` as idempotency key
- [x] **POS-08**: `ORDER_CLOSED` published with `customerId` for downstream consumers

> **Phase 7.1 (INSERTED 2026-07-11)** — production-hardening of the Phase-7 POS MVP. Turns "create an order and fire it at the kitchen" into a real dine-in operations surface: active-order management, table-centric flow, item-level kitchen tracking, add-to-existing-order kitchen ticket revisions, instructions, a fast cashier terminal, and wiring of already-built-but-unrendered payment/till/void UI (Phase-7 UAT gap).

- [x] **POS-09**: Order Management screen — cashiers/servers list active orders (own or all-branch per permission) with derived status, and can open, edit, reopen, and complete payment on any active order; an order remains OPEN (active) until it is paid and closed
- [x] **POS-10**: Table-centric dine-in — the table floor view is the primary dine-in entry point; selecting a table shows its current active order, order status, assigned server/cashier, and live bill summary; every dine-in order is linked to a table
- [x] **POS-11**: Item-level status lifecycle — each order line tracks its own status (`PENDING`→`SENT`→`ACCEPTED`→`PREPARING`→`READY`→`SERVED`, plus `CANCELLED`); the aggregate order status (`DRAFT`/`IN_PROGRESS`/`PARTIALLY_SERVED`/`SERVED`/`CLOSED`) is **derived** from line statuses, not set independently
- [x] **POS-12**: Order revisions / add-to-existing — items can be added to an already-sent active order and only the newly-added items are sent to the kitchen as a new revision; previously-sent/served lines are never resent; a per-order revision history (Rev 1, Rev 2, …) is maintained (implemented per researched industry-standard POS behavior)
- [x] **POS-13**: Order & item instructions — an order-level special-instructions field plus optional per-item instructions (e.g. "no onions", "medium rare"), captured at create/edit and surfaced to the kitchen on the ticket + order-detail view
- [x] **POS-14**: Wire cashier settlement actions — render the already-built `PaymentPanel`, `TillSessionBar`, and `VoidRefundDialog` into the live POS/order flow so a cashier can charge, open/close a till, and void/refund through the UI; close the Phase-7 UAT gaps (void 403, offline sync-badge not updating on reconnect)
- [x] **POS-15**: Cashier experience — fast order creation, quick item search, easy editing of active orders, clear order/item status indicators, efficient service navigation; fix the terminal state bugs (first-item add, item-cap after N items)

### Kitchen / KDS (KDS)

- [x] **KDS-01**: Orders route to station queues; items progress PENDING→COOKING→READY
- [x] **KDS-02**: `ORDER_READY` notifies POS
- [x] **KDS-03**: KDS revision & detail (Phase 7.1) — the board renders stable (non-jumping) cards, lets staff open a ticket for full order detail, visually distinguishes newly-added revision items from earlier ones, shows special instructions/kitchen notes, and displays per-item status rather than only an order-level status

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
- [ ] **PUR-05**: Vendor performance scorecard — lead-time adherence (on-time delivery), fill rate, price variance per vendor
- [ ] **PUR-06**: Spend analytics by vendor and by category, with period comparison

### Finance (FIN)

- [x] **FIN-01**: Pakistan COA seeded per tenant; accounts queryable
- [x] **FIN-02**: Journal entries are balanced (DB deferred trigger) and immutable; reversal-only corrections
- [ ] **FIN-03**: Auto-posting recipes for order close (revenue + COGS), refund, GR/IR, vendor invoice/payment, expense, wastage, stock count, transfer, payroll — all balanced and idempotent via `posted_source_events`
- [x] **FIN-04**: Accounting periods (12/FY, Pakistan Jul–Jun) seeded; period close sets LOCKED with pre-checks via internal APIs (no cross-service SQL)
- [ ] **FIN-05**: AP/AR tracked; expense approval respects OPA approval limits
- [x] **FIN-06**: Posting to a locked period returns 423 `PERIOD_LOCKED`

### HR & Payroll (HR)

- [ ] **HR-01**: Manage employees (`cnic`, `bank_account_no` field-encrypted)
- [ ] **HR-02**: Payroll run lifecycle; Pakistan income-tax slabs + EOBI from `tax_config` (annual, config-driven)
- [ ] **HR-03**: Payroll approval/payment posts JE; `PAYROLL_RUN_PAID` consumed by Finance
- [ ] **HR-04**: Role-based shift scheduling on a drag-and-drop calendar, per branch
- [ ] **HR-05**: Time & attendance (clock-in/out) and leave/absence management (types, accrual, approval workflow); late-arrival deductions feed payroll
- [ ] **HR-06**: Labour-cost % vs revenue tracking by shift and branch
- [ ] **HR-07**: Biometric attendance device integration — register devices (`attendance_devices`: serial→token→branch→tenant); ingest punches from (a) network terminals pushing ADMS/iClock over HTTPS (`/iclock/*`) and (b) USB readers via a local bridge agent (`wss://127.0.0.1` → device-authenticated ingest). Device-authenticated (not JWT); tenant/branch resolved from registry (never client input); idempotent on `(device_id, device_user_ref, device_reported_at)`; offline-buffer/replay safe; stores both device + server timestamps; unmapped punches quarantined; each punch persists to `attendance_punches`, publishes `ATTENDANCE_PUNCHED`, and feeds attendance/payroll; gated by `FEATURE_HR`
- [ ] **HR-08**: Biometric privacy — matching happens at the edge (on-device for network terminals, in the agent for USB); the platform stores ONLY `employee_id + device_id + punched_at` and NO raw biometrics by default. Central templates are opt-in only and, when stored, are AES-256-GCM encrypted in a dedicated RLS table with restricted access + retention

### CRM (CRM)

- [ ] **CRM-01**: Manage customers; link to orders via `customer_id`
- [ ] **CRM-02**: Loyalty points accrue on `ORDER_CLOSED` and are debited back on refund
- [ ] **CRM-03**: Loyalty tiers (Bronze/Silver/Gold) with configurable thresholds; tier upgrade checked on accrual
- [ ] **CRM-04**: Promotion engine — time-limited discounts by day/hour, item-specific and tier-specific
- [ ] **CRM-05**: Customer feedback collection (post-order rating/comment capture, storage, reporting)

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

Every v1 requirement maps to exactly one phase (see ROADMAP.md). Status `Pending` until executed.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 1 | Pending |
| INFRA-02 | Phase 1 | Pending |
| INFRA-03 | Phase 1 | Pending |
| INFRA-04 | Phase 1 | Pending |
| INFRA-05 | Phase 4 | Complete |
| XCUT-01 | Phase 1 | Pending |
| XCUT-02 | Phase 1 | Pending |
| XCUT-03 | Phase 1 | Pending |
| XCUT-04 | Phase 1 | Pending |
| XCUT-05 | Phase 1 | Pending |
| XCUT-06 | Phase 1 | Pending |
| LIB-01 | Phase 1 | Pending |
| LIB-02 | Phase 1 | Pending |
| LIB-03 | Phase 1 | Pending |
| LIB-04 | Phase 1 | Pending |
| LIB-05 | Phase 1 | Pending |
| LIB-06 | Phase 1 | Pending |
| AUTH-01 | Phase 2 | Complete |
| AUTH-02 | Phase 2 | Complete |
| AUTH-03 | Phase 2 | Complete |
| AUTH-04 | Phase 2 | Complete |
| AUTH-05 | Phase 2 | Complete |
| AUTH-06 | Phase 2 | Complete |
| AUTH-07 | Phase 2 | Complete |
| AUTH-08 | Phase 2 | Complete |
| AUTH-09 | Phase 2 | Complete |
| AUTHZ-01 | Phase 2 | Complete |
| AUTHZ-02 | Phase 2 | Complete |
| AUTHZ-03 | Phase 2 | Complete |
| AUTHZ-04 | Phase 2 | Complete |
| GW-01 | Phase 3 | Complete |
| GW-02 | Phase 3 | Complete |
| GW-03 | Phase 3 | Complete |
| GW-04 | Phase 3 | Complete |
| GW-05 | Phase 3 | Complete |
| GW-06 | Phase 3 | Complete |
| PLATFORM-01 | Phase 3 | Complete |
| PLATFORM-02 | Phase 3 | Complete |
| PLATFORM-03 | Phase 3 | Complete |
| PLATFORM-04 | Phase 3 | Complete |
| PLATFORM-05 | Phase 3 | Complete |
| PLATFORM-06 | Phase 3 | Complete |
| PLATFORM-07 | Phase 3 | Complete |
| PLATFORM-10 | Phase 3 | Complete |
| USER-01 | Phase 3 | Complete |
| USER-02 | Phase 3 | Complete |
| USER-03 | Phase 3 | Complete |
| FE-01 | Phase 4 | Complete |
| FE-02 | Phase 4 | Complete |
| FE-03 | Phase 4 | Complete |
| FE-04 | Phase 4 | Complete |
| FE-05 | Phase 4 | Complete |
| FE-06 | Phase 4 | Complete |
| FE-07 | Phase 4 | Complete |
| FE-08 | Phase 4 | Complete |
| DS-01 | Phase 4 (gap) | Complete |
| DS-02 | Phase 4 (gap) | Complete |
| DS-03 | Phase 4 (gap) | Complete |
| DS-04 | Phase 4 (gap) | Complete |
| DS-05 | Phase 4 (gap) | Complete |
| DS-06 | Phase 4 (gap) | Complete |
| DS-07 | Phase 4 (gap) | Complete |
| NOTIF-01 | Phase 5 | Pending |
| AUDIT-01 | Phase 5 | Pending |
| FILE-01 | Phase 5 | Pending |
| FIN-01 | Phase 6 | Complete |
| FIN-02 | Phase 6 | Complete |
| FIN-04 | Phase 6 | Complete |
| FIN-06 | Phase 6 | Complete |
| POS-01 | Phase 7 | Complete |
| POS-02 | Phase 7 | Complete |
| POS-03 | Phase 7 | Complete |
| POS-04 | Phase 7 | Complete |
| POS-05 | Phase 7 | Complete |
| POS-06 | Phase 7 | Complete |
| POS-07 | Phase 7 | Complete |
| POS-08 | Phase 7 | Complete |
| KDS-01 | Phase 7 | Complete |
| KDS-02 | Phase 7 | Complete |
| POS-09 | Phase 7.1 | Complete |
| POS-10 | Phase 7.1 | Complete |
| POS-11 | Phase 7.1 | Complete |
| POS-12 | Phase 7.1 | Complete |
| POS-13 | Phase 7.1 | Complete |
| POS-14 | Phase 7.1 | Complete |
| POS-15 | Phase 7.1 | Complete |
| KDS-03 | Phase 7.1 | Complete |
| INV-01 | Phase 8 | Pending |
| INV-02 | Phase 8 | Pending |
| INV-03 | Phase 8 | Pending |
| INV-04 | Phase 8 | Pending |
| INV-05 | Phase 8 | Pending |
| INV-06 | Phase 8 | Pending |
| INV-07 | Phase 8 | Pending |
| FIN-03 | Phase 9 | Pending |
| CRM-01 | Phase 9 | Pending |
| CRM-02 | Phase 9 | Pending |
| CRM-03 | Phase 9 | Pending |
| CRM-04 | Phase 9 | Pending |
| CRM-05 | Phase 9 | Pending |
| PUR-01 | Phase 10 | Pending |
| PUR-02 | Phase 10 | Pending |
| PUR-03 | Phase 10 | Pending |
| PUR-04 | Phase 10 | Pending |
| PUR-05 | Phase 10 | Pending |
| PUR-06 | Phase 10 | Pending |
| FIN-05 | Phase 10 | Pending |
| HR-01 | Phase 11 | Pending |
| HR-02 | Phase 11 | Pending |
| HR-03 | Phase 11 | Pending |
| HR-04 | Phase 11 | Pending |
| HR-05 | Phase 11 | Pending |
| HR-06 | Phase 11 | Pending |
| HR-07 | Phase 11 | Pending |
| HR-08 | Phase 11 | Pending |
| RPT-01 | Phase 12 | Pending |
| RPT-02 | Phase 12 | Pending |
| NLQ-01 | Phase 12 | Pending |
| NLQ-02 | Phase 12 | Pending |

**Coverage:**

- v1 requirements: 112 across 18 categories (INFRA, XCUT, LIB, PLATFORM, AUTH, AUTHZ, GW, USER, FE, POS, KDS, INV, PUR, FIN, HR, CRM, RPT/NLQ, NOTIF/AUDIT/FILE)
- Mapped to phases: 112/112 (100%) — each requirement mapped to exactly one phase
- Unmapped: 0
- 2026-07-11 addition (+8): Phase 7.1 (INSERTED) POS production-hardening — POS-09 (order management screen), POS-10 (table-centric dine-in), POS-11 (item-level status + derived order status), POS-12 (order revisions / add-to-existing kitchen tickets), POS-13 (order & item instructions), POS-14 (wire payment/till/void UI + close Phase-7 UAT gaps), POS-15 (cashier experience + terminal bug fixes), KDS-03 (KDS revision & detail with item-level status)
- 2026-06-25 addition (+9): PLATFORM-10 (SuperAdmin tier-independent per-tenant module enable/disable); HR-04/05/06 (shift scheduling, attendance & leave, labour-cost tracking); PUR-05/06 (vendor scorecard, spend analytics); CRM-03/04/05 (loyalty tiers, promotion engine, feedback) — all six primary modules are now core/mandatory in every tenant build
- 2026-06-25 addition (+2): HR-07 (biometric attendance device integration — LAN ADMS push + USB bridge agent, device-authenticated ingest); HR-08 (biometric privacy — edge matching, no central raw biometrics); GW-02 extended for the device-authenticated ingest path class
- v2 requirements (deferred, not mapped): NOTIF-02, NOTIF-03, PLATFORM-08, PLATFORM-09, INV-08, RPT-03, AUTHZ-05, AUDIT-02

---
*Requirements defined: 2026-06-22*
*Last updated: 2026-06-25 — all six business modules made core/mandatory; added SuperAdmin tier-independent per-tenant module control (PLATFORM-10), operational sub-features for HR/Vendor/CRM, and biometric attendance device integration (HR-07/08, GW-02 device-auth ingest)*
*Last updated: 2026-07-11 — Phase 7.1 (INSERTED) POS production-hardening: +8 requirements (POS-09..15, KDS-03) for order management, table-centric dine-in, item-level kitchen status, add-to-existing kitchen ticket revisions, order/item instructions, cashier UX, and wiring the unrendered payment/till/void UI found in the Phase-7 UAT*
