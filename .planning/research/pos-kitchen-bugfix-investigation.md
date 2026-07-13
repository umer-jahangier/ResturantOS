# POS & Kitchen Production Bug-Fix & UX Revamp — Investigation Findings

> Source: `bugs.md` (testing feedback on completed Phase 07.1). Investigated via 4 parallel
> code-reading passes across `frontend`, `services/pos-service`, `services/kitchen-service`,
> `services/finance-service`. This document is the authoritative input for planning the new
> phase. **No code changed during investigation.**
> Date: 2026-07-12.

## User decisions (locked)

1. **Modal→page revamp scope:** POS + KDS *operational* surfaces only (payment, order/table
   detail drawer, void/refund, till open/close, KDS detail). Leave command palette and finance
   modals untouched.
2. **Payment history:** persist `OrderPayment` rows on payment + add a GET-payments endpoint.
3. **Reserved table status:** show only Available/Occupied for now (no reservations feature yet).
4. **Post-Send behavior:** *Send to Kitchen* does NOT auto-reset the terminal. Instead show an
   explicit **Clear / New Order** action. **Charge Now is disabled until the order has been sent
   to kitchen** (guarantees proper persistence before taking money).
5. **Settlement semantics (new Bug 16):** paying records payment + sets paymentStatus, but does
   NOT auto-close. An order CLOSES only when it is **both fully Paid AND fully Served**. The
   close check runs on *both* the payment flow and the mark-served flow.

## Key architectural insight

The backend is far more capable than the UI uses. Item-level status, kitchen-ticket revisions,
optional tables, per-item transitions (`markItemStatus`), and station routing already exist
server-side. Most bugs are **frontend wiring gaps + one missing cross-service event + one
settlement-flow change**, not deep backend rework.

Three threads tie the bugs together:
- Cart is server-authoritative from the first tap → bugs 1, 10, 12 (shapes 13).
- Kitchen→POS emits only a coarse aggregate `ORDER_READY` → bug 3; missing drawer "fire" CTA → bug 5.
- `OrderSummaryDto` is deliberately thin + everything is a modal → bugs 9, 15, 2, 4 + the revamp.

---

## Per-bug findings

### Cluster 1 — Order-taking lifecycle

**Bug 1 — Draft orders persisted on first tap.** `components/pos/pos-terminal.tsx:52-82`
`ensureOrderId()` calls `useCreateOrder` on first item tap → `POST /pos/orders` →
`OrderServiceImpl.java:112-145` sets `status=DRAFT` (`:127`) and saves immediately (`:143`).
`listOrderSummaries` default filter includes DRAFT (`OrderServiceImpl.java:427-431`), so empty/
abandoned orders leak into Order Management. DRAFT modeled at `OrderStatus.java:4`, `Order.java:38,42`,
`pos.model.ts:5`, `pos.schema.ts:92,99`.
*Fix:* local React-state cart in `pos-terminal.tsx`; persist lazily on Send/Charge (createOrder +
addItem, or a new batch create-with-items endpoint for atomicity). Backend: exclude DRAFT from
summaries default; ideally retire DRAFT as a persisted state. **Risk: HIGH** — preserve
`clientOrderId` idempotency (`OrderServiceImpl.java:115-118`, unique constraint `Order.java:92`),
table occupancy `syncStatusForOrder` (`:220`), `ORDER_CREATED` event (`:228-243`), offline stub
path (`use-orders.ts:66-79`).

**Bug 12 — Duplicate lines instead of ×N.** Every tap = `addItem` w/ qty 1
(`pos-terminal.tsx:80-89`); backend always `new OrderItem()` (`OrderServiceImpl.java:169,208`); no
quantity endpoint (`OrderController` has add `:58` + remove `:65` only); static `×{qty}` render
(`order-panel.tsx:309-313`).
*Fix:* merge in local cart on identical `menuItemId` + modifierIds + notes; +/- controls. A
re-order of an already-fired item must create a NEW pending line (sendToKds fires only PENDING,
`OrderServiceImpl.java:326-344`). Modifier equality must use `modifierIds` set (snapshots are weak:
`addItem` stores `modifierNameSnapshot=modifierId.toString()`, `priceDeltaPaisa=0`, `:185-191`).
**Risk: MEDIUM.**

