import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";

import { FieldLabel } from "@/components/shared/field-help";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

// field-help.test.tsx — the "?" beside every inventory field label. The interesting properties are
// all about who can reach it: a plain hover tooltip silently excludes keyboard and touch users,
// and a bare <button> inside a <form> submits it.

function Harness() {
  const form = useForm({ defaultValues: { parLevel: "" } });
  return (
    <Form {...form}>
      <form onSubmit={() => undefined}>
        <FormField
          control={form.control}
          name="parLevel"
          render={({ field }) => (
            <FormItem>
              <FieldLabel help="How much you want on the shelf when fully stocked.">
                Par level
              </FieldLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}

describe("FieldLabel / FieldHelp", () => {
  it("theHelpTriggerNamesItsOwnField", () => {
    render(<Harness />);

    // "What is 'Par level'?" and not a bare "Help": a screen-reader user tabbing a form of fifteen
    // identical "Help" buttons learns nothing from any of them.
    expect(screen.getByRole("button", { name: 'What is "Par level"?' })).toBeInTheDocument();
  });

  it("theExplanationOpensOnClickSoTouchAndKeyboardUsersCanReachIt", async () => {
    render(<Harness />);
    const user = userEvent.setup();

    expect(screen.queryByText(/How much you want on the shelf/)).toBeNull();
    await user.click(screen.getByRole("button", { name: 'What is "Par level"?' }));
    expect(await screen.findByText(/How much you want on the shelf/)).toBeInTheDocument();
  });

  it("openingHelpDoesNotStealFocusFromTheField", async () => {
    render(<Harness />);
    const user = userEvent.setup();

    const input = screen.getByRole("textbox");
    input.focus();
    await user.hover(screen.getByRole("button", { name: 'What is "Par level"?' }));

    await screen.findByText(/How much you want on the shelf/);
    // A glance, not a destination — yanking focus out of a half-typed field to show a hint costs
    // more than the hint is worth.
    expect(document.activeElement).toBe(input);
  });

  it("theTriggerIsNotASubmitButton", () => {
    render(<Harness />);

    // An unqualified <button> inside a <form> submits it, so reading a hint would post the form.
    expect(screen.getByRole("button", { name: 'What is "Par level"?' })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("aLabelWithNoHelpRendersNoAffordanceAtAll", () => {
    function Bare() {
      const form = useForm({ defaultValues: { name: "" } });
      return (
        <Form {...form}>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FieldLabel>Name</FieldLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
              </FormItem>
            )}
          />
        </Form>
      );
    }
    render(<Bare />);

    // A "?" that only restates its label is noise, and enough noise makes help invisible on the
    // fields that genuinely need it.
    expect(screen.queryByRole("button")).toBeNull();
  });
});
