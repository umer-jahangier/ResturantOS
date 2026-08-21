import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { PosTerminal } from "@/components/pos/pos-terminal";

/*
 * GAP REGISTER S0 #6 — "Send to Kitchen fails silently".
 *
 * Two seams, both of which used to fail with NOTHING on screen:
 *
 *   A. POST /pos/orders 503                 — nothing persisted.
 *   B. POST /orders/{id}/send-to-kds 503    — the check exists on the server, unfired,
 *                                             and the cart had ALREADY been emptied
 *                                             (setCart ran before the fire was awaited).
 *
 * The old `handleSendToKitchen` was `try/finally` with no `catch`, so the rejection
 * escaped as an unhandled promise. Every assertion below is written against what a
 * cashier can SEE, not against a mutation's internal state.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

const BRANCH_ID = "b1000001-0000-4000-8000-000000000001";
const CATEGORY_ID = "c1000001-0000-4000-8000-000000000001";
const ORDER_NO = "ORD-20260812-0042";

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
];

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
  items: Array<Record<string, unknown>>;
}

let orderStore: Map<string, FakeOrder>;
/** clientOrderId -> orderId. pos-service dedupes creates on it; the fake must too. */
let ordersByClientId: Map<string, string>;
let createOrderCallCount: number;
let addItemCallCount: number;
let sendToKdsCallCount: number;
/** Flip these to make the corresponding endpoint answer 503. */
let failCreate: boolean;
let failSendToKds: boolean;

function resetFakeBackend() {
  orderStore = new Map();
  ordersByClientId = new Map();
  createOrderCallCount = 0;
  addItemCallCount = 0;
  sendToKdsCallCount = 0;
  failCreate = false;
  failSendToKds = false;
}

const UNAVAILABLE = () =>
  HttpResponse.json(
    { code: "SERVICE_UNAVAILABLE", message: "pos-service is unavailable" },
    { status: 503 },
  );

