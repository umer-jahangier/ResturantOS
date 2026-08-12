import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ModifierDialog } from "@/components/pos/modifier-dialog";
import type { ModifierGroup } from "@/lib/models/modifier.model";
import type { MenuItem } from "@/lib/models/pos.model";
import type { CartModifier } from "@/components/pos/cart-reducer";

/**
 * S6 — tap a dish, configure it, and the line cannot be added until a forced group is answered.
 *
 * <h2>What these assert, and what they deliberately do not</h2>
 *
 * <p>Every assertion is something a cashier can SEE or DO: a dialog that opens, a button that
 * refuses, a sentence naming the group, a price on the screen. None reach into props. The
 * walkthrough measured this gap in exactly that currency — it tapped a dish and probed the page,
 * getting {@code {dialogs: 0, noteControls: []}} — so the proof is made the same way.
 *
 * <h2>Falsification, watched</h2>
 *
 * <ul>
 *   <li>Delete the {@code <ModifierDialog/>} mount from pos-terminal.tsx and every test here still
 *       passes, which is why {@code e2e} drives the real terminal — these prove the dialog, the
 *       browser run proves the wiring.</li>
 *   <li>Remove the {@code blockingErrors.length === 0} clause from {@code canAdd} and
 *       {@link #refusesToAddTheLineUntilTheForcedGroupIsAnswered} fails: {@code onConfirm} fires
 *       with an empty selection, which is a plate reaching the pass with no spice level on it.</li>
 *   <li>Drop the per-group {@code role="alert"} and the "names the group and the rule" assertion
 *       fails — the cashier is left with a dead button and no reason, the exact control this
 *       product has been criticised for.</li>
 *   <li>Render {@code option.priceDeltaPaisa} raw instead of through the shared formatter and the
 *       price assertions fail on "Rs 150.00".</li>
 * </ul>
 */

const KARAHI: MenuItem = {
  id: "11111111-1111-4111-8111-111111111111",
  categoryId: "22222222-2222-4222-8222-222222222222",
  categoryName: "Mains",
  name: "Chicken Karahi",
  description: null,
  basePricePaisa: 85000,
  taxRatePct: 0,
  taxRateCode: null,
  kdsStation: null,
  imageFileId: null,
  imageUrl: null,
  active: true,
  taxClassId: null,
  effectiveTaxRatePct: 0,
  effectiveTaxRateCode: null,
  effectiveTaxLabel: null,
  effectiveTaxSource: "NONE",
} as MenuItem;

const SPICE: ModifierGroup = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  menuItemId: KARAHI.id,
  name: "Spice level",
  required: true,
  minSelect: 1,
  maxSelect: 1,
  sortOrder: 0,
  active: true,
  optionCount: 2,
  options: [
    {
      id: "bbbbbbbb-0000-4000-8000-000000000001",
      groupId: "aaaaaaaa-0000-4000-8000-000000000001",
      name: "Medium",
      priceDeltaPaisa: 0,
      sortOrder: 0,
      active: true,
    },
    {
      id: "bbbbbbbb-0000-4000-8000-000000000002",
      groupId: "aaaaaaaa-0000-4000-8000-000000000001",
      name: "Hot",
      priceDeltaPaisa: 0,
      sortOrder: 1,
      active: true,
    },
  ],
};

const MEDIUM = SPICE.options[0]!;
const HOT = SPICE.options[1]!;

const EXTRAS: ModifierGroup = {
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  menuItemId: KARAHI.id,
  name: "Extras",
  required: false,
  minSelect: 0,
  maxSelect: 3,
  sortOrder: 1,
  active: true,
  optionCount: 2,
  options: [
    {
      id: "cccccccc-0000-4000-8000-000000000001",
      groupId: "aaaaaaaa-0000-4000-8000-000000000002",
      name: "Extra cheese",
      priceDeltaPaisa: 15000,
      sortOrder: 0,
      active: true,
    },
    {
      id: "cccccccc-0000-4000-8000-000000000002",
      groupId: "aaaaaaaa-0000-4000-8000-000000000002",
      name: "Extra raita",
      priceDeltaPaisa: 8000,
      sortOrder: 1,
      active: true,
    },
  ],
};

const CHEESE = EXTRAS.options[0]!;

function renderDialog(overrides: Partial<React.ComponentProps<typeof ModifierDialog>> = {}) {
  const onConfirm = vi.fn<(mods: CartModifier[]) => void>();
  const onCancel = vi.fn();
  render(
    <ModifierDialog
      item={KARAHI}
      groups={[SPICE, EXTRAS]}
      isLoading={false}
      isError={false}
      error={null}
      isRetrying={false}
      onRetry={vi.fn()}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onConfirm, onCancel };
}

