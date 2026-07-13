---
status: diagnosed
phase: 10-purchasing-accounts-payable
source: 10-01-SUMMARY.md, 10-02-SUMMARY.md, 10-03-SUMMARY.md, 10-04-SUMMARY.md, 10-05-SUMMARY.md
started: 2026-07-01T20:00:00Z
updated: 2026-07-13T00:00:00Z
---

## Current Test

[testing complete — remaining tests blocked by code-audited gaps, see Gaps]

## Tests

### 1. Vendor list and bank account masking
expected: Vendors page loads; API masks bank account (last4 only, never plaintext)
result: pass
notes: |
  Verified against the live stack, but only after closing 6 escaped defects (see Gaps).
  Vendor created through the gateway: bankAccountLast4="6702"; DB column bank_account_no holds
  AES ciphertext; a grep for the raw account number in purchasing_db returns 0 rows.
  A create/edit vendor UI did not exist and was built as part of this UAT.

### 2. PO lifecycle through send
expected: Create PO → submit → OPA approve → send; status reaches SENT
result: issue
reported: "Navigating to /app/purchasing auto-redirects to /app/purchasing/vendors; there is no option to create a PO anywhere in the UI"
severity: major

### 3. Mock goods receipt
expected: On a SENT PO, mock-receive updates status to PARTIALLY_RECEIVED or FULLY_RECEIVED; MockGrnReceivePanel works on PO detail
result: issue
reported: "Blocked — purchase-orders/[id] has zero inbound links; reachable only by pasting a UUID. MockGrnReceivePanel also applies one qty to ALL lines, so a true partial receipt cannot be expressed."
severity: major

### 4. Happy-path invoice match (F1)
expected: After full mock receive, book invoice matching PO qty/price → status MATCHED
result: issue
reported: "Blocked — no invoice list page and no book-invoice UI; repository createInvoice() is orphaned (no hook, no caller)."
severity: major

### 5. Invoice without GRN (F4)
expected: Book invoice on SENT PO with no receive → MISMATCHED, line shows MISSING_GRN
result: issue
reported: "Blocked — no UI path exists (code audit 2026-07-13). Backend endpoint exists but is unreachable from the app."
severity: major

### 6. Price drift and override (F6)
expected: Invoice with unit price >2% above PO → MISMATCHED; override with justification → APPROVED_FOR_PAYMENT
result: issue
reported: "Blocked — no override-match UI exists; POST /invoices/{id}/override-match has no frontend consumer at any layer."
severity: major

### 7. AP payment
expected: Pay a MATCHED invoice → status PAID; finance auto-post called (AP → Bank)
result: issue
reported: "Blocked — no AP payment UI; POST /api/v1/purchasing/payments has no schema, repo fn, hook or page."
severity: major

### 8. Three-way match table UI
expected: Invoice detail page shows PO qty/price | GRN qty | Invoice qty/price columns with MatchStatusBadge
result: issue
reported: "Blocked — ThreeWayMatchTable exists on invoices/[id] but the route is orphaned (no inbound link, no invoice list)."
severity: major

### 9. AP aging (FIN-05)
expected: GET /api/v1/finance/ap/aging?branchId=… returns buckets (Current, 31-60, 61-90, Over 90) with amounts
result: issue
reported: "Blocked — GET /api/v1/finance/ap/aging works but has no frontend consumer at any layer; no AP aging page exists. AR side of FIN-05 is entirely absent (no entity, service, or endpoint)."
severity: major

### 10. Vendor scorecard
expected: GET /api/v1/purchasing/analytics/scorecard returns on-time %, fill rate, spend for a vendor
result: issue
reported: "Partial — VendorScorecardCard renders but is hardcoded to vendors[0]; no vendor selector."
severity: minor

### 11. FEATURE_VENDOR gate
expected: Without FEATURE_VENDOR, /app/purchasing shows access denied or 403 from gateway; with feature enabled, routes work
result: issue
reported: "Sidebar gates Purchasing on FEATURE_PURCHASING, a flag that does not exist in the backend (real flag is FEATURE_VENDOR). The nav item therefore NEVER renders when flags load successfully — the entire module is reachable only by typing the URL."
severity: blocker

