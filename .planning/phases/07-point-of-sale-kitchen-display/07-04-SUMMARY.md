---
phase: "07"
plan: "04"
name: "kitchen-display-system"
subsystem: "kitchen-service + kds-frontend"
tags:
  - kitchen-service
  - kds
  - websocket
  - rabbitmq
  - opa
  - role-isolation
  - always-dark-ui
  - tanstack-query

dependency-graph:
  requires:
    - "07-01: pos-service scaffold, ORDER_SENT_TO_KDS event, POS permissions"
    - "07-02: pos-service complete write side, pos.rego at 100%"
  provides:
    - "kitchen-service (8090/kitchen_db) with Flyway V1+V2 schema"
    - "ORDER_SENT_TO_KDS consumer → station-routed tickets (GRILL/DRINKS/DEFAULT)"
    - "Ticket lifecycle PENDING→COOKING→READY → ORDER_READY when all tickets ready"
    - "ORDER_VOIDED consumer → cancels all tickets for order (idempotent)"
    - "KITCHEN_STAFF role with ONLY pos.kds.view + pos.kds.update"
    - "kds.rego + pos.rego at 100% OPA coverage"
    - "KDS REST + WebSocket (JWT + pos.kds.* + FEATURE_KDS enforced)"
    - "POS OrderReadyConsumer flips order to READY/PARTIAL_READY"
    - "Always-dark WebSocket KDS board with ticket aging + bump (perm-gated)"
    - "Sidebar gates: KITCHEN_STAFF sees only Kitchen; CASHIER sees only POS; OWNER sees both"
  affects:
    - "Phase 8+: Inventory depletion already consumes ORDER_CLOSED; ORDER_READY closes POS↔kitchen loop"
    - "Reporting: ticket aging metrics available from kds_tickets.received_at/ready_at"

tech-stack:
  added:
    - "spring-boot-starter-websocket — KDS live push"
    - "kitchen-service module in parent pom + docker-compose (8090)"
  patterns:
    - "Station routing: group ORDER_SENT_TO_KDS items by kdsStation (null → DEFAULT)"
    - "ORDER_READY only when ALL non-cancelled tickets for order are READY"
    - "WebSocket JWT handshake via ?token= query param; reject 1008 without pos.kds.view"
    - "Always-dark KDS board: ignores tenant theme, force dark/bg-gray-950"
    - "Ticket aging: green <10m, amber+pulse 10-15m, red+bounce 15m+"
    - "Access isolation: KITCHEN_STAFF 403 on POS; CASHIER 403 on KDS REST+WS"

key-files:
  created:
    - "services/kitchen-service/ — full Spring Boot microservice"
    - "services/kitchen-service/src/main/resources/db/migration/V1__kitchen_schema.sql"
    - "services/kitchen-service/src/main/resources/db/migration/V2__kitchen_infra_tables.sql"
    - "services/kitchen-service/src/main/java/io/restaurantos/kitchen/consumer/OrderSentToKdsConsumer.java"
    - "services/kitchen-service/src/main/java/io/restaurantos/kitchen/consumer/OrderVoidedConsumer.java"
    - "services/kitchen-service/src/main/java/io/restaurantos/kitchen/service/TicketRoutingService.java"
    - "services/kitchen-service/src/main/java/io/restaurantos/kitchen/service/TicketServiceImpl.java"
    - "services/kitchen-service/src/main/java/io/restaurantos/kitchen/web/KdsController.java"
    - "services/kitchen-service/src/main/java/io/restaurantos/kitchen/ws/KdsWebSocketHandler.java"
    - "services/auth-service/.../042-kds-permissions-kitchen-role.xml"
    - "policies/restaurantos/kds.rego"
    - "policies/tests/kds_test.rego"
    - "services/pos-service/.../consumer/OrderReadyConsumer.java"
    - "services/pos-service/.../config/PosKitchenTopologyConfig.java"
    - "frontend/lib/api-client/schemas/kds.schema.ts"
    - "frontend/lib/models/kds.model.ts"
    - "frontend/lib/adapters/kds.adapter.ts"
    - "frontend/lib/repositories/kds.repository.ts"
    - "frontend/lib/hooks/kds/use-kds-tickets.ts"
    - "frontend/lib/hooks/kds/use-kds-socket.ts"
    - "frontend/app/(tenant)/app/kitchen/page.tsx"
    - "frontend/components/kds/kds-board.tsx"
    - "frontend/components/kds/kds-ticket-card.tsx"
    - "frontend/__tests__/kds/kds-board.test.tsx"
  modified:
    - "pom.xml — add kitchen-service module"
    - "docker/docker-compose.yml — kitchen-service on 8090"
    - ".github/workflows/coverage-gates.json — kitchen-service 60%"
    - "frontend/components/shared/sidebar-nav-items.ts — KDS + POS nav gating"
    - "frontend/lib/hooks/query-keys.ts — kds.tickets + kds.stations keys"

decisions:
  - id: "07-04-A"
    decision: "KITCHEN_STAFF role gets ONLY pos.kds.view + pos.kds.update — no pos.order.* or finance.*"
    rationale: "User requirement: dedicated kitchen login strictly isolated from cashier/finance; proven by KdsAccessIsolationIT + kds_test.rego"
  - id: "07-04-B"
    decision: "MANAGER gets pos.kds.view only (read-only oversight), not pos.kds.update"
    rationale: "Managers can monitor kitchen throughput without ability to bump tickets"
  - id: "07-04-C"
    decision: "RabbitMQ topology (pos.order-ready.queue) declared in PosKitchenTopologyConfig @Configuration, not Flyway"
    rationale: "Resolves plan-checker blocker: Rabbit topology is code/definitions.json, never SQL migrations"
  - id: "07-04-D"
    decision: "KDS board always dark — does NOT respect useTheme()"
    rationale: "Kitchen environment readability at 2m distance; research M10.3 / design 7.2"
  - id: "07-04-E"
    decision: "WebSocket merges ticket frames into TanStack Query cache; HTTP polls every 10s as fallback"
    rationale: "≤2s live updates via WS; polling ensures board stays current if WS drops"

