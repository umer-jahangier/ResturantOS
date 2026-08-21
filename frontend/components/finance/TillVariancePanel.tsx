"use client";

import { FigureValue, UnknownFigure } from "@/components/finance/UnknownFigure";
import { formatPaisa } from "@/lib/adapters/shared";
import type {
  MoneyFigure,
  TillReconciliation,
  TillReconciliationState,
} from "@/lib/models/takings.model";
import { cn } from "@/lib/utils";

/**
 * The five states, each said in a restaurant owner's words.
 *
 * <h3>OPEN and NOT_COUNTED are the whole reason this table exists</h3>
 *
 * Both have a null variance. Collapsing them — which any `variance ?? "—"` does automatically —
 * makes "this shift is still running" and "this shift ended and nobody counted the drawer" look
 * identical. The first is a normal Tuesday evening. The second is money unaccounted for. The
 * server names them apart (37-09) and this table keeps them apart.
 */
const STATE_PRESENTATION: Record<
  TillReconciliationState,
  { label: string; hint: string; className: string }
> = {
  OPEN: {
    label: "Still open",
    hint: "This shift has not ended yet. There is nothing to reconcile until the till is closed.",
    className: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  },
  NOT_COUNTED: {
    label: "Not counted",
    hint: "This till was closed without anyone counting the drawer. Nobody knows whether it matched.",
    className: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  MATCHED: {
    label: "Matched",
    hint: "The drawer counted exactly what the system expected.",
    className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
  OVER: {
    label: "Over",
    hint: "The drawer held MORE than expected. Usually a mis-keyed payment or an uncounted float.",
    className: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  },
  SHORT: {
    label: "Short",
    hint: "The drawer held LESS than expected. This is the one to look at first.",
    className: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  },
};

function presentation(state: string) {
  return (
    STATE_PRESENTATION[state as TillReconciliationState] ?? {
      label: state || "Unrecognised",
      hint: `This build does not recognise the till state "${state}". Treat the figures with care.`,
      className: "bg-muted text-muted-foreground",
    }
  );
}

/**
 * The variance, with the SERVER'S sign, unflipped (T-32-12-D).
 *
 * `variance = declared − expected`, so NEGATIVE is SHORT. Presenting the magnitude and calling it
 * "short" would be a second encoding of the same fact, and the day the two disagree the screen is
 * unfalsifiable. The sign is shown and the word is shown, both from the server's own state.
 *
 * Over and short are visually distinct and NEITHER is an error state. An overage is not a success
 * and a shortfall is not a system fault; both are things a manager investigates.
 */
function VarianceCell({ variance, state }: { variance: MoneyFigure; state: string }) {
  if (variance.state === "UNKNOWN") {
    return <UnknownFigure figure={variance} compact />;
  }
  const short = state === "SHORT";
  const over = state === "OVER";
  return (
    <span
      data-testid="till-variance"
      data-variance-state={state}
      className={cn(
        "font-mono font-semibold tabular-nums",
        short && "text-rose-600 dark:text-rose-400",
        over && "text-indigo-600 dark:text-indigo-400",
        !short && !over && "text-muted-foreground",
      )}
    >
      {variance.paisa > 0 ? "+" : ""}
      {formatPaisa(variance.paisa)}
    </span>
  );
}

export interface TillVariancePanelProps {
  tills: TillReconciliation[];
  /**
   * Cashier id -> display name, where the roster could be read. Decoration only: this panel never
   * withholds a till because it could not name the person, and the roster query is not allowed to
   * take the takings screen down (a manager may hold `pos.till.review` and not `users.view`).
   */
  cashierNames?: Map<string, string>;
  /**
   * The DAY-level statement that no variance is computable at all — cash was taken and no till was
   * ever counted. Distinct from a per-till absence, and shown as a banner rather than a row.
   */
  dayCashVariance?: Extract<MoneyFigure, { state: "UNKNOWN" }> | null;
}

/**
 * Every till of the day, individually (D-37-02, T-32-12-C).
 *
 * <h3>There is no total row, and adding one would be a defect</h3>
 *
 * Two tills out by opposite amounts is TWO problems. An aggregate variance of zero hides both, and
 * the aggregate is the number people would read. So the variances are never summed, never netted,
 * and there is no place in this component where they could be.
 */
export function TillVariancePanel({
  tills,
  cashierNames,
  dayCashVariance,
}: TillVariancePanelProps) {
  return (
    <div className="space-y-3">
      {dayCashVariance && (
        <div
          role="note"
          data-testid="day-cash-variance-unknown"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
        >
          <p className="font-medium">Cash variance for the day: not known</p>
          <p className="mt-0.5 text-muted-foreground">{dayCashVariance.reason}</p>
        </div>
      )}

      {tills.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="tills-empty">
          No till was opened on this day.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="till-panel">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 font-medium">Till</th>
                <th className="pb-2 font-medium">State</th>
                <th className="pb-2 text-right font-medium">Opening float</th>
                <th className="pb-2 text-right font-medium">Expected cash</th>
                <th className="pb-2 text-right font-medium">Counted cash</th>
                <th className="pb-2 text-right font-medium">Variance</th>
              </tr>
            </thead>
            <tbody>
              {tills.map((till) => {
                const p = presentation(till.reconciliationState);
                const cashier =
                  (till.cashierId && cashierNames?.get(till.cashierId)) ||
                  (till.cashierId ? `Cashier ${till.cashierId.slice(0, 8)}` : "Unassigned");
                return (
                  <tr
                    key={till.tillSessionId}
                    className="border-b align-top last:border-0"
                    data-testid={`till-row-${till.tillSessionId}`}
                    data-reconciliation-state={till.reconciliationState}
                  >
                    <td className="py-2.5 pr-3">
                      <span className="block font-medium">{cashier}</span>
                      <span className="block text-xs text-muted-foreground">
                        Opened{" "}
                        {till.openedAt.toLocaleString(undefined, {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                        {till.closedAt
                          ? ` · closed ${till.closedAt.toLocaleString(undefined, {
                              dateStyle: "short",
                              timeStyle: "short",
                            })}`
                          : " · not closed"}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={cn(
                          "inline-block rounded px-1.5 py-0.5 text-xs font-medium",
                          p.className,
                        )}
                        title={p.hint}
                      >
                        {p.label}
                      </span>
                    </td>
                    <td className="py-2.5 text-right font-mono tabular-nums">
                      {formatPaisa(till.openingFloatPaisa)}
                    </td>
                    <td className="py-2.5 text-right">
                      <FigureValue figure={till.expectedClosing} compact className="font-mono" />
                    </td>
                    <td className="py-2.5 text-right">
                      <FigureValue figure={till.declaredClosing} compact className="font-mono" />
                    </td>
                    <td className="py-2.5 text-right">
                      <VarianceCell variance={till.variance} state={till.reconciliationState} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
