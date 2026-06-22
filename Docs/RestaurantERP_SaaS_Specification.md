# RestaurantOS — Multi-Tenant SaaS ERP Platform

## Product Requirements & Technical Specification

| | |
|---|---|
| **Document version** | 1.0 |
| **Status** | Final draft for review |
| **Audience** | Product, Engineering, QA, DevOps |
| **Classification** | Internal |

---

# Table of Contents

- P0. Executive Summary & Product Vision
- P1. Personas & User Hierarchy
- P2. Multi-Tenancy & SaaS Model
- P3. White-Label Capabilities
- P4. System Architecture
- P5. Technology Stack
- P6. Data Architecture & Tenant Isolation Strategy
- P7. Authentication & Authorization
- M1. POS & Order Management
- M2. Inventory Management
- M3. Financial System
- M4. Vendor & Supply Chain
- M5. Reporting & Analytics
- M6. Natural Language Query Interface
- M7. Multi-Branch Architecture & Granular RBAC
- M8. HR & Payroll
- M9. CRM & Loyalty
- M10. Kitchen Display System
- M11. Notification Service
- M12. Audit & Compliance
- CC. Cross-Cutting Concerns
- D1. Deployment & DevOps
- D2. Testing Strategy
- Appendix A. API Contract Conventions
- Appendix B. Complete Permission Catalogue
- Appendix C. Subscription Tiers & Feature Flags
- Appendix D. Event Catalogue
- Appendix E. Phased Delivery Roadmap

---

# P0. Executive Summary & Product Vision

## P0.1 Product Vision

RestaurantOS is a **white-label, multi-tenant SaaS ERP platform** purpose-built for the restaurant industry. A single platform deployment serves as the operational backbone for any number of restaurant businesses (tenants) — from independent single-branch cafes to large franchise chains with dozens of locations. Each tenant receives a fully isolated, branded experience with the modules appropriate to their subscription tier.

The platform operator (Praivox, running as SuperAdmin) manages the entire tenant lifecycle: onboarding, feature entitlements, subscription limits, and support escalation. Restaurant owners (Tenant Admins) manage their business and branches without ever knowing or caring about the underlying shared infrastructure.

This is not a project for one client. It is a product that generates recurring revenue.

## P0.2 What Makes This Different from Single-Tenant ERPs

Single-tenant ERP systems are deployed once, for one client, on client hardware. RestaurantOS inverts every assumption:

- **Infrastructure is ours.** Deployed on cloud. Clients access it via browser and mobile.
- **Billing is recurring.** Monthly per-branch SaaS fee, gated by tier.
- **Customisation is bounded.** Clients configure (not code) their experience.
- **Data isolation is enforced** at every layer — not just by convention.
- **We ship updates continuously** without client downtime or change orders.

## P0.3 Core Value Proposition

| Persona | Value |
|---|---|
| SuperAdmin | Single pane of glass for all tenants, usage telemetry, billing control, zero-touch tenant provisioning |
| Restaurant Owner | Complete visibility of every branch, real-time financials, AI-powered querying, mobile access |
| Branch Manager | Shift-level operations, purchasing, inventory, staff management |
| Cashier | Fast, offline-capable POS with guided flows |
| Chef / Kitchen | KDS with priority queuing, recipe reference |
| Accountant | Double-entry GL, FBR/tax reporting, three-way match, period close |

## P0.4 Seven Core Modules (Required in All Tiers)

Every tenant subscription includes:

1. POS & Order Management
2. Inventory Management
3. Financial System (GL, AP/AR, COGS)
4. Vendor & Supply Chain
5. Reporting & Analytics
6. Natural Language Query Interface
7. Multi-Branch Architecture & Granular RBAC

Additional modules (HR, CRM, KDS, Notifications, Audit) are gated by subscription tier.

## P0.5 Scope Statement

**In scope:**
- Multi-tenant SaaS platform with SuperAdmin layer
- White-label branding per tenant
- All 7 core modules plus 5 supplementary modules
- Mobile-responsive web application (no native apps in v1)
- REST + WebSocket APIs for all services
- AI-powered NLQ via Anthropic Claude API
- Offline-capable POS via Service Worker
- Full observability stack (Prometheus, Grafana, ELK)

**Out of scope (v1):**
- Native iOS/Android apps
- Third-party delivery platform API integrations (Foodpanda, Careem) — planned v2
- Franchise royalty billing / intercompany accounting
- Payroll direct bank transfer (IBFT) automation
- Custom report builder (NLQ covers ad-hoc; named reports cover standard)

---

# P1. Personas & User Hierarchy

## P1.1 Platform Hierarchy

```
┌─────────────────────────────────────────────────────┐
│                  PLATFORM LAYER                      │
│   SuperAdmin(s)  —  Praivox / Platform Operator     │
│   Manages: tenants, billing, features, support      │
└────────────────────┬────────────────────────────────┘
                     │ provisions
          ┌──────────┴──────────┐
          │     TENANT A        │        TENANT B ...
          │  (Restaurant Chain) │
          │  Tenant Admin       │
          │  Manages: branches, │
          │  users, modules     │
          │                     │
          │  ┌───────────────┐  │
          │  │   Branch 1    │  │
          │  │   Branch 2    │  │
          │  │   Branch N    │  │
          │  └───────────────┘  │
          └─────────────────────┘
```

## P1.2 Personas

### SuperAdmin
The platform operator. Has no direct restaurant operations role. Key jobs:
- Provision and deactivate tenants.
- Set subscription tier and feature flags per tenant.
- Set per-tenant usage limits (branches, users, storage, NLQ queries).
- Impersonate a Tenant Admin for support (audited).
- View platform-wide telemetry: total tenants, MAU, API call volume, error rates.
- Manage platform-wide announcements and maintenance windows.
- Configure global settings: base currency options, supported locales, etc.

There may be multiple SuperAdmins with their own sub-roles (support, billing, technical).

### Tenant Admin (Owner)
The restaurant business owner or their designate. Typically one per legal entity.
- Configure the tenant's branding (white-label logo, colour palette, receipt header).
- Manage all branches under their account.
- Create and assign Branch Managers and other staff.
- Set subscription-level feature toggles within what their tier allows.
- Access consolidated reports across all branches.
- Manage subscription and billing information.
- Approve high-value purchases and financial closings.

### Branch Manager
Operational lead for a single branch (or multiple branches if assigned).
- Manage branch-level staff rosters, shifts, and attendance.
- Approve purchase orders up to their authorised limit.
- View branch P&L, inventory, and vendor payables.
- Run branch-level reports.
- Handle escalated POS issues (voids, refunds).

### Cashier
Front-of-house, POS-primary.
- Take orders (dine-in, takeaway, delivery).
- Process payments.
- Open and close till sessions.
- Basic order modifications within permitted bounds.

### Chef / Kitchen Staff
Kitchen-primary, limited system access.
- View and interact with Kitchen Display System.
- Acknowledge and mark orders ready.
- View recipe cards for items in prep.
- Record wastage.

### Inventory Manager
Receives deliveries, manages stock.
- Manage ingredients, recipes, and BOMs.
- Receive purchase orders (goods receipt notes).
- Perform stock counts.
- Initiate inter-branch transfers.

### Accountant
Finance-primary, no POS access.
- Post manual journal entries.
- Book vendor invoices and approve three-way match overrides.
- Perform bank reconciliation.
- Execute period close.
- Export FBR/tax reports.

### HR Manager
People-primary.
- Manage employee records, contracts, leaves.
- Process payroll runs.
- Generate payslips.

---

# P2. Multi-Tenancy & SaaS Model

## P2.1 Tenancy Strategy

RestaurantOS uses a **shared-infrastructure, row-isolated multi-tenancy** model. All tenants share the same application services and database cluster. Every domain entity carries a `tenant_id` column. All service queries automatically apply a `tenant_id` filter enforced at the ORM layer — not by developer convention.

This is chosen over schema-per-tenant or database-per-tenant because:
- Schema-per-tenant works at tens of tenants; we target hundreds to thousands.
- Migrations become operationally unmanageable per schema at scale.
- Row isolation with strict ORM enforcement and RLS on Postgres is sufficient and proven (Stripe, Shopify).

PostgreSQL **Row-Level Security (RLS)** is enabled as a defence-in-depth layer on all operational tables. Even a raw DB connection cannot read another tenant's rows without the session variable `app.current_tenant_id` being set to the correct value.

## P2.2 Tenant Lifecycle States

```
PENDING_SETUP
    |
    v
ACTIVE -----> SUSPENDED (non-payment / policy violation)
    |               |
    v               v
CANCELLED      REACTIVATED --> ACTIVE
    |
    v
PURGED (30-day grace after cancel; data permanently deleted)
```

State transitions are driven by:
- SuperAdmin action (manual suspend, reactivate, cancel).
- Billing system webhook (payment failure triggers suspension after 7-day grace).
- Automated purge job 30 days after cancellation.

## P2.3 Tenant Provisioning Flow

SuperAdmin triggers "New Tenant" from the Platform Admin UI:
1. Enter tenant details: company name, primary contact, email, country, subscription tier.
2. System generates a unique `tenant_id` (UUID).
3. System provisions:
   - A tenant record in `platform_db.tenants`.
   - Default feature flags based on the selected tier.
   - A Tenant Admin user with a temporary password.
   - A seed chart of accounts (country-specific template).
   - A default branch (marked as HQ).
4. Tenant Admin receives a welcome email with login URL and setup wizard link.
5. Setup wizard (first login): branding, branch name, timezone, currency, fiscal year.
6. Tenant becomes ACTIVE after setup wizard completion.

Provisioning is fully automated. Total time from SuperAdmin click to tenant ACTIVE: under 60 seconds.

## P2.4 Subscription Tiers

Three publicly sold tiers. SuperAdmin can create custom tiers for enterprise clients.

| Feature | STARTER | GROWTH | ENTERPRISE |
|---|---|---|---|
| Branches | 1 | Up to 5 | Unlimited |
| Users | Up to 10 | Up to 50 | Unlimited |
| Storage (MinIO) | 5 GB | 25 GB | Custom |
| NLQ queries/month | 500 | 2,000 | Custom |
| Core 7 modules | ✅ | ✅ | ✅ |
| HR & Payroll | | ✅ | ✅ |
| CRM & Loyalty | | ✅ | ✅ |
| KDS | ✅ | ✅ | ✅ |
| Advanced Reports | | ✅ | ✅ |
| Consolidated multi-branch | | ✅ | ✅ |
| White-label domain | | ✅ | ✅ |
| API access | | | ✅ |
| Priority support | | | ✅ |
| Custom NLQ model | | | ✅ |
| SLA | Best-effort | 99.5% | 99.9% |

Full feature flag matrix is in Appendix C.

## P2.5 Usage Metering

Every action that counts toward a plan limit is metered in real-time via Redis counters, flushed to `platform_db.usage_records` hourly. The API Gateway checks quota before routing requests to services. Quota-exceeded responses return HTTP 429 with a `X-Quota-Resource` header naming the exhausted resource.

Soft limits: at 80% of quota, tenant admin is notified. At 100%, the feature is blocked with a plan-upgrade CTA.

## P2.6 SuperAdmin Platform Console

A separate application (`/platform/*` routes, guarded by platform JWT with `role=SUPER_ADMIN`) provides:
- **Tenants list** with live status, last login, tier, usage at a glance.
- **Tenant detail**: full config, user list, audit log, usage history, impersonation button.
- **Platform telemetry dashboard**: total DAU, API latency P95, error rate, NLQ spend.
- **Announcement broadcast**: system-wide banners and email blasts.
- **Billing management**: sync with billing system (Stripe or local invoicing), trigger suspension/reactivation.
- **Incident management**: mark a maintenance window, suppress alert noise, communicate status.

Impersonation: a SuperAdmin can "act as" a Tenant Admin to troubleshoot. All actions taken under impersonation are stamped `impersonated_by: <super_admin_id>` in `audit_log`. Impersonation sessions expire in 30 minutes and are non-renewable without re-authenticating.

---

# P3. White-Label Capabilities

## P3.1 What Tenants Can Customise

| Asset | Where Configured | Storage |
|---|---|---|
| Company/brand name | Tenant settings | `tenants.brand_name` |
| Logo (light/dark variant) | Tenant settings — upload | MinIO |
| Primary/accent colour palette | Tenant settings (hex codes) | `tenants.theme_config JSONB` |
| Favicon | Tenant settings — upload | MinIO |
| Custom domain (e.g., `erp.lume.pk`) | Tenant settings + DNS CNAME | Platform nginx |
| Email sender name + address | Tenant settings | `tenants.email_config JSONB` |
| Email template header/footer | Tenant settings | MinIO (HTML template) |
| Receipt header, footer, logo | Branch settings | `branches.receipt_config JSONB` |
| Invoice template | Finance settings | MinIO |
| Application language | Per-user preference | `users.locale` |
| Currency display format | Branch settings | `branches.currency_config JSONB` |

Colour palette is applied via CSS custom properties injected at app boot, resolved per tenant from a CDN-cached endpoint.

## P3.2 Custom Domain Support

Each GROWTH/ENTERPRISE tenant can point a custom subdomain at the platform:
1. Tenant sets desired domain in settings (e.g., `erp.lume.pk`).
2. Platform displays a CNAME target value to configure with their DNS provider.
3. Platform verifies DNS propagation via TXT record challenge.
4. Platform's Nginx configuration hot-reloads with the new virtual host, serving a Let's Encrypt TLS cert via certbot DNS-01 challenge.
5. All subdomain requests carry the tenant's domain in the Host header; the API Gateway resolves `tenant_id` from it.

The default URL for tenants without a custom domain is `{tenant_slug}.restaurantos.io`.

## P3.3 What Cannot Be Customised

To maintain platform integrity:
- Page layout and navigation structure (white-label, not fully bespoke).
- Core workflow logic (e.g., double-entry bookkeeping rules cannot be toggled off).
- Data model (no custom fields in v1 — planned v2 feature).
- Security policies (password rules, session length).

---

# P4. System Architecture

## P4.1 Architecture Pattern

RestaurantOS uses a **microservices architecture** organised into bounded domains. Each service:
- Owns its own database (no cross-service DB joins).
- Communicates synchronously via REST through the API Gateway (service-to-service via OpenFeign).
- Communicates asynchronously via RabbitMQ for events that cross service boundaries.
- Is independently deployable and horizontally scalable.

