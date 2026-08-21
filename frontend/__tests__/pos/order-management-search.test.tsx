import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { OrderManagement } from "@/components/pos/order-management";

/**
 * S0-05 — the Order Management search box must ASK THE SERVER.
 *
 * The defect: search was `source.filter(...)` over the rows already fetched, matching only
 * `orderNo` and `tableName`. So it never issued a request, never reached a voided or closed
 * check, and never matched a customer's phone — typing the number of an order you had just
 * voided produced "No active orders".
 *
 * Every assertion below is about the REQUEST as well as the pixels: a passing render with no
 * `?q=` on the wire is the exact false green this repo keeps producing.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

const BRANCH_ID = "branch-1";
const CASHIER_ME = "c0000001-0000-4000-8000-000000000001";
const ORDER_LIVE = "d1000001-0000-4000-8000-000000000001";
const ORDER_VOIDED = "d1000002-0000-4000-8000-000000000002";
const ORDER_PHONE = "d1000003-0000-4000-8000-000000000003";

function row(overrides: Record<string, unknown>) {
  return {
    orderId: ORDER_LIVE,
    orderNo: "ORD-20260812-0001",
    tableId: null,
    tableName: "Table 5",
    type: "DINE_IN",
    derivedStatus: "IN_PROGRESS",
    cashierId: CASHIER_ME,
    coverCount: 2,
    totalPaisa: 50000,
    openedAt: new Date().toISOString(),
    settlementStatus: "SENT_TO_KDS",
    paymentStatus: "UNPAID",
    amountPaidPaisa: 0,
    itemQuantity: 3,
    distinctItemCount: 2,
    ...overrides,
  };
}

const liveRow = row({});
// A voided check keeps its kitchen-progress derivedStatus; VOIDED is a SETTLEMENT status,
// and getOrderDisplayStatus() is what merges the two into the badge.
const voidedRow = row({
  orderId: ORDER_VOIDED,
  orderNo: "ORD-20260812-0026",
  derivedStatus: "IN_PROGRESS",
  settlementStatus: "VOIDED",
  tableName: null,
  voidDetail: { reason: "Guest left", byUserId: CASHIER_ME, byName: "Manager", at: new Date().toISOString() },
});
const phoneRow = row({
  orderId: ORDER_PHONE,
  orderNo: "ORD-20260812-0031",
  tableName: null,
});

function paged(rows: unknown[], totalCount = rows.length) {
  return HttpResponse.json({
    data: rows,
    meta: { page: { cursor: "0", nextCursor: null, limit: 100 }, totalCount },
    warnings: [],
  });
}

/**
 * Routes GET /pos/orders by its `q` param and records every URL that came in, so a test can
 * assert what was actually asked for — not merely what was rendered.
 */
function mockSearchableOrders(byTerm: Record<string, { rows: unknown[]; total?: number }>) {
  const requested: string[] = [];
  server.use(
    http.get("*/api/v1/pos/orders", ({ request }) => {
      const url = new URL(request.url);
      requested.push(url.search);
      const q = url.searchParams.get("q");
      if (!q) return paged([liveRow]);
      const hit = byTerm[q];
      return hit ? paged(hit.rows, hit.total ?? hit.rows.length) : paged([]);
    }),
  );
  return requested;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { Wrapper };
}

function signIn() {
  seedSession({
    sub: CASHIER_ME,
    branchId: BRANCH_ID,
    permissions: ["pos.order.view", "pos.order.view.all"],
  });
}

