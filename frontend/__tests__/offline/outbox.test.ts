/**
 * Unit tests for the outbox module (IndexedDB-backed).
 * Uses fake-indexeddb to provide an in-memory IDB implementation.
 *
 * fake-indexeddb/auto populates all global IDB constructors (IDBRequest, etc.)
 * once for the test file. A fresh IDBFactory replaces the global before each
 * test to ensure isolation.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../lib/offline/db";
import {
  all,
  count,
  dismissDead,
  enqueue,
  markFailed,
  markInFlight,
  markSynced,
  MAX_ATTEMPTS,
  peekPending,
  retryDead,
} from "../../lib/offline/outbox";

beforeEach(() => {
  // Fresh in-memory database for each test.
  globalThis.indexedDB = new IDBFactory();
  resetDb();
});

describe("enqueue", () => {
  it("assigns a uuid id and returns a PENDING op with attempts=0", async () => {
    const op = await enqueue({
      clientOrderId: crypto.randomUUID(),
      type: "CREATE_ORDER",
      payload: { tableId: "t1" },
    });

    expect(op.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(op.status).toBe("PENDING");
    expect(op.attempts).toBe(0);
    expect(op.createdAt).toBeGreaterThan(0);
  });

  it("stores the clientOrderId exactly as provided", async () => {
    const clientOrderId = crypto.randomUUID();
    const op = await enqueue({
      clientOrderId,
      type: "CREATE_ORDER",
      payload: {},
    });
    expect(op.clientOrderId).toBe(clientOrderId);
  });
});

describe("peekPending + FIFO ordering", () => {
  it("returns ops in createdAt order (earliest first)", async () => {
    const op1 = await enqueue({
      clientOrderId: crypto.randomUUID(),
      type: "CREATE_ORDER",
      payload: {},
    });
    await new Promise((r) => setTimeout(r, 5));
    const op2 = await enqueue({
      clientOrderId: crypto.randomUUID(),
      type: "APPEND_ITEMS",
      payload: {},
    });

    const pending = await peekPending();
    expect(pending.length).toBe(2);
    expect(pending[0]?.id).toBe(op1.id);
    expect(pending[1]?.id).toBe(op2.id);
  });

  it("only returns PENDING ops (excludes IN_FLIGHT / FAILED)", async () => {
    const opA = await enqueue({
      clientOrderId: crypto.randomUUID(),
      type: "CREATE_ORDER",
      payload: {},
    });
    await enqueue({
      clientOrderId: crypto.randomUUID(),
      type: "CREATE_ORDER",
      payload: {},
    });

    await markInFlight(opA.id);

    const pending = await peekPending();
    expect(pending.length).toBe(1);
    expect(pending.some((o) => o.id === opA.id)).toBe(false);
  });
});

describe("status lifecycle", () => {
  it("markInFlight → markFailed increments attempts", async () => {
    const op = await enqueue({
      clientOrderId: crypto.randomUUID(),
      type: "CREATE_ORDER",
      payload: {},
    });

    await markInFlight(op.id);
    await markFailed(op.id, "network error");

    const ops = await all();
    const failed = ops.find((o) => o.id === op.id);
    expect(failed?.status).toBe("FAILED");
    expect(failed?.attempts).toBe(1);
    expect(failed?.lastError).toBe("network error");
  });

  it("repeated markFailed accumulates attempts", async () => {
    const op = await enqueue({
      clientOrderId: crypto.randomUUID(),
      type: "CREATE_ORDER",
      payload: {},
    });
    await markInFlight(op.id);
    await markFailed(op.id, "err1");
    await markInFlight(op.id);
    await markFailed(op.id, "err2");

    const ops = await all();
    const failed = ops.find((o) => o.id === op.id);
    expect(failed?.attempts).toBe(2);
    expect(failed?.lastError).toBe("err2");
  });

  it("dead-letters an op after MAX_ATTEMPTS and excludes it from the queued count", async () => {
    const op = await enqueue({
      clientOrderId: crypto.randomUUID(),
      type: "CREATE_ORDER",
      payload: {},
    });
    // Fail up to (but not reaching) the cap → stays FAILED (still auto-retried).
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) await markFailed(op.id, `err${i}`);
    expect((await all()).find((o) => o.id === op.id)?.status).toBe("FAILED");

    // The failure that reaches the cap parks the op as DEAD.
    await markFailed(op.id, "final");
    const dead = (await all()).find((o) => o.id === op.id);
    expect(dead?.status).toBe("DEAD");
    expect(dead?.attempts).toBe(MAX_ATTEMPTS);
    // DEAD ops are not "queued" and not "pending" — they need explicit operator action.
    expect(await count("DEAD")).toBe(1);
    expect(await peekPending()).toHaveLength(0);
  });

  it("retryDead requeues dead ops to PENDING with reset attempts", async () => {
    const op = await enqueue({
      clientOrderId: crypto.randomUUID(),
      type: "CREATE_ORDER",
      payload: {},
    });
    for (let i = 0; i < MAX_ATTEMPTS; i++) await markFailed(op.id, "boom");
    expect(await count("DEAD")).toBe(1);

    await retryDead();
    const revived = (await all()).find((o) => o.id === op.id);
    expect(revived?.status).toBe("PENDING");
    expect(revived?.attempts).toBe(0);
  });

  it("dismissDead permanently removes dead ops", async () => {
    const op = await enqueue({
      clientOrderId: crypto.randomUUID(),
      type: "CREATE_ORDER",
      payload: {},
    });
    for (let i = 0; i < MAX_ATTEMPTS; i++) await markFailed(op.id, "boom");
    expect(await count("DEAD")).toBe(1);

    await dismissDead();
    expect(await count("DEAD")).toBe(0);
    expect(await all()).toHaveLength(0);
  });

  it("markSynced removes the op from the outbox", async () => {
    const op = await enqueue({
      clientOrderId: crypto.randomUUID(),
      type: "CREATE_ORDER",
      payload: {},
    });
    await markInFlight(op.id);
    await markSynced(op.id);

    const remaining = await all();
    expect(remaining.length).toBe(0);
    expect(await count("PENDING")).toBe(0);
  });

  it("clientOrderId is stable across markFailed → retry attempts", async () => {
    const clientOrderId = crypto.randomUUID();
    const op = await enqueue({ clientOrderId, type: "CREATE_ORDER", payload: {} });

    await markInFlight(op.id);
    await markFailed(op.id, "transient");
    await markInFlight(op.id);
    await markFailed(op.id, "transient again");

    const ops = await all();
    const failed = ops.find((o) => o.id === op.id);
    expect(failed?.clientOrderId).toBe(clientOrderId);
  });
});

describe("count", () => {
  it("returns correct counts by status", async () => {
    const op1 = await enqueue({
      clientOrderId: crypto.randomUUID(),
      type: "CREATE_ORDER",
      payload: {},
    });
    await enqueue({
      clientOrderId: crypto.randomUUID(),
      type: "CREATE_ORDER",
      payload: {},
    });
    await markInFlight(op1.id);

    expect(await count("PENDING")).toBe(1);
    expect(await count("IN_FLIGHT")).toBe(1);
    expect(await count("FAILED")).toBe(0);
    expect(await count("SYNCED")).toBe(0);
  });
});
