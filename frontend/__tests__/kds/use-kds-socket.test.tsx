/**
 * useKdsSocket — proves the browser KDS board socket targets the real gateway
 * (ws://localhost:8080, via NEXT_PUBLIC_WS_BASE_URL / wsUrl()) rather than the un-proxying Next
 * dev server (localhost:3000) — the root-cause fix for UAT Test 4. Mirrors
 * __tests__/pos/use-pos-orders-socket.test.tsx's FakeWebSocket pattern.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import { useKdsSocket } from "@/lib/hooks/kds/use-kds-socket";
import { useSessionStore } from "@/lib/auth/session";
import { queryKeys } from "@/lib/hooks/query-keys";
import type { KdsTicket } from "@/lib/models/kds.model";

const BRANCH_ID = "11111111-1111-4111-8111-111111111111";
const STATION = "GRILL";
const TICKET_ID = "22222222-2222-4222-8222-222222222222";

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

const wireTicket = {
  id: TICKET_ID,
  orderId: "33333333-3333-4333-8333-333333333333",
  orderNo: "A-100",
  stationCode: STATION,
  status: "PENDING",
  priority: false,
  receivedAt: "2026-07-21T10:00:00Z",
  startedAt: null,
  readyAt: null,
  orderNotes: null,
  tableNumber: null,
  orderType: "DINE_IN",
  items: [],
};

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useKdsSocket", () => {
  beforeEach(() => {
    FakeWebSocket.last = null;
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal(
      "AudioContext",
      class {
        createOscillator() {
          return { connect: () => {}, frequency: { value: 0 }, start: () => {}, stop: () => {} };
        }
        createGain() {
          return { connect: () => {}, gain: { value: 0 } };
        }
        get destination() {
          return {};
        }
        get currentTime() {
          return 0;
        }
      },
    );
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

  it("connects through the real gateway (ws://localhost:8080), not the Next dev server", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useKdsSocket({ branchId: BRANCH_ID, stationCode: STATION }), {
      wrapper: makeWrapper(client),
    });

    expect(FakeWebSocket.last).not.toBeNull();
    const url = FakeWebSocket.last!.url;
    expect(url).toContain(`/api/v1/kitchen/kds/${BRANCH_ID}/${STATION}`);
    expect(url).toContain("token=test-token");
    expect(url.startsWith("ws://localhost:8080")).toBe(true);
    expect(url).not.toContain("localhost:3000");
  });

  it("merges a pushed ticket into the kds tickets cache", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useKdsSocket({ branchId: BRANCH_ID, stationCode: STATION }), {
      wrapper: makeWrapper(client),
    });

    act(() => {
      FakeWebSocket.last!.onopen?.();
    });
    expect(result.current.isConnected).toBe(true);

    act(() => {
      FakeWebSocket.last!.onmessage?.({ data: JSON.stringify(wireTicket) });
    });

    const cached = client.getQueryData<KdsTicket[]>(queryKeys.kds.tickets(BRANCH_ID, STATION));
    expect(cached).toBeDefined();
    expect(cached![0]?.id).toBe(TICKET_ID);
  });

  it("ignores a malformed frame without throwing or writing the cache", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useKdsSocket({ branchId: BRANCH_ID, stationCode: STATION }), {
      wrapper: makeWrapper(client),
    });

    act(() => {
      FakeWebSocket.last!.onmessage?.({ data: "not-json" });
    });

    expect(client.getQueryData(queryKeys.kds.tickets(BRANCH_ID, STATION))).toBeUndefined();
  });
});
