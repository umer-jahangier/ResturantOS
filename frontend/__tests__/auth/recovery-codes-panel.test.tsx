import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RecoveryCodesPanel } from "@/components/auth/recovery-codes-panel";

/**
 * The acknowledgement gate, tested because it is the one piece of UI in the product whose failure
 * destroys a credential.
 *
 * Recovery codes are returned once and stored only as digests. If this panel lets the user leave
 * before they have saved them — a stray Enter, a continue button that was never disabled — the
 * codes are gone and the account's only fallback with them. That is not a cosmetic regression, so
 * it gets a test rather than a code review.
 */
const CODES = ["ABCDE-FGHJK", "LMNPQ-RSTUV", "WXYZ2-34567", "89ABC-DEFGH"];

describe("RecoveryCodesPanel — the save-before-you-leave gate", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    // jsdom defines navigator.clipboard as a read-only accessor, so Object.assign silently fails
    // and the spy never lands. defineProperty is what actually replaces it.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
  });

  it("shows every code it was given", () => {
    render(<RecoveryCodesPanel codes={CODES} onAcknowledged={vi.fn()} />);
    for (const code of CODES) {
      expect(screen.getByText(code)).toBeInTheDocument();
    }
  });

  it("will not let the user continue until they confirm they saved them", async () => {
    const onAcknowledged = vi.fn();
    const user = userEvent.setup();
    render(<RecoveryCodesPanel codes={CODES} onAcknowledged={onAcknowledged} />);

    const continueButton = screen.getByTestId("recovery-codes-continue");
    expect(continueButton).toBeDisabled();

    // A click while disabled must do nothing — this is the exact slip the gate exists to stop.
    await user.click(continueButton);
    expect(onAcknowledged).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("recovery-codes-acknowledge"));
    expect(continueButton).toBeEnabled();

    await user.click(continueButton);
    expect(onAcknowledged).toHaveBeenCalledTimes(1);
  });

  it("un-ticking the confirmation re-arms the gate", async () => {
    const user = userEvent.setup();
    render(<RecoveryCodesPanel codes={CODES} onAcknowledged={vi.fn()} />);

    const checkbox = screen.getByTestId("recovery-codes-acknowledge");
    await user.click(checkbox);
    expect(screen.getByTestId("recovery-codes-continue")).toBeEnabled();

    await user.click(checkbox);
    expect(screen.getByTestId("recovery-codes-continue")).toBeDisabled();
  });

  it("copies every code, newline-separated, not just the first", async () => {
    // userEvent.setup() installs its OWN navigator.clipboard stub, so ours has to be defined
    // after it or the assertion reads a spy the component never called.
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    render(<RecoveryCodesPanel codes={CODES} onAcknowledged={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /copy all/i }));
    expect(writeText).toHaveBeenCalledWith(CODES.join("\n"));
  });

  it("says plainly that this is the only time the codes are shown", () => {
    render(<RecoveryCodesPanel codes={CODES} onAcknowledged={vi.fn()} />);
    // The warning is the feature. A panel that renders the codes without it produces users who
    // close the tab assuming they can come back for them.
    expect(screen.getByText(/only time they will be shown/i)).toBeInTheDocument();
  });
});
