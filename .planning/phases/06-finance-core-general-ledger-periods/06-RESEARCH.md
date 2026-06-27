# Phase 6: Finance Core — General Ledger & Periods — Research

**Researched:** 2026-06-27
**Domain:** Double-entry accounting engine, PostgreSQL deferred triggers, Spring Boot 4 finance microservice, multi-tenant RLS, accounting period management
**Confidence:** HIGH (canonical spec tables, trigger patterns, and provisioning seam verified against RestaurantERP_SaaS_Specification.md)

---

## Summary

Phase 6 builds the immutable financial foundation that every subsequent auto-posting consumer (Phases 7–11) depends on. Its two plans are:
- **06-01**: Chart of Accounts seeding per tenant + balanced/immutable Journal Entry engine (deferred balance trigger, reversal-only corrections).
- **06-02**: Accounting periods (Jul–Jun fiscal year) + period close/lock with internal-API pre-checks + 423 `PERIOD_LOCKED` guard.

The hardest parts are: (a) the DEFERRED CONSTRAINT TRIGGER — which fires at transaction commit rather than row insert — making it invisible to normal JPA transaction management and requiring special integration test setup; (b) the immutability BEFORE UPDATE/DELETE trigger that blocks any edit after posting; and (c) the provisioning seam — finance-service must expose an internal endpoint that platform-admin-service calls during tenant provisioning to seed COA and periods.

The spec has already decided most of the data model. The research confirms what must be added (trigger variants, idempotency guarantees, internal API shape, OPA policy stubs, frontend page list) and flags the key gotchas.

---

## 1. Double-Entry Accounting Fundamentals

### Pakistan Chart of Accounts — Restaurant Business (1xxx–7xxx)

The spec mandates accounts in the 1xxx–7xxx range with account types: `ASSET | LIABILITY | EQUITY | REVENUE | COGS | EXPENSE`.

**Recommended COA seed for a Pakistan restaurant tenant:**

| Code | Name | Type | Normal Bal | `system_tag` |
|------|------|------|-----------|--------------|
| **1000** | Current Assets | ASSET | DR | — |
| 1010 | Cash in Hand | ASSET | DR | `CASH` |
| 1020 | Petty Cash | ASSET | DR | `PETTY_CASH` |
| 1100 | Bank — HBL Current | ASSET | DR | `BANK` |
| 1110 | Bank — UBL Current | ASSET | DR | `BANK` |
| 1200 | Accounts Receivable | ASSET | DR | `AR` |
| 1300 | Inventory — Raw Materials | ASSET | DR | `INVENTORY` |
| 1310 | Inventory — Packaging | ASSET | DR | `INVENTORY` |
| 1320 | Inventory in Transit | ASSET | DR | `INVENTORY_TRANSIT` |
| 1700 | GR/IR Clearing | ASSET | DR | `GR_IR` |
| 1710 | FBR Input Tax Receivable | ASSET | DR | `INPUT_TAX` |
| 1800 | Prepaid Expenses | ASSET | DR | — |
| 1900 | Other Current Assets | ASSET | DR | — |
| **2000** | Current Liabilities | LIABILITY | CR | — |
| 2100 | Accounts Payable | LIABILITY | CR | `AP` |
| 2200 | FBR Output Tax Payable | LIABILITY | CR | `OUTPUT_TAX` |
| 2300 | Wages Payable | LIABILITY | CR | `WAGES_PAYABLE` |
| 2400 | EOBI Payable | LIABILITY | CR | — |
| 2500 | PESSI Payable | LIABILITY | CR | — |
| 2600 | Advance from Customers | LIABILITY | CR | — |
| **3000** | Owner's Equity | EQUITY | CR | — |
| 3100 | Share Capital | EQUITY | CR | — |
| 3200 | Retained Earnings | EQUITY | CR | — |
| 3900 | Current Year Earnings | EQUITY | CR | — |
| **4000** | Revenue | REVENUE | CR | — |
| 4100 | Food & Beverage Sales | REVENUE | CR | `REVENUE` |
| 4110 | Dine-In Sales | REVENUE | CR | — |
| 4120 | Takeaway Sales | REVENUE | CR | — |
| 4130 | Delivery Sales | REVENUE | CR | — |
| 4900 | Revenue Adjustments | REVENUE | CR | — |
| 4910 | Discounts Allowed | REVENUE | DR | — |
| 4920 | Sales Returns & Refunds | REVENUE | DR | — |
| **5000** | Cost of Goods Sold | COGS | DR | — |
| 5100 | Food Cost | COGS | DR | `COGS` |
| 5110 | Beverage Cost | COGS | DR | — |
| 5200 | Wastage Expense | COGS | DR | — |
| 5210 | Spoilage | COGS | DR | — |
| 5220 | Stock Variance Loss | COGS | DR | — |
| 5221 | Stock Variance Gain | COGS | CR | — |
| **6000** | Operating Expenses | EXPENSE | DR | — |
| 6100 | Rent Expense | EXPENSE | DR | — |
| 6110 | Utilities | EXPENSE | DR | — |
| 6120 | Fuel & Gas | EXPENSE | DR | — |
| 6200 | Salary Expense | EXPENSE | DR | `SALARY_EXPENSE` |
| 6210 | Labour — Part-time | EXPENSE | DR | — |
| 6220 | EOBI Contribution | EXPENSE | DR | — |
| 6300 | Packaging & Supplies | EXPENSE | DR | — |
| 6400 | Marketing & Advertising | EXPENSE | DR | — |
| 6500 | Repair & Maintenance | EXPENSE | DR | — |
| 6600 | Depreciation | EXPENSE | DR | — |
| 6700 | Bank Charges | EXPENSE | DR | — |
| 6800 | Miscellaneous Expense | EXPENSE | DR | — |
| **7000** | Non-Operating | EXPENSE | DR | — |
| 7100 | Finance Charges | EXPENSE | DR | — |
| 7200 | Other Income | REVENUE | CR | — |

