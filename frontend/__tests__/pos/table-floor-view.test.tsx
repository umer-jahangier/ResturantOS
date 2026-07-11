import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { TableFloorView } from "@/components/pos/table-floor-view";

const BRANCH_ID = "b0000001-0000-4000-8000-000000000001";
const TABLE_AVAILABLE = "11111111-1111-4111-8111-111111111111";
const TABLE_OCCUPIED = "22222222-2222-4222-8222-222222222222";
const TABLE_BUSSING = "33333333-3333-4333-8333-333333333333";
const OCCUPIED_ORDER_ID = "d1000001-0000-4000-8000-000000000001";

function rawTables() {
  return [
    {
      id: TABLE_AVAILABLE,
      branchId: BRANCH_ID,
      tableName: "Table 1",
      capacity: 4,
      status: "AVAILABLE",
      floorPlanX: null,
      floorPlanY: null,
      floorPlanShape: null,
    },
    {
      id: TABLE_OCCUPIED,
      branchId: BRANCH_ID,
      tableName: "Table 2",
      capacity: 2,
      status: "OCCUPIED",
      floorPlanX: null,
      floorPlanY: null,
      floorPlanShape: null,
    },
    {
      id: TABLE_BUSSING,
      branchId: BRANCH_ID,
      tableName: "Table 3",
      capacity: 6,
      status: "NEEDS_BUSSING",
      floorPlanX: null,
      floorPlanY: null,
      floorPlanShape: null,
    },
  ];
}

function rawActiveOrder(order: unknown = null) {
  return {
    id: TABLE_OCCUPIED,
    branchId: BRANCH_ID,
    tableName: "Table 2",
    capacity: 2,
    status: "OCCUPIED",
    floorPlanX: null,
    floorPlanY: null,
    floorPlanShape: null,
    activeOrder: order,
    derivedStatus: "IN_PROGRESS",
    cashierId: null,
    subtotalPaisa: 60000,
    discountPaisa: 0,
    taxPaisa: 3000,
    totalPaisa: 63000,
  };
}

function rawOrder() {
  return {
    id: OCCUPIED_ORDER_ID,
    branchId: BRANCH_ID,
    orderNo: "ORD-20260711-0002",
    type: "DINE_IN",
    status: "OPEN",
    derivedStatus: "IN_PROGRESS",
    tableId: TABLE_OCCUPIED,
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
    version: 1,
    items: [],
  };
}

function renderFloorView(onTableSelect = vi.fn()) {
  server.use(
    http.get("*/api/v1/pos/tables", () =>
      HttpResponse.json({ data: rawTables(), meta: null, warnings: [] }),
    ),
    http.get(`*/api/v1/pos/tables/${TABLE_OCCUPIED}/active-order`, () =>
      HttpResponse.json({ data: rawActiveOrder(rawOrder()), meta: null, warnings: [] }),
    ),
  );

  seedSession({ branchId: BRANCH_ID, permissions: ["pos.order.close"] });
  const Wrapper = createQueryWrapper();
  render(
    <Wrapper>
      <TableFloorView onTableSelect={onTableSelect} />
    </Wrapper>,
  );
  return onTableSelect;
}

describe("TableFloorView", () => {
  afterEach(() => clearSession());

  it("renders the three tile states with semantic-token classes and an icon each", async () => {
    renderFloorView();

    await waitFor(() => expect(screen.getByTestId("table-table-1")).toBeInTheDocument());

    const available = screen.getByTestId("table-table-1");
    expect(available.className).toContain("border-success");
    expect(available.className).toContain("bg-success/10");
    expect(available).toHaveTextContent("Available");

    const occupied = screen.getByTestId("table-table-2");
    expect(occupied.className).toContain("border-info");
    expect(occupied.className).toContain("bg-info/10");
    expect(occupied).toHaveTextContent("Occupied");

    const bussing = screen.getByTestId("table-table-3");
    expect(bussing.className).toContain("border-warning");
    expect(bussing.className).toContain("bg-warning/10");
    expect(bussing).toHaveTextContent("Needs Bussing");

    // No hardcoded Tailwind palette classes remain (migrated to semantic tokens).
    for (const tile of [available, occupied, bussing]) {
      expect(tile.className).not.toMatch(/\b(?:green|orange|blue)-\d{2,3}\b/);
    }

    // OCCUPIED tile shows a derived-order-status badge beneath the label (at-a-glance
    // kitchen progress, UI-SPEC §2 / POS-15).
    await waitFor(() => {
      expect(screen.getByLabelText("In Progress")).toBeInTheDocument();
    });
  });

  it("tapping an AVAILABLE table calls onTableSelect (binds tableId + switches to Terminal)", async () => {
    const onTableSelect = renderFloorView();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByTestId("table-table-1")).toBeInTheDocument());
    await user.click(screen.getByTestId("table-table-1"));

    expect(onTableSelect).toHaveBeenCalledTimes(1);
    expect(onTableSelect).toHaveBeenCalledWith(expect.objectContaining({ id: TABLE_AVAILABLE, status: "AVAILABLE" }));
  });

  it("tapping an OCCUPIED table opens the shared Order/Table Detail drawer (not onTableSelect)", async () => {
    const onTableSelect = renderFloorView();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByTestId("table-table-2")).toBeInTheDocument());
    await user.click(screen.getByTestId("table-table-2"));

    expect(screen.getByTestId("order-table-detail-drawer")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Order #ORD-20260711-0002" })).toBeInTheDocument();
    });
    expect(onTableSelect).not.toHaveBeenCalled();
  });

  it("shows the empty state when no tables are configured", async () => {
    server.use(
      http.get("*/api/v1/pos/tables", () => HttpResponse.json({ data: [], meta: null, warnings: [] })),
    );
    seedSession({ branchId: BRANCH_ID, permissions: ["pos.order.close"] });
    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <TableFloorView />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText("No tables configured")).toBeInTheDocument());
  });
});