```
                    ┌────────────────────────────────────────┐
                    │           CLIENT LAYER                 │
                    │   Next.js SPA  |  Mobile Browser       │
                    └──────────────┬─────────────────────────┘
                                   │ HTTPS / WSS
                    ┌──────────────▼─────────────────────────┐
                    │     SPRING CLOUD GATEWAY               │
                    │  JWT validation, rate limit, routing   │
                    │  CORS, request logging, quota check    │
                    └──┬──────┬──────┬───────┬──────┬────────┘
                       │      │      │       │      │
           ┌───────────┘   ┌──┘   ┌──┘   ┌──┘   ┌──┘
           ▼               ▼      ▼      ▼      ▼
  ┌──────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
  │ Auth Service │ │ User Svc │ │ POS Svc  │ │ Inv. Svc │ ...
  │   :8081      │ │  :8082   │ │  :8084   │ │  :8085   │
  └──────┬───────┘ └──────────┘ └──────────┘ └──────────┘
         │
  ┌──────▼───────┐    ┌──────────────────────────────────────┐
  │   OPA        │    │              RabbitMQ                │
  │  :8181       │    │  order.closed, stock.depleted,       │
  │  (AuthZ)     │    │  invoice.booked, payroll.run ...     │
  └──────────────┘    └──────────────────────────────────────┘
                               │
       ┌───────────────────────┼──────────────────────┐
       ▼                       ▼                      ▼
┌─────────────┐       ┌──────────────┐       ┌──────────────┐
│ Finance Svc │       │ Notif. Svc   │       │ Audit Svc    │
└─────────────┘       └──────────────┘       └──────────────┘
```

## P4.2 Service Inventory

| Service | Port | DB | Primary Consumers |
|---|---|---|---|
| Platform Admin Service | 8080 | platform_db | SuperAdmin UI only |
| Auth Service | 8081 | auth_db | API Gateway, all |
| User Service | 8082 | user_db | All services (OpenFeign) |
| Authorization Service (OPA wrapper) | 8083 | auth_db | API Gateway, all |
| POS Service | 8084 | pos_db | POS UI, Kitchen |
| Inventory Service | 8085 | inventory_db | POS, Finance, Purchasing |
| Finance Service | 8086 | finance_db | Vendor, Inventory, HR |
| Purchasing Service | 8087 | purchasing_db | Inventory, Finance |
| HR Service | 8088 | hr_db | Finance (payroll JEs) |
| CRM Service | 8089 | crm_db | POS, Notification |
| Kitchen Service | 8090 | kitchen_db | POS, KDS UI |
| Notification Service | 8091 | notification_db | All (via RabbitMQ) |
| Reporting Service | 8092 | ClickHouse | Reporting UI |
| Audit Service | 8093 | audit_db | All (via RabbitMQ) |
| NLQ Service (Python FastAPI) | 8094 | Read-only + Claude API | Reporting UI |
| File Service | 8095 | MinIO + file_db | All services |

## P4.3 API Gateway (Spring Cloud Gateway)

Responsibilities:
- **TLS termination** (or pass-through to cert manager).
- **JWT validation** — every request carries an access token; gateway verifies signature and expiry before routing.
- **Tenant resolution** — extracts `tenant_id` from JWT or custom domain host header; propagates as `X-Tenant-Id` header.
- **Rate limiting** — per-tenant and per-IP via Redis token bucket.
- **Quota enforcement** — checks Redis quota counters; blocks at 100% quota.
- **CORS handling** — per-tenant allowed origins.
- **Request/response logging** — structured logs with `trace_id`, `tenant_id`, `user_id`, latency.
- **Circuit breaking** — per-service circuit breaker (Resilience4j).
- **Routing** — path-prefix based routing to upstream services.

The gateway does NOT perform fine-grained authorisation (that is OPA's job). It performs coarse structural checks only.

## P4.4 Service Discovery & Config

**Service Discovery:** Eureka Server for dev and staging. In production Kubernetes, native DNS-based discovery replaces Eureka (services register by their K8s Service name).

**Configuration:** Spring Cloud Config Server backed by a private Git repository. Config is environment-specific (dev/staging/prod) and encrypted using Spring Vault or K8s Secrets. Services fetch config at startup; dynamic refresh via Spring Cloud Bus on `POST /actuator/refresh` broadcast.

## P4.5 Event-Driven Communication

RabbitMQ serves as the event backbone. Key design decisions:
- **Topic exchanges** per domain (`pos.topic`, `inventory.topic`, `finance.topic`).
- **Durable queues** — events are persisted to disk.
- **Dead-letter queues (DLQ)** for every consumer queue — failed messages do not silently drop.
- **Idempotency** — consumers track processed event IDs to handle re-delivery.
- All events carry: `eventId`, `eventType`, `tenantId`, `occurredAt`, `correlationId`, `payload`.

Kafka migration path: when any service exceeds ~10,000 events/hour sustained or when replay requirements emerge, RabbitMQ is replaced with Kafka for that domain. The event schema is the same; only the client library changes.

## P4.6 Synchronous Service-to-Service Communication

OpenFeign clients with:
- Resilience4j circuit breakers and rate limiters per upstream.
- `X-Tenant-Id` and `X-Correlation-Id` headers propagated on all calls.
- Timeouts: connect 2s, read 10s (except NLQ: read 30s).
- Retry: once on 503, no retry on 4xx.

Services never call the API Gateway to reach another service — they call each other directly via Eureka-resolved URLs.

---

# P5. Technology Stack

## P5.1 Frontend

| Concern | Choice | Rationale |
|---|---|---|
| Framework | Next.js 16+ (App Router, Turbopack) + React 19 | SSR for initial load performance; RSC for server-side data fetching without waterfalls. Next.js 16 requires Node.js 20+; request APIs (`cookies()`, `headers()`, `params`, `searchParams`) are async-only |
| Language | TypeScript 5.x (strict mode) | Type safety end-to-end; strict mode catches API contract drift at compile time |
| Styling | Tailwind CSS 4.x | Utility-first; CSS-first config (`@import "tailwindcss"` + `@theme` in `globals.css`, NO `tailwind.config.js`); trivial to theme per tenant via CSS custom properties |
| Component library | shadcn/ui (Radix primitives) | Accessible, unstyled at the primitive level, easy to override for white-label |
| Forms | React Hook Form + Zod | Performant form state; Zod schemas shared across form validation AND API response parsing |
| Server state | TanStack Query v5 | Caching, background refetch, optimistic updates, stale-while-revalidate |
| Client state | Zustand | Simple non-boilerplate global state (auth context, branch context, cart, offline queue) |
| Tables | TanStack Table v8 | Headless, composable, handles large datasets with virtualisation |
| Charts | Recharts | Composable, works with Tailwind |
| Realtime | Native WebSocket with reconnect wrapper | Dashboard tiles, KDS updates |
| Offline POS | Workbox Service Worker + IndexedDB | Cashier flow continues on LAN disconnect |
| API contract testing | MSW (Mock Service Worker) | Intercepts fetch in tests; validates request/response contracts |
| i18n | next-intl | Message extraction, locale routing |

## P5.2 Frontend API Abstraction Architecture

This section is a first-class architectural concern. As RestaurantOS is a long-lived SaaS product, the backend API will evolve: endpoints rename, response shapes change, new required fields are added. Without a proper abstraction boundary, every such change requires a scattered find-and-replace across React components.

The architecture enforces a **strict four-layer boundary** between the UI and the API:

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 4 — UI Components                                        │
│  React components. Never touch fetch(), axios, or raw API data. │
│  Consume domain models via custom hooks only.                   │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 3 — Query/Mutation Hooks                                 │
│  TanStack Query useQuery / useMutation wrappers.                │
│  One hook per operation. Handles loading, error, cache keys.    │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 2 — Repository Classes                                   │
│  Domain-scoped classes (OrderRepository, InventoryRepository).  │
│  Call API Client; parse and adapt responses to domain models.   │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 1 — API Client                                           │
│  Single axios instance. Handles auth headers, tenant context,   │
│  error normalisation, retry, and request/response logging.      │
└─────────────────────────────────────────────────────────────────┘
```

A UI component is never allowed to import from a layer below Layer 3. This is enforced by an ESLint rule (`no-restricted-imports` targeting `lib/api-client` and `lib/repositories/*` from `components/*`).

### P5.2.1 Layer 1 — API Client

One shared axios instance, configured once. All HTTP knowledge lives here.

```typescript
// lib/api-client/client.ts
import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from "axios";
import { getSession, refreshSession } from "@/lib/auth/session";
import { ApiError, parseApiError } from "./errors";

function createApiClient(): AxiosInstance {
  const client = axios.create({
    baseURL: process.env.NEXT_PUBLIC_API_BASE_URL,
    timeout: 30_000,
    headers: { "Content-Type": "application/json" },
  });

  // --- Request interceptor: inject auth + tenant context ---
  client.interceptors.request.use(async (config) => {
    const session = await getSession();
    if (session?.accessToken) {
      config.headers["Authorization"] = `Bearer ${session.accessToken}`;
    }
    // Trace ID for every request — correlates with server logs
    config.headers["X-Request-Id"] = crypto.randomUUID();
    return config;
  });

  // --- Response interceptor: normalise errors ---
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      // Transparent token refresh on 401
      if (error.response?.status === 401 && !isRetry(error.config)) {
        const refreshed = await refreshSession();
        if (refreshed) {
          return client(markRetry(error.config!));
        }
        // Refresh failed: redirect to login
        window.location.href = "/auth/login?reason=session_expired";
        return Promise.reject(error);
      }

      // Normalise all API errors into a typed ApiError
      return Promise.reject(parseApiError(error));
    }
  );

  return client;
}

export const apiClient = createApiClient();
```

```typescript
// lib/api-client/errors.ts
// A single typed error class. Components never inspect raw axios errors.
export class ApiError extends Error {
  constructor(
    public readonly code: string,         // e.g. "VALIDATION_FAILED"
    public readonly message: string,
    public readonly status: number,
    public readonly details?: FieldError[],
    public readonly traceId?: string
  ) {
    super(message);
    this.name = "ApiError";
  }

  isQuotaExceeded() { return this.code === "QUOTA_EXCEEDED"; }
  isPermissionDenied() { return this.code === "PERMISSION_DENIED"; }
  isValidationFailed() { return this.code === "VALIDATION_FAILED"; }
  isStateInvalid() { return this.code === "STATE_INVALID"; }
}

export interface FieldError {
  field: string;
  issue: string;
}

export function parseApiError(error: AxiosError): ApiError {
  const data = error.response?.data as any;
  return new ApiError(
    data?.error?.code ?? "INTERNAL_ERROR",
    data?.error?.message ?? "An unexpected error occurred.",
    error.response?.status ?? 0,
    data?.error?.details,
    data?.error?.trace_id
  );
}
```

```typescript
// lib/api-client/request.ts
// Typed wrappers so all calls have consistent return shapes.
import { apiClient } from "./client";
import { ApiPaginatedResponse, ApiSingleResponse } from "./types";

export async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const { data } = await apiClient.get<ApiSingleResponse<T>>(url, { params });
  return data.data;
}

export async function getPaginated<T>(
  url: string,
  params?: Record<string, unknown>
): Promise<ApiPaginatedResponse<T>> {
  const { data } = await apiClient.get<ApiPaginatedResponse<T>>(url, { params });
  return data;
}

export async function post<TBody, TResponse>(url: string, body: TBody, config?: AxiosRequestConfig): Promise<TResponse> {
  const { data } = await apiClient.post<ApiSingleResponse<TResponse>>(url, body, config);
  return data.data;
}

export async function patch<TBody, TResponse>(url: string, body: Partial<TBody>): Promise<TResponse> {
  const { data } = await apiClient.patch<ApiSingleResponse<TResponse>>(url, body);
  return data.data;
}

export async function del<TResponse = void>(url: string): Promise<TResponse> {
  const { data } = await apiClient.delete<ApiSingleResponse<TResponse>>(url);
  return data.data;
}
```

```typescript
// lib/api-client/types.ts
// Envelope types matching the backend standard (Appendix A)
export interface ApiSingleResponse<T> {
  data: T;
  warnings?: ApiWarning[];
}

export interface ApiPaginatedResponse<T> {
  data: T[];
  meta: {
    page: {
      cursor: string | null;
      next_cursor: string | null;
      limit: number;
    };
    total_count?: number;
  };
  warnings?: ApiWarning[];
}

export interface ApiWarning {
  code: string;
  message: string;
}
```

### P5.2.2 Layer 2 — Repository Classes + Response Adapters

Each domain has a repository class that owns two responsibilities: calling the API and adapting the raw API response to a **frontend domain model**. The domain model is what components see — it is stable even when the API response shape evolves.

This is the key decoupling point. When a backend field renames (`total_paisa` → `grand_total_paisa`), only the adapter changes — zero component changes.

```typescript
// lib/repositories/order.repository.ts
import { get, getPaginated, post, patch } from "@/lib/api-client/request";
import {
  Order,
  OrderListItem,
  CreateOrderBody,
  CloseOrderBody,
  OrderFilters,
} from "@/lib/models/order.model";
import {
  ApiOrder,
  ApiOrderListItem,
  apiOrderSchema,
  apiOrderListItemSchema,
} from "@/lib/api-client/schemas/order.schema";
import { adaptOrder, adaptOrderListItem } from "@/lib/adapters/order.adapter";
import { ApiPaginatedResponse } from "@/lib/api-client/types";

export class OrderRepository {
  private static base = "/api/v1/orders";

  static async list(
    filters?: OrderFilters
  ): Promise<ApiPaginatedResponse<OrderListItem>> {
    const raw = await getPaginated<ApiOrderListItem>(this.base, filters as any);
    // Parse and validate each item — catches API shape changes at runtime
    const parsed = raw.data.map((item) => apiOrderListItemSchema.parse(item));
    return { ...raw, data: parsed.map(adaptOrderListItem) };
  }

  static async get(id: string): Promise<Order> {
    const raw = await get<ApiOrder>(`${this.base}/${id}`);
    const parsed = apiOrderSchema.parse(raw);   // throws ZodError if shape changed
    return adaptOrder(parsed);
  }

  static async create(body: CreateOrderBody): Promise<Order> {
    const raw = await post<CreateOrderBody, ApiOrder>(this.base, body, {
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    return adaptOrder(apiOrderSchema.parse(raw));
  }

  static async close(id: string, body: CloseOrderBody): Promise<Order> {
    const raw = await post<CloseOrderBody, ApiOrder>(`${this.base}/${id}/close`, body, {
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    return adaptOrder(apiOrderSchema.parse(raw));
  }

  static async void(id: string, reason: string): Promise<Order> {
    const raw = await post<{ reason: string }, ApiOrder>(
      `${this.base}/${id}/void`,
      { reason },
      { headers: { "Idempotency-Key": crypto.randomUUID() } }
    );
    return adaptOrder(apiOrderSchema.parse(raw));
  }
}
```

```typescript
// lib/api-client/schemas/order.schema.ts
// Zod schemas mirroring the API response shape.
// These are the ONLY place that knows about raw API field names.
import { z } from "zod";

export const apiOrderItemSchema = z.object({
  id: z.string().uuid(),
  menu_item_id: z.string().uuid(),
  item_name_snapshot: z.string(),
  unit_price_snapshot: z.number().int(),     // paisa
  quantity: z.number().int().positive(),
  discount_paisa: z.number().int().default(0),
  tax_paisa: z.number().int().default(0),
  line_total_paisa: z.number().int(),
  kds_status: z.enum(["PENDING", "COOKING", "READY"]),
  notes: z.string().nullable().optional(),
});

export const apiOrderSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  order_no: z.string(),
  type: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY"]),
  status: z.enum([
    "DRAFT", "OPEN", "SENT_TO_KDS", "PARTIAL_READY",
    "READY", "SERVED", "CLOSED", "VOIDED", "REFUNDED",
  ]),
  table_id: z.string().uuid().nullable().optional(),
  cover_count: z.number().int().nullable().optional(),
  subtotal_paisa: z.number().int(),
  tax_paisa: z.number().int(),
  discount_paisa: z.number().int(),
  service_charge_paisa: z.number().int(),
  total_paisa: z.number().int(),
  items: z.array(apiOrderItemSchema),
  opened_at: z.string().datetime(),
  closed_at: z.string().datetime().nullable().optional(),
  voided_at: z.string().datetime().nullable().optional(),
  void_reason: z.string().nullable().optional(),
});

export type ApiOrder = z.infer<typeof apiOrderSchema>;
export type ApiOrderListItem = z.infer<typeof apiOrderSchema.pick({
  id: true, order_no: true, type: true, status: true,
  total_paisa: true, opened_at: true,
})>;

export const apiOrderListItemSchema = apiOrderSchema.pick({
  id: true, order_no: true, type: true, status: true,
  total_paisa: true, opened_at: true,
});
```

```typescript
// lib/adapters/order.adapter.ts
// Transforms raw API types into frontend domain models.
// Components only see these stable domain models.
import { ApiOrder } from "@/lib/api-client/schemas/order.schema";
import { Order, OrderItem, Money } from "@/lib/models/order.model";
import { toMoney, toLocalDate } from "@/lib/adapters/shared";

export function adaptOrder(raw: ApiOrder): Order {
  return {
    id: raw.id,
    orderNo: raw.order_no,
    type: raw.type,
    status: raw.status,
    tableId: raw.table_id ?? null,
    coverCount: raw.cover_count ?? null,
    subtotal: toMoney(raw.subtotal_paisa),
    tax: toMoney(raw.tax_paisa),
    discount: toMoney(raw.discount_paisa),
    serviceCharge: toMoney(raw.service_charge_paisa),
    total: toMoney(raw.total_paisa),
    items: raw.items.map(adaptOrderItem),
    openedAt: toLocalDate(raw.opened_at),
    closedAt: raw.closed_at ? toLocalDate(raw.closed_at) : null,
    isVoided: raw.status === "VOIDED",
    isClosed: raw.status === "CLOSED",
  };
}

function adaptOrderItem(raw: ApiOrder["items"][number]): OrderItem {
  return {
    id: raw.id,
    menuItemId: raw.menu_item_id,
    name: raw.item_name_snapshot,
    unitPrice: toMoney(raw.unit_price_snapshot),
    quantity: raw.quantity,
    discount: toMoney(raw.discount_paisa),
    tax: toMoney(raw.tax_paisa),
    lineTotal: toMoney(raw.line_total_paisa),
    kdsStatus: raw.kds_status,
    notes: raw.notes ?? null,
  };
}
```

```typescript
// lib/adapters/shared.ts
// Shared adapter utilities — one place for PKR paisa and date logic.

/** All money in the UI is expressed as a Money object, never raw paisa integers. */
export interface Money {
  paisa: number;
  pkr: number;             // paisa / 100
  formatted: string;       // "PKR 1,234" using Intl
}

export function toMoney(paisa: number): Money {
  const pkr = paisa / 100;
  return {
    paisa,
    pkr,
    formatted: new Intl.NumberFormat("en-PK", {
      style: "currency",
      currency: "PKR",
      minimumFractionDigits: 0,
    }).format(pkr),
  };
}

export function toLocalDate(iso: string): Date {
  return new Date(iso);  // stored UTC; displayed in user's local tz via Intl
}
```

```typescript
// lib/models/order.model.ts
// Frontend domain model. Stable contract for all components.
// Field names are camelCase, money is Money, dates are Date.
import { Money } from "@/lib/adapters/shared";

export type OrderType = "DINE_IN" | "TAKEAWAY" | "DELIVERY";
export type OrderStatus =
  | "DRAFT" | "OPEN" | "SENT_TO_KDS" | "PARTIAL_READY"
  | "READY" | "SERVED" | "CLOSED" | "VOIDED" | "REFUNDED";

export interface Order {
  id: string;
  orderNo: string;
  type: OrderType;
  status: OrderStatus;
  tableId: string | null;
  coverCount: number | null;
  subtotal: Money;
  tax: Money;
  discount: Money;
  serviceCharge: Money;
  total: Money;
  items: OrderItem[];
  openedAt: Date;
  closedAt: Date | null;
  isVoided: boolean;
  isClosed: boolean;
}

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  unitPrice: Money;
  quantity: number;
  discount: Money;
  tax: Money;
  lineTotal: Money;
  kdsStatus: "PENDING" | "COOKING" | "READY";
  notes: string | null;
}

