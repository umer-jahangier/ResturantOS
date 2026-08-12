import { describe, it, expect } from "vitest";
import { parseRupeesToPaisa, paisaToRupeeInput, formatPaisa } from "@/lib/adapters/shared";

/**
 * S1-05 — the money boundary in the entry direction.
 *
 * `formatPaisa` has had a vector file pinning it against the JVM since 37-01. The reverse
 * direction had nothing, because until now there was no reverse direction: the Charge screen
 * asked the cashier for paisa. The register's headline number is the case in the first test —
 * a Rs 3,456.80 bill — and the pre-fix screen turned that keystroke sequence into Rs 345.60.
 */
describe("parseRupeesToPaisa — what a cashier types becomes exact paisa", () => {
  it("parses the register's own bill", () => {
    expect(parseRupeesToPaisa("3456.80")).toBe(345680);
    expect(parseRupeesToPaisa("4000")).toBe(400000);
    expect(parseRupeesToPaisa("92.80")).toBe(9280);
  });

  it("accepts the shapes people actually type at a till", () => {
    expect(parseRupeesToPaisa("3,456.80")).toBe(345680);
    expect(parseRupeesToPaisa(" 3456.8 ")).toBe(345680);
    expect(parseRupeesToPaisa("Rs 3456.80")).toBe(345680);
    expect(parseRupeesToPaisa("rs.3456.80")).toBe(345680);
    expect(parseRupeesToPaisa(".5")).toBe(50);
    expect(parseRupeesToPaisa("0.29")).toBe(29);
    expect(parseRupeesToPaisa("12.")).toBe(1200);
  });

  it("round-trips a figure copied straight off this app's own display", () => {
    // formatPaisa emits an ASCII space and ASCII grouping commas (37-01), but a browser paste of
    // an Intl-formatted figure elsewhere can carry NBSP — both must come back to the same paisa.
    expect(parseRupeesToPaisa(formatPaisa(345680))).toBe(345680);
    expect(parseRupeesToPaisa("Rs 3,456.80")).toBe(345680);
  });

  it("rounds HALF_UP at the paisa, and never through a float", () => {
    expect(parseRupeesToPaisa("12.345")).toBe(1235);
    expect(parseRupeesToPaisa("12.344")).toBe(1234);
    expect(parseRupeesToPaisa("12.3449999")).toBe(1234);
    // 0.1 + 0.2 territory: a float path yields 28.999999999999996 and truncates to 28.
    expect(parseRupeesToPaisa("0.29")).toBe(29);
    expect(parseRupeesToPaisa("1.005")).toBe(101);
  });

  it("returns null rather than a silently-wrong number", () => {
    for (const bad of ["", "   ", ".", "-5", "abc", "1e3", "3.4.5", "1-2", "Rs", "12 34x"]) {
      expect(parseRupeesToPaisa(bad), `expected null for ${JSON.stringify(bad)}`).toBeNull();
    }
  });
});

describe("paisaToRupeeInput — what goes back INTO the box", () => {
  it("is a plain editable figure, not a formatted label", () => {
    expect(paisaToRupeeInput(345680)).toBe("3456.80");
    expect(paisaToRupeeInput(9280)).toBe("92.80");
    expect(paisaToRupeeInput(0)).toBe("0.00");
    expect(paisaToRupeeInput(5)).toBe("0.05");
  });

  it("survives a round trip through the parser", () => {
    for (const paisa of [0, 1, 99, 100, 9280, 345680, 400000, 99999999]) {
      expect(parseRupeesToPaisa(paisaToRupeeInput(paisa))).toBe(paisa);
    }
  });
});