**Bug 13 — Table mandatory.** Backend `tableId` already optional (`CreateOrderRequest.java:12` no
`@NotNull`; bound only if non-null `OrderServiceImpl.java:132-134`). Mandatoriness is UX: only entry
is tapping an AVAILABLE floor tile (`table-floor-view.tsx:37-43` → `page.tsx:76-87`);
`pos-terminal.tsx:61` hardcodes `type:"DINE_IN"`; no type selector, no in-terminal table picker.
No RESERVED status (`TableStatus.java` = AVAILABLE/OCCUPIED/NEEDS_BUSSING; mirror `pos.schema.ts:38`,
`pos.model.ts:39`).
*Fix:* order-type toggle (Dine-in/Takeaway/Pickup) + searchable table selector (status badges,
occupied disabled). Reserved: show Available/Occupied only (decision 3). **Risk: LOW–MED** —
`page.tsx` remounts terminal via `key={selectedTableId}` (`:73`).

**Bug 10 — Panel not reset.** `activeOrderId` never cleared after send/charge
(`pos-terminal.tsx:22`); also `orderIdRef` (`:41`), `creatingOrderRef` (`:45`). Send only calls
`sendToKds` (`order-panel.tsx:79-88`, `pos-terminal.tsx:91-94`); charge `onClose` just closes dialog
(`settlement-actions.tsx:74`).
*Fix (per decision 4):* explicit **Clear / New Order** button in terminal after send; reset only on
confirmed success, never on dialog-dismiss. Trivial once cart is local. **Risk: LOW.**

### Cluster 2 — Kitchen ↔ POS sync

**Bug 3 — Kitchen status never reaches POS.** Frontend DOES refetch on open (`useOrder` staleTime:0,
enable-on-open `order-table-detail-drawer.tsx:61`). Data is stale because pos-service is never told:
`TicketServiceImpl.markItemStatus` (`kitchen-service:53-88`) updates only kitchen `KdsTicketItem.status`
+ pushes KDS websocket (`:86`); publishes back only via `checkAndPublishOrderReady` (`:158-178`),
which emits `ORDER_READY` ONLY when no ticket is still PENDING/COOKING (whole order done). Per-item
"Done" and intermediate states (ACCEPTED/PREPARING) never propagate. `OrderReadyConsumer.markOrderReady`
(`pos-service:88-118`) jumps eligible items to READY.
*Fix (backend-led):* emit `KITCHEN_ITEM_STATUS_CHANGED {orderId, orderItemId, newStatus, revisionNo}`
on every item transition; new pos-service consumer maps `orderItemId`→`OrderItem` (join key already
present: `TicketRoutingService.buildItems:122` sets `orderItemId`), sets `itemStatus`, recomputes
`derivedStatus` via `OrderStatusDerivationService.derive`. Frontend: add `refetchInterval` to `useOrder`
for live updates while open. **Risk: MEDIUM** — messaging topology + field-name parity (silent drop
warning `KitchenEventPayloads.java:17-20`), `processed_events` idempotency, don't downgrade
SERVED/CANCELLED (reuse `ELIGIBLE_FOR_READY` guard `OrderReadyConsumer.java:45-47`).

**Bug 5 — Added items never reach kitchen.** Backend revision flow is fully correct
(`addItem` persists PENDING; `sendToKds:295-392` fires only PENDING, assigns `nextRevision`, publishes
only new items; `TicketRoutingService.route/appendToExistingTicket:53-94` appends new revision,
reopens READY→PENDING). BUT the Order-Management drawer renders only QuickAddSearch + Instructions +
SettlementActions (`order-table-detail-drawer.tsx:123-136`) — **no Send-to-Kitchen CTA** (that lives
only in `order-panel.tsx:75,152-158`). Added items stay PENDING forever.
*Fix (frontend-only):* wire `useSendToKds` + revision-aware "Send New Items (N)" CTA into the drawer;
seed cache from mutation response for instant UI (`useAddItem` discards the returned Order,
`use-orders.ts:127-131`; repo returns it `pos.repository.ts:111-114`); add manual Refresh button to
Order Management (`useOrderSummaries` has no refetchInterval/refresh). **Risk: LOW — no backend change.**
Gate CTA off resolved `order` for both order- and table-centric drawer modes.