export interface CreateOrderBody {
  type: OrderType;
  tableId?: string;
  coverCount?: number;
}

export interface CloseOrderBody {
  payments: { method: string; amountPaisa: number; referenceNo?: string }[];
}

export interface OrderFilters {
  status?: OrderStatus;
  type?: OrderType;
  cursor?: string;
  limit?: number;
}
```

### P5.2.3 Layer 3 — Query/Mutation Hooks

TanStack Query hooks wrap each repository method. Components consume these hooks — they never call repositories directly. Query keys are centralised in a `queryKeys` registry so cache invalidation is consistent.

```typescript
// lib/hooks/query-keys.ts
// Centralised registry. Change a key here and every hook updates automatically.
export const queryKeys = {
  orders: {
    all: (branchId: string) => ["orders", branchId] as const,
    list: (branchId: string, filters?: object) =>
      ["orders", branchId, "list", filters] as const,
    detail: (id: string) => ["orders", id] as const,
  },
  inventory: {
    ingredients: (branchId: string) => ["inventory", branchId, "ingredients"] as const,
    ingredient: (id: string) => ["inventory", "ingredients", id] as const,
    stockLevels: (branchId: string) => ["inventory", branchId, "stock-levels"] as const,
  },
  menu: {
    categories: (branchId: string) => ["menu", branchId, "categories"] as const,
    items: (branchId: string, categoryId?: string) =>
      ["menu", branchId, "items", categoryId].filter(Boolean) as string[],
  },
  finance: {
    journalEntries: (branchId: string, periodId: string) =>
      ["finance", branchId, "journal-entries", periodId] as const,
    periods: (tenantId: string) => ["finance", tenantId, "periods"] as const,
  },
} as const;
```

```typescript
// lib/hooks/orders/use-order.ts
import { useQuery } from "@tanstack/react-query";
import { OrderRepository } from "@/lib/repositories/order.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useActiveBranch } from "@/lib/hooks/auth/use-active-branch";

export function useOrder(orderId: string) {
  return useQuery({
    queryKey: queryKeys.orders.detail(orderId),
    queryFn: () => OrderRepository.get(orderId),
    staleTime: 30_000,
    enabled: !!orderId,
  });
}
```

```typescript
// lib/hooks/orders/use-close-order.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { OrderRepository } from "@/lib/repositories/order.repository";
import { CloseOrderBody } from "@/lib/models/order.model";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useActiveBranch } from "@/lib/hooks/auth/use-active-branch";
import { useToast } from "@/components/ui/use-toast";
import { ApiError } from "@/lib/api-client/errors";

export function useCloseOrder() {
  const queryClient = useQueryClient();
  const { branchId } = useActiveBranch();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ orderId, body }: { orderId: string; body: CloseOrderBody }) =>
      OrderRepository.close(orderId, body),

    onSuccess: (updatedOrder) => {
      // Update the detail cache immediately
      queryClient.setQueryData(queryKeys.orders.detail(updatedOrder.id), updatedOrder);
      // Invalidate the list so it refetches
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all(branchId) });
      toast({ title: "Order closed", description: `${updatedOrder.orderNo} — ${updatedOrder.total.formatted}` });
    },

    onError: (error: ApiError) => {
      if (error.isStateInvalid()) {
        toast({ variant: "destructive", title: "Cannot close order", description: error.message });
      } else if (error.isPermissionDenied()) {
        toast({ variant: "destructive", title: "Permission denied", description: "You cannot close this order." });
      } else {
        toast({ variant: "destructive", title: "Error", description: error.message });
      }
    },
  });
}
```

### P5.2.4 Layer 4 — UI Components

Components are consumers only. They never import from `lib/api-client` or `lib/repositories`. They receive domain models and call mutation functions from hooks.

```typescript
// components/pos/order-detail.tsx
"use client";
import { useOrder } from "@/lib/hooks/orders/use-order";
import { useCloseOrder } from "@/lib/hooks/orders/use-close-order";
import { OrderStatusBadge } from "@/components/shared/order-status-badge";
import { Money } from "@/lib/models/order.model";

interface OrderDetailProps {
  orderId: string;
}

export function OrderDetail({ orderId }: OrderDetailProps) {
  // Component knows nothing about fetch, axios, or raw API shapes.
  const { data: order, isLoading, error } = useOrder(orderId);
  const closeOrder = useCloseOrder();

  if (isLoading) return <OrderDetailSkeleton />;
  if (error) return <OrderDetailError error={error} />;
  if (!order) return null;

  return (
    <div>
      <h2>{order.orderNo}</h2>
      <OrderStatusBadge status={order.status} />
      <p>Total: {order.total.formatted}</p>
      {/* order.total is always a Money object — never a raw number */}
      <button
        disabled={order.isClosed || order.isVoided || closeOrder.isPending}
        onClick={() =>
          closeOrder.mutate({
            orderId: order.id,
            body: { payments: [{ method: "CASH", amountPaisa: order.total.paisa }] },
          })
        }
      >
        Close Order
      </button>
    </div>
  );
}
```

### P5.2.5 Schema Registry & Runtime Validation

Zod schemas in `lib/api-client/schemas/` are the single source of truth for what the API returns. When the backend changes a response shape, the Zod schema parse step (`apiOrderSchema.parse(raw)`) throws a `ZodError` at runtime. This surfaces in:
- **Development**: logged to console as a schema mismatch, not a silent wrong-data bug.
- **Staging**: GlitchTip captures the error with the offending raw payload, pinpointing the exact changed field.
- **Production**: captured in GlitchTip; a banner is shown to the user ("something went wrong") rather than a silent data corruption.

A CI job runs `tsc --noEmit` on the schemas directory on every PR. Any backend OpenAPI spec change (auto-generated from Spring annotations) triggers a `schema-sync` CI job that diffs the new OpenAPI spec against the Zod schemas and fails the build if any endpoint response has an incompatible change without a corresponding Zod schema update.

```yaml
# .github/workflows/schema-sync.yml
name: API Contract Sync

on:
  push:
    paths:
      - 'backend/**/openapi.yaml'
      - 'frontend/lib/api-client/schemas/**'

jobs:
  check-contracts:
    steps:
      - name: Validate Zod schemas against OpenAPI
        run: npx openapi-to-zod-check --openapi openapi.yaml --zod-dir frontend/lib/api-client/schemas --fail-on-mismatch
```

### P5.2.6 Offline Queue Integration

For POS offline mode, mutations that fail due to network are queued in IndexedDB via a `OfflineQueueRepository` that uses the same shape as the regular repositories:

```typescript
// lib/offline/offline-queue.ts
import { openDB } from "idb";
import { CreateOrderBody, CloseOrderBody } from "@/lib/models/order.model";

interface QueuedMutation {
  id: string;                     // client-generated UUID (becomes Idempotency-Key)
  endpoint: string;
  method: "POST" | "PATCH" | "DELETE";
  body: unknown;
  enqueuedAt: number;
  retryCount: number;
}

const DB_NAME = "restaurantos-offline-queue";

export async function enqueueOfflineMutation(mutation: Omit<QueuedMutation, "enqueuedAt" | "retryCount">) {
  const db = await openDB(DB_NAME, 1, {
    upgrade(db) { db.createObjectStore("mutations", { keyPath: "id" }); },
  });
  await db.put("mutations", { ...mutation, enqueuedAt: Date.now(), retryCount: 0 });
}

export async function flushOfflineQueue() {
  const db = await openDB(DB_NAME, 1);
  const all = await db.getAll("mutations");
  // Sort oldest-first; replay in order
  all.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  for (const mutation of all) {
    try {
      await apiClient.request({
        method: mutation.method,
        url: mutation.endpoint,
        data: mutation.body,
        headers: { "Idempotency-Key": mutation.id },
      });
      await db.delete("mutations", mutation.id);
    } catch (e) {
      // Leave in queue; will retry on next flush
    }
  }
}
```

The Service Worker fires `flushOfflineQueue()` when `navigator.onLine` becomes true.

### P5.2.7 MSW Contract Tests

All hooks are tested using MSW (Mock Service Worker) which intercepts fetch requests at the network layer. This ensures the Zod schemas, adapters, and hooks are all exercised together without a real backend.

```typescript
// __tests__/hooks/use-order.test.tsx
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { useOrder } from "@/lib/hooks/orders/use-order";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";

