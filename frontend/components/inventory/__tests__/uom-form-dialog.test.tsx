import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { UomFormDialog } from "@/components/inventory/UomFormDialog";

// uom-form-dialog.test.tsx — "Measured in" (baseUnitsFor) must be scoped to the CURRENTLY
// selected measure type, and reset when that type changes. A user report ("the base unit is
// always g") turned out to be correct behaviour on a live tenant whose WEIGHT family has exactly
// one base row (g) — but the only way to be sure the SELECT wasn't just stuck was to drive the
// real component and watch it actually switch dimensions.

function openDialog() {
  const Wrapper = createQueryWrapper();
  render(
    <Wrapper>
      <UomFormDialog trigger={<button type="button">Add unit</button>} />
    </Wrapper>,
  );
}

describe("UomFormDialog — Measured in follows Measure type", () => {
  afterEach(() => clearSession());

  it("switchingMeasureTypeReplacesTheMeasuredInOptionsRatherThanLeavingThemStuck", async () => {
    seedSession({ permissions: ["inventory.item.view", "inventory.item.manage"] });
    openDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Add unit" }));
    const dialog = await screen.findByRole("dialog");

    const measureType = within(dialog).getByRole("combobox", { name: "Measure type" });
    const measuredIn = within(dialog).getByRole("combobox", {
      name: "Measured in",
    }) as HTMLSelectElement;

    // Defaults to Weight — the MSW fixture's only WEIGHT base row is "kg", so that (and only
    // that) must be offered.
    expect(within(measuredIn).getByRole("option", { name: "kg · Kilogram" })).toBeInTheDocument();
    expect(within(measuredIn).queryByRole("option", { name: /each/i })).toBeNull();

    await user.selectOptions(measureType, "COUNT");

    // If this were "always g" in the literal, stuck-select sense, this option would still be
    // "kg · Kilogram" here. It must be gone, replaced by COUNT's own base.
    expect(within(measuredIn).queryByRole("option", { name: "kg · Kilogram" })).toBeNull();
    expect(within(measuredIn).getByRole("option", { name: "each · Each" })).toBeInTheDocument();

    // Switching type also clears whatever was selected — carrying a WEIGHT-family code over
    // into a COUNT unit would submit a pair the server rejects as a dimension mismatch.
    expect(measuredIn.value).toBe("");

    await user.selectOptions(measureType, "VOLUME");

    // The fixture seeds no VOLUME unit at all, so the only correct list is empty — proving the
    // filter is genuinely re-scoping per type rather than falling back to "show everything" or
    // "keep showing the last type's options" when a dimension has nothing to offer.
    expect(within(measuredIn).queryByRole("option", { name: "kg · Kilogram" })).toBeNull();
    expect(within(measuredIn).queryByRole("option", { name: "each · Each" })).toBeNull();
    expect(within(measuredIn).getAllByRole("option")).toHaveLength(1); // just the placeholder
  });

  it("aFamilyWithExactlyOneBaseRowCorrectlyOffersOnlyThatRowNotABug", async () => {
    // The scenario behind the report: a tenant's WEIGHT family has exactly one row with no
    // base_unit_code (its family base). Seeing only that one option under "Measured in" is the
    // form working as designed — Case/Bunch/Tray define themselves in terms of a TRUE base unit,
    // never a derived one (kg, dozen, litre), so chained conversions can't compound rounding
    // error. This pins that as intended, not a bug to "fix" by widening the list.
    seedSession({ permissions: ["inventory.item.view", "inventory.item.manage"] });
    openDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Add unit" }));
    const dialog = await screen.findByRole("dialog");
    const measuredIn = within(dialog).getByRole("combobox", { name: "Measured in" });

    // Placeholder + exactly one real base unit — not zero (the filter did find it), not more
    // than one (nothing outside WEIGHT leaked in).
    expect(within(measuredIn).getAllByRole("option")).toHaveLength(2);
    expect(within(measuredIn).getByRole("option", { name: "kg · Kilogram" })).toBeInTheDocument();
  });
});
