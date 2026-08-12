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
 * S0-04 — a voided or refunded order must be reachable from Order Management.
 *
 * <p>The register's finding: `ORD-20260812-0026` appeared in NONE of the seven filter chips
 * (All, Draft, In Progress, Partially Served, Served, Closed, Paid) while its CASH payment row
 * survived — "there is no screen in the product on which an owner can see that a paid order was
 * voided". The cause was not the API (`?status=VOIDED` has always worked) but the client: the
 * default listing asks for non-terminal statuses only, the only explicit terminal request the UI
 * ever made was `[CLOSED]`, and no chip offered VOIDED or REFUNDED at all.
 *
 * <p>These tests assert on what the operator can actually reach: the chip exists, clicking it
 * asks the server for that status, and the row that comes back carries the settlement badge, the
 * money, the reason and the actor.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

const BRANCH_ID = "branch-1";
const MANAGER = "c0000001-0000-4000-8000-000000000001";
const ACTIVE_ORDER = "d1000001-0000-4000-8000-000000000001";
const VOIDED_ORDER = "d1000002-0000-4000-8000-000000000002";
const REFUNDED_ORDER = "d1000003-0000-4000-8000-000000000003";

const activeRow = {
  orderId: ACTIVE_ORDER,
  orderNo: "ORD-ACTIVE",
  tableId: null,
  tableName: "Table 5",
  derivedStatus: "IN_PROGRESS",
  cashierId: MANAGER,
  coverCount: 2,
  totalPaisa: 50000,
  openedAt: new Date().toISOString(),
  settlementStatus: "SENT_TO_KDS",
  paymentStatus: "UNPAID",
  amountPaidPaisa: 0,
  itemQuantity: 3,
  distinctItemCount: 2,
  settlement: null,
};

const voidedRow = {
  orderId: VOIDED_ORDER,
  orderNo: "ORD-VOIDED",
  tableId: null,
  tableName: null,
  // Deliberately still IN_PROGRESS: `derivedStatus` records how far the FOOD got and does not
  // change on a void. A row that renders derivedStatus would badge this voided check "In
  // Progress", which is the wrong answer twice over.
  derivedStatus: "IN_PROGRESS",
  cashierId: MANAGER,
  coverCount: 1,
  totalPaisa: 10000,
  openedAt: new Date().toISOString(),
  settlementStatus: "VOIDED",
  paymentStatus: "UNPAID",
  amountPaidPaisa: 0,
  itemQuantity: 1,
  distinctItemCount: 1,
  settlement: {
    reason: "Guest walked out before service",
    byUserId: MANAGER,
    byName: "Terrace Manager",
    at: new Date().toISOString(),
  },
};

const refundedRow = {
  ...voidedRow,
  orderId: REFUNDED_ORDER,
  orderNo: "ORD-REFUNDED",
  settlementStatus: "REFUNDED",
  paymentStatus: "REFUNDED",
  totalPaisa: 168200,
  amountPaidPaisa: 168200,
  settlement: {
    reason: "Dish sent back cold",
    byUserId: MANAGER,
    byName: "Terrace Manager",
    at: new Date().toISOString(),
  },
};

function pagedResponse(rows: unknown[]) {
  return HttpResponse.json({
    data: rows,
    meta: { page: { cursor: "0", nextCursor: null, limit: 20 }, totalCount: rows.length },
    warnings: [],
  });
}

/**
 * Answers by the requested `status` exactly as the backend does — the default (no status) is the
 * ACTIVE listing and contains no terminal row. A handler that returned everything regardless of
 * the query string would let a broken client pass.
 */
