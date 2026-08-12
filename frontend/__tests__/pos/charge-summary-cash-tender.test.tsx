import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { ChargeSummary } from "@/components/pos/charge-summary";
import type { Order, OrderPayment } from "@/lib/models/pos.model";

/**
 * S1-05 — cash is taken in RUPEES, with a tendered amount and a change due.
 *
 * The bill throughout is the register's own: Rs 3,456.80 (2x Chicken Karahi + 1x Butter Naan at
 * 16%, which is exactly what the live till rings). Every assertion here is about what the cashier
 * types and reads, never about what the component stores internally — the pre-fix screen stored
 * paisa perfectly well and still took Rs 345.60 for a Rs 3,456.80 check.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ORDER_ID = "d1000001-0000-4000-8000-0000000000a5";
const TOTAL_PAISA = 345680; // Rs 3,456.80

const { recordPaymentMock } = vi.hoisted(() => ({ recordPaymentMock: vi.fn() }));

let currentOrder: Order;
let currentPayments: OrderPayment[];

vi.mock("@/lib/repositories/pos.repository", () => ({
  PosRepository: {
    getOrder: vi.fn(async () => currentOrder),
    getTables: vi.fn(async () => []),
    getPayments: vi.fn(async () => currentPayments),
    recordPayment: recordPaymentMock,
    sendToKds: vi.fn(async () => currentOrder),
    serveAllItems: vi.fn(async () => currentOrder),
  },
}));

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: ORDER_ID,
    branchId: "b0000001-0000-4000-8000-000000000001",
    orderNo: "ORD-20260812-0099",
    type: "DINE_IN",
    status: "SENT_TO_KDS",
    derivedStatus: "IN_PROGRESS",
    tableId: null,
    coverCount: 2,
    cashierId: null,
    customerId: null,
    subtotalPaisa: 298000,
    taxPaisa: 47680,
    discountPaisa: 0,
    serviceChargePaisa: 0,
    serviceChargePct: 0,
    serviceChargeLabel: null,
    totalPaisa: TOTAL_PAISA,
    notes: null,
    openedAt: "2026-08-12T00:11:00Z",
    sentToKdsAt: "2026-08-12T00:11:30Z",
    clientOrderId: "c0000001-0000-4000-8000-0000000000a5",
    version: 0,
    items: [
      {
        id: "11111111-0000-4000-8000-0000000000a1",
        menuItemId: "aaaaaaaa-0000-4000-8000-0000000000a1",
        itemNameSnapshot: "Chicken Karahi",
        unitPriceSnapshot: 145000,
        quantity: 2,
        kdsStation: "DEFAULT",
        itemStatus: "SENT",
        revisionNo: 1,
        firedAt: "2026-08-12T00:11:30Z",
        discountPaisa: 0,
        taxPaisa: 46400,
        lineTotalPaisa: 290000,
        notes: null,
        modifiers: [],
      },
      {
        id: "11111111-0000-4000-8000-0000000000a2",
        menuItemId: "aaaaaaaa-0000-4000-8000-0000000000a2",
        itemNameSnapshot: "Butter Naan",
        unitPriceSnapshot: 8000,
        quantity: 1,
        kdsStation: "DEFAULT",
        itemStatus: "SENT",
        revisionNo: 1,
        firedAt: "2026-08-12T00:11:30Z",
        discountPaisa: 0,
        taxPaisa: 1280,
        lineTotalPaisa: 8000,
        notes: null,
        modifiers: [],
      },
    ],
    discounts: [],
    ...overrides,
  };
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

/** The amount box, found the way a screen reader finds it — by accessible name. */
async function amountField() {
  return screen.findByLabelText(/^amount \(rs\)$/i);
}

beforeEach(() => {
  currentOrder = makeOrder();
  currentPayments = [];
  recordPaymentMock.mockReset();
  recordPaymentMock.mockResolvedValue(TOTAL_PAISA);
});

afterEach(() => {
  clearSession();
});

