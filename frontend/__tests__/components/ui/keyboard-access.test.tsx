import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { z } from "zod";

import { MAIN_CONTENT_ID, SkipLink } from "@/components/shared/skip-link";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useStandardForm } from "@/lib/forms/standard-form";

/**
 * The keyboard and assistive-tech contract, asserted by RENDERING rather than by reading source
 * (UI-SPEC §11, plan 38-15 tasks 1, 5 and 7).
 *
 * <h3>Why this file exists alongside gate G12</h3>
 *
 * `__tests__/lib/theme/a11y-invariants.test.ts` scans source text. That is the right instrument
 * for "is the skip link mounted above the sidebar" — a property of a file — and the wrong one for
 * "does clicking it move focus", which is a property of a running document. A source scan can
 * confirm `tabIndex={-1}` is written down; only a render can confirm the element it is written on
 * can actually receive focus.
 *
 * <h3>What is NOT claimed here</h3>
 *
 * jsdom has no layout, so it cannot answer "is the link visible when focused" (that is `top`
 * moving from `-6rem` to `8px`, and jsdom computes neither) and it cannot answer "how many Tab
 * presses reach `<main>`" (that needs the real focusable-element algorithm over a real session).
 * Both live in `e2e/journeys/accessibility.spec.ts`. What is claimed here is the mechanism: the
 * link exists, precedes the content, points at a target that can hold focus, and moves focus
 * there when activated.
 */

