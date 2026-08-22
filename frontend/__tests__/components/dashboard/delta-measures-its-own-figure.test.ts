import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { FRONTEND_ROOT } from "../../lib/theme/module-graph";

/**
 * A delta chip must measure the figure it sits under.
 *
 * <h3>The defect this exists to stop coming back</h3>
 *
 * The owner dashboard's "Average order" tile rendered a money value — net sales divided by
 * orders — with a delta computed as `pctChange(orderCount, priorOrderCount)`: the change in
 * ORDER COUNT. `KpiTile` renders a delta as a bare "% vs prior" with no metric name, directly
 * beneath the value, so there was nothing on screen to reveal the mismatch.
 *
 * Concretely: if net sales rise 20% and orders rise 20%, the average order is FLAT — and that
 * chip read "+20.0% vs prior".
 *
 * That is not a fabricated value, which `StatTileProps`/`KpiTileDelta` already make
 * unrepresentable. It is a fabricated CHANGE in a value — the same defect one level up, and
 * the exact thing `KpiTileDelta`'s own docblock claims to have closed. A type cannot catch it:
 * both arguments are honest numbers, they are simply not the numerator and denominator of the
 * figure above them.
 *
 * So it is asserted at the source, in the idiom this repo already uses for contracts a type
 * cannot express.
 */
describe("a KPI delta measures the figure it is rendered under", () => {
  const source = readFileSync(
    resolve(FRONTEND_ROOT, "components/dashboard/owner-dashboard.tsx"),
    "utf8",
  );

  it("the average-order tile compares averages, never order counts", () => {
    // The whole `"owner-avg-order"` entry, from its key to the start of the next portlet key.
    const block = /"owner-avg-order":([\s\S]*?)\n {4}"/.exec(source)?.[1];
    expect(
      block,
      "ANCHOR NOT FOUND: the owner-avg-order portlet entry could not be located",
    ).toBeTruthy();

    expect(
      block,
      "the average-order delta must be computed from avgOrderPaisa vs priorAvgOrderPaisa",
    ).toContain("pctChange(avgOrderPaisa, priorAvgOrderPaisa)");

    expect(
      block,
      "the average-order delta must NOT be the change in order count — net sales and orders " +
        "both rising 20% leaves the average FLAT, and this chip would have claimed +20%",
    ).not.toContain("pctChange(orderCount, priorOrderCount)");
  });

  it("a missing prior average is an absence, not a flat 0%", () => {
    expect(source).toContain("priorAvgOrderPaisa === null");
    // pctChange already refuses a non-positive prior for the same reason; this is the guard for
    // the case where the prior AVERAGE cannot be formed at all because no prior orders exist.
    expect(source).toContain(
      "priorOrderCount > 0 ? Math.round(priorNetSalesPaisa / priorOrderCount) : null",
    );
  });
});
