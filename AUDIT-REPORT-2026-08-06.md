# RestaurantOS — Production Readiness Audit

**Date:** 2026-08-06 · **Branch:** `prod` @ `7ed6a15` · **Method:** 8 parallel source-level audits + live stack bring-up

---

## 0. Executive summary

The codebase is **substantial and largely well-engineered** — 15 backend services, 20/20 Maven modules compiling clean, a Next.js frontend that typechecks and builds, a real ClickHouse ETL, a real NLQ pipeline with 7-stage SQL validation, and a genuinely strong permission/feature-gating architecture.

It is **not production-ready today**, and the gaps are not cosmetic. Three of them mean core advertised capabilities are *unreachable at runtime* despite being fully coded:

| # | Blocker | Consequence |
|---|---|---|
| **B1** | **No SuperAdmin can authenticate.** No platform login endpoint exists; `PlatformUserRepository.findByEmail` has zero production callers. Worse, `@PreAuthorize("hasAuthority('SUPER_ADMIN')")` can *never* be satisfied — `JwtAuthenticationFilter` builds authorities from the `permissions` claim only, and `SUPER_ADMIN` is in no permission catalog. The gateway also 401s any tenant-less token. | The **entire `/api/v1/platform/**` API is dead**, including tenant provisioning, feature flags, and impersonation. |
| **B2** | **A tenant provisioned through the real saga cannot log in.** The saga never inserts an `auth_tenants` row (login resolves tenant by slug) and never creates a `user_branch_roles` row (`PermissionResolver` throws *"User has no active branch assignments"*). | Provisioning reports success and produces a **locked-out tenant**. Dev only works because Liquibase hardcodes seed rows. |
| **B3** | **No user-creation API exists anywhere.** `/api/v1/users` exposes only branch-role assign/revoke/read. | A tenant **cannot onboard a single cashier**. No user list, edit, or deactivate either. |

Everything else below is downstream of these three.

---

## 1. Branch & environment findings

- **There is no `Production` branch.** The correct branch is **`prod`**, and it is genuinely the latest: it strictly contains `main`, `QA`, and `Mufazzal` (the latter is missing ~73k lines present on `prod`).
- Four infra defects were found and **fixed** during bring-up:
  1. Colima VM was sized at 6 GB — insufficient. Raised to 12 GB / 6 CPU.
  2. `scripts/dev-stack-up.sh` port pre-flight hard-coded Docker Desktop and false-positived on Colima's SSH forwarder, aborting every bring-up. **Fixed** — it now accepts Docker Desktop *and* colima/lima forwarders while still rejecting a native Postgres or a tunnel to another DB.
  3. `deploy/init/rabbitmq-definitions.json` existed as an **empty directory** (Docker placeholder created when containers auto-started before the render step). RabbitMQ was dead with exit 127. **Fixed.**
  4. **`REPORTING_DB_PASSWORD` / `NLQ_DB_PASSWORD` were never added to `deploy/.env`** when Phase 12 was merged, crashing infra role provisioning. **Fixed** (values generated).
- Infra now brings up **8/8 healthy**.

### Build health
| Gate | Result |
|---|---|
| Backend `mvn -DskipTests package` | ✅ **PASS** — 20/20 modules, 0 errors |
| Frontend `tsc --noEmit` | ✅ **PASS** |
| Frontend `next build` | ✅ **PASS** — 51 routes |
| `pnpm lint` | ❌ **FAIL** — 12 errors, 20 warnings |
| `prettier --check` | ❌ **FAIL** — 223 files |
| E2E typecheck | ❌ FAIL — 1 error (`pos-settlement.spec.ts:319`) |

**CI is red**, but only at the `lint` job — and every other job declares `needs: [lint]`, so the whole pipeline is blocked on style. 4 of the 12 lint errors are violations of the project's *own* layer-boundary rule.

Two CI gaps worth naming: coverage gates are **silently inert** for finance/inventory/pos/purchasing/kitchen (they declare thresholds but no JaCoCo plugin, so the gate script skips them — 614 of 868 tests ungated); and the image matrix builds **8 of 20** deployables (inventory, nlq, notification, reporting have no Dockerfile at all).

---

## 2. Findings by area

### 2.1 Authentication & passwords
- **No change-password endpoint exists.** Repo-wide.
- Reset-by-email exists and is well built (SHA-256-hashed token, single-use, 30-min TTL, history of last 5, no account enumeration) but is **dead end-to-end**: `notification-service` has **zero source files**, so no consumer ever sends the email.
- 🔴 **Security:** the raw reset token is written **in plaintext** into the `outbox` table alongside the hashed copy — defeating the hashing for anyone with DB/backup/replica read access.
- `must_change_password` is **dead code** — written at provisioning, read nowhere. Provisioned admins keep a temp password forever, and that password is returned in cleartext by the provisioning service then **discarded by the controller**, so nobody ever receives it.
- **No password UI at all.** The entire frontend has one auth route: `/login`.
- Password policy is length-only (`@Size(min=8)`) on a single DTO. bcrypt cost 12 ✅, lockout ✅, but reset requests have **no per-account throttle** and issue unlimited concurrently-valid tokens.
- Reset does **not** clear the login lockout — a user who resets is still locked out with no explanation.

