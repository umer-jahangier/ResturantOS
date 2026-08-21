import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MoneyDisplay } from "@/components/ui/money-display";
import { TillVariancePanel } from "@/components/finance/TillVariancePanel";
import { UnknownFigure } from "@/components/finance/UnknownFigure";
import type { MoneyFigure, TillReconciliation } from "@/lib/models/takings.model";

/**
 * The gate 38-08 task 4 asks for: **the honesty affordances are preserved and now asserted, so a
 * later refactor cannot quietly turn an unknown into a zero.**
 *
 * <h3>Why this file exists beside `components/finance/__tests__/DailyTakings.test.tsx`</h3>
 *
 * That suite tests the ADAPTER and the rendering of the takings screen — what the server said and
 * what appeared. This one tests the three properties the plan names as non-negotiable, framed so
 * that each has an observable negative control:
 *
 * | property | the control that must go red |
 * |---|---|
 * | `Not known` renders WITH its reason | change the headline to `Rs 0.00` |
 * | variances are never summed | add a total row to `TillVariancePanel` |
 * | the day-level "This is NOT a zero variance" survives to the DOM | drop the reason paragraph |
 *
 * plus the two 38-08 additions: money is written in one place, and a negative is legible without
 * colour.
 *
 * <p>Phase 14b exists because eleven screens told an owner his business had no vendors when the
 * service was down. This is the file that stops the same class of defect being reintroduced by a
 * redesign rather than by an outage.
 */

const COMPS_UNKNOWN: Extract<MoneyFigure, { state: "UNKNOWN" }> = {
  state: "UNKNOWN",
  figureKey: "comps",
  reason:
    "Comps are not recorded separately from discounts. orders.discount_paisa is one column, and a full comp appears in it as a discount equal to the subtotal.",
};

const DAY_CASH_VARIANCE_UNKNOWN: Extract<MoneyFigure, { state: "UNKNOWN" }> = {
  state: "UNKNOWN",
  figureKey: "cash variance",
  reason:
    "Cash was taken on this day but no till was closed and counted, so there is nothing to compare the expected drawer against. This is NOT a zero variance.",
};

function till(
  id: string,
  reconciliationState: TillReconciliation["reconciliationState"],
  variancePaisa: number | null,
): TillReconciliation {
  const known = (paisa: number): MoneyFigure => ({ state: "KNOWN", paisa });
  return {
    tillSessionId: id,
    cashierId: null,
    status: reconciliationState === "OPEN" ? "OPEN" : "CLOSED",
    openingFloatPaisa: 500000,
    expectedClosing: known(683605),
    declaredClosing: known(683605 + (variancePaisa ?? 0)),
    variance:
      variancePaisa === null
        ? { state: "UNKNOWN", figureKey: "variance", reason: "Nobody counted this drawer." }
        : known(variancePaisa),
    openedAt: new Date("2026-08-07T01:00:00Z"),
    closedAt: reconciliationState === "OPEN" ? null : new Date("2026-08-07T09:00:00Z"),
    reconciliationState,
  };
}

describe("an uncomputable figure is an ABSENCE, never a figure (D-38-16)", () => {
  it("renders the reason where the number would have been — not a zero, not a bare dash", () => {
    render(<UnknownFigure figure={COMPS_UNKNOWN} />);

    const el = screen.getByTestId("unknown-figure");
    expect(el).toHaveTextContent("Not known");
    expect(el).toHaveTextContent("Comps are not recorded separately");
    // NEGATIVE CONTROL #3 from the plan: change `Not known` to `Rs 0.00` and this goes red.
    expect(el.textContent).not.toMatch(/Rs\s*0\.00/);
    expect(el.textContent?.trim()).not.toBe("—");
  });

  it("is announced as an absence, with the reason, to a screen reader", () => {
    render(<UnknownFigure figure={COMPS_UNKNOWN} />);
    const label = screen.getByTestId("unknown-figure").getAttribute("aria-label");
    expect(label).toContain("not known");
    expect(label).toContain("Comps are not recorded separately");
  });

  it("keeps the DAY-level statement, including the words that stop it being read as zero", () => {
    render(
      <TillVariancePanel tills={[]} dayCashVariance={DAY_CASH_VARIANCE_UNKNOWN} />,
    );
    const banner = screen.getByTestId("day-cash-variance-unknown");
    expect(banner).toHaveTextContent("Cash variance for the day: not known");
    // The sentence the screen's whole argument rests on. It comes from the SERVER's reason, so
    // this also proves the reason is rendered rather than replaced with a generic line.
    expect(banner).toHaveTextContent("This is NOT a zero variance");
  });
});

describe("variances are never summed — the most important control in the plan", () => {
  const opposites = [till("a", "OVER", 250000), till("b", "SHORT", -250000)];

  it("lists both drawers, each with its own signed variance", () => {
    render(<TillVariancePanel tills={opposites} />);

    const over = screen.getByTestId("till-row-a");
    const short = screen.getByTestId("till-row-b");
    expect(within(over).getByTestId("till-variance")).toHaveTextContent("+Rs 2,500.00");
    expect(within(short).getByTestId("till-variance")).toHaveTextContent("-Rs 2,500.00");
  });

  it("renders NO aggregate — two drawers out by opposite amounts is two problems", () => {
    const { container } = render(<TillVariancePanel tills={opposites} />);

    // NEGATIVE CONTROL #2: add a total row and every one of these goes red. The two 2,500s net to
    // zero, so an aggregate would print `Rs 0.00` — the single most misleading string this screen
    // could produce, because it reads as "both drawers matched".
    expect(screen.queryByText(/total/i)).not.toBeInTheDocument();
    expect(container.querySelector("tfoot")).toBeNull();
    expect(container.textContent).not.toMatch(/Rs\s*0\.00/);
    expect(screen.getAllByTestId("till-variance")).toHaveLength(2);
  });

  it("keeps a still-open drawer and an uncounted one apart, and neither becomes a zero", () => {
    render(<TillVariancePanel tills={[till("open", "OPEN", null), till("nc", "NOT_COUNTED", null)]} />);

    expect(within(screen.getByTestId("till-row-open")).getByText("Still open")).toBeInTheDocument();
    expect(within(screen.getByTestId("till-row-nc")).getByText("Not counted")).toBeInTheDocument();
    // Both have a null variance. Any `variance ?? 0` collapses them into one another AND into a
    // matched drawer; the unknown element is what keeps all three distinguishable.
    expect(screen.getAllByTestId("unknown-figure").length).toBeGreaterThanOrEqual(2);
  });
});

