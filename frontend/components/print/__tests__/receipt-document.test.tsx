import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { adaptPrintDocument } from "@/lib/adapters/print.adapter";
import type { PrintDocument } from "@/lib/models/print.model";
import { ReceiptDocumentView } from "@/components/print/receipt-document";

/**
 * The 80 mm bill, rendered from the ONE golden fixture the Java contract test, the frontend adapter
 * test and the print agent's renderer are all tested against.
 *
 * <p>The load-bearing assertion is the last one: every currency-shaped token in the rendered output
 * must appear in the document's own set of rendered amount strings. A component that computed its
 * own number would produce a token the document does not contain, and that is precisely the
 * hundredfold defect this phase exists to make unshippable.
 */

const FIXTURE_RELATIVE = join("contracts", "print", "golden-receipt-document.json");

function locateFixture(): string {
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, FIXTURE_RELATIVE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not find ${FIXTURE_RELATIVE} walking up from ${process.cwd()}`);
}

const RAW = JSON.parse(readFileSync(locateFixture(), "utf8")) as Record<string, unknown>;

/**
 * The fixture, adapted.
 *
 * <p>Deliberately does NOT go through the zod schema: `components/**` may not import the
 * api-client layer (the project's own `no-restricted-imports` boundary), and that boundary is
 * right — a component that reaches into the wire layer is a component that will eventually parse
 * its own responses. That the fixture PARSES is 26-01's adapter test's job and is asserted there;
 * this file's job is what gets rendered. The parameter type is taken structurally from the adapter
 * so the fixture is still typed against the real wire shape.
 */
function docFrom(overrides: Record<string, unknown> = {}): PrintDocument {
  const raw = { ...RAW, ...overrides } as Parameters<typeof adaptPrintDocument>[0];
  return adaptPrintDocument(raw);
}

/** Every rendered amount string the document carries, in one flat set. */
function documentAmountStrings(doc: PrintDocument): Set<string> {
  const out = new Set<string>();
  const add = (a: { formatted: string }) => out.add(a.formatted);
  doc.lines.forEach((l) => {
    add(l.unitPrice);
    add(l.lineTotal);
  });
  if (doc.totals) {
    add(doc.totals.subtotal);
    add(doc.totals.discount);
    add(doc.totals.serviceCharge);
    add(doc.totals.tax);
    add(doc.totals.grandTotal);
  }
  doc.taxBreakdown.forEach((t) => add(t.amount));
  doc.tenders.forEach((t) => {
    add(t.amountApplied);
    add(t.amountTendered);
    add(t.change);
  });
  return out;
}

describe("ReceiptDocumentView", () => {
  it("renders every line and every total with the EXACT strings the document carries", () => {
    const doc = docFrom();
    render(<ReceiptDocumentView document={doc} />);

    const lines = within(screen.getByTestId("receipt-lines")).getAllByRole("listitem");
    expect(lines).toHaveLength(3);

    // String equality against the fixture, never a re-formatting.
    expect(lines[0]).toHaveTextContent("1 x Chicken Karahi (Full)");
    expect(lines[0]).toHaveTextContent("Rs 1,850.00");
    expect(lines[1]).toHaveTextContent("3 x Garlic Naan");
    expect(lines[1]).toHaveTextContent("Rs 360.00");
    expect(lines[2]).toHaveTextContent("2 x Mineral Water 1.5L");
    // The paisa remainder survives all the way to the paper.
    expect(lines[2]).toHaveTextContent("Rs 160.66");

    const root = screen.getByTestId("receipt-root");
    expect(root).toHaveTextContent("Rs 2,370.66"); // subtotal
    expect(root).toHaveTextContent("Rs 100.00"); //   discount
    expect(root).toHaveTextContent("Rs 227.06"); //   service charge
    expect(root).toHaveTextContent("Rs 345.75"); //   tax
    expect(root).toHaveTextContent("Rs 2,843.47"); // grand total
  });

  /**
   * F6. A guest holds this paper, and a rate code is a LEDGER classification — it identifies a
   * bucket for the accountant reconciling a return and means nothing at the counter. The live bill
   * printed `SR-STD-17 (17.00%) [SR-STD-17]`: the internal code twice on one line, wrapping onto
   * two lines of an 80 mm roll. This assertion previously demanded that exact shape, which is how
   * it stayed green over a customer-facing defect for a whole phase.
   *
   * <p>The document still CARRIES the code — it is the identity of the bucket, and a stored print
   * job is what a support engineer reads six weeks later. The paper simply does not say it.
   */
  it("prints each tax rate as a phrase and a percentage, and never the ledger rate code", () => {
    const doc = docFrom();
    render(<ReceiptDocumentView document={doc} />);
    const root = screen.getByTestId("receipt-root");

    expect(root).toHaveTextContent("Sales Tax (16.00%)");
    expect(root).toHaveTextContent("Rs 334.40");
    expect(root).toHaveTextContent("ICT Services (5.00%)");
    expect(root).toHaveTextContent("Rs 11.35");

    // Text as PAINTED, not props. The fixture must genuinely carry codes, or this proves nothing.
    const paper = root.textContent ?? "";
    const codes = doc.taxBreakdown.map((t) => t.rateCode);
    expect(codes.filter(Boolean)).toHaveLength(doc.taxBreakdown.length);
    for (const code of codes) {
      expect(paper, `the rate code ${code} reached the guest's paper`).not.toContain(code!);
    }
    // Named codes are the live defect; the bracket catches a future one this test cannot name.
    expect(paper).not.toMatch(/\[[A-Z0-9][A-Z0-9_\-.]*\]/);
  });

  /**
   * A breakdown line with no label and no percentage still has to say what the money IS. Rendering
   * the label alone would print a bare amount against an empty phrase — a number on a bill with
   * nothing naming it.
   *
   * <p><b>D-4 — this assertion used to demand the defect.</b> Its last line read, verbatim:
   *
   * <pre>expect(rows.filter((r) => r === "Tax")).toHaveLength(2); // the breakdown line and the total</pre>
   *
   * A guest's bill saying "Tax" twice, with the same amount beside it both times, was not an
   * accident nobody had looked at — it was written down, counted, and locked in place by a passing
   * test. The fallback is still right and still asserted; the SECOND copy is the bug.
   */
  it("says the word Tax exactly once when one unlabelled line is the whole tax", () => {
    render(
      <ReceiptDocumentView
        document={docFrom({
          taxBreakdown: [
            {
              rateCode: null,
              label: null,
              ratePercent: null,
              amount: { paisa: 34575, formatted: "Rs 345.75" },
            },
          ],
        })}
      />,
    );
    const rows = Array.from(
      screen.getByTestId("receipt-root").querySelectorAll(".receipt-row"),
    ).map((r) => r.querySelector(".receipt-row-label")?.textContent?.trim());

    expect(rows.filter((r) => r === "Tax"))
      .toHaveLength(1);
    // And the money is still named — a line that fell back to nothing would also pass a count.
    expect(screen.getByTestId("receipt-root")).toHaveTextContent("Rs 345.75");
  });

  /**
   * D-4. A real bill on 2026-08-12 read:
   *
   *     Sales Tax (16.00%)          Rs   230.67
   *     Tax                         Rs   230.67
   *
   * Two lines, one amount, one immediately under the other, on a customer-facing document. The
   * total was right — 2,339.00 - 308.90 + 101.51 + 230.67 = 2,362.28 — so no money was wrong. But
   * a guest counting their own bill finds Rs 230.67 charged twice and says so, and the till has
   * nothing to answer with.
   *
   * <p>Falsified by removing the `taxBreakdown.length !== 1` guard from receipt-document.tsx:
   * "Rs 230.67" is painted twice and this fails on the count.
   */
  it("prints a single-rate tax once, with its name and its percentage", () => {
    const doc = docFrom({
      taxBreakdown: [
        {
          rateCode: "GST-16",
          label: "Sales Tax",
          ratePercent: "16.00",
          amount: { paisa: 23067, formatted: "Rs 230.67" },
        },
      ],
    });
    render(<ReceiptDocumentView document={doc} />);
    const paper = screen.getByTestId("receipt-root").textContent ?? "";

    expect(paper).toContain("Sales Tax (16.00%)");
    expect(paper.split("Rs 230.67").length - 1).toBe(1);

    // The BARE "Tax" row — the duplicate itself. Asserted on the LABEL, because the fixture's own
    // totals.tax differs from this override and an amount-only count passes against the unguarded
    // renderer. (It did: the first version of this test stayed green through the falsification,
    // and only the sibling assertion below caught it. The print-agent twin had the same hole.)
    const rows = Array.from(
      screen.getByTestId("receipt-root").querySelectorAll(".receipt-row"),
    ).map((r) => r.querySelector(".receipt-row-label")?.textContent?.trim());
    expect(rows.filter((r) => r === "Tax")).toHaveLength(0);
  });

  /**
   * The other half of the same rule, so the fix cannot be "delete the total row". With several
   * rates a summing row does real work: a guest should not have to add three percentages together
   * themselves. The golden fixture carries two buckets, which is what makes this the live case.
   */
  it("keeps the Tax total when the breakdown has several rates to sum", () => {
    const doc = docFrom();
    render(<ReceiptDocumentView document={doc} />);
    const root = screen.getByTestId("receipt-root");

    expect(doc.taxBreakdown.length).toBeGreaterThan(1);
    expect(root).toHaveTextContent("Sales Tax (16.00%)");
    expect(root).toHaveTextContent("ICT Services (5.00%)");

    const rows = Array.from(root.querySelectorAll(".receipt-row")).map((r) =>
      r.querySelector(".receipt-row-label")?.textContent?.trim(),
    );
    expect(rows.filter((r) => r === "Tax"))
      .toHaveLength(1);
  });

  it("prints tendered and change for a cash tender, and neither for a card", () => {
    render(<ReceiptDocumentView document={docFrom()} />);
    const root = screen.getByTestId("receipt-root");

    // The fixture's cash tender: Rs 1,000.00 handed over against Rs 843.47, Rs 156.53 back.
    expect(root).toHaveTextContent("Tendered");
    expect(root).toHaveTextContent("Rs 1,000.00");
    expect(root).toHaveTextContent("Change");
    expect(root).toHaveTextContent("Rs 156.53");

    const cardOnly = docFrom({
      tenders: [
        {
          method: "CARD",
          amountApplied: { paisa: 284347, formatted: "Rs 2,843.47" },
          amountTendered: { paisa: 284347, formatted: "Rs 2,843.47" },
          change: { paisa: 0, formatted: "Rs 0.00" },
          referenceNo: "VISA-4421",
        },
      ],
    });
    // RTL's destructured queries are bound to `baseElement` (document.body), and the first render
    // is still mounted — so scope to THIS render's own container rather than the document.
    const { container } = render(<ReceiptDocumentView document={cardOnly} />);
    const cardRoot = within(container).getByTestId("receipt-root");
    expect(cardRoot).not.toHaveTextContent("Change");
    expect(cardRoot).not.toHaveTextContent("Tendered");
  });

  /**
   * F20 — the walkthrough's §3 #23, on the paper the guest keeps.
   *
   * `Service charge Rs 0.00` printed on EVERY receipt this product ever produced, for a charge no
   * restaurant could set (`service_charge_paisa` non-zero on 0 of 195 live orders). The row is now
   * printed on "label OR money" and omitted only when there is neither.
   *
   * Falsification: restore the unconditional
   * `<div className="receipt-row"><span>Service charge</span>…</div>` and the first case below
   * fails on the exact string the walkthrough photographed.
   */
  it("prints NO service-charge row when the branch takes none and the amount is zero", () => {
    const raw = docFrom();
    const noCharge = {
      ...raw,
      totals: {
        ...raw.totals!,
        serviceCharge: { paisa: 0, formatted: "Rs 0.00" },
        serviceChargeLabel: null,
        serviceChargeRatePercent: null,
      },
    };
    const { container } = render(<ReceiptDocumentView document={noCharge} />);
    const root = within(container).getByTestId("receipt-root");
    expect(within(container).queryByTestId("receipt-service-charge-row")).toBeNull();
    expect(root.textContent ?? "").not.toMatch(/service charge/i);
  });

  it("prints the branch's own wording and rate, and still prints the row at Rs 0.00 when the branch does charge", () => {
    const raw = docFrom();
    const comped = {
      ...raw,
      totals: {
        ...raw.totals!,
        serviceCharge: { paisa: 0, formatted: "Rs 0.00" },
        serviceChargeLabel: "Service fee",
        serviceChargeRatePercent: "5.00",
      },
    };
    const { container } = render(<ReceiptDocumentView document={comped} />);
    const row = within(container).getByTestId("receipt-service-charge-row");
    expect(row).toHaveTextContent("Service fee (5.00%)");
    expect(row).toHaveTextContent("Rs 0.00");
  });

  it("prints a tip on its own line, beside the tender, and never inside the amount applied", () => {
    const raw = docFrom();
    const tipped = {
      ...raw,
      tenders: [
        {
          method: "CARD",
          amountApplied: { paisa: 284347, formatted: "Rs 2,843.47" },
          tip: { paisa: 20000, formatted: "Rs 200.00" },
          amountTendered: { paisa: 304347, formatted: "Rs 3,043.47" },
          change: { paisa: 0, formatted: "Rs 0.00" },
          referenceNo: "VISA-4421",
        },
      ],
    };
    const { container } = render(<ReceiptDocumentView document={tipped} />);
    const tipRow = within(container).getByTestId("receipt-tip-row");
    expect(tipRow).toHaveTextContent("Tip");
    expect(tipRow).toHaveTextContent("Rs 200.00");

    // The grand total is untouched by the tip — the identity the whole document is checked
    // against, and the reason a tip can never be folded into `amountApplied`.
    const root = within(container).getByTestId("receipt-root");
    expect(root).toHaveTextContent("Rs 2,843.47");
  });

  it("prints no tip line on an untipped tender", () => {
    const { container } = render(<ReceiptDocumentView document={docFrom()} />);
    expect(within(container).queryByTestId("receipt-tip-row")).toBeNull();
  });

  it("bands a reprint with its sequence and the original issue time; a first issue has no band", () => {
    expect(screen.queryByTestId("reprint-band")).toBeNull();
    render(<ReceiptDocumentView document={docFrom()} />);
    expect(screen.queryByTestId("reprint-band")).toBeNull();

    const reprint = docFrom({
      issue: {
        sequenceNumber: 2,
        reprint: true,
        issuedAt: "2026-08-11T15:04:00Z",
        originalIssuedAt: "2026-08-11T14:32:07Z",
      },
    });
    render(<ReceiptDocumentView document={reprint} />);
    const band = screen.getByTestId("reprint-band");
    expect(band).toHaveTextContent("REPRINT #2");
    expect(band).toHaveTextContent("2026-08-11T14:32:07.000Z");
  });

  it("renders per-item notes and modifiers", () => {
    render(<ReceiptDocumentView document={docFrom()} />);
    const root = screen.getByTestId("receipt-root");

    expect(root).toHaveTextContent("+ Extra spicy");
    expect(root).toHaveTextContent("Guest is allergic to peanuts");
  });

  it("puts no part of the application shell on the paper", () => {
    render(<ReceiptDocumentView document={docFrom()} />);

    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  /**
   * The one that makes a hundredfold error impossible to ship. Every currency-shaped token on the
   * page must be a string the document itself carries — a component that computed its own number
   * would produce one that is not in the set.
   */
  it("renders no currency token the document did not already carry", () => {
    const doc = docFrom();
    const { container } = render(<ReceiptDocumentView document={doc} />);

    const allowed = documentAmountStrings(doc);
    const text = container.textContent ?? "";
    const tokens = text.match(/-?Rs\s[\d,]+\.\d{2}/g) ?? [];

    expect(tokens.length).toBeGreaterThan(8);
    for (const token of tokens) {
      expect(allowed, `"${token}" is not an amount the document carries`).toContain(token);
    }
  });
});
