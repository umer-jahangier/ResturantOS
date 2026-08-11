import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { PrintDocumentError, parsePrintDocument, type PrintDocument } from "../src/contract/print-document.schema.js";
import { RenderError, renderReceipt, type PrinterProfile } from "../src/render/escpos-renderer.js";
import { currencyTokens, emulate, type DecodedRender } from "./escpos-emulator.js";

/**
 * The renderer, proved byte by byte on a laptop with nothing plugged into it (D-26-02).
 *
 * <p>Read from `contracts/print/golden-receipt-document.json` at the repository root by walking up
 * from the working directory — NOT a TypeScript `import` (the file is outside this package's
 * rootDir and resolution fails) and NOT a copy. There is one fixture and three suites read it.
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
  throw new Error(
    `could not find ${FIXTURE_RELATIVE} walking up from ${process.cwd()}. Do NOT copy it into ` +
      "this package — regenerate it with `mvn -pl shared-lib test -Dtest=PrintDocumentContractTest " +
      "-Dprint.fixture.regenerate=true`.",
  );
}

const RAW = JSON.parse(readFileSync(locateFixture(), "utf8")) as Record<string, unknown>;

/** The fixture carries a populated FBR region; Phase 27 owns rendering it, so tests clear it. */
function receipt(overrides: Record<string, unknown> = {}): PrintDocument {
  return parsePrintDocument({ ...RAW, fiscal: null, ...overrides });
}

const PRINTER_42: PrinterProfile = {
  columns: 42,
  codepage: "CP437",
  cut: "PARTIAL",
  drawerPin: 2,
  drawerPulseMs: 100,
};
const PRINTER_48: PrinterProfile = { ...PRINTER_42, columns: 48 };

function render(doc: PrintDocument, printer: PrinterProfile): DecodedRender {
  return emulate(renderReceipt(doc, printer));
}

