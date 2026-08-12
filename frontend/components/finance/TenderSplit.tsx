"use client";

import { formatPaisa } from "@/lib/adapters/shared";
import type { TenderLine } from "@/lib/models/takings.model";

const METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  CARD: "Card",
  WALLET: "Wallet",
  HOUSE_ACCOUNT: "House account",
};

function label(method: string): string {
  return METHOD_LABEL[method] ?? method;
}

/**
 * How the day's money arrived (D-37-02).
 *
 * <h3>A method with no rows is ABSENT, not present at zero</h3>
 *
 * "No card sales today" and "we did not record card sales today" are different statements, and
 * this component is not in a position to tell them apart — so it makes neither. It lists exactly
 * the methods the server observed. Padding the list out to a fixed set of tenders, each zeroed,
 * would be this screen inventing a fact about every tender the restaurant does not take.
 *
 * The tender lines are shown against net sales, which they should sum to. This component does NOT
 * perform that sum: the server states both, and a client-side check that silently disagreed would
 * leave the owner with two numbers and no way to know which to believe.
 *
 * <h3>"Of which not closed" is a SUBSET column, not another row</h3>
 *
 * Every amount here is money that arrived today, whether or not its bill has been finalised
 * (S0-02: it used to be neither shown nor mentioned). The right-hand column says how much of the
 * SAME figure is sitting against an order still open. A second row would read as more money and
 * invite an addition that double-counts it, so it is a column on the line it qualifies.
 */
export function TenderSplit({ lines }: { lines: TenderLine[] }) {
  if (lines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="tender-split-empty">
        No payments were taken on this day.
      </p>
    );
  }

  return (
    <table className="w-full text-sm" data-testid="tender-split">
      <thead>
        <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className="pb-2 font-medium">Tender</th>
          <th className="pb-2 text-right font-medium">Payments</th>
          <th className="pb-2 text-right font-medium">Amount</th>
          <th
            className="pb-2 text-right font-medium"
            title="Part of the same amount, taken against orders that have not been closed yet. Not extra money — do not add it on."
          >
            Of which on open orders
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr
            key={line.method}
            className="border-b last:border-0"
            data-testid={`tender-row-${line.method}`}
          >
            <td className="py-2 font-medium">{label(line.method)}</td>
            <td className="py-2 text-right tabular-nums text-muted-foreground">
              {line.paymentCount}
            </td>
            <td
              className="py-2 text-right font-mono tabular-nums"
              data-paisa={line.amountPaisa}
              data-testid={`tender-amount-${line.method}`}
            >
              {formatPaisa(line.amountPaisa)}
            </td>
            {/* An em dash, not "Rs 0.00": nothing outstanding is the ordinary state of a settled
                line, and a zero in a money column reads as a figure somebody computed. */}
            <td
              className="py-2 text-right font-mono tabular-nums text-muted-foreground"
              data-paisa={line.unclosedAmountPaisa}
              data-testid={`tender-unclosed-${line.method}`}
            >
              {line.unclosedAmountPaisa > 0 ? (
                <>
                  {formatPaisa(line.unclosedAmountPaisa)}
                  <span className="ml-1 text-label">
                    ({line.unclosedPaymentCount})
                  </span>
                </>
              ) : (
                <span aria-label="none">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
