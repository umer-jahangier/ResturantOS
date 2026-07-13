# Plan 10-01 Summary — Purchasing scaffold + vendors + PO approval

**Status:** Complete  
**Wave:** 1  
**Commits:** (uncommitted — run `/gsd` commit workflow if desired)

## Delivered

- `purchasing-service` module (port 8087, `purchasing_db`, Flyway V1)
- Vendor CRUD with encrypted `bank_account_no` (API returns `bankAccountLast4` only)
- PO lifecycle: DRAFT → PENDING_APPROVAL → APPROVED → SENT
- OPA-gated multi-tier approval via `AuthorizationClient`
- Mock GRN foundation: `mock_grn_receipts`, `GrnDataPort`, `MockGrnAdapter`, `integration-mode=mock`
- Gateway route + `FEATURE_VENDOR` feature gate
- Internal endpoints: open-receipts, pending-match-invoices (stub count), unmatched-count
- Dockerfile + coverage-gates entry
- ITs: `VendorIT`, `PurchaseOrderApprovalIT`

## Verification

- `mvn -pl services/purchasing-service test-compile failsafe:integration-test failsafe:verify` — 10/10 ITs pass (includes 10-02 tests in same module)

## Notes

- `EventPublisher` interface used (not concrete `DomainEventPublisher`) per shared-lib bean registration
- Vendor catalogue REST endpoints deferred (schema exists; not required for mock E2E)