**Bug 8 — Repeated `HEAD /api/v1/pos/menu/categories 404`.** `lib/offline/use-online-status.ts:5,38-42`
pings a RELATIVE URL (resolves to Next.js origin :3000, not gateway :8080 — no rewrites in
`next.config.ts`) with no auth, HEAD method. Real calls go via axios `apiClient` baseURL :8080
(`api-client/client.ts:13`). Backend route is `@GetMapping("/categories")` w/ `@RequiresFeature`
(`MenuController.java:27-30`).
*Fix:* delete the ping + interval; keep `navigator.onLine` event path (already present `:17-27,51-72`).
Do NOT add a HEAD handler (wrong target, needs auth). **Risk: VERY LOW.**

### Cluster 3 — Settlement, Payments & Order Management

**Bug 16 (NEW) — Charging must not auto-close; CLOSE requires Paid AND Served.** Currently
`closeOrder(payments)` records payment + flips to CLOSED atomically (`OrderServiceImpl.java:498-592`).
Payments are effectively write-only: closeOrder only publishes `ORDER_CLOSED` (does NOT persist
`OrderPayment`); the `OrderPayment` table is written only by `PaymentServiceImpl.recordPayment:35`,
which the frontend never calls; no GET payments endpoint; `OrderPaymentRepository.findByOrderId` unused.
*Fix:* (1) decouple payment recording from CLOSE — `paymentStatus` becomes derived
(sum(OrderPayment) vs totalPaisa): UNPAID/PARTIALLY_PAID/PAID (REFUNDED via status). (2) single
`maybeCloseOrder(order)` seam that closes iff `paymentStatus==PAID && derivedStatus==SERVED`, invoked
from BOTH payment path and mark-served path. (3) persist `OrderPayment` on payment (decision 2). (4)
Frontend: Charge shows "Paid ✓" + live kitchen status; order shows Closed only when both conditions met.
**Risk: HIGH** — changes settlement state machine (`stateMachine.assertTransition`); interacts with
finance period-lock blocker (see Dependencies). Duplicate-payment already blocked server-side
(`PaymentServiceImpl.java:43-48` throws for CLOSED/VOIDED/REFUNDED).

**Bug 2 + 4 — Charge Now cramped modal.** `settlement-actions.tsx:69-76` mounts `PaymentPanel` in
`Dialog sm:max-w-md`; panel receives only `{order,onClose}` and renders totals + split-tender only
(`payment-panel.tsx:54,116-161`). Most required fields already on `Order` (orderNo, tableId, coverCount,
openedAt, subtotal/tax/discount/serviceCharge/total, notes, items[] w/ qty/status/notes/modifiers) but
unused. Genuinely missing: payment history (new endpoint), customer/cashier NAMES (bare UUIDs), and
there is NO "server" concept — only `cashierId`.
*Fix:* dedicated full-page charge route (e.g. `app/(tenant)/app/pos/orders/[orderId]/charge/page.tsx`)
rendering full header + items + tax/discount/charge breakdown + split-tender + payment history +
remaining. Backend: `GET /orders/{id}/payments` (via `findByOrderId`). **Risk: MEDIUM** — PaymentPanel
shared by `order-panel.tsx:159`, `order-table-detail-drawer.tsx:135` via SettlementActions; preserve
"Paid ✓" chip logic.

**Bug 9 — Closed orders invisible + no search + payment status.** (1) `useOrderSummaries` called with
no `statuses` (`order-management.tsx:109`); backend defaults to non-terminal only
(`OrderServiceImpl.java:427-431`, `isTerminal:694`). (2) `STATUS_FILTERS` lists only 4
DerivedOrderStatus values (`order-management.tsx:29-35`); `OrderSummary` has no settlement status. (3)
No search UI. Payment-status derivation not currently possible (no field). Duplicate-payment already
prevented (UI `settlement-actions.tsx:41-48`; backend throws).
*Fix:* extend `OrderSummaryDto` (settlement status + derived paymentStatus + amountPaidPaisa);
propagate schema/adapter/model; pass `statuses` to hook; add Closed/Paid filters + search Input +
payment badges; open closed orders read-only. **Risk: MED** — `useFadeOutList` invariant
(`order-management.tsx:58-105`) assumes non-closed rows never disappear.

