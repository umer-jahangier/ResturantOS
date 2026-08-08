# Phase 11: HR & Payroll - Research

**Researched:** 2026-07-24
**Domain:** New `hr-service` microservice (Pakistan payroll/tax computation + ADMS/iClock biometric device ingest protocol)
**Confidence:** MEDIUM overall — service scaffolding is HIGH (grounded directly in this codebase); Pakistan tax/EOBI figures are MEDIUM (cross-validated across independent web sources, not fetched from a primary FBR/EOBI PDF this session); the ADMS wire protocol is MEDIUM (confirmed via a real open-source implementation + community write-ups, no official vendor spec was reachable).

## Summary

Phase 11 is mechanically a sibling of finance-service/purchasing-service/crm-service — same TenantAuditableEntity + outbox + idempotency_keys + processed_events + OPA scaffolding — so almost nothing needs new research there; I verified the exact classes to copy by reading them directly (`AutoPostingRecipeEngine`, `EncryptedStringConverter`/`EncryptionService`, `DefaultIdempotencyService`, `OutboxEntry`, `TenantFilterInterceptor`, `JwtGlobalFilter`, `StripInternalHeaderFilter`, `RateLimitConfig`). Infra scaffolding for hr-service (`hr_db`, `hr_user`, gateway route `/api/v1/hr/**` → `FEATURE_HR`) already exists in `deploy/init/*.sql` and `gateway/.../RouteFeatureMap.java` — do not re-create it, extend it.

The two areas that are genuinely novel for this team: (1) Pakistan salaried income-tax slabs + EOBI, which are real-world facts that change annually and must be verified against primary sources before go-live, not derived from training data alone; and (2) the ADMS/iClock biometric push protocol, which has no official public spec and no Java library — it must be hand-implemented from reverse-engineered community documentation, defensively, because field counts and exact response formats vary by firmware/vendor (ZKTeco vs eSSL vs Suprema).

The single highest-value finding from reading this codebase directly: the existing `/internal/**` convention (`X-Internal-Service` header, verified by a per-service `InternalServiceFilter`) **cannot** be reused for the device-authenticated ingest path, because the gateway's `StripInternalHeaderFilter` unconditionally strips `X-Internal-Service` from *all* external traffic before it reaches any route. `/internal/attendance/ingest` needs its own device-token/HMAC scheme, not the existing internal-secret convention, despite the confusingly similar path prefix mandated by the spec.

**Primary recommendation:** Build hr-service as a byte-for-byte sibling of finance-service/crm-service for everything except the ADMS adapter (which is genuinely new protocol work — isolate it in its own `adms` package) and the tax/EOBI math (isolate in its own `payroll/tax` package reading a `tax_config` table, never hardcoded rates). Verify the Pakistan tax slab and EOBI figures below against FBR's First Schedule and eobi.gov.pk (or an accountant) before the seed data goes anywhere near production payroll.

## Standard Stack

### Core (all already in this repo — reuse, do not reinvent)
| Component | Source | Purpose | Why Standard |
|---|---|---|---|
| `TenantAuditableEntity` | `shared-lib` | Base JPA entity | Every tenant table in every service extends this |
| `EncryptedStringConverter` + `EncryptionService` | `shared-lib/security` | AES-256-GCM field encryption | Exact pattern used for `users.totp_secret`; reuse verbatim for `employees.cnic` / `employees.bank_account_no` |
| `DefaultIdempotencyService` / `IdempotencyKey` | `shared-lib/idempotency` | `Idempotency-Key` header handling on mutating endpoints | Used by every service for `POST` create/approve endpoints; use on `POST /payroll-runs` |
| `OutboxEntry` + relay poller | `shared-lib/event` | Transactional outbox → RabbitMQ | `findTop200ByStatusOrderByCreatedAtAsc` poller pattern already proven; publish `EMPLOYEE_JOINED`, `EMPLOYEE_LEFT`, `PAYROLL_RUN_APPROVED`, `PAYROLL_RUN_PAID`, `ATTENDANCE_PUNCHED` through it |
| `ProcessedEventService` (per-service copy) | copy pattern from `finance`/`crm`/`audit` | Consumer-side event de-dup | hr-service needs its own copy if it consumes any events (e.g. revenue from pos-service for labour-cost %) |
| `TenantAwareMessageProcessor` | `shared-lib/tenant` | Sets `TenantContext` + RLS GUC before processing a consumed AMQP event | Use for any RabbitMQ consumer in hr-service |
| `TenantFilterInterceptor` + `TenantAwareDataSource` | `shared-lib/tenant` | Sets Hibernate filter + Postgres RLS GUC per HTTP request from `TenantContext` | Normal HTTP requests get `TenantContext` populated from the gateway's `X-Tenant-Id` header; **the ADMS/device-ingest path has no such header and must set `TenantContext` manually** (see Pitfalls) |
| OpenFeign clients | per-service `feign` package | Internal sync calls (e.g. pull POS revenue for labour-cost %) | Same pattern as finance-service's Feign clients |
| OPA / Rego | `policies/restaurantos/*.rego` + `*_test.rego` | Authorization | Add `hr.rego` + `hr_test.rego` next to `vendor.rego` (26 lines, small/simple — good size reference) |

### Supporting
| Component | Purpose | When to use |
|---|---|---|
| Spring `@Scheduled` (already in Spring Boot, no new dep) | Leave accrual (monthly), payroll-eligible-punch aggregation | Standard, nothing to add to the POM |
| Spring Cloud Gateway `RequestRateLimiter` + a new `KeyResolver` bean | Per-device rate limiting on `/iclock/**` | Redis-backed limiter is already wired (`gateway/.../RateLimitConfig.java` has `ipKeyResolver`); add a `deviceKeyResolver` keyed on the `SN` query param, don't add a new rate-limit library |
| `MediaType.TEXT_PLAIN` Spring MVC controller | ADMS endpoints | The protocol is plain-text/tab-delimited, not JSON — do not wrap it in the service's normal `@RestController` JSON conventions |

