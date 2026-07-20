/**
 * useDashboardSocket — proves the browser dashboard socket targets the real gateway
 * (ws://localhost:8080, via NEXT_PUBLIC_WS_BASE_URL / wsUrl()) rather than the un-proxying Next
 * dev server (localhost:3000) — the root-cause fix for UAT Test 3 (RPT-02). Mirrors
 * __tests__/pos/use-pos-orders-socket.test.tsx's FakeWebSocket pattern.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import { useDashboardSocket } from "@/lib/hooks/reporting/use-dashboard-socket";
import { useSessionStore } from "@/lib/auth/session";
import { queryKeys } from "@/lib/hooks/query-keys";
import type { DashboardTile } from "@/lib/models/reporting.model";

const BRANCH_ID = "11111111-1111-4111-8111-111111111111";

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

const wireTiles = [
  {
    tileId: "revenue-today",
    title: "Revenue Today",
    valuePaisa: 100_000,
    valueNumber: null,
    unit: "PKR",
    businessDate: "2026-07-21",
    computedAt: "2026-07-21T10:00:00Z",
  },
];

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useDashboardSocket", () => {
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

  it("connects through the real gateway (ws://localhost:8080), not the Next dev server", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useDashboardSocket({ branchId: BRANCH_ID }), { wrapper: makeWrapper(client) });

    expect(FakeWebSocket.last).not.toBeNull();
    const url = FakeWebSocket.last!.url;
    expect(url).toContain(`/api/v1/reporting/dashboard/${BRANCH_ID}`);
    expect(url).toContain("token=test-token");
    expect(url.startsWith("ws://localhost:8080")).toBe(true);
    expect(url).not.toContain("localhost:3000");
  });

  it("merges a pushed tile array into the shared dashboardTiles cache key", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useDashboardSocket({ branchId: BRANCH_ID }), {
      wrapper: makeWrapper(client),
    });

    act(() => {
      FakeWebSocket.last!.onopen?.();
    });
    expect(result.current.isConnected).toBe(true);

    act(() => {
      FakeWebSocket.last!.onmessage?.({ data: JSON.stringify(wireTiles) });
    });

    const cached = client.getQueryData<DashboardTile[]>(queryKeys.reporting.dashboardTiles(BRANCH_ID));
    expect(cached).toBeDefined();
    expect(cached![0]?.tileId).toBe("revenue-today");
    expect(result.current.tiles?.[0]?.tileId).toBe("revenue-today");
  });

  it("ignores a malformed frame without throwing or writing the cache", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useDashboardSocket({ branchId: BRANCH_ID }), { wrapper: makeWrapper(client) });

    act(() => {
      FakeWebSocket.last!.onmessage?.({ data: "not-json" });
    });

    expect(client.getQueryData(queryKeys.reporting.dashboardTiles(BRANCH_ID))).toBeUndefined();
  });
});
