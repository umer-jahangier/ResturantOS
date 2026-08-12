import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { SettlementActions } from "@/components/pos/settlement-actions";
import type { Order } from "@/lib/models/pos.model";

/*
 * F14 — "a control must be reachable by the words printed on it" (WCAG 2.5.3, Label in Name).
 *
 * The settlement row is the one place in this product where three destructive-or-irreversible
 * money controls sit side by side, and every one of them had its accessible name supplied by an
 * `aria-label` — an attribute that OVERRIDES the visible text and can therefore drift from it
 * silently. It had already drifted: CHARGE NOW announced itself as "Charge order", so a screen
 * reader said one thing while the glass read another, speech input ("click charge now") matched
 * nothing, and `getByRole("button", { name: /charge now/i })` found nothing. Measured in
 * Chromium's own accessibility tree, not inferred:
 *   CHARGE NOW -> accName "Charge order"  contains=false  getByRole(name:"CHARGE NOW") = 0 hits
 *   Void       -> accName "Void order"    contains=true   (already correct)
 *   Refund     -> accName "Refund order"  contains=true   (already correct)
 *
 * The reason it survived a full test suite is visible in settlement-actions.test.tsx: every
 * assertion there reaches for `getByTestId("charge-now-button")`. A testid is invisible to the
 * user and cannot disagree with anything, so it can never catch this class of defect. This file
 * deliberately queries by the words on the button — the same way an assistive technology does.
 */

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

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
    status: "SENT_TO_KDS",
    derivedStatus: "IN_PROGRESS",
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
    sentToKdsAt: "2026-06-30T00:01:00Z",
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

/**
 * The words a SIGHTED operator reads off the control. Deliberately strips `sr-only` spans and
 * decorative `aria-hidden` icons: those exist precisely to differ between the two channels, and
 * counting them as "visible" would make every assertion below trivially true.
 */
function visibleLabelOf(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.sr-only, [aria-hidden="true"], svg').forEach((n) => n.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Asserts Label in Name THROUGH the accessible-name computation rather than by reading the
 * attribute: the element must be among the results of a role query for the words printed on it.
 * `getAllByRole(..., { name })` is the same accname algorithm assistive technology uses, so a
 * pass here means a screen reader and a speech-input user really can find this control.
 */
function expectFindableByItsOwnLabel(el: HTMLElement) {
  const label = visibleLabelOf(el);
  expect(label, "the control renders some visible text to match against").not.toBe("");
  const byLabel = screen.queryAllByRole("button", {
    name: new RegExp(escapeRe(label), "i"),
  });
  expect(
    byLabel,
    `the button printed "${label}" is not findable by that label — its accessible name is ` +
      `"${el.getAttribute("aria-label") ?? el.textContent}". A screen reader announces the ` +
      `accessible name, and speech input matches it; both disagree with the glass.`,
  ).toContain(el);
}

describe("SettlementActions — label in name (WCAG 2.5.3)", () => {
  beforeEach(() => {
    getPaymentsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    clearSession();
    pushMock.mockClear();
    getPaymentsMock.mockReset();
  });

  it("CHARGE NOW is findable by the words printed on it", async () => {
    renderActions(makeOrder(), ["pos.order.close"]);
    await waitFor(() => expect(screen.getByTestId("charge-now-button")).toBeInTheDocument());

    expect(screen.getAllByRole("button", { name: /charge now/i })).toHaveLength(1);
  });

  it("the Void trigger is findable by the word printed on it", async () => {
    renderActions(makeOrder(), ["pos.order.void.own"]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /void/i })).toBeInTheDocument(),
    );

    const voidBtn = screen.getByRole("button", { name: /void/i });
    expect(visibleLabelOf(voidBtn)).toBe("Void");
    expectFindableByItsOwnLabel(voidBtn);
  });

  it("the Refund trigger is findable by the word printed on it", async () => {
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
    renderActions(makeOrder(), ["pos.order.refund"]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /refund/i })).toBeInTheDocument(),
    );

    const refundBtn = screen.getByRole("button", { name: /refund/i });
    expect(visibleLabelOf(refundBtn)).toBe("Refund");
    expectFindableByItsOwnLabel(refundBtn);
  });

  /*
   * The sweep. Every control the settlement row puts in front of an operator, checked at once, so
   * a FOURTH button added later cannot quietly reintroduce the same override.
   */
  it("every control in the settlement row is findable by the words printed on it", async () => {
    renderActions(makeOrder(), [
      "pos.order.close",
      "pos.order.void.own",
      "pos.order.send_to_kds",
    ]);
    await waitFor(() => expect(screen.getByTestId("charge-now-button")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /void/i })).toBeInTheDocument(),
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const button of buttons) expectFindableByItsOwnLabel(button);
  });
});
