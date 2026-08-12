/**
 * S0-07 regression: the fire the cashier pressed while offline must survive the outbox.
 *
 * Before the fix the outbox contract had exactly three op types — CREATE_ORDER,
 * APPEND_ITEMS, UPDATE_INSTRUCTIONS — so `handleSendToKitchen`'s fire had no wire
 * representation at all. Offline it was simply dropped: the order replayed on reconnect
 * as a DRAFT the kitchen never saw, while the till had said "Sent to kitchen".
 *
 * These tests pin the three properties that make the queued fire trustworthy:
 *   1. it is replayed at all,
 *   2. it is replayed AFTER the create and the lines, against the SERVER's order id,
 *   3. its Idempotency-Key was minted at enqueue time, so a retry never fires twice.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "../../lib/offline/db";
import { all, enqueue } from "../../lib/offline/outbox";
import { replay, resolveSyncedOrderId, resetResolvedOrderIds } from "../../lib/offline/sync-engine";
import type { SendToKdsOpPayload } from "../../lib/offline/types";

const { mockCreateOrder, mockAddItem, mockSendToKds } = vi.hoisted(() => ({
  mockCreateOrder: vi.fn(),
  mockAddItem: vi.fn(),
  mockSendToKds: vi.fn(),
}));

vi.mock("../../lib/repositories/pos.repository", () => ({
  PosRepository: {
    createOrder: mockCreateOrder,
    addItem: mockAddItem,
    sendToKds: mockSendToKds,
    updateInstructions: vi.fn(),
  },
}));

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDb();
  resetResolvedOrderIds();
  mockCreateOrder.mockReset();
  mockAddItem.mockReset();
  mockSendToKds.mockReset();
});

/** The exact op sequence pos-terminal enqueues for one offline "Send to Kitchen". */
async function enqueueOfflineSendToKitchen(clientOrderId: string, clientFireId: string) {
  await enqueue({
    clientOrderId,
    type: "CREATE_ORDER",
    payload: { branchId: "b1", clientOrderId, type: "DINE_IN" },
  });
  await enqueue({
    clientOrderId,
    type: "APPEND_ITEMS",
    payload: { menuItemId: "m1", branchId: "b1", quantity: 1 },
  });
  await enqueue({
    clientOrderId,
    type: "SEND_TO_KDS",
    payload: { clientFireId } satisfies SendToKdsOpPayload,
  });
}

describe("replay — the queued fire (S0-07)", () => {
  it("fires the order on reconnect instead of leaving it a DRAFT", async () => {
    const clientOrderId = crypto.randomUUID();
    const clientFireId = crypto.randomUUID();
    mockCreateOrder.mockResolvedValue({ id: "server-order-1", clientOrderId });
    mockAddItem.mockResolvedValue({ id: "server-order-1" });
    mockSendToKds.mockResolvedValue({ id: "server-order-1", status: "SENT_TO_KDS" });

    await enqueueOfflineSendToKitchen(clientOrderId, clientFireId);
    const result = await replay();

    // THE assertion this whole item exists for.
    expect(mockSendToKds).toHaveBeenCalledOnce();
    expect(result).toEqual({ synced: 3, failed: 0 });
    expect(await all()).toHaveLength(0);
  });

  it("fires against the SERVER's order id, never the local stub id", async () => {
    const clientOrderId = crypto.randomUUID();
    const clientFireId = crypto.randomUUID();
    mockCreateOrder.mockResolvedValue({ id: "server-order-2", clientOrderId });
    mockAddItem.mockResolvedValue({ id: "server-order-2" });
    mockSendToKds.mockResolvedValue({ id: "server-order-2" });

    await enqueueOfflineSendToKitchen(clientOrderId, clientFireId);
    await replay();

    expect(mockSendToKds).toHaveBeenCalledWith("server-order-2", clientFireId);
  });

  it("replays create → items → fire in that order, so the revision is never empty", async () => {
    const clientOrderId = crypto.randomUUID();
    const calls: string[] = [];
    mockCreateOrder.mockImplementation(async () => {
      calls.push("create");
      return { id: "server-order-3", clientOrderId };
    });
    mockAddItem.mockImplementation(async () => {
      calls.push("addItem");
      return { id: "server-order-3" };
    });
    mockSendToKds.mockImplementation(async () => {
      calls.push("sendToKds");
      return { id: "server-order-3" };
    });

    await enqueueOfflineSendToKitchen(clientOrderId, crypto.randomUUID());
    await replay();

    expect(calls).toEqual(["create", "addItem", "sendToKds"]);
  });

  it("publishes the stub→server id remap so the till can follow its own order", async () => {
    const clientOrderId = crypto.randomUUID();
    mockCreateOrder.mockResolvedValue({ id: "server-order-5", clientOrderId });
    mockAddItem.mockResolvedValue({ id: "server-order-5" });
    mockSendToKds.mockResolvedValue({ id: "server-order-5" });

    // Before the create replays the stub id is all anyone has.
    expect(resolveSyncedOrderId(clientOrderId)).toBe(clientOrderId);

    await enqueueOfflineSendToKitchen(clientOrderId, crypto.randomUUID());
    await replay();

    // After it, the terminal still holding the stub id resolves to the real order —
    // without this the panel renders a "New Order / Draft / Rs 0.00" ghost forever.
    expect(resolveSyncedOrderId(clientOrderId)).toBe("server-order-5");
    // An id that was always real is returned untouched.
    expect(resolveSyncedOrderId("server-order-5")).toBe("server-order-5");
  });

  it("reuses the enqueue-time clientFireId across a retry — never a second revision", async () => {
    const clientOrderId = crypto.randomUUID();
    const clientFireId = crypto.randomUUID();
    mockCreateOrder.mockResolvedValue({ id: "server-order-4", clientOrderId });
    mockAddItem.mockResolvedValue({ id: "server-order-4" });
    // First attempt at the fire dies (the reconnect was flaky); second succeeds.
    mockSendToKds
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ id: "server-order-4" });

    await enqueueOfflineSendToKitchen(clientOrderId, clientFireId);
    await replay();
    await replay();

    expect(mockSendToKds).toHaveBeenCalledTimes(2);
    // Same Idempotency-Key both times — the server dedupes, so the kitchen sees ONE
    // revision. A fire id minted at replay time would have produced two.
    expect(mockSendToKds.mock.calls.map((c) => c[1])).toEqual([clientFireId, clientFireId]);
    expect(await all()).toHaveLength(0);
  });
});
