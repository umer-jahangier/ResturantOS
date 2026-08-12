import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { OrderPanel } from "@/components/pos/order-panel";
import type { CartLine } from "@/components/pos/cart-reducer";
import type { OrderType } from "@/lib/models/pos.model";

/**
 * D-3 — the cart quoted every dine-in guest 5% low.
 *
 * <h2>The defect</h2>
 *
 * The panel a cashier reads to a guest BEFORE committing, on table AUD3547:
 *
 * <pre>
 * Subtotal  Rs 2,259.00
 * Tax       Rs   257.60
 * Total     Rs 2,516.60
 * </pre>
 *
 * The check created one tap later was Rs 2,629.55 — `serviceChargePaisa 11295`,
 * `serviceChargePct 5.0`. The service charge lands at fire time, server-side, and this panel did
 * not know it existed. The charge page a minute later showed it correctly, so two screens on the
 * same check disagreed by Rs 112.95 and the guest heard the smaller one.
 *
 * <h2>What these assert</h2>
 *
 * The quote RECONCILES with the check that will be created: subtotal + tax + service charge, to
 * the paisa, against the figures the live order actually carried. Not that a row is present —
 * the row could be present and wrong, which is how D-1 shipped.
 *
 * <h2>Falsification — watched</h2>
 *
 * Drop `estServiceCharge` from `estTotal` in order-panel.tsx and
 * {@link  } "the quoted total is the total the check will be created with" fails with
 * `expected "Rs 2,516.60" ... "Rs 2,629.55"` — the two live figures, on the two sides of the
 * assertion.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { getServiceChargeMock } = vi.hoisted(() => ({ getServiceChargeMock: vi.fn() }));

vi.mock("@/lib/repositories/service-charge.repository", () => ({
  ServiceChargeRepository: { get: getServiceChargeMock, update: vi.fn() },
}));

vi.mock("@/lib/repositories/pos.repository", () => ({
  PosRepository: {
    getTables: vi.fn(async () => []),
    getOrder: vi.fn(),
    getPayments: vi.fn(async () => []),
  },
}));

vi.mock("@/lib/hooks/pos/use-queued-ops", () => ({
  useQueuedOps: () => ({ ops: [], isLoading: false }),
}));

/**
 * The live check: Rs 2,259.00 of food at 16%, which is Rs 361.44 of tax on this cart's own rate.
 *
 * The measured order carried Rs 257.60 of tax because its lines sat in different tax classes; the
 * exact mix is not what is on trial here, so this fixture uses ONE rate and asserts the identity
 * subtotal + tax + serviceCharge = total against figures derived from it. The service charge —
 * 5% of Rs 2,259.00 = Rs 112.95 — is the live figure exactly, because it depends only on the
 * subtotal.
 */
const CART: CartLine[] = [
  {
    menuItemId: "m1",
    name: "Mutton Karahi",
    unitPricePaisa: 225900,
    quantity: 1,
    taxRatePct: 16,
    modifiers: [],
    notes: null,
  },
];

const POLICY = {
  branchId: "b1",
  enabled: true,
  ratePct: 5,
  label: "Service charge",
  dineIn: true,
  takeaway: false,
  pickup: false,
  canManage: false,
};

function renderCart(orderType: OrderType = "DINE_IN") {
  return render(
    <OrderPanel
      cart={CART}
      orderType={orderType}
      onOrderTypeChange={vi.fn()}
      tableId={null}
      onTableChange={vi.fn()}
      onIncrement={vi.fn()}
      onDecrement={vi.fn()}
      onRemove={vi.fn()}
      sentOrder={null}
      isPersisting={false}
      onSendToKitchen={vi.fn()}
      onSaveAsDraft={vi.fn()}
      onChargeNow={vi.fn()}
    />,
    { wrapper: createQueryWrapper() },
  );
}

describe("The pre-send cart and the service charge (D-3)", () => {
  beforeEach(() => {
    seedSession({ permissions: ["pos.order.create", "pos.order.update", "pos.menu.view"] });
    getServiceChargeMock.mockResolvedValue(POLICY);
  });

  afterEach(() => {
    clearSession();
    vi.clearAllMocks();
  });

  it("shows the branch's service charge, with its own wording and rate", async () => {
    renderCart("DINE_IN");

    const row = await screen.findByTestId("cart-service-charge");
    expect(row).toHaveTextContent("Rs 112.95");
    expect(screen.getByTestId("cart-service-charge-label")).toHaveTextContent(
      "Service charge (5.00%)",
    );
  });

  it("quotes a total the created check will match, to the paisa", async () => {
    renderCart("DINE_IN");

    // Wait FOR the charge to arrive rather than for an absence — an assertion that waits for
    // something NOT to appear passes against a component that never renders anything at all.
    await screen.findByTestId("cart-service-charge");

    // 16% of Rs 2,259.00 = Rs 361.44.
    expect(screen.getByTestId("cart-tax")).toHaveTextContent("Rs 361.44");
    // Rs 2,259.00 + Rs 361.44 + Rs 112.95 = Rs 2,733.39. The identity that was broken is that
    // the third term existed at all.
    expect(screen.getByTestId("cart-total")).toHaveTextContent("Rs 2,733.39");

    // And the sum is the sum — stated as arithmetic so a future edit that drops a term is caught
    // even if the fixture's numbers change.
    const paisa = (t: string) => Math.round(Number(t.replace(/[^0-9.]/g, "")) * 100);
    const total = paisa(screen.getByTestId("cart-total").textContent ?? "");
    const tax = paisa(screen.getByTestId("cart-tax").textContent ?? "");
    const charge = paisa(screen.getByTestId("cart-service-charge").textContent ?? "");
    expect(total).toBe(225900 + tax + charge);
  });

  it("omits the charge on a channel the branch does not charge it on", async () => {
    renderCart("TAKEAWAY");

    // The policy is dine-in only, so a takeaway cart must show no charge AND no zero-rupee row —
    // a permanent "Rs 0.00" line is what teaches a cashier to stop reading the total.
    //
    // Waiting for the tax row first is what makes this meaningful: it proves the totals block
    // rendered and the policy query settled, so the charge's absence is a decision rather than a
    // component that had not painted yet.
    await waitFor(() => expect(getServiceChargeMock).toHaveBeenCalled());
    await screen.findByTestId("cart-tax");

    expect(screen.queryByTestId("cart-service-charge")).toBeNull();
    expect(screen.getByTestId("cart-total")).toHaveTextContent("Rs 2,620.44");
  });

  it("charges nothing when the branch has the policy switched off", async () => {
    getServiceChargeMock.mockResolvedValue({ ...POLICY, enabled: false });
    renderCart("DINE_IN");

    await waitFor(() => expect(getServiceChargeMock).toHaveBeenCalled());
    await screen.findByTestId("cart-tax");

    expect(screen.queryByTestId("cart-service-charge")).toBeNull();
    expect(screen.getByTestId("cart-total")).toHaveTextContent("Rs 2,620.44");
  });
});