/** Every amount string the document itself carries. */
function documentAmounts(doc: PrintDocument): Set<string> {
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

describe("the contract schema", () => {
  it("parses the Java-produced golden fixture", () => {
    const doc = parsePrintDocument(RAW);
    expect(doc.schemaVersion).toBe("1.0");
    expect(doc.type).toBe("CUSTOMER_RECEIPT");
    expect(doc.lines).toHaveLength(3);
    expect(doc.totals?.grandTotal.paisa).toBe(284347);
  });

  it("rejects an amount whose rendered string disagrees with its paisa", () => {
    const tampered = structuredClone(RAW) as { totals: { grandTotal: { formatted: string } } };
    tampered.totals.grandTotal.formatted = "Rs 284,347.00";
    expect(() => parsePrintDocument(tampered)).toThrow(PrintDocumentError);
    expect(() => parsePrintDocument(tampered)).toThrow(/disagrees with itself/);
  });
});

describe("the renderer", () => {
  // ── 3. The column count is READ, not compiled ───────────────────────────────────────────────
  it("wraps to the configured column count, and differently at a different one", () => {
    const at42 = render(receipt(), PRINTER_42);
    const at48 = render(receipt(), PRINTER_48);

    for (const line of at42.lines) {
      expect(line.text.length, `"${line.text}" exceeds 42 columns`).toBeLessThanOrEqual(42);
    }
    for (const line of at48.lines) {
      expect(line.text.length, `"${line.text}" exceeds 48 columns`).toBeLessThanOrEqual(48);
    }

    // Not merely "both fit" — the output must actually DIFFER, or the column count is being
    // ignored and both runs happen to be short enough.
    expect(at42.lines.map((l) => l.text)).not.toEqual(at48.lines.map((l) => l.text));
    const widest42 = Math.max(...at42.lines.map((l) => l.text.length));
    const widest48 = Math.max(...at48.lines.map((l) => l.text.length));
    expect(widest42).toBe(42);
    expect(widest48).toBe(48);
  });

  // ── 4. Never a number of the renderer's own ─────────────────────────────────────────────────
  it("prints no currency token the document did not already carry", () => {
    const doc = receipt();
    const decoded = render(doc, PRINTER_42);
    const allowed = documentAmounts(doc);
    const printed = currencyTokens(decoded);

    expect(printed.length).toBeGreaterThan(8);
    for (const token of printed) {
      expect(
        Array.from(allowed),
        `the renderer printed "${token}", which the document does not contain — it computed a ` +
          "number of its own, which is the hundredfold-error shape GA-007 recorded",
      ).toContain(token);
    }
  });

  // ── 5. Name and amount on one line; a long name wraps and the amount stays put ──────────────
  it("keeps an amount on the same line as its item, and on the FIRST line when the name wraps", () => {
    const shortName = render(receipt(), PRINTER_42);
    const naan = shortName.lines.find((l) => l.text.includes("Garlic Naan"));
    expect(naan, "the Garlic Naan line is missing").toBeDefined();
    expect(naan!.text).toContain("Rs 360.00");
    expect(naan!.text.endsWith("Rs 360.00")).toBe(true);

    const longDoc = receipt({
      lines: [
        {
          ...(RAW.lines as Record<string, unknown>[])[0],
          name: "Chicken Karahi with extra coriander and a very long garnish description",
        },
        ...(RAW.lines as Record<string, unknown>[]).slice(1),
      ],
    });
    const wrapped = render(longDoc, PRINTER_42);
    const firstIndex = wrapped.lines.findIndex((l) => l.text.includes("Chicken Karahi"));
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    // The amount is on the FIRST line of the wrapped name, not stranded on the last.
    expect(wrapped.lines[firstIndex]!.text.endsWith("Rs 1,850.00")).toBe(true);
    expect(wrapped.lines[firstIndex + 1]!.text).not.toContain("Rs ");
  });

  // ── 6. Exactly one cut, and it is last apart from the drawer ────────────────────────────────
  it("cuts exactly once, and the cut is the last event before the drawer", () => {
    const decoded = render(receipt(), PRINTER_42);
    const cuts = decoded.events.filter((e) => e.kind === "cut");
    expect(cuts).toHaveLength(1);

    const nonDrawer = decoded.events.filter((e) => e.kind !== "drawer");
    expect(nonDrawer[nonDrawer.length - 1]!.kind).toBe("cut");

    // Research §7.3: feed past the cutter first, so the printed area clears the blade.
    expect(cuts[0]).toMatchObject({ mode: "PARTIAL", feed: 0 });
  });

  it("emits no cut at all when the printer profile says NONE", () => {
    const decoded = render(receipt(), { ...PRINTER_42, cut: "NONE" });
    expect(decoded.events.filter((e) => e.kind === "cut")).toHaveLength(0);
  });

  // ── 7. The drawer ───────────────────────────────────────────────────────────────────────────
  it("pulses the drawer exactly once, AFTER the cut, and not at all without an instruction", () => {
    const decoded = render(receipt(), PRINTER_42);
    const drawers = decoded.events.filter((e) => e.kind === "drawer");
    expect(drawers).toHaveLength(1);
    expect(drawers[0]).toMatchObject({ realtime: false, pin: 2, onMs: 100 });

    const cutIndex = decoded.events.findIndex((e) => e.kind === "cut");
    const drawerIndex = decoded.events.findIndex((e) => e.kind === "drawer");
    expect(drawerIndex).toBeGreaterThan(cutIndex);

    // A drawer that opens on a card payment is a cash-handling incident, so the absence is
    // asserted rather than assumed.
    const noDrawer = render(receipt({ drawer: null }), PRINTER_42);
    expect(noDrawer.events.filter((e) => e.kind === "drawer")).toHaveLength(0);
  });

  // ── 8. A kitchen ticket ─────────────────────────────────────────────────────────────────────
  it("prints a kitchen ticket with NO amounts, no drawer, and lines grouped by station", () => {
    const ticket = parsePrintDocument({
      ...RAW,
      type: "KITCHEN_TICKET",
      totals: null,
      taxBreakdown: [],
      tenders: [],
      fiscal: null,
      drawer: null,
    });
    const decoded = render(ticket, { ...PRINTER_42, cut: "FULL" });

    expect(
      currencyTokens(decoded),
      "a kitchen ticket must not carry money — the kitchen does not see what the customer paid",
    ).toHaveLength(0);
    expect(decoded.events.filter((e) => e.kind === "drawer")).toHaveLength(0);

    const text = decoded.lines.map((l) => l.text);
    for (const station of ["[HOT]", "[TANDOOR]", "[COLD]"]) {
      expect(text.some((t) => t.includes(station)), `station ${station} is not on the ticket`).toBe(true);
    }
    // Each station's own item follows its heading.
    const hot = text.findIndex((t) => t.includes("[HOT]"));
    expect(text[hot + 1]).toContain("Chicken Karahi");
  });

  // ── 9. Refusals name the field ──────────────────────────────────────────────────────────────
  it("refuses an unknown codepage rather than defaulting to one", () => {
    expect(() => renderReceipt(receipt(), { ...PRINTER_42, codepage: "CP864" })).toThrow(RenderError);
    expect(() => renderReceipt(receipt(), { ...PRINTER_42, codepage: "CP864" })).toThrow(
      /printer\.codepage/,
    );
  });

  it("refuses to print a fiscal receipt with the QR silently omitted", () => {
    // The unmodified fixture HAS a QR payload. Phase 27 implements the raster path; until then a
    // receipt that needs the symbol must fail loudly rather than print without it.
    expect(() => renderReceipt(parsePrintDocument(RAW), PRINTER_42)).toThrow(/fiscal\.qrPayload/);
    expect(() => renderReceipt(parsePrintDocument(RAW), PRINTER_42)).toThrow(/not implemented/);
  });

  it("refuses a drawer kick with no connector pin, naming the field", () => {
    const doc = receipt({ drawer: { kick: true, connectorPin: null, pulseMs: 100 } });
    expect(() => renderReceipt(doc, PRINTER_42)).toThrow(/drawer\.connectorPin/);
  });

  it("refuses a column count that cannot fit the amounts", () => {
    expect(() => renderReceipt(receipt(), { ...PRINTER_42, columns: 8 })).toThrow(
      /does not fit in 8 columns/,
    );
  });

  // ── 10. Determinism ─────────────────────────────────────────────────────────────────────────
  /**
   * The DELAY is the assertion, and it must not be optimised away.
   *
   * <p>This test first read `renderReceipt(); renderReceipt(); expect(a).toEqual(b)` — two calls
   * microseconds apart. It was verified against a deliberately broken renderer that stamped
   * `Date.now()` into the receipt, and it PASSED: both calls landed in the same millisecond. An
   * assertion that cannot fail on a clock-dependent renderer does not test determinism, it tests
   * that the machine is fast.
   *
   * <p>25 ms clears the 1 ms granularity of `Date.now()` with room to spare, so a renderer that
   * reads a clock now produces different bytes and this goes red.
   */
  it("produces identical bytes on two calls separated in time", async () => {
    const a = renderReceipt(receipt(), PRINTER_42);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const b = renderReceipt(receipt(), PRINTER_42);

    expect(Array.from(b)).toEqual(Array.from(a));
    expect(a.length).toBeGreaterThan(200);
  });

  // ── 1 & 2. The emulator consumes the whole stream ───────────────────────────────────────────
  it("produces a stream the emulator consumes entirely, leaving nothing unclassified", () => {
    // emulate() throws on any byte it cannot classify, so reaching a render at all is the
    // assertion. The line count check keeps it from passing on an empty stream.
    const decoded = render(receipt(), PRINTER_42);
    expect(decoded.lines.length).toBeGreaterThan(10);
    expect(decoded.events[0]).toMatchObject({ kind: "init" });
  });

  it("bands a reprint and leaves an original unbanded", () => {
    const original = render(receipt(), PRINTER_42);
    expect(original.lines.some((l) => l.text.includes("REPRINT"))).toBe(false);

    const reprint = render(
      receipt({
        issue: {
          sequenceNumber: 2,
          reprint: true,
          issuedAt: "2026-08-11T15:04:00Z",
          originalIssuedAt: "2026-08-11T14:32:07Z",
        },
      }),
      PRINTER_42,
    );
    const band = reprint.lines.find((l) => l.text.includes("REPRINT"));
    expect(band, "a reprint must say so on the paper").toBeDefined();
    expect(band!.emphasis).toBe(true);
    expect(band!.align).toBe("CENTER");
    expect(reprint.lines.some((l) => l.text.includes("2026-08-11T14:32:07Z"))).toBe(true);
  });
});
