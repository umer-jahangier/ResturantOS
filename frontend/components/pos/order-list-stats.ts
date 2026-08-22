import { isUuid } from "@/components/ui/data-grid/columns";
import type { OrderSummary, PaymentStatus } from "@/lib/models/pos.model";

/**
 * The numbers under the Order Management title, and the rule that keeps them honest (38-06).
 *
 * <h3>The pattern being adopted, and the half of it that is dangerous</h3>
 *
 * The demo's back-office grammar is a title over a `·`-separated stat line —
 * *"127 orders today · $4,218 revenue · 3 active"* (DEMO-SCREENS §5). It is adopted because it
 * answers, in one line, the question a manager opens this tab to ask. It is also the single
 * easiest place in the product to ship a confident lie: a subtitle is read as a summary OF THE
 * TABLE, and nothing enforces that it is one.
 *
 * <h3>Therefore: every figure is computed from the ROWS THAT ARE ON SCREEN, and nothing else</h3>
 *
 * Not from a second endpoint, not from a day aggregate, not from the page the user happens to be
 * looking at. `summariseOrders` takes the exact array handed to `DataGrid` and returns three
 * numbers a reader can verify by counting:
 *
 * | stat | reconciles against |
 * |---|---|
 * | `listed` | `DataGrid`'s own `{n} rows` count line (`data-testid="data-grid-count"`) |
 * | `totalPaisa` | the sum of the visible **Total** column |
 * | `unpaid` | the count of **Payment** badges that read neither Paid nor Refunded |
 *
 * Each of the three is checkable against a column that is rendered a few pixels below it. That is
 * the property that matters: a subtitle disagreeing with the table under it is worse than no
 * subtitle, because it teaches the reader that neither number can be trusted.
 *
 * <h3>What is deliberately NOT said, and why (D-38-16)</h3>
 *
 * The demo says *"127 orders today"* and *"$4,218 revenue"*. **This system cannot say either
 * here.** `GET /api/v1/pos/orders` accepts `branchId`, `status[]`, `q` and a `Pageable` — there
 * is no date parameter (`OrderController.listOrders`), and the default listing is *every
 * non-terminal status except DRAFT* regardless of trading day. So the fetched array is "the
 * checks that are open right now", which is neither today's volume nor today's revenue. Printing
 * the demo's two words over this array would have produced a figure that is wrong by however many
 * checks were closed before the tab was opened — and wrong in the flattering direction.
 *
 * The wording therefore states its own scope: **listed**, **across them**. A number this system
 * cannot compute is rendered as an absence, never as a figure.
 */

export interface OrderListStats {
  /** Rows handed to the grid — the same number the grid's count line prints. */
  listed: number;
  /** Sum of `totalPaisa` over those rows. Paisa; rendered ONLY through `MoneyDisplay`. */
  totalPaisa: number;
  /** Rows whose payment status is neither `PAID` nor `REFUNDED`. */
  unpaid: number;
}

/**
 * `REFUNDED` is not unpaid: money moved, and then moved back. Folding it into "unpaid" would put
 * a settled refund in the same bucket as a check still owing, which is the one distinction a
 * manager scanning this line is making.
 */
const SETTLED_PAYMENT: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>(["PAID", "REFUNDED"]);

export function summariseOrders(rows: readonly OrderSummary[]): OrderListStats {
  let totalPaisa = 0;
  let unpaid = 0;
  for (const row of rows) {
    totalPaisa += row.totalPaisa;
    if (!SETTLED_PAYMENT.has(row.paymentStatus)) unpaid += 1;
  }
  return { listed: rows.length, totalPaisa, unpaid };
}

/** The word for the count, so `1 orders listed` cannot be rendered. */
export function orderCountLabel(listed: number): string {
  return `${listed} ${listed === 1 ? "order" : "orders"} listed`;
}

export function unpaidLabel(unpaid: number): string {
  return `${unpaid} unpaid`;
}

/**
 * What the identifier column may print (UI-SPEC §7.2, plan 38-06 task 3).
 *
 * <p>An order number or nothing. A UUID is never a human identifier: the purchase-order list
 * shipped `ca6ed037…` under a heading reading "PO number", and a list in which no row can be
 * identified is not a list. `orderNo` is null until the first `addItem` flips a DRAFT to OPEN, so
 * the honest answer for a shell check is the words `New Order` — which is what this screen has
 * always printed and what its tests assert.
 *
 * <p>The `isUuid` branch is not defensive noise. The order id IS a UUID and sits one property
 * away on the same object; the failure mode this guards is a future edit reaching for
 * `orderId` when `orderNo` is absent, which reads as a fix and is the defect.
 */
export function orderIdentifier(orderNo: string | null): { text: string; isReal: boolean } {
  if (!orderNo || orderNo.trim() === "" || isUuid(orderNo)) {
    return { text: "New Order", isReal: false };
  }
  return { text: orderNo, isReal: true };
}