### Alternatives Considered (deliberately rejected)
| Instead of | Could use | Why rejected |
|---|---|---|
| Hand-rolled ADMS parser | A Java ADMS/ZKTeco library | None exists with real adoption; the only maintained OSS implementations are in Go (`s0x90/zkteco-adms`, MIT, 14★/6 forks — small but real). Port the *shape*, not the code. |
| tax_config-driven slab math | A generic tax-calculation library (e.g. a "payroll" SaaS SDK) | No such library covers Pakistan FBR slabs; the math itself is trivial (a sorted list of cumulative-bracket rows) — building it is strictly less risk than adopting an unmaintained wrapper |
| Device-token HMAC scheme | Reusing `X-Internal-Service` / `InternalServiceFilter` | Gateway's `StripInternalHeaderFilter` strips that header from **all** external traffic — it structurally cannot reach hr-service on the public ADMS path |

**Installation:** no new Maven/npm dependencies are required beyond what finance-service/crm-service already declare (Spring Web, Spring AMQP, Spring Data JPA, `shared-lib`). Do not add a ZKTeco SDK jar — the device does the biometric matching, the server only parses text.

## Architecture Patterns

### Recommended Module Layout (mirrors finance-service / crm-service)
```
services/hr-service/src/main/java/io/restaurantos/hr/
├── config/                 # SharedAutoConfiguration wiring, RabbitMQ topology, Feign config
├── domain/ or entity/      # Employee, PayrollRun, Payslip, Shift, ShiftAssignment,
│                           #   LeaveType, LeaveRequest, LeaveBalance, AttendanceDevice,
│                           #   AttendancePunch, TaxConfig (+ AttendanceQuarantine)
├── dto/                    # request/response records
├── repository/             # Spring Data JPA repositories
├── service/                # EmployeeService, ShiftService, AttendanceService,
│                           #   LeaveService, PayrollRunService, LabourCostService
├── payroll/tax/            # TaxConfigService + SlabTaxCalculator + EobiCalculator
│                           #   (config-driven, no hardcoded rates — see Code Examples)
├── adms/                   # AdmsController (/iclock/*), AttlogLineParser,
│                           #   DeviceAuthResolver, DeviceCommandQueueService
├── controller/              # public REST API (employees, shifts, attendance, leave, payroll)
├── controller/internal/     # /internal/hr/** — genuine service-to-service (labour-cost pull etc.)
├── consumer/                # any inbound event consumers (e.g. revenue events for labour-cost %)
├── feign/                   # PosServiceClient / FinanceServiceClient etc.
└── seed/                    # demo employees, tax_config FY2025-26 seed row, demo devices
```

### Pattern 1: HR publishes events, Finance owns the ledger (mirror `AutoPostingRecipeEngine`)
**What:** hr-service never calls `JournalEntryService` directly. It publishes `PAYROLL_RUN_APPROVED` on approval and `PAYROLL_RUN_PAID` on disbursement through the outbox; finance-service's `AutoPostingRecipeEngine` (`services/finance-service/.../autopost/AutoPostingRecipeEngine.java:20`) gets two new methods (`postPayrollApproved`, `postPayrollPaid`) added next to `postOrderRevenue`/`postWastage`, wired through a new `PayrollApprovedConsumer` / `PayrollPaidConsumer` that follow `OrderClosedConsumer`'s exact shape (RabbitListener → `ProcessedEventService.tryProcess` → recipe method).
**Why:** this is the established, already-proven idempotent event→JE seam in this codebase (`PostedSourceEventRepository.existsByTenantIdAndSourceTypeAndSourceId` guards double-posting exactly like `alreadyPosted()` does today for orders/wastage/transfers).
**Example (new recipe methods, same file/style as existing ones):**
```java
// services/finance-service/.../autopost/AutoPostingRecipeEngine.java
static final String SOURCE_PAYROLL_APPROVED = "PAYROLL_APPROVED";
static final String SOURCE_PAYROLL_PAID     = "PAYROLL_PAID";

public void postPayrollApproved(EventEnvelope<Map<String, Object>> envelope) {
    Map<String, Object> p = envelope.payload();
    UUID runId = uuid(p, "runId");
    if (alreadyPosted(SOURCE_PAYROLL_APPROVED, runId)) return;

    long grossPaisa = longVal(p, "totalGrossPaisa");
    if (grossPaisa <= 0) return;

    List<CreateJeLineRequest> lines = List.of(
            line("6200", "Salary expense", grossPaisa, 0),         // DR Salary Expense
            line("2300", "Wages payable", 0, grossPaisa));          // CR Wages Payable

    post(SOURCE_PAYROLL_APPROVED, runId, envelope, "Payroll approved " + runId, lines);
}

public void postPayrollPaid(EventEnvelope<Map<String, Object>> envelope) {
    Map<String, Object> p = envelope.payload();
    UUID runId = uuid(p, "runId");
    if (alreadyPosted(SOURCE_PAYROLL_PAID, runId)) return;

    long netPaisa = longVal(p, "totalNetPaisa");
    if (netPaisa <= 0) return;

    List<CreateJeLineRequest> lines = List.of(
            line("2300", "Wages payable", netPaisa, 0),             // DR Wages Payable
            line(accountResolver.codeBySystemTag("BANK"), "Payroll disbursement", 0, netPaisa)); // CR Bank

    post(SOURCE_PAYROLL_PAID, runId, envelope, "Payroll paid " + runId, lines);
}
```
Account codes 6200/2300/1100(BANK) are locked by the CONTEXT.md decision and the spec's §11 account map — use `accountResolver.codeBySystemTag("BANK")` rather than hardcoding `1100` directly, matching how the existing recipes resolve CASH/BANK (see `addPaymentDebits`), so a tenant-specific chart-of-accounts remap still works.