**Key principles:**
- `is_system = TRUE` for all seeded accounts; `system_tag` enables auto-posting recipes to resolve accounts without hard-coding codes.
- Tenant can add child accounts (e.g., 1100.1 for a second bank) but cannot delete or deactivate system accounts.
- Account code format: 4 digits at root level; dot-notation for sub-accounts (non-breaking for Phase 6).
- Total: ~55 seeded accounts per tenant. Idempotent: seed on `ON CONFLICT (tenant_id, code) DO NOTHING`.

### Double-Entry Invariant

Every Journal Entry (JE) must satisfy:
```
SUM(debit_paisa for je_id = X) = SUM(credit_paisa for je_id = X)
```

This is enforced at the DB layer (not application layer) via a deferred constraint trigger — an unbreakable invariant even if the service has a bug.

---

## 2. PostgreSQL Deferred Constraint Trigger for Balance Enforcement

### Why Deferred?

A STATEMENT-level or ROW-level trigger on `journal_lines` fires immediately when each line is inserted. At that point, the JE is incomplete (not all lines inserted yet), so the SUM check would always fail on partial inserts.

A **DEFERRED CONSTRAINT TRIGGER** fires at **transaction commit** — after all lines for the JE are inserted within the same transaction. This is the correct timing.

### Implementation Pattern

```sql
-- Step 1: Create the trigger function (idempotent check at commit time)
CREATE OR REPLACE FUNCTION check_je_balance()
RETURNS trigger AS $$
DECLARE
  v_debit  BIGINT;
  v_credit BIGINT;
BEGIN
  SELECT COALESCE(SUM(debit_paisa), 0),
         COALESCE(SUM(credit_paisa), 0)
  INTO v_debit, v_credit
  FROM journal_lines
  WHERE je_id = NEW.je_id;

  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'Journal entry % is not balanced (DR=% CR=%)',
      NEW.je_id, v_debit, v_credit;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Attach as a CONSTRAINT TRIGGER with DEFERRABLE INITIALLY DEFERRED
CREATE CONSTRAINT TRIGGER trg_je_balance
  AFTER INSERT OR UPDATE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION check_je_balance();
```

**Key points:**
- `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` — fires at `COMMIT`, not at row insert.
- `FOR EACH ROW` is required; constraint triggers cannot be `FOR EACH STATEMENT`.
- The check looks at the current SUM across ALL lines for that `je_id` in the same transaction — this is safe because within the same txn, the NEW row is already visible.
- The function re-queries by `je_id`, so if you insert 5 lines in one txn, the trigger fires 5 times but only the last one matters (all succeed until the commit check).
- Under Spring's `@Transactional`, the trigger fires at the point the connection commits — completely transparent to the JPA layer.

### Spring/JPA Interaction

- Spring `@Transactional` maps to one PostgreSQL transaction (one connection commit).
- All `journal_lines` inserts within one `@Transactional` block are committed together, triggering the deferred balance check at commit.
- **If the JE is unbalanced, the commit throws a `DataIntegrityViolationException` (SQLSTATE P0001).** The Spring transaction rolls back entirely.
- Map this to a `JournalEntryNotBalancedException` in the `GlobalExceptionHandler`, returning `HTTP 422 UNPROCESSABLE_ENTITY` with error code `JE_UNBALANCED`.
- **Integration test gotcha:** Testcontainers Postgres must run the trigger as part of the Flyway migration. The IT must insert lines in a single transaction to exercise the deferred trigger. Inserting in separate transactions defeats the test.

---

## 3. Immutability Pattern for Journal Entries

### Lifecycle: DRAFT → POSTED

The spec does not show a `status` column on `journal_entries`, but one is implied by the requirement "immutable once posted." Add it:

```sql
status TEXT NOT NULL DEFAULT 'DRAFT'  -- DRAFT | POSTED
```

- `DRAFT`: lines can be added, edited, or deleted. No period check.
- `POSTED`: immutable. Period must be OPEN. Balance trigger enforced at commit.
- No `UPDATE` or `DELETE` once `status = 'POSTED'`.

### BEFORE UPDATE/DELETE Trigger (Immutability Enforcement)

```sql
CREATE OR REPLACE FUNCTION protect_posted_je()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'Journal entry % is POSTED and immutable. Create a reversal entry.', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_je_immutable
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION protect_posted_je();

-- Also protect lines once JE is posted
CREATE OR REPLACE FUNCTION protect_posted_je_line()
RETURNS trigger AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM journal_entries WHERE id = OLD.je_id;
  IF v_status = 'POSTED' THEN
    RAISE EXCEPTION 'Cannot modify lines of a POSTED journal entry %.', OLD.je_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_je_line_immutable
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW
  EXECUTE FUNCTION protect_posted_je_line();
```

### Reversal Entry Pattern

When a posted JE needs correction, create a **reversal JE**:
1. Create new JE with `is_reversal = TRUE`, `reversal_of_je = <original-id>`.
2. Lines are the negative of the original: debit and credit amounts swapped.
3. Link original JE: set `reversed_by_je = <new-reversal-je-id>` on the original (this is the only allowed UPDATE on a POSTED JE — implemented by bypassing the trigger in the reversal service method, or by checking `is_reversal_link_update` flag).
4. **Simpler approach**: Allow one specific UPDATE path — `UPDATE journal_entries SET reversed_by_je = ? WHERE id = ? AND reversed_by_je IS NULL` — exempt from the immutability trigger by checking `TG_OP = 'UPDATE' AND OLD.reversed_by_je IS NULL AND NEW.reversed_by_je IS NOT NULL AND OLD.status = NEW.status`.

**Reversal entry numbering:** `REV-<original-entry-no>` or append `/R` suffix.

### Status Transition Control (Application Layer)

```
DRAFT → POSTED: Only via POST /journal-entries/{id}/post
                Period must be OPEN
                Balance trigger fires at commit
POSTED → (reversal): Only via POST /journal-entries/{id}/reverse
```

Never expose raw UPDATE on journal entry status via REST.

---

## 4. Accounting Periods Implementation

