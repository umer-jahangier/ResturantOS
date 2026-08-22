"use client";

import { FigureValue, UnknownFigure } from "@/components/finance/UnknownFigure";
import { MoneyDisplay } from "@/components/ui/money-display";
import type {
  MoneyFigure,
  TillReconciliation,
  TillReconciliationState,
} from "@/lib/models/takings.model";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format/locale";

/**
 * `12/08/2026, 23:30` — a till row carries an opened AND a closed stamp on one line, so the
 * numeric date is the only form that fits without wrapping. Rendered through the pinned
 * formatter, so a manager reading a variance is reading the BRANCH's clock, not the server's:
 * a till opened 23:30 in Karachi must not be filed under the previous day.
 */
const SHORT_STAMP: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" };

/**
 * The five states, each said in a restaurant owner's words.
 *
 * <h3>OPEN and NOT_COUNTED are the whole reason this table exists</h3>
 *
 * Both have a null variance. Collapsing them — which any `variance ?? "—"` does automatically —
 * makes "this shift is still running" and "this shift ended and nobody counted the drawer" look
 * identical. The first is a normal Tuesday evening. The second is money unaccounted for. The
 * server names them apart (37-09) and this table keeps them apart.
 *
 * <h3>Why the hues are tokens now, and which token each state got (38-08 task 7)</h3>
 *
 * This map carried **twenty of the twenty-six raw palette literals** in the file — `bg-sky-50
 * text-sky-700 dark:bg-sky-950 dark:text-sky-300` and four more like it. Raw palette classes
 * follow neither the theme nor `--brand-h`, so the one table in the product that decides whether
 * a drawer is short would not have moved when the identity did.
 *
 * The mapping had to change shape, not just spelling, because the semantic set has five usable
 * hues and the old one used five arbitrary ones:
 *
 * | state | token | why |
 * |---|---|---|
 * | `OPEN` | muted | nothing has gone wrong and nothing is due yet — the quietest state on the table |
 * | `NOT_COUNTED` | warning | a closed drawer nobody counted. Not a fault of the system; a job not done |
 * | `MATCHED` | success | the only state that needs no action |
 * | `OVER` | info | a discrepancy to investigate. **Not** an error: an overage is not a success and not a fault |
 * | `SHORT` | destructive | the one to look at first |
 *
 * <p>None of the five is carried by hue alone: every chip prints its label, every chip has a
 * `title` explaining the state in a sentence, and the variance column prints an explicit sign.
 */
const STATE_PRESENTATION: Record<
  TillReconciliationState,
  { label: string; hint: string; className: string }
> = {
  OPEN: {
    label: "Still open",
    hint: "This shift has not ended yet. There is nothing to reconcile until the till is closed.",
    className: "bg-muted text-muted-foreground border-border",
  },
  NOT_COUNTED: {
    label: "Not counted",
    hint: "This till was closed without anyone counting the drawer. Nobody knows whether it matched.",
    className: "bg-warning/15 text-warning border-warning/30",
  },
  MATCHED: {
    label: "Matched",
    hint: "The drawer counted exactly what the system expected.",
    className: "bg-success/15 text-success border-success/30",
  },
  OVER: {
    label: "Over",
    hint: "The drawer held MORE than expected. Usually a mis-keyed payment or an uncounted float.",
    className: "bg-info/15 text-info border-info/30",
  },
  SHORT: {
    label: "Short",
    hint: "The drawer held LESS than expected. This is the one to look at first.",
    className: "bg-destructive/15 text-destructive border-destructive/30",
  },
};

function presentation(state: string) {
  return (
    STATE_PRESENTATION[state as TillReconciliationState] ?? {
      label: state || "Unrecognised",
      hint: `This build does not recognise the till state "${state}". Treat the figures with care.`,
      className: "bg-muted text-muted-foreground border-border",
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
 *
 * <p>The sign is now a CHARACTER on both sides — `MoneyDisplay`'s `signed` face — rather than a
 * `+` on positives and a hue on negatives. Same rule as everywhere else in this plan: a figure's
 * direction cannot be a colour, because a colour does not survive a photocopy.
 */
function VarianceCell({ variance, state }: { variance: MoneyFigure; state: string }) {
  if (variance.state === "UNKNOWN") {
    return <UnknownFigure figure={variance} compact />;
  }
  const short = state === "SHORT";
  const over = state === "OVER";
  // The tone class stays on the OUTER span — the one carrying `data-testid="till-variance"` —
  // because `DailyTakings.test.tsx:497` proves OVER and SHORT are visually distinct by comparing
  // that element's `className` between the two rows. Moving the class inside would leave both
  // comparands empty and the assertion would pass while proving nothing.
  return (
    <span
      data-testid="till-variance"
      data-variance-state={state}
      className={cn(
        "font-semibold",
        short && "text-destructive",
        over && "text-info",
        !short && !over && "text-muted-foreground",
      )}
    >
      <MoneyDisplay paisa={variance.paisa} sign="signed" className="font-semibold" />
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
 * and there is no place in this component where they could be. `__tests__/components/finance/
 * takings-honesty.test.tsx` asserts this, so a later refactor cannot quietly add one.
 *
 * <h3>Why this is still a hand-rolled `<table>` after 38-08 (a recorded finding, not an omission)</h3>
 *
 * `DataGrid` has no per-row attribute hook — only `rowClassName`, which returns a class string.
 * This table's rows carry `data-testid="till-row-<id>"` and `data-reconciliation-state`, and
 * `e2e/journeys/finance-daily-takings.spec.ts:74-80` locates the seeded overage as
 * `page.locator('[data-reconciliation-state="OVER"]')` and then reads three cells *inside that
 * row*. Moving the attribute onto a span inside the first cell would leave that locator matching
 * an element that does not contain the variance, the expected cash or the counted cash — the
 * assertion would still run, and would then be asserting nothing. Under "every existing
 * `data-testid` is load-bearing", the grid migration for this table is blocked on the primitive,
 * not on this file. The G4 baseline entry stays at 1 and does not grow.
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
          className="rounded-md border border-warning/40 bg-warning/10 p-3 text-small"
        >
          <p className="font-medium">Cash variance for the day: not known</p>
          <p className="mt-0.5 text-muted-foreground">{dayCashVariance.reason}</p>
        </div>
      )}

      {tills.length === 0 ? (
        <p className="text-small text-muted-foreground" data-testid="tills-empty">
          No till was opened on this day.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-small" data-testid="till-panel">
            <thead>
              <tr className="border-b text-left text-label uppercase tracking-wide text-muted-foreground">
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
                      <span className="block text-label text-muted-foreground">
                        Opened {formatDateTime(till.openedAt, SHORT_STAMP)}
                        {till.closedAt
                          ? ` · closed ${formatDateTime(till.closedAt, SHORT_STAMP)}`
                          : " · not closed"}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={cn(
                          "inline-block rounded-md border px-1.5 py-0.5 text-label font-medium",
                          p.className,
                        )}
                        title={p.hint}
                      >
                        {p.label}
                      </span>
                    </td>
                    <td className="py-2.5 text-right">
                      <MoneyDisplay paisa={till.openingFloatPaisa} />
                    </td>
                    <td className="py-2.5 text-right">
                      <FigureValue figure={till.expectedClosing} compact />
                    </td>
                    <td className="py-2.5 text-right">
                      <FigureValue figure={till.declaredClosing} compact />
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