describe("ModifierDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens on a dish that has options, and shows both groups with their rules", () => {
    renderDialog();
    expect(screen.getByTestId("modifier-dialog")).toBeInTheDocument();
    expect(screen.getByText("Chicken Karahi")).toBeInTheDocument();
    expect(screen.getByText(/Required — choose exactly 1 option/)).toBeInTheDocument();
    expect(screen.getByText(/Optional — choose up to 3 options/)).toBeInTheDocument();
  });

  /**
   * The reason the button is off is on screen BEFORE anyone presses it.
   *
   * <p>This assertion exists because the first cut of this dialog gated the message on a failed
   * submit while the button carried {@code aria-disabled} — and a disabled button cannot be
   * pressed by assistive tech or by Playwright, so the only route to the explanation was through a
   * control that refuses to be operated. It was caught by the browser run, not by this file, which
   * is why the browser run is the gate.
   */
  it("says why the line cannot be added before the cashier presses anything", () => {
    renderDialog();
    expect(screen.getByTestId(`modifier-group-error-${SPICE.id}`)).toHaveTextContent(
      "Spice level: choose exactly 1 option.",
    );
    expect(screen.getByTestId("modifier-dialog-add")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("modifier-dialog-add")).toHaveAttribute(
      "aria-describedby",
      "modifier-dialog-blocked",
    );
  });

  it("refuses to add the line until the forced group is answered, and names the group", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await user.click(screen.getByTestId("modifier-dialog-add"));

    expect(onConfirm).not.toHaveBeenCalled();
    const alert = screen.getByTestId(`modifier-group-error-${SPICE.id}`);
    expect(alert).toHaveTextContent("Spice level: choose exactly 1 option.");
    expect(alert).toHaveAttribute("role", "alert");
    expect(screen.getByTestId("modifier-dialog-add")).toHaveAttribute("aria-disabled", "true");
  });

  it("adds the line once spice level is chosen, carrying the option by name", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await user.click(screen.getByTestId(`modifier-option-${HOT.id}`));
    await user.click(screen.getByTestId("modifier-dialog-add"));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]![0]).toEqual([
      { id: HOT.id, name: "Hot", priceDeltaPaisa: 0 },
    ]);
  });

  it("prices a paid extra on the screen, and carries its delta out", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    // Rs 150.00, rendered through the shared money formatter — never `paisa / 100`.
    expect(screen.getByTestId(`modifier-option-${CHEESE.id}`)).toHaveTextContent(
      "Rs 150.00",
    );

    await user.click(screen.getByTestId(`modifier-option-${MEDIUM.id}`));
    await user.click(screen.getByTestId(`modifier-option-${CHEESE.id}`));

    // The plate's own price moves before it reaches the cart: Rs 850.00 + Rs 150.00.
    expect(screen.getByTestId("modifier-dialog-total")).toHaveTextContent("Rs 1,000.00");

    await user.click(screen.getByTestId("modifier-dialog-add"));
    expect(onConfirm.mock.calls[0]![0]).toEqual([
      { id: MEDIUM.id, name: "Medium", priceDeltaPaisa: 0 },
      { id: CHEESE.id, name: "Extra cheese", priceDeltaPaisa: 15000 },
    ]);
  });

  it("a choose-exactly-one group replaces rather than refuses the second tap", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await user.click(screen.getByTestId(`modifier-option-${MEDIUM.id}`));
    await user.click(screen.getByTestId(`modifier-option-${HOT.id}`));
    await user.click(screen.getByTestId("modifier-dialog-add"));

    expect(onConfirm.mock.calls[0]![0]).toEqual([
      { id: HOT.id, name: "Hot", priceDeltaPaisa: 0 },
    ]);
  });

  /**
   * A multi-select group past its ceiling. Note the contrast with the test above: a group whose
   * maximum is ONE behaves like a radio and replaces, because refusing that tap would leave the
   * cashier hunting for which of two identical buttons to untick. A group that allows two and is
   * offered a third is a real over-selection, and it is refused by name and by count.
   */
  it("refuses more than the optional group's maximum, and says how many were chosen", async () => {
    const user = userEvent.setup();
    const threeOptions: ModifierGroup = {
      ...EXTRAS,
      maxSelect: 2,
      optionCount: 3,
      options: [
        ...EXTRAS.options,
        {
          id: "cccccccc-0000-4000-8000-000000000003",
          groupId: EXTRAS.id,
          name: "Extra salad",
          priceDeltaPaisa: 6000,
          sortOrder: 2,
          active: true,
        },
      ],
    };
    const { onConfirm } = renderDialog({ groups: [SPICE, threeOptions] });

    await user.click(screen.getByTestId(`modifier-option-${MEDIUM.id}`));
    for (const option of threeOptions.options) {
      await user.click(screen.getByTestId(`modifier-option-${option.id}`));
    }
    await user.click(screen.getByTestId("modifier-dialog-add"));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByTestId(`modifier-group-error-${EXTRAS.id}`)).toHaveTextContent(
      "Extras: choose up to 2 options — you have chosen 3.",
    );
  });

  /**
   * A failed catalogue read is NOT "this dish has no options" (GA-001). The cashier is told what
   * happened and offered a retry — never a dialog that quietly adds an unconfigured plate.
   */
  it("says the options could not be loaded rather than showing an empty group list", () => {
    renderDialog({
      groups: undefined,
      isError: true,
      error: new Error("boom"),
    });
    expect(screen.queryByText(/no options to choose/i)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows a contextual skeleton, not an empty state, while the catalogue is in flight", () => {
    renderDialog({ groups: undefined, isLoading: true });
    expect(screen.getByTestId("modifier-dialog-skeleton")).toBeInTheDocument();
    expect(screen.queryByText(/no options to choose/i)).not.toBeInTheDocument();
  });
});