function mockPosEndpoints() {
  server.use(
    http.get("*/api/v1/pos/menu/categories", () =>
      HttpResponse.json({ data: rawCategories, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/menu/items", () =>
      HttpResponse.json({ data: rawItems, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/tables", () =>
      HttpResponse.json({ data: [], meta: null, warnings: [] }),
    ),
    http.post("*/api/v1/pos/orders", async ({ request }) => {
      createOrderCallCount += 1;
      if (failCreate) return UNAVAILABLE();
      const body = (await request.json()) as Record<string, unknown>;
      const clientOrderId = (body.clientOrderId as string) ?? "";

      // Idempotent create, exactly like OrderLifecycleIT
      // #duplicateCreate_sameClientOrderId_returnsSameOrder — a retry must NOT make a
      // second check. Without this the fake would hide the double-ring hazard entirely.
      const existingId = ordersByClientId.get(clientOrderId);
      if (existingId) {
        return HttpResponse.json({ data: orderStore.get(existingId), meta: null, warnings: [] });
      }

      const id = `d1000001-0000-4000-8000-${String(orderStore.size + 1).padStart(12, "0")}`;
      const order: FakeOrder = {
        id,
        branchId: BRANCH_ID,
        orderNo: ORDER_NO,
        type: (body.type as string) ?? "DINE_IN",
        status: "DRAFT",
        derivedStatus: "DRAFT",
        tableId: null,
        coverCount: 1,
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
        clientOrderId,
        version: 0,
        items: [],
      };
      orderStore.set(id, order);
      ordersByClientId.set(clientOrderId, id);
      return HttpResponse.json({ data: order, meta: null, warnings: [] });
    }),
    http.get("*/api/v1/pos/orders/:id", ({ params }) => {
      const order = orderStore.get(params.id as string);
      if (!order) return HttpResponse.json({ error: "not found" }, { status: 404 });
      return HttpResponse.json({ data: order, meta: null, warnings: [] });
    }),
    http.post("*/api/v1/pos/orders/:id/items", async ({ params, request }) => {
      addItemCallCount += 1;
      const order = orderStore.get(params.id as string);
      if (!order) return HttpResponse.json({ error: "not found" }, { status: 404 });
      const body = (await request.json()) as { menuItemId: string; quantity: number };
      const menuItem = rawItems.find((i) => i.id === body.menuItemId);
      order.items.push({
        id: `e1000001-0000-4000-8000-${String(order.items.length + 1).padStart(12, "0")}`,
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
      });
      order.status = "OPEN";
      order.subtotalPaisa = order.items.reduce((sum, i) => sum + (i.lineTotalPaisa as number), 0);
      order.totalPaisa = order.subtotalPaisa;
      return HttpResponse.json({ data: order, meta: null, warnings: [] });
    }),
    http.post("*/api/v1/pos/orders/:id/send-to-kds", ({ params }) => {
      sendToKdsCallCount += 1;
      if (failSendToKds) return UNAVAILABLE();
      const order = orderStore.get(params.id as string);
      if (!order) return HttpResponse.json({ error: "not found" }, { status: 404 });
      order.status = "SENT_TO_KDS";
      order.sentToKdsAt = "2026-08-12T10:00:00Z";
      order.items = order.items.map((i) => ({ ...i, kdsStatus: "SENT", revisionNo: 1 }));
      return HttpResponse.json({ data: order, meta: null, warnings: [] });
    }),
  );
}

function renderTerminal() {
  seedSession({ branchId: "branch-1", permissions: ["pos.order.close", "pos.order.void.own"] });
  resetFakeBackend();
  mockPosEndpoints();
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <PosTerminal />
    </Wrapper>,
  );
}

/** Rings both fixture items into the client-only cart. */
async function ringTwoItems(user: ReturnType<typeof userEvent.setup>) {
  const menuGrid = within(await screen.findByTestId("menu-grid"));
  await user.click(menuGrid.getByText("Cheeseburger").closest("button") as HTMLElement);
  await user.click(menuGrid.getByText("Chicken Wings").closest("button") as HTMLElement);
  expect(cartLineNames()).toEqual(["Cheeseburger", "Chicken Wings"]);
}

/**
 * The pre-send cart, read the way a cashier reads it. `Decrease <name> quantity` exists
 * only on a PreSendCart row — the menu grid's own selection badge says "Remove … from
 * cart", so matching on that would double-count every line.
 */
function cartLineNames(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      'button[aria-label^="Decrease "][aria-label$=" quantity"]',
    ),
  ).map((n) => (n.getAttribute("aria-label") ?? "").replace(/^Decrease | quantity$/g, ""));
}

describe("PosTerminal — Send to Kitchen failure is visible (S0 #6)", () => {
  afterEach(() => clearSession());

  it("shows a role=alert, keeps both cart lines and re-enables the button when the CREATE 503s", async () => {
    renderTerminal();
    const user = userEvent.setup();
    await ringTwoItems(user);

    failCreate = true;
    await user.click(await screen.findByTestId("send-to-kitchen-button"));

    // 1. The cashier is TOLD. Before the fix this timed out: no alert, no banner, nothing.
    const alert = await screen.findByTestId("send-failure-alert", {}, { timeout: 4000 });
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.textContent).toMatch(/nothing was saved/i);
    expect(alert.textContent).toMatch(/still in the cart/i);

    // 2. The cart is intact — both items, nothing lost.
    expect(cartLineNames()).toEqual(["Cheeseburger", "Chicken Wings"]);

    // 3. The button is usable again.
    expect(screen.getByTestId("send-to-kitchen-button")).toBeEnabled();

    // 4. Nothing reached the kitchen.
    expect(orderStore.size).toBe(0);
    expect(sendToKdsCallCount).toBe(0);
  });

  it("names the order number and keeps the cart when the CREATE lands but the FIRE 503s", async () => {
    renderTerminal();
    const user = userEvent.setup();
    await ringTwoItems(user);

    failSendToKds = true;
    await user.click(await screen.findByTestId("send-to-kitchen-button"));

    const alert = await screen.findByTestId("send-failure-alert", {}, { timeout: 4000 });
    // The order EXISTS. If the cashier is not given its number they cannot find the
    // check they just created, and the register's "presses again" scenario follows.
    expect(alert.textContent).toContain(ORDER_NO);
    expect(alert.textContent).toMatch(/NOT sent to the kitchen/i);

    // The cart was NOT emptied behind an unfired ticket — this is the ordering defect:
    // `setCart(clearCart())` used to run BEFORE `fireToKitchen` was awaited.
    expect(cartLineNames()).toEqual(["Cheeseburger", "Chicken Wings"]);

    expect(orderStore.size).toBe(1);
    expect(sendToKdsCallCount).toBe(1);
    expect(screen.getByTestId("send-to-kitchen-button")).toBeEnabled();
  });

  it("retrying after the fire recovers fires the SAME order once, with no duplicated lines", async () => {
    renderTerminal();
    const user = userEvent.setup();
    await ringTwoItems(user);

    failSendToKds = true;
    await user.click(await screen.findByTestId("send-to-kitchen-button"));
    await screen.findByTestId("send-failure-alert", {}, { timeout: 4000 });
    expect(addItemCallCount).toBe(2);

    // Network restored; the cashier presses the same button again.
    failSendToKds = false;
    await user.click(screen.getByTestId("send-to-kitchen-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("send-failure-alert")).not.toBeInTheDocument();
    });

    // Exactly ONE check, fired ONCE, holding exactly the two lines that were rung.
    expect(orderStore.size).toBe(1);
    // The retry DID re-POST /pos/orders (same clientOrderId) — proof that the fake's
    // dedupe, not luck, is what kept it to one check.
    expect(createOrderCallCount).toBe(1);
    const order = Array.from(orderStore.values())[0]!;
    expect(order.status).toBe("SENT_TO_KDS");
    expect(order.items).toHaveLength(2);
    // The retry must NOT have re-added the lines that already landed (pos-service
    // dedupes the create, so a naive retry would append all of them a second time).
    expect(addItemCallCount).toBe(2);
    expect(sendToKdsCallCount).toBe(2);

    // The panel has handed over to the server order, and the cart is finally empty.
    await waitFor(() => {
      expect(screen.getByTestId("clear-new-order-button")).toBeInTheDocument();
    });
    expect(cartLineNames()).toEqual([]);
  });
});
