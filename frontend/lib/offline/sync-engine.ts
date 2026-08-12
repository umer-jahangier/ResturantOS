/**
 * Sync engine: drains the outbox FIFO when the client is online.
 *
 * Idempotency guarantee: ops carry a clientOrderId that is sent as the
 * Idempotency-Key header. The server dedupes by this field, so a replay that
 * already succeeded server-side returns the existing order (200/201 both =
 * success) — never creates a duplicate.
 *
 * Error handling:
 *  - Transient / network / 5xx errors → markFailed, retry on next trigger.
 *  - Terminal 4xx validation errors → markFailed with the error; the op stays
 *    in the outbox for operator review (no infinite loop).
 */

import { PosRepository } from "@/lib/repositories/pos.repository";
import type {
  CreateOrderPayload,
  AddItemPayload,
  UpdateInstructionsPayload,
} from "@/lib/models/pos.model";
import type { SendToKdsOpPayload } from "./types";
import {
  count,
  markFailed,
  markInFlight,
  markSynced,
  peekPending,
  repointQueuedOps,
  requeueRetriable,
} from "./outbox";

let isReplaying = false;

export interface ReplayResult {
  synced: number;
  failed: number;
}

// ── Stub id → server id, for the surfaces still holding the stub ──────────────

/**
 * Local stub order id → the id the server actually assigned, for every order this tab
 * created while offline.
 *
 * `repointQueuedOps` already fixes up the OUTBOX, but the terminal that rang the order is
 * still holding the stub id in React state and asking `useOrder` for it. Once the create
 * replays, that id resolves to nothing: the panel kept rendering a "New Order / Draft"
 * ghost with no order number and a live Send to Kitchen button, while the real
 * ORD-…-0053 sat in Order Management (measured 2026-08-12, S0-07 reconnect probe). This
 * map is how `useOrder` follows the order to its real id.
 *
 * In-memory on purpose: a stub id only exists inside the session that minted it, and a
 * reload drops the component state holding it too.
 */
const resolvedOrderIds = new Map<string, string>();
const resolvedListeners = new Set<() => void>();

/** The server id for a local stub id, or the id itself when it is already the real one. */
export function resolveSyncedOrderId(orderId: string): string {
  return resolvedOrderIds.get(orderId) ?? orderId;
}

/** Subscribe to remaps (useSyncExternalStore-shaped). Returns an unsubscribe fn. */
export function subscribeResolvedOrderIds(cb: () => void): () => void {
  resolvedListeners.add(cb);
  return () => {
    resolvedListeners.delete(cb);
  };
}

/** Test seam: forget every remap (a fresh session has none). */
export function resetResolvedOrderIds(): void {
  resolvedOrderIds.clear();
}

/**
 * Drain all PENDING outbox ops in FIFO order against the real API.
 * Single-flight: concurrent calls return {synced:0, failed:0} immediately.
 *
 * Returns aggregate counts for the UI badge.
 */