### Pakistan Fiscal Year

Pakistan's fiscal year runs **July 1 to June 30**:
- Period 1: July 1 – July 31
- Period 2: August 1 – August 31
- ...
- Period 12: June 1 – June 30

For fiscal_year = 2026 (FY2025-26 in Pakistan): July 1, 2025 – June 30, 2026.

### Seeding 12 Periods at Provisioning

```java
// Called from internal endpoint during tenant provisioning
public void seedAccountingPeriods(UUID tenantId, int fiscalYear) {
    // July = month 7 of (fiscalYear - 1), ..., June = month 6 of fiscalYear
    int startCalendarYear = fiscalYear - 1;
    for (int periodNo = 1; periodNo <= 12; periodNo++) {
        int month = (6 + periodNo) % 12; // July=7 → month=7, ..., June=6 → month=6
        if (month == 0) month = 12;
        int year = (periodNo <= 6) ? startCalendarYear : fiscalYear;
        LocalDate start = LocalDate.of(year, month, 1);
        LocalDate end = start.withDayOfMonth(start.lengthOfMonth());
        // INSERT ON CONFLICT (tenant_id, fiscal_year, period_no) DO NOTHING
        periodRepo.insertIfAbsent(tenantId, fiscalYear, periodNo, start, end, "OPEN");
    }
}
```

Idempotency: `ON CONFLICT (tenant_id, fiscal_year, period_no) DO NOTHING` — safe to re-run.

### Period Status Machine

```
OPEN → LOCKED (via /periods/{id}/close — pre-checks pass)
LOCKED → OPEN  (NOT SUPPORTED in Phase 6; reversal entries work instead)
```

Note: The spec uses `LOCKED` as the terminal closed state in Phase 6. The spec also mentions `CLOSED` as a third state but this is deferred to Phase 9+ (full period close with P&L roll-forward). For Phase 6, `LOCKED` is the only final state.

### Pre-Close Checks via Internal API (No Cross-Service SQL)

Before locking a period, the finance-service calls other services via Feign (no direct SQL cross-service):

| Pre-Check | Internal API Call |
|-----------|------------------|
| No open orders in the period | `GET /internal/orders/open-count?periodStart=&periodEnd=` on POS service |
| No pending GRNs | `GET /internal/grn/pending-count?periodEnd=` on Inventory service |
| No unmatched vendor invoices | `GET /internal/invoices/unmatched-count?periodEnd=` on Purchasing service |

**Phase 6 constraint:** POS/Inventory/Purchasing services don't exist yet (Phases 7–10). The period-close pre-check must be **stubbed** in Phase 6:
- Define the Feign interfaces with stub implementations that return 0 (all clear) in Phase 6.
- Document that Phase 7–10 will implement the real endpoints.
- The internal-API-only pattern is established so no cross-service SQL is ever introduced.
- Add a `bypass_pre_checks` flag usable only in tests (system-flag, not exposed to API).

**2FA requirement:** `AUTH-07` mandates TOTP for `finance.period.close`. The close endpoint must verify `X-TOTP-Verified: true` header (set by the gateway filter when the JWT carries the TOTP-verified claim), or return `403 TOTP_REQUIRED`.

### 423 PERIOD_LOCKED Response

When any code path attempts to post to a locked period:

```java
// In JournalEntryService.post()
AccountingPeriod period = periodRepo.findById(periodId)
    .orElseThrow(() -> new PeriodNotFoundException(periodId));
if ("LOCKED".equals(period.getStatus())) {
    throw new PeriodLockedException(periodId);
}
```

```java
// In GlobalExceptionHandler
@ExceptionHandler(PeriodLockedException.class)
public ResponseEntity<ApiError> handlePeriodLocked(PeriodLockedException ex) {
    return ResponseEntity.status(423)
        .body(ApiError.of("PERIOD_LOCKED", "Period is locked: " + ex.getPeriodId()));
}
```