**Bug 15 — "Cover" column → item quantity.** Column at `order-management.tsx:156-160` renders
`coverCount`. Blocked only by thin DTO (no item data). `toSummaryDto` (`OrderServiceImpl.java:698-710`)
has `order.getItems()`; add `itemQuantity=sum(qty)` + `distinctItemCount=items.size()` (exclude
CANCELLED). *Also note:* `toSummaryDto:442` calls `DiningTable::getTableNumber` while field is
`tableName` — verify accessor when touching. **Risk: LOW.**

**Bug 14 — Assign table to existing order.** Capability exists nowhere (no OrderController route, no
`assignTable` service method, no hook, no searchable selector). `Order.tableId` set only at create
(`OrderServiceImpl.java:132-134`).
*Fix:* `PATCH /orders/{id}/table` — validate target AVAILABLE, reject OCCUPIED/NEEDS_BUSSING, set
tableId, route through `TableService.syncStatusForOrder` (single seam, `:220`), respect optimistic
`version`. Frontend: `useAssignTable` + "Assign Table" action reusing the bug-13 selector filtered to
AVAILABLE. **Risk: MED** — AVAILABLE re-check inside txn for concurrency.

### Cluster 4 — KDS redesign

**Bug 6 — KDS redesign.** Backend ~70% ready: `KdsStation` (code/name/active/escalationThresholdSeconds
default 900s), `KdsTicket` (one per order×station, `stationCode`, `priority`, timestamps, items),
`KdsTicketItem` (orderItemId, name, qty, modifiers jsonb, notes, `status: TicketItemStatus`,
revisionNo, firedAt — item-level status IS a persisted column, `V1__kitchen_schema.sql:62`). Station
routing exists (`TicketRoutingService.route:54-70`, groups by `kdsStation`, null→"DEFAULT"). General
`markItemStatus` (`TicketServiceImpl.java:53-88`) supports arbitrary transitions but is NOT exposed via
REST (only `bumpItem` 2-step PENDING→COOKING→READY `:105-110`, and `recall`). WebSocket push exists
(`KdsWebSocketHandler`, keyed branchId:stationCode). Current UI: stations-as-columns
(`kds-board.tsx:71`), heavy card w/ per-item badges+bump (`kds-ticket-card.tsx:138-188`), detail in a
**Dialog modal** (`:77-105`). Missing: status-columns, isolated station view, **table number
end-to-end** (not in KdsTicket/DTO/event), a **detail page**, and — **LIVE BLOCKER** — no station
rows are ever seeded (no INSERT, no create endpoint) → `GET /stations` empty → board shows "No active
stations configured."
*Fix (frontend-heavy + 3 additive backend pieces):* routes `kitchen/` (station picker) →
`kitchen/[stationCode]` (New/Started/Preparing/Ready item-columns) →
`kitchen/[stationCode]/orders/[ticketId]` (detail page — kills Dialog). Item-status columns map to
`TicketItemStatus`: New=PENDING, Started=ACCEPTED, Preparing=PREPARING(+legacy COOKING), Ready=READY;
render item-centric so mixed statuses in one order work. Slim card to Order#/Table/Time/Items.
Backend: (1) explicit item-status endpoint wrapping `markItemStatus` + broaden `validateTransition`;
(2) table-number propagation pos→`OrderSentToKdsPayload`→`KdsTicket`+column (new Flyway)→DTO→FE; (3)
station seeding (≥ DEFAULT per branch). **Risk: HIGH** — cross-service contract + station-seed blocker.