export async function replay(): Promise<ReplayResult> {
  if (isReplaying) return { synced: 0, failed: 0 };
  isReplaying = true;

  try {
    // Revive ops a previous pass left behind before draining: FAILED (transient/5xx
    // failures not yet at MAX_ATTEMPTS) and IN_FLIGHT stranded by an interrupted replay.
    // peekPending() reads PENDING only, so without this they would never be retried and
    // would sit in the "N queued" badge forever. attempts is preserved, so a persistently
    // failing op still climbs to MAX_ATTEMPTS and dead-letters to DEAD.
    await requeueRetriable();
    const ops = await peekPending();
    let synced = 0;
    let failed = 0;

    // clientOrderId (offline stub id) -> real server-assigned order id, populated as
    // CREATE_ORDER ops sync within THIS pass so a sibling APPEND_ITEMS/
    // UPDATE_INSTRUCTIONS op queued against the same brand-new order (still holding
    // the old local id in its own in-memory `op` from the `ops` snapshot above)
    // targets the right resource even before its IndexedDB record catches up via
    // repointQueuedOps (which covers ops NOT reached in this same pass).
    const idRemap = new Map<string, string>();

    for (const op of ops) {
      const targetOrderId = idRemap.get(op.clientOrderId) ?? op.clientOrderId;
      await markInFlight(op.id);
      try {
        if (op.type === "CREATE_ORDER") {
          // clientOrderId is the idempotency key — server dedupes by this field, but
          // always assigns its OWN, different `id` (never equal to the client UUID).
          const created = await PosRepository.createOrder({
            ...(op.payload as CreateOrderPayload),
            clientOrderId: op.clientOrderId,
          });
          if (created.id !== op.clientOrderId) {
            idRemap.set(op.clientOrderId, created.id);
            // Tell the UI too, not just the outbox — see resolvedOrderIds above.
            resolvedOrderIds.set(op.clientOrderId, created.id);
            resolvedListeners.forEach((cb) => cb());
            await repointQueuedOps(op.clientOrderId, created.id);
          }
        } else if (op.type === "APPEND_ITEMS") {
          // clientOrderId normally holds the target order's server UUID directly
          // (item added to an already-synced order) — targetOrderId only differs when
          // this op was queued against an order that was ALSO created offline in the
          // same session (see idRemap/repointQueuedOps above).
          await PosRepository.addItem(targetOrderId, op.payload as AddItemPayload);
        } else if (op.type === "UPDATE_INSTRUCTIONS") {
          // Same targetOrderId reasoning as APPEND_ITEMS above (POS-13 is
          // offline-safe per this plan's must_haves).
          await PosRepository.updateInstructions(
            targetOrderId,
            op.payload as UpdateInstructionsPayload,
          );
        } else if (op.type === "SEND_TO_KDS") {
          // The fire the cashier actually pressed while the line was down (S0-07).
          // Ordering is guaranteed by the FIFO drain plus outbox.enqueue's monotonic
          // createdAt: the CREATE_ORDER and every APPEND_ITEMS for this order were
          // enqueued first, so by the time this op replays the order exists and its
          // lines are on it — which is what makes the revision non-empty.
          //
          // clientFireId travels IN THE PAYLOAD, minted at enqueue time, so a retry of
          // a fire whose response was lost is deduped server-side instead of firing a
          // second revision.
          const { clientFireId } = op.payload as SendToKdsOpPayload;
          await PosRepository.sendToKds(targetOrderId, clientFireId);
        }

        await markSynced(op.id);
        synced++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await markFailed(op.id, errMsg);
        failed++;
      }

      void emitProgress();
    }

    return { synced, failed };
  } finally {
    isReplaying = false;
    void emitProgress();
  }
}

// ── Progress callbacks ────────────────────────────────────────────────────────

/**
 * @param pending  Ops still in the auto-retry pipeline (PENDING + IN_FLIGHT + FAILED).
 *                 Excludes DEAD so a permanently-failing op can't inflate the pill forever.
 * @param lastError Most recent error message (DEAD preferred, else FAILED).
 * @param dead     Count of dead-lettered ops needing explicit Retry/Dismiss.
 */
type ProgressCallback = (pending: number, lastError?: string, dead?: number) => void;
const progressCallbacks: ProgressCallback[] = [];

/** Subscribe to outbox progress updates (UI badge). Returns an unsubscribe fn. */
export function onProgress(cb: ProgressCallback): () => void {
  progressCallbacks.push(cb);
  return () => {
    const idx = progressCallbacks.indexOf(cb);
    if (idx !== -1) progressCallbacks.splice(idx, 1);
  };
}

/** Recompute pending count and notify all progress subscribers. */
export async function emitProgress(): Promise<void> {
  const pending = (await count("PENDING")) + (await count("IN_FLIGHT")) + (await count("FAILED"));
  const dead = await count("DEAD");

  const lastError = await getLastError();
  progressCallbacks.forEach((cb) => cb(pending, lastError, dead));
}

async function getLastError(): Promise<string | undefined> {
  const { all } = await import("./outbox");
  const ops = await all();
  // Prefer a DEAD op's error (terminal, needs attention) over a still-retrying FAILED one.
  const dead = ops.filter((o) => o.status === "DEAD" && o.lastError).at(-1);
  if (dead) return dead.lastError;
  const failedOp = ops.filter((o) => o.status === "FAILED" && o.lastError).at(-1);
  return failedOp?.lastError;
}