Spring does not have an `HttpStatus.LOCKED` constant (it's WebDAV). Use `HttpStatus.valueOf(423)` or `ResponseEntity.status(423)`.

---

## 5. Multi-Tenant RLS for Finance Data

### Tenant Context Pattern (Established in Phase 1/2/3)

Finance-service follows the identical pattern of all other services:
- `SharedAutoConfiguration` (from shared-lib) wires `TenantFilterInterceptor` + `TenantContext`.
- JWT filter resolves `tenant_id` from the `X-Tenant-Id` header (set by the gateway from JWT claim).
- Hibernate `@Filter` on `TenantAuditableEntity` applies `tenant_id = :tenantId` to every query.
- PostgreSQL GUC `app.current_tenant_id` is set at connection checkout via `TenantFilterInterceptor`.

### RLS Policies for Finance Tables

All four finance tables need RLS enabled + a policy:

```sql
-- Pattern: apply after CREATE TABLE in each Flyway changeset

ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON chart_of_accounts
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounting_periods
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_entries
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_lines
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

**Important:** The finance DB role (e.g. `finance_user`) must NOT be a superuser (RLS is bypassed for superusers). Confirm in `docker/init-db.sql` that `finance_user` is a regular role.

### Entity Superclass

All four entities extend `TenantAuditableEntity` from shared-lib:
- Inherits: `tenant_id`, `created_at`, `created_by`, `updated_at`, `updated_by`.
- Hibernate `@Filter(name = "tenantFilter")` applied at entity class level.

---

## 6. COA Seeding at Tenant Provisioning

### Hook into the Existing Provisioning Saga (Phase 3 Seam)

Phase 3's platform-admin-service orchestrates tenant provisioning by calling internal Feign endpoints sequentially. The spec confirms finance-service is one of those upstream calls (see spec line 3054: "Finance Service: COA seed"). The seam already exists.

**Internal endpoint for provisioning:**
```
POST /internal/tenants/{tenantId}/provision
Authorization: Bearer <service-jwt>
X-Tenant-Id: {tenantId}

{
  "fiscalYear": 2026,
  "coaTemplate": "PAKISTAN_RESTAURANT_DEFAULT"
}
```

Response: `200 OK { "accountsSeeded": 55, "periodsSeeded": 12 }` or `409` if already seeded (idempotent).

**platform-admin-service Feign client** (already stubbed in Phase 3 as a placeholder):
```java
@FeignClient(name = "finance-service", configuration = FeignSharedConfig.class)
public interface FinanceProvisioningClient {
    @PostMapping("/internal/tenants/{tenantId}/provision")
    ProvisioningResult provision(@PathVariable UUID tenantId,
                                  @RequestBody TenantProvisioningRequest request);
}
```

**Idempotency guarantee:**
- COA: `ON CONFLICT (tenant_id, code) DO NOTHING` in Flyway-compatible INSERT or JPA `save` with existence check.
- Periods: `ON CONFLICT (tenant_id, fiscal_year, period_no) DO NOTHING`.
- The entire provision endpoint is wrapped in `@Transactional`. If called twice, the second call returns 200 with 0 inserts (no error).

### Base COA Data — Flyway vs Application Seeding

**Recommendation: Application-level seeding (not Flyway data migrations).**

Reasons:
- COA seed data is tenant-specific (each row has `tenant_id`).
- Flyway migrations are schema-level; seeding per-tenant rows from Flyway is awkward.
- Application code can easily be parametrized by `tenantId` and `coaTemplate`.
- Keep Flyway changesets for schema (DDL) only; seed data via application service.

---

## 7. Spring Boot 4 / JPA Implementation Patterns

### Entity Design

```java
// ChartOfAccount.java
@Entity
@Table(name = "chart_of_accounts", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"tenant_id", "code"})
})
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class ChartOfAccount extends TenantAuditableEntity {
    @Column(nullable = false)
    private String code;

    @Column(nullable = false)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(name = "account_type", nullable = false)
    private AccountType accountType; // ASSET|LIABILITY|EQUITY|REVENUE|COGS|EXPENSE

    @Column(name = "parent_code")
    private String parentCode;

    @Column(name = "is_system", nullable = false)
    private boolean system = false;

    @Column(name = "system_tag")
    private String systemTag;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;
}

// AccountingPeriod.java
@Entity
@Table(name = "accounting_periods", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"tenant_id", "fiscal_year", "period_no"})
})
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class AccountingPeriod extends TenantAuditableEntity {
    @Column(name = "fiscal_year", nullable = false)
    private int fiscalYear;

    @Column(name = "period_no", nullable = false)
    private int periodNo;

    @Column(name = "start_date", nullable = false)
    private LocalDate startDate;

    @Column(name = "end_date", nullable = false)
    private LocalDate endDate;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private PeriodStatus status = PeriodStatus.OPEN; // OPEN|LOCKED

    @Column(name = "locked_by")
    private UUID lockedBy;

    @Column(name = "locked_at")
    private Instant lockedAt;
}

// JournalEntry.java
@Entity
@Table(name = "journal_entries")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class JournalEntry extends TenantAuditableEntity {
    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "entry_no", nullable = false)
    private String entryNo;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "period_id", nullable = false)
    private AccountingPeriod period;

    @Column(name = "entry_date", nullable = false)
    private LocalDate entryDate;

    @Column(nullable = false)
    private String description;

    @Column(name = "source_type")
    private String sourceType; // "MANUAL"|"ORDER_CLOSE"|"VENDOR_INVOICE"|...

    @Column(name = "source_id")
    private UUID sourceId;

    @Column(name = "posted_by", nullable = false)
    private UUID postedBy;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private JeStatus status = JeStatus.DRAFT; // DRAFT|POSTED

    @Column(name = "is_reversal", nullable = false)
    private boolean reversal = false;

    @Column(name = "reversal_of_je")
    private UUID reversalOfJe;

    @Column(name = "reversed_by_je")
    private UUID reversedByJe;

    @OneToMany(mappedBy = "journalEntry", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<JournalLine> lines = new ArrayList<>();
}

// JournalLine.java
@Entity
@Table(name = "journal_lines")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class JournalLine extends TenantAuditableEntity {
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "je_id", nullable = false)
    private JournalEntry journalEntry;

    @Column(name = "account_code", nullable = false)
    private String accountCode;

    @Column
    private String description;

    @Column(name = "debit_paisa", nullable = false)
    private long debitPaisa = 0;

    @Column(name = "credit_paisa", nullable = false)
    private long creditPaisa = 0;
}
```

**Key decisions:**
- `@GeneratedValue(UUID)` — never set ID manually before `save()` (Phase 3 decision [03-02-B]).
- `@JdbcTypeCode(SqlTypes.JSON)` on any JSONB field (Phase 3 decision [03-02-C]).
- Do NOT add `@EnableJpaAuditing` to finance-service Application class — `SharedAutoConfiguration` is authoritative (Phase 3 decision [03-02-D]).

### Service Layer: Posting a JE

```java
@Service
@Transactional
public class JournalEntryServiceImpl implements JournalEntryService {

