---
status: testing
phase: 10-purchasing-accounts-payable
source: 10-01-SUMMARY.md, 10-02-SUMMARY.md, 10-03-SUMMARY.md, 10-04-SUMMARY.md, 10-05-SUMMARY.md
started: 2026-07-01T20:00:00Z
updated: 2026-07-12T00:00:00Z
---

## Current Test

number: 1
name: Vendor list and bank account masking
expected: |
  With purchasing-service running (or MSW in tests), open /app/purchasing/vendors as a user with FEATURE_VENDOR.
  You see at least one vendor in the list (name, payment terms).
  If you create a vendor with a bank account via API, the response shows bankAccountLast4 (e.g. "3456") — never the full account number.
awaiting: user response

## Tests

### 1. Vendor list and bank account masking
expected: Vendors page loads; API masks bank account (last4 only, never plaintext)
result: pending

### 2. PO lifecycle through send
expected: Create PO → submit → OPA approve → send; status reaches SENT
result: pending

### 3. Mock goods receipt
expected: On a SENT PO, mock-receive updates status to PARTIALLY_RECEIVED or FULLY_RECEIVED; MockGrnReceivePanel works on PO detail
result: pending

### 4. Happy-path invoice match (F1)
expected: After full mock receive, book invoice matching PO qty/price → status MATCHED
result: pending

### 5. Invoice without GRN (F4)
expected: Book invoice on SENT PO with no receive → MISMATCHED, line shows MISSING_GRN
result: pending

### 6. Price drift and override (F6)
expected: Invoice with unit price >2% above PO → MISMATCHED; override with justification → APPROVED_FOR_PAYMENT
result: pending

### 7. AP payment
expected: Pay a MATCHED invoice → status PAID; finance auto-post called (AP → Bank)
result: pending

### 8. Three-way match table UI
expected: Invoice detail page shows PO qty/price | GRN qty | Invoice qty/price columns with MatchStatusBadge
result: pending

### 9. AP aging (FIN-05)
expected: GET /api/v1/finance/ap/aging?branchId=… returns buckets (Current, 31-60, 61-90, Over 90) with amounts
result: pending

### 10. Vendor scorecard
expected: GET /api/v1/purchasing/analytics/scorecard returns on-time %, fill rate, spend for a vendor
result: pending

### 11. FEATURE_VENDOR gate
expected: Without FEATURE_VENDOR, /app/purchasing shows access denied or 403 from gateway; with feature enabled, routes work
result: pending

### 12. PO close (full receive)
expected: Fully receive a PO (status FULLY_RECEIVED) → open the PO detail page → click "Close PO" → status transitions to CLOSED with no reason required
result: pending

### 13. PO short-close (partial receive)
expected: Partially receive a PO (status PARTIALLY_RECEIVED) → click "Close PO" → the button is disabled until a reason is entered → submitting with a reason closes the PO (status CLOSED, close reason recorded and visible on the closed banner)
result: pending

### 14. Spend analytics by vendor and category
expected: /app/purchasing/analytics shows two tables — spend by vendor and spend by category — each with a current-period total, a prior-period comparison, and a delta % (blank/— when prior spend is 0, not a false 100%)
result: pending

### 15. Vendor scorecard price variance
expected: The vendor scorecard card on /app/purchasing/analytics shows on-time delivery %, fill rate %, AND price variance % together for a selected vendor (all three metrics visible, not just the first two)
result: pending

### 16. Expense approval respects OPA limit
expected: Create an expense and attempt to approve it as a user whose OPA approval limit is below the expense amount → rejected with 403 EXPENSE_APPROVAL_LIMIT_EXCEEDED, no journal entry posted. Approve the same expense as a user within their approval limit → status APPROVED and a balanced journal entry (DR expense account / CR bank 1110) posts.
result: pending

## Summary

total: 16
passed: 0
issues: 0
pending: 16
skipped: 0

## Gaps

[none yet]
