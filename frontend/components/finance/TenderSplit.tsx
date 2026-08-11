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
            <td className="py-2 text-right font-mono tabular-nums">
              {formatPaisa(line.amountPaisa)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