### 12. PO close (full receive)
expected: Fully receive a PO (status FULLY_RECEIVED) → open the PO detail page → click "Close PO" → status transitions to CLOSED with no reason required
result: issue
reported: "Blocked — no UI path exists (code audit 2026-07-13). Backend endpoint exists but is unreachable from the app."
severity: major

### 13. PO short-close (partial receive)
expected: Partially receive a PO (status PARTIALLY_RECEIVED) → click "Close PO" → the button is disabled until a reason is entered → submitting with a reason closes the PO (status CLOSED, close reason recorded and visible on the closed banner)
result: issue
reported: "Blocked — PO detail route orphaned, and MockGrnReceivePanel cannot produce PARTIALLY_RECEIVED (one qty applied to every line), so the short-close path is unreachable."
severity: major

### 14. Spend analytics by vendor and category
expected: /app/purchasing/analytics shows two tables — spend by vendor and spend by category — each with a current-period total, a prior-period comparison, and a delta % (blank/— when prior spend is 0, not a false 100%)
result: issue
reported: "Partial — the page renders but the period is hardcoded to the current month; no period picker."
severity: minor

### 15. Vendor scorecard price variance
expected: The vendor scorecard card on /app/purchasing/analytics shows on-time delivery %, fill rate %, AND price variance % together for a selected vendor (all three metrics visible, not just the first two)
result: issue
reported: "Partial — all three metrics render, but the card is hardcoded to vendors[0]."
severity: minor

### 16. Expense approval respects OPA limit
expected: Create an expense and attempt to approve it as a user whose OPA approval limit is below the expense amount → rejected with 403 EXPENSE_APPROVAL_LIMIT_EXCEEDED, no journal entry posted. Approve the same expense as a user within their approval limit → status APPROVED and a balanced journal entry (DR expense account / CR bank 1110) posts.
result: issue
reported: "Blocked — no expense UI at all (create/approve/reject). Additionally the OPA action string is wrong: ExpenseService sends action=finance.expense.approve but finance.rego matches input.action=='approve', so every approval is DENIED against a real OPA. Masked in ExpenseApprovalIT by a mocked AuthorizationClient."
severity: blocker

## Summary

total: 16
passed: 1
issues: 15
pending: 0
skipped: 0

## Gaps

- truth: "A PO moves DRAFT→PENDING_APPROVAL→APPROVED→SENT→…→CLOSED with tiered approval enforced by OPA (PUR-02)"
  status: failed
  reason: "User reported: Navigating to /app/purchasing auto-redirects to /app/purchasing/vendors; there is no option to create a PO anywhere in the UI. Confirmed in code: frontend/app/(tenant)/app/purchasing/page.tsx unconditionally redirects to /vendors; PurchasingTabs only lists Vendors and Analytics; only purchase-orders/[id] (detail) exists, no purchase-orders list or create page."
  severity: major
  test: 2
  artifacts:
    - path: "frontend/app/(tenant)/app/purchasing/page.tsx"
      issue: "hardcoded redirect to /vendors, no PO tab"
    - path: "frontend/app/(tenant)/app/purchasing/layout.tsx"
      issue: "PurchasingTabs missing a Purchase Orders tab"
    - path: "frontend/app/(tenant)/app/purchasing/purchase-orders/[id]/page.tsx"
      issue: "detail page exists but no list/create page at purchase-orders/page.tsx"
  missing:
    - "Purchase Orders list page + create PO form/dialog + nav tab"

# All six were found while attempting UAT Test 1 and are FIXED. They are recorded because they
# are the reason Phase 10 was marked "complete + verified" while purchasing-service could not
# start and no gated endpoint could be reached. The phase's 18 green ITs never caught any of
# them: Testcontainers builds its own schema and config, so no test exercised the real
# gateway → platform-admin → Redis → service path.