const server = setupServer(
  http.get("/api/v1/orders/:id", ({ params }) => {
    return HttpResponse.json({
      data: {
        id: params.id,
        order_no: "ORD-20260429-0001",
        type: "DINE_IN",
        status: "OPEN",
        subtotal_paisa: 80000,
        tax_paisa: 5600,
        discount_paisa: 0,
        service_charge_paisa: 0,
        total_paisa: 85600,
        items: [],
        opened_at: "2026-04-29T08:00:00Z",
        tenant_id: "tenant-uuid",
        branch_id: "branch-uuid",
      },
    });
  })
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test("useOrder adapts paisa to Money correctly", async () => {
  const { result } = renderHook(
    () => useOrder("order-uuid"),
    { wrapper: createQueryWrapper() }
  );

  await waitFor(() => expect(result.current.isSuccess).toBe(true));

  const order = result.current.data!;
  expect(order.total.paisa).toBe(85600);
  expect(order.total.pkr).toBe(856);
  expect(order.total.formatted).toMatch(/PKR/);
  expect(order.isClosed).toBe(false);
});
```

When the backend changes `total_paisa` to `grand_total_paisa`, this test fails immediately — the Zod schema parse throws, the test reporter shows the exact field mismatch, and no component code was involved.

### P5.2.8 Repository Conventions

All repository classes follow the same conventions:

| Convention | Rule |
|---|---|
| Naming | `{Domain}Repository`, file: `lib/repositories/{domain}.repository.ts` |
| Schema location | `lib/api-client/schemas/{domain}.schema.ts` |
| Adapter location | `lib/adapters/{domain}.adapter.ts` |
| Model location | `lib/models/{domain}.model.ts` |
| Idempotency-Key | Added automatically on POST methods that create or mutate financial state |
| Error handling | Never catch in repository — let `ApiError` bubble to the hook's `onError` |
| Zod parsing | `.parse()` on every response; never `.safeParse()` silently (surfacing errors is the goal) |
| No side effects | Repositories are pure: call API, parse, adapt, return. No toast, no routing. |

## P5.3 Backend (Java Microservices)

| Concern | Choice | Rationale |
|---|---|---|
| Language / Platform | Java 25 LTS | Virtual threads, record patterns, scoped values; LTS (GA Sept 2025, premier support to 2030) |
| Framework | Spring Boot 4.0.x (Spring Framework 7) | De-facto Java microservice standard; pairs with Spring Cloud 2025.1.x (Oakwood). NOTE: Boot 4.1.0 exists but Spring Cloud's current release train only certifies 4.0.x — bump to 4.1 once Oakwood certifies it |
| Security | Spring Security 7.x | Stateless JWT filter chain per service. Security 7 changes the config DSL (lambda-only `SecurityFilterChain`, renamed `requestMatchers`/authorization APIs) — follow Security 7 patterns, not 6.x |
| ORM | Spring Data JPA + Hibernate 7.x | Hibernate filters for tenant isolation; Criteria API for dynamic queries |
| Multi-tenancy enforcement | Hibernate filters + PostgreSQL RLS | Filter injected automatically; RLS as backstop |
| Validation | Jakarta Bean Validation 3 | Annotation-based; consistent with OpenAPI schema generation |
| Service-to-service | OpenFeign + Resilience4j | Declarative HTTP clients with circuit breaking |
| API docs | SpringDoc OpenAPI 3.1 | Auto-generated from annotations; exported to repo for contract sync |
| Build | Maven 3.9+ | Reproducible; multi-module project per service |
| Testing | JUnit 5, Mockito, Testcontainers | Unit + integration tests |

## P5.4 NLQ Service (Python)

| Concern | Choice |
|---|---|
| Framework | Python 3.14 + FastAPI 0.138+ |
| LLM SDK | `anthropic` (official Python SDK) |
| SQL AST validation | `sqlglot` |
| DB driver | `psycopg[binary]` (psycopg3) for PostgreSQL; `clickhouse-connect` for ClickHouse |
| Cache | Redis 8 |

Registered in Eureka as `nlq-service`. Proxied by the API Gateway. See M6 for full design.

## P5.5 Infrastructure & Data

| Layer | Technology |
|---|---|
| Primary DB | PostgreSQL 18 |
| Cache | Redis 8 |
| Message broker | RabbitMQ 4.3 (quorum queues default; classic mirrored queues removed in 4.x) |
| Object storage | MinIO (S3-compatible) |
| Analytics DB | ClickHouse 25.9 |
| Authorization engine | Open Policy Agent (OPA) 1.17 (Rego v1 is the default dialect) |
| API Gateway | Spring Cloud Gateway 5.x (Spring Cloud 2025.1.x Oakwood) |
| Service discovery | Eureka Server (dev) / K8s DNS (prod) |
| Config management | Spring Cloud Config Server + Git |
| Secrets | HashiCorp Vault (prod) / K8s Secrets (dev) |

## P5.6 Observability

| Concern | Technology |
|---|---|
| Metrics | Micrometer → Prometheus |
| Dashboards | Grafana |
| Distributed tracing | Micrometer Tracing → Tempo |
| Log aggregation | Logstash → Elasticsearch → Kibana |
| Log format | JSON (Logback + Logstash encoder for Java; structlog for Python) |
| Alerting | Grafana Alerting → PagerDuty / email |
| Error tracking | GlitchTip (self-hosted, Sentry-compatible) |

## P5.7 Infrastructure & Delivery

| Concern | Technology |
|---|---|
| Containerisation | Docker + Docker Compose (dev) |
| Orchestration | Kubernetes 1.29+ (prod) |
| Container registry | GitHub Container Registry (GHCR) |
| CI/CD | GitHub Actions |
| Ingress | Nginx Ingress Controller + cert-manager |
| TLS | Let's Encrypt (certbot) |
| IaC | Helm charts per service; umbrella chart for full-stack |

---

# P6. Data Architecture & Tenant Isolation

## P6.1 Database Strategy

Each microservice owns an independent PostgreSQL database on the shared cluster:

| Database | Owner Service |
|---|---|
| `platform_db` | Platform Admin Service — SuperAdmin entities only; no tenant service access |
| `auth_db` | Auth + Authorization Services |
| `user_db` | User Service |
| `pos_db` | POS Service |
| `inventory_db` | Inventory Service |
| `finance_db` | Finance Service |
| `purchasing_db` | Purchasing Service |
| `hr_db` | HR Service |
| `crm_db` | CRM Service |
| `kitchen_db` | Kitchen Service |
| `notification_db` | Notification Service |
| `audit_db` | Audit Service |
| `file_db` | File Service (metadata; blobs in MinIO) |
| `clickhouse_analytics` | Reporting Service (ClickHouse, not Postgres) |

Services must never issue direct SQL to another service's database. All cross-service data access is via REST (OpenFeign) or RabbitMQ events.

## P6.2 Universal Tenant Context — `TenantAuditableEntity`

Every entity in every service database extends a `@MappedSuperclass`:

```java
// shared-lib/src/main/java/io/restaurantos/shared/entity/TenantAuditableEntity.java
@MappedSuperclass
@EntityListeners(AuditingEntityListener.class)
@FilterDef(name = "tenantFilter",
           parameters = @ParamDef(name = "tenantId", type = UUID.class))
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public abstract class TenantAuditableEntity {

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @CreatedDate
    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    @LastModifiedDate
    @Column(name = "updated_at")
    private Instant updatedAt;

    @CreatedBy
    @Column(name = "created_by", updatable = false)
    private UUID createdBy;

    @LastModifiedBy
    @Column(name = "updated_by")
    private UUID updatedBy;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    public boolean isDeleted() { return deletedAt != null; }
}
```

## P6.3 Hibernate Tenant Filter Injection

A `TenantFilterInterceptor` component is registered as a Spring bean in every service. It retrieves `tenant_id` from the request-scoped `TenantContext` (populated by Spring Security from the JWT) and enables the Hibernate filter before any query runs.

```java
@Component
@RequiredArgsConstructor
public class TenantFilterInterceptor implements HandlerInterceptor {

    private final EntityManager entityManager;
    private final TenantContext tenantContext;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        UUID tenantId = tenantContext.requireTenantId();
        Session session = entityManager.unwrap(Session.class);
        session.enableFilter("tenantFilter").setParameter("tenantId", tenantId);
        // Also set for RLS
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
                     .setParameter("tid", tenantId.toString())
                     .getSingleResult();
        return true;
    }
}
```

This interceptor is non-optional — every `@RestController` is covered. A unit test in the shared-lib verifies that the filter is present on all entity classes at CI time.

## P6.4 PostgreSQL Row-Level Security (Defence in Depth)

Applied to every tenant-scoped table across all service databases:

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON orders
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```

The application DB user has no `BYPASSRLS` privilege. Even if the Hibernate filter is bypassed through a bug or a raw JDBC call, RLS prevents reading another tenant's rows.

## P6.5 Platform Database — SuperAdmin Only

`platform_db` is logically and credential-segregated. Only the Platform Admin Service holds its credentials. All other service DB users have no access to `platform_db`.

```sql
-- platform_db key tables (selected)
CREATE TABLE tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL,
  brand_name      TEXT NOT NULL,
  status          TEXT NOT NULL,         -- PENDING_SETUP|ACTIVE|SUSPENDED|CANCELLED|PURGED
  tier            TEXT NOT NULL,         -- STARTER|GROWTH|ENTERPRISE|CUSTOM
  theme_config    JSONB NOT NULL DEFAULT '{}',
  email_config    JSONB NOT NULL DEFAULT '{}',
  billing_ref     TEXT,
  trial_ends_at   TIMESTAMPTZ,
  custom_domain   TEXT,
  domain_verified BOOLEAN NOT NULL DEFAULT FALSE,
  max_branches    INTEGER NOT NULL,
  max_users       INTEGER NOT NULL,
  storage_gb      INTEGER NOT NULL,
  nlq_quota       INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  suspended_at    TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ
);

CREATE TABLE tenant_features (
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  feature_code    TEXT NOT NULL,
  is_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  config_json     JSONB,
  PRIMARY KEY (tenant_id, feature_code)
);

CREATE TABLE platform_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL,         -- SUPER_ADMIN|SUPPORT|BILLING
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE usage_records (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  resource        TEXT NOT NULL,         -- NLQ_QUERY|STORAGE_GB|BRANCH_COUNT|USER_COUNT
  qty             NUMERIC NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE impersonation_log (
  id              BIGSERIAL PRIMARY KEY,
  platform_user_id UUID NOT NULL,
  tenant_id       UUID NOT NULL,
  target_user_id  UUID NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  reason          TEXT NOT NULL
);
```

---

# P7. Authentication & Authorization

## P7.1 Authentication (Auth Service)

### Token Strategy

| Token | Lifetime | Transport | Signed With |
|---|---|---|---|
| Access JWT | 15 minutes | `Authorization: Bearer` header | RS256 private key (Auth Service only) |
| Refresh token | 7 days | HttpOnly, Secure, SameSite=Strict cookie | Opaque row in `auth_db.refresh_sessions` |

Access JWT payload:

```json
{
  "sub": "user-uuid",
  "tenant_id": "tenant-uuid",
  "branch_id": "current-branch-uuid",
  "roles": ["BRANCH_MANAGER"],
  "permissions": ["pos.order.create", "pos.order.close"],
  "attributes": {
    "approval_limit_paisa": 5000000,
    "employment_type": "FULL_TIME",
    "department_id": "dept-uuid"
  },
  "iat": 1714000000,
  "exp": 1714000900
}
```

The public key for JWT verification is fetched by each service from the Auth Service's JWKS endpoint (`/.well-known/jwks.json`) at startup and cached with a 1-hour TTL. No service holds a hardcoded public key — this allows key rotation without redeployment.

### Login Flow

1. `POST /api/v1/auth/login` — `{email, password, tenant_slug, totp_code?}`.
2. Resolve tenant from slug. Verify `ACTIVE` status.
3. Constant-time bcrypt compare (cost 12). Check lockout.
4. If `totp_enabled` and code missing or wrong → 401 `TOTP_REQUIRED`.
5. Load user roles, permissions, and ABAC attributes for current branch.
6. Issue access JWT. Insert `refresh_sessions` row. Set HttpOnly cookie.
7. Publish `auth.user.login_succeeded` event → Audit Service.

Account lockout: 5 consecutive failures → locked 15 minutes. Failure count resets on success.

### Password Policy

- Minimum 10 characters; must contain 3 of: uppercase, lowercase, digit, symbol.
- Checked against top-1000 common-passwords list seeded at deploy.
- Cannot equal username, email, or any of the last 5 passwords (hashes in `password_history`).
- Reset via email (single-use 30-minute token) or owner-initiated temporary password.
- 2FA mandatory for roles with `rbac.manage` or `finance.period.close` permissions.

## P7.2 Authorization — Hybrid RBAC + ABAC via OPA

### Why RBAC Alone Is Insufficient

Pure role-based access cannot express: "a cashier can edit their own orders but not others" or "a manager can approve expenses up to PKR 50,000." These require attribute comparison — ABAC.

RestaurantOS uses **permission-based RBAC** (roles carry a set of permission codes, pre-computed into the JWT) combined with **ABAC policies** (decisions that additionally compare attributes on user, resource, and environment). All decisions pass through OPA.

### OPA Decision Flow

```
HTTP Request
     |
     v
API Gateway: JWT validation, coarse route permission check
     |
     v
Service Handler: fetch resource attributes, build OPA input
     |
     v
OPA Policy Evaluation (Rego)
     |
   Allow / Deny
```

OPA input document structure:

```json
{
  "user": {
    "id": "uuid",
    "tenant_id": "uuid",
    "branch_id": "uuid",
    "permissions": ["pos.order.void.own"],
    "attributes": { "approval_limit_paisa": 5000000 }
  },
  "resource": {
    "type": "Order",
    "id": "uuid",
    "tenant_id": "uuid",
    "branch_id": "uuid",
    "created_by": "uuid",
    "status": "OPEN",
    "total_paisa": 4500
  },
  "action": "void",
  "environment": {
    "time": "2026-04-29T14:30:00Z"
  }
}
```

Sample Rego policies:

```rego
package restaurantos.pos

# Rego v1 (OPA 1.x default): rule bodies require the `if` keyword.

default allow := false

# Cashiers can void their own OPEN orders
allow if {
    "pos.order.void.own" in input.user.permissions
    input.resource.created_by == input.user.id
    input.resource.status == "OPEN"
    same_tenant_and_branch
}

# Managers can void any order at their branch
allow if {
    "pos.order.void.any" in input.user.permissions
    same_tenant_and_branch
}

same_tenant_and_branch if {
    input.resource.tenant_id == input.user.tenant_id
    input.resource.branch_id == input.user.branch_id
}
```

```rego
package restaurantos.finance

default allow := false

# Expense approval: user's approval limit must cover the amount
allow if {
    input.action == "approve"
    "finance.expense.approve" in input.user.permissions
    input.resource.amount_paisa <= input.user.attributes.approval_limit_paisa
    same_tenant
}

same_tenant if { input.resource.tenant_id == input.user.tenant_id }
```

OPA policies live in the Git Config repo and sync to OPA via the bundle API. Policy updates deploy without restarting any Java service.

### ABAC Policy Catalogue (Key Policies)

| Policy | Rule |
|---|---|
| Branch isolation | `user.branchId == resource.branchId` — enforced on every operation |
| Tenant isolation | `user.tenantId == resource.tenantId` — enforced on every operation |
| Own-order void | `resource.createdBy == user.id AND resource.status == OPEN` |
| Expense approval | `resource.amountPaisa <= user.approvalLimit` |
| PO approval tier 1 | Amount within Tier 1 threshold AND user has `vendor.po.approve.tier1` |
| PO approval tier 2 | Amount within Tier 2 threshold AND user has `vendor.po.approve.tier2` |
| Period close | ACCOUNTANT or OWNER permission AND period status is OPEN |
| NLQ cross-tenant | `resource.tenantId == user.tenantId` on every generated SQL predicate |

### RBAC Enforcement Layers

Three layers; the service + OPA layer is the authoritative boundary:

1. **UI**: routes and buttons rendered conditionally based on JWT `permissions` array.
2. **API Gateway**: coarse route-level check (any user accessing `/api/v1/finance/*` must carry at least one `finance.*` permission).
3. **Service + OPA**: fine-grained per-resource ABAC decision. The only layer that counts for security.

### Feature Flag Enforcement

The API Gateway checks `tenant_features` (cached in Redis, 5-min TTL) for every request. Access to a disabled module returns 403 `FEATURE_DISABLED` with a `X-Upgrade-CTA-URL` header pointing to the billing page.

---

# M1. POS & Order Management

## M1.1 Purpose

The highest-frequency module. Every restaurant generates revenue only when this works. The design prioritises: speed (< 400ms P95 for order close), availability (offline-capable), and correctness (no lost orders, no double-posts).

## M1.2 Key Functional Requirements

