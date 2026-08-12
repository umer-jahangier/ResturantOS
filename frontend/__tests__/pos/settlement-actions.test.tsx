import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { SettlementActions } from "@/components/pos/settlement-actions";
import type { Order } from "@/lib/models/pos.model";

// Capture router.push without a real Next router (mirrors login-form.test.tsx's pattern).
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

/*
 * S0-01: VoidRefundDialog now reads the order's payment history, because whether a Void may be
 * offered is a question about MONEY, not about status alone. Without this stub the query never
 * settles under jsdom and the component sits in its loading branch forever — which would make
 * "Void is hidden" pass for the wrong reason. An empty history is the unpaid order these cases
 * are about.
 */
const { getPaymentsMock } = vi.hoisted(() => ({ getPaymentsMock: vi.fn() }));
vi.mock("@/lib/repositories/pos.repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repositories/pos.repository")>();
  return {
    ...actual,
    PosRepository: { ...actual.PosRepository, getPayments: getPaymentsMock },
  };
});

const ORDER_ID = "d1000001-0000-4000-8000-000000000001";

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: ORDER_ID,
    branchId: "b0000001-0000-4000-8000-000000000001",
    orderNo: "ORD-20260630-0001",
    type: "DINE_IN",
    status: "OPEN",
    derivedStatus: "DRAFT",
    tableId: null,
    coverCount: 2,
    cashierId: null,
    customerId: null,
    subtotalPaisa: 85000,
    taxPaisa: 4250,
    discountPaisa: 0,
    serviceChargePaisa: 0,
    serviceChargePct: 0,
    serviceChargeLabel: null,
    totalPaisa: 89250,
    notes: null,
    openedAt: "2026-06-30T00:00:00Z",
    sentToKdsAt: null,
    clientOrderId: "c0000001-0000-4000-8000-000000000001",
    version: 0,
    items: [],
    discounts: [],
    ...overrides,
  };
}

function renderActions(order: Order, permissions: string[]) {
  seedSession({ permissions });
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <SettlementActions order={order} />
    </Wrapper>,
  );
}

describe("SettlementActions", () => {
  beforeEach(() => {
    getPaymentsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    clearSession();
    pushMock.mockClear();
    getPaymentsMock.mockReset();
  });

  it("renders CHARGE NOW and navigates to the full-page charge route when clicked (POS-22/25 — no dialog)", async () => {
    const order = makeOrder();
    renderActions(order, ["pos.order.close"]);
    const user = userEvent.setup();

    const chargeButton = screen.getByTestId("charge-now-button");
    expect(chargeButton).not.toBeDisabled();

    await user.click(chargeButton);

    expect(pushMock).toHaveBeenCalledWith(`/app/pos/orders/${order.id}/charge`);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("hides CHARGE NOW when the user lacks pos.order.close", () => {
    renderActions(makeOrder(), []);
    expect(screen.queryByTestId("charge-now-button")).not.toBeInTheDocument();
  });

  it("disables CHARGE NOW when the order has no outstanding balance", () => {
    renderActions(makeOrder({ totalPaisa: 0 }), ["pos.order.close"]);
    expect(screen.getByTestId("charge-now-button")).toBeDisabled();
  });

  it("shows the Paid checkmark chip once the order is CLOSED, and hides CHARGE NOW", () => {
    renderActions(makeOrder({ status: "CLOSED", derivedStatus: "SERVED" }), ["pos.order.close"]);
    expect(screen.getByTestId("paid-chip")).toHaveTextContent("Paid");
    expect(screen.queryByTestId("charge-now-button")).not.toBeInTheDocument();
  });

  it("renders the Void action when the user holds pos.order.void.own on an OPEN order", async () => {
    renderActions(makeOrder({ status: "OPEN" }), ["pos.order.void.own"]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /void/i })).toBeInTheDocument(),
    );
  });

  /**
   * S0-01, the whole point: money on the order withdraws Void and offers Refund instead — on an
   * order that is NOT closed, which is precisely the state the old `status === "CLOSED"` refund
   * gate could never reach.
   */
  it("withdraws Void and offers Refund once a tender has been recorded, on a non-CLOSED order", async () => {
    getPaymentsMock.mockResolvedValue([
      {
        id: "p0000001-0000-4000-8000-000000000001",
        method: "CASH",
        amountPaisa: 89250,
        tenderedPaisa: 89250,
        changePaisa: 0,
        referenceNo: null,
        recordedAt: "2026-06-30T00:05:00Z",
        kind: "PAYMENT",
      },
    ]);
    renderActions(makeOrder({ status: "SENT_TO_KDS", derivedStatus: "IN_PROGRESS" }), [
      "pos.order.void.own",
      "pos.order.refund",
    ]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /refund order/i })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /void order/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("void-blocked-paid-notice")).toHaveTextContent(/use Refund/i);
  });

  /** A refund fully reverses the tenders — nothing is held, so neither action is offered again. */
  it("offers neither action once the order is REFUNDED", async () => {
    getPaymentsMock.mockResolvedValue([
      {
        id: "p0000001-0000-4000-8000-000000000001",
        method: "CASH",
        amountPaisa: 89250,
        tenderedPaisa: 89250,
        changePaisa: 0,
        referenceNo: null,
        recordedAt: "2026-06-30T00:05:00Z",
        kind: "PAYMENT",
      },
      {
        id: "r0000001-0000-4000-8000-000000000001",
        method: "CASH",
        amountPaisa: -89250,
        tenderedPaisa: -89250,
        changePaisa: 0,
        referenceNo: "wrong order",
        recordedAt: "2026-06-30T00:09:00Z",
        kind: "REFUND",
      },
    ]);
    renderActions(makeOrder({ status: "REFUNDED" }), [
      "pos.order.void.own",
      "pos.order.refund",
    ]);

    await waitFor(() => expect(getPaymentsMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /void order/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /refund order/i })).not.toBeInTheDocument();
  });

  it("hides Void/Refund entirely without any settlement permission", () => {
    renderActions(makeOrder({ status: "OPEN" }), []);
    expect(screen.queryByRole("button", { name: /void/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /refund/i })).not.toBeInTheDocument();
  });

  it("hides everything (CHARGE NOW, Void, Refund) once the order is VOIDED", () => {
    renderActions(makeOrder({ status: "VOIDED" }), [
      "pos.order.close",
      "pos.order.void.own",
      "pos.order.refund",
    ]);
    expect(screen.queryByTestId("charge-now-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("paid-chip")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /void/i })).not.toBeInTheDocument();
  });
});
