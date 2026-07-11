import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { PosTerminal } from "@/components/pos/pos-terminal";

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

function resetFakeBackend() {
  orderStore = new Map();
  orderSeq = 0;
  createOrderCallCount = 0;
  createOrderRequestBodies = [];
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
  );
}

function soleOrder(): FakeOrder {
  const orders = Array.from(orderStore.values());
  const order = orders[0];
  if (!order) throw new Error("expected exactly one order in the fake backend store");
  return order;
}

function renderTerminal(tableId?: string | null) {
  seedSession({ branchId: "branch-1" });
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

  it("adds the very first tapped item on the first click (no dropped item, no empty DRAFT)", async () => {
    renderTerminal();
    const user = userEvent.setup();

    const firstItemButton = await screen.findByTestId("menu-item-first");
    await user.click(firstItemButton);

    // The order panel must show exactly 1 item after a single click — not zero
    // (the already-fixed stale-closure regression this test guards against). Assert
    // on the fake-backend state (unambiguous) rather than DOM text, since "Cheeseburger"
    // now legitimately renders twice (menu grid card + order panel line item).
    await waitFor(() => {
      expect(orderStore.size).toBe(1);
    });
    expect(createOrderCallCount).toBe(1);
    expect(soleOrder().items).toHaveLength(1);
    // Also confirm the order panel actually reflects the added item in the DOM.
    await waitFor(() => {
      expect(screen.getAllByText("Cheeseburger").length).toBeGreaterThanOrEqual(2);
    });
  });

  it("adding several items past the previous cap all register on the same order", async () => {
    renderTerminal();
    const user = userEvent.setup();

    const menuGrid = within(await screen.findByTestId("menu-grid"));
    await screen.findByText("Cheeseburger");

    // Sequential taps (awaited) across all 5 seeded items, then loop back for 3 more —
    // 8 total adds, comfortably past any small hardcoded cap. Scoped to the menu grid
    // (not `screen`) because once items are added, the SAME item name also renders in
    // the order panel — an unscoped query would then match more than one element.
    const names = [
      "Cheeseburger",
      "Chicken Wings",
      "Iced Tea",
      "Fries",
      "Cheesecake",
      "Cheeseburger",
      "Chicken Wings",
      "Iced Tea",
    ];
    for (const name of names) {
      const button = menuGrid.getByText(name).closest("button");
      expect(button).not.toBeNull();
      // eslint-disable-next-line no-await-in-loop -- sequential taps by design
      await user.click(button as HTMLElement);
    }

    await waitFor(() => {
      expect(soleOrder().items).toHaveLength(8);
    });
    // All 8 items landed on exactly one order — never split into duplicate orders.
    expect(createOrderCallCount).toBe(1);
    expect(orderStore.size).toBe(1);
  });

  it("rapid concurrent taps before order-creation resolves do not split items across duplicate orders", async () => {
    renderTerminal();
    const user = userEvent.setup();

    const menuGrid = within(await screen.findByTestId("menu-grid"));
    await screen.findByText("Cheeseburger");

    const burger = menuGrid.getByText("Cheeseburger").closest("button") as HTMLElement;
    const wings = menuGrid.getByText("Chicken Wings").closest("button") as HTMLElement;
    const tea = menuGrid.getByText("Iced Tea").closest("button") as HTMLElement;

    // Fire three taps back-to-back in the SAME tick (no await between them) — this is
    // the exact race the fix targets: all three happen before the first createOrder
    // round-trip has resolved.
    fireEvent.click(burger);
    fireEvent.click(wings);
    fireEvent.click(tea);

    await waitFor(() => {
      const orders = Array.from(orderStore.values());
      const totalItems = orders.reduce((sum, o) => sum + o.items.length, 0);
      expect(totalItems).toBe(3);
    });

    // The critical assertion: exactly ONE order was created, not three — proves the
    // in-flight order-creation dedup prevents the orphaned-order race.
    expect(createOrderCallCount).toBe(1);
    expect(orderStore.size).toBe(1);
    expect(soleOrder().items).toHaveLength(3);
  });

  it("binds the page-level selectedTableId into createOrder so the order links to the table", async () => {
    const TABLE_ID = "f1000001-0000-4000-8000-000000000001";
    renderTerminal(TABLE_ID);
    const user = userEvent.setup();

    const firstItemButton = await screen.findByTestId("menu-item-first");
    await user.click(firstItemButton);

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

    await waitFor(() => {
      expect(createOrderCallCount).toBe(1);
    });
    expect(createOrderRequestBodies[0]?.tableId).toBeUndefined();
  });
});
