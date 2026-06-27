---
status: testing
phase: 06-finance-core-general-ledger-periods
source:
  - 06-01-SUMMARY.md
  - 06-02-SUMMARY.md
started: 2026-06-27T15:10:00+05:00
updated: 2026-06-27T15:10:00+05:00
---

## Current Test

number: 1
name: COA Provisioning endpoint
expected: |
  POST /internal/tenants/{tenantId}/provision (no auth) returns 200 with
  {"accountsSeeded": 64, "periodsSeeded": 12}. A second identical call returns
  {"accountsSeeded": 0, "periodsSeeded": 0} (idempotent).
awaiting: user response

## Tests

### 1. COA Provisioning endpoint
expected: POST /internal/tenants/{tenantId}/provision (no auth required) returns {"accountsSeeded": 64, "periodsSeeded": 12}. A second call with the same tenantId returns {"accountsSeeded": 0, "periodsSeeded": 0} — fully idempotent.
result: pending

### 2. Chart of Accounts list
expected: GET /api/v1/finance/accounts returns a paginated list of accounts. Each account has code, name, accountType (ASSET/LIABILITY/EQUITY/REVENUE/COGS/EXPENSE). Account 1010 is present with systemTag=CASH.
result: pending

### 3. Journal Entry create (DRAFT)
expected: POST /api/v1/finance/journal-entries with a body including two balanced lines (e.g. debitPaisa=10000 on 1010, creditPaisa=10000 on 4100) returns 201 with status=DRAFT and a null entryNo.
result: pending

### 4. Journal Entry post (balanced → POSTED)
expected: POST /api/v1/finance/journal-entries/{id}/post on a balanced DRAFT JE returns 200 with status=POSTED and entryNo matching pattern JE-YYYY-NNNNNN.
result: pending

### 5. Journal Entry post (unbalanced → 422)
expected: POST .../post on an unbalanced DRAFT JE (e.g. single debit line only) returns 422 with error code JE_UNBALANCED. The deferred DB trigger fires at transaction commit.
result: pending

### 6. Journal Entry reverse
expected: POST /api/v1/finance/journal-entries/{id}/reverse on a POSTED JE returns 201 with a new JE: status=POSTED, reversal=true, reversalOfJe pointing to the original. Original JE now has reversedByJe set. Lines have swapped DR/CR values.
result: pending

### 7. Accounting Period list — 12 Pakistan FY periods
expected: GET /api/v1/finance/periods?fiscalYear=2026 (with tenant context) returns 12 periods. Period 1 has startDate=2025-07-01; Period 12 has endDate=2026-06-30. All periods have status=OPEN.
result: pending

### 8. Period close — TOTP gate (403)
expected: POST /api/v1/finance/periods/{id}/close without the X-TOTP-Verified=true header returns 403 with error code TOTP_REQUIRED.
result: pending

### 9. Period close — success (LOCKED)
expected: POST /api/v1/finance/periods/{id}/close with header X-TOTP-Verified=true returns 200 with status=LOCKED and lockedAt timestamp set.
result: pending

### 10. Post JE to locked period → 423
expected: POST /api/v1/finance/journal-entries with a jeDate that falls inside a LOCKED period returns 423 with error code PERIOD_LOCKED.
result: pending

### 11. General Ledger endpoint
expected: GET /api/v1/finance/gl?periodId={id} returns a list of GL balance objects. Each has accountCode, accountName, debitTotal, creditTotal, netBalance.
result: pending

### 12. Finance sidebar navigation
expected: The tenant app sidebar shows a Finance section with links: Accounts, Journal Entries, GL (General Ledger), Periods. Clicking each link navigates to the correct route (/app/finance/accounts, /journal-entries, /gl, /periods).
result: pending

### 13. Finance Accounts page (/app/finance/accounts)
expected: Page renders an account table with code, name, type, active status columns. A type dropdown filter is present. Rows are clickable (navigates to account detail).
result: pending

### 14. Finance Journal Entries page (/app/finance/journal-entries)
expected: Page renders a JE list table. Rows show entryNo, date, description, status chip. Keyboard navigation: pressing Enter on a focused row navigates to detail. "New Journal Entry" button navigates to /journal-entries/new.
result: pending

### 15. Finance New JE form (/app/finance/journal-entries/new)
expected: Form has date, description, reference fields and a lines table with debit/credit columns. A live DR=CR balance indicator updates as lines are entered. Monetary values display in font-mono tabular-nums.
result: pending

### 16. Finance GL page (/app/finance/gl)
expected: Page has a period selector dropdown. Selecting a period loads GL balances — account code, name, debit total, credit total in font-mono tabular-nums columns. Clicking a net balance navigates to /app/finance/accounts/[code]?periodId=...
result: pending

### 17. Finance Periods page (/app/finance/periods)
expected: Page shows all 12 periods. Each row has a PeriodStatusChip: OPEN periods show emerald green chip, LOCKED periods show amber chip. A "Close Period" button opens PeriodCloseModal which includes a TOTP field.
result: pending

## Summary

total: 17
passed: 0
issues: 0
pending: 17
skipped: 0

## Gaps

[none yet]
