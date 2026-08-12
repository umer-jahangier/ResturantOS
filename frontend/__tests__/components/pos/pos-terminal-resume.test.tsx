import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { PosTerminal } from "@/components/pos/pos-terminal";
import { OrderTableDetailDrawer } from "@/components/pos/order-table-detail-drawer";

/**
 * S0-09 — "Full Menu →" from a parked order must RESUME that order, never abandon it.
 *
 * The register's observed failure: clicking "Full Menu →" on the drawer for a parked
 * order landed on a terminal with no order number and an empty cart. The seam is the
 * handoff itself — `onFullMenu` carried only a `tableId` and `PosTerminal` had no way
 * to be told "this order already exists on the server".
 *
 * Two things have to hold for a cashier to actually finish the bill:
 *   1. the terminal opens ON that order (number, existing lines, running total), and
 *   2. a subsequent menu tap APPENDS to that same order server-side — because the
 *      terminal's local cart is not even rendered once an order is bound, so an
 *      unappended tap is silently swallowed and the guest gets a second check.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

const ORDER_ID = "d3000001-0000-4000-8000-000000000001";
const BRANCH_ID = "b3000001-0000-4000-8000-000000000001";
const TABLE_ID = "70000001-0000-4000-8000-000000000001";
const ORDER_NO = "ORD-20260812-0019";

const MENU_ITEM_THIRD = "a3000003-0000-4000-8000-000000000003";

/** Two already-rung lines: 400.00 + 250.00 + tax 32.50 = Rs 682.50 running total. */
function parkedOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    branchId: BRANCH_ID,
    orderNo: ORDER_NO,
    type: "DINE_IN",
    status: "OPEN",
    derivedStatus: "IN_PROGRESS",
    tableId: TABLE_ID,
    coverCount: 2,
    cashierId: "c3000001-0000-4000-8000-000000000001",
    customerId: null,
    subtotalPaisa: 65000,
    taxPaisa: 3250,
    discountPaisa: 0,
    serviceChargePaisa: 0,
    serviceChargePct: 0,
    serviceChargeLabel: null,
    totalPaisa: 68250,
    notes: null,
    openedAt: "2026-08-12T10:00:00Z",
    sentToKdsAt: "2026-08-12T10:01:00Z",
    clientOrderId: "c9000003-0000-4000-8000-000000000003",
    version: 3,
    items: [
      {
        id: "e3000001-0000-4000-8000-000000000001",
        menuItemId: "a3000001-0000-4000-8000-000000000001",
        itemNameSnapshot: "Mutton Karahi",
        unitPriceSnapshot: 40000,
        quantity: 1,
        kdsStation: "GRILL",
        kdsStatus: "SENT",
        revisionNo: 1,
        firedAt: "2026-08-12T10:01:00Z",
        discountPaisa: 0,
        taxPaisa: 2000,
        lineTotalPaisa: 42000,
        notes: null,
        modifiers: [],
      },
      {
        id: "e3000002-0000-4000-8000-000000000002",
        menuItemId: "a3000002-0000-4000-8000-000000000002",
        itemNameSnapshot: "Garlic Naan",
        unitPriceSnapshot: 25000,
        quantity: 1,
        kdsStation: "TANDOOR",
        kdsStatus: "SENT",
        revisionNo: 1,
        firedAt: "2026-08-12T10:01:00Z",
        discountPaisa: 0,
        taxPaisa: 1250,
        lineTotalPaisa: 26250,
        notes: null,
        modifiers: [],
      },
    ],
    ...overrides,
  };
}

const MENU_ITEMS = [
  {
    id: MENU_ITEM_THIRD,
    branchId: BRANCH_ID,
    categoryId: "f3000001-0000-4000-8000-000000000001",
    name: "Kheer",
    description: null,
    basePricePaisa: 15000,
    taxRatePct: "5.00",
    imageUrl: null,
    active: true,
    kdsStation: "DESSERT",
    displayOrder: 1,
  },
];

/**
 * The server's copy of the order. A STATEFUL fake on purpose: `useAddItem` invalidates
 * the order query, so a GET handler pinned to the two-line snapshot would refetch the
 * appended line straight back out again and the test would fail for a reason that has
 * nothing to do with the product.
 */
let serverOrder: Record<string, unknown> = parkedOrder();

