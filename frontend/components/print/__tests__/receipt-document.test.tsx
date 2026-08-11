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

  it("renders both tax rate codes as separate rows with their labels and rates", () => {
    render(<ReceiptDocumentView document={docFrom()} />);
    const root = screen.getByTestId("receipt-root");

    expect(root).toHaveTextContent("Sales Tax (16.00%) [GST-16]");
    expect(root).toHaveTextContent("Rs 334.40");
    expect(root).toHaveTextContent("ICT Services (5.00%) [ICT-05]");
    expect(root).toHaveTextContent("Rs 11.35");
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
