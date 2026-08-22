import { describe, expect, it } from "vitest";

import {
  orderCountLabel,
  orderIdentifier,
  summariseOrders,
  unpaidLabel,
} from "@/components/pos/order-list-stats";
import type { OrderSummary, PaymentStatus } from "@/lib/models/pos.model";

/**
 * The header stat line and the identifier rule (38-06 tasks 1–3).
 *
 * <h3>What is actually being protected</h3>
 *
 * A `·`-separated subtitle over a grid is read as a summary OF THAT GRID. Nothing in the type
 * system enforces that it is one — the figures could just as easily come from a second endpoint,
 * a day aggregate, or the current page — and a subtitle that disagrees with the table under it is
 * worse than no subtitle, because it teaches the reader that neither number can be trusted.
 * These assertions pin the arithmetic to the exact array the grid is handed.
 *
 * <h3>Negative controls, observed</h3>
 *
 * 1. **Identifier (plan 38-06 control 4).** The `isUuid(orderNo)` clause was removed, so a UUID
 *    fell through as if it were an order number → RED: *"expected { …(2) } to deeply equal
 *    { text: 'New Order', isReal: false }"*. Restored.
 * 2. **Reconciliation.** `summariseOrders` was changed to sum `amountPaidPaisa` instead of
 *    `totalPaisa` — the plausible mistake, since both are money on the same row → RED:
 *    *"expected 9000 to be 35000"*. Restored.
 * 3. **Unpaid.** `SETTLED_PAYMENT` was reduced to `PAID` alone, folding a refund into "unpaid"
 *    → RED: *"expected 3 to be 2"*. Restored.
 */

function row(over: Partial<OrderSummary> & { paymentStatus: PaymentStatus }): OrderSummary {
  return {
    orderId: "d1000001-0000-4000-8000-000000000001",
    orderNo: "ORD-1",
    tableId: null,
    tableName: null,
    type: "DINE_IN",
    derivedStatus: "IN_PROGRESS",
    cashierId: null,
    cashierName: null,
    coverCount: 1,
    totalPaisa: 0,
    openedAt: null,
    settlementStatus: "OPEN",
    amountPaidPaisa: 0,
    itemQuantity: 1,
    distinctItemCount: 1,
    settlement: null,
    ...over,
  };
}

describe("summariseOrders — the subtitle reconciles with the grid beneath it", () => {
  it("counts the rows it was given, never a page or a server total", () => {
    const rows = [
      row({ paymentStatus: "UNPAID", totalPaisa: 10_000 }),
      row({ paymentStatus: "PAID", totalPaisa: 25_000 }),
      row({ paymentStatus: "PARTIALLY_PAID", totalPaisa: 5_000 }),
    ];
    expect(summariseOrders(rows).listed).toBe(rows.length);
  });

  it("sums the SAME field the Total column renders, so the money agrees column-for-row", () => {
    const rows = [
      row({ paymentStatus: "UNPAID", totalPaisa: 10_000, amountPaidPaisa: 0 }),
      // A part-paid row: `totalPaisa` and `amountPaidPaisa` differ, which is what makes summing
      // the wrong one a silent error rather than an obvious one.
      row({ paymentStatus: "PARTIALLY_PAID", totalPaisa: 25_000, amountPaidPaisa: 9_000 }),
    ];
    expect(summariseOrders(rows).totalPaisa).toBe(35_000);
  });

  it("counts unpaid as UNPAID + PARTIALLY_PAID — a refund is settled, not owing", () => {
    const rows = [
      row({ paymentStatus: "UNPAID" }),
      row({ paymentStatus: "PARTIALLY_PAID" }),
      row({ paymentStatus: "PAID" }),
      row({ paymentStatus: "REFUNDED" }),
    ];
    expect(summariseOrders(rows).unpaid).toBe(2);
  });

  it("an empty list summarises to zeros, not to an absence", () => {
    expect(summariseOrders([])).toEqual({ listed: 0, totalPaisa: 0, unpaid: 0 });
  });

  it("never renders `1 orders`", () => {
    expect(orderCountLabel(1)).toBe("1 order listed");
    expect(orderCountLabel(0)).toBe("0 orders listed");
    expect(orderCountLabel(12)).toBe("12 orders listed");
    expect(unpaidLabel(3)).toBe("3 unpaid");
  });
});

describe("orderIdentifier — a UUID is never a human identifier (UI-SPEC §7.2)", () => {
  it("renders the order number when there is one", () => {
    expect(orderIdentifier("ORD-20260812-0026")).toEqual({
      text: "ORD-20260812-0026",
      isReal: true,
    });
  });

  it("refuses a UUID, even though the order id is one and sits on the same object", () => {
    expect(orderIdentifier("d1000001-0000-4000-8000-000000000001")).toEqual({
      text: "New Order",
      isReal: false,
    });
  });

  it("says `New Order` for a check that has not earned a number yet", () => {
    // A DRAFT before its first addItem has no number, no lines and no total — the honest answer
    // is the words, not a blank cell and certainly not the id.
    expect(orderIdentifier(null).text).toBe("New Order");
    expect(orderIdentifier("   ").text).toBe("New Order");
  });
});
