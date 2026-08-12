import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { ChargeSummary } from "@/components/pos/charge-summary";
import type { Order, OrderPayment } from "@/lib/models/pos.model";

/**
 * S0-06 — the settlement screen must offer the cashier a way to finish the order.
 *
 * <p>The register's finding was not "closing is impossible", it was "closing is unreachable from
 * where the cashier is". So these assertions are about REACHABILITY: with the bill settled and
 * the order still open, is there a control on this page, is it enabled, and does pressing it
 * call the server operation that closes the check. Deleting the button (the pre-fix state) fails
 * every one of them.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ORDER_ID = "d1000001-0000-4000-8000-0000000000c1";

const { serveAllMock, recordPaymentMock } = vi.hoisted(() => ({
  serveAllMock: vi.fn(),
  recordPaymentMock: vi.fn(),
}));

let currentOrder: Order;
let currentPayments: OrderPayment[];

vi.mock("@/lib/repositories/pos.repository", () => ({
  PosRepository: {
    getOrder: vi.fn(async () => currentOrder),
    getTables: vi.fn(async () => []),
    serveAllItems: serveAllMock,
    sendToKds: vi.fn(async () => currentOrder),
    getPayments: vi.fn(async () => currentPayments),
    recordPayment: recordPaymentMock,
  },
}));

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: ORDER_ID,
    branchId: "b0000001-0000-4000-8000-000000000001",
    orderNo: "ORD-20260812-0041",
    type: "DINE_IN",
    status: "SENT_TO_KDS",
    derivedStatus: "IN_PROGRESS",
    tableId: null,
    coverCount: 1,
    cashierId: null,
    customerId: null,
    subtotalPaisa: 99800,
    taxPaisa: 0,
    discountPaisa: 0,
    serviceChargePaisa: 0,
    serviceChargePct: 0,
    serviceChargeLabel: null,
    totalPaisa: 99800,
    notes: null,
    openedAt: "2026-08-12T00:11:00Z",
    sentToKdsAt: "2026-08-12T00:11:30Z",
    clientOrderId: "c0000001-0000-4000-8000-000000000001",
    version: 0,
    items: [
      {
        id: "11111111-0000-4000-8000-000000000001",
        menuItemId: "aaaaaaaa-0000-4000-8000-000000000001",
        itemNameSnapshot: "Audit Item 52235",
        unitPriceSnapshot: 49900,
        quantity: 1,
        kdsStation: "DEFAULT",
        itemStatus: "SENT",
        revisionNo: 1,
        firedAt: "2026-08-12T00:11:30Z",
        discountPaisa: 0,
        taxPaisa: 0,
        lineTotalPaisa: 49900,
        notes: null,
        modifiers: [],
      },
      {
        id: "11111111-0000-4000-8000-000000000002",
        menuItemId: "aaaaaaaa-0000-4000-8000-000000000002",
        itemNameSnapshot: "Audit Item 60568",
        unitPriceSnapshot: 49900,
        quantity: 1,
        kdsStation: "DEFAULT",
        itemStatus: "SENT",
        revisionNo: 1,
        firedAt: "2026-08-12T00:11:30Z",
        discountPaisa: 0,
        taxPaisa: 0,
        lineTotalPaisa: 49900,
        notes: null,
        modifiers: [],
      },
    ],
    discounts: [],
    ...overrides,
  };
}

function fullCashPayment(): OrderPayment[] {
  return [
    {
      id: "p1111111-0000-4000-8000-000000000001",
      orderId: ORDER_ID,
      method: "CASH",
      amountPaisa: 99800,
      tipPaisa: 0,
      tenderedPaisa: 99800,
      changePaisa: 0,
      referenceNo: null,
      recordedAt: "2026-08-12T00:12:00Z",
    } as OrderPayment,
  ];
}

function renderCharge() {
  seedSession({ permissions: ["pos.order.view", "pos.order.update", "pos.order.close"] });
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <ChargeSummary orderId={ORDER_ID} />
    </Wrapper>,
  );
}

describe("ChargeSummary — closing a settled check (S0-06)", () => {
  beforeEach(() => {
    currentOrder = makeOrder();
    currentPayments = fullCashPayment();
    serveAllMock.mockReset();
    serveAllMock.mockImplementation(async () => makeOrder({ status: "CLOSED", derivedStatus: "SERVED" }));
  });

  afterEach(() => {
    clearSession();
  });

  it("offers an enabled close control once the bill is fully settled and the order is still open", async () => {
    renderCharge();

    const button = await screen.findByTestId("close-order-button");
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent(/close order/i);
  });

  it("pressing it calls the server operation that closes the check", async () => {
    renderCharge();
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("close-order-button"));

    await waitFor(() => expect(serveAllMock).toHaveBeenCalledWith(ORDER_ID));
  });

  it("is not offered on an order that is still owed money — a check is not finished until it is paid", async () => {
    currentPayments = [];
    renderCharge();

    await screen.findByTestId("record-payment-button");
    expect(screen.queryByTestId("close-order-button")).toBeNull();
  });

  it("is not offered once the order is already CLOSED", async () => {
    currentOrder = makeOrder({ status: "CLOSED", derivedStatus: "SERVED" });
    renderCharge();

    await screen.findByTestId("charge-closed-chip");
    expect(screen.queryByTestId("close-order-button")).toBeNull();
  });

  it("is disabled, with the reason on screen, when a line was never sent to the kitchen", async () => {
    const order = makeOrder();
    order.items[1]!.itemStatus = "PENDING";
    currentOrder = order;
    renderCharge();

    const button = await screen.findByTestId("close-order-button");
    expect(button).toBeDisabled();
    expect(screen.getByText(/never sent to the kitchen/i)).toBeInTheDocument();
  });

  it("shows the server's refusal instead of pretending the order closed", async () => {
    serveAllMock.mockRejectedValue({ status: 423, message: "period locked" });
    renderCharge();
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("close-order-button"));

    const alert = await screen.findByTestId("close-order-error");
    expect(alert).toHaveTextContent(/accounting period is locked/i);
  });
});
