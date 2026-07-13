import { getDb } from "./db";
import type { OutboxOp, OutboxOpType, OutboxStatus } from "./types";

// ── Enqueue ───────────────────────────────────────────────────────────────────

/** Write a new PENDING operation to the outbox. */
export async function enqueue(
  op: Omit<OutboxOp, "id" | "status" | "attempts" | "createdAt">,
): Promise<OutboxOp> {
  const db = await getDb();
  const record: OutboxOp = {
    ...op,
    id: crypto.randomUUID(),
    status: "PENDING",
    attempts: 0,
    createdAt: Date.now(),
  };
  await db.add("outbox", record);

  // Notify sync-badge subscribers immediately (POS-14/POS-07 UAT gap: previously the
  // badge only updated on mount/reconnect/replay(), never on enqueue itself). Dynamic
  // import avoids a static circular dependency — sync-engine.ts already imports several
  // named exports from this module at its top level, mirroring the same
  // dynamic-import-to-break-the-cycle pattern sync-engine.ts's own getLastError() uses.
  const { emitProgress } = await import("./sync-engine");
  await emitProgress();

  return record;
}

// ── Peek ──────────────────────────────────────────────────────────────────────

/** Return all PENDING operations sorted by createdAt ascending (FIFO). */
export async function peekPending(): Promise<OutboxOp[]> {
  const db = await getDb();
  const ops = await db.getAllFromIndex("outbox", "by-status", "PENDING");
  return ops.sort((a, b) => a.createdAt - b.createdAt);
}

/** Return ALL operations (any status), sorted by createdAt ascending. */
export async function all(): Promise<OutboxOp[]> {
  const db = await getDb();
  const ops = await db.getAll("outbox");
  return ops.sort((a, b) => a.createdAt - b.createdAt);
}

// ── Status transitions ────────────────────────────────────────────────────────

export async function markInFlight(id: string): Promise<void> {
  const db = await getDb();
  const op = await db.get("outbox", id);
  if (!op) return;
  await db.put("outbox", { ...op, status: "IN_FLIGHT" });
}

/** Remove the operation from the outbox (replay succeeded). */
export async function markSynced(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("outbox", id);
}

/**
 * Max auto-retry attempts before an op is dead-lettered. Once attempts reach this,
 * markFailed parks the op as DEAD so it stops counting toward the "queued" badge and
 * stops being auto-retried on every reconnect — preventing the "16 queued — service
 * unavailable" pill from growing without bound against a persistently-failing backend.
 */
export const MAX_ATTEMPTS = 5;

/**
 * Increment attempts and record the last error. Reverts to FAILED (auto-retried on the
 * next replay) until attempts reach {@link MAX_ATTEMPTS}, after which the op is parked as
 * DEAD (terminal — needs explicit operator Retry/Dismiss).
 */
export async function markFailed(id: string, error: string): Promise<void> {
  const db = await getDb();
  const op = await db.get("outbox", id);
  if (!op) return;
  const attempts = op.attempts + 1;
  await db.put("outbox", {
    ...op,
    status: attempts >= MAX_ATTEMPTS ? "DEAD" : "FAILED",
    attempts,
    lastError: error,
  });
}

/** Requeue dead-lettered ops (reset attempts) so an explicit Retry drains them again. */
export async function retryDead(): Promise<void> {
  const db = await getDb();
  const dead = await db.getAllFromIndex("outbox", "by-status", "DEAD");
  const tx = db.transaction("outbox", "readwrite");
  await Promise.all(
    dead.map((op) => tx.store.put({ ...op, status: "PENDING", attempts: 0 })),
  );
  await tx.done;
}

/** Permanently drop dead-lettered ops (operator dismissed them). */
export async function dismissDead(): Promise<void> {
  const db = await getDb();
  const dead = await db.getAllFromIndex("outbox", "by-status", "DEAD");
  const tx = db.transaction("outbox", "readwrite");
  await Promise.all(dead.map((op) => tx.store.delete(op.id)));
  await tx.done;
}

// ── Counts ────────────────────────────────────────────────────────────────────

export async function count(status: OutboxStatus): Promise<number> {
  const db = await getDb();
  return db.countFromIndex("outbox", "by-status", status);
}

// ── Internal helpers (exported for sync-engine) ───────────────────────────────

/**
 * Move retriable ops back to PENDING so the next replay() actually picks them up.
 * replay() drains only PENDING, so without this call FAILED/stranded-IN_FLIGHT ops are
 * invisible to it forever — the root cause of the "N queued — service unavailable" pill
 * that never clears and a "Retry now" button that does nothing.
 *
 *  - FAILED    → a transient / 5xx failure that has NOT yet exhausted MAX_ATTEMPTS.
 *  - IN_FLIGHT → an op stranded by a replay that was interrupted mid-request (tab closed
 *                / crash). Safe to reset because replay() is single-flight and only it
 *                sets IN_FLIGHT, so any IN_FLIGHT seen at the START of a fresh replay is
 *                necessarily orphaned from a dead session.
 *
 * `attempts` is deliberately PRESERVED (unlike retryDead, which resets it): a genuinely
 * permanent failure keeps climbing toward MAX_ATTEMPTS across replays and eventually
 * dead-letters to DEAD instead of retrying forever. DEAD is left untouched here — it is
 * terminal and needs an explicit operator Retry (retryDead) or Dismiss (dismissDead).
 */
export async function requeueRetriable(): Promise<void> {
  const db = await getDb();
  const failed = await db.getAllFromIndex("outbox", "by-status", "FAILED");
  const inflight = await db.getAllFromIndex("outbox", "by-status", "IN_FLIGHT");
  const tx = db.transaction("outbox", "readwrite");
  await Promise.all(
    [...failed, ...inflight].map((op) => tx.store.put({ ...op, status: "PENDING" })),
  );
  await tx.done;
}

/**
 * Repoint every OTHER queued op that targeted a brand-new order's LOCAL stub id at
 * the REAL server-assigned id, once that order's own CREATE_ORDER op has synced.
 *
 * An order created while offline gets `id = clientOrderId` (the client-generated
 * UUID — see buildOfflineOrderStub in use-orders.ts) so the UI can render it
 * immediately; a same-session "add first item" enqueues its APPEND_ITEMS op against
 * that SAME local id (pos-terminal.tsx's handleItemSelect). The server always
 * assigns its OWN, different `id` on creation (the client UUID only travels as the
 * Idempotency-Key), so without this repoint, the queued APPEND_ITEMS/
 * UPDATE_INSTRUCTIONS op would replay against an order id the server never issued —
 * silently losing the item (confirmed via 07.1-06 E2E: outbox drained to a
 * permanently-FAILED op, order stayed at Rs 0.00 after reconnect).
 */
export async function repointQueuedOps(oldClientOrderId: string, realOrderId: string): Promise<void> {
  if (oldClientOrderId === realOrderId) return;
  const db = await getDb();
  const all = await db.getAll("outbox");
  const toRepoint = all.filter(
    (op) => op.type !== "CREATE_ORDER" && op.clientOrderId === oldClientOrderId,
  );
  if (toRepoint.length === 0) return;
  const tx = db.transaction("outbox", "readwrite");
  await Promise.all(
    toRepoint.map((op) => tx.store.put({ ...op, clientOrderId: realOrderId })),
  );
  await tx.done;
}

// Re-export OutboxOpType for consumers that only need the op interface.
export type { OutboxOp, OutboxOpType, OutboxStatus };