function seedPosApi() {
  serverOrder = parkedOrder();
  server.use(
    http.get(`*/api/v1/pos/orders/${ORDER_ID}`, () =>
      HttpResponse.json({ data: serverOrder, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/menu/items", () =>
      HttpResponse.json({ data: MENU_ITEMS, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/menu/categories", () =>
      HttpResponse.json({ data: [], meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/tables", () =>
      HttpResponse.json({ data: [], meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/crm/customers", () =>
      HttpResponse.json({ data: [], meta: null, warnings: [] }),
    ),
  );
}

describe("S0-09: resuming a parked order from Full Menu", () => {
  afterEach(() => clearSession());

  it("opens the terminal ON the parked order — same order number, both lines, correct total", async () => {
    seedPosApi();
    seedSession({ branchId: BRANCH_ID, permissions: ["pos.order.update", "pos.order.close"] });
    const Wrapper = createQueryWrapper();

    render(
      <Wrapper>
        <PosTerminal orderId={ORDER_ID} tableId={TABLE_ID} />
      </Wrapper>,
    );

    // The order number the cashier quoted the guest.
    await waitFor(() => expect(screen.getByText(ORDER_NO)).toBeInTheDocument());

    // Both existing lines are on screen — not a blank cart.
    expect(screen.getByText("Mutton Karahi")).toBeInTheDocument();
    expect(screen.getByText("Garlic Naan")).toBeInTheDocument();

    // The running total is the ORDER's total, to the paisa.
    expect(screen.getByText("Rs 682.50")).toBeInTheDocument();

    // And the "nothing here yet" cart empty state must NOT be what the cashier sees.
    expect(screen.queryByText("Add items to start an order")).not.toBeInTheDocument();
  });

  it("appends a menu tap to that SAME order instead of dropping it into an unrendered cart", async () => {
    seedPosApi();
    const addItemBodies: unknown[] = [];
    let createOrderCalls = 0;
    server.use(
      http.post("*/api/v1/pos/orders", async () => {
        createOrderCalls += 1;
        return HttpResponse.json({ data: parkedOrder(), meta: null, warnings: [] });
      }),
      http.post(`*/api/v1/pos/orders/${ORDER_ID}/items`, async ({ request }) => {
        addItemBodies.push(await request.json());
        const withThird = parkedOrder({
          items: [
            ...parkedOrder().items,
            {
              id: "e3000003-0000-4000-8000-000000000003",
              menuItemId: MENU_ITEM_THIRD,
              itemNameSnapshot: "Kheer",
              unitPriceSnapshot: 15000,
              quantity: 1,
              kdsStation: "DESSERT",
              kdsStatus: "PENDING",
              revisionNo: 0,
              firedAt: null,
              discountPaisa: 0,
              taxPaisa: 750,
              lineTotalPaisa: 15750,
              notes: null,
              modifiers: [],
            },
          ],
          subtotalPaisa: 80000,
          taxPaisa: 4000,
          totalPaisa: 84000,
        });
        serverOrder = withThird;
        return HttpResponse.json({ data: withThird, meta: null, warnings: [] });
      }),
    );

    seedSession({ branchId: BRANCH_ID, permissions: ["pos.order.update", "pos.order.close"] });
    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <PosTerminal orderId={ORDER_ID} tableId={TABLE_ID} />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText(ORDER_NO)).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("menu-item-first"));

    // The tap reached the server, bound to the RESUMED order id.
    await waitFor(() => expect(addItemBodies).toHaveLength(1));
    expect(addItemBodies[0]).toMatchObject({ menuItemId: MENU_ITEM_THIRD, quantity: 1 });

    // No second order number was ever issued for this party.
    expect(createOrderCalls).toBe(0);

    // The new line landed on the resumed order — the panel now totals all three lines,
    // and offers to fire ONLY the new one as the next revision.
    expect(await screen.findByText("Send New Items (1)")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Rs 840.00")).toBeInTheDocument());
    // Still the same check: one order number, never a second.
    expect(screen.getByText(ORDER_NO)).toBeInTheDocument();
  });

  it('the drawer hands the ORDER (not just a tableId) to "Full Menu →"', async () => {
    seedPosApi();
    seedSession({ branchId: BRANCH_ID, permissions: ["pos.order.close"] });
    const onFullMenu = vi.fn();
    const Wrapper = createQueryWrapper();

    render(
      <Wrapper>
        <OrderTableDetailDrawer
          open
          onOpenChange={() => {}}
          orderId={ORDER_ID}
          onFullMenu={onFullMenu}
        />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText(/Full Menu/)).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Full Menu/ }));

    expect(onFullMenu).toHaveBeenCalledWith({ orderId: ORDER_ID, tableId: TABLE_ID });
  });
});
