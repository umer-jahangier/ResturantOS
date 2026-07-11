import { describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { OrderTableDetailDrawer } from "@/components/pos/order-table-detail-drawer";

const ORDER_ID = "d1000001-0000-4000-8000-000000000001";
const BRANCH_ID = "b0000001-0000-4000-8000-000000000001";
const ITEM_1 = "e1000001-0000-4000-8000-000000000001"; // rev 1 — no badge
const ITEM_2 = "e1000002-0000-4000-8000-000000000002"; // rev 2 — REV 2 badge
const MENU_ITEM_FRIES = "f1000001-0000-4000-8000-000000000001";

function rawOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: ORDER_ID,
    branchId: BRANCH_ID,
    orderNo: "ORD-20260711-0001",
    type: "DINE_IN",
    status: "OPEN",
    derivedStatus: "IN_PROGRESS",
    tableId: null,
    coverCount: 2,
    cashierId: "c0000001-0000-4000-8000-000000000001",
    customerId: null,
    subtotalPaisa: 60000,
    taxPaisa: 3000,
    discountPaisa: 0,
    serviceChargePaisa: 0,
    totalPaisa: 63000,
    notes: null,
    openedAt: "2026-07-11T10:00:00Z",
    sentToKdsAt: "2026-07-11T10:01:00Z",
    clientOrderId: "c9000001-0000-4000-8000-000000000001",
    version: 2,
    items: [
      {
        id: ITEM_1,
        menuItemId: "a1000001-0000-4000-8000-000000000001",
        itemNameSnapshot: "Chicken Burger",
        unitPriceSnapshot: 30000,
        quantity: 1,
        kdsStation: "GRILL",
        kdsStatus: "SENT",
        revisionNo: 1,
        firedAt: "2026-07-11T10:01:00Z",
        discountPaisa: 0,
        taxPaisa: 1500,
        lineTotalPaisa: 31500,
        notes: null,
        modifiers: [],
      },
      {
        id: ITEM_2,
        menuItemId: "a1000002-0000-4000-8000-000000000002",
        itemNameSnapshot: "Iced Tea",
        unitPriceSnapshot: 30000,
        quantity: 1,
        kdsStation: "BAR",
        kdsStatus: "READY",
        revisionNo: 2,
        firedAt: "2026-07-11T10:05:00Z",
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
      HttpResponse.json({
        data: [
          {
            id: MENU_ITEM_FRIES,
            categoryId: null,
            name: "Fries",
            description: null,
            basePricePaisa: 15000,
            taxRatePct: "5",
            kdsStation: "FRY",
            active: true,
          },
        ],
        meta: null,
        warnings: [],
      }),
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

describe("OrderTableDetailDrawer", () => {
  afterEach(() => clearSession());

  it("resolves the order by orderId and renders per-item status badges + the revision chip", async () => {
    renderDrawer();

    await waitFor(() => {
      expect(screen.getByText("Chicken Burger")).toBeInTheDocument();
    });
    expect(screen.getByText("Iced Tea")).toBeInTheDocument();

    // Per-item status badges (Status System labels)
    expect(screen.getByLabelText("Sent")).toBeInTheDocument();
    expect(screen.getByLabelText("Ready")).toBeInTheDocument();

    // Rev 1 gets no badge, Rev 2 gets a "REV 2" pill
    expect(screen.queryByLabelText("Revision 1")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Revision 2")).toBeInTheDocument();

    // Order-header revision-count chip (2 fired revisions)
    expect(screen.getByLabelText("2 revisions")).toBeInTheDocument();
  });

  it("renders the shared settlement footer", async () => {
    renderDrawer();

    await waitFor(() => {
      expect(screen.getByTestId("charge-now-button")).toBeInTheDocument();
    });
  });

  it("Quick Add search adds an item to the order", async () => {
    let capturedBody: unknown = null;
    renderDrawer();
    server.use(
      http.post(`*/api/v1/pos/orders/${ORDER_ID}/items`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ data: rawOrder(), meta: null, warnings: [] });
      }),
    );

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByLabelText("Search menu")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Search menu"), "Fri");

    await waitFor(() => {
      expect(screen.getByTestId("quick-add-results")).toBeInTheDocument();
    });
    expect(screen.getByText("Fries")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(capturedBody).toMatchObject({ menuItemId: MENU_ITEM_FRIES, quantity: 1 });
    });
  });

  it("editing instructions calls updateInstructions", async () => {
    let capturedBody: unknown = null;
    renderDrawer({ notes: null });
    server.use(
      http.patch(`*/api/v1/pos/orders/${ORDER_ID}/instructions`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          data: rawOrder({ notes: "Birthday — bring cake last" }),
          meta: null,
          warnings: [],
        });
      }),
    );

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText("+ Add note")).toBeInTheDocument());

    await user.click(screen.getByText("+ Add note"));
    await user.type(screen.getByLabelText("Special instructions"), "Birthday — bring cake last");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(capturedBody).toMatchObject({ notes: "Birthday — bring cake last" });
    });
  });
});
