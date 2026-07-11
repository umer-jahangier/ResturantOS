import { describe, it, expect, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { OrderManagement } from "@/components/pos/order-management";
import { queryKeys } from "@/lib/hooks/query-keys";

const BRANCH_ID = "branch-1";
const CASHIER_ME = "c0000001-0000-4000-8000-000000000001";
const CASHIER_OTHER = "c0000002-0000-4000-8000-000000000002";
const ORDER_A = "d1000001-0000-4000-8000-000000000001";
const ORDER_B = "d1000002-0000-4000-8000-000000000002";

const rawOrderA = {
  orderId: ORDER_A,
  orderNo: "ORD-A",
  tableId: null,
  tableName: "Table 5",
  derivedStatus: "IN_PROGRESS",
  cashierId: CASHIER_ME,
  coverCount: 2,
  totalPaisa: 50000,
  openedAt: new Date().toISOString(),
};

const rawOrderB = {
  orderId: ORDER_B,
  orderNo: "ORD-B",
  tableId: null,
  tableName: "Table 2",
  derivedStatus: "DRAFT",
  cashierId: CASHIER_OTHER,
  coverCount: 1,
  totalPaisa: 20000,
  openedAt: new Date().toISOString(),
};

function pagedResponse(rows: unknown[]) {
  return HttpResponse.json({
    data: rows,
    meta: { page: 0, size: 10, totalElements: rows.length, totalPages: 1 },
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

function mockOrdersList(rows: unknown[]) {
  server.use(http.get("*/api/v1/pos/orders", () => pagedResponse(rows)));
}

describe("OrderManagement", () => {
  afterEach(() => clearSession());

  it("lists active orders with derived status", async () => {
    mockOrdersList([rawOrderA, rawOrderB]);
    seedSession({ sub: CASHIER_ME, branchId: BRANCH_ID, permissions: ["pos.order.view"] });
    const { Wrapper } = createControlledWrapper();

    render(
      <Wrapper>
        <OrderManagement />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText("ORD-A")).toBeInTheDocument());
    expect(screen.getByText("ORD-B")).toBeInTheDocument();
    expect(screen.getByLabelText("In Progress")).toBeInTheDocument();
    expect(screen.getByLabelText("Draft")).toBeInTheDocument();
  });

  it("a status filter chip narrows the set", async () => {
    mockOrdersList([rawOrderA, rawOrderB]);
    seedSession({ sub: CASHIER_ME, branchId: BRANCH_ID, permissions: ["pos.order.view"] });
    const { Wrapper } = createControlledWrapper();
    const user = userEvent.setup();

    render(
      <Wrapper>
        <OrderManagement />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText("ORD-A")).toBeInTheDocument());

    await user.click(screen.getByTestId("status-filter-DRAFT"));

    expect(screen.queryByText("ORD-A")).not.toBeInTheDocument();
    expect(screen.getByText("ORD-B")).toBeInTheDocument();
  });

  it("hides the My/All-Branch toggle without the all-branch permission", async () => {
    mockOrdersList([rawOrderA]);
    seedSession({ sub: CASHIER_ME, branchId: BRANCH_ID, permissions: ["pos.order.view"] });
    const { Wrapper } = createControlledWrapper();

    render(
      <Wrapper>
        <OrderManagement />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText("ORD-A")).toBeInTheDocument());
    expect(screen.queryByTestId("toggle-my-orders")).not.toBeInTheDocument();
  });

  it("shows the My/All-Branch toggle with the all-branch permission", async () => {
    mockOrdersList([rawOrderA, rawOrderB]);
    seedSession({
      sub: CASHIER_ME,
      branchId: BRANCH_ID,
      permissions: ["pos.order.view", "pos.order.view.all"],
    });
    const { Wrapper } = createControlledWrapper();
    const user = userEvent.setup();

    render(
      <Wrapper>
        <OrderManagement />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByTestId("toggle-my-orders")).toBeInTheDocument());

    // Default is "All Branch" — both orders visible (wait for the fetch to resolve).
    await waitFor(() => expect(screen.getByText("ORD-A")).toBeInTheDocument());
    expect(screen.getByText("ORD-B")).toBeInTheDocument();

    await user.click(screen.getByTestId("toggle-my-orders"));

    // "My Orders" narrows to cashierId === current user (CASHIER_ME -> ORD-A only).
    expect(screen.getByText("ORD-A")).toBeInTheDocument();
    expect(screen.queryByText("ORD-B")).not.toBeInTheDocument();
  });

  it("clicking Open opens the shared drawer for that order", async () => {
    mockOrdersList([rawOrderA]);
    server.use(
      http.get(`*/api/v1/pos/orders/${ORDER_A}`, () =>
        HttpResponse.json({
          data: {
            id: ORDER_A,
            branchId: "b0000001-0000-4000-8000-000000000001",
            orderNo: "ORD-A",
            type: "DINE_IN",
            status: "OPEN",
            derivedStatus: "IN_PROGRESS",
            tableId: null,
            coverCount: 2,
            cashierId: CASHIER_ME,
            customerId: null,
            subtotalPaisa: 48000,
            taxPaisa: 2000,
            discountPaisa: 0,
            serviceChargePaisa: 0,
            totalPaisa: 50000,
            notes: null,
            openedAt: new Date().toISOString(),
            sentToKdsAt: null,
            clientOrderId: "c9000001-0000-4000-8000-000000000001",
            version: 1,
            items: [],
          },
          meta: null,
          warnings: [],
        }),
      ),
    );
    seedSession({ sub: CASHIER_ME, branchId: BRANCH_ID, permissions: ["pos.order.view", "pos.order.close"] });
    const { Wrapper } = createControlledWrapper();
    const user = userEvent.setup();

    render(
      <Wrapper>
        <OrderManagement />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByTestId(`open-order-${ORDER_A}`)).toBeInTheDocument());
    await user.click(screen.getByTestId(`open-order-${ORDER_A}`));

    expect(screen.getByTestId("order-table-detail-drawer")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Order #ORD-A" })).toBeInTheDocument();
    });
  });

  it("a non-closed order never disappears abruptly — closing fades the row out", async () => {
    mockOrdersList([rawOrderA, rawOrderB]);
    seedSession({ sub: CASHIER_ME, branchId: BRANCH_ID, permissions: ["pos.order.view"] });
    const { Wrapper, queryClient } = createControlledWrapper();

    render(
      <Wrapper>
        <OrderManagement />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText("ORD-A")).toBeInTheDocument());
    expect(screen.getByText("ORD-B")).toBeInTheDocument();

    // Simulate ORD-A closing: the next fetch of the same query no longer includes it
    // (listOrderSummaries defaults to non-terminal statuses server-side). Writing
    // directly to the cache (rather than an MSW-mediated refetch) keeps this assertion
    // deterministic — no network round trip to race against the fade timer.
    act(() => {
      queryClient.setQueryData(queryKeys.pos.orderSummaries(BRANCH_ID, undefined), {
        data: [rawOrderB],
        meta: { page: 0, size: 10, totalElements: 1, totalPages: 1 },
      });
    });

    // Not an abrupt reflow: ORD-A is still rendered immediately after the data change.
    expect(screen.getByText("ORD-A")).toBeInTheDocument();

    // …but fades out within the 200ms window.
    await waitFor(
      () => expect(screen.queryByText("ORD-A")).not.toBeInTheDocument(),
      { timeout: 2000 },
    );
    expect(screen.getByText("ORD-B")).toBeInTheDocument();
  });
});