- Order types: dine-in, takeaway, delivery.
- Table management with visual floor plan per branch.
- Modifier groups with single/multi selection, min/max constraints.
- Combo/bundle items.
- Split bill: equal share or by item.
- Split-tender payments: multiple methods on one order (Cash + Card + Loyalty points).
- Order hold and recall.
- Void (open order, reason required) and refund (closed order, partial or full).
- Discounts: flat or percentage, line-level or order-level, with permission thresholds.
- Offline mode: full POS operation without server connectivity; sync on reconnect.
- Till session: open with float, close with declaration, reconcile with variance.
- KDS routing: items route to correct kitchen station on "Send to Kitchen".
- Receipt: printed (ESC/POS thermal) and digital (email/WhatsApp).
- Real-time table status across concurrent cashier sessions.

## M1.3 `pos_db` Data Model (Selected Tables)

```sql
CREATE TABLE menu_categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  branch_id       UUID,             -- NULL = applies to all branches
  name            TEXT NOT NULL,
  display_order   INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  icon_file_id    UUID
);

CREATE TABLE menu_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  category_id     UUID NOT NULL REFERENCES menu_categories(id),
  name            TEXT NOT NULL,
  description     TEXT,
  base_price_paisa BIGINT NOT NULL,
  tax_rate_code   TEXT NOT NULL,    -- references finance_db via code; denormalised rate here
  tax_rate_pct    NUMERIC(5,2) NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_combo        BOOLEAN NOT NULL DEFAULT FALSE,
  image_file_id   UUID,
  pos_display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE branch_menu_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  branch_id       UUID NOT NULL,
  menu_item_id    UUID NOT NULL REFERENCES menu_items(id),
  price_paisa     BIGINT,           -- NULL = use base price
  is_available    BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (tenant_id, branch_id, menu_item_id)
);

CREATE TABLE modifier_groups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  name            TEXT NOT NULL,
  selection_type  TEXT NOT NULL,    -- SINGLE|MULTI
  is_required     BOOLEAN NOT NULL DEFAULT FALSE,
  min_selections  INTEGER NOT NULL DEFAULT 0,
  max_selections  INTEGER
);

CREATE TABLE modifiers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  group_id        UUID NOT NULL REFERENCES modifier_groups(id),
  name            TEXT NOT NULL,
  price_delta_paisa BIGINT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE dining_tables (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  branch_id       UUID NOT NULL,
  label           TEXT NOT NULL,    -- "T1", "A7", "Rooftop 3"
  capacity        INTEGER,
  status          TEXT NOT NULL DEFAULT 'AVAILABLE',
  floor_plan_x    NUMERIC,
  floor_plan_y    NUMERIC,
  floor_plan_shape TEXT
);

CREATE TABLE orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  branch_id       UUID NOT NULL,
  order_no        TEXT NOT NULL,    -- ORD-20260429-0047 (per-branch daily seq)
  type            TEXT NOT NULL,    -- DINE_IN|TAKEAWAY|DELIVERY
  status          TEXT NOT NULL,    -- DRAFT|OPEN|SENT_TO_KDS|PARTIAL_READY|READY|SERVED|CLOSED|VOIDED|REFUNDED
  table_id        UUID REFERENCES dining_tables(id),
  cover_count     INTEGER,
  cashier_id      UUID NOT NULL,
  till_session_id UUID NOT NULL REFERENCES till_sessions(id),
  subtotal_paisa  BIGINT NOT NULL DEFAULT 0,
  tax_paisa       BIGINT NOT NULL DEFAULT 0,
  discount_paisa  BIGINT NOT NULL DEFAULT 0,
  service_charge_paisa BIGINT NOT NULL DEFAULT 0,
  total_paisa     BIGINT NOT NULL DEFAULT 0,
  notes           TEXT,
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_to_kds_at  TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ,
  voided_at       TIMESTAMPTZ,
  void_reason     TEXT,
  client_order_id UUID UNIQUE       -- offline dedup key
);

CREATE TABLE order_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id        UUID NOT NULL,
  item_name_snapshot  TEXT NOT NULL,
  unit_price_snapshot BIGINT NOT NULL,
  quantity            INTEGER NOT NULL,
  discount_paisa      BIGINT NOT NULL DEFAULT 0,
  tax_paisa           BIGINT NOT NULL DEFAULT 0,
  line_total_paisa    BIGINT NOT NULL,
  kds_station         TEXT,
  kds_status          TEXT NOT NULL DEFAULT 'PENDING',
  notes               TEXT
);

CREATE TABLE order_item_modifiers (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL,
  order_item_id           UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  modifier_id             UUID NOT NULL,
  modifier_name_snapshot  TEXT NOT NULL,
  price_delta_paisa       BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE order_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  order_id        UUID NOT NULL REFERENCES orders(id),
  method          TEXT NOT NULL,   -- CASH|CARD|LOYALTY_POINTS|BANK_TRANSFER|VOUCHER
  amount_paisa    BIGINT NOT NULL,
  reference_no    TEXT,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE till_sessions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL,
  branch_id               UUID NOT NULL,
  cashier_id              UUID NOT NULL,
  opening_float_paisa     BIGINT NOT NULL DEFAULT 0,
  expected_closing_paisa  BIGINT,
  declared_closing_paisa  BIGINT,
  variance_paisa          BIGINT GENERATED ALWAYS AS (
                            COALESCE(declared_closing_paisa, 0) - COALESCE(expected_closing_paisa, 0)
                          ) STORED,
  opened_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at               TIMESTAMPTZ,
  status                  TEXT NOT NULL DEFAULT 'OPEN'
);
```

## M1.4 POS Event Publishing (RabbitMQ)

| Event | Exchange | Routing Key | Consumers |
|---|---|---|---|
| `ORDER_CREATED` | `pos.topic` | `pos.order.created` | Kitchen, Audit |
| `ORDER_SENT_TO_KDS` | `pos.topic` | `pos.order.sent_to_kds` | Kitchen |
| `ORDER_CLOSED` | `pos.topic` | `pos.order.closed` | Finance, Inventory, CRM, Reporting, Audit |
| `ORDER_VOIDED` | `pos.topic` | `pos.order.voided` | Finance, Inventory, Audit |
| `ORDER_REFUNDED` | `pos.topic` | `pos.order.refunded` | Finance, Audit |
| `TILL_CLOSED` | `pos.topic` | `pos.till.closed` | Finance, Audit |

## M1.5 Acceptance Criteria

1. Cashier can take a dine-in order, send to kitchen, receive payment in two methods, and close — end-to-end within 60 seconds.
2. Closed order triggers inventory depletion and GL posting within 3 seconds.
3. During a 60-second full network outage, cashier creates and closes 3 orders; all sync correctly on reconnect with no duplicates.
4. Split-tender: cash + card payment amounts sum exactly to order total (rounding applied correctly).
5. Cashier attempting a discount > 10% is blocked at UI and API without `pos.order.discount.override`.
6. Till variance triggers a notification to the Branch Manager.
7. A cross-tenant request (JWT from Tenant A calling with Tenant B's order ID) returns 404.

---

# M2. Inventory Management

## M2.1 Purpose

Perpetual inventory tracking driven by recipe BOMs. Every sale auto-depletes ingredients. Manual adjustments, stock counts, and inter-branch transfers complete the picture.

## M2.2 Key Functional Requirements

- Ingredient master with UOM and multi-unit conversion table.
- Recipe (BOM) per menu item, versioned. Yield percentage per ingredient line.
- Auto-depletion on `order.closed` event: computes effective base quantity per recipe line, decrements stock, updates moving average cost.
- Manual adjustments: wastage, correction, opening balance.
- Physical stock count: create count sheet, enter actuals, post variance JE via Finance event.
- Low-stock and expiry alerts → Notification Service.
- Inter-branch stock transfers with dual inventory movements and GL entries.
- Ingredient lot tracking (optional, GROWTH+).

## M2.3 `inventory_db` Data Model (Selected Tables)

```sql
CREATE TABLE units_of_measure (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  code            TEXT NOT NULL,        -- g, kg, ml, l, pcs, dozen
  name            TEXT NOT NULL,
  base_unit_code  TEXT,                 -- NULL if this IS the base unit
  to_base_factor  NUMERIC(18,8),        -- qty * factor = qty in base unit
  UNIQUE (tenant_id, code)
);

CREATE TABLE ingredients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  name            TEXT NOT NULL,
  base_unit_id    UUID NOT NULL REFERENCES units_of_measure(id),
  reorder_point   NUMERIC(18,4),
  expiry_tracking BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE ingredient_branch_stock (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  branch_id       UUID NOT NULL,
  ingredient_id   UUID NOT NULL REFERENCES ingredients(id),
  qty_on_hand     NUMERIC(18,4) NOT NULL DEFAULT 0,
  avg_cost_paisa  BIGINT NOT NULL DEFAULT 0,     -- MAC per base unit
  last_counted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, ingredient_id)
);

CREATE TABLE recipes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  menu_item_id    UUID NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  yield_servings  NUMERIC(10,4) NOT NULL DEFAULT 1,
  is_current      BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes           TEXT
);

CREATE TABLE recipe_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  recipe_id       UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id   UUID NOT NULL REFERENCES ingredients(id),
  quantity        NUMERIC(18,4) NOT NULL,
  uom_id          UUID NOT NULL REFERENCES units_of_measure(id),
  yield_pct       NUMERIC(5,4) NOT NULL DEFAULT 1.0   -- 0.85 = 15% trim loss
);

CREATE TABLE inventory_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  branch_id       UUID NOT NULL,
  ingredient_id   UUID NOT NULL REFERENCES ingredients(id),
  movement_type   TEXT NOT NULL, -- PURCHASE|DEPLETION|WASTAGE|ADJUSTMENT|TRANSFER_IN|TRANSFER_OUT|COUNT_VARIANCE
  qty_delta       NUMERIC(18,4) NOT NULL,
  qty_after       NUMERIC(18,4) NOT NULL,
  unit_cost_paisa BIGINT NOT NULL,
  total_cost_paisa BIGINT NOT NULL,
  source_type     TEXT,
  source_id       UUID,
  notes           TEXT,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## M2.4 Depletion Algorithm

On receiving `ORDER_CLOSED` event (idempotent — tracks processed order IDs):

```java
@RabbitListener(queues = "inventory.order-closed.queue")
@Transactional
public void onOrderClosed(OrderClosedEvent event) {
    if (hasBeenProcessed(event.getOrderId())) return;

    for (OrderItemDto item : event.getItems()) {
        Recipe recipe = recipeRepository.findCurrentByMenuItemId(
            event.getTenantId(), item.getMenuItemId()
        );
        if (recipe == null) continue;

        for (RecipeLine line : recipe.getLines()) {
            // effective_base_qty = (line.qty * uom.to_base_factor / line.yield_pct)
            //                      * order_item.qty / recipe.yield_servings
            BigDecimal effectiveQty = computeEffectiveBaseQty(line, item.getQuantity(), recipe);

            IngredientBranchStock stock = stockRepository
                .findByBranchAndIngredient(event.getBranchId(), line.getIngredientId(), LockModeType.PESSIMISTIC_WRITE);

            stock.setQtyOnHand(stock.getQtyOnHand().subtract(effectiveQty));
            stockRepository.save(stock);

            inventoryMovementRepository.save(new InventoryMovement(
                event.getTenantId(), event.getBranchId(),
                line.getIngredientId(), MovementType.DEPLETION,
                effectiveQty.negate(), stock.getQtyOnHand(),
                stock.getAvgCostPaisa(), /* source */ "ORDER", event.getOrderId()
            ));

            if (stock.getQtyOnHand().compareTo(ingredient.getReorderPoint()) <= 0) {
                eventPublisher.publish(new LowStockAlertEvent(event.getTenantId(), event.getBranchId(), line.getIngredientId()));
            }
        }
    }
    markAsProcessed(event.getOrderId());
}
```

---

# M3. Financial System

## M3.1 Purpose

Complete double-entry GL with auto-posting for every business event. The engine is the financial source of truth. No module bypasses it.

## M3.2 Key Functional Requirements

- Double-entry GL with Pakistan COA seeded per tenant (1xxx–7xxx).
- Immutable journal entries; reversals create a counter-entry.
- Auto-posting for: order close (revenue + COGS), vendor invoice, goods receipt, vendor payment, wastage, stock count variance, expense, refund, payroll, inter-branch transfer.
- Moving average cost (MAC) for inventory valuation.
- AP: vendor invoices, aging, payment runs.
- AR: customer invoices, aging, collection.
- Bank reconciliation: match statement transactions to GL cash entries.
- Period close with pre-close checks (all orders closed, no unmatched GRNs, no pending AP approvals).
- FBR sales tax: output tax (sales), input tax (purchases), net payable report.
- P&L, Balance Sheet, Cash Flow (indirect method).

## M3.3 `finance_db` Data Model (Selected Tables)

```sql
CREATE TABLE chart_of_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  account_type    TEXT NOT NULL,   -- ASSET|LIABILITY|EQUITY|REVENUE|COGS|EXPENSE
  parent_code     TEXT,
  is_system       BOOLEAN NOT NULL DEFAULT FALSE,
  system_tag      TEXT,            -- CASH|BANK|AR|AP|INVENTORY|OUTPUT_TAX|GR_IR|...
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (tenant_id, code)
);

CREATE TABLE accounting_periods (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  fiscal_year     INTEGER NOT NULL,
  period_no       INTEGER NOT NULL,   -- 1-12 (1 = July for Pakistan)
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'OPEN',  -- OPEN|LOCKED|CLOSED
  locked_by       UUID,
  locked_at       TIMESTAMPTZ,
  UNIQUE (tenant_id, fiscal_year, period_no)
);

CREATE TABLE journal_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  branch_id       UUID NOT NULL,
  entry_no        TEXT NOT NULL,
  period_id       UUID NOT NULL REFERENCES accounting_periods(id),
  entry_date      DATE NOT NULL,
  description     TEXT NOT NULL,
  source_type     TEXT,
  source_id       UUID,
  posted_by       UUID NOT NULL,
  reversed_by_je  UUID REFERENCES journal_entries(id),
  is_reversal     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE journal_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  je_id           UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_code    TEXT NOT NULL,
  description     TEXT,
  debit_paisa     BIGINT NOT NULL DEFAULT 0,
  credit_paisa    BIGINT NOT NULL DEFAULT 0,
  CHECK (debit_paisa >= 0 AND credit_paisa >= 0),
  CHECK (NOT (debit_paisa > 0 AND credit_paisa > 0))
);

-- Balanced check enforced by trigger (CONSTRAINT CHECK on computed subquery is not portable)
CREATE FUNCTION check_je_balance() RETURNS trigger AS $$
BEGIN
  IF (SELECT SUM(debit_paisa) FROM journal_lines WHERE je_id = NEW.id) <>
     (SELECT SUM(credit_paisa) FROM journal_lines WHERE je_id = NEW.id) THEN
    RAISE EXCEPTION 'Journal entry % is not balanced', NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

