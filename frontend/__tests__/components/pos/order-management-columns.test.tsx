import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { OrderManagement } from "@/components/pos/order-management";

// The shared drawer renders SettlementActions, which navigates (useRouter) instead of
// opening a Dialog since 07.3-07 — no real Next router is mounted in these unit tests.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

// order-management-columns.test.tsx — TDD proof for POS-24's Order Management
// completion: settlement filters + search, payment-status column, Items column
// (replacing Cover), and the Assign Table row action (07.3-08).

const BRANCH_ID = "branch-1";
const CASHIER_ME = "c0000001-0000-4000-8000-000000000001";
const ORDER_A = "d1000001-0000-4000-8000-000000000001";
const ORDER_B = "d1000002-0000-4000-8000-000000000002";
const ORDER_CLOSED = "d1000003-0000-4000-8000-000000000003";

// 3x Burger + 2x Coke -> itemQuantity 5 (total), distinctItemCount 2 (line count).
const rawOrderA = {
  orderId: ORDER_A,
  orderNo: "ORD-A",
  tableId: null,
  tableName: "Table 5",
  type: "DINE_IN",
  derivedStatus: "IN_PROGRESS",
  cashierId: CASHIER_ME,
  coverCount: 2,
  totalPaisa: 50000,
  openedAt: new Date().toISOString(),
  settlementStatus: "SENT_TO_KDS",
  paymentStatus: "PAID",
  amountPaidPaisa: 50000,
  itemQuantity: 5,
  distinctItemCount: 2,
};

const rawOrderB = {
  orderId: ORDER_B,
  orderNo: "ORD-B",
  tableId: null,
  tableName: "Table 9",
  type: "DINE_IN",
  derivedStatus: "IN_PROGRESS",
  cashierId: CASHIER_ME,
  coverCount: 1,
  totalPaisa: 20000,
  openedAt: new Date().toISOString(),
  settlementStatus: "OPEN",
  paymentStatus: "UNPAID",
  amountPaidPaisa: 0,
  itemQuantity: 1,
  distinctItemCount: 1,
};

const rawOrderClosed = {
  orderId: ORDER_CLOSED,
  orderNo: "ORD-CLOSED",
  tableId: null,
  tableName: "Table 2",
  type: "TAKEAWAY",
  derivedStatus: "SERVED",
  cashierId: CASHIER_ME,
  coverCount: 2,
  totalPaisa: 30000,
  openedAt: new Date().toISOString(),
  settlementStatus: "CLOSED",
  paymentStatus: "PAID",
  amountPaidPaisa: 30000,
  itemQuantity: 2,
  distinctItemCount: 2,
};

function pagedResponse(rows: unknown[]) {
  return HttpResponse.json({
    data: rows,
    meta: { page: { cursor: "0", nextCursor: null, limit: 10 }, totalCount: rows.length },
    warnings: [],
  });
}

function createControlledWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { Wrapper, queryClient };
}

describe("OrderManagement columns/filters/search (POS-24, 07.3-08)", () => {
  afterEach(() => clearSession());

  // F2: the counts are still the POS-24 ones (total quantity, not coverCount); only the WORDS
  // changed. "5 Items" over "2 Items / 5 Qty" used "Items" for two different quantities in one
  // cell, and a single-line check read "1 Items".
  it("the Items column shows the total quantity and the line count, each with its own noun", async () => {
    server.use(http.get("*/api/v1/pos/orders", () => pagedResponse([rawOrderA, rawOrderB])));
    seedSession({ sub: CASHIER_ME, branchId: BRANCH_ID, permissions: ["pos.order.view"] });
    const { Wrapper } = createControlledWrapper();

    render(
      <Wrapper>
        <OrderManagement />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText("ORD-A")).toBeInTheDocument());
    expect(screen.getByText("5 items")).toBeInTheDocument();
    expect(screen.getByText("2 lines")).toBeInTheDocument();
    expect(screen.getByText("1 item")).toBeInTheDocument();
    expect(screen.getAllByTestId("payment-status-badge").length).toBeGreaterThanOrEqual(2);
  });

  /*
   * REMOVED, not repaired: "the search box filters rows by order no. / table name
   * (case-insensitive substring)".
   *
   * It asserted a client-side substring filter over the rows already fetched. S0-05 deliberately
   * replaced that with a SERVER query (`?q=`) precisely because filtering the fetched array could
   * not reach a voided check, a closed one, or row 34 of a 20-row page — it is the defect, not the
   * contract. The test had been failing red against `main` since that change landed (verified by
   * running this file against HEAD before touching it), and the behaviour it should have asserted
   * is covered properly, against the wire, by
   * `__tests__/pos/order-management-search.test.tsx` → "sends the term to the server as ?q=
   * instead of filtering the fetched rows".
   */

  it("a Closed filter chip passes a terminal statuses value to useOrderSummaries and shows closed rows", async () => {
    let sawTerminalRequest = false;
    server.use(
      http.get("*/api/v1/pos/orders", ({ request }) => {
        const url = new URL(request.url);
        if (url.search.includes("CLOSED")) {
          sawTerminalRequest = true;
          return pagedResponse([rawOrderClosed]);
        }
        return pagedResponse([rawOrderA, rawOrderB]);
      }),
    );
    seedSession({ sub: CASHIER_ME, branchId: BRANCH_ID, permissions: ["pos.order.view"] });
    const { Wrapper } = createControlledWrapper();
    const user = userEvent.setup();

    render(
      <Wrapper>
        <OrderManagement />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText("ORD-A")).toBeInTheDocument());

    await user.click(screen.getByTestId("status-filter-CLOSED"));

    await waitFor(() => expect(sawTerminalRequest).toBe(true));
    await waitFor(() => expect(screen.getByText("ORD-CLOSED")).toBeInTheDocument());
  });

  it("grep-equivalent: no Covers column cell remains (replaced by Items)", async () => {
    server.use(http.get("*/api/v1/pos/orders", () => pagedResponse([rawOrderA])));
    seedSession({ sub: CASHIER_ME, branchId: BRANCH_ID, permissions: ["pos.order.view"] });
    const { Wrapper } = createControlledWrapper();

    render(
      <Wrapper>
        <OrderManagement />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText("ORD-A")).toBeInTheDocument());
    expect(screen.queryByText("Covers")).not.toBeInTheDocument();
    expect(screen.getByText("Items")).toBeInTheDocument();
  });
});
