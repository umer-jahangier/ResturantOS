import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { OrderManagement } from "@/components/pos/order-management";
import { queryKeys } from "@/lib/hooks/query-keys";

// The shared drawer renders SettlementActions, which navigates (useRouter) instead of
// opening a Dialog since 07.3-07 — no real Next router is mounted in these unit tests.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

const BRANCH_ID = "branch-1";
const CASHIER_ME = "c0000001-0000-4000-8000-000000000001";
const CASHIER_OTHER = "c0000002-0000-4000-8000-000000000002";
const ORDER_A = "d1000001-0000-4000-8000-000000000001";
const ORDER_B = "d1000002-0000-4000-8000-000000000002";
const ORDER_DRAFT = "d1000003-0000-4000-8000-000000000003";

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
  paymentStatus: "UNPAID",
  amountPaidPaisa: 0,
  itemQuantity: 3,
  distinctItemCount: 2,
};

// NOT a draft, deliberately. This row stands in the ACTIVE list, and the server's default
// listing is "all non-terminal statuses EXCLUDING DRAFT" — so a DRAFT row here would be a
// fixture describing a response the server cannot produce. It used to be one, which is how
// the Draft chip's client-side filter tested green while being dead in production: the only
// thing it could ever have filtered was a row that is never in the list it filters.
const rawOrderB = {
  orderId: ORDER_B,
  orderNo: "ORD-B",
  tableId: null,
  tableName: "Table 2",
  type: "DINE_IN",
  derivedStatus: "SERVED",
  cashierId: CASHIER_OTHER,
  coverCount: 1,
  totalPaisa: 20000,
  openedAt: new Date().toISOString(),
  settlementStatus: "SENT_TO_KDS",
  paymentStatus: "UNPAID",
  amountPaidPaisa: 0,
  itemQuantity: 1,
  distinctItemCount: 1,
};