**Bug 7 — Prioritization.** Sort is `receivedAt` ascending (FIFO, `kds-board.tsx:18-26`) — spec says
"newest first" but FIFO is arguably correct; recommend FIFO + new-arrival highlight. Aging uses
`animate-bounce` + full red at 15m (`getAgingClasses:26-35`) — too aggressive. Per-card `setInterval`
(`kds-ticket-card.tsx:17-24`) won't scale.
*Fix:* subtle left-border + timer chip driven by station `escalationThresholdSeconds`; single shared
clock context; new-arrival highlight; wire existing `priority` flag (never set today). **Risk: LOW.**

### Overarching — "kill the modals" (decision 1: POS+KDS operational only)

Modal/overlay inventory (10 surfaces):
1. `settlement-actions.tsx:69-76` — Charge → PaymentPanel in Dialog. **[convert — bug 2/4]**
2. `order-table-detail-drawer.tsx:74-140` — order/table detail as Dialog-based right drawer. **[convert]**
3. `void-refund-dialog.tsx:95-215` — hand-rolled `fixed inset-0` modal. **[convert]**
4. `till-session-bar.tsx:89-128,161-239` — two hand-rolled modals (open/close till). **[convert]**
5. `order-panel.tsx:366-394` — inline cancel-item confirm (not overlay) — minor.
6. `kds-ticket-card.tsx:77-100` — Dialog ticket detail. **[convert — bug 6]**
7. `command-palette.tsx:31-39` — Dialog. **[leave — inherently an overlay]**
8. `finance/ProvisionPeriodDialog.tsx` — **[leave — out of scope]**
9. `finance/PeriodCloseModal.tsx` — **[leave — out of scope]**
10. `shared/branch-switch-overlay.tsx` — transition overlay **[leave]**
No shadcn Sheet/Drawer primitive exists — only `components/ui/dialog.tsx`.

---

## Consolidated backend work

| Change | Service(s) | Bugs |
|---|---|---|
| Exclude/retire DRAFT from summaries; atomic create-with-items | pos | 1 |
| `KITCHEN_ITEM_STATUS_CHANGED` event + pos consumer (per-item status) | kitchen→pos | 3 |
| Persist `OrderPayment` on payment + `GET /orders/{id}/payments` | pos (+finance) | 2, 16 |
| Decouple payment from CLOSE; `maybeCloseOrder` (Paid&&Served); derived paymentStatus | pos | 16 |
| Extend `OrderSummaryDto` (settlement status, paymentStatus, itemQty, distinctCount) | pos | 9, 15 |
| `PATCH /orders/{id}/table` (assign-table via syncStatusForOrder) | pos | 14 |
| Explicit item-status endpoint (wraps markItemStatus) | kitchen | 6 |
| Table-number propagation (order→event→ticket→DTO) + Flyway | pos+kitchen | 6 |
| Station seeding (DEFAULT per branch) | kitchen | 6 |

Everything else is frontend. All cross-service payload changes carry field-name-parity risk
(silent message drop) → run impact analysis before edits (CLAUDE.md rule).

## Dependencies & risks

- **Finance period-lock blocker** ([[finance-period-bootstrap-blocker]]): persisting payments /
  closing orders hits finance-service; fresh tenants 423 `PERIOD_LOCKED`. Treat "open accounting
  period exists" as a precondition for testing Cluster 3. Phase 07.2 (in-flight) addresses period
  provisioning — coordinate.
- **Station-seed blocker:** KDS board renders empty without seeded stations — must ship in Cluster 4.
- **Cross-service messaging parity:** highest-risk items (bugs 3, 6) — exact field-name match required.
- **Verification:** drive UI/UAT via Playwright (user preference [[user-prefers-playwright-verification]]).

## Proposed execution order (work packages)

1. Quick wins — bug 8, bug 15
2. Order-taking refactor — bugs 1, 12, 10, 13 (local cart, type/table selector, Clear action, charge-gating)
3. Kitchen↔POS sync — bugs 3, 5
4. Settlement redesign — bug 16 + bug 2/4 + persisted payments
5. Order Management — bug 9, bug 14
6. KDS redesign — bugs 6, 7 (+ station seed, table propagation)
7. Modal→page sweep — remaining POS overlays (void/refund, till)