function mockOrdersByStatus() {
  const requested: string[][] = [];
  server.use(
    http.get("*/api/v1/pos/orders", ({ request }) => {
      const url = new URL(request.url);
      const statuses = url.searchParams.getAll("status[]").concat(url.searchParams.getAll("status"));
      requested.push(statuses);
      if (statuses.includes("VOIDED")) return pagedResponse([voidedRow]);
      if (statuses.includes("REFUNDED")) return pagedResponse([refundedRow]);
      if (statuses.includes("CLOSED")) return pagedResponse([]);
      return pagedResponse([activeRow]);
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
  return Wrapper;
}

function renderOrderManagement() {
  const Wrapper = createWrapper();
  seedSession({ sub: MANAGER, branchId: BRANCH_ID, permissions: ["pos.order.view"] });
  return render(
    <Wrapper>
      <OrderManagement />
    </Wrapper>,
  );
}

describe("OrderManagement — settled orders are reachable (S0-04)", () => {
  afterEach(() => clearSession());

  it("offers a Voided chip and a Refunded chip", async () => {
    mockOrdersByStatus();
    renderOrderManagement();

    await waitFor(() => expect(screen.getByText("ORD-ACTIVE")).toBeInTheDocument());
    expect(screen.getByTestId("status-filter-VOIDED")).toHaveTextContent("Voided");
    expect(screen.getByTestId("status-filter-REFUNDED")).toHaveTextContent("Refunded");
  });

  it("the Voided chip asks the server for VOIDED and lists the order with reason, actor and total", async () => {
    const requested = mockOrdersByStatus();
    const user = userEvent.setup();
    renderOrderManagement();

    await waitFor(() => expect(screen.getByText("ORD-ACTIVE")).toBeInTheDocument());
    expect(screen.queryByText("ORD-VOIDED")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("status-filter-VOIDED"));

    await waitFor(() => expect(screen.getByText("ORD-VOIDED")).toBeInTheDocument());
    expect(requested.some((s) => s.includes("VOIDED"))).toBe(true);

    // The settlement badge, not the kitchen-progress badge.
    expect(screen.getByLabelText("Voided")).toBeInTheDocument();
    expect(screen.queryByLabelText("In Progress")).not.toBeInTheDocument();

    // Money, reason and actor — the three things the register said no screen could show.
    expect(screen.getByText("Rs 100.00")).toBeInTheDocument();
    expect(screen.getByText("Guest walked out before service")).toBeInTheDocument();
    expect(screen.getByText(/by Terrace Manager/)).toBeInTheDocument();
  });

  it("the Refunded chip asks the server for REFUNDED and lists the refunded order", async () => {
    const requested = mockOrdersByStatus();
    const user = userEvent.setup();
    renderOrderManagement();

    await waitFor(() => expect(screen.getByText("ORD-ACTIVE")).toBeInTheDocument());

    await user.click(screen.getByTestId("status-filter-REFUNDED"));

    await waitFor(() => expect(screen.getByText("ORD-REFUNDED")).toBeInTheDocument());
    expect(requested.some((s) => s.includes("REFUNDED"))).toBe(true);
    // "Refunded" legitimately appears twice on the row — the settlement badge and the payment
    // badge — so this asserts presence, not uniqueness.
    expect(screen.getAllByLabelText("Refunded").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("In Progress")).not.toBeInTheDocument();
    expect(screen.getByText("Dish sent back cold")).toBeInTheDocument();
  });

  it("says on screen that the default chip is active-only and where the settled orders are", async () => {
    mockOrdersByStatus();
    renderOrderManagement();

    await waitFor(() => expect(screen.getByText("ORD-ACTIVE")).toBeInTheDocument());

    // The chip must not promise "All" while showing only live orders — that is what made a
    // missing voided order read as data loss.
    expect(screen.getByTestId("status-filter-ALL")).toHaveTextContent("Active");
    const note = screen.getByTestId("order-scope-note");
    expect(note).toHaveTextContent(/Active shows live orders only/i);
    expect(note).toHaveTextContent(/Voided/);
  });

  it("an empty Voided view does not claim there are no active orders", async () => {
    server.use(http.get("*/api/v1/pos/orders", () => pagedResponse([])));
    const user = userEvent.setup();
    renderOrderManagement();

    await user.click(screen.getByTestId("status-filter-VOIDED"));

    await waitFor(() => expect(screen.getByText("No voided orders")).toBeInTheDocument());
    expect(screen.queryByText("No active orders")).not.toBeInTheDocument();
  });
});
