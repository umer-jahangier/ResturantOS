import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { SettlementActions } from "@/components/pos/settlement-actions";
import type { Order, OrderItem } from "@/lib/models/pos.model";

/*
 * B2 re-open — the Void button must not be offered on a check the kitchen has plated.
 *
 * `pos.rego`'s void.own now refuses a void once any line reaches READY: cooked food exists, and
 * writing it off is a manager's call. This file asserts the CLIENT agrees, because the client
 * deciding on its own is how B2 started.
 *
 * The original B2 defect was not a missing permission — it was a button that rendered on
 * permission alone and then failed at the server with
 * `403 {"title":"FORBIDDEN","detail":"Not permitted: pos.void"}`. Tightening the policy without
 * teaching the client re-creates that exact defect one status later: `order.status` is still
 * SENT_TO_KDS on a plated check (it has not tracked kitchen progress since fc6f389f, and no value
 * in the enum distinguishes plated from fired), and `amountPaidPaisa` is still 0, so every gate
 * the old dialog knew about still says "offer Void".
 *
 * The pairing these cases assert — the SENTENCE the operator reads against the CONTROLS on their
 * screen, in one render — is the F13 pattern from void-refund-notice-persona.test.tsx, and for
 * the same reason: asserting either half alone is how the last one survived.
 *
 * Falsification: drop the `!anyLinePlated` term from `canVoidOwn` in void-refund-dialog.tsx and
 * "the Void button is withdrawn" fails on the button still being in the document.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

const { getPaymentsMock } = vi.hoisted(() => ({ getPaymentsMock: vi.fn() }));
vi.mock("@/lib/repositories/pos.repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repositories/pos.repository")>();
  return {
    ...actual,
    PosRepository: { ...actual.PosRepository, getPayments: getPaymentsMock },
  };
});

const ORDER_ID = "d1000002-0000-4000-8000-000000000002";
const TOTAL_PAISA = 52395; // ORD-20260812-0340, the check this was measured on.

/** The seeded cashier at Floating Terrace — holds void.own, not void.any, not refund. */
const CASHIER_PERMISSIONS = [
  "pos.menu.view",
  "pos.order.close",
  "pos.order.create",
  "pos.order.send_to_kds",
  "pos.order.update",
  "pos.order.view",
  "pos.order.void.own",
  "pos.till.close",
  "pos.till.open",
];

function makeLine(itemStatus: OrderItem["itemStatus"], id: string): OrderItem {
  return {
    id,
    menuItemId: "e0000001-0000-4000-8000-000000000001",
    itemNameSnapshot: "Chicken Karahi",
    unitPriceSnapshot: TOTAL_PAISA,
    quantity: 1,
    kdsStation: "PANTRY1",
    itemStatus,
    revisionNo: 1,
    firedAt: "2026-08-12T05:01:50Z",
    discountPaisa: 0,
    taxPaisa: 0,
    lineTotalPaisa: TOTAL_PAISA,
    notes: null,
    modifiers: [],
  };
}

/**
 * A fired, UNPAID check. Every field except the line statuses is held constant across the cases
 * below, so a difference in outcome is attributable to the kitchen and nothing else — in
 * particular `status` stays SENT_TO_KDS throughout, which is the whole point: it does not move.
 */
function makeOrder(items: OrderItem[]): Order {
  return {
    id: ORDER_ID,
    branchId: "b0000001-0000-4000-8000-000000000001",
    orderNo: "ORD-20260812-0340",
    type: "DINE_IN",
    status: "SENT_TO_KDS",
    derivedStatus: "IN_PROGRESS",
    tableId: "f0000001-0000-4000-8000-000000000001",
    coverCount: 2,
    cashierId: null,
    customerId: null,
    subtotalPaisa: TOTAL_PAISA,
    taxPaisa: 0,
    discountPaisa: 0,
    serviceChargePaisa: 0,
    serviceChargePct: 0,
    serviceChargeLabel: null,
    totalPaisa: TOTAL_PAISA,
    notes: null,
    openedAt: "2026-08-12T05:01:45Z",
    sentToKdsAt: "2026-08-12T05:01:50Z",
    clientOrderId: "c0000001-0000-4000-8000-000000000001",
    version: 0,
    items,
    discounts: [],
  };
}