### Pattern 2: `tax_config` is data, not code
**What:** one row per fiscal year holding the slab table (JSONB array of `{minPaisa, maxPaisa, baseTaxPaisa, ratePct}`) and EOBI parameters. A single `SlabTaxCalculator.computeAnnualTax(annualIncomePaisa, List<TaxSlab>)` walks the sorted list and returns tax — no `if/else` chain of hardcoded numbers anywhere in Java.
**When:** every payroll run computation call reads the `tax_config` row matching the run's `period_year` (spec explicitly says "updated annually via config, not code").
**Example:** see Code Examples section below for the full seed row.

### Pattern 3: ADMS ingest as an isolated, protocol-literal adapter
**What:** `AdmsController` in its own package, returning raw `text/plain` bodies (not `@RestController` JSON), doing exactly 4 things: (a) handshake config response on `GET /iclock/cdata?SN=`, (b) parse+persist on `POST /iclock/cdata?SN=&table=ATTLOG`, (c) serve the (usually empty) command queue on `GET /iclock/getrequest?SN=`, (d) accept command-ack on `POST /iclock/devicecmd?SN=`.
**Critical step inside every one of these 4 handlers, before touching any repository:** resolve `serial → device_token → branch_id → tenant_id` from `attendance_devices`, verify the device token/HMAC, reject unknown/inactive serials, and **manually call `tenantContext.setTenantId(...)` / set branch** — because unlike a normal HTTP request, there is no `X-Tenant-Id` header (no JWT went through the gateway) to trigger `TenantFilterInterceptor`. Build a small `DeviceAuthResolver` that does this once per request, structurally mirroring what `TenantAwareMessageProcessor` does for AMQP consumption, but for the HTTP path.

### Pattern 4: Gateway wiring for the device-authenticated path class
- Add `/iclock` and `/internal/attendance/ingest` to `JwtGlobalFilter.PUBLIC_PATHS` (`gateway/.../filter/JwtGlobalFilter.java:49`) so the gateway does not demand a Bearer token on this path — **this only skips JWT, it must not skip authentication entirely**; hr-service's `DeviceAuthResolver` (Pattern 3) is the actual auth boundary.
- Verify `/iclock/**` still passes through `FeatureFlagGlobalFilter` un-exempted so `FEATURE_HR` still gates it (device pushes to a tenant with HR disabled should be rejected) — do **not** add it to that filter's own public-path allowlist.
- Add a `deviceKeyResolver` `KeyResolver` bean next to `ipKeyResolver` in `RateLimitConfig.java`, keyed on the `SN` query parameter, and attach a `RequestRateLimiter` filter to the `/iclock/**` route in `application.yml`/route config — reuses the existing Redis-backed limiter infra.
- Do **not** route `/internal/attendance/ingest` (Mode B, from the USB bridge agent) through the existing per-service `InternalServiceFilter`/`X-Internal-Service` convention — the gateway's `StripInternalHeaderFilter` (`gateway/.../filter/StripInternalHeaderFilter.java`) removes that header from every external request unconditionally, before routing. This path needs the *same* `DeviceAuthResolver` device-token scheme as `/iclock/*`, not the internal-service-secret scheme, despite the `/internal/` prefix in its name (that prefix is the spec's naming choice, not a signal to reuse the existing internal-only convention).

### Pattern 5: USB bridge agent is out-of-JVM
The Mode B bridge agent (Windows service/tray app, vendor SDK, local 1:N match, `wss://127.0.0.1:{port}` for the local POS browser tab, HTTPS POST to the platform ingest endpoint, offline buffering) is a **separate deliverable outside hr-service's codebase** — hr-service only needs to expose the same device-authenticated ingest endpoint Mode A uses (or a near-identical `/internal/attendance/ingest` variant) and treat both modes identically once a punch record arrives. Do not build agent code as part of this phase's Java service; scope it as a distinct component (language/platform TBD, likely a small Node/Rust/.NET tray binary) if the planner schedules it.