metrics:
  duration: "~5 hours (multi-session)"
  completed: "2026-06-30"
  tests-added: "kitchen-service ITs + kds-board 6 vitest + kds_test.rego 100%"
  files-created: 30+
  files-modified: 6

---

# Phase 7 Plan 04: Kitchen Display System Summary

**One-liner:** A dedicated kitchen-service routes ORDER_SENT_TO_KDS into station tickets, signals ORDER_READY when all stations complete, and exposes an always-dark WebSocket KDS board gated by KITCHEN_STAFF role isolation.

## Objective

Build the Kitchen Display System end-to-end: consume POS kitchen events, route tickets by station, progress items through PENDING→COOKING→READY, publish ORDER_READY back to POS, and deliver a role-isolated always-dark frontend board with live WebSocket updates.

## Tasks Completed

| # | Task | Commit | Key Deliverables |
|---|------|--------|------------------|
| 1 | kitchen-service scaffold + Flyway DDL + WebSocket config | `56aa4fc` | V1 schema (kds_stations, kds_tickets, kds_ticket_items), V2 infra, port 8090, docker-compose |
| 2 | ORDER_SENT_TO_KDS consumer + station routing + ORDER_READY | `20de266` | TicketRoutingService, TicketServiceImpl, OrderSentToKdsConsumer, OrderVoidedConsumer, 3 ITs |
| 3 | KITCHEN_STAFF role + pos.kds.* permissions + kds.rego | `3238d53` | Liquibase 042, kds.rego, kds_test.rego 100% coverage |
| 4 | KDS REST + WebSocket JWT + POS ORDER_READY consumer + isolation IT | `e18ab93` | KdsController, KdsWebSocketHandler, OrderReadyConsumer, PosKitchenTopologyConfig, KdsAccessIsolationIT |
| 5 | KDS board frontend (always-dark, WebSocket) + sidebar role gating | `7243eef` | Four-layer KDS frontend, kds-board + kds-ticket-card, sidebar nav gating, 6 vitest tests |

## Architecture

```
POS (8084)                          RabbitMQ                         Kitchen (8090)
  │                                    │                                  │
  ├─ sendToKds()                       │                                  │
  │   └─ ORDER_SENT_TO_KDS ───────────►│ kitchen.order-sent.queue         │
  │                                    │   └─ OrderSentToKdsConsumer      │
  │                                    │       └─ TicketRoutingService    │
  │                                    │           (GRILL/DRINKS/DEFAULT) │
  │                                    │                                  │
  │                                    │   ◄── KdsWebSocketHandler ───────┤
  │                                    │       push ticket frames         │
  │                                    │                                  │
  │   ◄── ORDER_READY ─────────────────│ kitchen.order.ready              │
  │   OrderReadyConsumer               │   (all tickets READY)            │
  │   order.status → READY             │                                  │
  │                                    │                                  │
  └─ voidOrder()                       │                                  │
      └─ ORDER_VOIDED ────────────────►│ kitchen.order-voided.queue       │
                                       │   └─ cancelTicketsForOrder()     │
```

## Role Isolation (User Requirement)

| Role | POS Access | KDS Access | Sidebar |
|------|-----------|-----------|---------|
| KITCHEN_STAFF | ❌ 403 | ✅ view + bump | Kitchen only |
| CASHIER | ✅ create/view | ❌ 403 REST + WS | POS only |
| MANAGER | ✅ full POS | ✅ view only (no bump) | POS + KDS view |
| OWNER | ✅ all | ✅ all | All modules |
| ACCOUNTANT | ✅ finance | ❌ 403 KDS | Finance only |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Kitchen page lacked FeatureGuard + PermissionGuard**
- **Found during:** Task 5 completion review
- **Issue:** Plan required `FeatureGuard("FEATURE_KDS")` + `PermissionGuard("pos.kds.view")` on kitchen page; initial commit relied on comment that layout/middleware handled gating
- **Fix:** Wrapped `KitchenPage` with explicit guards matching POS page pattern
- **Status:** Applied in working tree (post-`7243eef`)

**2. [Enhancement] AudioContext beep on new ticket via WebSocket**
- **Found during:** Task 5 completion review
- **Issue:** Plan listed optional AudioContext cue on new ticket — not implemented in initial commit
- **Fix:** Added `playNewTicketBeep()` in `use-kds-socket.ts` when a new ticket frame arrives (idx === -1)
- **Status:** Applied in working tree (post-`7243eef`)

## Verification

| Check | Result |
|-------|--------|
| `mvn -pl services/kitchen-service verify` | Green (TicketRoutingIT, TicketLifecycleIT, OrderVoidedCancelsTicketsIT, KdsAccessIsolationIT) |
| `opa test policies/ --coverage` | 100% (pos.rego + kds.rego) |
| `pnpm vitest run __tests__/kds/kds-board.test.tsx` | 6/6 passed |
| KITCHEN_STAFF JWT → POS POST /orders | 403 |
| CASHIER JWT → GET /kitchen/kds/tickets | 403 |
| KDS board `.dark.bg-gray-950` | Always dark regardless of theme |
| Sidebar KITCHEN_STAFF | Kitchen Display only (no POS nav item) |

## Next Phase Readiness

Phase 7 is complete (all 4 plans done). Phase 8 (Inventory) can consume ORDER_CLOSED events from 07-02. The ORDER_READY loop is closed — cashiers see READY status when kitchen completes all station tickets.
