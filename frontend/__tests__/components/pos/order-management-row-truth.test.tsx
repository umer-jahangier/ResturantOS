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
 * F2 — what an Order Management ROW says about a check, versus what is true of it.
 *
 * <h3>How these assertions are written, and why</h3>
 *
 * Every expectation below reads the row's own rendered TEXT, or presses a control by its
 * ACCESSIBLE NAME. Not one asserts a prop, a class, or a `data-testid` this change introduced.
 * That is deliberate and it is the whole point: each of these five defects was live in front of a
 * manager while this component's unit tests were green, because those tests asserted the data the
 * component was handed rather than the sentence it put on the screen. A test that can only fail
 * when a new test id is missing proves the test id, not the behaviour.
 *
 * <h3>What was measured, in Chromium, before any of this was changed</h3>
 *
 * Driven 2026-08-12 as `manager@terrace.local` (`.planning/audits/FULL-SHIFT-WALKTHROUGH.md` §3
 * #8–#12, reproduced in `.planning/audits/floor/F2/`):
 *   - ten of ten rows on the first page read "Takeaway" while the server said `type=DINE_IN`,
 *   - every Server/Cashier cell read an eight-character hex fragment (`bc0d9897`) while the SAME
 *     row's Voided column printed "by Shift Cashier 984155",
 *   - VOIDED rows `0167`/`0168`/`0169` still offered Cancel and Continue,
 *   - a 57-character void reason rendered at `scrollWidth 374 / clientWidth 352` under
 *     `white-space: nowrap`, reachable only by hovering a `title`,
 *   - one Items cell said "4 Items" and, underneath it, "3 Items / 4 Qty".
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

const BRANCH_ID = "branch-1";
const CASHIER = "bc0d9897-e0ef-40de-b404-89ce044ab2cb";
const MANAGER = "fefd7187-dbe2-4c12-a532-3c1cc8f3d322";

/** The exact reason string measured as clipped on the live Voided list. */
const LONG_REASON = "shift walkthrough — manager voiding a fired, unpaid check";

function baseRow(over: Record<string, unknown>) {
  return {
    orderId: "d1000001-0000-4000-8000-000000000001",
    orderNo: "ORD-0166",
    tableId: null,
    tableName: null,
    type: "DINE_IN",
    derivedStatus: "IN_PROGRESS",
    cashierId: CASHIER,
    cashierName: "Shift Cashier 984155",
    coverCount: 2,
    totalPaisa: 50000,
    openedAt: new Date().toISOString(),
    settlementStatus: "SENT_TO_KDS",
    paymentStatus: "UNPAID",
    amountPaidPaisa: 0,
    itemQuantity: 1,
    distinctItemCount: 1,
    settlement: null,
    ...over,
  };
}

/** A dine-in check whose table has not been assigned. THE row the product got wrong. */
const dineInNoTable = baseRow({});

/** A dine-in check at a table — the table name must survive the type label being added. */
const dineInAtTable = baseRow({
  orderId: "d1000002-0000-4000-8000-000000000002",
  orderNo: "ORD-0164",
  tableId: "a0000001-0000-4000-8000-000000000001",
  tableName: "H1",
  type: "DINE_IN",
  // 4 units of food across 3 lines of the check — the cell that stated the count twice.
  itemQuantity: 4,
  distinctItemCount: 3,
});

/** A real takeaway. "Takeaway" must still be sayable, or the fix is a different wrong word. */
const takeaway = baseRow({
  orderId: "d1000003-0000-4000-8000-000000000003",
  orderNo: "ORD-0165",
  type: "TAKEAWAY",
  cashierId: MANAGER,
  cashierName: "Terrace Manager",
});

/** The directory was unreachable for this row. The id is the fact and must still be printed. */
const nameless = baseRow({
  orderId: "d1000004-0000-4000-8000-000000000004",
  orderNo: "ORD-0170",
  type: "TAKEAWAY",
  cashierId: CASHIER,
  cashierName: null,
});

/**
 * A DRAFT that was voided. `derivedStatus` stays DRAFT because the food never moved — which is
 * exactly why gating the row actions on it offered "Cancel" and "Continue" on a dead check.
 */
const voidedDraft = baseRow({
  orderId: "d1000005-0000-4000-8000-000000000005",
  orderNo: "ORD-0167",
  type: "DINE_IN",
  derivedStatus: "DRAFT",
  settlementStatus: "VOIDED",
  settlement: {
    reason: LONG_REASON,
    byUserId: MANAGER,
    byName: "Terrace Manager",
    at: new Date().toISOString(),
  },
});

function pagedResponse(rows: unknown[]) {
  return HttpResponse.json({
    data: rows,
    meta: { page: { cursor: "0", nextCursor: null, limit: 20 }, totalCount: rows.length },
    warnings: [],
  });
}

function mockOrders() {
  server.use(
    http.get("*/api/v1/pos/orders", ({ request }) => {
      const url = new URL(request.url);
      const statuses = url.searchParams
        .getAll("status[]")
        .concat(url.searchParams.getAll("status"));
      if (statuses.includes("VOIDED")) return pagedResponse([voidedDraft]);
      if (statuses.length > 0) return pagedResponse([]);
      return pagedResponse([dineInNoTable, dineInAtTable, takeaway, nameless]);
    }),
  );
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

function renderList() {
  mockOrders();
  seedSession({
    sub: MANAGER,
    branchId: BRANCH_ID,
    permissions: ["pos.order.view", "pos.order.view.all"],
  });
  const Wrapper = createWrapper();
  return render(
    <Wrapper>
      <OrderManagement />
    </Wrapper>,
  );
}

/** The row a manager is looking at, found the way they find it: by the order number on it. */
function rowFor(orderNo: string): HTMLElement {
  const label = screen.getByText(orderNo);
  const tr = label.closest("tr");
  if (!tr) throw new Error(`no table row carries ${orderNo}`);
  return tr as HTMLElement;
}

async function showVoided(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Voided" }));
  await waitFor(() => expect(screen.getByText("ORD-0167")).toBeInTheDocument());
}

describe("F2 — the order row tells the truth about the check", () => {
  afterEach(() => clearSession());

  it("a DINE_IN check with no table reads Dine-in, never Takeaway", async () => {
    renderList();
    await waitFor(() => expect(screen.getByText("ORD-0166")).toBeInTheDocument());

    const row = rowFor("ORD-0166");
    expect(row).toHaveTextContent("Dine-in");
    expect(row).not.toHaveTextContent("Takeaway");
  });

  it("a DINE_IN check at a table still shows the table, alongside the type", async () => {
    renderList();
    await waitFor(() => expect(screen.getByText("ORD-0164")).toBeInTheDocument());

    const row = rowFor("ORD-0164");
    expect(row).toHaveTextContent("Dine-in");
    expect(row).toHaveTextContent("H1");
    expect(row).not.toHaveTextContent("Takeaway");
  });

  it("a real TAKEAWAY check still reads Takeaway", async () => {
    renderList();
    await waitFor(() => expect(screen.getByText("ORD-0165")).toBeInTheDocument());

    const row = rowFor("ORD-0165");
    expect(row).toHaveTextContent("Takeaway");
    expect(row).not.toHaveTextContent("Dine-in");
  });

  it("Server/Cashier prints the person's name — the same string the Voided column prints for that actor — and no hex fragment", async () => {
    renderList();
    await waitFor(() => expect(screen.getByText("ORD-0166")).toBeInTheDocument());

    const row = rowFor("ORD-0166");
    expect(row).toHaveTextContent("Shift Cashier 984155");
    // The literal fragment the walkthrough photographed, on the row it was photographed on.
    expect(row).not.toHaveTextContent("bc0d9897");
    expect(rowFor("ORD-0165")).toHaveTextContent("Terrace Manager");
  });

  it("when the directory could not name the cashier, the id is still shown — never a blank", async () => {
    renderList();
    await waitFor(() => expect(screen.getByText("ORD-0170")).toBeInTheDocument());

    // Degrading to the id is the contract. Degrading to a blank would read as "nobody took this
    // check", which is worse than the hex fragment this change removes.
    expect(rowFor("ORD-0170")).toHaveTextContent("bc0d9897");
  });

  it("the Items cell labels its two numbers differently, and never says “1 Items”", async () => {
    renderList();
    await waitFor(() => expect(screen.getByText("ORD-0164")).toBeInTheDocument());

    const many = rowFor("ORD-0164");
    expect(many).toHaveTextContent("4 items");
    expect(many).toHaveTextContent("3 lines");
    // The old cell used the word "Items" for BOTH numbers: "4 Items" then "3 Items / 4 Qty".
    expect(many.textContent).not.toMatch(/Items[\s\S]*Items/);

    const one = rowFor("ORD-0166");
    expect(one).toHaveTextContent("1 item");
    expect(one).not.toHaveTextContent("1 Items");
  });

  it("a VOIDED check offers neither Cancel nor Continue", async () => {
    renderList();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText("ORD-0166")).toBeInTheDocument());
    await showVoided(user);

    const row = rowFor("ORD-0167");
    expect(within(row).queryByRole("button", { name: /^Cancel$/ })).toBeNull();
    expect(within(row).queryByRole("button", { name: /^Continue order/i })).toBeNull();
    // It must still be openable — a voided check is a thing a manager reads, not a thing that
    // disappears.
    expect(within(row).getByRole("button", { name: /^Open order/i })).toBeInTheDocument();
  });

  it("a long void reason can be read in full with a press — not only by hovering a title", async () => {
    renderList();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText("ORD-0166")).toBeInTheDocument());
    await showVoided(user);

    const row = rowFor("ORD-0167");
    // A control, reachable by touch and by keyboard. `title` alone is a hover affordance, and
    // this screen is used on a tablet.
    const trigger = within(row).getByRole("button", { name: /full reason/i });
    await user.click(trigger);

    const revealed = await screen.findByRole("dialog");
    expect(revealed).toHaveTextContent(LONG_REASON);
    expect(revealed).toHaveTextContent("Terrace Manager");
  });

  it("a failed read says the read failed — it never renders “No active orders”", async () => {
    server.use(
      http.get("*/api/v1/pos/orders", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    seedSession({ sub: MANAGER, branchId: BRANCH_ID, permissions: ["pos.order.view"] });
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <OrderManagement />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText("No active orders")).not.toBeInTheDocument();
  });
});
