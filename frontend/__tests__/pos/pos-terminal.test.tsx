import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { PosTerminal } from "@/components/pos/pos-terminal";

// OrderPanel's footer renders SettlementActions, which navigates (useRouter) instead of
// opening a Dialog since 07.3-07 — no real Next router is mounted in these unit tests.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

// Phase 07.3-03 (D-01/POS-16): the terminal now holds a client-only cart — NOTHING
// persists to pos-service until the cashier hits Send to Kitchen. These tests replace
// the pre-07.3 "creates a DRAFT order on first tap" suite, which tested behavior this
// plan deliberately removes.

const BRANCH_ID = "b1000001-0000-4000-8000-000000000001";
const CATEGORY_ID = "c1000001-0000-4000-8000-000000000001";

const rawCategories = [
  { id: CATEGORY_ID, name: "Mains", description: null, sortOrder: 1, active: true },
];

const menuItemFixture = (id: string, name: string, priceP: number) => ({
  id,
  categoryId: CATEGORY_ID,
  name,
  description: null,
  basePricePaisa: priceP,
  taxRatePct: "5",
  kdsStation: "GRILL",
  active: true,
});

const rawItems = [
  menuItemFixture("a1000001-0000-4000-8000-000000000001", "Cheeseburger", 45000),
  menuItemFixture("a1000001-0000-4000-8000-000000000002", "Chicken Wings", 35000),
  menuItemFixture("a1000001-0000-4000-8000-000000000003", "Iced Tea", 15000),
  menuItemFixture("a1000001-0000-4000-8000-000000000004", "Fries", 20000),
  menuItemFixture("a1000001-0000-4000-8000-000000000005", "Cheesecake", 25000),
];

const rawTables = [
  {
    id: "f1000001-0000-4000-8000-000000000001",
    branchId: BRANCH_ID,
    tableName: "T1",
    capacity: 4,
    status: "AVAILABLE",
    floorPlanX: null,
    floorPlanY: null,
    floorPlanShape: null,
  },
  {
    id: "f1000001-0000-4000-8000-000000000002",
    branchId: BRANCH_ID,
    tableName: "T2",
    capacity: 2,
    status: "OCCUPIED",
    floorPlanX: null,
    floorPlanY: null,
    floorPlanShape: null,
  },
];

interface FakeOrderItem {
  id: string;
  menuItemId: string;
  itemNameSnapshot: string;
  unitPriceSnapshot: number;
  quantity: number;
  kdsStation: string | null;
  kdsStatus: string;
  revisionNo: number;
  firedAt: string | null;
  discountPaisa: number;
  taxPaisa: number;
  lineTotalPaisa: number;
  notes: string | null;
  modifiers: unknown[];
}

interface FakeOrder {
  id: string;
  branchId: string;
  orderNo: string | null;
  type: string;
  status: string;
  derivedStatus: string;
  tableId: string | null;
  coverCount: number;
  cashierId: string | null;
  customerId: string | null;
  subtotalPaisa: number;
  taxPaisa: number;
  discountPaisa: number;
  serviceChargePaisa: number;
  totalPaisa: number;
  notes: string | null;
  openedAt: string | null;
  sentToKdsAt: string | null;
  clientOrderId: string;
  version: number;
  items: FakeOrderItem[];
}

let orderStore: Map<string, FakeOrder>;
let orderSeq: number;
let createOrderCallCount: number;
let createOrderRequestBodies: Array<Record<string, unknown>>;
let sendToKdsCallCount: number;

function resetFakeBackend() {
  orderStore = new Map();
  orderSeq = 0;
  createOrderCallCount = 0;
  createOrderRequestBodies = [];
  sendToKdsCallCount = 0;
}

function nextOrderId(): string {
  orderSeq += 1;
  return `d1000001-0000-4000-8000-${String(orderSeq).padStart(12, "0")}`;
}

function nextItemId(order: FakeOrder): string {
  return `e1000001-0000-4000-8000-${String(order.items.length + 1).padStart(12, "0")}`;
}

