import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { OrderTableDetailDrawer } from "@/components/pos/order-table-detail-drawer";

// The drawer footer renders SettlementActions, which navigates (useRouter) instead of
// opening a Dialog since 07.3-07 — no real Next router is mounted in these unit tests.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

// order-detail-fire.test.tsx — TDD proof for the "Send New Items (N)" revision CTA +
// panelized detail surface (POS-21/D-06, POS-25/D-10).

const ORDER_ID = "d2000001-0000-4000-8000-000000000001";
const BRANCH_ID = "b0000001-0000-4000-8000-000000000001";
const TABLE_ID = "70000001-0000-4000-8000-000000000001";
const ITEM_FIRED = "e2000001-0000-4000-8000-000000000001"; // rev 1, already fired
const ITEM_PENDING_1 = "e2000002-0000-4000-8000-000000000002"; // rev 0 — unfired
const ITEM_PENDING_2 = "e2000003-0000-4000-8000-000000000003"; // rev 0 — unfired

function rawOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: ORDER_ID,
    branchId: BRANCH_ID,
    orderNo: "ORD-20260712-0001",
    type: "DINE_IN",
    status: "OPEN",
    derivedStatus: "IN_PROGRESS",
    tableId: TABLE_ID,
    coverCount: 2,
    cashierId: "c0000001-0000-4000-8000-000000000001",
    customerId: null,
    subtotalPaisa: 90000,
    taxPaisa: 4500,
    discountPaisa: 0,
    serviceChargePaisa: 0,
    totalPaisa: 94500,
    notes: null,
    openedAt: "2026-07-12T10:00:00Z",
    sentToKdsAt: "2026-07-12T10:01:00Z",
    clientOrderId: "c9000002-0000-4000-8000-000000000002",
    version: 2,
    items: [
      {
        id: ITEM_FIRED,
        menuItemId: "a2000001-0000-4000-8000-000000000001",
        itemNameSnapshot: "Chicken Burger",
        unitPriceSnapshot: 30000,
        quantity: 1,
        kdsStation: "GRILL",
        kdsStatus: "SENT",
        revisionNo: 1,
        firedAt: "2026-07-12T10:01:00Z",
        discountPaisa: 0,
        taxPaisa: 1500,
        lineTotalPaisa: 31500,
        notes: null,
        modifiers: [],
      },
      {
        id: ITEM_PENDING_1,
        menuItemId: "a2000002-0000-4000-8000-000000000002",
        itemNameSnapshot: "Fries",
        unitPriceSnapshot: 15000,
        quantity: 1,
        kdsStation: "FRY",
        kdsStatus: "PENDING",
        revisionNo: 0,
        firedAt: null,
        discountPaisa: 0,
        taxPaisa: 750,
        lineTotalPaisa: 15750,
        notes: null,
        modifiers: [],
      },
      {
        id: ITEM_PENDING_2,
        menuItemId: "a2000003-0000-4000-8000-000000000003",
        itemNameSnapshot: "Iced Tea",
        unitPriceSnapshot: 30000,
        quantity: 1,
        kdsStation: "BAR",
        kdsStatus: "PENDING",
        revisionNo: 0,
        firedAt: null,
        discountPaisa: 0,
        taxPaisa: 1500,
        lineTotalPaisa: 31500,
        notes: null,
        modifiers: [],
      },
    ],
    ...overrides,
  };
}

function renderDrawer(orderOverrides: Partial<Record<string, unknown>> = {}) {
  server.use(
    http.get(`*/api/v1/pos/orders/${ORDER_ID}`, () =>
      HttpResponse.json({ data: rawOrder(orderOverrides), meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/menu/items", () =>
      HttpResponse.json({ data: [], meta: null, warnings: [] }),
    ),
  );

  seedSession({ permissions: ["pos.order.close"] });
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <OrderTableDetailDrawer open onOpenChange={() => {}} orderId={ORDER_ID} />
    </Wrapper>,
  );
}

describe("order-detail-fire (Send New Items CTA + panelized surface)", () => {
  afterEach(() => clearSession());

  it('shows "Send New Items (2)" for an order with 2 PENDING lines and fires only those on click', async () => {
    let fireCalled = false;
    renderDrawer();
    server.use(
      http.post(`*/api/v1/pos/orders/${ORDER_ID}/send-to-kds`, () => {
        fireCalled = true;
        return HttpResponse.json({
          data: rawOrder({
            items: rawOrder().items.map((item) =>
              (item as { id: string }).id === ITEM_FIRED
                ? item
                : { ...item, revisionNo: 2, kdsStatus: "SENT", firedAt: "2026-07-12T10:10:00Z" },
            ),
          }),
          meta: null,
          warnings: [],
        });
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("send-new-items-button")).toBeInTheDocument();
    });
    expect(screen.getByText("Send New Items (2)")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByTestId("send-new-items-button"));

    await waitFor(() => {
      expect(fireCalled).toBe(true);
    });
  });

  it("hides the CTA when there are 0 PENDING lines", async () => {
    renderDrawer({
      items: rawOrder().items.map((item) => ({ ...item, revisionNo: 1, kdsStatus: "SENT" })),
    });

    await waitFor(() => {
      expect(screen.getByText("Chicken Burger")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("send-new-items-button")).not.toBeInTheDocument();
  });

  it("renders no sm:max-w-md dialog class anywhere in the surface", async () => {
    const { container } = renderDrawer();

    await waitFor(() => {
      expect(screen.getByTestId("order-table-detail-drawer")).toBeInTheDocument();
    });
    expect(container.querySelector('[class*="sm:max-w-md"]')).toBeNull();
  });

  it("resolves an order in tableId mode too (both modes reach the same surface)", async () => {
    server.use(
      http.get(`*/api/v1/pos/tables/${TABLE_ID}/active-order`, () =>
        HttpResponse.json({
          data: {
            id: TABLE_ID,
            branchId: BRANCH_ID,
            tableName: "T4",
            capacity: 4,
            status: "OCCUPIED",
            floorPlanX: null,
            floorPlanY: null,
            floorPlanShape: null,
            activeOrder: rawOrder(),
            derivedStatus: "IN_PROGRESS",
            cashierId: null,
            subtotalPaisa: 90000,
            discountPaisa: 0,
            taxPaisa: 4500,
            totalPaisa: 94500,
          },
          meta: null,
          warnings: [],
        }),
      ),
      http.get("*/api/v1/pos/menu/items", () =>
        HttpResponse.json({ data: [], meta: null, warnings: [] }),
      ),
    );
    seedSession({ permissions: ["pos.order.close"] });
    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <OrderTableDetailDrawer open onOpenChange={() => {}} tableId={TABLE_ID} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("send-new-items-button")).toBeInTheDocument();
    });
    expect(screen.getByText("Send New Items (2)")).toBeInTheDocument();
  });
});