describe("a negative amount survives greyscale (38-08 task 2)", () => {
  it("writes an accounting negative in parentheses, and says 'negative' out loud", () => {
    const { container } = render(<MoneyDisplay paisa={-1943200} sign="accounting" />);

    // NEGATIVE CONTROL #4: drop the parentheses and this goes red. Asserted on the TEXT, with no
    // reference to any class or colour — which is the point: the sign must be legible with the
    // stylesheet removed.
    expect(container.textContent).toBe("(Rs 19,432.00)");
    expect(container.firstElementChild).toHaveAttribute("aria-label", "negative Rs 19,432.00");
  });

  it("leaves a positive amount alone under the same face", () => {
    const { container } = render(<MoneyDisplay paisa={1943200} sign="accounting" />);
    expect(container.textContent).toBe("Rs 19,432.00");
  });

  it("signs both directions with a character, and gives zero no direction at all", () => {
    expect(render(<MoneyDisplay paisa={4218_00} sign="signed" />).container.textContent).toBe(
      "+Rs 4,218.00",
    );
    // The minus is `formatPaisa`'s own, not a second glyph chosen for looks — see the component's
    // note on why U+2212 was rejected here.
    expect(render(<MoneyDisplay paisa={-840_00} sign="signed" />).container.textContent).toBe(
      "-Rs 840.00",
    );
    expect(render(<MoneyDisplay paisa={0} sign="signed" />).container.textContent).toBe("Rs 0.00");
  });
});

describe("one money path — nothing under these trees formats currency for itself", () => {
  const ROOT = resolve(__dirname, "../../..");
  const TREES = [
    "components/finance",
    "components/crm",
    "components/hr",
    "components/users",
    "app/(tenant)/app/finance",
    "app/(tenant)/app/crm",
    "app/(tenant)/app/hr",
    "app/(tenant)/app/users",
  ];

  function sources(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          // A test may legitimately import the formatter to assert against it.
          if (entry === "__tests__") continue;
          walk(full);
        } else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) out.push(full);
      }
    };
    for (const tree of TREES) walk(resolve(ROOT, tree));
    return out;
  }

  /** Comments describe the rule; they must not be able to trip it. */
  function strip(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it("no component imports formatPaisa — MoneyDisplay is the only display path", () => {
    // NEGATIVE CONTROL #1: replace one `<MoneyDisplay>` with
    // `${(paisa / 100).toFixed(2)}` or with a direct `formatPaisa` call and this goes red.
    //
    // The rule is about DISPLAY. `formatPaisa` is the correct and only formatter — it is pinned
    // byte-for-byte against the JVM's `ReceiptMoneyFormatter` — but a component that calls it
    // directly owns its own money MARKUP, and that is what drifts: `DailyTakings` set money in
    // `font-mono` for a year while the rest of the product set it in tabular sans, and nothing
    // failed.
    const offenders = sources().filter((f) => /\bformatPaisa\b/.test(strip(readFileSync(f, "utf8"))));
    expect(offenders.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });

  it("no component divides paisa by 100 to DISPLAY it", () => {
    // The two remaining `/ 100` sites in these trees go the other way — paisa into the string an
    // <input> shows, so an accountant can type `3456.80` — and neither renders a currency. They
    // are named here so this assertion stays specific rather than becoming a blanket ban that
    // someone later deletes because it flags legitimate code.
    const ALLOWED_INPUT_CONVERSIONS = [
      "components/hr/tax-config-form.tsx",
      "components/hr/employee-form-schema.ts",
      "components/users/approval-limit-field.tsx",
    ];
    const offenders = sources()
      .filter((f) => /\/\s*100\b/.test(strip(readFileSync(f, "utf8"))))
      .map((f) => f.slice(ROOT.length + 1))
      .filter((f) => !ALLOWED_INPUT_CONVERSIONS.includes(f));
    expect(offenders).toEqual([]);
  });

  it("no component prints the ₨ symbol — the product says Rs, and only formatPaisa decides", () => {
    // GA-078: HR printed the wrong rupee symbol beside the rest of the product's `Rs 2,500.00`,
    // and `toLocaleString()` dropped the trailing zeros so decimal points stopped aligning down a
    // salary column.
    //
    // COMMENTS ARE STRIPPED FIRST, for the reason `conformance-scan.ts` gives for doing the same:
    // both HR pages carry a note explaining the defect, quoting the symbol. A gate that punishes
    // the explanation trains people to delete explanations, and the note is the only thing telling
    // the next reader why the rule exists.
    const offenders = sources()
      .filter((f) => /₨/.test(strip(readFileSync(f, "utf8"))))
      .map((f) => f.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });
});
