import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { SettlementActions } from "@/components/pos/settlement-actions";
import type { Order } from "@/lib/models/pos.model";

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
    totalPaisa: 89250,
    notes: null,
    openedAt: "2026-06-30T00:00:00Z",
    sentToKdsAt: null,
    clientOrderId: "c0000001-0000-4000-8000-000000000001",
    version: 0,
    items: [],
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
  afterEach(() => clearSession());

  it("renders CHARGE NOW and opens the PaymentPanel dialog when clicked", async () => {
    renderActions(makeOrder(), ["pos.order.close"]);
    const user = userEvent.setup();

    const chargeButton = screen.getByTestId("charge-now-button");
    expect(chargeButton).not.toBeDisabled();

    await user.click(chargeButton);

    expect(await screen.findByLabelText("Charge order")).toBeInTheDocument();
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

  it("renders the Void action when the user holds pos.order.void.own on an OPEN order", () => {
    renderActions(makeOrder({ status: "OPEN" }), ["pos.order.void.own"]);
    expect(screen.getByRole("button", { name: /void/i })).toBeInTheDocument();
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
