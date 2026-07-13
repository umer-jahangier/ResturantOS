---
phase: 10-purchasing-accounts-payable
plan: 10
subsystem: api
tags: [spring-data-jpa, purchasing, finance, rest, rbac, tenant-isolation]

# Dependency graph
requires:
  - phase: 10-07 (gap-closure)
    provides: canonical OPA action vocabulary (not directly consumed by list reads, but the services these controllers live in depend on it)
  - phase: 10-09 (gap-closure)
    provides: "@PreAuthorize on all 18 public purchasing endpoints + vendor.view/finance.journal.view permission grants + reflection guard (everyPublicEndpointIsGated) that fails the build on any ungated endpoint; endpoint->permission map used as the reference for gating the 3 new list endpoints"
provides:
  - "GET /api/v1/purchasing/purchase-orders (list) - the backend prerequisite 10-12/10-13/10-14 needed to build a PO list page"
  - "GET /api/v1/purchasing/invoices (list) - backend prerequisite for the invoice list page + gives the orphaned invoices/[id] detail route its first inbound link"
  - "GET /api/v1/finance/expenses (list) - backend prerequisite for an expense approver's inbox"
  - "PurchasingListEndpointsIT: proves PO + invoice lists are branch- and tenant-isolated, status-filterable, and carry full line detail"
  - "ExpenseApprovalIT: extended with a branch/tenant-isolation + status-filter test for the expense list"
affects: [10-12, 10-13, 10-14]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "List endpoints resolve tenantId exclusively from TenantContext.requireTenantId() inside the service layer, never from a request param; branchId remains a request param (mirrors VendorController.list's existing branch-scoping expectation)"
    - "List query methods added to existing repositories as Spring Data derived-query pairs: an unfiltered findByTenantIdAndBranchIdOrderBy...Desc plus a status-filtered ...AndStatusInOrderBy...Desc sibling, selected in the service by null/empty check"
    - "List services reuse the existing private toDto(...) mapper (not a second mapper) so list rows carry the exact same DTO shape (including nested lines/line-match-status) as the corresponding GET /{id} detail endpoint"

key-files:
  created:
    - services/purchasing-service/src/test/java/io/restaurantos/purchasing/PurchasingListEndpointsIT.java
  modified:
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/repository/PurchaseOrderRepository.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/service/PurchaseOrderService.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/web/PurchaseOrderController.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/repository/VendorInvoiceRepository.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/service/VendorInvoiceService.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/web/VendorInvoiceController.java
    - services/finance-service/src/main/java/io/restaurantos/finance/repository/ExpenseRepository.java
    - services/finance-service/src/main/java/io/restaurantos/finance/service/ExpenseService.java
    - services/finance-service/src/main/java/io/restaurantos/finance/web/ExpenseController.java
    - services/finance-service/src/test/java/io/restaurantos/finance/ExpenseApprovalIT.java

key-decisions:
  - "List response envelope is ApiResponse<List<Dto>> (a plain array, no PageMeta/pagination), per the plan's explicit task wording -- not VendorController.list's paginated ApiResponse.paginated(...) style. VendorController's branchId-as-request-param convention was followed; its page/size/PageMeta convention was not, since the plan text for all three list tasks explicitly specifies a plain List return."
  - "Ordering column: createdAt (from TenantAuditableEntity, Spring Data JPA auditing) for PO and expense lists; invoiceDate (existing domain column, reused from the pre-existing findByTenantIdAndBranchIdOrderByInvoiceDateDesc) for the invoice list."
  - "Expense list permission is finance.journal.view -- matching the existing GET /{id} grant exactly, per the plan's explicit instruction not to invent a new permission."

patterns-established:
  - "Any future *List() service method on a tenant-scoped entity should resolve tenantId from TenantContext, accept branchId as an explicit param, and reuse the entity's existing toDto mapper -- do not write a parallel list-specific DTO mapper."

# Metrics
duration: 55min
completed: 2026-07-13
---

# Phase 10 Plan 10: Purchasing/Finance List Endpoints Summary

**Three tenant/branch-scoped, RBAC-gated list endpoints (`GET /purchasing/purchase-orders`, `GET /purchasing/invoices`, `GET /finance/expenses`) that unblock 10-12/10-13/10-14's PO, invoice, and expense list pages, proven branch- and tenant-isolated by new/extended integration tests.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3
- **Files modified:** 10 (1 created, 9 modified)

## Accomplishments