function mockPosEndpoints() {
  server.use(
    http.get("*/api/v1/pos/menu/categories", () =>
      HttpResponse.json({ data: rawCategories, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/menu/items", () =>
      HttpResponse.json({ data: rawItems, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/tables", () =>
      HttpResponse.json({ data: rawTables, meta: null, warnings: [] }),
    ),
    http.post("*/api/v1/pos/orders", async ({ request }) => {
      createOrderCallCount += 1;
      const body = (await request.json()) as Record<string, unknown>;
      createOrderRequestBodies.push(body);

      const id = nextOrderId();
      const order: FakeOrder = {
        id,
        branchId: BRANCH_ID,
        orderNo: null,
        type: (body.type as string) ?? "DINE_IN",
        status: "DRAFT",
        derivedStatus: "DRAFT",
        tableId: (body.tableId as string) ?? null,
        coverCount: (body.coverCount as number) ?? 1,
        cashierId: null,
        customerId: null,
        subtotalPaisa: 0,
        taxPaisa: 0,
        discountPaisa: 0,
        serviceChargePaisa: 0,
        totalPaisa: 0,
        notes: null,
        openedAt: null,
        sentToKdsAt: null,
        clientOrderId: (body.clientOrderId as string) ?? id,
        version: 0,
        items: [],
      };
      orderStore.set(id, order);
      return HttpResponse.json({ data: order, meta: null, warnings: [] });
    }),
    http.get("*/api/v1/pos/orders/:id", ({ params }) => {
      const order = orderStore.get(params.id as string);
      if (!order) {
        return HttpResponse.json({ error: "not found" }, { status: 404 });
      }
      return HttpResponse.json({ data: order, meta: null, warnings: [] });
    }),
    http.post("*/api/v1/pos/orders/:id/items", async ({ params, request }) => {
      const order = orderStore.get(params.id as string);
      if (!order) {
        return HttpResponse.json({ error: "not found" }, { status: 404 });
      }
      const body = (await request.json()) as { menuItemId: string; quantity: number };
      const menuItem = rawItems.find((i) => i.id === body.menuItemId);
      const item: FakeOrderItem = {
        id: nextItemId(order),
        menuItemId: body.menuItemId,
        itemNameSnapshot: menuItem?.name ?? "Unknown",
        unitPriceSnapshot: menuItem?.basePricePaisa ?? 0,
        quantity: body.quantity,
        kdsStation: menuItem?.kdsStation ?? null,
        kdsStatus: "PENDING",
        revisionNo: 0,
        firedAt: null,
        discountPaisa: 0,
        taxPaisa: 0,
        lineTotalPaisa: (menuItem?.basePricePaisa ?? 0) * body.quantity,
        notes: null,
        modifiers: [],
      };
      order.items.push(item);
      order.status = "OPEN";
      order.subtotalPaisa = order.items.reduce((sum, i) => sum + i.lineTotalPaisa, 0);
      order.totalPaisa = order.subtotalPaisa;
      return HttpResponse.json({ data: order, meta: null, warnings: [] });
    }),
    http.post("*/api/v1/pos/orders/:id/send-to-kds", ({ params }) => {
      sendToKdsCallCount += 1;
      const order = orderStore.get(params.id as string);
      if (!order) {
        return HttpResponse.json({ error: "not found" }, { status: 404 });
      }
      order.status = "SENT_TO_KDS";
      order.items = order.items.map((i) => ({ ...i, kdsStatus: "SENT", revisionNo: 1 }));
      return HttpResponse.json({ data: order, meta: null, warnings: [] });
    }),
  );
}

function soleOrder(): FakeOrder {
  const orders = Array.from(orderStore.values());
  const order = orders[0];
  if (!order) throw new Error("expected exactly one order in the fake backend store");
  return order;
}

function renderTerminal(tableId?: string | null) {
  // pos.order.close required for SettlementActions' post-send "CHARGE NOW" button
  // (PermissionGuard) to render at all.
  seedSession({ branchId: "branch-1", permissions: ["pos.order.close", "pos.order.void.own"] });
  resetFakeBackend();
  mockPosEndpoints();
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <PosTerminal tableId={tableId} />
    </Wrapper>,
  );
}

describe("PosTerminal", () => {
  afterEach(() => clearSession());

  it("tapping a menu item builds a local cart with NO network call (no DRAFT order)", async () => {
    renderTerminal();
    const user = userEvent.setup();

    const firstItemButton = await screen.findByTestId("menu-item-first");
    await user.click(firstItemButton);

    // Cart line renders in the order panel (item name appears twice: menu card + cart line).
    await waitFor(() => {
      expect(screen.getAllByText("Cheeseburger").length).toBeGreaterThanOrEqual(2);
    });
    expect(createOrderCallCount).toBe(0);
    expect(orderStore.size).toBe(0);
  });

  it("repeated taps of the same item merge into one line with quantity 2", async () => {
    renderTerminal();
    const user = userEvent.setup();

    const menuGrid = within(await screen.findByTestId("menu-grid"));
    const burgerButton = menuGrid.getByText("Cheeseburger").closest("button") as HTMLElement;
    await user.click(burgerButton);
    await user.click(burgerButton);

    // A single cart line shows qty 2, not two separate lines.
    await waitFor(() => {
      expect(screen.getByText("2")).toBeInTheDocument();
    });
    expect(createOrderCallCount).toBe(0);
  });

  it("Send to Kitchen persists the cart (createOrder + addItem* + send-to-kds) in one click", async () => {
    renderTerminal();
    const user = userEvent.setup();

    const firstItemButton = await screen.findByTestId("menu-item-first");
    await user.click(firstItemButton);

    const sendButton = await screen.findByTestId("send-to-kitchen-button");
    expect(sendButton).toBeEnabled();
    await user.click(sendButton);

    await waitFor(() => {
      expect(orderStore.size).toBe(1);
    });
    expect(createOrderCallCount).toBe(1);
    expect(soleOrder().items).toHaveLength(1);
    await waitFor(() => {
      expect(sendToKdsCallCount).toBe(1);
    });

    // Post-send: Charge Now / Clear-New-Order render from the real persisted order.
    await waitFor(() => {
      expect(screen.getByTestId("charge-now-button")).toBeEnabled();
    });
    expect(screen.getByTestId("clear-new-order-button")).toBeInTheDocument();
  });

  it("Charge Now is disabled until the order has been sent", async () => {
    renderTerminal();
    const user = userEvent.setup();

    const firstItemButton = await screen.findByTestId("menu-item-first");
    await user.click(firstItemButton);

    expect(screen.getByTestId("charge-now-button")).toBeDisabled();
    expect(createOrderCallCount).toBe(0);

    await user.click(screen.getByTestId("send-to-kitchen-button"));
    await waitFor(() => {
      expect(screen.getByTestId("charge-now-button")).toBeEnabled();
    });
  });

  it("binds the selected table into createOrder only once Send to Kitchen is clicked", async () => {
    const TABLE_ID = "f1000001-0000-4000-8000-000000000001";
    renderTerminal(TABLE_ID);
    const user = userEvent.setup();

    const firstItemButton = await screen.findByTestId("menu-item-first");
    await user.click(firstItemButton);
    expect(createOrderCallCount).toBe(0);

    await user.click(await screen.findByTestId("send-to-kitchen-button"));

    await waitFor(() => {
      expect(createOrderCallCount).toBe(1);
    });
    expect(createOrderRequestBodies[0]?.tableId).toBe(TABLE_ID);
    expect(soleOrder().tableId).toBe(TABLE_ID);
  });

  it("does not send a tableId when no table is selected", async () => {
    renderTerminal(null);
    const user = userEvent.setup();

    const firstItemButton = await screen.findByTestId("menu-item-first");
    await user.click(firstItemButton);
    await user.click(await screen.findByTestId("send-to-kitchen-button"));

    await waitFor(() => {
      expect(createOrderCallCount).toBe(1);
    });
    expect(createOrderRequestBodies[0]?.tableId).toBeUndefined();
  });

  it("rapid sequential taps before Send all land in the local cart, never split into duplicate orders", async () => {
    renderTerminal();
    const user = userEvent.setup();

    const menuGrid = within(await screen.findByTestId("menu-grid"));
    await screen.findByText("Cheeseburger");

    const names = ["Cheeseburger", "Chicken Wings", "Iced Tea"];
    for (const name of names) {
      const button = menuGrid.getByText(name).closest("button");
      expect(button).not.toBeNull();
      await user.click(button as HTMLElement);
    }

    expect(createOrderCallCount).toBe(0);
    expect(orderStore.size).toBe(0);

    await user.click(await screen.findByTestId("send-to-kitchen-button"));

    await waitFor(() => {
      expect(orderStore.size).toBe(1);
    });
    expect(createOrderCallCount).toBe(1);
    expect(soleOrder().items).toHaveLength(3);
  });

  it("does not double-fire createOrder on a fast double-click of Send to Kitchen (fireEvent, no await between)", async () => {
    renderTerminal();
    const user = userEvent.setup();

    const firstItemButton = await screen.findByTestId("menu-item-first");
    await user.click(firstItemButton);

    const sendButton = await screen.findByTestId("send-to-kitchen-button");
    fireEvent.click(sendButton);
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(orderStore.size).toBe(1);
    });
    // Second click landed after the button was already disabled (isPersisting) or
    // after orderId was already set — either way, at most one order is created.
    expect(createOrderCallCount).toBe(1);
  });
});