### Anti-Patterns to Avoid
- **HR writing its own JE / GL row:** breaks the single-ledger-owner invariant finance-service enforces everywhere else. Always publish → let finance's recipe engine post.
- **Hardcoding 2025-26 tax numbers in Java `if` statements:** violates the explicit spec requirement ("updated annually via config, not code") and this phase's whole reason to have `tax_config`.
- **Computing EOBI off `employees.basic_salary_paisa`:** EOBI is legally based on the **minimum wage**, not actual salary (see Pakistan Tax & EOBI Reference below) — a very easy, very wrong shortcut to take.
- **Trusting the gateway alone to protect `/iclock/*`:** it only skips JWT; real authentication is the device-token check inside hr-service.
- **Treating an unmapped device punch as an error to reject outright:** spec requires quarantine-and-continue, not drop — an admin maps it later.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Field encryption for `cnic`/`bank_account_no` | A new AES helper | `shared-lib` `EncryptedStringConverter` + `EncryptionService` (`AES/GCM/NoPadding`, 12-byte IV, 128-bit tag) | Already implemented, already tested (`EncryptionServiceTest`), fails fast on missing/short key via `EncryptionProperties.validate()` |
| `Idempotency-Key` header handling on `POST /payroll-runs` | A custom dedup table | `shared-lib` `DefaultIdempotencyService` (`checkAndLock`/`markComplete`/`getCompletedResponse`) | Same 24h TTL semantics every other service already uses |
| Outbox → RabbitMQ delivery | A new publisher/poller | `shared-lib` `OutboxEntry` + existing relay poller pattern | Transactional-outbox correctness is already solved; don't re-derive it |
| Event consumer de-dup | Rolling your own "have I seen this eventId" check | Copy the ~15-line `ProcessedEventService` pattern used identically in `finance`, `crm`, `audit` | Trivial, proven, and keeps the per-service `processed_events` table convention consistent |
| Per-device rate limiting on `/iclock/*` | A new limiter (Bucket4j, in-memory counters) | Spring Cloud Gateway `RequestRateLimiter` + a new `deviceKeyResolver` `KeyResolver` bean (Redis already backing `ipKeyResolver`) | Infra is already deployed and wired; only the key function differs |
| TOTP step-up for payroll approval | A new 2FA check | Auth-service's existing `TwoFactorService` / step-up login flow (see `TotpFlowIT`, `StepUpLoginIT`) — mirror how finance's period-close gates on TOTP | Consistent UX and one less TOTP implementation to secure |
| RBAC / tenant+branch isolation checks | Java `if` permission checks | OPA `hr.rego` next to `vendor.rego`/`finance.rego`/`pos.rego` in `policies/restaurantos/` | Matches every other service; keeps authorization centrally auditable and testable via `*_test.rego` |
| ADMS/iClock protocol parsing | — (nothing to reuse) | Hand-implement, defensively, in an isolated `adms` package | No Java library exists; only OSS reference is a small Go project. This is legitimately "build," not "don't build" — call it out so the planner doesn't waste time searching for a library that isn't there |
| Slab tax math | A generic tax-calc library | A ~30-line `SlabTaxCalculator` walking `tax_config`'s slab rows | No library covers Pakistan-specific FBR slabs; the arithmetic itself is trivial and safer to own |

**Key insight:** everything about *being a tenant-isolated, outbox-driven, idempotent microservice* is solved in this codebase already — copy it. Everything about *Pakistan payroll law* and *ADMS wire format* is genuinely new — isolate it tightly (own packages, own tests, config-driven where the law changes) so it can be corrected without touching the scaffolding.

## Common Pitfalls

### Pitfall 1: Reusing the internal-service-secret convention for device ingest
**What goes wrong:** `/internal/attendance/ingest` gets wired with the same `X-Internal-Service` + `InternalServiceFilter` pattern used everywhere else for `/internal/**`.
**Why it happens:** the path literally starts with `/internal/`, and every other `/internal/**` route in this codebase uses that exact convention (see `CrmInternalServiceFilter`, `FinanceInternalServiceFilter`, etc.) — it's the obvious copy-paste.
**How to avoid:** the gateway's `StripInternalHeaderFilter` removes `X-Internal-Service` from **all** external traffic before routing (`gateway/.../filter/StripInternalHeaderFilter.java`, runs at `HIGHEST_PRECEDENCE + 5`, i.e. before JWT even runs). A USB bridge agent posting from a branch PC is external traffic. Build a distinct device-token/HMAC scheme (same one `/iclock/*` uses) for this path instead.
**Warning signs:** integration tests for Mode B ingest pass locally (calling hr-service directly) but 403 through the real gateway — that's this bug.

### Pitfall 2: RLS/tenant-context gap on the ADMS path
**What goes wrong:** `AdmsController` handlers call the repository directly; either FORCE RLS blocks every insert (fails safe but breaks the feature) or — worse — some ambient `TenantContext` from a previous request leaks in a pooled-thread scenario.
**Why it happens:** every other controller in this codebase gets `TenantContext` populated by `TenantFilterInterceptor`, which reads it from `X-Tenant-Id` (set by the gateway from JWT claims). The ADMS path has no JWT and no `X-Tenant-Id`.
**How to avoid:** resolve tenant/branch from `attendance_devices` by serial number first, then explicitly `tenantContext.setTenantId(...)` (and branch) before any repository call, inside a small resolver used by all 4 ADMS handlers plus the Mode B ingest handler.
**Warning signs:** works in a single-tenant dev/test setup, breaks or cross-leaks under multi-tenant load testing.

### Pitfall 3: Idempotency-keys-table overkill for high-volume punches
**What goes wrong:** reusing `DefaultIdempotencyService`/`idempotency_keys` (designed for low-volume API mutations) for every biometric punch, adding a full extra round trip per punch at potentially thousands/day/branch.
**How to avoid:** `attendance_punches` already has `UNIQUE (device_id, device_user_ref, device_reported_at)` per spec — use a native `INSERT ... ON CONFLICT DO NOTHING` (or catch `DataIntegrityViolationException` and treat as a successful no-op) as the idempotency mechanism for punches specifically. Reserve `idempotency_keys` for the payroll-run and other low-frequency mutating endpoints.

### Pitfall 4: EOBI computed off actual salary instead of minimum wage
**What goes wrong:** `EobiCalculator` reads `employees.basic_salary_paisa` instead of `tax_config.eobi_wage_base_paisa`.
**Why it happens:** it's the intuitively "obvious" field to reach for, and most other deduction math (income tax) *does* use actual salary, so it's easy to assume EOBI does too.
**How to avoid:** EOBI in Pakistan is legally a percentage of the **notified minimum wage**, not the employee's actual pay — every employee in a covered establishment contributes the same fixed EOBI amount regardless of salary level (see Reference section below). Model `eobi_wage_base_paisa` as its own `tax_config` field, independent of any employee's salary.