    public JournalEntryDto post(UUID jeId) {
        JournalEntry je = jeRepo.findById(jeId)
            .orElseThrow(() -> new JeNotFoundException(jeId));

        if (je.getStatus() != JeStatus.DRAFT) {
            throw new JeAlreadyPostedException(jeId);
        }

        AccountingPeriod period = je.getPeriod();
        if (period.getStatus() == PeriodStatus.LOCKED) {
            throw new PeriodLockedException(period.getId()); // → 423
        }

        je.setStatus(JeStatus.POSTED);
        je.setPostedBy(TenantContext.getCurrentUserId());

        // Save triggers the deferred balance check at commit
        jeRepo.save(je);

        // If trigger fires: DataIntegrityViolationException → mapped to 422 JE_UNBALANCED
        return JournalEntryMapper.toDto(je);
    }
}
```

**Transaction boundary:** The `@Transactional` on `post()` is the same transaction that commits the lines. The deferred trigger fires at the end of this transaction. If unbalanced, Spring catches `DataIntegrityViolationException` after rollback — make sure the `GlobalExceptionHandler` maps it.

### Entry Number Generation

Auto-generate sequential human-readable entry numbers per tenant:

```sql
-- Approach: DB sequence per tenant (too complex). Use: MAX(entry_no) + 1 with optimistic lock, or:
-- Simpler: JE-{fiscal_year}-{period_no}-{YYYYMMDD}-{seq} where seq is from a sequences table
CREATE TABLE je_sequences (
    tenant_id    UUID NOT NULL,
    fiscal_year  INTEGER NOT NULL,
    last_seq     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, fiscal_year)
);
-- On each post: UPDATE je_sequences SET last_seq = last_seq + 1 WHERE ... RETURNING last_seq
-- Then: entry_no = 'JE-' || fiscal_year || '-' || LPAD(last_seq::TEXT, 6, '0')
```

Use `SELECT ... FOR UPDATE` on the sequence row to avoid races. This is done in the same transaction as JE posting.

---

## 8. Finance Service API Design

### Port
Finance Service runs on **port 8086** (per spec).

### REST Endpoints — Phase 6

#### COA Management
```
GET    /api/v1/finance/accounts              — List/search accounts (paginated, filter by type/active)
GET    /api/v1/finance/accounts/{code}       — Get single account
POST   /api/v1/finance/accounts              — Create custom account (non-system only)
PATCH  /api/v1/finance/accounts/{code}       — Update name/active (system accounts: name-only)
```
OPA: `finance.accounts.read` | `finance.accounts.write`.

#### Journal Entries
```
POST   /api/v1/finance/journal-entries       — Create DRAFT JE (with lines)
GET    /api/v1/finance/journal-entries       — List JEs (filter by period, status, date range)
GET    /api/v1/finance/journal-entries/{id}  — Get JE with lines
POST   /api/v1/finance/journal-entries/{id}/post     — Post a DRAFT JE (→ POSTED, triggers balance check)
POST   /api/v1/finance/journal-entries/{id}/reverse  — Create reversal JE
```
OPA: `finance.journal.read` | `finance.journal.write` | `finance.journal.post`.

#### Accounting Periods
```
GET    /api/v1/finance/periods               — List periods (filter by fiscal_year, status)
GET    /api/v1/finance/periods/{id}          — Get single period
POST   /api/v1/finance/periods/{id}/close    — Lock period (requires TOTP, pre-checks)
```
OPA: `finance.periods.read` | `finance.periods.close` (TOTP-gated).

#### General Ledger (Phase 6 read-only)
```
GET    /api/v1/finance/gl                    — GL view: account balances for a period
GET    /api/v1/finance/gl/{accountCode}/entries  — JE lines for an account in a period
```
OPA: `finance.gl.read`.

### Internal Endpoints (Not Gateway-exposed)

```
POST   /internal/tenants/{tenantId}/provision        — COA + periods seed (called by platform-admin)
GET    /internal/periods/current?tenantId=           — Get current open period (for auto-posting consumers)
POST   /internal/journal-entries                     — Auto-post from event consumers (Phases 7–11)
GET    /internal/accounts/by-tag?tag=CASH&tenantId=  — Resolve system_tag to account code
```

Internal endpoints:
- Protected by `StripInternalHeaderFilter` (gateway strips `X-Internal-Service` from external calls).
- No OPA check (service-to-service trust model).
- Accept a service JWT or `X-Internal-Service` header.

### OpenAPI Contract for Downstream Consumers (Phases 7–11)

Downstream consumers will use:
- `POST /internal/journal-entries` — auto-post a pre-built JE payload with `source_type` + `source_id`.
- `GET /internal/periods/current` — resolve the current accounting period for a tenant.
- `GET /internal/accounts/by-tag` — resolve `system_tag` to actual account code.

**Generate OpenAPI spec (`/v3/api-docs`) using SpringDoc `springdoc-openapi-starter-webmvc-ui`.**

---

## 9. Frontend Considerations for Phase 6

### Design System §7.4 Finance Module Requirements

From `RestaurantOS_UI_UX_Design_System.md §7.4`:

> Data density, keyboard nav, **all money `font-mono tabular-nums`**. Dr/Cr right-aligned fixed width. Period chip OPEN (emerald)/LOCKED (amber)/CLOSED (slate). `Tab` rows, `Enter` open, `E` export. Bulk select+export. Every number is a link → breakdown; account → GL drill-down.

**UX Rules for Finance:**
1. All monetary amounts: `font-mono tabular-nums` — no exceptions.
2. Debit and Credit columns: `text-right w-32` (fixed width) in every table.
3. Period status chip: `OPEN` → `bg-emerald-100 text-emerald-800`, `LOCKED` → `bg-amber-100 text-amber-800`, `CLOSED` → `bg-slate-100 text-slate-700`.
4. Keyboard nav: `Tab` moves between rows, `Enter` opens detail, `E` triggers export.
5. Bulk select: checkbox column + "Export Selected" action.
6. Every account balance/amount in a table → click → drill-down to JE lines.
7. Every account code → click → full GL view for that account.

### Pages Required in Phase 6

```
/finance/
  accounts/                    Chart of Accounts list + search + filter by type
  accounts/[code]/             Account detail: running balance + GL drill-down
  journal-entries/             JE list: filter by period/date/status; keyboard nav
  journal-entries/new          Create manual JE form (header + dynamic lines)
  journal-entries/[id]/        JE detail with lines
  gl/                          General Ledger: period selector + account balances
  periods/                     Accounting periods list with status chips
```

### Component Breakdown

```
components/finance/
  AccountTable.tsx             Sortable, filterable COA table; font-mono amounts
  JournalEntryForm.tsx         Dynamic line addition/removal; running Dr/Cr balance
  JournalEntryTable.tsx        With keyboard nav (Tab/Enter/E); bulk select
  PeriodStatusChip.tsx         OPEN/LOCKED/CLOSED with emerald/amber/slate variants
  GeneralLedger.tsx            Period selector + account balance grid; drill-down links
  PeriodCloseModal.tsx         Confirmation dialog; TOTP input if required
  DrCrCell.tsx                 Right-aligned fixed-width cell for debit/credit columns
  FinanceEmptyState.tsx        "Post Journal Entry" CTA (per §14 design system)