### 2.2 SuperAdmin / platform admin
Backend ≈70% built, **0% reachable** (see B1). Frontend is a **23-line placeholder**.
- ✅ Real: provisioning saga w/ compensation, suspend/reactivate/cancel, per-tenant feature toggle with correct dual-key Redis invalidation, gateway + `@RequiresFeature` enforcement.
- ❌ Missing: **edit tenant**, **change tier/subscription** (tier is write-once — the `X-Upgrade-CTA-URL` on every `FEATURE_DISABLED` leads nowhere), billing/expiry/renewal (columns exist but are never read or written), telemetry read surface, platform-user management, provisioning retry (the method exists but no controller maps it).
- 🔴 **Impersonation logs the wrong actor** — `impersonate(tenantId, targetUserId, targetUserId, reason)` passes the *target* as the admin id, so `impersonation_log.platform_user_id` and the JWT `impersonated_by` claim both name the victim. The audit trail cannot answer "who impersonated whom."
- 🔴 **Tenant-status enforcement fails open** — `.defaultIfEmpty("ACTIVE")`. A SUSPENDED tenant is served if Redis is cold. Suspension is the primary non-payment lever.
- `DELETE /tenants/{id}` is a status flip, not a purge — no data removed from any of the 15 databases.
- NLQ quota enforced against a hardcoded 5000 instead of the per-tenant column, so Enterprise tenants are throttled at Starter levels.

### 2.3 Tenant users, roles & branches
- **8 seeded system roles**: OWNER, TENANT_ADMIN, MANAGER, ACCOUNTANT, INVENTORY_MANAGER, CASHIER, KITCHEN_STAFF, FINANCE_VIEWER. **57 permissions.**
- ❌ **No `WAITER` role** — zero hits repo-wide. Table staff must currently be given CASHIER, which carries till open/close.
- 🟠 **`TENANT_ADMIN` cannot administer anything.** It is explicitly denied `rbac.manage` (`WHERE code != 'rbac.manage'`), which is the sole gate on user-role admin *and* branch CRUD. Only `OWNER` can manage users — so "multiple admins per tenant" does not work as you described.
- 🟠 A user can hold **at most one role per branch**; a second active row throws `IncorrectResultSizeDataAccessException` at login. There is no DB constraint preventing it.
- `roleCode` on assignment is **unvalidated free text** — a typo persists and silently yields a permissionless login.
- Default-branch resolution uses a **hardcoded HQ UUID** correct only for the dev seed tenant.
- **No tenant-admin UI exists** — no users, roles, or branches page. The "Users" nav item is hardcoded `comingSoon: true` pointing at a route that doesn't exist.
- **No per-role dashboard routing** — every role lands on the same `/app/dashboard`. KITCHEN_STAFF sees a POS/finance shell with everything filtered away.

### 2.4 POS terminals, KDS & BDS
**What already works (a genuinely good foundation):**
- Stations are a real, branch-scoped, admin-CRUD-able entity, and routing is **per menu item → station**, one ticket per `(order, station)`, revision-aware.
- The KDS board is station-isolated with a per-station WebSocket, and `ORDER_READY` fires only once *every* station's ticket is ready.
- `station_code` is an **opaque string** — so a `BAR` station renders on the existing board today with zero code changes.

**What does not exist:**
- ❌ **No terminal / register / device entity.** No registry, naming, pairing, or per-device config. "Multiple POS under one tenant" is unsupported.
- ❌ **No link from an order to the POS it came from** — only `cashier_id` / `till_session_id`. No channel/source field.
- ❌ `uq_open_till_per_cashier` allows **one open till per cashier per tenant** — a cashier cannot run two drawers, and tills cannot bind to a register.
- ❌ Per-terminal order numbering — `order_sequences` is keyed `(tenant, branch, business_date)`, so two registers contend on one counter row.
- ❌ **BDS does not exist in any form.** "BAR"/"DRINKS" appear only as test fixtures.
- ❌ **No station admin UI and no menu-item→station picker** — the backend CRUD exists and is completely unused by the frontend. *Lowest-effort, highest-value item in this whole section.*
- ❌ Per-branch routing for a shared menu item is structurally impossible: `menu_items` is tenant-scoped while `stations` is branch-scoped.
- 🔴 **The KDS WebSocket never validates the branch claim** (the POS socket does) — any `pos.kds.view` holder can subscribe to any branch's stream.

### 2.5 Reporting
Real, not stubbed — but a **thin sales-and-tax slice**, not an ERP suite. The warehouse ingests **3 of 22 domain events**.
- ✅ Real: 7 sales/till/purchase reports, FBR tax summary, 4 live dashboard tiles with genuine WebSocket push, AP & AR aging, GL balances (a trial balance in substance), purchasing spend analytics.
- ✅ NLQ is real end-to-end — Anthropic Messages API, real schema prompt, 7-stage AST validation that injects tenant/branch predicates, and a `readonly=1` ClickHouse user. **Caveat:** `ANTHROPIC_API_KEY` is empty, so the live round-trip has never been proven.
- ❌ **Missing outright: P&L, Balance Sheet, COGS/gross margin, stock valuation, daily cash-up/Z-report, payment/tender mix, sales-by-category, wastage report, and any export (CSV/PDF/Excel) whatsoever.** A JE page advertises "E to export" over an empty handler.
- **Root cause:** 19 of 22 events never reach analytics. Without a `journal_facts` table, P&L and balance sheet cannot be built at all.