### Pitfall 5: Tax proration on mid-month joiners/leavers vs. annualized slab math
**What goes wrong:** naively prorating the *annual tax* by days-worked-in-month produces a different (and generally wrong) number than prorating *gross pay* then re-annualizing.
**Why it happens:** Pakistan salary withholding (FBR Section 149-style employer withholding) is normally computed by annualizing the *employee's regular monthly rate* (not the partial-month actual), taxing that annual estimate via the slabs, then taking the monthly (or remaining-months) equivalent — proration of the *cash paid* for a partial month is a separate step from the *tax-rate* calculation.
**How to avoid:** prorate `basic_salary_paisa` + allowances by days-worked to get the month's gross pay; separately, compute the *tax rate* using the employee's full monthly rate × 12 (annualized on the *regular* rate, not the prorated gross) run through the slabs ÷ 12, then apply that monthly tax amount (further prorated by days-worked, in most conventional implementations) to the actual prorated gross. This is a genuinely fiddly area — implement the simplest defensible version (annualize regular rate → slab → ÷12 → prorate by days) and flag it explicitly for accountant sign-off; do not treat this research as the final word on FBR withholding mechanics.
**Confidence:** LOW on the exact proration convention — VERIFY WITH ACCOUNTANT.

### Pitfall 6: ATTLOG field-count/format variance across firmware
**What goes wrong:** hardcoding "the ATTLOG line always has exactly N tab-separated fields" breaks the first time a different device model/firmware sends 4, 5, or 9 fields (PIN/DateTime/Status/Verify/WorkCode plus vendor-specific reserved fields are common, but not universal).
**How to avoid:** parse the first 4-5 known fields positionally, ignore/log-and-ignore anything beyond that; never throw on "too many fields," only on "too few to identify PIN+time."

### Pitfall 7: `payroll_runs` uniqueness may not match "per branch" runs
**What goes wrong:** the spec's own `payroll_runs` DDL (§M8.3) declares `UNIQUE (tenant_id, period_month, period_year)` — i.e. **one payroll run per tenant per month**, with `branch_id` nullable/informational — but HR-06 wants labour-cost tracked **by branch**, and a multi-branch tenant plausibly wants to run payroll per branch (different pay dates, different managers approving).
**How to avoid:** this is a genuine open question the planner needs to resolve explicitly, not something research can answer from the docs alone — confirm with the CONTEXT.md author/user whether the literal spec DDL (`tenant`-level uniqueness) is intentional, or whether it should be `UNIQUE (tenant_id, branch_id, period_month, period_year)` to support real per-branch runs. Flagged in Open Questions.

## Code Examples

