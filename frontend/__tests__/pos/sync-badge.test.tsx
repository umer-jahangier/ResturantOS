/**
 * Verifies the two carried-over Phase-7 UAT gaps closed by this plan:
 *  - the sync badge shows "{n} queued" the instant an offline mutation is enqueued
 *    (not only after reconnect/replay()) — POS-14/POS-07.
 *  - it drains to "All synced" once the outbox empties.
 *
 * Uses fake-indexeddb for the outbox (mirrors __tests__/offline/outbox.test.ts).
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { resetDb } from "@/lib/offline/db";
import { enqueue, all, markSynced } from "@/lib/offline/outbox";
import { emitProgress } from "@/lib/offline/sync-engine";
import { SyncStatusBadge } from "@/components/pos/sync-status-badge";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDb();
});

describe("SyncStatusBadge", () => {
  it("renders nothing before anything is queued", () => {
    render(<SyncStatusBadge />);
    expect(screen.queryByTestId("sync-badge")).not.toBeInTheDocument();
  });

  it("shows '{n} queued' immediately after enqueue(), without any replay() call", async () => {
    render(<SyncStatusBadge />);

    await enqueue({
      clientOrderId: crypto.randomUUID(),
      type: "CREATE_ORDER",
      payload: {},
    });

    await waitFor(() => {
      expect(screen.getByTestId("sync-badge")).toHaveTextContent("1 queued");
    });
  });

  it("increments the queued count as more ops are enqueued", async () => {
    render(<SyncStatusBadge />);

    await enqueue({ clientOrderId: crypto.randomUUID(), type: "CREATE_ORDER", payload: {} });
    await waitFor(() => {
      expect(screen.getByTestId("sync-badge")).toHaveTextContent("1 queued");
    });

    await enqueue({ clientOrderId: crypto.randomUUID(), type: "APPEND_ITEMS", payload: {} });
    await waitFor(() => {
      expect(screen.getByTestId("sync-badge")).toHaveTextContent("2 queued");
    });
  });

  it("drains to 'All synced' after the outbox empties", async () => {
    render(<SyncStatusBadge />);

    await enqueue({ clientOrderId: crypto.randomUUID(), type: "CREATE_ORDER", payload: {} });
    await waitFor(() => {
      expect(screen.getByTestId("sync-badge")).toHaveTextContent("1 queued");
    });

    // Drain the outbox directly (mirrors what a successful replay() does) and emit
    // progress — asserting the badge's own reaction, independent of PosRepository/HTTP.
    const ops = await all();
    await markSynced(ops[0]!.id);
    await emitProgress();

    await waitFor(() => {
      expect(screen.getByTestId("sync-badge")).toHaveTextContent("All synced");
    });
  });
});