- truth: "A manager can manage vendors from the app (PUR-01)"
  status: fixed
  reason: "The vendors page was a read-only list — no create or edit UI existed anywhere."
  severity: major
  test: 1
  root_cause: "10-01 deferred the vendor UI ('not required for mock E2E'); 10-VERIFICATION scored PUR-01 SATISFIED on backend CRUD alone."
  artifacts:
    - path: "frontend/components/purchasing/VendorFormDialog.tsx"
      issue: "created — create/edit vendor form"
    - path: "frontend/app/(tenant)/app/purchasing/vendors/page.tsx"
      issue: "added Add/Edit buttons + masked bank account column"

- truth: "A tenant with FEATURE_VENDOR enabled can reach /api/v1/purchasing/**"
  status: fixed
  reason: "Gateway returned 403 FEATURE_DISABLED ('Upgrade to enable this feature') though tenant_features said enabled."
  severity: blocker
  test: 1
  root_cause: "PLATFORM_ADMIN_URI pointed at 8083 (authorization-service); platform-admin is on 8096. The failed lookup was read as 'tenant has zero features' and CACHED as false in Redis."
  artifacts:
    - path: "gateway/src/main/resources/application.yml"
      issue: "platform-admin uri 8083 -> 8096"
    - path: "scripts/local-service-env.sh, scripts/local-service-env.ps1"
      issue: "same wrong port"

- truth: "The gateway can authenticate to platform-admin's internal API"
  status: fixed
  reason: "Every gateway->platform-admin call was rejected with INTERNAL_AUTH_REQUIRED."
  severity: blocker
  test: 1
  root_cause: "PlatformAdminClient sent the literal string 'gateway' as X-Internal-Service instead of the shared INTERNAL_SERVICE_SECRET."
  artifacts:
    - path: "gateway/src/main/java/io/restaurantos/gateway/client/PlatformAdminClient.java"
      issue: "send configured secret; parse the ApiResponse envelope (it deserialised the payload without it, so features/status came back null)"

- truth: "A failed feature lookup is not persisted as 'feature disabled'"
  status: fixed
  reason: "Both the gateway and shared-lib wrote a guessed 'false' into Redis on lookup failure/miss, turning a transient error into a hard 403 for the whole TTL."
  severity: blocker
  test: 1
  root_cause: "shared-lib's RedisFeatureFlagService had NO source of truth at all: a cache miss returned false AND cached false. Only a SuperAdmin toggle ever wrote 'true', so every @RequiresFeature endpoint 403'd for a freshly-provisioned tenant."
  artifacts:
    - path: "shared-lib/src/main/java/io/restaurantos/shared/feature/RedisFeatureFlagService.java"
      issue: "resolve cache miss from platform-admin (new TenantFeatureResolver/PlatformAdminFeatureResolver); never cache a failed lookup"
    - path: "gateway/src/main/java/io/restaurantos/gateway/filter/FeatureFlagGlobalFilter.java"
      issue: "never cache a failed lookup"

- truth: "purchasing-service starts against a real database"
  status: fixed
  reason: "Boot failed: Hibernate schema validation 'missing table [event_outbox]'. The service had never run outside Testcontainers."
  severity: blocker
  test: 1
  root_cause: "purchasing-service had no shared-infra migration (finance has V2__shared_infra_tables.sql); it also had NO spring.data.redis config, so @RequiresFeature 500'd on 'Unable to connect to Redis'."
  artifacts:
    - path: "services/purchasing-service/src/main/resources/db/migration/V4__shared_infra_tables.sql"
      issue: "created — event_outbox, idempotency_keys, processed_events"
    - path: "services/purchasing-service/src/main/resources/application.yml"
      issue: "added spring.data.redis + restaurantos.platform-admin.uri"

- truth: "An unexpected 500 is diagnosable"
  status: fixed
  reason: "The catch-all handler returned a generic INTERNAL_ERROR and logged NOTHING — the Redis failure above was completely invisible."
  severity: major
  test: 1
  root_cause: "GlobalExceptionHandler.handleUnexpected() swallowed the exception without logging it."
  artifacts:
    - path: "shared-lib/src/main/java/io/restaurantos/shared/api/GlobalExceptionHandler.java"
      issue: "log the stack trace at ERROR with the traceId returned to the caller"

