/**
 * The form standard (D-35-04). One import path for the whole kit.
 *
 * A form in this codebase should need exactly these three things and no per-screen invention:
 *
 * ```tsx
 * const form = useStandardForm({ schema, defaultValues });
 * // …
 * onError: (e) => applyServerFieldErrors(form, e)
 * ```
 *
 * plus `<Select>` / `<Combobox>` from `components/ui` for any closed set, and `<FormSubmitButton>`
 * for the submit control. See `Docs/conventions/form-standard.md` for the worked example.
 *
 * The resolver is re-exported so a form with an unusual need (a custom resolver, a schema built at
 * runtime) still has one place to import from rather than reaching past the barrel.
 */
export { createZodResolver } from "./zod-resolver";
export { useStandardForm } from "./standard-form";
export type { StandardForm, StandardFormOptions, SubmitState } from "./standard-form";
export { applyServerFieldErrors } from "./server-field-errors";
export type { AppliedServerErrors } from "./server-field-errors";