### 2.6 Frontend / UI-UX
48 pages. The architecture is better than the surface: a clean 4-layer data flow enforced by a custom ESLint rule, and a genuinely strong 3-layer nav gating system.

🔴 **The dominant defect is that errors render as empty states.** Only **7 of 48 pages** check `isError`, and pages default to `data ?? []`. Real consequences:
- POS till fetch fails → the cashier is told **"Your till is closed."**
- KDS fetch fails → an empty board, indistinguishable from a quiet kitchen.
- AP/AR aging outage → **"No outstanding payables."**
- Order suggestions failure → **"Nothing needs ordering"** during a stockout.
- `inventory/coverage` **hangs on "Loading…" forever** on error; `reports/[code]` renders **literally nothing**.

🔴 **No backstop:** zero `error.tsx`, `loading.tsx`, `not-found.tsx`, and **zero error boundaries** — any render throw white-screens the app.

🔴 **Silent data loss in POS:** `handleSendToKitchen` has `try/finally` with **no `catch`**, and clears the cart *before* firing to the kitchen. A fire failure leaves the cashier with an empty cart, no error, and an order the kitchen never received.

**Design-system debt (why it "has no sense"):**
- Tokens cover color + radius only — **no spacing, typography, elevation, or z-index scale.** This is precisely why 38 pages hand-type their own `<h1>` (split 23× `text-2xl` / 16× `text-xl`) and root spacing varies 6 ways.
- **45 native `<select>`** across 25 files with 5 competing class strings — no `Select` primitive.
- **26 hand-rolled `<table>`** vs 4 using the existing `DataTable`. Pagination is effectively absent.
- **7 competing badge components**, 4 competing stat-cards, 2 empty-states.
- Theme consistency is **~26% done**: 230 raw-palette occurrences vs 60 `dark:` variants; KDS files have **zero**.
- Tenant branding overrides only `--primary`, and the brand *name* comes from one global env var — every tenant would see the same name.
- **38 of 48 pages have zero responsive classes**, on a product that ships a mobile bottom nav.
- Accessibility: zero `scope="col"`, zero `<caption>`, sort headers are mouse-only, POS qty ± buttons are 32px on a touch-first product.
- Dead links to `/app/settings` and `/settings/profile` from three ungated surfaces (mobile nav, ⌘K palette, profile menu).

---

## 3. Recommended sequence

**Phase A — Make it reachable (blockers B1–B3).** SuperAdmin auth path; fix the provisioning saga (`auth_tenants` row + OWNER branch-role + `isHq` + branch-id parsing + surface the temp password); user CRUD; change-password + admin reset; `WAITER` role; grant `TENANT_ADMIN` real admin rights; role catalog endpoint. Then a comprehensive seed script.

**Phase B — Minimum trustworthy UI.** `QueryBoundary` primitive so an error can never render as an empty state (one fix, 41 pages), `error.tsx`/`loading.tsx`/`not-found.tsx`, the POS `catch` bug, tenant-admin users page, password pages, platform tenants page.

**Phase C — UI/UX revamp.** Tier 0 tokens → Tier 1 layout primitives (`PageHeader`, `PageShell`, `ModuleTabs` — highest leverage, 38 pages) → Tier 2 form/data primitives (`Select`, `Table`, one `StatusBadge`, one `StatCard`) → per-role dashboards.

**Phase D — Multi-POS + KDS/BDS.** New `pos_terminals` entity; `orders.terminal_id` + `orders.source`; `menu_item_station_routes` join table for per-branch routing; `stations.station_type` (KITCHEN/BAR/EXPO); terminal-aware till constraint (**breaking index swap — needs a data migration plan**); station + terminal admin UI; BDS route reusing the existing board. *Cheap 80% available first: `station_type` + station admin UI + menu-item→station picker.*

**Phase E — ERP reporting completeness.** `journal_facts` + inventory fact tables and their consumers, then P&L, balance sheet, COGS, stock valuation, Z-report, tender mix, and export.

**Cross-cutting, do early:** fix the 12 lint errors + Prettier to unblock CI; build `notification-service` (it is an empty stub blocking all email); redact the reset token from the outbox; fix impersonation actor logging; make tenant-status fail closed; add the KDS WebSocket branch check.

---

## 4. Note on documentation accuracy

`.planning/phases/03-*/03-VERIFICATION.md` scores Phase 3 **24/24 passed**, but cites a `PlatformTenantController` retry endpoint that does not exist and describes `redis.delete()` where the code uses `redis.set()`. Its verification was structural/grep-based — which is why B1 (no reachable auth path) went undetected. Several phases are marked complete on the same basis. **Recommend treating structural verification as insufficient going forward** and requiring a live end-to-end call per success criterion.