### `tax_config` schema + FY2025-26 seed row
```sql
CREATE TABLE tax_config (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  fiscal_year           INTEGER NOT NULL,          -- FBR "Tax Year", e.g. 2026 for Jul-2025..Jun-2026
  effective_from         DATE NOT NULL,
  effective_to           DATE NOT NULL,
  income_tax_slabs      JSONB NOT NULL,            -- see shape below; cumulative-bracket rows
  surcharge_threshold_paisa BIGINT,                -- taxable income above which surcharge applies
  surcharge_rate_pct    NUMERIC(5,2),               -- applied to tax payable, not income
  eobi_employer_rate_pct NUMERIC(5,2) NOT NULL,
  eobi_employee_rate_pct NUMERIC(5,2) NOT NULL,
  eobi_wage_base_paisa  BIGINT NOT NULL,            -- statutory minimum wage, NOT employee salary
  proration_method       TEXT NOT NULL DEFAULT 'ANNUALIZE_REGULAR_RATE',
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (tenant_id, fiscal_year)
);

-- Seed row — VERIFY against FBR First Schedule / eobi.gov.pk before production use.
INSERT INTO tax_config (
  tenant_id, fiscal_year, effective_from, effective_to,
  income_tax_slabs, surcharge_threshold_paisa, surcharge_rate_pct,
  eobi_employer_rate_pct, eobi_employee_rate_pct, eobi_wage_base_paisa
) VALUES (
  :tenant_id, 2026, '2025-07-01', '2026-06-30',
  '[
    {"minPaisa": 0,          "maxPaisa": 60000000,   "baseTaxPaisa": 0,        "ratePct": 0.0},
    {"minPaisa": 60000000,   "maxPaisa": 120000000,  "baseTaxPaisa": 0,        "ratePct": 1.0},
    {"minPaisa": 120000000,  "maxPaisa": 220000000,  "baseTaxPaisa": 600000,   "ratePct": 11.0},
    {"minPaisa": 220000000,  "maxPaisa": 320000000,  "baseTaxPaisa": 11600000, "ratePct": 23.0},
    {"minPaisa": 320000000,  "maxPaisa": 410000000,  "baseTaxPaisa": 34600000, "ratePct": 30.0},
    {"minPaisa": 410000000,  "maxPaisa": null,        "baseTaxPaisa": 61600000, "ratePct": 35.0}
  ]'::jsonb,
  1000000000,   -- Rs 10,000,000 (1 crore) surcharge threshold, on TAX not income
  9.0,
  5.0,           -- EOBI employer 5%
  1.0,           -- EOBI employee 1%
  3700000        -- Rs 37,000/month minimum wage, in paisa
);
```
(Amounts in paisa, consistent with the rest of the codebase's `*_paisa` `BIGINT` convention seen in `finance.model.ts` / `AutoPostingRecipeEngine`.)

### `SlabTaxCalculator` sketch
```java
public long computeAnnualTax(long annualTaxableIncomePaisa, List<TaxSlab> slabs) {
    TaxSlab bracket = slabs.stream()
        .filter(s -> annualTaxableIncomePaisa >= s.minPaisa()
                  && (s.maxPaisa() == null || annualTaxableIncomePaisa < s.maxPaisa()))
        .findFirst()
        .orElseThrow(() -> new IllegalStateException("No matching tax slab for income"));
    long excess = annualTaxableIncomePaisa - bracket.minPaisa();
    long tax = bracket.baseTaxPaisa() + Math.round(excess * bracket.ratePct() / 100.0);
    return tax; // apply surcharge separately if annualTaxableIncomePaisa > surcharge_threshold_paisa
}
```

### ATTLOG parse pseudo-code (defensive)
```java
// POST /iclock/cdata?SN=AC123456789&table=ATTLOG
// Body: one record per line, tab-separated. Field count varies by firmware;
// only the first 4 are load-bearing.
for (String rawLine : body.split("\n")) {
    String[] f = rawLine.strip().split("\t");
    if (f.length < 4) { log.warn("Short ATTLOG line, skipping: {}", rawLine); continue; }
    String deviceUserRef = f[0];                       // PIN
    Instant deviceReportedAt = parseDeviceTimestamp(f[1]); // "yyyy-MM-dd HH:mm:ss", device-local (Asia/Karachi, no DST)
    String status = f[2];                               // 0/1 in/out, vendor-specific beyond that
    String verifyMode = f[3];                            // fingerprint/card/face — informational only
    // f[4]+ (WorkCode, reserved) — ignore if present, don't fail if absent

    punchIngestService.ingest(resolvedDevice, deviceUserRef, deviceReportedAt, mapStatus(status), rawRecordId(f));
}
return ResponseEntity.ok("OK"); // devices generally expect a bare "OK" text body
```

### iClock handshake response (indicative — verify against the actual device's admin manual before deploying)
```
GET /iclock/cdata?SN=AC123456789 HTTP/1.1
→ 200 OK, Content-Type: text/plain

Stamp=9999
OpStamp=9999
ErrorDelay=30
Delay=10
TransTimes=00:00;14:05
TransInterval=1
TransFlag=1111000000
Realtime=1
Encrypt=0
```

### Idempotent punch insert (native, avoids `idempotency_keys` overhead — Pitfall 3)
```sql
INSERT INTO attendance_punches
  (id, tenant_id, branch_id, device_id, employee_id, device_user_ref,
   punch_type, device_reported_at, server_received_at, source_record_id)
VALUES (gen_random_uuid(), :tenantId, :branchId, :deviceId, :employeeId, :deviceUserRef,
        :punchType, :deviceReportedAt, now(), :sourceRecordId)
ON CONFLICT (device_id, device_user_ref, device_reported_at) DO NOTHING;
```

### `payslips.deductions_json` shape (per spec §M8.3)
```json
{
  "income_tax_paisa": 966700,
  "eobi_employee_paisa": 37000,
  "advances_paisa": 500000,
  "late_arrival_paisa": 120000,
  "other": {}
}
```

### Gateway `PUBLIC_PATHS` diff (JwtGlobalFilter.java)
```java
private static final List<String> PUBLIC_PATHS = List.of(
        "/api/v1/auth/login",
        "/api/v1/auth/refresh",
        "/api/v1/auth/reset-password",
        "/api/v1/auth/tenants",
        "/.well-known",
        "/actuator/health",
        "/actuator/prometheus",
        "/fallback",
        "/iclock",                       // NEW — device-authenticated, not JWT
        "/internal/attendance/ingest"    // NEW — device-authenticated (NOT the X-Internal-Service convention)
);
```

## Pakistan Tax & EOBI Reference

### Salaried individual income-tax slabs, Tax Year 2026 / FY 2025-26 (post Finance Act 2025)
| Annual taxable income (PKR) | Tax |
|---|---|
| 0 – 600,000 | 0% |
| 600,001 – 1,200,000 | 1% of amount exceeding 600,000 |
| 1,200,001 – 2,200,000 | 6,000 + 11% of amount exceeding 1,200,000 |
| 2,200,001 – 3,200,000 | 116,000 + 23% of amount exceeding 2,200,000 |
| 3,200,001 – 4,100,000 | 346,000 + 30% of amount exceeding 3,200,000 |
| Above 4,100,000 | 616,000 + 35% of amount exceeding 4,100,000 |

Plus a **9% surcharge on the tax payable** (not on income) where annual taxable income exceeds **Rs 10,000,000 (1 crore)**.

**Confidence: MEDIUM.** The 0%/1%/11%/23%/30% bands and their cumulative fixed amounts (0 / 6,000 / 116,000 / 346,000) were returned identically by two independently-worded WebSearch queries and are internally mathematically consistent (each bracket's fixed amount equals the prior bracket's cumulative tax at its ceiling). The "above 4,100,000" fixed amount (616,000) was *not* directly quoted by any source — it's derived by the same continuity check (346,000 + 30% × 900,000 = 616,000) and should be treated as computed, not sourced. One early search result surfaced a different, internally-*inconsistent* set of fixed amounts (430,000/700,000) that turned out to match the *prior year's* (Tax Year 2025) table — a real trap if copied uncritically; this research rejected those numbers because they fail the continuity check against the (confirmed) lower-band figures. **VERIFY WITH ACCOUNTANT / against FBR's Income Tax Ordinance 2001 First Schedule Division I Part I before this seed row reaches a real payroll run.**

Sources (WebSearch, cross-checked): ict.edu.pk, hisaabkar.pk, waystax.com, befiler.com — none is FBR.gov.pk directly (a direct FBR PDF fetch attempted this session 404'd); KPMG's "Budget Brief 2025" PDF (assets.kpmg.com) was located but not successfully parsed for the full table — worth fetching directly if greater certainty is needed before go-live.

### EOBI (Employees' Old-Age Benefits Institution)
| Parameter | Value | Confidence |
|---|---|---|
| Employer contribution | 5% of wage base | MEDIUM — multiple independent sources agree, including a snippet citing eobi.gov.pk's own financial-data PDF ("CONTRIBUTION RATE: EMPLOYER 5% EMPLOYEE 1%") |
| Employee contribution | 1% of wage base | MEDIUM — same sources |
| Wage base | **Federal statutory minimum wage**, currently PKR 37,000/month — **not** the employee's actual salary | MEDIUM — this is the single most important EOBI fact for correct implementation (see Pitfall 4); direct eobi.gov.pk fetch failed (SSL error) this session, so treat as needing a final confirmation pass |
| Resulting monthly amounts | Employer: PKR 1,850/employee; Employee: PKR 370/employee; Total: PKR 2,220/employee | Derived arithmetic from the above — same confidence as the rate/base inputs |
| Eligibility | Mandatory for commercial/industrial establishments with **5 or more employees** (counting contract/part-time staff); registration required within 30 days of reaching the threshold; insured-person age range 18-60 (men) / 18-55 (women); government employees, armed forces, and most agricultural/domestic workers excluded | MEDIUM — consistent across several sources (paypeople.pk, business.gov.pk, eobi.gov.pk's own "Registration of Establishments" page referenced in results) |

**VERIFY WITH ACCOUNTANT:** whether the minimum wage figure has been revised for the FY2025-26 federal budget (minimum wage is typically re-notified with each federal budget in June) — sources this session consistently cited PKR 37,000 as still current for 2026, but this is exactly the kind of figure `tax_config` exists to let a tenant correct without a code deploy.

### PESSI / SESSI / provincial social security (config shape only, per CONTEXT.md — deferred implementation)
Provincial social-security institutions (PESSI — Punjab, SESSI — Sindh, and KP/Balochistan equivalents) exist alongside federal EOBI, are typically **employer-only** contributions on a wage-ceiling basis, and vary by province and change independently of federal law. **Confidence: LOW — not independently verified this session; training-data-level knowledge only.** Per CONTEXT.md, this phase should capture the *shape* (extra nullable/JSON fields on `tax_config` or a sibling `provincial_contribution_config` table keyed by province) without implementing province-specific math — do not attempt to seed real PESSI/SESSI rates without dedicated research when that work is scheduled.

### ADMS / iClock protocol
| Fact | Confidence | Source |
|---|---|---|
| Four core endpoints: `GET/POST /iclock/cdata`, `GET /iclock/getrequest`, `POST /iclock/devicecmd` (plus a `/iclock/registry` seen in one implementation) | MEDIUM-HIGH | Confirmed by a real, MIT-licensed OSS implementation (`github.com/s0x90/zkteco-adms`, Go, ~60 commits) that implements exactly these endpoints against real ZKTeco devices |
| ATTLOG record is tab-separated text, fields include PIN, timestamp, status, verify-mode (field count/order varies by firmware — treat as MIN 4 stable fields, more may follow) | MEDIUM | Same OSS project + a second independent community write-up (LinkedIn protocol article), roughly agreeing on field semantics though not identical field-naming |
| Handshake response is a line-based `key=value` config block (`Stamp`, `OpStamp`, `Delay`, `TransTimes`, `Realtime`, `Encrypt`, etc.) | LOW-MEDIUM | Not independently re-confirmed via a live fetch this session (attempts to reach vendor/community docs describing this exact block failed or were inconclusive) — this is training-data-level knowledge of the widely-implemented convention. Treat the example in Code Examples as a starting shape to validate against an actual device (or its admin manual) during implementation, not as gospel. |
| The protocol has **no official published spec** — all implementations are reverse-engineered | HIGH | Stated explicitly by the community write-up and corroborated by the absence of any vendor developer-portal spec surfaced in search |
| No Java library exists for this protocol | MEDIUM-HIGH | Search turned up only a Go implementation and scattered PHP/Python gists; nothing resembling a maintained Java library |
| A *different*, older ZKTeco protocol (binary/TCP, "standalone device" protocol used by the offline SDK) is well-documented (`github.com/adrobinoga/zk-protocol`) but is **not** the same thing as ADMS/iClock HTTP push — do not confuse the two when researching further | HIGH | Read directly; the repo's own documentation explicitly scopes itself to the standalone/TCP protocol, not ADMS |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Pre-Finance-Act-2025 salary slabs (5%/15%/25%/30%/35%, first bracket starting at 5%) | Finance Act 2025 slabs (1%/11%/23%/30%/35%, same bracket boundaries) | Budget FY2025-26 (June 2025) | Materially lower withholding for salaried employees in the 600k-2.2M band — do not seed the old rates by mistake, they are the exact numbers that showed up as a false lead during this research (see Reference section) |
| Surcharge 10% above Rs 10M (pre-2025) | Surcharge 9% above Rs 10M (Finance Act 2025); reportedly removed entirely for Finance Act 2026 (i.e. Tax Year 2027, not yet in effect) | Budget FY2025-26 | `tax_config.surcharge_rate_pct` must be a config field precisely because this keeps moving year to year |

**Deprecated/outdated:** none relevant to the stack itself — this whole domain (Pakistan tax law) is inherently "current-year-only," which is exactly why the spec mandates config-driven, not hardcoded, computation.

## Open Questions

1. **Is `payroll_runs` really one-per-tenant-per-month, or should it be one-per-branch-per-month?**
   - What we know: the spec's literal DDL (§M8.3) has `UNIQUE (tenant_id, period_month, period_year)` with `branch_id` present but nullable/unconstrained.
   - What's unclear: HR-04/05/06 all operate per-branch (shift scheduling, attendance, labour-cost %), so a multi-branch tenant plausibly needs independent per-branch payroll runs with independent approval.
   - Recommendation: confirm with the user before planning locks the schema; if per-branch runs are needed, the UNIQUE constraint should become `(tenant_id, branch_id, period_month, period_year)` with `branch_id NOT NULL`.

2. **Exact tax-proration convention for mid-month joiners/leavers.**
   - What we know: the general FBR withholding pattern is "annualize the regular rate → slab → divide by remaining months," but the precise handling of a *partial first/last month's* gross pay interacting with that annualization is genuinely ambiguous without a primary FBR circular or accountant sign-off.
   - Recommendation: implement the simplest defensible version (see Pitfall 5), expose `proration_method` as a `tax_config` field so it can be swapped without code changes, and treat correctness here as accountant-reviewed, not research-verified.

3. **Exact ADMS handshake response field set for the specific device hardware the client will actually deploy (ZKTeco vs eSSL vs Suprema).**
   - What we know: the four endpoints and general shape are confirmed; the precise handshake config keys/values are reconstructed from training knowledge and partial community sources, not independently re-verified live.
   - Recommendation: build the adapter defensively (tolerate missing/extra keys), and validate against the actual device model's admin manual or a live device in a dev environment before relying on it for a real deployment — this is exactly the kind of thing worth a dedicated integration-test pass with real (or emulated) hardware.

4. **PESSI/SESSI concrete rates** — explicitly deferred per CONTEXT.md; flagged here only so the planner doesn't accidentally schedule real provincial-rate implementation under the impression this research covered it (it only covers the config shape, not the numbers).

## Sources

### Primary / codebase-grounded (HIGH confidence)
- `shared-lib/src/main/java/io/restaurantos/shared/security/{EncryptionService,EncryptedStringConverter}.java` — read directly
- `shared-lib/src/main/java/io/restaurantos/shared/idempotency/DefaultIdempotencyService.java` — read directly
- `shared-lib/src/main/java/io/restaurantos/shared/event/OutboxEntry.java` — read directly
- `shared-lib/src/main/java/io/restaurantos/shared/tenant/TenantFilterInterceptor.java` — read directly
- `services/finance-service/src/main/java/io/restaurantos/finance/autopost/AutoPostingRecipeEngine.java` — read directly (via codegraph_explore)
- `gateway/src/main/java/io/restaurantos/gateway/filter/{JwtGlobalFilter,StripInternalHeaderFilter}.java` — read directly
- `gateway/src/main/java/io/restaurantos/gateway/config/{GatewaySecurityConfig,RateLimitConfig}.java` — read directly
- `services/crm-service/.../config/CrmInternalServiceFilter.java` — read directly
- `Docs/RestaurantERP_SaaS_Specification.md` §M8 — read directly (schemas, ADMS endpoint table, GL mapping)
- `.planning/phases/11-hr-payroll/11-CONTEXT.md`, `.planning/REQUIREMENTS.md` (HR-01..HR-08) — read directly
- `deploy/init/*.sql`, `gateway/.../RouteFeatureMap.java` — grepped directly, confirm `hr_db`/`hr_user`/`FEATURE_HR` already scaffolded

### Secondary (MEDIUM confidence — WebSearch cross-validated)
- Pakistan income-tax slabs FY2025-26: ict.edu.pk, hisaabkar.pk, waystax.com, befiler.com (cross-validated for internal mathematical consistency; two independent queries agreed on bands 1-4)
- EOBI rates/wage-base/eligibility: sunderjaya.com.pk, mercans.com, paypeople.pk, business.gov.pk, and a quoted snippet from eobi.gov.pk's own financial-data PDF
- ADMS/iClock protocol endpoint set and ATTLOG shape: `github.com/s0x90/zkteco-adms` (MIT, real implementation)

### Tertiary (LOW confidence — flagged for validation)
- Exact ADMS handshake response field block (Stamp/OpStamp/Delay/etc.) — reconstructed from training knowledge, not independently re-fetched successfully this session
- PESSI/SESSI provincial contribution mechanics — training-data-level only, not researched this session (correctly out of scope per CONTEXT.md)
- Tax proration convention for partial months — general pattern known, exact FBR mechanics not confirmed against a primary source

## Metadata

**Confidence breakdown:**
- Standard stack / architecture patterns: HIGH — grounded in direct reads of this codebase's actual finance-service/crm-service/gateway/shared-lib source
- Pakistan tax slabs & EOBI: MEDIUM — cross-validated across independent secondary sources with an internal-consistency check that caught and rejected one wrong figure, but no primary-source (FBR/EOBI official PDF) fetch succeeded this session
- ADMS protocol: MEDIUM — endpoint set and ATTLOG shape confirmed via a real OSS implementation; exact handshake response fields are lower confidence and explicitly flagged
- Pitfalls: HIGH — every pitfall in this document traces to a specific line of code read directly in this session, not speculation

**Research date:** 2026-07-24
**Valid until:** Pakistan tax/EOBI figures — treat as valid only for Tax Year 2026 (FY 2025-26); re-verify before Tax Year 2027 (post Finance Act 2026, which sources indicate already changes rates again). Architecture/codebase findings — valid until the referenced files change (no fixed expiry; re-check if finance-service's autopost package or gateway's filter chain is refactored before Phase 11 planning starts).