## M3.4 Auto-Posting Recipes

| Trigger | DR | CR |
|---|---|---|
| Order close — Revenue | Cash/Card/Loyalty (1xxx) | Sales Revenue (4100) + Output Tax (2200) |
| Order close — COGS | COGS (5100) | Inventory (1300) at MAC |
| Goods Receipt | Inventory (1300) | GR/IR Clearing (1700) |
| Vendor Invoice | GR/IR (1700) + Input Tax (1710) | AP (2100) |
| Vendor Payment | AP (2100) | Bank (1100) |
| Expense (cash) | Expense (6xxx) | Cash (1010) |
| Wastage | Wastage Expense (5200) | Inventory (1300) at MAC |
| Stock count loss | Stock Variance Loss (5220) | Inventory (1300) at MAC |
| Stock count gain | Inventory (1300) at MAC | Stock Variance Gain (5221) |
| Refund | Sales Refunds (4920) + Output Tax (2200) reversal | Cash/Card (1xxx) |
| Inter-branch transfer ship | Inventory in Transit (1320) | Inventory (1300) at MAC |
| Inter-branch transfer receive | Inventory (1300) at MAC | Inventory in Transit (1320) |
| Payroll approved | Salary Expense (6200) | Wages Payable (2300) |
| Payroll disbursed | Wages Payable (2300) | Bank (1100) |

---

# M4. Vendor & Supply Chain

## M4.1 Purpose

End-to-end purchasing: vendor master, PO approval workflow, goods receipt, three-way match, and AP payment.

## M4.2 Key Functional Requirements

- Vendor master with NTN/STRN, payment terms, lead time, performance rating.
- Vendor catalogue: item-price mappings per vendor with valid date ranges.
- PO workflow: DRAFT → PENDING_APPROVAL → APPROVED → SENT → PARTIALLY_RECEIVED → FULLY_RECEIVED → CLOSED.
- Multi-tier PO approval by amount threshold (configurable per tenant).
- GRN with partial receiving.
- Vendor invoice booking with three-way match against PO and GRN.
- Configurable match tolerances (qty under/over, price under/over).
- Override workflow: mandatory justification text, ACCOUNTANT/OWNER only.
- AP payment run: select invoices, produce payment advice, post GL.
- AP aging: 0–30, 31–60, 61–90, 90+ days.

## M4.3 Three-Way Match Algorithm

```java
public MatchResult performThreeWayMatch(VendorInvoice invoice) {
    List<LineMatchResult> lineResults = new ArrayList<>();

    for (VendorInvoiceLine invLine : invoice.getLines()) {
        PurchaseOrderLine poLine = findMatchingPoLine(invLine);
        if (poLine == null) { lineResults.add(LineMatchResult.missingPoLine(invLine)); continue; }

        BigDecimal grnQty = sumGrnQtyForPoLine(poLine.getId());
        if (grnQty.compareTo(BigDecimal.ZERO) == 0) {
            lineResults.add(LineMatchResult.missingGrn(invLine)); continue;
        }

        Tolerance tol = tenantToleranceConfig();
        LineMatchStatus status = LineMatchStatus.OK;

        // Quantity checks
        if (grnQty.compareTo(poLine.getQty().multiply(BigDecimal.ONE.add(tol.qtyOverPct()))) > 0)
            status = LineMatchStatus.QTY_OVER;
        else if (grnQty.compareTo(invLine.getQty().multiply(BigDecimal.ONE.subtract(tol.qtyUnderPct()))) < 0)
            status = LineMatchStatus.QTY_UNDER;

        // Price checks
        if (invLine.getUnitPricePaisa().compareTo(poLine.getUnitPricePaisa().multiply(BigDecimal.ONE.add(tol.priceOverPct()))) > 0)
            status = LineMatchStatus.PRICE_OVER;
        else if (invLine.getUnitPricePaisa().compareTo(poLine.getUnitPricePaisa().multiply(BigDecimal.ONE.subtract(tol.priceUnderPct()))) < 0)
            status = LineMatchStatus.PRICE_UNDER;

        lineResults.add(new LineMatchResult(invLine, poLine, grnQty, status));
    }

    return new MatchResult(invoice.getId(), lineResults, deriveOverallStatus(lineResults));
}
```

Default tolerances: qty_over 0%, qty_under 5%, price_over 2%, price_under 10%. All configurable per tenant in settings.

---

# M5. Reporting & Analytics

## M5.1 Purpose

40+ named reports, live KPI dashboard, and the ClickHouse analytics pipeline that powers them.

## M5.2 ClickHouse Analytics Pipeline

Operational events flow from RabbitMQ into ClickHouse via the Reporting Service's event consumer:

```
RabbitMQ event → Reporting Service Consumer → ClickHouse MergeTree table
```

Key ClickHouse tables:

```sql
CREATE TABLE sales_facts (
  event_date          Date,
  tenant_id           UUID,
  branch_id           UUID,
  order_id            UUID,
  order_type          String,
  cashier_id          UUID,
  menu_item_id        UUID,
  menu_item_name      String,
  category_name       String,
  qty                 Int32,
  unit_price_paisa    Int64,
  discount_paisa      Int64,
  tax_paisa           Int64,
  line_total_paisa    Int64,
  cogs_paisa          Int64,
  gross_margin_paisa  Int64,
  payment_method      String,
  closed_at           DateTime64(3)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, branch_id, event_date, order_id);

CREATE TABLE inventory_daily_snapshots (
  snapshot_date     Date,
  tenant_id         UUID,
  branch_id         UUID,
  ingredient_id     UUID,
  ingredient_name   String,
  qty_on_hand       Float64,
  avg_cost_paisa    Int64,
  total_value_paisa Int64
) ENGINE = MergeTree()
ORDER BY (tenant_id, branch_id, snapshot_date, ingredient_id);
```

## M5.3 Named Report Catalogue

**Sales (12):** Sales by Day/Week/Month, Sales by Hour (heatmap), Sales by Category, Sales by Item (ranked by revenue/qty/margin), Sales by Cashier, Sales by Payment Method, Discount Analysis, Refund Analysis, Table Utilisation, Cover Count, Revenue by Branch (consolidated), Year-on-Year/Month-on-Month.

**Inventory (8):** Current Stock by Branch, Stock Movement History, Low Stock Alert, Expiring Lots, Wastage Summary, Recipe Cost Analysis (theoretical vs actual COGS), Stock Count Variance, Transfer History.

**Financial (10):** P&L, Balance Sheet, Cash Flow (indirect), Trial Balance, General Ledger drill-down, AP Aging, AR Aging, FBR Tax Summary (output vs input, net payable), Bank Reconciliation Status, Expense by Category.

**Vendor (5):** PO Status, GRN vs Invoice Reconciliation, Vendor Payment History, AP Outstanding by Vendor, Vendor Price Variance.

**HR (5, GROWTH+):** Attendance Summary, Leave Balance, Payroll Summary, Overtime Report, Staff Cost as % of Revenue.

**Executive Dashboard (KPI tiles):** Revenue Today vs Yesterday, Revenue This Month vs Last Month, Top 5 Items by Revenue, Gross Margin %, Open POs (value), low-stock ingredient count.

## M5.4 Dashboard WebSocket Architecture

- Client subscribes to `wss://{host}/api/v1/reporting/dashboard/{branchId}`.
- Reporting Service pushes updates on `ORDER_CLOSED` and `TILL_CLOSED` events.
- KPI tile values pre-computed in Redis; WebSocket push carries pre-computed values.
- Minimum 5-second interval between successive pushes per tile (throttled) to prevent UI thrash.

---

# M6. Natural Language Query Interface

## M6.1 Purpose

AI-powered plain-language data querying for owners and managers. Complements the 40 named reports with ad-hoc analysis.

## M6.2 Architecture

Isolated Python FastAPI microservice registered in Eureka as `nlq-service`.

```
User question + JWT
     |
     v
NLQ Service: resolve tenant_id, branch_id, role from JWT
     |
     v
Redis: check result cache (key: nlq:{tenantId}:{role}:{sha256(question)}, TTL 60s)
     |
     v (cache miss)
Load RBAC-scoped ClickHouse schema slice (Redis cache, 10-min TTL)
     |
     v
Assemble prompt: Layer 1 (static behaviour, cached) +
                 Layer 2 (schema slice, role-cached) +
                 Layer 3 (per-request context: tenant_id, branch_id, role, time)
     |
     v
Anthropic Claude API (claude-sonnet-4-20250514)
     |
     v
Extract JSON: {intent, sql, chart_hint, refusal_reason}
     |
     v
7-stage SQL validation (see below)
     |
     v
Execute against ClickHouse (read-only role, 5s timeout, 10k row cap)
     |
     v
Narrative generation (claude-haiku, ~200 tokens)
     |
     v
Return {answer_text, table, chart_hint} + write nlq_query_log
```

## M6.3 SQL Validation Pipeline (7 Stages)

1. **Shape check** — must begin with `SELECT` or `WITH`; no DML keywords anywhere.
2. **AST parse** — `sqlglot` ClickHouse dialect; rejects if unparseable.
3. **Table allowlist** — every table in the AST must be in the role's `nlq_allowed_tables`.
4. **Column deny-list** — no PII columns (`email`, `cnic`, `bank_account_no`, `phone`).
5. **Tenant filter** — every table with `tenant_id` must have `tenant_id = :tenant_id` predicate; auto-injected if missing.
6. **Branch filter** — non-OWNER roles: every table with `branch_id` must have `branch_id = :branch_id`; auto-injected if missing.
7. **Limit inject** — append `LIMIT 1000` if no LIMIT on a non-aggregate query.

## M6.4 Multi-Tenant NLQ Safeguards

Beyond the 7-stage validation:
- The ClickHouse read-only user executes with a session-level `WHERE tenant_id = '<uuid>'` enforced by the query proxy.
- Per-tenant monthly query cap checked against Redis counter before calling Claude. Over limit → 429 `QUOTA_EXCEEDED` with plan upgrade CTA.
- Per-user rate limit: 30 queries/hour in Redis.
- All queries (including refusals) logged to `audit_db.nlq_query_log` with question, SQL, model, token counts, cost, and status.

## M6.5 Response Shape

```json
{
  "answer_text": "Last Friday, your best seller was Chicken Karahi with 47 plates (PKR 32,900 revenue).",
  "table": {
    "columns": ["item_name", "qty_sold", "revenue_pkr"],
    "rows": [["Chicken Karahi", 47, 32900.00], ["..."]],
    "truncated": false
  },
  "chart": {
    "type": "BAR",
    "x_axis": "item_name",
    "y_axis": "qty_sold",
    "title": "Items Sold — Friday 25 Apr 2026"
  },
  "meta": {
    "model": "claude-sonnet-4-20250514",
    "duration_ms": 4231,
    "cache_hit": false,
    "row_count": 12
  }
}
```

---

# M7. Multi-Branch Architecture & Granular RBAC

(Covered extensively in P7.2 and P6. Key additions below.)

## M7.1 Branch Entity

```sql
-- in user_db
CREATE TABLE branches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  name            TEXT NOT NULL,
  is_hq           BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  address         JSONB,
  fbr_strn        TEXT,
  ntn             TEXT,
  phone           TEXT,
  email           TEXT,
  timezone        TEXT NOT NULL DEFAULT 'Asia/Karachi',
  currency_config JSONB NOT NULL DEFAULT '{}',
  receipt_config  JSONB NOT NULL DEFAULT '{}',
  opened_on       DATE,
  UNIQUE (tenant_id, name)
);
```

## M7.2 User-Branch Role Assignment

```sql
-- in auth_db
CREATE TABLE user_branch_roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  user_id         UUID NOT NULL REFERENCES users(id),
  branch_id       UUID NOT NULL,
  role_code       TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (tenant_id, user_id, branch_id, role_code)
);
```

A user may hold different roles at different branches (e.g., MANAGER at Branch 1, ACCOUNTANT at Branch 2). The JWT reflects the currently active branch context. The `permissions` array is recomputed per branch on every switch.

## M7.3 Custom Role Management

Tenant Admins can:
- Create roles from scratch or by cloning system roles.
- Grant/revoke individual permissions on any non-system role.
- Assign custom roles to users per branch.

All RBAC changes are written to `audit_db.rbac_change_log` with full before/after JSON.

Safety guard: the last user with `rbac.manage` cannot revoke their own assignment. Owner cannot remove `rbac.manage` from themselves. Both enforced server-side.

---

# M8. HR & Payroll

## M8.1 Purpose

Employee lifecycle, attendance, leave, and payroll. Available in GROWTH and ENTERPRISE tiers.

## M8.2 Key Functional Requirements

- Employee master: personal info (CNIC encrypted), contract type, department, salary structure.
- Attendance: clock-in/clock-out (manual or biometric webhook). Auto-deduct for late arrival per policy.
- Leave: types (annual, sick, unpaid, maternity, paternity), accrual rules, approval workflow.
- Payroll run: gross from salary + overtime; EOBI/PESSI contribution deductions; Pakistan income tax slabs (updated annually via config, not code); net pay.
- Payslip generation (PDF, stored in MinIO, emailed).
- GL posting on payroll approval: `DR Salary Expense / CR Wages Payable`. On disbursement: `DR Wages Payable / CR Bank`.
- Payroll publishes `hr.payroll.paid` event → Finance Service auto-posts.

## M8.3 `hr_db` Data Model (Selected Tables)

```sql
CREATE TABLE employees (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  branch_id       UUID NOT NULL,
  user_id         UUID,                    -- links to auth_db if they have system access
  employee_no     TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  cnic            BYTEA,                   -- AES-256-GCM encrypted
  designation     TEXT,
  department      TEXT,
  employment_type TEXT NOT NULL,           -- PERMANENT|PART_TIME|DAILY_WAGE|CONTRACT
  join_date       DATE NOT NULL,
  exit_date       DATE,
  basic_salary_paisa BIGINT NOT NULL DEFAULT 0,
  bank_account_no BYTEA,                   -- encrypted
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE payroll_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  branch_id       UUID,
  period_month    INTEGER NOT NULL,
  period_year     INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'DRAFT',  -- DRAFT|CALCULATED|APPROVED|PAID|REVERSED
  total_gross_paisa BIGINT NOT NULL DEFAULT 0,
  total_net_paisa BIGINT NOT NULL DEFAULT 0,
  run_by          UUID NOT NULL,
  approved_by     UUID,
  paid_at         TIMESTAMPTZ,
  UNIQUE (tenant_id, period_month, period_year)
);

CREATE TABLE payslips (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  run_id          UUID NOT NULL REFERENCES payroll_runs(id),
  employee_id     UUID NOT NULL REFERENCES employees(id),
  basic_paisa     BIGINT NOT NULL,
  allowances_json JSONB NOT NULL DEFAULT '{}',
  gross_paisa     BIGINT NOT NULL,
  deductions_json JSONB NOT NULL DEFAULT '{}',   -- EOBI, income_tax, advances
  net_paisa       BIGINT NOT NULL,
  payslip_file_id UUID
);
```

---

