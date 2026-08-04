import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  RecipeCostLineShare,
  RecipeCostPanel,
  type RecipeCostLine,
} from "@/components/inventory/recipe-cost-panel";
import type { RecipeCostPreview } from "@/lib/adapters/inventory.adapter";

// recipe-cost-panel.test.tsx — 08.2-16 Task 3: test-enforces the live-cost UI contract
// (08.2-UI-SPEC.md Screen 3): first-load skeleton, dimmed-previous-values-while-recomputing,
// 1-decimal food-cost %, null-food-cost dash+tooltip, degraded-line warning + excluded-count
// footnote, and whole-number per-line shares.

function makeLine(overrides: Partial<RecipeCostLine> = {}): RecipeCostLine {
  return {
    index: 0,
    ingredientId: "ingredient-1",
    ingredientName: "Flour",
    effectiveBaseQty: "1",
    lineCostPaisa: 5000,
    sharePctOfBatch: 50,
    warning: null,
    ...overrides,
  };
}

function makePreview(overrides: Partial<RecipeCostPreview> = {}): RecipeCostPreview {
  return {
    batchCostPaisa: 10000,
    portionCostPaisa: 2500,
    yieldServings: "4",
    menuItemPricePaisa: 15000,
    foodCostPct: "16.7",
    excludedLineCount: 0,
    lines: [makeLine()],
    ...overrides,
  };
}

describe("RecipeCostPanel — live plate-cost contract (INV-15)", () => {
  it("firstLoadRendersSkeletonNotABlankPanel", () => {
    render(<RecipeCostPanel preview={undefined} isFetching={false} isFirstLoad />);

    expect(document.querySelectorAll('[role="presentation"]').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Batch cost/i)).not.toBeInTheDocument();
  });

  it("recomputeKeepsPreviousValuesVisibleAndDimmed", () => {
    const preview = makePreview({ batchCostPaisa: 123456 });
    const { container } = render(
      <RecipeCostPanel preview={preview} isFetching isFirstLoad={false} />,
    );

    // The previous batch-cost figure is still present...
    expect(screen.getByText(/1,234\.56/)).toBeInTheDocument();
    // ...dimmed via opacity-60...
    expect(container.querySelector(".opacity-60")).toBeInTheDocument();
    // ...with the Recalculating caption — never a blank panel.
    expect(screen.getByText(/Recalculating/i)).toBeInTheDocument();
  });

  it("foodCostPercentRendersToOneDecimalPlace", () => {
    const preview = makePreview({ foodCostPct: "33.333" });
    render(<RecipeCostPanel preview={preview} isFetching={false} isFirstLoad={false} />);

    expect(screen.getByText("33.3%")).toBeInTheDocument();
  });

  it("nullFoodCostRendersADashWithAnExplanation", async () => {
    const preview = makePreview({ foodCostPct: null, menuItemPricePaisa: null });
    render(<RecipeCostPanel preview={preview} isFetching={false} isFirstLoad={false} />);

    const dash = screen.getByText("—");
    expect(dash).toBeInTheDocument();

    const user = userEvent.setup();
    await user.hover(dash);

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "No menu price to compare against",
    );
  }, 10000);

  it("degradedLinesShowTheWarningAndAreReportedInTheFootnote", () => {
    const warnedLine = makeLine({
      ingredientId: "ingredient-2",
      ingredientName: "Saffron",
      lineCostPaisa: null,
      sharePctOfBatch: null,
      warning: "Couldn't price this line — check the unit conversion for Saffron.",
    });
    const preview = makePreview({ excludedLineCount: 1, lines: [makeLine(), warnedLine] });

    render(<RecipeCostPanel preview={preview} isFetching={false} isFirstLoad={false} />);
    expect(screen.getByText(/1 line excluded from cost pending a fix/i)).toBeInTheDocument();

    render(<RecipeCostLineShare line={warnedLine} />);
    expect(screen.getByText(warnedLine.warning as string)).toBeInTheDocument();
  });

  it("perLineSharesRenderAsWholeNumbers", () => {
    const line = makeLine({ sharePctOfBatch: 42 });
    render(<RecipeCostLineShare line={line} />);

    expect(screen.getByText("42%")).toBeInTheDocument();
  });
});