```

### TanStack Query Integration

```typescript
// Query key factory
export const financeKeys = {
  accounts: (filters?: AccountFilters) => ['finance', 'accounts', filters] as const,
  periods: (fiscalYear?: number) => ['finance', 'periods', fiscalYear] as const,
  journalEntries: (filters?: JeFilters) => ['finance', 'journal-entries', filters] as const,
  gl: (periodId: string) => ['finance', 'gl', periodId] as const,
}

// Mutations
useMutation({ mutationFn: postJournalEntry })  // POST .../post
useMutation({ mutationFn: closePeriod })       // POST .../close
useMutation({ mutationFn: reverseJournalEntry }) // POST .../reverse
```

### Money Display Rule

All amounts rendered via `<MoneyDisplay paisa={value} />` (from shared DS-04). For tabular data, add the `mono` prop: `<MoneyDisplay paisa={value} mono />` which applies `font-mono tabular-nums`.

---

## 10. Testing Strategy

### Coverage Target

Finance service: **≥75%** (from `coverage-gates.json`). Achieved by a combination of unit tests (service + mapper logic) and integration tests (trigger, period lock, seeding).

### Integration Test Setup (Testcontainers)

**Environment requirement (from Phase 4 research):**
```
DOCKER_HOST=unix:///Users/<user>/.colima/default/docker.sock
TESTCONTAINERS_RYUK_DISABLED=true
```

```java
@SpringBootTest
@Testcontainers
class JournalEntryBalanceTriggerIT {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18")
        .withDatabaseName("finance_test")
        .withUsername("finance_user")
        .withPassword("test");

    // Flyway runs on startup and creates triggers

    @Test
    void unbalancedJeIsRejectedAtCommit() {
        // Arrange: create DRAFT JE in one transaction
        UUID jeId = createDraftJe();

        // Act: insert only debit line (no credit) and post in same transaction
        assertThatThrownBy(() -> insertUnbalancedLinesAndPost(jeId))
            .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void balancedJePostsSuccessfully() {
        UUID jeId = createDraftJe();
        insertBalancedLines(jeId, 5000L); // DR 5000 + CR 5000
        postJe(jeId);
        assertJeStatus(jeId, "POSTED");
    }
}
```

**Critical:** Lines must be inserted and committed in the **same transaction** as the `post()` call, otherwise the deferred trigger won't see them. Test the `post()` service method — not raw SQL inserts.

### Test Matrix

| Test | Type | What It Proves |
|------|------|---------------|
| Unbalanced JE rejected at commit | IT (deferred trigger) | FIN-02 DB constraint |
| Balanced JE posts successfully | IT | FIN-02 happy path |
| Attempt UPDATE on POSTED JE | IT (immutability trigger) | FIN-02 immutability |
| Reversal JE created correctly | Unit + IT | FIN-02 reversal pattern |
| Provisioned tenant has expected COA | IT | FIN-01 seeding |
| COA seeding is idempotent | IT | FIN-01 re-run safety |
| 12 periods seeded per fiscal year | IT | FIN-04 seeding |
| Post to LOCKED period → 423 | IT + Controller test | FIN-06 |
| Period locks after pre-checks pass | IT | FIN-04 close |
| Pre-close checks (stub returns pass) | Unit | FIN-04 pre-check wiring |
| TOTP required for period close | Controller test | AUTH-07 seam |
| RLS blocks cross-tenant JE read | IT (two-tenant) | XCUT-01/02 |

### Unit Tests

- `JournalEntryService.post()`: mock period → LOCKED → expect `PeriodLockedException`.
- `AccountingPeriodService.close()`: mock Feign stubs → all-clear → expect status = LOCKED.
- `CurrencyUtils` / `MoneyUtils`: paisa conversion accuracy.
- `AccountingPeriodSeeder`: correct month/year mapping for all 12 periods.
- `CoaSeeder`: correct account count for `PAKISTAN_RESTAURANT_DEFAULT` template.

---

## 11. Database Schema Recommendations

### Tables, Columns, Constraints, Triggers — Full DDL

```sql
-- Flyway: V6__finance_schema.sql

CREATE TABLE chart_of_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  account_type    TEXT NOT NULL CHECK (account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','COGS','EXPENSE')),
  parent_code     TEXT,
  is_system       BOOLEAN NOT NULL DEFAULT FALSE,
  system_tag      TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      UUID,
  UNIQUE (tenant_id, code)
);

ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON chart_of_accounts USING (
  tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID
);

CREATE TABLE accounting_periods (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  fiscal_year     INTEGER NOT NULL,
  period_no       INTEGER NOT NULL CHECK (period_no BETWEEN 1 AND 12),
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','LOCKED')),
  locked_by       UUID,
  locked_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      UUID,
  UNIQUE (tenant_id, fiscal_year, period_no)
);

ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounting_periods USING (
  tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID
);

CREATE TABLE je_sequences (
  tenant_id   UUID NOT NULL,
  fiscal_year INTEGER NOT NULL,
  last_seq    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, fiscal_year)
);

CREATE TABLE journal_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  branch_id       UUID NOT NULL,
  entry_no        TEXT NOT NULL,
  period_id       UUID NOT NULL REFERENCES accounting_periods(id),
  entry_date      DATE NOT NULL,
  description     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED')),
  source_type     TEXT,
  source_id       UUID,
  posted_by       UUID,
  is_reversal     BOOLEAN NOT NULL DEFAULT FALSE,
  reversal_of_je  UUID REFERENCES journal_entries(id),
  reversed_by_je  UUID REFERENCES journal_entries(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      UUID,
  UNIQUE (tenant_id, entry_no)
);

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_entries USING (
  tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID
);

