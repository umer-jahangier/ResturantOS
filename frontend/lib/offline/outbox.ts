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

/** Increment attempts, record last error, revert to FAILED status for retry. */
export async function markFailed(id: string, error: string): Promise<void> {
  const db = await getDb();
  const op = await db.get("outbox", id);
  if (!op) return;
  await db.put("outbox", {
    ...op,
    status: "FAILED",
    attempts: op.attempts + 1,
    lastError: error,
  });
}

// ── Counts ────────────────────────────────────────────────────────────────────

export async function count(status: OutboxStatus): Promise<number> {
  const db = await getDb();
  return db.countFromIndex("outbox", "by-status", status);
}

// ── Internal helpers (exported for sync-engine) ───────────────────────────────

/** Reset FAILED ops back to PENDING so the next replay picks them up. */
export async function requeueFailed(): Promise<void> {
  const db = await getDb();
  const failed = await db.getAllFromIndex("outbox", "by-status", "FAILED");
  const tx = db.transaction("outbox", "readwrite");
  await Promise.all(
    failed.map((op) => tx.store.put({ ...op, status: "PENDING" })),
  );
  await tx.done;
}

// Re-export OutboxOpType for consumers that only need the op interface.
export type { OutboxOp, OutboxOpType, OutboxStatus };
