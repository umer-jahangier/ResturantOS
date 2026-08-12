import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { SettlementActions } from "@/components/pos/settlement-actions";
import { ApiError } from "@/lib/errors/api-error";
import type { Order } from "@/lib/models/pos.model";

/*
 * F13 — "on a paid check the cashier is told 'Use Refund' and the Refund button is invisible".
 *
 * Reproduced in Chromium first (frontend/e2e/floor/F13/01-repro.mjs, ORD-20260812-0221, cash
 * Rs 998.00 taken by clicking the charge page):
 *
 *   cashier@terrace.local  notice "Paid — void unavailable. Use Refund."   refundTrigger false
 *   manager@terrace.local  notice "Paid — void unavailable. Use Refund."   refundTrigger true
 *
 * These cases assert the SENTENCE THE USER READS against the CONTROLS ON THEIR SCREEN, in the
 * same render — which is the only pairing that can catch this class of defect. Asserting the
 * notice's props, or asserting the copy without asserting the button, is how it survived.
 *
 * Falsification: with the fix reverted, "the cashier is not told to press Refund" fails on
 *   AssertionError: expected 'Paid — void unavailable. Use Refund.' not to match /use refund/i
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

const { getPaymentsMock, voidOrderMock } = vi.hoisted(() => ({
  getPaymentsMock: vi.fn(),
  voidOrderMock: vi.fn(),
}));
vi.mock("@/lib/repositories/pos.repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repositories/pos.repository")>();
  return {
    ...actual,
    PosRepository: {
      ...actual.PosRepository,
      getPayments: getPaymentsMock,
      voidOrder: voidOrderMock,
    },
  };
});

const ORDER_ID = "d1000001-0000-4000-8000-000000000001";
const TOTAL_PAISA = 99800; // Rs 998.00 — the live check this was reproduced on.

/** The real cashier role at Floating Terrace, verbatim off the seeded token (no refund code). */
const CASHIER_PERMISSIONS = [
  "pos.menu.view",
  "pos.order.close",
  "pos.order.create",
  "pos.order.discount.line",
  "pos.order.send_to_kds",
  "pos.order.update",
  "pos.order.view",
  "pos.order.void.own",
  "pos.tables.manage",
  "pos.till.close",
  "pos.till.open",
];
const MANAGER_PERMISSIONS = [...CASHIER_PERMISSIONS, "pos.order.refund", "pos.order.void.any"];

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: ORDER_ID,
    branchId: "b0000001-0000-4000-8000-000000000001",
    orderNo: "ORD-20260812-0221",
    type: "TAKEAWAY",
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
    totalPaisa: TOTAL_PAISA,
    notes: null,
    openedAt: "2026-08-12T05:01:45Z",
    sentToKdsAt: "2026-08-12T05:01:50Z",
    clientOrderId: "c0000001-0000-4000-8000-000000000001",
    version: 0,
    items: [],
    discounts: [],
    ...overrides,
  };
}

function paidInFull() {
  return [
    {
      id: "p0000001-0000-4000-8000-000000000001",
      method: "CASH",
      amountPaisa: TOTAL_PAISA,
      tenderedPaisa: TOTAL_PAISA,
      changePaisa: 0,
      referenceNo: null,
      recordedAt: "2026-08-12T05:01:59Z",
      kind: "PAYMENT",
    },
  ];
}

function renderAs(permissions: string[], order: Order) {
  seedSession({ permissions });
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <SettlementActions order={order} />
    </Wrapper>,
  );
}

/** The notice as a human reads it, once the payment query has settled. */
async function notice(): Promise<string> {
  const node = await screen.findByTestId("void-blocked-paid-notice");
  return node.textContent ?? "";
}

const refundButton = () => screen.queryByRole("button", { name: /refund order/i });

describe("F13 — the paid-check notice names who can refund", () => {
  beforeEach(() => {
    getPaymentsMock.mockResolvedValue(paidInFull());
  });
  afterEach(() => {
    clearSession();
    getPaymentsMock.mockReset();
  });

  describe("a cashier, who does not hold pos.order.refund", () => {
    it("is not told to press Refund, because Refund is not on their screen", async () => {
      renderAs(CASHIER_PERMISSIONS, makeOrder());

      const text = await notice();
      // The control genuinely is not there — this is the fact the sentence must not contradict.
      expect(refundButton()).not.toBeInTheDocument();
      expect(text).not.toMatch(/use refund/i);
    });

    it("is told that a manager refunds it", async () => {
      renderAs(CASHIER_PERMISSIONS, makeOrder());
      expect(await notice()).toMatch(/manager/i);
    });

    it("still learns the void was withdrawn because the check is paid", async () => {
      renderAs(CASHIER_PERMISSIONS, makeOrder());
      const text = await notice();
      expect(text).toMatch(/paid/i);
      expect(text).toMatch(/void unavailable/i);
      expect(screen.queryByRole("button", { name: /void order/i })).not.toBeInTheDocument();
    });

    it("on a settled CLOSED check is told a manager can refund, instead of an empty action row", async () => {
      renderAs(CASHIER_PERMISSIONS, makeOrder({ status: "CLOSED", derivedStatus: "SERVED" }));

      const text = await notice();
      expect(text).toMatch(/manager/i);
      expect(text).not.toMatch(/use refund/i);
      expect(refundButton()).not.toBeInTheDocument();
    });
  });

  describe("a manager, who does hold pos.order.refund", () => {
    it("reads it as an instruction, with the Refund button beside it", async () => {
      renderAs(MANAGER_PERMISSIONS, makeOrder());

      const text = await notice();
      expect(text).toMatch(/use refund/i);
      await waitFor(() => expect(refundButton()).toBeInTheDocument());
      // Nobody is sent to find themselves.
      expect(text).not.toMatch(/manager/i);
    });
  });

  /*
   * The permission is NOT widened by this change — that is the whole point. If a cashier ever
   * starts holding pos.order.refund, this case fails and the copy question has to be re-answered
   * rather than silently re-broken.
   */
  it("keeps the refund control behind pos.order.refund for the cashier role", async () => {
    renderAs(CASHIER_PERMISSIONS, makeOrder());
    await notice();
    expect(CASHIER_PERMISSIONS).not.toContain("pos.order.refund");
    expect(refundButton()).not.toBeInTheDocument();
  });
});

