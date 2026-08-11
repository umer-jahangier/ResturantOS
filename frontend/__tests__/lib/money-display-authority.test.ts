import { render } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

import { MoneyDisplay } from "@/components/ui/money-display";
import { formatPaisa, toMoney } from "@/lib/adapters/shared";
// Resolved by the `@shared-fixtures/` alias in vitest.config.ts to
// shared-lib/src/test/resources/ — the SAME file MoneyDisplayAuthorityTest reads off the JVM
// test classpath. Not a copy. See the alias comment for why that matters.
import vectorFile from "@shared-fixtures/money-display-vectors.json";

/**
 * The browser half of the money-display authority (D-37-01, plan 37-01).
 *
 * This suite reads THE SAME file as `MoneyDisplayAuthorityTest` on the JVM —
 * `shared-lib/src/test/resources/money-display-vectors.json`, resolved by relative path out of
 * the frontend tree, deliberately NOT copied. A copied fixture is a fixture that drifts, and
 * drift between these two stacks is the exact defect this plan closes: until now the JVM rendered
 * 123456 paisa as `Rs1,235` while the browser rendered `Rs 1,234.56`, and both suites were green.
 */
interface Vector {
  name: string;
  paisa: string;
  display: string;
}

const vectors: Vector[] = vectorFile.vectors;

describe("money display authority — shared vectors", () => {
  it("loads the same vector file the JVM test loads", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(8);
    // The `_readme` key only exists in the shared-lib source file. If this assertion fails, the
    // alias has been pointed at a copy and the two stacks can drift silently again.
    expect(vectorFile).toHaveProperty("_readme");
  });

  it.each(vectors)("renders $name exactly", ({ paisa, display }) => {
    expect(formatPaisa(BigInt(paisa))).toBe(display);
  });

  it("toMoney and MoneyDisplay agree on every vector", () => {
    for (const { name, paisa, display } of vectors) {
      const asBig = BigInt(paisa);
      const { container, unmount } = render(React.createElement(MoneyDisplay, { paisa: asBig }));
      expect(container.textContent, `MoneyDisplay on '${name}'`).toBe(display);
      unmount();

      // toMoney takes a number; only assert it where a number holds the value exactly.
      if (BigInt(Number.MIN_SAFE_INTEGER) <= asBig && asBig <= BigInt(Number.MAX_SAFE_INTEGER)) {
        expect(toMoney(Number(paisa)).formatted, `toMoney on '${name}'`).toBe(display);
      }
    }
  });

  it("emits an ASCII space, never U+00A0, so the JVM string is byte-identical", () => {
    const rendered = formatPaisa(123456);
    expect(rendered).toBe("Rs 1,234.56");
    expect(rendered).not.toContain(" ");
    expect(rendered.codePointAt(2)).toBe(0x20);
  });

  it("keeps the rate escape hatch: a per-unit cost still shows its extra places", () => {
    // 6.2 paisa per gram. At two places this reads Rs 0.06, and anything cheaper reads Rs 0.00 —
    // the "this ingredient is free" impression MoneyDisplay was written to prevent.
    expect(formatPaisa(6.2, { maxFractionDigits: 4 })).toBe("Rs 0.062");
    const { container } = render(
      React.createElement(MoneyDisplay, { paisa: 6.2, maxFractionDigits: 4 }),
    );
    expect(container.textContent).toBe("Rs 0.062");
  });

  it("renders a non-integer unit cost rather than throwing", () => {
    // NUMERIC(18,4) since V12. BigInt() throws outright on a fractional value, which would have
    // taken out every screen showing a unit cost.
    expect(() => formatPaisa(1234.5678)).not.toThrow();
    expect(formatPaisa(1234.5678)).toBe("Rs 12.35");
  });

  it("renders a bigint beyond MAX_SAFE_INTEGER exactly, matching the Java vector", () => {
    const vector = vectors.find((v) => v.paisa === "9007199254740993");
    expect(vector).toBeDefined();
    expect(formatPaisa(9007199254740993n)).toBe(vector!.display);
    expect(formatPaisa(9007199254740993n)).toBe("Rs 90,071,992,547,409.93");

    // Proof the bigint path is doing real work rather than being decorative: the SAME value
    // routed through a JS number loses its last digit before the formatter ever sees it, and
    // renders a different string. Comparing to a number *literal* here would prove nothing —
    // the literal is coerced identically. The string form is what survives to be compared.
    expect(String(Number("9007199254740993"))).toBe("9007199254740992");
    expect(formatPaisa(Number("9007199254740993"))).toBe("Rs 90,071,992,547,409.92");
    expect(formatPaisa(Number("9007199254740993"))).not.toBe(vector!.display);
  });
});