function renderAs(order: Order) {
  seedSession({ permissions: CASHIER_PERMISSIONS });
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <SettlementActions order={order} />
    </Wrapper>,
  );
}

const platedNotice = () => screen.queryByTestId("void-blocked-plated-notice");

/** Waits for the Void control to appear. Rejects if it never does. */
const findVoidButton = (timeout = 1500) =>
  screen.findByRole("button", { name: /void order/i }, { timeout });

/*
 * Asserting the Void button is ABSENT is the whole point of this file, and it is the assertion
 * most easily written so that it cannot fail.
 *
 * `waitFor(() => expect(queryByRole(...)).not.toBeInTheDocument())` returns on the FIRST frame,
 * and on the first frame `paymentsLoading` is still true, so `canVoidOwn` is false and the button
 * is missing for a reason that has nothing to do with the kitchen. Written that way all six cases
 * here passed with the `!anyLinePlated` guard deleted — the exact vacuity this change was raised
 * to remove, reproduced inside the test written to prevent it.
 *
 * This instead WAITS for the button and fails if it ever arrives, so the payments query has
 * settled and `canVoidOwn` has been evaluated for real before the assertion can succeed.
 */
async function expectVoidNeverAppears() {
  await expect(findVoidButton(400)).rejects.toThrow();
}

describe("B2 — the Void control stops at the pass", () => {
  beforeEach(() => {
    // Nothing tendered. The money gate must not be what withdraws the button in these cases.
    getPaymentsMock.mockResolvedValue([]);
  });
  afterEach(() => {
    clearSession();
    getPaymentsMock.mockReset();
  });

  describe("a line the kitchen has plated", () => {
    it("withdraws the Void button and says whose job it is", async () => {
      renderAs(makeOrder([makeLine("READY", "1a000001-0000-4000-8000-000000000001")]));

      const node = await screen.findByTestId("void-blocked-plated-notice");
      expect(node.textContent ?? "").toMatch(/a manager must void this check/i);
      // The sentence names a manager; the control genuinely is not there for this reader.
      await expectVoidNeverAppears();
    });

    it("still withdraws it once the food has been carried to the table", async () => {
      renderAs(makeOrder([makeLine("SERVED", "1a000002-0000-4000-8000-000000000002")]));

      expect(await screen.findByTestId("void-blocked-plated-notice")).toBeInTheDocument();
      await expectVoidNeverAppears();
    });

    // The real ORD-20260812-0340 shape: one line up, one still cooking. Partial is enough —
    // food that exists cannot be un-cooked by the state of the line beside it.
    it("withdraws it when only SOME of the check is up", async () => {
      renderAs(
        makeOrder([
          makeLine("READY", "1a000003-0000-4000-8000-000000000003"),
          makeLine("PREPARING", "1a000004-0000-4000-8000-000000000004"),
        ]),
      );

      expect(await screen.findByTestId("void-blocked-plated-notice")).toBeInTheDocument();
      await expectVoidNeverAppears();
    });
  });

  /*
   * The controls. Without these, every assertion above would also be satisfied by a dialog that
   * had simply stopped offering Void at all — which is the failure B2 exists to prevent, and
   * which cost this restaurant 133 uncloseable orders the first time.
   */
  describe("a check the kitchen has NOT plated", () => {
    it("still offers Void while the lines are only cooking", async () => {
      renderAs(makeOrder([makeLine("PREPARING", "1a000005-0000-4000-8000-000000000005")]));

      expect(await findVoidButton()).toBeInTheDocument();
      expect(platedNotice()).not.toBeInTheDocument();
    });

    it("still offers Void on a freshly fired check", async () => {
      renderAs(makeOrder([makeLine("SENT", "1a000006-0000-4000-8000-000000000006")]));

      expect(await findVoidButton()).toBeInTheDocument();
      expect(platedNotice()).not.toBeInTheDocument();
    });

    // A cancelled line is not food anyone can serve. This mirrors the server's exclusion of
    // CANCELLED in OrderStatusDerivationService.anyLinePlated — the two must agree, or the
    // button and the policy disagree about the same check.
    it("still offers Void when the only advanced line was cancelled", async () => {
      renderAs(makeOrder([makeLine("CANCELLED", "1a000007-0000-4000-8000-000000000007")]));

      expect(await findVoidButton()).toBeInTheDocument();
      expect(platedNotice()).not.toBeInTheDocument();
    });
  });
});