/*
 * F13-B — the SAME sentence, in the void-409 error branch 110 lines below the notice.
 *
 * The notice was made persona-aware; this branch was not, and it is reached by an ordinary
 * two-person shift, not a contrivance. Re-driven in Chromium on ORD-20260812-0412 (takeaway,
 * Rs 1,148.00): the cashier fires the check while it is unpaid — Void is genuinely on offer —
 * the manager takes the money on another till, and the cashier's tab, never reloaded, still
 * shows the Void they now press. The server refuses with 409 and the drawer printed:
 *
 *   voidError      "This order has been paid — use Refund. A void would leave the payment in place."
 *   refundTrigger  false
 *
 * (evidence: .planning/audits/floor/F13/r7c-cashier-void-409.png)
 *
 * Note WHY the pairing below has to be asserted in the same render: while the panel is open it
 * REPLACES the trigger row, so the error and the buttons are never on screen together. The
 * sentence therefore cannot be justified by "the button is right there" — it can only be
 * justified by the reader being ABLE to refund at all, which is what `pos.order.refund` says.
 */
describe("F13-B — the void-409 error names who can refund", () => {
  /**
   * The stale [] is the defect's precondition, not a shortcut: this tab's payments query
   * answered before the money landed, which is exactly why it is still offering Void.
   */
  beforeEach(() => {
    getPaymentsMock.mockResolvedValue([]);
    voidOrderMock.mockRejectedValue(
      new ApiError({
        code: "ORDER_ALREADY_PAID",
        message: "Order has payments recorded against it",
        status: 409,
        traceId: null,
        fieldErrors: [],
      }),
    );
  });
  afterEach(() => {
    clearSession();
    getPaymentsMock.mockReset();
    voidOrderMock.mockReset();
  });

  /** Clicks the real path: Void → reason → Confirm Void → server 409. Returns what is printed. */
  async function pressVoidAndReadTheRefusal(permissions: string[]): Promise<string> {
    const user = userEvent.setup();
    renderAs(permissions, makeOrder());

    await user.click(await screen.findByRole("button", { name: /void order/i }));
    await user.type(
      await screen.findByPlaceholderText(/customer left without ordering/i),
      "Guest changed their mind",
    );
    await user.click(screen.getByRole("button", { name: /confirm void/i }));

    const node = await screen.findByTestId("void-error");
    await waitFor(() => expect(voidOrderMock).toHaveBeenCalled());
    return node.textContent ?? "";
  }

  describe("a cashier, who does not hold pos.order.refund", () => {
    it("is not told to press Refund, because Refund is nowhere on their screen", async () => {
      const text = await pressVoidAndReadTheRefusal(CASHIER_PERMISSIONS);

      // The pairing. Asserting the copy alone would pass while the button is still missing.
      expect(refundButton()).not.toBeInTheDocument();
      expect(text).not.toMatch(/use refund/i);
    });

    it("is told that a manager refunds it", async () => {
      const text = await pressVoidAndReadTheRefusal(CASHIER_PERMISSIONS);
      expect(text).toMatch(/manager/i);
      expect(refundButton()).not.toBeInTheDocument();
    });

    it("still learns why the void was refused — money is on the check", async () => {
      const text = await pressVoidAndReadTheRefusal(CASHIER_PERMISSIONS);
      expect(text).toMatch(/paid/i);
      // The reason a void is wrong here, not just that it failed: the payment would survive it.
      expect(text).toMatch(/payment in place/i);
    });
  });

  describe("a manager, who does hold pos.order.refund", () => {
    it("keeps the instruction, because Refund is a thing they can actually do", async () => {
      const text = await pressVoidAndReadTheRefusal(MANAGER_PERMISSIONS);
      expect(text).toMatch(/use refund/i);
      // Nobody is sent to find themselves.
      expect(text).not.toMatch(/manager/i);
      expect(MANAGER_PERMISSIONS).toContain("pos.order.refund");
    });
  });

  it("does not widen pos.order.refund to make the sentence true", async () => {
    await pressVoidAndReadTheRefusal(CASHIER_PERMISSIONS);
    expect(CASHIER_PERMISSIONS).not.toContain("pos.order.refund");
    expect(refundButton()).not.toBeInTheDocument();
  });
});
