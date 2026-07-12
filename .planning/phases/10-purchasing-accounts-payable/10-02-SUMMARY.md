# Plan 10-02 Summary — Mock GRN → invoice → pay + FIN-05 + frontend

**Status:** Complete  
**Wave:** 2  
**Depends on:** 10-01

## Delivered

### Backend
- Flyway V2: `vendor_invoices`, `vendor_invoice_lines`, `ap_payments`, `ap_payment_allocations`
- `GrnReceiptSimulator` + `POST .../mock-receive` (404 when `integration-mode=feign`)
- `ThreeWayMatchService` (F1, F4, F6 scenarios)
- `VendorInvoiceService`, `ApPaymentService`, `VendorAnalyticsService`
- Finance auto-post on GRN (1300/1700), invoice match (1700/1710→2100), payment (2100→1110)
- Events: `STOCK_RECEIVED`, `VENDOR_INVOICE_MATCHED`, `AP_PAYMENT_PROCESSED`
- Finance: `ApArController` + `ApAgingService` (FIN-05); `PurchasingInternalClient` path updated

### Tests
- `GrnReceiptSimulatorIT` (F7 idempotency)
- `ThreeWayMatchIT` (F1/F4/F6 unit scenarios)
- `PurchasingMockE2EIT` (full mock flow)

### Frontend + MSW
- `frontend/mocks/purchasing.handlers.ts` (F1–F6 fixtures)
- Four-layer stack: schema, adapter, repository, hooks
- Pages: vendors, PO detail + `MockGrnReceivePanel`, invoice detail + `ThreeWayMatchTable`
- Registered in MSW `server.ts`

## Verification

All purchasing-service integration tests green (10 total).

## Phase 8 swap

Set `restaurantos.inventory.integration-mode=feign` and implement `InventoryGrnClient` when inventory-service GRN endpoint lands.