# M9. CRM & Loyalty

## M9.1 Purpose

Customer relationship management, loyalty programme, and targeted promotions. Available in GROWTH and ENTERPRISE tiers.

## M9.2 Key Functional Requirements

- Customer master: name, phone, email, birthday, CNIC (optional).
- Customer profile: order history, lifetime spend, loyalty point balance, tier.
- Loyalty programme: configurable points-per-PKR-spent; tier thresholds (Bronze, Silver, Gold).
- Points redemption at POS as a payment method.
- Promotion engine: time-limited discounts by day/hour, item-specific, tier-specific.
- Birthday vouchers: auto-generate and dispatch via Notification Service.
- Customer segmentation: RFM scoring in ClickHouse.
- Marketing blast: email/SMS to a segment via Notification Service.

## M9.3 POS Integration

At payment, cashier looks up customer by phone number. On match: loyalty balance displayed; redemption offered. On `ORDER_CLOSED` event, CRM Service credits loyalty points and checks tier upgrade thresholds.

---

# M10. Kitchen Display System (KDS)

## M10.1 Purpose

Real-time display of incoming orders for kitchen staff. Replaces paper dockets.

## M10.2 Key Functional Requirements

- Multiple KDS stations per branch (Grill, Salads, Bakery, Drinks).
- Menu items tagged to stations; routing is automatic on "Send to Kitchen".
- KDS screen: order number, table/type, items for this station, elapsed time, priority flag.
- Staff marks items: COOKING → READY.
- Order status → READY when all stations mark all items READY; waiter notified via in-app notification.
- Rush/priority flagging by manager.
- Auto-escalation: orders waiting beyond configurable threshold flagged in red.
- Bump bar support.

## M10.3 KDS WebSocket Architecture

```
POS Service publishes ORDER_SENT_TO_KDS event
         |
         v
Kitchen Service: groups items by station; creates kds_tickets
         |
         v
WebSocket channel: ws://{host}/api/v1/kitchen/kds/{branchId}/{stationId}
         |
         v
KDS browser on kitchen display (subscribes to its station channel)
```

`kitchen_db` schema: `kds_stations` (station config, menu item mappings), `kds_tickets` (order-station pairing, item statuses, timestamps).

---

# M11. Notification Service

## M11.1 Channels

| Channel | Tier |
|---|---|
| In-app (WebSocket bell) | All |
| Email (SMTP/SES) | All |
| Browser push notification | All |
| WhatsApp (Twilio / Meta API) | GROWTH+ |
| SMS | ENTERPRISE |

## M11.2 Architecture

All services publish notification-intent events to the `notifications.topic` exchange. The Notification Service is the only service that talks to SMTP, WhatsApp, or SMS providers. This ensures: a single retry/delivery-tracking system, a single template engine, and a single vendor dependency surface.

## M11.3 Default Notification Rules

| Trigger | Severity | Default Targets |
|---|---|---|
| Ingredient hits low-stock threshold | WARNING | INVENTORY_MANAGER, BRANCH_MANAGER |
| Ingredient lot expiring within 3 days | WARNING | INVENTORY_MANAGER, CHEF |
| PO awaiting approval > 4 hours | INFO | Approver |
| Vendor invoice three-way mismatch | WARNING | ACCOUNTANT, OWNER |
| NLQ quota at 80% | INFO | OWNER |
| Failed login lockout triggered | CRITICAL | OWNER |
| Backup job failed | CRITICAL | OWNER |
| Period close completed | INFO | ACCOUNTANT, OWNER |
| Till variance exceeds threshold | WARNING | BRANCH_MANAGER |
| New tenant (platform event) | INFO | SuperAdmin |

## M11.4 `notification_db` Schema (Selected Tables)

```sql
CREATE TABLE notification_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  code            TEXT NOT NULL,
  channel         TEXT NOT NULL,
  subject         TEXT,
  body_file_id    UUID,            -- MinIO for HTML; inline for short SMS/WhatsApp
  body_text       TEXT,
  UNIQUE (tenant_id, code, channel)
);

CREATE TABLE notification_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  template_code   TEXT NOT NULL,
  channel         TEXT NOT NULL,
  recipient       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING|SENT|DELIVERED|FAILED
  sent_at         TIMESTAMPTZ,
  error_message   TEXT,
  payload_json    JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

# M12. Audit & Compliance

## M12.1 Architecture

All services publish `audit.event` messages. Audit Service is the only writer to `audit_db`. Services have no direct write path to `audit_db`.

Event structure:

```json
{
  "eventId": "uuid",
  "tenantId": "uuid",
  "branchId": "uuid",
  "userId": "uuid",
  "impersonatedBy": "uuid or null",
  "entityType": "Order",
  "entityId": "uuid",
  "action": "ORDER_CLOSED",
  "before": {},
  "after": {},
  "occurredAt": "ISO8601",
  "source": "POS_SERVICE",
  "traceId": "uuid"
}
```

## M12.2 Immutability Guarantee

- The application DB user has INSERT-only on `audit_events`. No UPDATE, no DELETE.
- A Postgres trigger raises an exception on any UPDATE or DELETE attempt.
- Retention: 7 years (FBR statutory).

## M12.3 What Is Audited

Authentication events, RBAC changes (all), financial postings (all), POS lifecycle (order open/close/void/refund), inventory manual adjustments, vendor invoice decisions, PO approvals, payroll approvals, NLQ queries, SuperAdmin impersonation, configuration changes. Read-only queries are not audited.

---

# CC. Cross-Cutting Concerns

## CC.1 Security Hardening

**Transport:** TLS 1.3 only. HSTS `max-age=31536000; includeSubDomains; preload`. Mozilla Intermediate cipher suite.

**HTTP Headers (API Gateway, global):**
```
Content-Security-Policy: default-src 'self'; connect-src 'self' wss:; frame-ancestors 'none'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=()
```

**Field-Level Encryption (AES-256-GCM, key from Vault):**

| Field | Service |
|---|---|
| `users.totp_secret` | Auth Service |
| `employees.cnic` | HR Service |
| `employees.bank_account_no` | HR Service |
| `vendors.bank_account_no` | Purchasing Service |

**OWASP Top 10:**

| Risk | Mitigation |
|---|---|
| A01 Broken Access Control | OPA ABAC per operation; Hibernate tenant filter; Postgres RLS |
| A02 Cryptographic Failures | AES-256-GCM for PII; TLS 1.3; bcrypt cost 12; RS256 JWT |
| A03 Injection | JPA parameterised queries; NLQ 7-stage AST validation; ClickHouse read-only user |
| A04 Insecure Design | OPA policy-as-code; threat model per module; no direct cross-service DB access |
| A05 Security Misconfiguration | Vault for secrets; Helm values encrypted; hardened base images |
| A06 Vulnerable Components | Dependabot PRs; monthly `mvn dependency:check` + `pip-audit` |
| A07 Authentication Failures | Bcrypt, lockout, 2FA for elevated roles, HttpOnly refresh cookies |
| A08 Software Integrity | cosign image signing; CI gates; migration-only deploys |
| A09 Logging Failures | ELK stack; audit service; PII redacted from logs |
| A10 SSRF | No user-supplied URLs; NLQ calls Anthropic via SDK only |

## CC.2 Observability

**Metrics (Micrometer → Prometheus → Grafana):**

Custom metrics:
- `restaurantos_orders_total{tenant_id, branch_id, status}` — Counter
- `restaurantos_order_close_duration_seconds` — Histogram (P95 target: < 400ms)
- `restaurantos_nlq_tokens_used{tenant_id, model}` — Counter
- `restaurantos_inventory_below_reorder{tenant_id, branch_id}` — Gauge
- `restaurantos_api_requests_total{service, route, status_code}` — Counter
- `restaurantos_tenant_quota_pct{tenant_id, resource}` — Gauge

**Distributed Tracing:** `X-Trace-Id` (UUIDv7) propagated via W3C TraceContext across all service calls. Exported to Tempo. Trace IDs appear in every log line.

**Logging (ELK):** JSON format. PII redaction list: `password`, `totp`, `cnic`, `bank_account`, `authorization` header. Retention: 90 days hot → 1 year cold.

## CC.3 Idempotency

`Idempotency-Key` UUID header on all state-mutating POSTs. Server stores key + response for 24 hours. Same key → same response. Different body + same key → 409 `IDEMPOTENCY_KEY_CONFLICT`.

## CC.4 Concurrency

- Editable records carry `version` integer. Updates use `If-Match` with version; mismatch → 409.
- Financial-state mutations use `SELECT ... FOR UPDATE` (order close, inventory depletion, MAC update).
- RabbitMQ consumers are idempotent: check processed event ID before applying effects.

## CC.5 Time & Currency

| Concern | Convention |
|---|---|
| Timestamp storage | UTC, `TIMESTAMPTZ` |
| Display | Asia/Karachi (PKT, UTC+5), `dd MMM yyyy, HH:mm` |
| Business day boundary | Configurable per branch (default 04:00 PKT) |
| Currency storage | BIGINT paisa; never floats |
| Currency display | `Intl.NumberFormat('en-PK', {style:'currency', currency:'PKR', minimumFractionDigits:0})` |
| Tax rounding | Half-up to nearest paisa, applied per line |

## CC.6 Feature Flag Enforcement (Backend)

```java
// shared-lib: annotation + AOP
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RequiresFeature {
    String value();      // e.g. "FEATURE_HR"
}

@Aspect
@Component
@RequiredArgsConstructor
public class FeatureFlagAspect {
    private final FeatureFlagService featureFlagService;
    private final TenantContext tenantContext;

    @Before("@annotation(requiresFeature)")
    public void checkFeature(JoinPoint jp, RequiresFeature requiresFeature) {
        if (!featureFlagService.isEnabled(tenantContext.getTenantId(), requiresFeature.value())) {
            throw new FeatureDisabledException(requiresFeature.value());
        }
    }
}

// Usage in any service
@GetMapping("/payroll-runs")
@RequiresFeature("FEATURE_HR")
public ResponseEntity<List<PayrollRunDto>> listPayrollRuns() { ... }
```

Feature flags are cached in Redis with a 5-minute TTL per tenant. The cache is invalidated immediately when a SuperAdmin changes a tenant's feature set.

---

# D1. Deployment & DevOps

## D1.1 Environment Strategy

| Environment | Infrastructure | Data |
|---|---|---|
| Local (dev) | Docker Compose (all services) | Seeded test data |
| Staging | Kubernetes, 1 replica each | Anonymised prod snapshot |
| Production | Kubernetes, auto-scaled, multi-AZ | Live tenant data |

## D1.2 Kubernetes Architecture (Production)

```
Namespace: restaurantos-system
  Eureka Server, Spring Cloud Config, HashiCorp Vault Agent

Namespace: restaurantos-services
  Deployment per microservice
  HPA (Horizontal Pod Autoscaler) per service
  PodDisruptionBudget: min 1 pod always available

Namespace: restaurantos-data
  PostgreSQL (CloudNativePG operator, HA with streaming replication)
  Redis (Redis Operator, sentinel mode)
  RabbitMQ (RabbitMQ Operator, 3-node cluster)

Namespace: restaurantos-analytics
  ClickHouse (StatefulSet, 2 shards x 2 replicas)

Namespace: restaurantos-observability
  Prometheus, Grafana, Tempo, Elasticsearch, Logstash, Kibana
```

## D1.3 Service Scaling Profile

| Service | Min | Max | Scale Trigger |
|---|---|---|---|
| API Gateway | 2 | 10 | CPU > 60% |
| Auth Service | 2 | 6 | CPU > 70% |
| POS Service | 2 | 12 | CPU > 60% or RPS > 500 |
| Inventory Service | 2 | 8 | RabbitMQ queue depth > 100 |
| Finance Service | 2 | 6 | Queue depth > 50 |
| NLQ Service | 1 | 4 | CPU > 70% |
| Reporting Service | 2 | 8 | CPU > 65% |
| Notification Service | 2 | 6 | Queue depth > 200 |
| Audit Service | 2 | 4 | Queue depth > 500 |

## D1.4 CI/CD Pipeline (GitHub Actions)

```yaml
Jobs:
  lint:
    - checkstyle, spotbugs, pmd (Java)
    - eslint, prettier, tsc --noEmit (TypeScript)
    - ruff check, mypy --strict (Python)
    - schema-sync: openapi-to-zod-check (frontend contract validation)

  test:
    - Java: mvn test (JUnit 5 + Testcontainers)
    - TypeScript: vitest run --coverage (with MSW contract tests)
    - Python: pytest -q --cov
    - OPA: opa test policies/ (100% policy coverage required)
    - Coverage gates: finance/inventory >= 75%; others >= 60%

  build:
    - docker buildx build (multi-arch: amd64 + arm64)
    - cosign sign all images
    - push to GHCR: {sha}, {semver}, {branch}-latest

  deploy-staging:
    - helm upgrade --install --atomic --timeout 5m

  e2e:
    - 50 Playwright journeys against staging
    - k6 multi-tenant isolation smoke test

  promote-prod:
    environment: production         # GitHub manual approval
    - helm upgrade same image digest as staging
    - Rollback: helm rollback if any pod fails readiness within 3 min
    - Post-deploy: smoke test against prod /readyz endpoints
```

## D1.5 Database Migration Strategy

Java services use **Liquibase** (changelogs in `src/main/resources/db/changelog/`). Python NLQ uses **Alembic**. Both run on service startup. Startup fails if migration fails — intentional.

Destructive migrations require: `-- DESTRUCTIVE` comment, a pre-deploy backup step, and a migration plan in the PR description. `safe-deploy.sh` takes a backup before any flagged migration.

## D1.6 Backup Strategy

| Asset | Method | Frequency | Retention |
|---|---|---|---|
| All PostgreSQL DBs | WAL streaming (continuous) + `pg_basebackup` | Continuous WAL; daily base | 30 daily, 12 monthly |
| ClickHouse | Native BACKUP TO S3 | Daily | 30 days |
| MinIO | Mirror to secondary bucket (async) | Continuous | 90 days |
| Redis | RDB every 15 min | Built-in | 7 days |
| Vault | Auto-backup to encrypted S3 | Daily | 90 days |

RPO: ≤ 5 minutes (WAL). RTO: ≤ 2 hours. Restore drills: quarterly on staging.

---

# D2. Testing Strategy

## D2.1 Test Pyramid

```
         ┌──────────────────┐
         │    E2E           │   ~50 Playwright journeys, ~8 min
         └──────────────────┘
       ┌──────────────────────┐
       │   Integration         │  ~400 tests across services, ~5 min
       └──────────────────────┘
     ┌────────────────────────────┐
     │   Unit                      │  ~3000 tests, ~2 min
     │   JUnit5 / Vitest / Pytest  │
     └────────────────────────────┘
