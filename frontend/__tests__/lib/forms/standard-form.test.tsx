import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { z } from "zod";

import { useStandardForm } from "@/lib/forms";
import {
  Form,
  FormControl,
  FormField,
  FormHint,
  FormItem,
  FormLabel,
  FormMessage,
  FormSubmitButton,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/**
 * Live validation, proven by driving the UI (D-35-02).
 *
 * <h2>Why these tests type into inputs instead of inspecting configuration</h2>
 *
 * Asserting `mode === "onTouched"` would prove that a string was passed to `useForm`, which is not
 * the claim. The claim is that a user who leaves a field is told about it before pressing Save,
 * and that the message goes away on the keystroke that fixes it. Only driving the control can say
 * whether that happens — and a form-validation phase verified by reading its own configuration is
 * exactly the kind of proof this phase exists to stop accepting.
 */

const schema = z.object({
  employeeNo: z
    .string()
    .min(3, "Employee number must be 3–12 characters")
    .max(12, "Employee number must be 3–12 characters"),
  department: z.string().min(1, "Choose a department"),
});

type Values = z.infer<typeof schema>;

const DEPARTMENTS = [
  { value: "kitchen", label: "Kitchen" },
  { value: "front", label: "Front of House" },
];

function TestForm() {
  const form = useStandardForm<Values>({
    schema,
    defaultValues: { employeeNo: "", department: "" },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(() => {})}>
        <FormField
          control={form.control}
          name="employeeNo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Employee number</FormLabel>
              <FormHint>3–12 characters</FormHint>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="department"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Department</FormLabel>
              <FormControl>
                <Select
                  options={DEPARTMENTS}
                  placeholder="Choose a department"
                  value={field.value}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormSubmitButton submitState={form.submitState}>Save</FormSubmitButton>
      </form>
    </Form>
  );
}

describe("the form standard", () => {
  it("greets a blank form with no errors — the rule is a hint, not a reprimand", () => {
    render(<TestForm />);

    // The constraint is on screen before the user has done anything wrong.
    expect(screen.getByText("3–12 characters")).toBeInTheDocument();
    expect(screen.queryByText("Employee number must be 3–12 characters")).not.toBeInTheDocument();
  });

  it("reports a field's error after the user leaves it, with no submit", async () => {
    const user = userEvent.setup();
    render(<TestForm />);

    const input = screen.getByLabelText("Employee number");
    await user.click(input);
    await user.type(input, "AB");
    await user.tab();

    expect(await screen.findByText("Employee number must be 3–12 characters")).toBeInTheDocument();
  });

  it("clears the error on the keystroke that makes the field valid, not at the next submit", async () => {
    const user = userEvent.setup();
    render(<TestForm />);

    const input = screen.getByLabelText("Employee number");
    await user.click(input);
    await user.type(input, "AB");
    await user.tab();
    expect(await screen.findByText("Employee number must be 3–12 characters")).toBeInTheDocument();

    // One more character makes it valid. The message must go now — not on submit.
    await user.click(input);
    await user.type(input, "C");

    expect(screen.queryByText("Employee number must be 3–12 characters")).not.toBeInTheDocument();
  });

  it("marks the control aria-invalid so the error styling is identical across control types", async () => {
    const user = userEvent.setup();
    render(<TestForm />);

    const input = screen.getByLabelText("Employee number");
    await user.click(input);
    await user.type(input, "A");
    await user.tab();

    await screen.findByText("Employee number must be 3–12 characters");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("disables submit while the form is invalid AND says why in associated text", async () => {
    const user = userEvent.setup();
    render(<TestForm />);

    const input = screen.getByLabelText("Employee number");
    await user.click(input);
    await user.type(input, "A");
    await user.tab();
    await screen.findByText("Employee number must be 3–12 characters");

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();

    // The reason must be real text bound to the button, not a title attribute nobody receives.
    const describedBy = button.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toMatch(/employee no/i);
  });

  it("renders a placeholder that is not a selectable value, so 'not chosen' is distinguishable", () => {
    render(<TestForm />);

    const select = screen.getByLabelText("Department") as HTMLSelectElement;
    const placeholder = Array.from(select.options).find((o) => o.value === "");

    expect(placeholder).toBeDefined();
    expect(placeholder!.disabled).toBe(true);
    expect(select.value).toBe("");
  });

  it("takes its options from the caller — a shared select cannot smuggle in a hardcoded list", () => {
    render(<TestForm />);

    const select = screen.getByLabelText("Department") as HTMLSelectElement;
    const values = Array.from(select.options)
      .map((o) => o.value)
      .filter(Boolean);

    expect(values).toEqual(["kitchen", "front"]);
  });
});

describe("Select option-list states", () => {
  it("renders a failed options load as an error with retry, never as an empty dropdown", async () => {
    const user = userEvent.setup();
    let retried = false;

    render(
      <Select
        options={[]}
        error
        onRetry={() => {
          retried = true;
        }}
      />,
    );

    // An empty dropdown says "there are none", which is a different and far more damaging
    // statement than "this did not load".
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("Could not load the options.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(retried).toBe(true);
  });

  it("shows a loading state rather than an empty list while options are in flight", () => {
    render(<Select options={[]} isLoading placeholder="Choose a department" />);

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select).toBeDisabled();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });
});
