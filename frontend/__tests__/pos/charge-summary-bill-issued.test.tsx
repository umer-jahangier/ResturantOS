import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { ChargeSummary } from "@/components/pos/charge-summary";
import type { Order, OrderPayment } from "@/lib/models/pos.model";
import type { PrintJobIssue } from "@/lib/models/order-bill.model";

/**
 * §3-3 — the cashier must be able to SEE that the guest's bill exists.
 *
 * <p>The receipt used to be dispatched off the close, and the charge page said nothing about it
 * either way. So a cashier took cash, counted out change, and the screen looked exactly the same
 * whether a bill had been produced or not — the defect could only be found by reading `print_jobs`
 * in psql. These assertions are about what a person reading the screen can tell.
 *
 * <p>They assert RENDERED TEXT, not props: the strip has to say the issue time, or it is not doing
 * the job it exists for.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ORDER_ID = "d1000001-0000-4000-8000-0000000000c2";

const { historyMock } = vi.hoisted(() => ({ historyMock: vi.fn() }));

let currentOrder: Order;
let currentPayments: OrderPayment[];

vi.mock("@/lib/repositories/pos.repository", () => ({
  PosRepository: {
    getOrder: vi.fn(async () => currentOrder),
    getTables: vi.fn(async () => []),
    serveAllItems: vi.fn(async () => currentOrder),
    sendToKds: vi.fn(async () => currentOrder),
    getPayments: vi.fn(async () => currentPayments),
    recordPayment: vi.fn(async () => 99800),
  },
}));

vi.mock("@/lib/repositories/order-bill.repository", () => ({
  OrderBillRepository: { history: historyMock },
}));

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: ORDER_ID,
    branchId: "b0000001-0000-4000-8000-000000000001",
    orderNo: "ORD-20260812-0177",
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
    clientOrderId: "c0000001-0000-4000-8000-000000000002",
    version: 0,
    items: [
      {
        id: "11111111-0000-4000-8000-000000000001",
        menuItemId: "aaaaaaaa-0000-4000-8000-000000000001",
        itemNameSnapshot: "Audit Item 52235",
        unitPriceSnapshot: 99800,
        quantity: 1,
        kdsStation: "DEFAULT",
        itemStatus: "SENT",
        revisionNo: 1,
        firedAt: "2026-08-12T00:11:30Z",
        discountPaisa: 0,
        taxPaisa: 0,
        lineTotalPaisa: 99800,
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
      id: "p1111111-0000-4000-8000-000000000002",
      orderId: ORDER_ID,
      method: "CASH",
      amountPaisa: 99800,
      tipPaisa: 0,
      tenderedPaisa: 100000,
      changePaisa: 200,
      referenceNo: null,
      recordedAt: "2026-08-12T00:12:00Z",
    } as OrderPayment,
  ];
}

function billIssuedAtTender(overrides: Partial<PrintJobIssue> = {}): PrintJobIssue {
  return {
    printJobId: "aa000001-0000-4000-8000-000000000001",
    documentType: "CUSTOMER_RECEIPT",
    targetPrinterId: "audit-receipt",
    issueSeq: 1,
    status: "QUEUED",
    issuedAt: "2026-08-12T00:12:01Z",
    originalIssuedAt: null,
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

describe("ChargeSummary — the bill the guest was handed (§3-3)", () => {
  beforeEach(() => {
    currentOrder = makeOrder();
    currentPayments = fullCashPayment();
    historyMock.mockReset();
    historyMock.mockResolvedValue([billIssuedAtTender()]);
  });

  afterEach(() => {
    clearSession();
    vi.useRealTimers();
  });

  it("says the bill was issued, and when, on a settled check that is still open", async () => {
    renderCharge();

    const strip = await screen.findByTestId("bill-issued-strip");
    expect(strip).toHaveAttribute("data-bill-issued", "true");
    // The ISSUE TIME is the whole point — a strip that says "a bill exists" without saying when
    // could not have caught the defect this was written for.
    expect(strip).toHaveTextContent(/Bill issued/i);
    expect(strip).toHaveAttribute("data-bill-issued-at", "2026-08-12T00:12:01Z");
    expect(strip).toHaveTextContent(/audit-receipt/);
  });

  it("says plainly that NO bill exists when the order has produced no paper", async () => {
    historyMock.mockResolvedValue([]);
    renderCharge();

    const strip = await screen.findByTestId("bill-issued-strip");
    expect(strip).toHaveAttribute("data-bill-issued", "false");
    expect(strip).toHaveTextContent(/No bill has been produced/i);
  });

  it("does not count a kitchen ticket as the guest's bill", async () => {
    historyMock.mockResolvedValue([
      {
        printJobId: "bb000001-0000-4000-8000-000000000001",
        documentType: "KITCHEN_TICKET",
        targetPrinterId: "audit-kitchen-default",
        issueSeq: 1,
        status: "QUEUED",
        issuedAt: "2026-08-12T00:11:31Z",
        originalIssuedAt: null,
      } satisfies PrintJobIssue,
    ]);
    renderCharge();

    const strip = await screen.findByTestId("bill-issued-strip");
    expect(strip).toHaveAttribute("data-bill-issued", "false");
  });

  it("counts reprints separately from the original the guest was handed", async () => {
    historyMock.mockResolvedValue([
      billIssuedAtTender(),
      billIssuedAtTender({
        printJobId: "aa000001-0000-4000-8000-000000000002",
        issueSeq: 2,
        issuedAt: "2026-08-12T00:40:00Z",
        originalIssuedAt: "2026-08-12T00:12:01Z",
      }),
    ]);
    renderCharge();

    const strip = await screen.findByTestId("bill-issued-strip");
    // Still the ORIGINAL's time — a reprint must never overwrite when the guest got their paper.
    expect(strip).toHaveAttribute("data-bill-issued-at", "2026-08-12T00:12:01Z");
    expect(strip).toHaveTextContent(/1 copy reprinted since/i);
  });

  it("says the branch prints in the browser when the bill has no printer to go to", async () => {
    historyMock.mockResolvedValue([billIssuedAtTender({ targetPrinterId: "unassigned" })]);
    renderCharge();

    const strip = await screen.findByTestId("bill-issued-strip");
    expect(strip).toHaveTextContent(/no receipt printer configured/i);
  });

  it("offers a retry instead of a silent blank when the read fails", async () => {
    historyMock.mockRejectedValue(new Error("gateway down"));
    renderCharge();
    const user = userEvent.setup();

    const alert = await screen.findByTestId("bill-issued-error");
    expect(alert).toHaveTextContent(/Couldn’t check whether a bill was issued/i);

    historyMock.mockResolvedValue([billIssuedAtTender()]);
    await user.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(async () =>
      expect(await screen.findByTestId("bill-issued-strip")).toHaveAttribute(
        "data-bill-issued",
        "true",
      ),
    );
  });

  it("shows nothing about a bill before any money has been taken", async () => {
    currentPayments = [];
    renderCharge();

    await screen.findByTestId("record-payment-button");
    expect(screen.queryByTestId("bill-issued-strip")).toBeNull();
    expect(screen.queryByTestId("print-bill-button")).toBeNull();
  });
});