# STILL OPEN — found during this UAT, not yet fixed:
- truth: "Only users with vendor.manage may create or edit vendors (PUR-01)"
  status: open
  reason: "No purchasing controller has @PreAuthorize — only @RequiresFeature. vendor.manage is seeded and assigned to OWNER/MANAGER/TENANT_ADMIN but is enforced nowhere, so any authenticated tenant user (e.g. Cashier) can add/edit vendors and their bank details."
  severity: major
  test: 1
  root_cause: "Permission exists in the auth seed with zero consumers — same class as the finance.expense.approve gap 10-05 already caught once."
  missing:
    - "Add @PreAuthorize(\"hasAuthority('vendor.manage')\") to VendorController create/update (and audit the other five purchasing controllers)."

# ── Code audit 2026-07-13 (parallel backend + frontend audit agents) ──
# These were found by reading source, not by running the app. They explain why 18 green
# integration tests + a "7/7 requirements Complete" verification coexist with a module the
# user cannot reach. Same root-cause class as 10-06-A: tests and docs asserted against
# must-haves and mocks, never against the real gateway → OPA → UI path.

- truth: "OPA authorizes PO approval (PUR-02)"
  status: failed
  reason: "OPA action-string mismatch. PoApprovalService.assertOpaAllows sends action=\"vendor.po.approve\"; policies/restaurantos/vendor.rego only allows input.action == \"approve_po\" with `default allow := false`. AuthorizeService passes action through verbatim. Every POST /purchase-orders/{id}/approve is DENIED against a real OPA."
  severity: blocker
  test: 2
  root_cause: "PurchaseOrderApprovalIT mocks AuthorizationClient, so the policy was never exercised with the real action string."
  artifacts:
    - path: "services/purchasing-service/.../PoApprovalService.java"
      issue: "action string vendor.po.approve does not match any rego rule"
    - path: "policies/restaurantos/vendor.rego"
      issue: "rule keyed on approve_po"
  missing:
    - "Align the action string between service and rego (pick one canonical name), and add an IT that hits a real OPA container instead of a mocked AuthorizationClient."

- truth: "OPA authorizes expense approval within limit (FIN-05)"
  status: failed
  reason: "Same class of mismatch. ExpenseService sends action=\"finance.expense.approve\"; finance.rego requires input.action == \"approve\". Every expense approval is DENIED against a real OPA."
  severity: blocker
  test: 16
  root_cause: "ExpenseApprovalIT mocks AuthorizationClient."
  artifacts:
    - path: "services/finance-service/.../ExpenseService.java"
      issue: "action string finance.expense.approve does not match finance.rego"
    - path: "policies/restaurantos/finance.rego"
      issue: "rule keyed on approve"
  missing:
    - "Align action string; add a real-OPA integration test."

- truth: "Purchasing is reachable from the app navigation"
  status: failed
  reason: "components/shared/sidebar-nav-items.ts gates the Purchasing nav item on feature FEATURE_PURCHASING, which exists nowhere in the backend. The real flag is FEATURE_VENDOR (TierFeatureDefaults, RouteFeatureMap, every @RequiresFeature). FeatureGuard only fails OPEN on fetch error, not on an absent flag, so the nav item never renders when flags load successfully."
  severity: blocker
  test: 11
  artifacts:
    - path: "frontend/components/shared/sidebar-nav-items.ts"
      issue: "lines ~77 and ~182: FEATURE_PURCHASING -> FEATURE_VENDOR"
  missing:
    - "Fix the flag name; add a test asserting every nav item's feature string exists in the backend flag set."

- truth: "Only authorized users may act on purchasing resources"
  status: failed
  reason: "ZERO @PreAuthorize across all 18 purchasing-service endpoints (7 controllers). PurchasingSecurityConfig declares @EnableMethodSecurity but no controller uses it; everything is anyRequest().authenticated(). Any authenticated tenant user (e.g. a Cashier/Waiter) can create vendors and their bank details, approve POs, override a 3-way match, and post AP payments."
  severity: blocker
  test: 1
  root_cause: "Permissions seeded with zero consumers — vendor.po.approve is seeded and granted to MANAGER but enforced nowhere; vendor.manage is referenced by vendor.rego but never seeded as a permission at all."
  artifacts:
    - path: "services/purchasing-service/.../VendorController.java"
      issue: "create/update need vendor.manage"
    - path: "services/purchasing-service/.../PurchaseOrderController.java"
      issue: "8 endpoints, none gated"
    - path: "services/purchasing-service/.../VendorInvoiceController.java"
      issue: "override-match ungated"
    - path: "services/purchasing-service/.../ApPaymentController.java"
      issue: "payment ungated"
    - path: "services/purchasing-service/.../MockGrnController.java"
      issue: "receipt ungated"
  missing:
    - "Add @PreAuthorize to all 18 endpoints; seed vendor.manage as a real permission."