```

Coverage gates enforced in CI: finance/inventory ≥ 75%, OPA policies 100%, all others ≥ 60%.

## D2.2 Frontend-Specific Testing

**MSW contract tests** for every repository method: mock the API, assert the adapter produces the correct domain model. Every Zod schema is tested against valid and invalid API payloads. These run in CI and catch backend response shape changes before they reach components.

**Component tests (Vitest + Testing Library):** components receive mock domain models via hooks. No API calls in component tests.

**E2E (Playwright):** tests the full stack including the real API. Selected highlights:

| Journey | Services Touched |
|---|---|
| SuperAdmin provisions a tenant end-to-end | Platform Admin |
| Tenant Admin completes setup wizard | Platform Admin, Auth, User |
| Cashier: full order lifecycle with split-tender | POS, Inventory, Finance, Kitchen |
| Offline order sync on reconnect | POS offline queue |
| Three-way match: pass, fail, override | Purchasing, Finance |
| Payroll run, approve, payslip PDF | HR, Finance, File |
| NLQ question returns correct chart and table | NLQ, ClickHouse |
| Tenant hits NLQ quota — sees upgrade CTA | Platform, NLQ |
| SuperAdmin impersonation — all actions audited | Platform Admin, Audit |
| Backend response shape change: ZodError surfaced in GlitchTip | NLQ, Frontend |
| Custom role created; user assigned; behaviour verified | Auth, OPA |
| Feature flag disabled — 403 returned and upgrade shown | API Gateway, Feature Flag |
| White-label logo appears on receipt and email | File, POS, Notification |

## D2.3 Performance Tests (k6)

- **POS load**: 50 concurrent cashiers, 1 order per 30s for 30 min. Target: P95 < 400ms, 0 errors.
- **Multi-tenant isolation**: 10 tenants × 10 cashiers concurrently. Automated assertion: no cross-tenant data in responses.
- **Reporting**: 20 concurrent ClickHouse report queries. Target: P95 < 3s.
- **NLQ**: 100 sequential queries across 5 tenants. Latency and cost recorded.

---

# Appendix A. API Contract Conventions

## A.1 Versioning

All endpoints under `/api/v1/`. Additive changes only within `v1`. `Deprecation` and `Sunset` headers signal upcoming breaks.

## A.2 Standard Response Envelope

```json
{
  "data": {},
  "meta": { "page": { "cursor": null, "next_cursor": null, "limit": 50 } },
  "warnings": []
}
```

Error:
```json
{
  "error": { "code": "VALIDATION_FAILED", "message": "...", "details": [], "trace_id": "..." }
}
```

## A.3 Error Codes

`BAD_REQUEST` (400), `VALIDATION_FAILED` (400), `UNAUTHENTICATED` (401), `TOTP_REQUIRED` (401), `PERMISSION_DENIED` (403), `FEATURE_DISABLED` (403), `TENANT_SUSPENDED` (403), `NOT_FOUND` (404), `STATE_INVALID` (409), `CONFLICT` (409), `IDEMPOTENCY_KEY_CONFLICT` (409), `QUOTA_EXCEEDED` (429), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500), `UPSTREAM_FAILURE` (502).

## A.4 Pagination

- **Cursor-based** (high-volume): `/orders?limit=50&cursor=...`
- **Offset-based** (bounded/reports): `/reports/sales?page=1&page_size=50`

## A.5 Multi-Tenancy Rule

`tenant_id` is NEVER a client-supplied request parameter. It is always resolved server-side from the JWT. Any client-supplied `tenant_id` in body or query string is silently ignored and overridden by the JWT value. Enforced by a Spring AOP interceptor on all controllers.

## A.6 Idempotency

`Idempotency-Key` UUID header; stored 24 hours; retry returns original response. Mandatory on: order create/close, payment post, JE post, PO approval, payroll run.

## A.7 WebSocket Protocol

Auth via `Authorization: Bearer` header. Heartbeat every 30s. Reconnect on missed heartbeat with backoff (1s, 2s, 4s, max 30s). JWT expiry triggers close; client reconnects after token refresh.

---

# Appendix B. Complete Permission Catalogue

## B.1 POS
`pos.menu.view`, `pos.menu.manage`, `pos.order.view`, `pos.order.create`, `pos.order.update`, `pos.order.send_to_kds`, `pos.order.close`, `pos.order.void.own`, `pos.order.void.any`, `pos.order.refund`, `pos.order.split_bill`, `pos.order.discount.line`, `pos.order.discount.order`, `pos.order.discount.override`, `pos.kds.view`, `pos.kds.update`, `pos.till.open`, `pos.till.close`, `pos.till.reconcile.override`, `pos.tables.manage`

## B.2 Inventory
`inventory.ingredient.view`, `inventory.ingredient.manage`, `inventory.recipe.view`, `inventory.recipe.manage`, `inventory.movement.view`, `inventory.movement.adjust`, `inventory.wastage.record`, `inventory.count.create`, `inventory.count.approve`, `inventory.transfer.create`, `inventory.transfer.receive`, `inventory.transfer.cancel`, `inventory.alert.view`

## B.3 Finance
`finance.coa.view`, `finance.coa.manage`, `finance.journal.view`, `finance.journal.post`, `finance.journal.reverse`, `finance.ap.view`, `finance.ap.pay`, `finance.ar.view`, `finance.ar.collect`, `finance.expense.create`, `finance.expense.approve`, `finance.bank.reconcile`, `finance.period.close`, `finance.period.reopen`, `finance.tax.view`, `finance.tax.manage`

## B.4 Purchasing
`vendor.view`, `vendor.manage`, `vendor.catalogue.view`, `vendor.catalogue.manage`, `vendor.po.view`, `vendor.po.create`, `vendor.po.approve.tier1`, `vendor.po.approve.tier2`, `vendor.po.approve.tier3`, `vendor.grn.create`, `vendor.invoice.book`, `vendor.invoice.approve`, `vendor.invoice.override_match`, `vendor.payment.view`, `vendor.payment.process`

## B.5 Reporting
`report.sales.run`, `report.inventory.run`, `report.finance.run`, `report.vendor.run`, `report.hr.run`, `report.executive.run`, `report.consolidated`, `report.export`, `report.schedule`, `report.dashboard.view`, `report.dashboard.customize`

## B.6 NLQ
`nlq.use`, `nlq.admin`, `nlq.history.view`

## B.7 HR
`hr.employee.view`, `hr.employee.manage`, `hr.attendance.view`, `hr.attendance.manage`, `hr.leave.view`, `hr.leave.approve`, `hr.payroll.run`, `hr.payroll.approve`, `hr.payroll.view`

## B.8 CRM
`crm.customer.view`, `crm.customer.manage`, `crm.loyalty.view`, `crm.loyalty.manage`, `crm.promotion.view`, `crm.promotion.manage`, `crm.segment.view`, `crm.campaign.send`

## B.9 Platform / Admin
`branches.view`, `branches.manage`, `rbac.view`, `rbac.manage`, `settings.view`, `settings.manage`, `audit.view`, `audit.export`, `billing.view`, `api.docs.view`

## B.10 Default Role-Permission Grid

| Module | OWNER | BR_MGR | CASHIER | CHEF | ACCOUNTANT | INV_MGR | HR_MGR | CRM_MGR |
|---|---|---|---|---|---|---|---|---|
| POS (full) | ✅ | ✅ | Subset | KDS only | | | | |
| Inventory | ✅ | ✅(view) | | View only | View only | ✅ | | |
| Finance | ✅ | View | | | ✅ | | | |
| Purchasing | ✅ | ✅ | | | ✅ | ✅ | | |
| Reporting | ✅ All | Ops only | | | Finance | Inventory | HR | CRM |
| NLQ | ✅ | ✅ | | | ✅ | ✅ | | |
| HR | ✅ | View | | | | | ✅ | |
| CRM | ✅ | ✅ | Lookup | | | | | ✅ |
| RBAC/Admin | ✅ | | | | | | | |

---

# Appendix C. Subscription Tiers & Feature Flags

| Feature Flag | STARTER | GROWTH | ENTERPRISE |
|---|---|---|---|
| `FEATURE_POS` | ✅ | ✅ | ✅ |
| `FEATURE_INVENTORY` | ✅ | ✅ | ✅ |
| `FEATURE_FINANCE` | ✅ | ✅ | ✅ |
| `FEATURE_VENDOR` | ✅ | ✅ | ✅ |
| `FEATURE_REPORTING_BASIC` | ✅ | ✅ | ✅ |
| `FEATURE_NLQ` | ✅ | ✅ | ✅ |
| `FEATURE_KDS` | ✅ | ✅ | ✅ |
| `FEATURE_MULTI_BRANCH` | | ✅ | ✅ |
| `FEATURE_HR` | | ✅ | ✅ |
| `FEATURE_CRM` | | ✅ | ✅ |
| `FEATURE_REPORTING_ADVANCED` | | ✅ | ✅ |
| `FEATURE_WHITE_LABEL_DOMAIN` | | ✅ | ✅ |
| `FEATURE_WHATSAPP_NOTIFICATIONS` | | ✅ | ✅ |
| `FEATURE_SMS_NOTIFICATIONS` | | | ✅ |
| `FEATURE_API_ACCESS` | | | ✅ |
| `FEATURE_CUSTOM_ROLES` | | ✅ | ✅ |
| `FEATURE_AUDIT_EXPORT` | | ✅ | ✅ |
| `FEATURE_LOT_TRACKING` | | ✅ | ✅ |
| `FEATURE_CONSOLIDATED_REPORTING` | | ✅ | ✅ |

---

# Appendix D. Event Catalogue

## D.1 POS Events (`pos.topic`)
`ORDER_CREATED`, `ORDER_SENT_TO_KDS`, `ORDER_CLOSED`, `ORDER_VOIDED`, `ORDER_REFUNDED`, `TILL_OPENED`, `TILL_CLOSED`

## D.2 Inventory Events (`inventory.topic`)
`STOCK_DEPLETED`, `STOCK_RECEIVED`, `LOW_STOCK_ALERT`, `EXPIRY_ALERT`, `COUNT_VARIANCE_POSTED`, `TRANSFER_SHIPPED`, `TRANSFER_RECEIVED`

## D.3 Finance Events (`finance.topic`)
`JOURNAL_POSTED`, `PERIOD_CLOSED`, `AP_PAYMENT_PROCESSED`, `EXPENSE_APPROVED`

## D.4 HR Events (`hr.topic`)
`PAYROLL_RUN_APPROVED`, `PAYROLL_RUN_PAID`, `EMPLOYEE_JOINED`, `EMPLOYEE_LEFT`

## D.5 Auth Events (`auth.topic`)
`USER_LOGIN_SUCCEEDED`, `USER_LOGIN_FAILED`, `USER_LOCKED`, `RBAC_CHANGED`, `IMPERSONATION_STARTED`, `IMPERSONATION_ENDED`

## D.6 Platform Events (`platform.topic`)
`TENANT_PROVISIONED`, `TENANT_SUSPENDED`, `TENANT_REACTIVATED`, `TENANT_CANCELLED`, `QUOTA_WARNING`, `QUOTA_EXCEEDED`

All events carry: `eventId (UUID)`, `eventType`, `tenantId`, `occurredAt (ISO8601)`, `correlationId`, `source (service name)`, `payload`.

---

# Appendix E. Phased Delivery Roadmap

## Phase 1 — Foundation (Weeks 1–4)

1. Kubernetes cluster, Helm scaffolding, CI/CD (lint → test → build → deploy-staging → e2e → prod-gate).
2. Spring Cloud Config, Eureka, API Gateway, HashiCorp Vault integration.
3. Platform Admin Service + SuperAdmin UI (tenant CRUD, feature flags, impersonation).
4. Auth Service (login, JWT/RS256, refresh, 2FA, lockout, JWKS endpoint).
5. User Service (profiles, branch assignment).
6. Authorization Service + OPA (default role policies, ABAC for branch + tenant isolation).
7. Next.js frontend shell: auth flow, API client layer (all 4 layers), branch switcher, sidebar navigation, feature flag guards.
8. Feature flag enforcement (Spring AOP `@RequiresFeature`), Hibernate tenant filter, Postgres RLS seeding.

**Deliverable:** SuperAdmin provisions a tenant in under 60 seconds. Tenant Admin logs in and sees an empty, branded dashboard.

## Phase 2 — POS + Inventory (Weeks 5–10)

9. POS Service: menu CRUD, table management, order lifecycle, payments, till sessions.
10. Offline Service Worker + IndexedDB outbox (Workbox).
11. Inventory Service: ingredients, recipes, UOM, depletion consumer.
12. Kitchen Service + KDS WebSocket.
13. Finance Service: COA seed, GL engine, order-close auto-posting consumer.
14. Reporting Service: ClickHouse setup, `sales_facts` ETL consumer, live dashboard tiles.

**Deliverable:** End-to-end order flow including inventory depletion, GL posting, and KDS operational.

## Phase 3 — Finance + Vendor (Weeks 11–16)

15. Finance Service: AP/AR, expenses, bank reconciliation, period close.
16. Purchasing Service: vendor master, PO workflow, multi-tier approval, GRN, three-way match.
17. Auto-posting consumers for all purchasing events.
18. 40 named reports (ClickHouse SQL + Reporting Service endpoints).
19. PDF/Excel export pipeline.
20. Scheduled report email delivery (cron + Notification Service).

**Deliverable:** P&L, balance sheet, AP aging, and complete PO-to-payment cycle operational.

## Phase 4 — NLQ + HR + CRM + Notifications (Weeks 17–22)

21. NLQ Service (Python FastAPI, Claude API, ClickHouse read-only, multi-tenant safeguards).
22. HR Service: employee, attendance, leave, payroll runs, payslip PDF.
23. CRM Service: customer, loyalty, promotions.
24. Notification Service: email, in-app push, WhatsApp (GROWTH+).
25. File Service (MinIO, access-controlled serving, orphan sweep).

**Deliverable:** NLQ operational. HR payroll cycle complete. Loyalty points at POS.

## Phase 5 — Hardening + Platform Polish (Weeks 23–26)

26. White-label custom domain provisioning (certbot automation, hot-reload Nginx).
27. Billing integration (Stripe webhook → tier/suspension automation).
28. SuperAdmin platform telemetry dashboard.
29. Security testing (OWASP ZAP, OPA policy audit, penetration test).
30. Performance testing (k6 load + multi-tenant isolation assertions).
31. Full observability stack (ELK, Prometheus, Grafana, Tempo, GlitchTip) dashboards and alert rules.
32. Disaster recovery drill on staging.
33. API documentation (SpringDoc OpenAPI, hosted at `/api/v1/docs`).
34. Operations runbook, user guide, onboarding materials.

**Deliverable:** Production-ready platform. First paying tenants onboarded.

---

# Document Sign-Off

| Role | Name | Date | Signature |
|---|---|---|---|
| Product Owner | | | |
| Lead Architect | | | |
| Lead Frontend Engineer | | | |
| Lead Backend Engineer | | | |
| QA Lead | | | |
| DevOps Lead | | | |

**Document version: 1.0**
**Date: June 2026**
**Status: Final draft for engineering review**

---

*End of RestaurantOS — Multi-Tenant SaaS ERP Platform: Product Requirements & Technical Specification.*
