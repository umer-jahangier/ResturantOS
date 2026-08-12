/**
 * S0-07 regression, the two defects a cashier READS off the screen.
 *
 * (c) The connection badge said a green "Live" with the network down, because it was
 *     driven only by the branch order WebSocket — and a WebSocket is not torn down when
 *     the OS loses the line, so it kept claiming to be open.
 * (b) The order panel said "Subtotal Rs 0.00 / Total Rs 0.00" for a real Rs 499 order,
 *     because the offline add-item path returned a fresh zero-money stub and wrote it
 *     over the cache on every line.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resetDb } from "@/lib/offline/db";
import { all, enqueue } from "@/lib/offline/outbox";
import { replay, resetResolvedOrderIds } from "@/lib/offline/sync-engine";
import { queryKeys } from "@/lib/hooks/query-keys";
import { PosConnectionBadge } from "@/components/pos/pos-connection-badge";
import { useAddItem, useCreateOrder, useOrder } from "@/lib/hooks/pos/use-orders";
import { useFireToKitchen } from "@/lib/hooks/pos/use-fire-to-kitchen";
import type { MenuItem, Order } from "@/lib/models/pos.model";

const BRANCH_ID = "branch-f7";

vi.mock("@/lib/hooks/auth/use-current-user", () => ({
  useCurrentUser: () => ({ branchId: BRANCH_ID, isAuthenticated: true }),
}));

const { mockCreateOrder, mockAddItem, mockSendToKds, mockGetOrder } = vi.hoisted(() => ({
  mockCreateOrder: vi.fn(),
  mockAddItem: vi.fn(),
  mockSendToKds: vi.fn(),
  mockGetOrder: vi.fn(),
}));

vi.mock("@/lib/repositories/pos.repository", () => ({
  PosRepository: {
    createOrder: mockCreateOrder,
    addItem: mockAddItem,
    sendToKds: mockSendToKds,
    getOrder: mockGetOrder,
  },
}));

/** The Rs 499.00 tile, priced exactly as the menu grid holds it. */
const AUDIT_ITEM_499: MenuItem = {
  id: "menu-499",
  categoryId: null,
  categoryName: null,
  name: "Audit Item 52235",
  description: null,
  basePricePaisa: 49_900,
  taxRatePct: 0,
  taxRateCode: null,
  kdsStation: null,
  imageFileId: null,
} as MenuItem;

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value: online, configurable: true });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDb();
  resetResolvedOrderIds();
  mockCreateOrder.mockReset();
  mockAddItem.mockReset();
  mockSendToKds.mockReset();
  mockGetOrder.mockReset();
  setOnline(true);
});

afterEach(() => {
  setOnline(true);
});

describe("PosConnectionBadge — it must not claim Live with the line down", () => {
  it("says Live when the browser is online and the socket is up", () => {
    render(<PosConnectionBadge isConnected />);
    expect(screen.getByTestId("pos-live-indicator")).toHaveTextContent("Live");
  });

  it("says Offline the moment the browser goes offline — even while the socket still claims to be connected", async () => {
    render(<PosConnectionBadge isConnected />);
    expect(screen.getByTestId("pos-live-indicator")).toHaveTextContent("Live");

    act(() => setOnline(false));

    await waitFor(() => {
      const badge = screen.getByTestId("pos-live-indicator");
      expect(badge).toHaveTextContent(/Offline/);
      expect(badge).not.toHaveTextContent("Live");
      expect(badge.getAttribute("data-connection-state")).toBe("offline");
    });
  });

  it("says Polling — not Offline — when the browser is online but the socket dropped", () => {
    render(<PosConnectionBadge isConnected={false} />);
    expect(screen.getByTestId("pos-live-indicator")).toHaveTextContent("Polling");
  });
});

describe("the offline order carries its real money (S0-07)", () => {
  function wrapper(queryClient: QueryClient) {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
  }

  it("an offline Send to Kitchen leaves the panel showing Rs 499.00, not Rs 0.00", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    // The menu the cashier is looking at — the same cache the grid renders from.
    queryClient.setQueryData(queryKeys.pos.menuItems(BRANCH_ID), [AUDIT_ITEM_499]);

    const create = renderHook(() => useCreateOrder(), { wrapper: wrapper(queryClient) });
    const add = renderHook(() => useAddItem(), { wrapper: wrapper(queryClient) });
    const fire = renderHook(() => useFireToKitchen(), { wrapper: wrapper(queryClient) });

    act(() => setOnline(false));
    await waitFor(() => expect(create.result.current.isPending).toBe(false));

    const clientOrderId = crypto.randomUUID();
    let order!: Order;
    await act(async () => {
      order = await create.result.current.mutateAsync({ branchId: BRANCH_ID, clientOrderId });
    });
    await act(async () => {
      await add.result.current.mutateAsync({
        orderId: order.id,
        payload: { menuItemId: AUDIT_ITEM_499.id, branchId: BRANCH_ID, quantity: 1 },
      });
    });
    await act(async () => {
      await fire.result.current.mutateAsync({ orderId: order.id });
    });

    // What the OrderPanel renders comes from this cache entry.
    const cached = queryClient.getQueryData<Order>(queryKeys.pos.order(BRANCH_ID, order.id));
    expect(cached?.subtotalPaisa).toBe(49_900);
    expect(cached?.totalPaisa).toBe(49_900);
    expect(cached?.items).toHaveLength(1);
    expect(cached?.items[0]?.itemNameSnapshot).toBe("Audit Item 52235");
    expect(cached?.items[0]?.lineTotalPaisa).toBe(49_900);

    // Nothing touched the network, and the fire is queued rather than lost.
    expect(mockCreateOrder).not.toHaveBeenCalled();
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockSendToKds).not.toHaveBeenCalled();
    const ops = await all();
    expect(ops.map((o) => o.type)).toEqual(["CREATE_ORDER", "APPEND_ITEMS", "SEND_TO_KDS"]);
  });

  it("follows the order to the server's id once the outbox replays — no ghost order", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const stubId = crypto.randomUUID();
    mockGetOrder.mockResolvedValue({ id: "real-order-9", orderNo: "ORD-1" } as unknown as Order);

    const view = renderHook(() => useOrder(stubId), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(mockGetOrder).toHaveBeenCalledWith(stubId, BRANCH_ID));

    // The create replays and the server issues its own id.
    mockCreateOrder.mockResolvedValue({ id: "real-order-9", clientOrderId: stubId });
    await enqueue({ clientOrderId: stubId, type: "CREATE_ORDER", payload: { branchId: BRANCH_ID } });
    await act(async () => {
      await replay();
    });

    // The same hook, still holding the stub id, must now be reading the REAL order.
    await waitFor(() => expect(mockGetOrder).toHaveBeenCalledWith("real-order-9", BRANCH_ID));
    view.unmount();
  });

  it("resolves the fire to null when queued, so no caller can announce 'Sent to kitchen'", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const fire = renderHook(() => useFireToKitchen(), { wrapper: wrapper(queryClient) });

    act(() => setOnline(false));

    let result: Order | null = {} as Order;
    await act(async () => {
      result = await fire.result.current.mutateAsync({ orderId: "order-1" });
    });
    expect(result).toBeNull();

    // …and it is a genuine Order once the line is back.
    act(() => setOnline(true));
    mockSendToKds.mockResolvedValue({ id: "order-1", status: "SENT_TO_KDS" } as unknown as Order);
    await act(async () => {
      result = await fire.result.current.mutateAsync({ orderId: "order-1" });
    });
    expect(result).not.toBeNull();
    expect(mockSendToKds).toHaveBeenCalledOnce();
  });
});
