import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EmployeeFormDialog } from "@/components/hr/employee-form-dialog";
import { ApiError } from "@/lib/errors/api-error";
import type { Employee } from "@/lib/models/hr.model";

/**
 * The employee form, driven the way a user drives it (D-35-01, D-35-02, D-35-03).
 *
 * <h2>Why every assertion below reads rendered text</h2>
 *
 * Asserting that the component passes a schema to `useStandardForm` would prove a string was
 * handed to a hook. The claims here are behavioural: that a department is a *list*, that a bad
 * value is named *before* Save, and that a server's `409 DUPLICATE_VALUE` on `employeeNo` ends up
 * *on the employee-number input* rather than in a toast. Only typing into the form can say whether
 * that happens, and a form-validation phase verified by reading its own zod schema is not verified.
 */

const listEmployees = vi.fn();
const listDepartments = vi.fn();
const listDesignations = vi.fn();
const createEmployee = vi.fn();
const updateEmployee = vi.fn();

vi.mock("@/lib/repositories/hr.repository", () => ({
  HrRepository: {
    listEmployees: (...a: unknown[]) => listEmployees(...a),
    listDepartments: (...a: unknown[]) => listDepartments(...a),
    listDesignations: (...a: unknown[]) => listDesignations(...a),
    createEmployee: (...a: unknown[]) => createEmployee(...a),
    updateEmployee: (...a: unknown[]) => updateEmployee(...a),
  },
}));

