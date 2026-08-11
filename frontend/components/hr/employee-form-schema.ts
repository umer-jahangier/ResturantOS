import { z } from "zod";

import { EMPLOYMENT_TYPE_VALUES } from "@/lib/models/hr.model";

/**
 * The employee form's rules, stated once, in the language the form collects them in.
 *
 * <h2>Why this is not the Layer-1 input schema</h2>
 *
 * `createEmployeeInputSchema` is the WIRE shape: `basicSalaryPaisa`, an integer count of paisa. A
 * human types rupees. Reusing the wire schema for the form would mean either putting a paisa figure
 * in front of the user or converting inside a component on every keystroke — and
 * `lib/adapters/shared.ts` states the rule that money is never divided by 100 in a component. So
 * the form has its own shape with a `basicSalaryRupees` string, converted at the submit boundary in
 * exactly one place.
 *
 * <h2>Why the messages read the way they do</h2>
 *
 * Each message names the rule and the way out, and it is written to be legible while the field is
 * still empty — because `FormHint` renders the same rule persistently, BEFORE it can be broken.
 * "Employee number is required" tells someone who has not typed anything nothing they did not know.
 */

const CNIC_HINT = "13 digits, with or without dashes";
const EMPLOYEE_NO_HINT = "3–20 characters, e.g. EMP-014";

export const employeeFormSchema = z.object({
  employeeNo: z
    .string()
    .trim()
    .min(3, `Employee number is ${EMPLOYEE_NO_HINT}`)
    .max(20, `Employee number is ${EMPLOYEE_NO_HINT}`),

  fullName: z
    .string()
    .trim()
    .min(2, "Enter the employee's full name")
    .max(120, "A name is at most 120 characters"),

  /**
   * Optional, and validated only when present — an employee record is worth creating before their
   * CNIC has been photocopied. Dashes are accepted because that is how the card prints it; the
   * server stores the digits.
   */
  cnic: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{5}-?\d{7}-?\d$/.test(v), `A CNIC is ${CNIC_HINT}`),

  bankAccountNo: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || /^[A-Za-z0-9-]{6,34}$/.test(v),
      "An account or IBAN is 6–34 letters, digits or dashes",
    ),

  departmentId: z.string(),
  designationId: z.string(),

  // Derived from the Layer-1 enum via Layer 2 — never a second hand-written list (D-35-01).
  employmentType: z.enum(EMPLOYMENT_TYPE_VALUES),

  joinDate: z
    .string()
    .min(1, "Choose the date this employee joined")
    // A join date in the future is almost always a typed year (2027 for 2026) rather than a
    // deliberate future hire, and it silently breaks every attendance and payroll period the
    // employee should appear in. Refused with the reason stated.
    .refine((v) => v <= new Date().toISOString().slice(0, 10), "A join date cannot be in the future"),

  /**
   * A string, not a number, because an empty numeric input yields NaN and "NaN" is not a message
   * anyone can act on. The rule below is what the user reads; the conversion to paisa happens once,
   * at submit.
   */
  basicSalaryRupees: z
    .string()
    .trim()
    .min(1, "Enter the monthly basic salary in rupees")
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "Rupees only, up to two decimal places")
    // A negative salary is not a smaller number, it is an aborted payroll cycle — it annualizes to
    // a negative taxable income, no tax slab matches, and the calculation fails for EVERY employee
    // in the run. The server refuses it too; this says so before the round trip.
    .refine((v) => Number(v) >= 0, "A salary cannot be negative"),

  deviceUserRef: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{1,10}$/.test(v), "A device PIN is up to 10 digits"),
});

export type EmployeeFormValues = z.infer<typeof employeeFormSchema>;

export const EMPLOYEE_FORM_HINTS = {
  employeeNo: EMPLOYEE_NO_HINT,
  cnic: `${CNIC_HINT} — optional`,
  bankAccountNo: "Account number or IBAN — optional",
  deviceUserRef: "The number this employee punches on the biometric terminal — optional",
  basicSalaryRupees: "Monthly basic, in rupees",
} as const;

/**
 * Rupees to paisa, in ONE place.
 *
 * <p>`Math.round(Number(rupees) * 100)` is correct for the two-decimal values the schema admits and
 * wrong-looking for no input it accepts; the schema is what makes that true, which is why the two
 * live in the same file. Doing this inline in a component is how a third rounding rule appears.
 */
export function rupeesToPaisa(rupees: string): number {
  return Math.round(Number(rupees) * 100);
}

export function paisaToRupeesInput(paisa: number): string {
  return (paisa / 100).toFixed(2);
}
