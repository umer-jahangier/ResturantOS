import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { StatusAnnouncer, useStatusAnnouncer } from "@/components/ui/status-announcer";

/**
 * The polite live region (UI-SPEC §11, plan 38-15 task 8: "announces once, and only once").
 *
 * <h3>The finding that came before the tests</h3>
 *
 * The plan asks to verify that every async result announces exactly once. Measured first:
 * `grep -rn "useStatusAnnouncer" app components lib` returns **one** hit and it is the hook's own
 * declaration. **The region has zero call sites.** Nothing in the product announces through it;
 * async results reach assistive tech through Sonner's own region, mounted beside this one in
 * `app-providers.tsx`. "Not twice" is therefore currently true because the channel is empty,
 * which is not the same as the contract being met — and counting Sonner's announcements needs a
 * real browser, so it is `e2e/journeys/accessibility.spec.ts`'s to do.
 *
 * What IS testable here is the primitive, and the primitive had a defect in the opposite
 * direction.
 */

function Announcer({ text }: { text: string }) {
  const { announce } = useStatusAnnouncer();
  return (
    <>
      <StatusAnnouncer />
      <button type="button" onClick={() => announce(text)}>
        Announce
      </button>
    </>
  );
}

describe("StatusAnnouncer", () => {
  it("is a polite, atomic status region and is visually hidden", () => {
    render(<StatusAnnouncer />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-atomic", "true");
    expect(region.className).toContain("sr-only");
  });

  it("mutates the region when the SAME message is announced twice", () => {
    /*
     * A live region announces a DOM MUTATION, not a function call.
     *
     * <p>Before 38-15 the message was a single piece of state rendered as text, so announcing
     * "Saved" and then "Saved" again set state to a value React compares equal: no re-render, no
     * mutation, no announcement. The second save was SILENT — the exact inverse of the "announces
     * twice" defect the plan gates on, and just as wrong for a user who repeats an action.
     *
     * <p>Node identity is the proxy for the mutation, because jsdom has no accessibility layer
     * and cannot tell us what a screen reader said. It is an honest proxy: the replaced text node
     * is precisely the DOM change assistive tech listens for. Whether a given screen reader then
     * speaks it is a manual pass, and is declared as such in the summary rather than claimed
     * here.
     */
    render(<Announcer text="Saved" />);
    const button = screen.getByRole("button", { name: "Announce" });

    act(() => button.click());
    const first = screen.getByTestId("status-announcer-message");
    expect(first).toHaveTextContent("Saved");

    act(() => button.click());
    const second = screen.getByTestId("status-announcer-message");
    expect(second).toHaveTextContent("Saved");
    expect(second).not.toBe(first);
  });

  it("renders exactly one live region, so one announcement is not two", () => {
    // The way this becomes a double announcement is a SECOND `aria-live` element carrying the
    // same words — not `role="status"` and `aria-live` on the same node, which is one region
    // described twice and is the documented belt-and-braces.
    const { container } = render(<StatusAnnouncer />);
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
  });
});
