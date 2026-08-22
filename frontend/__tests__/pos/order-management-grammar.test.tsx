import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { OrderManagement } from "@/components/pos/order-management";

/**
 * The order column grammar, rendered (38-06 tasks 1–3).
 *
 * <h3>Why this asserts on the DOM and not on the column array</h3>
 *
 * UI-SPEC §7.2.2, learned the expensive way twice in this phase: *"a class present in the source
 * is not evidence it is present in the DOM"*, and *"a gate that asserts on props is not testing
 * what renders"*. 38-02 shipped `sticky` on `<thead>` and its unit test passed while Chromium
 * reported `thead th { position: static }` — the exact property the contract measures. So every
 * assertion here reads rendered output: header cells in document order, cell text, and the
 * element the `data-testid` actually lands on.
 *
 * <h3>Negative controls, observed</h3>
 *
 * 1. **Column order.** The `Prep` column was moved after `Total` → RED: *"expected [ 'Order #',
 *    'Table', 'Items', …(7) ] to deeply equal [ … ]"* with `- "Prep" / "Total" / + "Prep"`.
 *    Restored.
 * 2. **Bounded Prep (the 113h defect).** `PrepCell` was given back a hand-rolled
 *    `${hours}h ${mins}m` — the shape of the formatter this plan deleted → RED:
 *    *"expected '0h 10m10 minutes' to match /^\d{2}:\d{2}/"*, and the six-day row rendered
 *    `147h 0m`. Restored.
 * 3. **Reconciliation.** `summariseOrders(filtered)` was changed to `summariseOrders(visible)` —
 *    the unfiltered list, which is the plausible mistake because the two arrays are IDENTICAL
 *    until a facet is applied. Every other assertion in this file stayed green; only
 *    *"stays reconciled when a facet narrows the grid"* went RED. That is why that test exists.
 *    Restored.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

const BRANCH_ID = "branch-1";
const CASHIER_ME = "c0000001-0000-4000-8000-000000000001";

/** Six days old. Past `ELAPSED_URGENCY_BOUND_MS`, so `Prep` must stop counting and name the day. */
const SIX_DAYS_AGO = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
const TEN_MINUTES_AGO = new Date(Date.now() - 10 * 60 * 1000).toISOString();

/** Zero-based position of `Prep` in the grammar asserted by the first test in this file. */
const PREP_COLUMN_INDEX = 5;

const rawDineIn = {
  orderId: "d1000001-0000-4000-8000-000000000001",
  orderNo: "ORD-FRESH",
  tableId: "e1000001-0000-4000-8000-000000000001",
  tableName: "T5",
  type: "DINE_IN",
  derivedStatus: "IN_PROGRESS",
  cashierId: CASHIER_ME,
  cashierName: "Omar K.",
  coverCount: 2,
  totalPaisa: 50_000,
  openedAt: TEN_MINUTES_AGO,
  settlementStatus: "SENT_TO_KDS",
  paymentStatus: "UNPAID",
  amountPaidPaisa: 0,
  itemQuantity: 3,
  distinctItemCount: 3,
};

const rawStale = {
  orderId: "d1000002-0000-4000-8000-000000000002",
  orderNo: "ORD-STALE",
  tableId: null,
  tableName: null,
  type: "TAKEAWAY",
  derivedStatus: "IN_PROGRESS",
  cashierId: CASHIER_ME,
  cashierName: "Omar K.",
  coverCount: 1,
  totalPaisa: 20_000,
  openedAt: SIX_DAYS_AGO,
  settlementStatus: "OPEN",
  paymentStatus: "PAID",
  amountPaidPaisa: 20_000,
  itemQuantity: 1,
  distinctItemCount: 1,
};

function pagedResponse(rows: unknown[]) {
  return HttpResponse.json({
    data: rows,
    meta: { page: { cursor: "0", nextCursor: null, limit: 10 }, totalCount: rows.length },
    warnings: [],
  });
}

