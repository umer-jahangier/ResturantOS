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
 *
 * <h3>…and the em dash is not the channel that carries that to a screen reader</h3>
 *
 * The zero branch used to read `<span … aria-label="none">—</span>`, which delivered the intent
 * above to nobody. A `<span>` with no role is ARIA's `generic`, a role that does **not** support
 * naming from the author, so `aria-label` is prohibited on it (ARIA 1.2 §5.2.8.4; axe-core's
 * `aria-prohibited-attr`) and assistive tech is entitled to drop it — as an em dash alone is
 * punctuation a screen reader routinely does not speak, the cell announced *nothing at all*,
 * which reads as an empty cell rather than as a side that did not move. And on any AT that did
 * honour the attribute, the cell was named the literal word "none": a string that reads far more
 * like a mistaken attempt to say "no label" than like an accounting fact.
 *
 * <p>So the two audiences are served by two elements. The dash is `aria-hidden` — it is
 * typography, not information, exactly as `stat-tile.tsx` treats its unavailable dash — and the
 * fact is carried by real text that is only visually hidden.
 *
 * <p><b>Why one word is enough.</b> The hidden text does not name the side, because the cell does
 * not have to: `DataGrid` renders every column header as `<th scope="col">` (its own comment:
 * "a bare `<th>` gives a screen reader no column association"), so the pair is announced as
 * "Debit, None". Naming the side *inside* the cell would mean a `side` prop that can disagree
 * with the header above it — two sources for one fact, and the wrong one 200 rows deep.
 */
export function DrCrAmount({ paisa }: { paisa: number }) {
  if (paisa === 0) {
    return (
      <span className="block text-right tabular-nums text-foreground-tertiary">
        <span aria-hidden="true">—</span>
        <span className="sr-only">None</span>
      </span>
    );
  }
  return (
    <span className="block text-right">
      <MoneyDisplay paisa={paisa} />
    </span>
  );
}
