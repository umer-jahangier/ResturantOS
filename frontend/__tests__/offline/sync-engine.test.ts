/**
 * Unit tests for the sync engine.
 * - Mocks PosRepository (no real HTTP calls)
 * - Uses fake-indexeddb for the outbox
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "../../lib/offline/db";
import { enqueue, all, count } from "../../lib/offline/outbox";
import { replay } from "../../lib/offline/sync-engine";

// vi.hoisted ensures the mock variables are available before module resolution.
const { mockCreateOrder, mockAddItem } = vi.hoisted(() => ({
  mockCreateOrder: vi.fn(),
  mockAddItem: vi.fn(),
}));

vi.mock("../../lib/repositories/pos.repository", () => ({
  PosRepository: {
    createOrder: mockCreateOrder,
    addItem: mockAddItem,
  },
}));

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDb();
  mockCreateOrder.mockReset();
  mockAddItem.mockReset();
});

describe("replay — basic sync", () => {
  it("calls PosRepository.createOrder once with clientOrderId and marks op SYNCED", async () => {
    const clientOrderId = crypto.randomUUID();
    mockCreateOrder.mockResolvedValue({ id: "server-id", clientOrderId });

    await enqueue({ clientOrderId, type: "CREATE_ORDER", payload: { tableId: "t1" } });

    const result = await replay();

    expect(result).toEqual({ synced: 1, failed: 0 });
    expect(mockCreateOrder).toHaveBeenCalledOnce();
    expect(mockCreateOrder).toHaveBeenCalledWith(
      expect.objectContaining({ clientOrderId }),
    );

    // Outbox should be empty after sync.
    const remaining = await all();
    expect(remaining.length).toBe(0);
  });
});

describe("replay — duplicate / idempotency reconciliation", () => {
  it("treats a '200 existing order' response (no error) as success — no duplicate, op SYNCED", async () => {
    const clientOrderId = crypto.randomUUID();
    // Server returns an existing order with the same clientOrderId (idempotent replay).
    mockCreateOrder.mockResolvedValue({ id: "existing-server-id", clientOrderId });

    await enqueue({ clientOrderId, type: "CREATE_ORDER", payload: {} });
    await replay();
    // Trigger replay again — simulating a double-trigger on reconnect.
    const result = await replay();

    // Second replay finds the outbox empty (op was removed on first run).
    expect(result).toEqual({ synced: 0, failed: 0 });
    // createOrder was called exactly once across both replays.
    expect(mockCreateOrder).toHaveBeenCalledOnce();
  });
});

describe("replay — transient failure and retry", () => {
  it("marks op FAILED on network error, retries on next replay and succeeds", async () => {
    const clientOrderId = crypto.randomUUID();
    mockCreateOrder
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({ id: "server-id", clientOrderId });

    await enqueue({ clientOrderId, type: "CREATE_ORDER", payload: {} });

    // First replay — fails.
    const result1 = await replay();
    expect(result1).toEqual({ synced: 0, failed: 1 });
    expect(await count("FAILED")).toBe(1);

    // Second replay — replay() now auto-requeues FAILED ops (requeueRetriable) before
    // draining, so no manual reset is needed. This is the regression guard for the
    // "N queued — service unavailable" pill that never cleared because FAILED ops were
    // never picked up again.
    const result2 = await replay();
    expect(result2).toEqual({ synced: 1, failed: 0 });
    expect(mockCreateOrder).toHaveBeenCalledTimes(2);
    expect(await all()).toHaveLength(0);
  });
});

describe("replay — FIFO ordering", () => {
  it("processes ops in createdAt order (op1 before op2)", async () => {
    const calls: string[] = [];
    mockCreateOrder.mockImplementation(async (payload: { clientOrderId?: string }) => {
      calls.push(payload.clientOrderId ?? "");
      return { id: "s", clientOrderId: payload.clientOrderId };
    });

    const id1 = crypto.randomUUID();
    await enqueue({ clientOrderId: id1, type: "CREATE_ORDER", payload: {} });
    await new Promise((r) => setTimeout(r, 5));
    const id2 = crypto.randomUUID();
    await enqueue({ clientOrderId: id2, type: "CREATE_ORDER", payload: {} });

    await replay();

    expect(calls[0]).toBe(id1);
    expect(calls[1]).toBe(id2);
  });
});

describe("replay — single-flight guard", () => {
  it("concurrent replay() calls: second returns immediately with synced:0, failed:0", async () => {
    const clientOrderId = crypto.randomUUID();
    // Slow server response so the first replay is still in progress when the
    // second is triggered.
    mockCreateOrder.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ id: "s", clientOrderId }), 30),
        ),
    );
    await enqueue({ clientOrderId, type: "CREATE_ORDER", payload: {} });

    const [first, second] = await Promise.all([replay(), replay()]);

    // One of them did the work; the other returned immediately.
    const totalSynced = first.synced + second.synced;
    expect(totalSynced).toBe(1);
    expect(first.failed + second.failed).toBe(0);
  });
});
