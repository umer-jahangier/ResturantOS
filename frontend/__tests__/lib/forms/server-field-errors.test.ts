import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useForm } from "react-hook-form";

import { ApiError } from "@/lib/errors/api-error";
import { applyServerFieldErrors } from "@/lib/forms/server-field-errors";

/**
 * A field error the server produced must reach the field it names (D-35-03).
 *
 * <h2>What was broken</h2>
 *
 * `ApiError` has parsed `fieldErrors` out of the `{error:{details:[{field,issue}]}}` envelope
 * since phase 3, and NOTHING in the codebase read them. Every `onError` in every dialog collapsed
 * to `toast.error(...)`. So the server could say "employee number EMP-001 is already taken" and
 * the user saw a red rectangle in the corner, with the offending input still looking fine.
 *
 * These tests pin the binder that closes that gap. They drive a real `useForm` instance rather
 * than a mock, because the thing being tested is whether react-hook-form actually resolves the
 * path — a mock would happily record a `setError` at a path no field responds to, which is
 * precisely the failure being guarded against.
 */

type EmployeeForm = {
  employeeNo: string;
  fullName: string;
  salaryRupees: number;
  address: { city: string };
  slabs: { ratePct: number }[];
};

const DEFAULTS: EmployeeForm = {
  employeeNo: "",
  fullName: "",
  salaryRupees: 0,
  address: { city: "" },
  slabs: [{ ratePct: 0 }],
};

function apiError(fieldErrors: { field: string; issue: string }[], code = "VALIDATION_FAILED") {
  return new ApiError({
    code,
    message: "Request validation failed",
    status: 422,
    traceId: "t-1",
    fieldErrors,
  });
}

/**
 * `formState` is a Proxy that only re-renders for the slices a component actually READ during
 * render. A hook that never touches `formState.errors` is therefore never re-rendered by
 * `setError`, and `result.current` stays stale — the test would fail while the code is correct.
 * Reading `errors` here is the subscription, and it is what makes these assertions meaningful.
 */
function setup() {
  return renderHook(() => {
    const form = useForm<EmployeeForm>({ defaultValues: DEFAULTS });
    void form.formState.errors;
    return form;
  });
}

describe("applyServerFieldErrors", () => {
  it("sets one error per fieldErrors entry, at the path the server named", () => {
    const { result } = setup();

    act(() => {
      applyServerFieldErrors(
        result.current,
        apiError([
          { field: "employeeNo", issue: "Employee number EMP-001 is already used." },
          { field: "fullName", issue: "Enter the employee's full name." },
        ]),
      );
    });

    expect(result.current.formState.errors.employeeNo?.message).toBe(
      "Employee number EMP-001 is already used.",
    );
    expect(result.current.formState.errors.fullName?.message).toBe(
      "Enter the employee's full name.",
    );
  });

  it("resolves dotted and indexed paths, not only flat ones", () => {
    const { result } = setup();

    act(() => {
      applyServerFieldErrors(
        result.current,
        apiError([
          { field: "address.city", issue: "Choose a city." },
          { field: "slabs.0.ratePct", issue: "Rate cannot exceed 100." },
        ]),
      );
    });

    expect(result.current.formState.errors.address?.city?.message).toBe("Choose a city.");
    expect(result.current.formState.errors.slabs?.[0]?.ratePct?.message).toBe(
      "Rate cannot exceed 100.",
    );
  });

  it("translates a server path through the supplied map", () => {
    const { result } = setup();

    // The API takes paisa; the form collects rupees. Binding to `basicSalaryPaisa` would put the
    // message on a field that does not exist and the user would never see it.
    act(() => {
      applyServerFieldErrors(
        result.current,
        apiError([{ field: "basicSalaryPaisa", issue: "Salary cannot be negative." }]),
        { basicSalaryPaisa: "salaryRupees" },
      );
    });

    expect(result.current.formState.errors.salaryRupees?.message).toBe(
      "Salary cannot be negative.",
    );
  });

  it("surfaces an unmatched server path as a form-level error instead of dropping it", () => {
    const { result } = setup();

    act(() => {
      applyServerFieldErrors(
        result.current,
        apiError([{ field: "somethingTheFormDoesNotHave", issue: "This is wrong." }]),
      );
    });

    // The message the server took the trouble to produce must not vanish. A silently dropped
    // field error is worse than none, because nobody ever learns it existed.
    expect(result.current.formState.errors.root?.message).toContain("This is wrong.");
    expect(result.current.formState.errors.root?.message).toContain("somethingTheFormDoesNotHave");
  });

  it("falls back to the existing user-facing message when there is no field path at all", () => {
    const { result } = setup();

    act(() => {
      applyServerFieldErrors(
        result.current,
        new ApiError({
          code: "PAYROLL_RUN_NOT_CALCULATED",
          message: "This run is draft and cannot be approved. Calculate it first.",
          status: 409,
          traceId: "t-2",
          fieldErrors: [],
        }),
      );
    });

    expect(result.current.formState.errors.root?.message).toBeTruthy();
    expect(Object.keys(result.current.formState.errors)).toEqual(["root"]);
  });

  it("focuses the first offending field so the user is taken to the problem", () => {
    const { result } = setup();
    const setFocus = vi.spyOn(result.current, "setFocus");

    act(() => {
      applyServerFieldErrors(
        result.current,
        apiError([
          { field: "fullName", issue: "Enter a name." },
          { field: "employeeNo", issue: "Already used." },
        ]),
      );
    });

    expect(setFocus).toHaveBeenCalledWith("fullName");
  });

  it("returns the list of paths it bound, so a caller can assert its own contract", () => {
    const { result } = setup();
    let bound: string[] = [];

    act(() => {
      bound = applyServerFieldErrors(
        result.current,
        apiError([{ field: "employeeNo", issue: "Already used." }]),
      ).boundFields;
    });

    expect(bound).toEqual(["employeeNo"]);
  });

  it("ignores a thrown value that is not an ApiError rather than crashing the form", () => {
    const { result } = setup();

    act(() => {
      applyServerFieldErrors(result.current, new Error("network down"));
    });

    expect(result.current.formState.errors.root?.message).toBeTruthy();
  });
});
