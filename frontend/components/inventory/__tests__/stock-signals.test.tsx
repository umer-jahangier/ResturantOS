import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  FlaggedValue,
  NEGATIVE_ON_HAND_REASON,
  OnHandQuantity,
  StockAlertChip,
  isNegativeQuantity,
  stockAlertLevel,
  stockRowClassName,
} from "@/components/inventory/stock-signals";
import { MoneyDisplay } from "@/components/ui/money-display";

/**
 * stock-signals.test.tsx — plan 38-07 tasks 3 and 4.
 *
 * <p>The negative cases are asserted against the REAL measured row: `/app/inventory/stock`
 * renders Chicken at **−2987 KG** and a branch total of **−Rs 2,116,690.70**. Those exact values
 * are used here so the test fails against the code that shipped them as ordinary numbers, which
 * is the negative control the plan asks to be observed first.
 */

const CHICKEN_QTY = "-2987";
const BRANCH_TOTAL_PAISA = -211669070;

describe("stock alert channels (task 3)", () => {
  it("outOfStockCarriesIconTextAndColourNotColourAlone", () => {
    render(<StockAlertChip level="out" />);
    const chip = screen.getByTestId("stock-alert-out");

    // 1. The WORD. Strip every colour and the row still says what is wrong.
    expect(chip).toHaveTextContent("Out of stock");
    // 2. The ICON, decorative to a screen reader (the word already carries the meaning).
    expect(chip.querySelector("svg")).not.toBeNull();
    // 3. The HUE, and only as the third channel.
    expect(chip.className).toContain("text-destructive");
  });

  it("lowStockCarriesItsOwnThreeChannelsAndADifferentWord", () => {
    render(<StockAlertChip level="low" />);
    const chip = screen.getByTestId("stock-alert-low");

    expect(chip).toHaveTextContent("Below reorder point");
    expect(chip.querySelector("svg")).not.toBeNull();
    expect(chip.className).toContain("text-warning");
  });

  it("anOkRowSaysInStockRatherThanRenderingAnEmptyStatusCell", () => {
    render(<StockAlertChip level="ok" />);
    // A blank Status cell reads as "not assessed", which is a different claim from "fine".
    expect(screen.getByTestId("stock-alert-ok")).toHaveTextContent("In stock");
  });

  it("outOfStockWinsOverBelowReorderPointWhenTheServerSetsBothFlags", () => {
    const both = { belowReorderPoint: true, nonPositive: true };
    expect(stockAlertLevel(both)).toBe("out");
    expect(stockRowClassName(both)).toBe("bg-destructive/10");
    expect(stockRowClassName({ belowReorderPoint: true, nonPositive: false })).toBe(
      "bg-warning/10",
    );
    expect(stockRowClassName({ belowReorderPoint: false, nonPositive: false })).toBeUndefined();
  });

  it("theLevelIsReadFromTheServerFlagsAndNeverRederivedInTheBrowser", () => {
    // A row the server did NOT flag stays OK even though the quantity is plainly negative.
    // T-08.2-173: re-deriving stock state in the browser is this phase's own origin bug.
    expect(stockAlertLevel({ belowReorderPoint: false, nonPositive: false })).toBe("ok");
  });
});

describe("negative on-hand gets a stated reason (task 4)", () => {
  it("recognisesTheApisStringQuantitiesAndIgnoresUnusableOnes", () => {
    expect(isNegativeQuantity(CHICKEN_QTY)).toBe(true);
    expect(isNegativeQuantity(-0.5)).toBe(true);
    expect(isNegativeQuantity("0")).toBe(false);
    expect(isNegativeQuantity("12.5")).toBe(false);
    expect(isNegativeQuantity(null)).toBe(false);
    expect(isNegativeQuantity("not a number")).toBe(false);
  });

  it("theMinus2987KgRowIsNeverRenderedAsAnOrdinaryNumber", async () => {
    render(<OnHandQuantity qty={CHICKEN_QTY} uom="KG" name="Chicken" />);

    // The figure is still shown — hiding it would be a second lie, and inventory correctness is
    // out of this plan's scope.
    expect(screen.getByTestId("negative-on-hand")).toHaveTextContent("-2987 KG");
    // But it is not shown as ordinary. Three channels again: the words "below zero", the alert
    // glyph inside the affordance, and the destructive hue.
    expect(screen.getByText("below zero")).toBeInTheDocument();

    const why = screen.getByRole("button", { name: "Why is Chicken on hand below zero?" });
    expect(why).toBeInTheDocument();

    await userEvent.click(why);
    // The explanation says what happened, not that something went wrong: nothing failed.
    expect(await screen.findByText(NEGATIVE_ON_HAND_REASON)).toBeInTheDocument();
  });

  it("aNonNegativeQuantityGetsNoAffordanceAtAll", () => {
    render(<OnHandQuantity qty="12.5" uom="KG" name="Chicken" />);
    expect(screen.getByText("12.5 KG")).toBeInTheDocument();
    expect(screen.queryByText("below zero")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("theMinusRs2116690Point70BranchTotalIsFlaggedThroughTheOneMoneyPath", () => {
    render(
      <FlaggedValue paisa={BRANCH_TOTAL_PAISA} label="total stock value">
        <MoneyDisplay paisa={BRANCH_TOTAL_PAISA} />
      </FlaggedValue>,
    );

    const flagged = screen.getByTestId("negative-value");
    // The amount is still formatted by MoneyDisplay and nothing else — no second money path.
    expect(within(flagged).getByText(/2,116,690\.70/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Why is total stock value below zero?" }),
    ).toBeInTheDocument();
  });

  it("aPositiveTotalIsLeftCompletelyAloneSoTheFlagStaysMeaningful", () => {
    render(
      <FlaggedValue paisa={125000} label="total stock value">
        <MoneyDisplay paisa={125000} />
      </FlaggedValue>,
    );
    expect(screen.queryByTestId("negative-value")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
