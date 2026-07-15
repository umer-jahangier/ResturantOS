/**
 * usePosOrdersSocket — the POS-side live order WebSocket. Proves the two behaviors the
 * live-push feature depends on, with a fake WebSocket (mirrors use-kds-socket's design so it
 * is testable via closure-local socket state): on a pushed OrderDto frame it (1) seeds the
 * `useOrder` detail cache with the adapted order and (2) invalidates the order-summaries list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import { usePosOrdersSocket } from "@/lib/hooks/pos/use-pos-orders-socket";
import { useSessionStore } from "@/lib/auth/session";
import { queryKeys } from "@/lib/hooks/query-keys";
import type { Order } from "@/lib/models/pos.model";

const BRANCH_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";

// Minimal fake WebSocket capturing handlers so the test can drive open/message frames.
class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.last = this;
  }
  close() {
    this.closed = true;
  }
}

const wirePayload = {
  id: ORDER_ID,
  branchId: BRANCH_ID,
  orderNo: "A-100",
  type: "DINE_IN",
  status: "SENT_TO_KDS",
  derivedStatus: "IN_PROGRESS",
  tableId: null,
  coverCount: 2,
  cashierId: null,
  customerId: null,
  subtotalPaisa: 1000,
  taxPaisa: 0,
  discountPaisa: 0,
  serviceChargePaisa: 0,
  totalPaisa: 1000,
  notes: null,
  openedAt: null,
  sentToKdsAt: null,
  clientOrderId: "33333333-3333-4333-8333-333333333333",
  version: 1,
  items: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      menuItemId: "55555555-5555-4555-8555-555555555555",
      itemNameSnapshot: "Burger",
      unitPriceSnapshot: 1000,
      quantity: 1,
      kdsStation: "GRILL",
      kdsStatus: "PREPARING",
      revisionNo: 1,
      firedAt: null,
      discountPaisa: 0,
      taxPaisa: 0,
      lineTotalPaisa: 1000,
      notes: null,
      modifiers: [],
    },
  ],
};

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("usePosOrdersSocket", () => {
  beforeEach(() => {
    FakeWebSocket.last = null;
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
    useSessionStore.setState({
      session: {
        accessToken: "test-token",
        expiresAt: new Date(Date.now() + 3_600_000),
        userId: "u",
        tenantId: "t",
        branchId: BRANCH_ID,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useSessionStore.setState({ session: null });
  });

  it("connects to the branch order stream with the session token", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => usePosOrdersSocket({ branchId: BRANCH_ID }), { wrapper: makeWrapper(client) });

    expect(FakeWebSocket.last).not.toBeNull();
    expect(FakeWebSocket.last!.url).toContain(`/api/v1/pos/ws/orders/${BRANCH_ID}`);
    expect(FakeWebSocket.last!.url).toContain("token=test-token");
  });

  it("merges a pushed OrderDto into the order detail cache and invalidates summaries", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => usePosOrdersSocket({ branchId: BRANCH_ID }), {
      wrapper: makeWrapper(client),
    });

    act(() => {
      FakeWebSocket.last!.onopen?.();
    });
    expect(result.current.isConnected).toBe(true);

    act(() => {
      FakeWebSocket.last!.onmessage?.({ data: JSON.stringify(wirePayload) });
    });

    const cached = client.getQueryData<Order>(queryKeys.pos.order(BRANCH_ID, ORDER_ID));
    expect(cached).toBeDefined();
    expect(cached!.id).toBe(ORDER_ID);
    expect(cached!.items[0]?.itemStatus).toBe("PREPARING");

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["pos", BRANCH_ID, "order-summaries"],
    });
  });

  it("ignores a malformed frame without throwing or writing the cache", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => usePosOrdersSocket({ branchId: BRANCH_ID }), { wrapper: makeWrapper(client) });

    act(() => {
      FakeWebSocket.last!.onmessage?.({ data: "not-json" });
    });

    expect(client.getQueryData(queryKeys.pos.order(BRANCH_ID, ORDER_ID))).toBeUndefined();
  });
});