// A real draft shell: rung up, never fired, so it holds a till open until someone cancels it.
// Owned by CASHIER_ME so it survives the My-Orders toggle and the row offers Cancel.
const rawOrderDraft = {
  orderId: ORDER_DRAFT,
  orderNo: "ORD-DRAFT",
  tableId: null,
  tableName: null,
  type: "DINE_IN",
  derivedStatus: "DRAFT",
  cashierId: CASHIER_ME,
  coverCount: 1,
  totalPaisa: 0,
  openedAt: new Date().toISOString(),
  settlementStatus: "DRAFT",
  paymentStatus: "UNPAID",
  amountPaidPaisa: 0,
  itemQuantity: 0,
  distinctItemCount: 0,
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

function mockOrdersList(rows: unknown[]) {
  server.use(http.get("*/api/v1/pos/orders", () => pagedResponse(rows)));
}

/**
 * Answers by the requested `status` the way the backend does, and — the part that matters here —
 * refuses to put a DRAFT row in the default listing. OrderServiceImpl.listOrderSummaries returns
 * "all non-terminal statuses EXCLUDING DRAFT" when no status is given, so a fixture that serves
 * drafts unconditionally lets a client-side Draft filter pass a test it could never pass against
 * the real server. Records what was asked so a test can assert the chip actually issued the query
 * rather than quietly filtering rows it already had.
 */
function mockOrdersByStatus(rowsByStatus: { active: unknown[]; draft: unknown[] }) {
  const requested: string[][] = [];
  server.use(
    http.get("*/api/v1/pos/orders", ({ request }) => {
      const url = new URL(request.url);
      const statuses = url.searchParams.getAll("status[]").concat(url.searchParams.getAll("status"));
      requested.push(statuses);
      if (statuses.includes("DRAFT")) return pagedResponse(rowsByStatus.draft);
      if (statuses.length > 0) return pagedResponse([]);
      return pagedResponse(rowsByStatus.active);
    }),
  );
  return requested;
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
    expect(screen.getByLabelText("Served")).toBeInTheDocument();
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

    await user.click(screen.getByTestId("status-filter-SERVED"));

    expect(screen.queryByText("ORD-A")).not.toBeInTheDocument();
    expect(screen.getByText("ORD-B")).toBeInTheDocument();
  });

  /**
   * The Draft chip could not show a row, ever. It filtered the ACTIVE list client-side, and the
   * server's default listing excludes DRAFT — so the one status it selects for is the one status
   * its source can never contain. `CancelDraftAction` was written for those rows and was therefore
   * unreachable code, which is how draft shells sat on a cashier's till with no screen able to
   * reach them. The chip must ASK the server, so this asserts the request as well as the row.
   */
  it("the Draft chip asks the server for drafts and offers Cancel on the row", async () => {
    const requested = mockOrdersByStatus({
      active: [rawOrderA, rawOrderB],
      draft: [rawOrderDraft],
    });
    seedSession({ sub: CASHIER_ME, branchId: BRANCH_ID, permissions: ["pos.order.view"] });
    const { Wrapper } = createControlledWrapper();
    const user = userEvent.setup();

    render(
      <Wrapper>
        <OrderManagement />
      </Wrapper>,
    );

    // The draft is absent from Active — not filtered out, never sent.
    await waitFor(() => expect(screen.getByText("ORD-A")).toBeInTheDocument());
    expect(screen.queryByText("ORD-DRAFT")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("status-filter-DRAFT"));

    await waitFor(() => expect(screen.getByText("ORD-DRAFT")).toBeInTheDocument());
    expect(requested).toContainEqual(["DRAFT"]);
    expect(screen.queryByText("ORD-A")).not.toBeInTheDocument();
    expect(screen.queryByText("ORD-B")).not.toBeInTheDocument();

    // The control that was unreachable before: it exists on the row the chip now renders.
    expect(screen.getByTestId(`cancel-draft-${ORDER_DRAFT}`)).toBeInTheDocument();
  });

  it("the Draft chip's empty state does not claim there are no ACTIVE orders", async () => {
    mockOrdersByStatus({ active: [rawOrderA], draft: [] });
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

    // "No active orders" here would be a claim about the restaurant, made while showing a
    // differently-scoped fetch — the mislabelling EMPTY_SCOPED_COPY exists to prevent.
    await waitFor(() => expect(screen.getByText("No draft orders")).toBeInTheDocument());
    expect(screen.queryByText("No active orders")).not.toBeInTheDocument();
    expect(screen.getByTestId("order-scope-note")).toHaveTextContent(/Draft orders/);
    // §26: an empty Draft list should say what to do next, and starting an order is a real
    // next step here (unlike an empty Voided list, which is why the CTA is per-filter).
    expect(screen.getByRole("button", { name: "Go to POS" })).toBeInTheDocument();
  });

  it("an empty settlement view offers no 'Go to POS' CTA", async () => {
    server.use(http.get("*/api/v1/pos/orders", () => pagedResponse([])));
    seedSession({ sub: CASHIER_ME, branchId: BRANCH_ID, permissions: ["pos.order.view"] });
    const { Wrapper } = createControlledWrapper();
    const user = userEvent.setup();

    render(
      <Wrapper>
        <OrderManagement />
      </Wrapper>,
    );

    await user.click(screen.getByTestId("status-filter-VOIDED"));

    await waitFor(() => expect(screen.getByText("No voided orders")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Go to POS" })).not.toBeInTheDocument();
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
            serviceChargePct: 0,
            serviceChargeLabel: null,
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
    seedSession({
      sub: CASHIER_ME,
      branchId: BRANCH_ID,
      permissions: ["pos.order.view", "pos.order.close"],
    });
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
        meta: { page: { cursor: "0", nextCursor: null, limit: 10 }, totalCount: 1 },
      });
    });

    // Not an abrupt reflow: ORD-A is still rendered immediately after the data change.
    expect(screen.getByText("ORD-A")).toBeInTheDocument();

    // …but fades out within the 200ms window.
    await waitFor(() => expect(screen.queryByText("ORD-A")).not.toBeInTheDocument(), {
      timeout: 2000,
    });
    expect(screen.getByText("ORD-B")).toBeInTheDocument();
  });
});
