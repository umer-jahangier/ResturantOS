import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The demo's `.fin-stat-row` / `.fin-stat-row.total` (`Docs/NEXUS_ERP_Demo.html:409-415, 440-446`),
 * carried across as GRAMMAR ONLY (D-38-15, D-38-16).
 *
 * <h3>What is adopted, and what is emphatically not</h3>
 *
 * The demo's Finance panel is the most dangerous card in the file. Its seven-line P&L —
 * Gross Revenue, COGS, Gross Profit, Labour, Rent, Other OpEx, Net Income — is internally
 * perfect and **entirely uncomputable in this system**: D-38-16 names COGS, Net Income and Net
 * Margin as resting on `sales_item_facts.cogs_paisa`, which is NULL for every row. Painting that
 * card would re-introduce, with better typography, the exact defect three separate guards in this
 * codebase already exist to prevent.
 *
 * So what crosses over is the FORMATTING VOCABULARY and nothing else:
 *
 * <ol>
 * <li>a label on the left and a right-aligned figure, on a hairline;</li>
 * <li>deductions in accounting parentheses ({@link MoneyDisplay}'s `sign="accounting"`);</li>
 * <li>a total escalated by a heavier rule above it, a heavier label and a larger figure.</li>
 * </ol>
 *
 * and it is applied to figures we actually hold — an AR/AP aging total, a register's net for a
 * filtered range — never to a P&L line this product cannot state.
 *
 * <h3>Why the total sits outside the grid rather than in a `<tfoot>`</h3>
 *
 * `DataGrid` paginates. A footer row inside a paginated body would either repeat per page (a
 * total that is not the total) or read as a further data row a user could sort against. Stated
 * beneath the grid, with its own rule and its own words, the total says what it is the total OF —
 * which is the only way an aging total is safe to print at all.
 *
 * <p>It takes a ready-made node, not a number: this component does no arithmetic, ever. Every
 * total it renders is one the server stated.
 */
export function LedgerTotalRow({
  label,
  value,
  note,
  className,
  "data-testid": testId,
}: {
  /** What the figure totals, in the reader's words — "Total payables". */
  label: string;
  /** Already-rendered money. A `<MoneyDisplay>`, never a raw string a caller formatted. */
  value: React.ReactNode;
  /** One line stating what the total covers, when that is not obvious from the label. */
  note?: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <div
      data-slot="ledger-total"
      data-testid={testId}
      className={cn(
        // `border-t-2` IS the demo's `--border-2` escalation: heavier than the row hairlines
        // above it, which is how an accountant draws a bottom line.
        "flex flex-wrap items-baseline justify-between gap-(--space-sm) border-t-2 border-border pt-(--space-md)",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-body font-semibold text-foreground">{label}</p>
        {note ? <p className="text-small text-foreground-tertiary">{note}</p> : null}
      </div>
      <div className="text-h2 font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

/**
 * One non-total ledger line — the demo's plain `.fin-stat-row`.
 *
 * Used where a figure genuinely exists and belongs in a stack rather than a grid: a transaction
 * expansion's order breakdown, a run's labour cost. If the figure cannot be computed, this is the
 * wrong component — use `StatTile`'s `unavailableReason`, which the type system will not let you
 * pair with a value.
 */
export function LedgerStatRow({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="ledger-row"
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-(--space-sm) border-b border-border py-2 last:border-b-0",
        className,
      )}
    >
      <span className="text-small text-foreground-secondary">{label}</span>
      <span className="text-body font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}