describe("skip link (UI-SPEC §11 — measured 0, contract 1 and first)", () => {
  function Shell() {
    return (
      <>
        <SkipLink />
        <nav aria-label="Primary">
          <a href="/one">One</a>
          <a href="/two">Two</a>
        </nav>
        <main id={MAIN_CONTENT_ID} tabIndex={-1}>
          <h1>Purchase orders</h1>
          <button type="button">First page control</button>
        </main>
      </>
    );
  }

  it("is the first link in the document and names its destination", () => {
    render(<Shell />);
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", `#${MAIN_CONTENT_ID}`);
    expect(links[0]).toHaveAccessibleName("Skip to content");
  });

  it("is in the accessibility tree, not hidden from it", () => {
    // The lazy way to hide a skip link is `display: none` or `aria-hidden`, either of which makes
    // it unreachable by the only users it exists for. `getByRole` does not match hidden elements,
    // so this assertion is the check.
    render(<Shell />);
    expect(screen.getByRole("link", { name: "Skip to content" })).toBeInTheDocument();
  });

  it("moves focus INTO <main>, not merely the scroll position", () => {
    render(<Shell />);
    const link = screen.getByRole("link", { name: "Skip to content" });
    link.click();
    const main = document.getElementById(MAIN_CONTENT_ID);
    expect(document.activeElement).toBe(main);
    // And the next Tab therefore lands on the page's own first control rather than resuming at
    // nav link 2 — which is the entire point of the 22 → ≤ 2 contract.
    expect(main).toContainElement(screen.getByRole("button", { name: "First page control" }));
  });

  it("carries no transform, at any state", () => {
    /*
     * The receipt print path (`receipt-print.css:181`) anchors `.receipt-root` with
     * `position: fixed`, and a `transform` on ANY ancestor makes that ancestor the containing
     * block for fixed descendants — at print time too. This link renders in the shell, which is
     * an ancestor of `/app/pos/orders/[orderId]/receipt`.
     *
     * The idiomatic Tailwind spelling for an off-screen skip link is `-translate-y-full`. It is
     * forbidden here for that reason and for a second one: `zone-containment.test.ts` scans the
     * BUILT stylesheet for containing-block creators outside `[data-zone="expressive"]`, so the
     * utility would emit a `transform` rule rooted at nothing and fail G5 as well.
     */
    render(<Shell />);
    const cls = screen.getByRole("link", { name: "Skip to content" }).className;
    expect(cls).not.toMatch(/translate|scale|rotate|skew|\btransform\b/);
    expect(cls).not.toMatch(/blur|backdrop|will-change|\bcontain-/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const schema = z.object({
  vendorName: z.string().min(1, "Vendor name is required"),
  contact: z.string().min(1, "Contact is required"),
  notes: z.string().optional(),
});

function TwoRequiredFields({ onValid = () => {} }: { onValid?: () => void }) {
  const form = useStandardForm({
    schema,
    defaultValues: { vendorName: "", contact: "", notes: "" },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onValid)} noValidate>
        <FormField
          control={form.control}
          name="vendorName"
          render={({ field }) => (
            <FormItem required>
              <FormLabel>Vendor name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="contact"
          render={({ field }) => (
            <FormItem required>
              <FormLabel>Contact</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <button type="submit">Save</button>
      </form>
    </Form>
  );
}

describe("required fields (UI-SPEC §11 — 0 marked in both audited dialogs)", () => {
  it("publishes aria-required on the control, and only on the required ones", () => {
    render(<TwoRequiredFields />);
    expect(screen.getByLabelText(/Vendor name/)).toHaveAttribute("aria-required", "true");
    expect(screen.getByLabelText(/Contact/)).toHaveAttribute("aria-required", "true");
    // Optional fields carry no attribute at all rather than `aria-required="false"`, which would
    // put an inert attribute on every control in the product to say nothing.
    expect(screen.getByLabelText(/Notes/)).not.toHaveAttribute("aria-required");
  });

  it("draws a visible glyph, so colour is not the only channel (D-38-13, §4.2)", () => {
    const { container } = render(<TwoRequiredFields />);
    const markers = container.querySelectorAll('[data-slot="form-required-marker"]');
    expect(markers).toHaveLength(2);
    // A GLYPH, present in the rendered text — legible on a monochrome remote session and to a
    // protanopic reader. `text-destructive` is a third, redundant cue; strip it and the asterisk
    // is still there. This extends the agreement `activity-row.tsx` and `stat-tile.tsx` already
    // record, rather than re-litigating it.
    expect(markers[0]!.textContent).toBe("*");
    // Hidden from assistive tech BECAUSE `aria-required` already says it. Exposing both would
    // announce "required" twice per field — eighteen redundant words on a nine-field dialog.
    expect(markers[0]).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the accessible name free of the marker", () => {
    render(<TwoRequiredFields />);
    /*
     * If the asterisk leaked into the name, every required field would be announced as
     * "Vendor name star" — which is why the marker is `aria-hidden` rather than `sr-only` text.
     *
     * <p>Asserted with `toHaveAccessibleName`, deliberately, and NOT with
     * `getByLabelText("Vendor name")`. The two disagree here and only one of them is right:
     * `getByLabelText` matches the label's raw `textContent`, which is "Vendor name*" and
     * includes the hidden glyph, while `toHaveAccessibleName` runs `dom-accessibility-api`,
     * which implements accname's rule that an `aria-hidden="true"` subtree is excluded. A screen
     * reader does the latter. Observed: the `getByLabelText` spelling failed against a component
     * that is correct — a test asserting the testing library's simplification rather than the
     * platform's behaviour.
     */
    expect(screen.getByRole("textbox", { name: "Vendor name" })).toHaveAccessibleName(
      "Vendor name",
    );
  });
});

describe("form errors (§22 — aria-invalid, aria-describedby, focus the first invalid field)", () => {
  it("moves focus to the FIRST invalid field on submit", async () => {
    const user = userEvent.setup();
    render(<TwoRequiredFields />);

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByLabelText(/Vendor name/)).toHaveAttribute("aria-invalid", "true");
    });
    // The whole of §22's third clause. Without it a screen-reader user presses Save, hears
    // nothing move, and has to walk the form to find out which of nine fields refused.
    expect(document.activeElement).toBe(screen.getByLabelText(/Vendor name/));
  });

  it("names the error message from the field rather than merely placing it nearby", async () => {
    const user = userEvent.setup();
    render(<TwoRequiredFields />);
    await user.click(screen.getByRole("button", { name: "Save" }));

    const field = await screen.findByLabelText(/Vendor name/);
    await waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"));

    const described = (field.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    const text = described
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
    expect(text).toContain("Vendor name is required");
  });
});
