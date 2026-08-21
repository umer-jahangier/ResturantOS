import { MoneyDisplay } from "@/components/ui/money-display";

/**
 * One side of a double entry, in a grid cell.
 *
 * <h3>Zero is an em dash, not `Rs 0.00`</h3>
 *
 * Every journal line carries a debit column and a credit column and exactly one of them is
 * populated. A zero here is therefore the ABSENCE of a movement, not a movement of nothing —
 * and printing `Rs 0.00` down half of a ledger's numeric columns is how a reader stops being
 * able to see, at a glance, which side an entry fell on.
 *
 * <p>Replaces `DrCrCell`, which returned a bare `<td>` and so could only ever live inside a
 * hand-rolled table. `DataGrid` owns the cell; this owns what is in it.
 */
export function DrCrAmount({ paisa }: { paisa: number }) {
  if (paisa === 0) {
    return (
      <span className="block text-right tabular-nums text-foreground-tertiary" aria-label="none">
        —
      </span>
    );
  }
  return (
    <span className="block text-right">
      <MoneyDisplay paisa={paisa} />
    </span>
  );
}
