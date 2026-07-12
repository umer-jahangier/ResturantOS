---
phase: "07"
plan: "03"
name: "offline-pwa-indexeddb-sync"
subsystem: "frontend-pwa"
tags:
  - pwa
  - service-worker
  - indexeddb
  - offline-first
  - sync-engine
  - tanstack-query
  - vitest
  - playwright

dependency-graph:
  requires:
    - "07-01: pos-service scaffolded, order state machine, frontend POS terminal + floor view"
    - "07-02: till sessions, split-tender payments, idempotent ORDER_CLOSED, voids/refunds frontend UI"
  provides:
    - "PWA manifest + service worker (StaleWhileRevalidate menu/tables, NetworkOnly mutations)"
    - "IndexedDB schema (outbox, menu_cache, meta) via idb library"
    - "FIFO sync engine with client_order_id idempotency dedupe reconciliation"
    - "Offline-aware useCreateOrder/useAddItem mutations (enqueue + optimistic stub)"
    - "Online-only guards on closeOrder/voidOrder/refundOrder/openTill/closeTill"
    - "OfflineIndicator banner + SyncStatusBadge with Retry now button"
    - "POS layout.tsx: SW registration + replay-on-reconnect event listener"
    - "E2E Playwright scaffold: offline create → reconnect → exactly one order"
  affects:
    - "07-04: KDS can also benefit from offline buffering pattern"
    - "Phase 12+: NLQ reporting may want menu cache from IndexedDB"

tech-stack:
  added:
    - "idb@8.0.3 — typed IndexedDB wrapper"
    - "fake-indexeddb@6.2.5 (devDependency) — in-memory IndexedDB for vitest"
  patterns:
    - "Outbox pattern: queue offline mutations → FIFO replay on reconnect"
    - "Single-flight guard on replay() — concurrent triggers short-circuit"
    - "Optimistic offline stub: createOrder offline returns DRAFT Order immediately"
    - "Online-only guard: throw OFFLINE_ERROR for financial-integrity critical mutations"
    - "Progress subscriber pattern: onProgress(cb) → unsubscribe fn"

key-files:
  created:
    - "frontend/public/manifest.webmanifest"
    - "frontend/public/sw.js"
    - "frontend/workbox/sw.ts"
    - "frontend/lib/offline/sw-register.ts"
    - "frontend/lib/offline/use-online-status.ts"
    - "frontend/lib/offline/types.ts"
    - "frontend/lib/offline/db.ts"
    - "frontend/lib/offline/outbox.ts"
    - "frontend/lib/offline/menu-cache.ts"
    - "frontend/lib/offline/sync-engine.ts"
    - "frontend/components/pos/offline-indicator.tsx"
    - "frontend/components/pos/sync-status-badge.tsx"
    - "frontend/app/(tenant)/app/pos/layout.tsx"
    - "frontend/e2e/pos-offline.spec.ts"
    - "frontend/__tests__/offline/outbox.test.ts"
    - "frontend/__tests__/offline/sync-engine.test.ts"
  modified:
    - "frontend/next.config.ts — Service-Worker-Allowed + manifest headers"
    - "frontend/tsconfig.json — exclude workbox/ from main compilation"
    - "frontend/package.json — add idb + fake-indexeddb"
    - "frontend/lib/hooks/pos/use-orders.ts — offline-aware createOrder/addItem"
    - "frontend/lib/hooks/pos/use-payments.ts — online-only guards"
    - "frontend/lib/hooks/pos/use-till.ts — online-only guards for openTill/closeTill"
    - "frontend/components/pos/menu-grid.tsx — data-testid attributes"
    - "frontend/components/pos/table-floor-view.tsx — data-testid attributes"
    - "frontend/components/pos/payment-panel.tsx — data-testid + actual error message display"

decisions:
  - id: "07-03-A"
    decision: "Manual service worker (public/sw.js) instead of @serwist/next"
    rationale: "@serwist/next had uncertain compatibility with Next.js 16 App Router; a hand-authored sw.js with native Workbox API avoids plugin complexity and works identically"
  - id: "07-03-B"
    decision: "clientOrderId in APPEND_ITEMS outbox op stores the order's UUID (server or local), not a new UUID"
    rationale: "The sync engine uses clientOrderId as the orderId parameter for PosRepository.addItem(), so it must be the target order's stable identifier"
  - id: "07-03-C"
    decision: "OfflineIndicator uses native browser online/offline events directly, not useOnlineStatus hook"
    rationale: "ESLint rule react-hooks/set-state-in-effect forbids calling setState inside useEffect body; subscribing to DOM events in the effect and calling setState in the callback is the compliant pattern"
  - id: "07-03-D"
    decision: "SyncStatusBadge renders null when pending=0 and no error"
    rationale: "Badge disappears on successful sync (clean UI); the E2E test uses toBeHidden() to verify sync completion rather than checking for '0'"
  - id: "07-03-E"
    decision: "Online-only guard throws synchronously inside mutationFn, not in onMutate"
    rationale: "Throwing in mutationFn causes the mutation to enter isError state and shows the error message in onError / isError checks in the component"