describe("Order Management search (S0-05)", () => {
  afterEach(() => clearSession());

  it("sends the term to the server as ?q= instead of filtering the fetched rows", async () => {
    const requested = mockSearchableOrders({ "0026": { rows: [voidedRow] } });
    signIn();
    const { Wrapper } = createWrapper();
    const user = userEvent.setup();

    render(
      <Wrapper>
        <OrderManagement />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText("ORD-20260812-0001")).toBeInTheDocument());

    await user.type(screen.getByTestId("order-management-search"), "0026");

    await waitFor(() => expect(requested.some((s) => s.includes("q=0026"))).toBe(true), {
      timeout: 3000,
    });
  });

  it("finds a VOIDED order by number with the Active chip still selected", async () => {
    mockSearchableOrders({ "0026": { rows: [voidedRow] } });
    signIn();
    const { Wrapper } = createWrapper();
    const user = userEvent.setup();

    render(
      <Wrapper>
        <OrderManagement />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText("ORD-20260812-0001")).toBeInTheDocument());

    // The Active chip is the default and is NOT touched — that is the whole point.
    await user.type(screen.getByTestId("order-management-search"), "0026");

    await waitFor(() => expect(screen.getByText("ORD-20260812-0026")).toBeInTheDocument(), {
      timeout: 3000,
    });
    // The row carries its VOIDED badge, so the manager can see what happened to the check.
    expect(screen.getByLabelText("Voided")).toBeInTheDocument();
    // ...and the live order that does not match is gone.
    expect(screen.queryByText("ORD-20260812-0001")).not.toBeInTheDocument();
  });

  it("finds an order by the attached customer's phone", async () => {
    mockSearchableOrders({ "03009824573": { rows: [phoneRow] } });
    signIn();
    const { Wrapper } = createWrapper();
    const user = userEvent.setup();

    render(
      <Wrapper>
        <OrderManagement />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText("ORD-20260812-0001")).toBeInTheDocument());

    await user.type(screen.getByTestId("order-management-search"), "03009824573");

    await waitFor(() => expect(screen.getByText("ORD-20260812-0031")).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it("says nothing matched instead of 'No active orders'", async () => {
    mockSearchableOrders({});
    signIn();
    const { Wrapper } = createWrapper();
    const user = userEvent.setup();

    render(
      <Wrapper>
        <OrderManagement />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText("ORD-20260812-0001")).toBeInTheDocument());

    await user.type(screen.getByTestId("order-management-search"), "nothing-here");

    await waitFor(() => expect(screen.getByText("No orders match that search")).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.queryByText("No active orders")).not.toBeInTheDocument();
  });

  it("admits when there are more matches than the page holds", async () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      row({
        // Real uuids — the response schema rejects anything else, and a rejected page
        // would look exactly like "the truncation notice does not work".
        orderId: `d1000${String(i).padStart(3, "0")}-0000-4000-8000-000000000001`,
        orderNo: `ORD-20260812-${1000 + i}`,
      }),
    );
    mockSearchableOrders({ ORD: { rows: many, total: 209 } });
    signIn();
    const { Wrapper } = createWrapper();
    const user = userEvent.setup();

    render(
      <Wrapper>
        <OrderManagement />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText("ORD-20260812-0001")).toBeInTheDocument());

    await user.type(screen.getByTestId("order-management-search"), "ORD");

    await waitFor(
      () =>
        expect(screen.getByTestId("order-search-scope-note").textContent).toContain(
          "Listing the first 100 of 209 matches",
        ),
      { timeout: 3000 },
    );
  });

  it("debounces — one request per settled term, not one per keystroke", async () => {
    const requested = mockSearchableOrders({ "0026": { rows: [voidedRow] } });
    signIn();
    const { Wrapper } = createWrapper();
    const user = userEvent.setup();

    render(
      <Wrapper>
        <OrderManagement />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText("ORD-20260812-0001")).toBeInTheDocument());

    await user.type(screen.getByTestId("order-management-search"), "0026");
    await waitFor(() => expect(requested.some((s) => s.includes("q=0026"))).toBe(true), {
      timeout: 3000,
    });

    // Four characters typed; nowhere near four searched terms on the wire.
    const searched = requested.filter((s) => s.includes("q="));
    expect(searched.length).toBeLessThanOrEqual(2);
  });
});