- Closed the structural blocker the UAT flagged: `purchase-orders/[id]` and `invoices/[id]` had zero inbound links because there was nowhere in the API to list from — both now have a working `GET /` sibling next to their existing `GET /{id}`.
- Added the same for `finance/expenses`, giving an expense approver a real inbox query instead of only being able to fetch a single expense by ID they already know.
- Every new endpoint arrived already `@PreAuthorize`-gated (10-09's reflection guard `everyPublicEndpointIsGated` still passes with zero code changes needed there — proof the new endpoints were gated correctly the first time).
- Tenant isolation is structural, not just tested: every `list()` service method takes `tenantId` from `TenantContext.requireTenantId()`, never a caller-supplied parameter — the class of bug this guards against (a caller passing another tenant's ID) is impossible by construction, not just by test coverage.
- `PurchasingListEndpointsIT` proves cross-tenant and cross-branch rows are genuinely absent from the query result (not merely filtered client-side) by seeding rows for a second tenant and a second branch and asserting they never appear.

## Task Commits

1. **Task 1: GET /api/v1/purchasing/purchase-orders (list)** - `23a6339` (feat)
2. **Task 2: GET /api/v1/purchasing/invoices (list)** - `3378973` (feat)
3. **Task 3: GET /api/v1/finance/expenses (list) + PurchasingListEndpointsIT + ExpenseApprovalIT extension** - `0bb66b5` (feat)

**Plan metadata:** committed as part of this summary's own commit (see below).

## Files Created/Modified

- `services/purchasing-service/.../repository/PurchaseOrderRepository.java` - `findByTenantIdAndBranchIdOrderByCreatedAtDesc` + status-filtered sibling
- `services/purchasing-service/.../service/PurchaseOrderService.java` - `list(branchId, statuses)`, tenantId from `TenantContext`
- `services/purchasing-service/.../web/PurchaseOrderController.java` - `GET /` with `branchId`/`status[]` params, `@PreAuthorize("hasAuthority('vendor.view')")`
- `services/purchasing-service/.../repository/VendorInvoiceRepository.java` - added `findByTenantIdAndBranchIdAndStatusInOrderByInvoiceDateDesc` (reused the existing unfiltered finder)
- `services/purchasing-service/.../service/VendorInvoiceService.java` - `list(branchId, statuses)`, reuses `toDto` so line-level `LineMatchStatus` is present
- `services/purchasing-service/.../web/VendorInvoiceController.java` - `GET /` with `branchId`/`status[]` params, `@PreAuthorize("hasAuthority('vendor.view')")`
- `services/finance-service/.../repository/ExpenseRepository.java` - `findByTenantIdAndBranchIdOrderByExpenseDateDesc` + status-filtered sibling
- `services/finance-service/.../service/ExpenseService.java` - `list(branchId, statuses)`, tenantId from `TenantContext`
- `services/finance-service/.../web/ExpenseController.java` - `GET /` with `branchId`/`status[]` params, `@PreAuthorize("hasAuthority('finance.journal.view')")`
- `services/purchasing-service/src/test/java/io/restaurantos/purchasing/PurchasingListEndpointsIT.java` - new IT, 6 tests: PO list branch/tenant isolation + status filter + tenant-leak negative, invoice list branch/tenant isolation + status filter (asserts line match status) + tenant-leak negative
- `services/finance-service/src/test/java/io/restaurantos/finance/ExpenseApprovalIT.java` - added `list_isBranchAndTenantIsolated_andStatusFilterNarrows` (branch A/B + a second tenant reusing the same branch id + a status filter), extending the existing IT class per the plan's explicit instruction rather than creating a second finance IT

## Response Contract (for 10-12/10-13/10-14)

All three endpoints share the same shape:

```
GET /api/v1/purchasing/purchase-orders?branchId=<uuid>&status=<PoStatus>&status=<PoStatus>...
GET /api/v1/purchasing/invoices?branchId=<uuid>&status=<InvoiceStatus>&status=<InvoiceStatus>...
GET /api/v1/finance/expenses?branchId=<uuid>&status=<ExpenseStatus>&status=<ExpenseStatus>...
```

- `branchId` (required, UUID) — the branch to list within. Tenant is derived server-side from the JWT; there is no `tenantId` param and none should ever be added to these endpoints.
- `status` (optional, repeatable) — zero, one, or many status enum values to narrow the result. Omitted/empty returns all statuses. Uses Spring's default `List<Enum>` binding (`?status=A&status=B` or `?status=A,B` depending on gateway query-param handling — verify against the live gateway when wiring the frontend adapter).
- Envelope: `ApiResponse<List<Dto>>` — **a plain JSON array under `data`, NOT `ApiResponse.paginated`/`PageMeta`** (unlike `VendorController.list`, which does paginate). There is no `page`/`size`/`hasNext` — the whole branch-scoped result set is returned in one call. If pagination is later needed, it is a breaking change to this contract, not additive.
- Ordering: PO and expense lists are newest-`createdAt`-first; the invoice list is newest-`invoiceDate`-first (this differs from PO because it reuses the pre-existing `findByTenantIdAndBranchIdOrderByInvoiceDateDesc` rather than introducing a new ordering column).
- `PurchaseOrderDto`/`VendorInvoiceDto` rows are byte-for-byte identical in shape to what `GET /{id}` returns for the same record, including the nested `lines` array — the same Zod schema used for the detail endpoint can be reused as `z.array(...)` for the list endpoint. `VendorInvoiceDto.LineDto.matchStatus` (`OK`/`QTY_OVER`/`QTY_UNDER`/`PRICE_OVER`/`PRICE_UNDER`/`MISSING_GRN`/`PENDING`) is present per line, which is what the invoice list page's match badge needs.
- `ExpenseDto` fields: `id, branchId, expenseDate, expenseAccountCode, description, amountPaisa, status, requestedBy, approvedBy, approvedAt, rejectReason`.
- Permissions: `vendor.view` (PO + invoice lists), `finance.journal.view` (expense list) — all three were already-seeded permissions with existing consumers (the corresponding `GET /{id}` endpoints); no new permission rows were added in this plan.
- Feature gates: `FEATURE_VENDOR` (purchasing controllers, class-level `@RequiresFeature`) / `FEATURE_FINANCE` (expense controller) — unchanged, inherited from the existing controller classes.
- Money: all `*Paisa` fields are `long` (BIGINT paisa) in the DTO records — no doubles anywhere in this contract.

## Decisions Made

- **Plain list, not paginated.** The plan's task text for all three endpoints explicitly specifies `ApiResponse<List<Dto>>`, not `ApiResponse.paginated(...)`. `VendorController.list`'s `search`/`page`/`size`/`PageMeta` pattern was consciously NOT copied for the response shape, even though its `branchId`-style request-param signature was the model followed. This is a deliberate deviation from the plan's own context note ("copy VendorController's signature style") in favor of the plan's own, more specific and unambiguous task instructions — flagging this so 10-12/10-13/10-14 build a non-paginated Zod list schema, not a paginated one.
- **Ordering column choice documented per-entity**, as the plan asked: `createdAt` (audit column from `TenantAuditableEntity`, confirmed present) for PO and expense; `invoiceDate` (existing domain column) for invoices, reusing the pre-existing finder rather than introducing a redundant ordering.
- **No new permissions.** `vendor.view` and `finance.journal.view` already existed with consumers (10-09's endpoint→permission map for `vendor.view`; the existing expense `GET /{id}` for `finance.journal.view`) — extended rather than duplicated, per the plan's explicit instruction for the expense list.

## Deviations from Plan

None — plan executed exactly as written, including the explicit non-paginated response shape and the IT-placement instruction (extend `ExpenseApprovalIT` rather than create a new finance IT class).

## Issues Encountered

- Initial `PurchasingListEndpointsIT` draft seeded `PurchaseOrder`/`VendorInvoice` rows with a random `vendorId` (and, for invoices, a random `purchaseOrderId`) — both columns carry FK constraints (`purchase_orders_vendor_id_fkey`, `vendor_invoices_vendor_id_fkey`, `vendor_invoices_purchase_order_id_fkey` via `NOT NULL REFERENCES`) that a bare `UUID.randomUUID()` violates. Fixed by adding a `seedVendor(tenant)` helper (persists a real `Vendor` row first) and having `seedInvoice(...)` seed a real `PurchaseOrder` via the existing `seedPo(...)` helper instead of a random UUID. `po_line_id` on `VendorInvoiceLine` has no FK (confirmed via migration grep), so it was left as a random UUID. This was caught and fixed before the first commit — not a runtime deviation, just iteration on the test during writing.
- `restaurantos-clickhouse` and `restaurantos-rabbitmq` were found already stopped (`Exited (137)`, i.e. OOM-killed) at the start of this session, consistent with the documented memory-constrained host. Both were restarted (`docker start`) after the IT run completed and confirmed healthy/starting.

## User Setup Required

None — no external service configuration required. The new endpoints are live as soon as purchasing-service/finance-service redeploy with this code; no migration, no permission seed change (both permissions already existed).

## Next Phase Readiness

- 10-12 (PO journey), 10-13 (invoice journey), and 10-14 (expense journey / FIN-05 frontend) can now build their list pages against real, tested, tenant-isolated backend endpoints instead of the previously-nonexistent `GET /` routes.
- `mvn verify` on purchasing-service: full suite green (all pre-existing ITs + `PurchasingEndpointAuthorizationIT`'s reflection guard + the new `PurchasingListEndpointsIT`, 6/6).
- `mvn verify` on finance-service: `ExpenseApprovalIT` green (5/5, including the new list test). The only failures are the 3 pre-existing, out-of-scope "Branch context required" IT classes (`JournalEntryImmutabilityIT`, `JournalEntryBalanceTriggerIT`, `InternalAutoPostIT`, 6 tests total) already documented in STATE.md Blockers/Concerns — confirmed unchanged in scope and count by this run.
- No blockers for 10-12/10-13/10-14. The one thing those plans need to get right: build a non-paginated Zod list schema (`z.array(...)`, no `PageMeta`), per the Decisions Made section above.

---
*Phase: 10-purchasing-accounts-payable*
*Completed: 2026-07-13*