metrics:
  duration: "~4 hours (multi-session: prior session Tasks 1-3, this session Tasks 4-5)"
  completed: "2026-06-30"
  tests-added: 14
  files-created: 16
  files-modified: 8
---

# Phase 7 Plan 03: Offline PWA + IndexedDB Sync Summary

**One-liner:** IndexedDB outbox with FIFO CRDT-style replay and client_order_id idempotency transforms the POS into an offline-first PWA using a hand-authored Workbox service worker.

## Objective

Make the POS terminal offline-capable: cashiers can create orders and add items when the network drops; orders queue locally and replay automatically on reconnect without creating duplicates.

## Tasks Completed

| # | Task | Commit | Key Files |
|---|------|--------|-----------|
| 1 | PWA shell — manifest + service worker + registration | `bd5f90e` | public/sw.js, manifest.webmanifest, sw-register.ts, use-online-status.ts |
| 2 | IndexedDB stores + outbox | `7a8453c` | lib/offline/db.ts, outbox.ts, menu-cache.ts, types.ts; 6 unit tests |
| 3 | Sync engine — FIFO replay with dedupe | `ba2963b` | lib/offline/sync-engine.ts; 8 unit tests |
| 4 | Wire POS hooks offline-aware + status UI | `63a2733` | use-orders.ts, use-payments.ts, use-till.ts, offline-indicator.tsx, sync-status-badge.tsx, pos/layout.tsx |
| 5 | E2E scaffold — offline create → reconnect → exactly one order | `865f91d` | e2e/pos-offline.spec.ts; data-testid attrs on menu-grid, table-floor-view, payment-panel |

## Architecture

```
Browser                              IndexedDB
  │                                     │
  ├─ useCreateOrder (offline)           │
  │   └─ enqueue() ─────────────────────┤ outbox store
  │                                     │
  ├─ POS layout.tsx                     │
  │   ├─ registerSW() → public/sw.js    │
  │   └─ window.online → replay()       │
  │                                     │
  ├─ sync-engine.replay()               │
  │   ├─ peekPending() ─────────────────┤ FIFO by createdAt
  │   ├─ PosRepository.createOrder()    │
  │   │   └─ Idempotency-Key: clientOrderId (server dedupes)
  │   └─ markSynced() / markFailed()    │
  │                                     │
  └─ SyncStatusBadge                    │
      └─ onProgress() callback ─────────┘
```

## Idempotency Guarantee

Every `CREATE_ORDER` outbox op carries a stable `clientOrderId` (UUID v4 assigned at enqueue). The sync engine sends it as the `Idempotency-Key` HTTP header. The `orders.client_order_id UNIQUE` constraint means the server returns the existing order if replayed multiple times — never a duplicate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Unused `@ts-expect-error` directives in test files**
- **Found during:** Task 4 TypeScript check
- **Issue:** After adding `import "fake-indexeddb/auto"`, TypeScript accepted the `globalThis.indexedDB` assignment, making the `@ts-expect-error` directives stale errors
- **Fix:** Removed both `@ts-expect-error` comments in `outbox.test.ts` and `sync-engine.test.ts`
- **Commits:** included in `63a2733`

**2. [Rule 1 - Bug] `OfflineIndicator` violated `react-hooks/set-state-in-effect` lint rule**
- **Found during:** Task 4 lint check
- **Issue:** Initial implementation used `useOnlineStatus()` + `useEffect` calling `setState` directly in the effect body — blocked by ESLint `react-hooks/set-state-in-effect`
- **Fix:** Rewrote to subscribe directly to `window.addEventListener("online"/"offline")` inside the effect, calling `setState` only from event callbacks (compliant pattern per React docs)
- **Commits:** included in `63a2733`

**3. [Rule 2 - Missing Critical] `data-testid` attributes on interactive components**
- **Found during:** Task 5 E2E spec authoring
- **Issue:** Plan required specific selectors (`[data-testid="menu-grid"]`, `[data-testid="charge-button"]`, etc.) but none existed in the components
- **Fix:** Added testids to `menu-grid.tsx`, `table-floor-view.tsx`, `payment-panel.tsx`; also surfaced actual error message text in payment-panel (was hardcoded "Failed to close order…", now shows the OFFLINE_ERROR string)
- **Commits:** `865f91d`

## Verification

| Check | Result |
|-------|--------|
| `pnpm vitest run __tests__/offline/outbox.test.ts` | 6/6 passed |
| `pnpm vitest run __tests__/offline/sync-engine.test.ts` | 8/8 passed |
| `npx eslint lib/offline/ components/pos/offline-indicator.tsx components/pos/sync-status-badge.tsx` | 0 errors |
| `npx tsc --noEmit` (source files) | 0 errors (stale .next/dev/types auto-generated artifact — not a code issue) |

## Next Phase Readiness

- **07-04 (KDS):** Kitchen display is next; the `sendToKds` mutation could be made offline-bufferable using the same outbox pattern if needed.
- **07-03 E2E:** The Playwright spec is a scaffold; it requires a live backend + Playwright browser. CI runs it via `pnpm playwright test`.