- truth: "PO tiered approval is enforced by OPA (PUR-02)"
  status: failed
  reason: "Tiering is computed in-service by TenantSetupService.requiredTiersForAmount. vendor.rego's approve_po rule checks only permission + same tenant/branch — it never compares resource.amount_paisa against user.attributes.approval_limit_paisa (which finance.rego DOES do for expenses). Also PoApprovalService.approve has no distinct-approver check, so one user can satisfy every tier by calling approve N times."
  severity: major
  test: 2
  missing:
    - "Move the approval-limit comparison into vendor.rego (mirror finance.rego); add a distinct-approver constraint."

- truth: "A user can run the purchasing module end-to-end from the UI"
  status: failed
  reason: "The backend is far ahead of the frontend. Only 1 of 14 user journeys (vendors) is fully reachable. purchase-orders/[id] and invoices/[id] have ZERO inbound links — reachable only by pasting a UUID. These backend endpoints have no frontend consumer at any layer: PO create/submit/withdraw/approve/reject/send, invoice override-match, AP payment, AP aging, expense create/approve/reject. PurchasingRepository.createInvoice is dead code (no hook, no caller)."
  severity: major
  test: 2
  artifacts:
    - path: "frontend/app/(tenant)/app/purchasing/"
      issue: "no purchase-orders list/create page, no invoices list/book page, no payments page, no AP aging page, no expenses pages"
  missing:
    - "PO list + create page (needs a backend PO list endpoint — none exists, only GET /{id})"
    - "Invoice list + book-invoice page (needs a backend invoice list endpoint — none exists)"
    - "Override-match UI, AP payment UI, AP aging page, expense create/approve UI"
    - "Nav tabs for each; remove the unconditional /purchasing -> /vendors redirect"

- truth: "A partial receipt can be recorded (drives PARTIALLY_RECEIVED + short-close)"
  status: failed
  reason: "MockGrnReceivePanel applies a single qty input to EVERY PO line (po.lines.map(l => ({poLineId: l.id, receivedQty: qty}))), so a genuine per-line partial receipt cannot be expressed through the UI — the PARTIALLY_RECEIVED -> short-close path (test 13) is unreachable."
  severity: major
  test: 13
  artifacts:
    - path: "frontend/components/purchasing/MockGrnReceivePanel.tsx"
      issue: "one qty applied to all lines; needs per-line qty inputs"

- truth: "AP/AR balances are tracked (FIN-05)"
  status: failed
  reason: "Only the AP side exists. There is no AR entity, service, or endpoint anywhere in finance-service — the requirement text says AP/AR."
  severity: major
  test: 9
  missing:
    - "Decide scope: either implement AR balances, or formally descope AR from FIN-05 in REQUIREMENTS.md with a rationale."

- truth: "Analytics are usable across periods and vendors"
  status: failed
  reason: "Spend analytics period is hardcoded to the current month (no period picker); VendorScorecardCard is hardcoded to vendors[0] (no vendor selector)."
  severity: minor
  test: 14
  artifacts:
    - path: "frontend/app/(tenant)/app/purchasing/analytics/page.tsx"
      issue: "hardcoded period + vendors[0]"

- truth: "A missing encryption key fails loudly, not silently"
  status: failed
  reason: "VendorService.apply silently sets bankAccountNo/last4 to null when the EncryptionService bean is absent (key unset), rather than failing — silent data loss on the field the requirement specifically calls out as encrypted."
  severity: major
  test: 1
  artifacts:
    - path: "services/purchasing-service/.../VendorService.java"
      issue: "null-out on missing EncryptionService instead of fail-fast"