describe("ChargeSummary cash tender — the unit on screen is RUPEES (S1-05)", () => {
  it("asks for rupees, and nothing on the screen asks for paisa", async () => {
    renderCharge();
    await screen.findByTestId("record-payment-button");

    expect(await amountField()).toBeInTheDocument();
    expect(screen.queryByLabelText(/paisa/i)).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/paisa/i);
  });

  it("typing the bill as it is printed sends the bill, not a tenth of it", async () => {
    renderCharge();
    const user = userEvent.setup();
    const amount = await amountField();

    await user.clear(amount);
    await user.type(amount, "3456.80");

    await waitFor(() => expect(screen.getByTestId("tender-total-value")).toHaveAttribute("data-paisa", "345680"));

    await user.click(screen.getByTestId("record-payment-button"));

    await waitFor(() =>
      expect(recordPaymentMock).toHaveBeenCalledWith(
        ORDER_ID,
        expect.objectContaining({ method: "CASH", amountPaisa: 345680 }),
      ),
    );
  });

  it("'Full amount' fills the box with a rupee figure a human would write", async () => {
    renderCharge();
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("fill-full-amount-button"));

    await waitFor(async () => expect(await amountField()).toHaveValue("3456.80"));
  });

  it("computes change due from a Rs 4,000 tender before the payment is taken", async () => {
    renderCharge();
    const user = userEvent.setup();

    await user.type(await amountField(), "3456.80");
    await user.type(await screen.findByLabelText(/^tendered \(rs\)$/i), "4000");

    const change = await screen.findByTestId("change-due-value");
    await waitFor(() => expect(change).toHaveAttribute("data-paisa", "54320"));
    expect(change).toHaveTextContent("543.20");
  });

  it("sends tenderedPaisa with the tender so the drawer and the ledger agree", async () => {
    renderCharge();
    const user = userEvent.setup();

    await user.type(await amountField(), "3456.80");
    await user.type(await screen.findByLabelText(/^tendered \(rs\)$/i), "4000");
    await user.click(screen.getByTestId("record-payment-button"));

    await waitFor(() =>
      expect(recordPaymentMock).toHaveBeenCalledWith(
        ORDER_ID,
        expect.objectContaining({ amountPaisa: 345680, tenderedPaisa: 400000 }),
      ),
    );
  });

  it("offers denomination keys that set the tendered amount, not the applied amount", async () => {
    renderCharge();
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("fill-full-amount-button"));
    await user.click(await screen.findByTestId("denom-500000"));

    await waitFor(async () =>
      expect(await screen.findByLabelText(/^tendered \(rs\)$/i)).toHaveValue("5000.00"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("change-due-value")).toHaveAttribute("data-paisa", "154320"),
    );
    // The applied amount must not move when the guest hands over a bigger note.
    expect(await amountField()).toHaveValue("3456.80");
  });

  it("refuses to record an unparseable amount rather than sending zero", async () => {
    renderCharge();
    const user = userEvent.setup();

    await user.type(await amountField(), "34,56.8x");

    await waitFor(() => expect(screen.getByTestId("record-payment-button")).toBeDisabled());
    expect(recordPaymentMock).not.toHaveBeenCalled();
  });

  it("offers tendered/change on CASH and withdraws both on CARD, where there is no drawer", async () => {
    renderCharge();
    const user = userEvent.setup();
    const method = await screen.findByLabelText(/payment method/i);

    // CASH first — asserting the absence alone would pass against a screen that has no tendered
    // field at all, which is precisely the state this gap describes.
    expect(await screen.findByLabelText(/^tendered \(rs\)$/i)).toBeInTheDocument();
    expect(screen.getByTestId("change-due-value")).toBeInTheDocument();

    await user.selectOptions(method, "CARD");

    await waitFor(() => expect(screen.queryByLabelText(/^tendered \(rs\)$/i)).toBeNull());
    expect(screen.queryByTestId("change-due-value")).toBeNull();
  });

  it("a split CASH + CARD tender still lands the remaining balance on Rs 0.00", async () => {
    renderCharge();
    const user = userEvent.setup();

    // Rs 2,000.00 cash, Rs 4,000.00 handed over -> Rs 2,000.00 change.
    await user.type(await amountField(), "2000");
    await user.type(await screen.findByLabelText(/^tendered \(rs\)$/i), "4000");

    await user.click(screen.getByTestId("add-tender-button"));
    const rows = await screen.findAllByLabelText(/^amount \(rs\)$/i);
    expect(rows).toHaveLength(2);
    const methods = screen.getAllByLabelText(/payment method/i);
    await user.selectOptions(methods[1]!, "CARD");
    await user.type(rows[1]!, "1456.80");

    await waitFor(() =>
      expect(screen.getByTestId("tender-total-value")).toHaveAttribute("data-paisa", "345680"),
    );

    await user.click(screen.getByTestId("record-payment-button"));

    await waitFor(() => expect(recordPaymentMock).toHaveBeenCalledTimes(2));
    expect(recordPaymentMock).toHaveBeenNthCalledWith(
      1,
      ORDER_ID,
      expect.objectContaining({ method: "CASH", amountPaisa: 200000, tenderedPaisa: 400000 }),
    );
    expect(recordPaymentMock).toHaveBeenNthCalledWith(
      2,
      ORDER_ID,
      expect.objectContaining({ method: "CARD", amountPaisa: 145680 }),
    );
    // A card row must never claim an over-tender — the server rejects that with a 422.
    expect(recordPaymentMock.mock.calls[1]![1]).not.toHaveProperty("tenderedPaisa", 145680);
  });
});