CREATE TABLE journal_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  je_id           UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_code    TEXT NOT NULL,
  description     TEXT,
  debit_paisa     BIGINT NOT NULL DEFAULT 0,
  credit_paisa    BIGINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_line_non_negative CHECK (debit_paisa >= 0 AND credit_paisa >= 0),
  CONSTRAINT ck_line_one_side CHECK (NOT (debit_paisa > 0 AND credit_paisa > 0))
);

ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_lines USING (
  tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID
);

-- DEFERRED CONSTRAINT TRIGGER for balance check
CREATE OR REPLACE FUNCTION fn_check_je_balance()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_dr BIGINT; v_cr BIGINT;
BEGIN
  SELECT COALESCE(SUM(debit_paisa),0), COALESCE(SUM(credit_paisa),0)
  INTO v_dr, v_cr
  FROM journal_lines WHERE je_id = NEW.je_id;
  IF v_dr <> v_cr THEN
    RAISE EXCEPTION 'JE_UNBALANCED: entry % DR=% CR=%', NEW.je_id, v_dr, v_cr;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_je_balance
  AFTER INSERT OR UPDATE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_check_je_balance();

-- BEFORE UPDATE/DELETE trigger: immutability after POSTED
CREATE OR REPLACE FUNCTION fn_protect_posted_je()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Allow only reversed_by_je link update on a POSTED JE
  IF OLD.status = 'POSTED' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'JE_IMMUTABLE: cannot delete POSTED entry %', OLD.id;
    END IF;
    IF NEW.status <> OLD.status OR NEW.description <> OLD.description
       OR NEW.entry_date <> OLD.entry_date THEN
      RAISE EXCEPTION 'JE_IMMUTABLE: cannot modify POSTED entry % (use reversal)', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_je_immutable
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION fn_protect_posted_je();