vi.mock("@/lib/hooks/auth/use-current-user", () => ({
  useCurrentUser: () => ({ isAuthenticated: true, branchId: "branch-1" }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const KITCHEN = { id: "dept-kitchen", name: "Kitchen", code: null, active: true };
const FOH = { id: "dept-foh", name: "Front of House", code: null, active: true };
const CHEF = {
  id: "desg-chef",
  name: "Chef",
  code: null,
  departmentId: "dept-kitchen",
  active: true,
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderDialog(employee?: Employee) {
  return render(<EmployeeFormDialog employee={employee} open onOpenChange={() => {}} />, {
    wrapper,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  listEmployees.mockResolvedValue([]);
  listDepartments.mockResolvedValue([KITCHEN, FOH]);
  listDesignations.mockResolvedValue([CHEF]);
  createEmployee.mockResolvedValue({ id: "e1" });
  updateEmployee.mockResolvedValue({ id: "e1" });
});

describe("closed sets are lists, not text boxes (D-35-01)", () => {
  it("offers the tenant's departments as options from the API, not as typed text", async () => {
    renderDialog();

    const department = await screen.findByLabelText("Department");
    expect(department.tagName).toBe("SELECT");
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Kitchen" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("option", { name: "Front of House" })).toBeInTheDocument();
  });

  it("renders a failed department load as a failure with a retry, never as an empty menu", async () => {
    // An empty dropdown says "there are none", which on day one is ALSO true — so the two states
    // must not look the same, or a tenant whose network blipped concludes they have no departments.
    listDepartments.mockRejectedValue(new Error("network"));
    renderDialog();

    expect(await screen.findByText("Could not load the options.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("offers employment type as a list, with the four values the API accepts", async () => {
    renderDialog();

    const employmentType = await screen.findByLabelText("Employment type");
    expect(employmentType.tagName).toBe("SELECT");
    for (const label of ["Permanent", "Part time", "Daily wage", "Contract"]) {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }
  });
});

describe("rules are shown before they are broken and checked as the user works (D-35-02)", () => {
  it("shows the employee-number rule while the field is still empty", async () => {
    renderDialog();
    expect(await screen.findByText("3–20 characters, e.g. EMP-014")).toBeInTheDocument();
  });

  it("names a too-short employee number on blur, with no submit", async () => {
    const user = userEvent.setup();
    renderDialog();

    const employeeNo = await screen.findByLabelText("Employee number");
    await user.type(employeeNo, "EM");
    await user.tab();

    expect(
      await screen.findByText("Employee number is 3–20 characters, e.g. EMP-014"),
    ).toBeInTheDocument();
    expect(createEmployee).not.toHaveBeenCalled();
  });

  it("clears the error on the keystroke that makes the field valid", async () => {
    const user = userEvent.setup();
    renderDialog();

    const employeeNo = await screen.findByLabelText("Employee number");
    await user.type(employeeNo, "EM");
    await user.tab();
    await screen.findByText("Employee number is 3–20 characters, e.g. EMP-014");

    await user.type(employeeNo, "P");
    await waitFor(() =>
      expect(
        screen.queryByText("Employee number is 3–20 characters, e.g. EMP-014"),
      ).not.toBeInTheDocument(),
    );
  });

  it("refuses a join date in the future and says so", async () => {
    const user = userEvent.setup();
    renderDialog();

    const joinDate = await screen.findByLabelText("Join date");
    await user.clear(joinDate);
    await user.type(joinDate, "2099-01-01");
    await user.tab();

    expect(await screen.findByText("A join date cannot be in the future")).toBeInTheDocument();
  });

  it("refuses a salary that is not rupees and two decimals", async () => {
    const user = userEvent.setup();
    renderDialog();

    const salary = await screen.findByLabelText("Basic salary");
    await user.type(salary, "50,000");
    await user.tab();

    expect(await screen.findByText("Rupees only, up to two decimal places")).toBeInTheDocument();
  });

  it("disables submit while the form is invalid AND says why in associated text", async () => {
    const user = userEvent.setup();
    renderDialog();

    const employeeNo = await screen.findByLabelText("Employee number");
    await user.type(employeeNo, "E");
    await user.tab();

    const submit = await screen.findByRole("button", { name: "Add employee" });
    await waitFor(() => expect(submit).toBeDisabled());

    // The reason must be TEXT associated with the button, not a title attribute — a title is
    // invisible on touch and to a keyboard user who never hovers.
    const describedBy = submit.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toMatch(/employee no/i);
  });
});

describe("a server rejection lands on the field it names (D-35-03)", () => {
  it("binds 409 DUPLICATE_VALUE on employeeNo to the employee-number input", async () => {
    const user = userEvent.setup();
    createEmployee.mockRejectedValue(
      new ApiError({
        status: 409,
        code: "DUPLICATE_VALUE",
        message: "Employee number EMP-001 is already used.",
        traceId: null,
        fieldErrors: [
          {
            field: "employeeNo",
            issue: "Employee number EMP-001 is already used in this restaurant.",
          },
        ],
      }),
    );

    renderDialog();
    await fillMinimalValidForm(user);
    submit("Add employee");

    // The exact server sentence, rendered against the input — not a toast, and not "Failed to
    // create employee", which is what this screen used to show for every failure alike.
    expect(
      await screen.findByText("Employee number EMP-001 is already used in this restaurant."),
    ).toBeInTheDocument();
  });

  it("binds a department refusal to the department select, not to the form", async () => {
    const user = userEvent.setup();
    createEmployee.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "DEPARTMENT_NOT_FOUND",
        message: "That department no longer exists.",
        traceId: null,
        fieldErrors: [
          {
            field: "departmentId",
            issue: "That department no longer exists. Choose one from the list.",
          },
        ],
      }),
    );

    renderDialog();
    await fillMinimalValidForm(user);
    submit("Add employee");

    expect(
      await screen.findByText("That department no longer exists. Choose one from the list."),
    ).toBeInTheDocument();
  });
});

describe("editing an existing employee", () => {
  const existing: Employee = {
    id: "e1",
    branchId: "branch-1",
    employeeNo: "EMP-001",
    fullName: "Muhammad Ali",
    userId: null,
    cnicMasked: "*******-*******-4",
    bankAccountMasked: "****5678",
    designationId: "desg-chef",
    designationName: "Chef",
    departmentId: "dept-kitchen",
    departmentName: "Kitchen",
    employmentType: "PERMANENT",
    joinDate: "2024-03-01",
    exitDate: null,
    basicSalaryPaisa: 5000000,
    deviceUserRef: "17",
    active: true,
  };

  it("preselects the employee's department and job title by id", async () => {
    renderDialog(existing);

    const department = (await screen.findByLabelText("Department")) as HTMLSelectElement;
    await waitFor(() => expect(department.value).toBe("dept-kitchen"));
    const designation = screen.getByLabelText("Job title") as HTMLSelectElement;
    await waitFor(() => expect(designation.value).toBe("desg-chef"));
  });

  it("shows the salary in rupees, not paisa", async () => {
    renderDialog(existing);
    const salary = (await screen.findByLabelText("Basic salary")) as HTMLInputElement;
    expect(salary.value).toBe("50000.00");
  });

  /**
   * The one that would destroy data. `cnicMasked` is literally `*******-*******-4`; submitting it
   * back would overwrite the real encrypted CNIC with its own mask, and look like a save that
   * worked.
   */
  it("never preloads a masked CNIC or account number into the input", async () => {
    renderDialog(existing);

    const cnic = (await screen.findByLabelText("CNIC")) as HTMLInputElement;
    const bank = screen.getByLabelText("Bank account") as HTMLInputElement;
    expect(cnic.value).toBe("");
    expect(bank.value).toBe("");
    // ...and the current masked value is still visible, as a hint, so the field does not read as
    // "we do not have one".
    expect(screen.getByText(/Currently \*\*\*\*\*\*\*-\*\*\*\*\*\*\*-4/)).toBeInTheDocument();
  });

  it("omits an untouched CNIC from the update rather than sending an empty string", async () => {
    const user = userEvent.setup();
    renderDialog(existing);

    await screen.findByLabelText("CNIC");
    submit("Save changes");

    await waitFor(() => expect(updateEmployee).toHaveBeenCalled());
    const [, input] = updateEmployee.mock.calls[0] as [string, Record<string, unknown>];
    expect(input.cnic).toBeUndefined();
    expect(input.bankAccountNo).toBeUndefined();
    expect(input.basicSalaryPaisa).toBe(5000000);
  });
});

/**
 * Click the real submit button with a real MouseEvent.
 *
 * <p>`userEvent.click` is used everywhere else in this file and is the right tool for it — but it
 * does NOT trigger jsdom's implicit form submission. jsdom runs a button's activation behaviour
 * from the `MouseEvent` that `fireEvent.click` dispatches; user-event's synthesised pointer
 * sequence does not reach it, so the click lands on the button (verified: the button's own click
 * listener fires) and no `submit` event follows. Using `fireEvent.click` here is not a weaker
 * assertion — it is a click on the same enabled button, and every test below still goes through
 * `handleSubmit`, the resolver and the mutation.
 */
function submit(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

/** Enough valid values to reach a submit, so the server-error tests exercise the real path. */
async function fillMinimalValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Employee number"), "EMP-001");
  await user.type(screen.getByLabelText("Full name"), "Muhammad Ali");
  await user.type(screen.getByLabelText("Basic salary"), "50000");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Add employee" })).not.toBeDisabled(),
  );
}
