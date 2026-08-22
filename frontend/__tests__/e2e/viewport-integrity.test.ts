import { describe, expect, it } from "vitest";

import {
  analyse,
  counts,
  desktopTablesBelowMd,
  occludedInteractives,
  overflowBlame,
  overflowOffenders,
  truncatedValues,
  undersizedTargets,
} from "../../e2e/viewport-integrity.mjs";

/**
 * The probe's own gate (plan 38-14 task 5, "Negative controls — observe each failing").
 *
 * <h3>Why the negative controls live here and not only in the browser</h3>
 *
 * The plan requires four negative controls: put the defect back, watch the check go red. Run only
 * in Playwright they need a live stack, a seeded database and sixteen Spring services, so in
 * practice they would be run once, by the person who wrote them, and never again — and the
 * failure mode this whole plan exists to prevent is precisely a check that nobody has seen fail.
 *
 * <p>Every judgement in `viewport-integrity.mjs` is a pure function of records the browser
 * collects, which means the defects can be *constructed* as geometry. These run in CI, in
 * milliseconds, with no browser at all. What they cannot prove is that the collector reads the
 * DOM correctly; that is the e2e spec's job, and the division is deliberate — this file proves
 * the probe judges correctly, `e2e/journeys/responsive.spec.ts` proves it looks in the right
 * place.
 *
 * <h3>The one that matters most</h3>
 *
 * `an overlay is invisible to an overflow count` reproduces, as a unit test, the exact reading
 * that made the first audit pass report a healthy POS while the screenshot showed a broken one.
 * If a future refactor collapses these five checks into one number, that test fails.
 */

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

const VIEWPORT = { width: 390, height: 844 };

function box(left: number, top: number, width: number, height: number): Rect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

/** A record in the shape `COLLECT` returns, with everything healthy unless overridden. */
function el(over: Record<string, unknown> = {}) {
  return {
    tag: "DIV",
    testid: null,
    slot: null,
    cls: "",
    name: "",
    rect: box(0, 0, 200, 44),
    viewport: VIEWPORT,
    interactive: false,
    parentOverflows: false,
    coverage: { sampled: 0, covered: 0, by: null },
    ellipsis: false,
    clipping: false,
    numeric: false,
    isTable: false,
    ...over,
  };
}

