import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { ChargeSummary } from "@/components/pos/charge-summary";
import type { Order, OrderPayment } from "@/lib/models/pos.model";

/**
 * F20 — the charge page stops printing a service charge nobody set, starts printing one somebody
 * did, and grows a tip box.
 *
 * <h3>The defect these assert against</h3>
 *
 * Walkthrough §3 #23: `Service charge Rs 0.00` was printed on the charge page AND on every
 * guest's receipt, every time, while `service_charge_paisa` was non-zero on 0 of 195 live orders
 * and the charge-page probe read `{tip:false, wallet:false, qr:false, houseAccount:false,
 * rounding:false}`. The row was unconditional; the tip did not exist.
 *
 * <h3>Falsification — how each was watched to fail</h3>
 *
 * <ul>
 *   <li>{@code noServiceChargeRowWhenTheBranchTakesNone} — restore
 *       {@code <MoneyRow label="Service charge" paisa={order.serviceChargePaisa} />} unconditional
 *       and it fails on the very string the walkthrough photographed, "Service charge".</li>
 *   <li>{@code theRowNamesTheBranchesOwnWordingAndTheRate} fails against the same restoration,
 *       which prints the hard-coded caption and no percentage.</li>
 *   <li>{@code aTipIsSentBesideTheAmountAndNeverInsideIt} fails against any build with no tip
 *       input (the box is found by accessible name) and against one that adds the tip into
 *       `amountPaisa`.</li>
 * </ul>
 *
 * Everything here is asserted on what the cashier SEES and what leaves for the server — never on
 * a component's props.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const ORDER_ID = "d1000001-0000-4000-8000-0000000000f2";
/** Rs 1,000.00 of food + Rs 50.00 service charge at 5%. No tax, so every figure is hand-checkable. */
const SUBTOTAL_PAISA = 100_000;
const SERVICE_CHARGE_PAISA = 5_000;
const TOTAL_PAISA = SUBTOTAL_PAISA + SERVICE_CHARGE_PAISA;

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
    orderNo: "ORD-20260812-0301",
    type: "DINE_IN",
    status: "SENT_TO_KDS",
    derivedStatus: "IN_PROGRESS",
    tableId: null,
    coverCount: 2,
    cashierId: null,
    customerId: null,
    subtotalPaisa: SUBTOTAL_PAISA,
    taxPaisa: 0,
    discountPaisa: 0,
    serviceChargePaisa: SERVICE_CHARGE_PAISA,
    serviceChargePct: 5,
    serviceChargeLabel: "Service charge",
    totalPaisa: TOTAL_PAISA,
    notes: null,
    openedAt: "2026-08-12T00:11:00Z",
    sentToKdsAt: "2026-08-12T00:11:30Z",
    clientOrderId: "c0000001-0000-4000-8000-0000000000f2",
    version: 0,
    items: [
      {
        id: "11111111-0000-4000-8000-0000000000f1",
        menuItemId: "aaaaaaaa-0000-4000-8000-0000000000f1",
        itemNameSnapshot: "Chicken Karahi",
        unitPriceSnapshot: 50_000,
        quantity: 2,
        kdsStation: "DEFAULT",
        itemStatus: "SENT",
        revisionNo: 1,
        firedAt: "2026-08-12T00:11:30Z",
        discountPaisa: 0,
        taxPaisa: 0,
        lineTotalPaisa: 100_000,
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

beforeEach(() => {
  currentOrder = makeOrder();
  currentPayments = [];
  recordPaymentMock.mockReset();
  recordPaymentMock.mockResolvedValue(TOTAL_PAISA);
});

afterEach(() => {
  clearSession();
});

describe("ChargeSummary — the service charge line (F20)", () => {
  it("prints the branch's own wording and the rate beside the amount", async () => {
    renderCharge();
    await screen.findByTestId("record-payment-button");

    // The phrase a cashier reads back to a guest who asks what the extra Rs 50.00 is.
    expect(screen.getByText("Service charge (5.00%)")).toBeInTheDocument();
    expect(screen.getByText("Rs 50.00")).toBeInTheDocument();
  });

  it("prints NO service-charge row at all when the branch takes none", async () => {
    currentOrder = makeOrder({
      serviceChargePaisa: 0,
      serviceChargePct: 0,
      serviceChargeLabel: null,
      totalPaisa: SUBTOTAL_PAISA,
    });
    renderCharge();
    await screen.findByTestId("record-payment-button");

    // The exact string the walkthrough photographed on every check ever rung.
    expect(document.body.textContent ?? "").not.toMatch(/service charge/i);
  });

  it("still prints the row on a fully comped check, where the charge is genuinely Rs 0.00", async () => {
    // The case that makes "hide when zero" the WRONG rule: the branch does charge 5%, and this
    // check happens to owe nothing. The guest is entitled to see the line that says so.
    currentOrder = makeOrder({
      subtotalPaisa: 100_000,
      discountPaisa: 100_000,
      serviceChargePaisa: 0,
      serviceChargePct: 5,
      serviceChargeLabel: "Service charge",
      totalPaisa: 0,
    });
    renderCharge();
    await screen.findByTestId("record-payment-button");

    expect(screen.getByText("Service charge (5.00%)")).toBeInTheDocument();
  });
});

describe("ChargeSummary — the tip (F20)", () => {
  it("offers a tip box on a card tender and sends it BESIDE the amount, never inside it", async () => {
    const user = userEvent.setup();
    renderCharge();
    await screen.findByTestId("record-payment-button");

    await user.selectOptions(screen.getByLabelText(/payment method/i), "CARD");

    const amount = await screen.findByLabelText(/^amount \(rs\)$/i);
    await user.clear(amount);
    await user.type(amount, "1050.00");

    const tip = await screen.findByLabelText(/^tip \(rs\)$/i);
    await user.type(tip, "100");

    // What the guest's card is actually charged, read back on screen before anyone presses a key
    // on the terminal.
    await waitFor(() =>
      expect(screen.getByTestId("tender-plus-tip-value")).toHaveAttribute("data-paisa", "115000"),
    );
    expect(screen.getByTestId("tip-total-value")).toHaveAttribute("data-paisa", "10000");

    await user.click(screen.getByTestId("record-payment-button"));

    await waitFor(() => expect(recordPaymentMock).toHaveBeenCalledTimes(1));
    const [, payload] = recordPaymentMock.mock.calls[0]!;
    expect(payload.amountPaisa).toBe(TOTAL_PAISA);
    expect(payload.tipPaisa).toBe(10_000);
  });

  it("sends no tip key at all when the box is left empty", async () => {
    const user = userEvent.setup();
    renderCharge();
    await screen.findByTestId("record-payment-button");

    const amount = await screen.findByLabelText(/^amount \(rs\)$/i);
    await user.clear(amount);
    await user.type(amount, "1050.00");
    await user.click(screen.getByTestId("record-payment-button"));

    await waitFor(() => expect(recordPaymentMock).toHaveBeenCalledTimes(1));
    const [, payload] = recordPaymentMock.mock.calls[0]!;
    expect(payload).not.toHaveProperty("tipPaisa");
  });

  it("refuses to submit an unreadable tip, and says which field and why", async () => {
    const user = userEvent.setup();
    renderCharge();
    await screen.findByTestId("record-payment-button");

    const amount = await screen.findByLabelText(/^amount \(rs\)$/i);
    await user.clear(amount);
    await user.type(amount, "1050.00");
    await user.type(await screen.findByLabelText(/^tip \(rs\)$/i), "abc");

    expect(await screen.findByTestId("tip-invalid-message")).toHaveTextContent(
      /Enter the tip in rupees/i,
    );
    expect(screen.getByTestId("record-payment-button")).toBeDisabled();
    expect(recordPaymentMock).not.toHaveBeenCalled();
  });

  /**
   * Every method this till OFFERS moves money now, so every one of them accepts a tip. The two
   * that do not — LOYALTY_POINTS and CHARGE_TO_ACCOUNT — are not on the picker at all, and the
   * server refuses a tip on them by name (`ServiceChargeAndTipIT.aTipIsRefusedOnATenderThatMovesNoMoneyNow`).
   * This asserts the box follows the method rather than being pinned to cash.
   */
  it("offers the tip box on every tender the till actually offers", async () => {
    const user = userEvent.setup();
    renderCharge();
    await screen.findByTestId("record-payment-button");

    for (const method of ["CASH", "CARD", "BANK_TRANSFER", "VOUCHER"]) {
      await user.selectOptions(screen.getByLabelText(/payment method/i), method);
      expect(await screen.findByLabelText(/^tip \(rs\)$/i)).toBeInTheDocument();
    }
  });
});