CREATE OR REPLACE FUNCTION fn_protect_posted_je_line()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM journal_entries WHERE id = COALESCE(OLD.je_id, NEW.je_id);
  IF v_status = 'POSTED' THEN
    RAISE EXCEPTION 'JE_LINE_IMMUTABLE: cannot modify lines of POSTED entry %', COALESCE(OLD.je_id, NEW.je_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_je_line_immutable
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION fn_protect_posted_je_line();

-- Index for common queries
CREATE INDEX idx_je_tenant_period ON journal_entries(tenant_id, period_id);
CREATE INDEX idx_je_tenant_date ON journal_entries(tenant_id, entry_date);
CREATE INDEX idx_jl_je_id ON journal_lines(je_id);
CREATE INDEX idx_jl_tenant_account ON journal_lines(tenant_id, account_code);
CREATE INDEX idx_period_tenant_fy ON accounting_periods(tenant_id, fiscal_year);
```

---

## 12. Service Architecture Recommendations

### Module Structure

```
finance-service/
  src/main/java/io/restaurantos/finance/
    FinanceServiceApplication.java
    config/
      FeignClientConfig.java           (import FeignSharedConfig from shared-lib)
      OpenApiConfig.java               (SpringDoc setup)
    domain/
      model/
        ChartOfAccount.java
        AccountingPeriod.java
        JournalEntry.java
        JournalLine.java
        JeSequence.java
      enums/
        AccountType.java
        PeriodStatus.java
        JeStatus.java
    repository/
      ChartOfAccountRepository.java
      AccountingPeriodRepository.java
      JournalEntryRepository.java
      JournalLineRepository.java
    service/
      CoaService.java / CoaServiceImpl.java
      AccountingPeriodService.java / AccountingPeriodServiceImpl.java
      JournalEntryService.java / JournalEntryServiceImpl.java
      ProvisioningService.java          (COA + period seeding)
      PeriodCloseService.java           (pre-checks + lock)
      GlService.java                    (GL balance queries)
    dto/
      AccountDto.java
      AccountingPeriodDto.java
      JournalEntryDto.java
      JournalLineDto.java
      CreateJeRequest.java
      GlBalanceDto.java
    mapper/
      AccountMapper.java
      PeriodMapper.java
      JournalEntryMapper.java
    web/
      AccountController.java           (@RestController)
      PeriodController.java
      JournalEntryController.java
      GlController.java
      InternalProvisioningController.java
    feign/
      PosInternalClient.java           (stub: open order count pre-check)
      InventoryInternalClient.java     (stub: pending GRN count pre-check)
      PurchasingInternalClient.java    (stub: unmatched invoice count pre-check)
    exception/
      PeriodLockedException.java
      JeNotBalancedException.java
      JeAlreadyPostedException.java
      JeNotFoundException.java
      FinanceGlobalExceptionHandler.java
    seed/
      PakistanRestaurantCoaTemplate.java  (55-account seed data)
  src/main/resources/
    application.yml
    db/changelog/
      V6__finance_schema.sql
      V6_1__finance_seed_sequences.sql
```

### Dependencies (pom.xml additions beyond shared-lib)

All standard Spring Boot 4 dependencies are inherited. Add:

```xml
<!-- SpringDoc for OpenAPI -->
<dependency>
    <groupId>org.springdoc</groupId>
    <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
    <version>2.8.9</version>
</dependency>
<!-- Flyway for schema migrations -->
<dependency>
    <groupId>org.flywaydb</groupId>
    <artifactId>flyway-core</artifactId>
</dependency>
<dependency>
    <groupId>org.flywaydb</groupId>
    <artifactId>flyway-database-postgresql</artifactId>
</dependency>
```

**No additional domain-specific libraries needed.** The balance check is a DB trigger, not Java logic.

---

## 13. Implementation Risks and Gotchas

| Risk | Severity | Mitigation |
|------|----------|------------|
| Deferred trigger not firing in tests | HIGH | IT must insert lines + call `post()` in the same `@Transactional` scope. Spring `@Transactional(propagation = REQUIRES_NEW)` in tests would create a separate tx — avoid. Use `TestTransaction.start()` / `TestTransaction.end()` from Spring test utils. |
| `current_setting('app.current_tenant_id', TRUE)` returns NULL for super-user connections | MEDIUM | Always use TRUE (permissive) for RLS policy to avoid errors when GUC is not set (returns NULL instead of throwing). Test with explicit tenant GUC set in IT. |
| 423 HTTP status not in Spring's `HttpStatus` enum | LOW | Use `HttpStatus.valueOf(423)` or `ResponseEntity.status(423)`. |
| Provisioning saga: finance-service not registered in Eureka during platform-admin startup | MEDIUM | Phase 3 already stubs the Feign call. In integration tests, use WireMock. Finance-service must register in Eureka before it's callable in prod. Health check must pass first. |
| `entry_no` sequence under concurrent provisioning | LOW | `je_sequences` table with `SELECT ... FOR UPDATE` handles this. Use `@Retryable(retryFor = OptimisticLockException.class)` as backup. |
| TOTP check for period close: gateway must set a `X-TOTP-Verified` claim | MEDIUM | In Phase 6, implement as a header check only. Document that the gateway TOTP filter (Phase 2 seam) must propagate this. In tests, mock the header. |
| Balance trigger fires on every line insert (N times per JE) | INFORMATIONAL | This is expected; only the final commit matters. No performance concern for manual JEs (typically 2–10 lines). Auto-posting in Phase 9+ may have larger JEs — still acceptable. |
| `reversed_by_je` UPDATE on a POSTED JE hits immutability trigger | MEDIUM | The `fn_protect_posted_je()` function must explicitly allow the `reversed_by_je` field update. Use: `IF NEW.reversed_by_je IS NOT NULL AND OLD.reversed_by_je IS NULL AND NEW.status = OLD.status THEN RETURN NEW; END IF;` before the RAISE EXCEPTION. |
| Flyway migration order: triggers must run after tables | LOW | V6__finance_schema.sql creates all tables and triggers in one file in the correct order. |
| Spring Boot 4 JPA: `@Filter` not applied in native queries | MEDIUM | Never use `@Query` with native SQL in finance repositories — always use JPQL. Native queries bypass Hibernate filters and could leak cross-tenant data. |

---

## 14. Recommended Implementation Order Within the 2 Plans

### Plan 06-01: COA Seeding + Balanced/Immutable JE Engine

**Recommended task order:**

1. **Scaffold finance-service module** — parent POM, `application.yml`, Spring Boot Application class, Eureka client, shared-lib import. Confirm `SharedAutoConfiguration` is imported (no `@EnableJpaAuditing`).

2. **Flyway migration V6** — tables (`chart_of_accounts`, `journal_entries`, `journal_lines`, `je_sequences`), RLS policies, all three triggers (deferred balance, JE immutability, line immutability). Run Flyway on local Postgres to verify.

3. **COA entities + repositories** — `ChartOfAccount`, `AccountType` enum, `ChartOfAccountRepository` with `findByCode`, `findBySystemTag`.

4. **Pakistan COA template** — `PakistanRestaurantCoaTemplate.java` containing the 55 seeded accounts as static list. Ensure it's injected into `ProvisioningService`.

5. **Internal provisioning endpoint** — `InternalProvisioningController` + `ProvisioningService.seedCoa()` + `seedPeriods()`. Test idempotency with `ON CONFLICT DO NOTHING` JDBC inserts.

6. **JournalEntry + JournalLine entities** — with `JeStatus` enum, `@OneToMany` relationship, all constraints.

7. **JournalEntryService** — `create()` (DRAFT), `addLine()`, `post()` (with period-lock check + balance check mapping), `reverse()`.

8. **REST controllers** (COA + JE) with proper OPA annotations.

9. **Exception handlers** — `PeriodLockedException` → 423, `JeNotBalancedException` → 422, `JeAlreadyPostedException` → 409.

10. **Unit tests** — service layer (mocked repositories), COA seeder correctness, period-month mapping.

11. **Integration tests** — deferred trigger test, immutability trigger test, cross-tenant RLS test.

12. **Coverage gate check** — ensure ≥75%.

### Plan 06-02: Accounting Periods + Period Close/Lock with Pre-Checks

**Recommended task order:**

1. **Flyway migration V6** (already done in 06-01 if sequential, or same migration if parallel). Add `accounting_periods` + `je_sequences`.

2. **AccountingPeriod entity + repository** — `PeriodStatus` enum, `findCurrentOpenPeriod(UUID tenantId, LocalDate date)`, `findByFiscalYear(UUID tenantId, int fy)`.

3. **Period seeding in ProvisioningService** — 12 periods per fiscal year with correct Jul–Jun month mapping.

4. **AccountingPeriodService** — `list()`, `getById()`, `closePeriod(UUID periodId, UUID closedBy)` with pre-check Feign calls.

5. **Feign stubs** — `PosInternalClient`, `InventoryInternalClient`, `PurchasingInternalClient` each returning 0 (all-clear) in Phase 6. Mark with `// TODO: Phase 7/8/10 will implement real endpoints`.

6. **Pre-check orchestration** — `PeriodCloseService.runPreChecks()` calls all three Feign stubs; if any returns > 0, throw `PeriodClosePreCheckFailedException` with details.

7. **TOTP header check** — `PeriodCloseController.close()` validates `X-TOTP-Verified: true` header (from JWT enrichment at gateway). Return 403 if missing.

8. **Period close REST endpoint** — `POST /api/v1/finance/periods/{id}/close`.

9. **Internal period endpoints** — `GET /internal/periods/current` (for auto-posting consumers in Phase 9).

10. **GL balance view** — `GlService.getBalances(UUID tenantId, UUID periodId)` — aggregate `journal_lines` by account for posted JEs in the period.

11. **Frontend pages** — Period list, period close modal with TOTP input stub, GL view.

12. **Integration tests** — period seeding, close-to-LOCKED transition, post-to-LOCKED → 423, pre-check failure path, two-tenant isolation.

13. **Coverage gate check** — combined 06-01 + 06-02 must hit ≥75%.

---

## RESEARCH COMPLETE