describe("viewport integrity — the probe judges what the audit measured", () => {
  it("counts nothing on a page whose every box is inside the viewport", () => {
    const page = [
      el({ rect: box(0, 0, 390, 56) }),
      el({ tag: "BUTTON", interactive: true, rect: box(8, 8, 44, 44), name: "Menu" }),
    ];
    expect(counts(analyse(page, 390))).toEqual({
      overflow: 0,
      occluded: 0,
      undersized: 0,
      truncated: 0,
      tablesBelowMd: 0,
    });
  });

  describe("negative control 1 — the desktop table at 390px", () => {
    /**
     * The plan: "Render the desktop table at 390px → element-overflow red. It should reproduce
     * the 100-element baseline EXACTLY; if it does not, the probe is measuring something else."
     *
     * <p>So the assertion is on the number 100, not on `> 0`. A probe that reports "some
     * overflow" cannot tell a fix from a change of predicate, and this plan's whole verification
     * table is expressed as baselines moving to zero.
     */
    const wideTable = () => {
      const rows = [];
      // One table, eight columns, twenty-five rows — the shape `/app/inventory/stock` dropped in
      // unchanged. Cells 5–8 of each row hang past a 390px viewport.
      const COL = 98; // eight of these is 784px — four fit inside 390, four do not
      rows.push(el({ tag: "TABLE", isTable: true, rect: box(0, 100, COL * 8, 1100) }));
      for (let r = 0; r < 25; r += 1) {
        for (let c = 0; c < 8; c += 1) {
          rows.push(
            el({
              tag: "TD",
              rect: box(c * COL, 140 + r * 44, COL, 44),
              // Every cell sits inside the row, which sits inside the table, which is the
              // element that is actually too wide.
              parentOverflows: true,
            }),
          );
        }
      }
      return rows;
    };

    it("reproduces the audit's 100-element baseline exactly", () => {
      const page = wideTable();
      // 25 rows × 4 clipped columns = 100 cells past the edge. The <table> itself also hangs
      // over, and it is the shallowest offender — so the raw count is the audit's 100 plus the
      // container, and `overflowBlame` isolates the one element a person can actually fix.
      expect(overflowOffenders(page).filter((r) => r.tag === "TD")).toHaveLength(100);
      expect(overflowBlame(page).map((r) => r.tag)).toEqual(["TABLE"]);
    });

    it("goes green when the table stands down for a card list below md", () => {
      // What `DataGrid` actually does: the table is `hidden md:block`, so at 390px it is
      // `display: none` and the collector never emits it. The cards are 358px wide and fit.
      const cards = Array.from({ length: 25 }, (_, i) =>
        el({ tag: "LI", rect: box(16, 140 + i * 64, 358, 64) }),
      );
      expect(counts(analyse(cards, 390))).toMatchObject({ overflow: 0, tablesBelowMd: 0 });
    });

    it("reports a visible <table> below md as its own failure, not merely as overflow", () => {
      // A table can fit horizontally and still be the wrong answer on a phone. Counting only
      // overflow would call this page clean.
      const narrowButStillATable = [el({ isTable: true, rect: box(0, 100, 380, 900) })];
      expect(desktopTablesBelowMd(narrowButStillATable, 390)).toHaveLength(1);
      expect(overflowOffenders(narrowButStillATable)).toHaveLength(0);
      // …and at 768 and above a table is exactly right.
      expect(desktopTablesBelowMd(narrowButStillATable, 768)).toHaveLength(0);
    });
  });

  describe("negative control 2 — the two-column POS at 390px", () => {
    /**
     * The defect that started this: the cart panel did not overflow, it OVERLAID. The plan says
     * to run this control first, against unfixed code, and watch it fail.
     */
    const cart = () => el({ testid: "order-panel", rect: box(50, 0, 340, 844) });

    const menuTileUnderTheCart = () =>
      el({
        tag: "BUTTON",
        interactive: true,
        name: "Chicken Karahi",
        rect: box(60, 200, 130, 130),
        // Every sampled point hit the cart.
        coverage: { sampled: 5, covered: 5, by: "order-panel" },
      });

    it("an overlay is invisible to an overflow count — and visible to the occlusion check", () => {
      const page = [cart(), menuTileUnderTheCart()];
      const result = analyse(page, 390);

      // This is the exact reading the first audit pass produced, and why it was believed.
      expect(result.overflow).toHaveLength(0);

      // And this is what it missed.
      expect(result.occluded).toHaveLength(1);
      expect(result.occluded[0]?.name).toBe("Chicken Karahi");
      expect(result.occluded[0]?.coverage.by).toBe("order-panel");
    });

    it("goes green when the cart becomes a bottom sheet the cashier raises", () => {
      // Wave 4's shape: the sheet is `hidden` until opened, so the collector drops it, and the
      // grid has the whole area. Nothing is under anything.
      const page = [
        el({
          tag: "BUTTON",
          interactive: true,
          name: "Chicken Karahi",
          rect: box(8, 200, 130, 130),
          coverage: { sampled: 5, covered: 0, by: null },
        }),
      ];
      expect(analyse(page, 390).occluded).toHaveLength(0);
    });

    it("does not call a control occluded when it is only partly covered", () => {
      // A sticky total bar overlapping the bottom edge of a tile is not the same defect, and a
      // check that cannot tell them apart gets switched off.
      const partly = el({
        tag: "BUTTON",
        interactive: true,
        rect: box(8, 700, 130, 130),
        coverage: { sampled: 5, covered: 2, by: "till-bar" },
      });
      expect(occludedInteractives([partly])).toHaveLength(0);
    });

    it("does not call an element occluded because its own label was hit", () => {
      // `elementFromPoint` on a button returns the <span> inside it. The collector treats a
      // descendant hit as reaching the element, so `covered` stays 0 — asserted here because
      // getting this wrong makes every button in the product read as occluded, which is the
      // most likely way this check ends up deleted.
      const normal = el({
        tag: "BUTTON",
        interactive: true,
        coverage: { sampled: 5, covered: 0, by: null },
      });
      expect(occludedInteractives([normal])).toHaveLength(0);
    });

    it("ignores non-interactive boxes — a covered decoration is not a defect", () => {
      const decoration = el({
        interactive: false,
        coverage: { sampled: 5, covered: 5, by: "order-panel" },
      });
      expect(occludedInteractives([decoration])).toHaveLength(0);
    });
  });

  describe("negative control 3 — a control shrunk below 44px", () => {
    it("reports a 40px control and clears at 44", () => {
      const at40 = el({ tag: "A", interactive: true, name: "Stock", rect: box(0, 0, 60, 40) });
      const at44 = el({ tag: "A", interactive: true, name: "Stock", rect: box(0, 0, 60, 44) });
      expect(undersizedTargets([at40])).toHaveLength(1);
      expect(undersizedTargets([at44])).toHaveLength(0);
    });

    it("measures BOTH dimensions — a tall thin control is still unhittable", () => {
      const tallThin = el({ tag: "BUTTON", interactive: true, rect: box(0, 0, 24, 48) });
      expect(undersizedTargets([tallThin])).toHaveLength(1);
    });

    it("reproduces the tab-strip baseline the section layouts carried", () => {
      // Six `px-1 pb-2 text-small` links, ~20px tall — `inventory-tabs` before `SectionTabs`.
      const before = Array.from({ length: 6 }, () =>
        el({ tag: "A", interactive: true, rect: box(0, 0, 70, 20) }),
      );
      expect(undersizedTargets(before)).toHaveLength(6);

      const after = Array.from({ length: 6 }, () =>
        el({ tag: "A", interactive: true, rect: box(0, 0, 70, 44) }),
      );
      expect(undersizedTargets(after)).toHaveLength(0);
    });
  });

  describe("negative control 4 — a money cell forced to an ellipsis", () => {
    it("reports a clipped money value", () => {
      const clipped = el({
        tag: "SPAN",
        numeric: true,
        ellipsis: true,
        clipping: true,
        rect: box(0, 0, 60, 20),
      });
      expect(truncatedValues([clipped])).toHaveLength(1);
    });

    it("does not report `truncate` that is declared but not firing", () => {
      // Most `truncate` in this product never clips anything. A check that fired on the
      // declaration would report hundreds of false positives on day one and be switched off.
      const declaredOnly = el({ numeric: true, ellipsis: true, clipping: false });
      expect(truncatedValues([declaredOnly])).toHaveLength(0);
    });

    it("does not report clipped PROSE — only money and quantities", () => {
      // A truncated vendor name is a design decision. A truncated number is a wrong number.
      const clippedProse = el({ numeric: false, ellipsis: true, clipping: true });
      expect(truncatedValues([clippedProse])).toHaveLength(0);
    });
  });

  describe("the overflow predicate is the audit's, not a new one", () => {
    it("tolerates sub-pixel layout rounding", () => {
      // A full-width element lands on 390.004 constantly. `>= vw` would report every one.
      const subpixel = el({ rect: box(0, 0, 390.004, 56) });
      expect(overflowOffenders([subpixel])).toHaveLength(0);
    });

    it("ignores slivers under 24px, exactly as the audit did", () => {
      // Kept so the plan's baselines (stock 100 @390, 42 @1024, PO 4 @390) stay comparable.
      const sliver = el({ rect: box(388, 0, 20, 4) });
      expect(overflowOffenders([sliver])).toHaveLength(0);
    });

    it("reports a real overhang", () => {
      const real = el({ rect: box(300, 0, 200, 44) });
      expect(overflowOffenders([real])).toHaveLength(1);
    });
  });
});
