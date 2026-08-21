import { describe, it, expect } from "vitest";

import { countLine, filteredCountLine, statLine } from "@/lib/format/stat-line";

/**
 * stat-line.test.ts — the demo's `·`-separated back-office subtitle
 * ("138 ingredients · 5 alerts · Last count: Today 08:00").
 *
 * <p>The rule being defended: a subtitle that disagrees with the grid beneath it is worse than no
 * subtitle, and an absent fact is an ABSENCE, never a placeholder (D-38-16).
 */
describe("statLine", () => {
  it("joinsWithTheDemosMiddleDot", () => {
    expect(statLine("138 ingredients", "5 alerts", "Last count: Today 08:00")).toBe(
      "138 ingredients · 5 alerts · Last count: Today 08:00",
    );
  });

  it("dropsAbsentPartsEntirelyRatherThanRenderingAnEmptySlot", () => {
    // The failure this exists to prevent: "12 vendors ·  · ", or worse, "Last count: —".
    expect(statLine("12 vendors", null, undefined, false, "")).toBe("12 vendors");
    expect(statLine(null, undefined, false)).toBe("");
  });
});

describe("countLine", () => {
  it("pluralisesWithoutAConditionalAtEveryCallSite", () => {
    expect(countLine(1, "vendor")).toBe("1 vendor");
    expect(countLine(12, "vendor")).toBe("12 vendors");
    expect(countLine(0, "alert")).toBe("0 alerts");
  });

  it("takesAnIrregularPluralWhenEnglishDemandsOne", () => {
    expect(countLine(3, "category", "categories")).toBe("3 categories");
    expect(countLine(1, "category", "categories")).toBe("1 category");
  });

  it("groupsThousandsSoAScaleIsReadableAtAGlance", () => {
    expect(countLine(1842, "customer")).toBe("1,842 customers");
  });
});

describe("filteredCountLine", () => {
  it("statesBothNumbersUnderAFilterSoAFilteredListIsNotMistakenForAnEmptyOne", () => {
    expect(filteredCountLine(42, 138, "ingredient")).toBe("42 of 138 ingredients");
  });

  it("collapsesToThePlainCountWhenNothingIsNarrowed", () => {
    expect(filteredCountLine(138, 138, "ingredient")).toBe("138 ingredients");
  });

  it("stillSaysZeroOfNRatherThanGoingSilent", () => {
    // Zero shown against a real total is the one case a reader must not read as "none exist".
    expect(filteredCountLine(0, 138, "ingredient")).toBe("0 of 138 ingredients");
  });
});
