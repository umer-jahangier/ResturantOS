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
 *
 * <h3>"Tips" is a column too — but an ADDITION, and the header has to say so</h3>
 *
 * The two middle columns look alike and behave oppositely: `Of which on open orders` is part of
 * `Amount`, `Tips` is on top of it. That is not a detail a reader can be left to infer, so each
 * header carries its own rule rather than relying on the table's shape to imply one.
 *
 * A day total of tips was the alternative and is the wrong figure. A tip's TENDER is the fact:
 * cash tips are in the drawer being counted right now, card tips are with the acquirer. Floating
 * Terrace took Rs 185.00 cash and Rs 300.00 card in tips on one day — a single Rs 485.00 row
 * would send a cashier looking for Rs 300.00 that is not in the drawer. Per tender, the cash line
 * alone reconciles the EXPECTED CASH the till panel below shows, which counts `amount + tip`.
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
          <th className="pb-2 text-right font-medium" title="What settled the bill on this tender. Tips are not in it — they are the next column.">
            Amount
          </th>
          <th
            className="pb-2 text-right font-medium"
            title="Taken ON TOP of the bill for the staff. Extra money, not part of Amount. The cash column is in the drawer and is counted into a till's expected cash; card tips are not."
          >
            Tips (on top)
          </th>
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
            {/* Same em-dash rule as the subset column: most tenders carry no tip and a Rs 0.00
                there reads as a figure somebody worked out. When there IS one it is emphasised
                rather than muted, because on the cash line it is the part of the drawer the
                reader has never been shown before. */}
            <td
              className="py-2 text-right font-mono tabular-nums"
              data-paisa={line.tipPaisa}
              data-testid={`tender-tip-${line.method}`}
            >
              {line.tipPaisa > 0 ? (
                <>+{formatPaisa(line.tipPaisa)}</>
              ) : (
                <span className="text-muted-foreground" aria-label="none">
                  —
                </span>
              )}
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
