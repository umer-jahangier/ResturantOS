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
import type { CreateOrderPayload, AddItemPayload } from "@/lib/models/pos.model";
import {
  count,
  markFailed,
  markInFlight,
  markSynced,
  peekPending,
} from "./outbox";

let isReplaying = false;

export interface ReplayResult {
  synced: number;
  failed: number;
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
    const ops = await peekPending();
    let synced = 0;
    let failed = 0;

    for (const op of ops) {
      await markInFlight(op.id);
      try {
        if (op.type === "CREATE_ORDER") {
          // clientOrderId is the idempotency key — server dedupes by this field.
          await PosRepository.createOrder({
            ...(op.payload as CreateOrderPayload),
            clientOrderId: op.clientOrderId,
          });
        } else if (op.type === "APPEND_ITEMS") {
          // For APPEND_ITEMS, clientOrderId holds the target order's server UUID.
          await PosRepository.addItem(
            op.clientOrderId,
            op.payload as AddItemPayload,
          );
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

type ProgressCallback = (pending: number, lastError?: string) => void;
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
  const pending =
    (await count("PENDING")) +
    (await count("IN_FLIGHT")) +
    (await count("FAILED"));

  const lastFailed = await getLastError();
  progressCallbacks.forEach((cb) => cb(pending, lastFailed));
}

async function getLastError(): Promise<string | undefined> {
  const { all } = await import("./outbox");
  const ops = await all();
  const failedOp = ops
    .filter((o) => o.status === "FAILED" && o.lastError)
    .at(-1);
  return failedOp?.lastError;
}