function renderOrders() {
  server.use(http.get("*/api/v1/pos/orders", () => pagedResponse([rawDineIn, rawStale])));
  seedSession({ sub: CASHIER_ME, branchId: BRANCH_ID, permissions: ["pos.order.view"] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  render(
    <Wrapper>
      <OrderManagement />
    </Wrapper>,
  );
}

describe("Order Management — the column grammar (38-06)", () => {
  afterEach(() => clearSession());

  it("renders Order # · Table · Items · Type · Time · Prep · Total · Status, in that order", async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText("ORD-FRESH")).toBeInTheDocument());

    const headers = within(screen.getByRole("table"))
      .getAllByRole("columnheader")
      .map((th) => th.textContent?.trim())
      .filter((text): text is string => !!text);

    // The demo's spine, then the two axes this product has that the demo does not (F2: payment
    // status and the cashier are separate facts and neither may be folded into `Status`).
    expect(headers).toEqual([
      "Order #",
      "Table",
      "Items",
      "Type",
      "Time",
      "Prep",
      "Total",
      "Status",
      "Payment",
      "Server/Cashier",
    ]);
  });

  it("renders the identifier in mono and never a UUID", async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText("ORD-FRESH")).toBeInTheDocument());

    const cell = screen.getByTestId("order-no-d1000001-0000-4000-8000-000000000001");
    expect(cell).toHaveTextContent("ORD-FRESH");
    expect(cell.className).toContain("font-mono");
    // The order id is a UUID and is one property away on the same object.
    expect(within(screen.getByRole("table")).queryByText(/^[0-9a-f]{8}-[0-9a-f]{4}-/i)).toBeNull();
  });

  it("carries status and type as TWO badges — never one badge meaning both", async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText("ORD-FRESH")).toBeInTheDocument());

    // F2's defect in one assertion: a DINE_IN check WITH a table and a TAKEAWAY check WITHOUT
    // one, each named by its own `type` rather than by whether a table happens to be assigned.
    const typeCells = screen.getAllByTestId("order-type-cell").map((n) => n.textContent);
    expect(typeCells).toEqual(["Dine-in", "Takeaway"]);

    // …and the settlement/kitchen status is a different badge entirely.
    expect(screen.getAllByLabelText("In Progress").length).toBe(2);
  });

  it("Prep stops counting past 24h and names the day instead of rendering 147h", async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText("ORD-STALE")).toBeInTheDocument());

    // Read the PREP CELL BY POSITION rather than by text. `Time` renders `HH:MM` and a sub-hour
    // `Prep` renders `mm:ss`; the two are visually identical and were the reason `elapsed.ts`
    // spells the units above an hour. A text matcher would happily assert on the wrong column,
    // which is UI-SPEC §7.2.2's "a gate that measures a different quantity than the defect".
    const prepOf = (orderNo: string) => {
      const row = screen.getByText(orderNo).closest("tr") as HTMLTableRowElement;
      return within(row).getAllByRole("cell")[PREP_COLUMN_INDEX]?.textContent ?? "";
    };

    // The ten-minute check keeps its running mm:ss timer.
    expect(prepOf("ORD-FRESH")).toMatch(/^\d{2}:\d{2}/);
    // The six-day-old one does NOT. `formatElapsedCompact`'s bound turns it into a date, which
    // is a redundant, colour-independent channel: the SHAPE of the text carries the boundary.
    // `147h 0m` is what the deleted hand-rolled formatter produced, and it was wrapped in the
    // same treatment as a check that is genuinely four minutes late.
    expect(prepOf("ORD-STALE")).not.toMatch(/\d{2,3}h/);
    expect(prepOf("ORD-STALE")).toMatch(/^\d{1,2} [A-Z][a-z]{2}/);
  });

  it("the stat line reconciles with the grid's own row count and Total column", async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText("ORD-FRESH")).toBeInTheDocument());

    const statLine = screen.getByTestId("order-stat-line");
    // 2 rows, Rs 500 + Rs 200 = Rs 700, one of them unpaid.
    expect(statLine).toHaveTextContent("2 orders listed");
    expect(statLine).toHaveTextContent("Rs 700.00");
    expect(statLine).toHaveTextContent("1 unpaid");

    // The grid states the same count independently — this is the reconciliation, not a restated
    // constant: `data-grid-count` is computed by TanStack's own filtered row model.
    expect(screen.getByTestId("data-grid-count")).toHaveTextContent("2 rows");
  });

  it("stays reconciled when a facet narrows the grid — both numbers move together", async () => {
    renderOrders();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText("ORD-FRESH")).toBeInTheDocument());

    // The Type facet filters the ROWS ON SCREEN (the orders endpoint accepts no `type`
    // parameter). This is the assertion that actually gates the reconciliation: a stat line
    // computed from any array other than the one handed to the grid passes every check above
    // and fails here, because only here do the two arrays differ.
    await user.selectOptions(screen.getByLabelText("Type"), "TAKEAWAY");

    await waitFor(() =>
      expect(screen.getByTestId("order-stat-line")).toHaveTextContent("1 order listed"),
    );
    expect(screen.getByTestId("data-grid-count")).toHaveTextContent("1 row");
    // Rs 200 is the takeaway check's own total, not the two-check sum.
    expect(screen.getByTestId("order-stat-line")).toHaveTextContent("Rs 200.00");
    expect(screen.getByTestId("order-stat-line")).toHaveTextContent("0 unpaid");
    // And the strip says how many filters are on, in words, so an empty list is never read as
    // "the business has no orders" (FilterBar's whole reason to exist).
    expect(screen.getByTestId("filter-bar-active-count")).toHaveTextContent("1 filter active");
  });

  it("the sticky header is on the `th`, which is the property the contract measures", async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText("ORD-FRESH")).toBeInTheDocument());

    for (const th of within(screen.getByRole("table")).getAllByRole("columnheader")) {
      expect(th.className).toContain("sticky");
    }
  });
});
