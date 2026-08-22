import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { DrCrAmount } from "@/components/finance/DrCrAmount";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { frontendRoot, stripComments } from "@/__tests__/lib/theme/conformance-scan";

/**
 * `DrCrAmount` — the em dash that stands for "no movement on this side of the entry".
 *
 * <h3>The defect this file pins</h3>
 *
 * The zero branch used to be a bare `<span … aria-label="none">—</span>`. Two things are wrong
 * with that and they point in opposite directions:
 *
 *   · A `<span>` with no role has the implicit ARIA role `generic`, which does **not** support
 *     naming from the author. `aria-label` is *prohibited* there (ARIA 1.2 §5.2.8.4; axe-core
 *     `aria-prohibited-attr`), so assistive tech is entitled to drop it — and an em dash on its
 *     own is punctuation that a screen reader routinely does not speak. The cell announced
 *     **nothing**, which reads as "this cell has no content", not "this side has no movement".
 *   · If some AT *did* honour it, the cell would be named the literal word "none" — a string that
 *     looks far more like a mistaken attempt to say "no label" than like an accounting fact.
 *
 * Either way the file's own stated intent — a zero here is the ABSENCE of a movement, not a
 * movement of nothing — never reached a screen-reader user.
 *
 * <h3>What replaced it, and why the word is only one syllable long</h3>
 *
 * The dash is now `aria-hidden` (it is typography, not information — the same call
 * `stat-tile.tsx` makes for its unavailable dash) and the fact is carried by real, visually
 * hidden text. The word does not have to say "no debit", because the cell does not have to say
 * which column it is in: `DataGrid` renders every header as `<th scope="col">`, so AT announces
 * the cell **with** its column — "Debit, None". Naming the side inside the cell would either
 * duplicate the header or need a prop that can disagree with it.
 *
 * <h3>Negative controls — run, OBSERVED RED, restored</h3>
 *
 * 1. Reverted the component to `aria-label="none"` on the bare span — i.e. the state this file
 *    was written against.
 *    → RED (3 failed / 2 passed): "announces the absence as a word, not as punctuation"
 *      (expected `'None'`, got `'—'`), "keeps the em dash for the eye and hides it from the ear"
 *      (`aria-hidden` was `null`), and "puts no aria-label on a generic span". Restored.
 * 2. Deleted the em dash and left only the hidden word.
 *    → RED (1 failed / 4 passed): "keeps the em dash for the eye" — the visible cell was empty,
 *      which is the *other* failure this component exists to prevent (a ledger you cannot scan
 *      by column). Restored.
 * 3. Dropped `aria-hidden` from the dash while keeping the word.
 *    → RED (2 failed / 3 passed): announced string `'—None'`, expected `'None'` — the
 *      punctuation is spoken after all on the AT that speaks it, and the cell then says the same
 *      thing twice. Restored.
 */

const SOURCE = stripComments(
  readFileSync(resolve(frontendRoot(), "components/finance/DrCrAmount.tsx"), "utf8"),
);

interface Line {
  id: string;
  debitPaisa: number;
  creditPaisa: number;
}

const COLUMNS: ColumnDef<Line, unknown>[] = [
  {
    id: "debit",
    accessorKey: "debitPaisa",
    header: "Debit",
    cell: ({ row }) => <DrCrAmount paisa={row.original.debitPaisa} />,
  },
  {
    id: "credit",
    accessorKey: "creditPaisa",
    header: "Credit",
    cell: ({ row }) => <DrCrAmount paisa={row.original.creditPaisa} />,
  },
];

/** One line of a real double entry: the debit side moved, the credit side did not. */
const LINES: Line[] = [{ id: "1", debitPaisa: 125_000, creditPaisa: 0 }];

/**
 * What a screen reader actually receives from a subtree.
 *
 * `aria-hidden` subtrees are dropped, visually hidden text is KEPT — and an `aria-label` on a
 * role-less element contributes nothing, which is not an oversight in this helper but the whole
 * point of the finding: the attribute is prohibited there and must not be relied on.
 */
function announced(el: Element): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

function renderLedger() {
  render(<DataGrid label="Journal entry lines" columns={COLUMNS} data={LINES} />);
  const table = screen.getByRole("table", { name: "Journal entry lines" });
  const [debit, credit] = within(table).getAllByRole("cell");
  // `noUncheckedIndexedAccess` is on, and a thrown message here beats four `!`s that would each
  // report the failure as a type-level non-event 40 lines away.
  if (!debit || !credit) throw new Error("the ledger row rendered without its two amount cells");
  return { table, debit, credit };
}

describe("DrCrAmount — the absence of a movement reaches assistive tech", () => {
  it("announces the absence as a word, not as punctuation a screen reader may skip", () => {
    const { credit } = renderLedger();
    expect(announced(credit)).toBe("None");
  });

  it("keeps the em dash for the eye and hides it from the ear", () => {
    const { credit } = renderLedger();
    // Still scannable: half a ledger's numeric columns printing `Rs 0.00` is the defect the
    // dash exists to prevent, so the glyph stays exactly where it was.
    expect(credit.textContent).toContain("—");
    const dash = within(credit).getByText("—");
    expect(dash).toHaveAttribute("aria-hidden", "true");
  });

  it("leans on the column header for the noun, which DataGrid really does supply", () => {
    // This is what licenses a one-word cell: the header is associated, so the pair is announced
    // as "Debit, None". Asserted rather than assumed — a `<th>` without `scope` would silently
    // take the noun away and leave the cell saying "None" about nothing.
    const { table } = renderLedger();
    const header = within(table).getByRole("columnheader", { name: /credit/i });
    expect(header.tagName).toBe("TH");
    expect(header).toHaveAttribute("scope", "col");
  });

  it("puts no aria-label on a generic span — ARIA prohibits it and AT drops it", () => {
    expect(SOURCE).not.toMatch(/aria-label/);
  });

  it("still renders a real movement through MoneyDisplay, untouched", () => {
    const { debit } = renderLedger();
    expect(announced(debit)).toContain("1,250");
    expect(SOURCE).not.toMatch(/toFixed|Intl\.NumberFormat|PKR/);
  });
});
