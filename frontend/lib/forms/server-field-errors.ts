import type { FieldValues, Path, UseFormReturn } from "react-hook-form";

import { ApiError } from "@/lib/errors/api-error";
import { formatUserFacingError } from "@/lib/errors/user-facing";

/**
 * Bind a server's field errors to the inputs they name (D-35-03).
 *
 * <h2>The gap this closes</h2>
 *
 * `ApiError` has parsed `fieldErrors` out of the `{error:{details:[{field,issue}]}}` envelope
 * since phase 3, and until now nothing in the codebase read them. Every `onError` collapsed to
 * `toast.error(...)`, so a server that said "employee number EMP-001 is already used" produced a
 * red rectangle in the corner while the offending input still looked fine. The backend half of
 * this contract is 35-01, which made HR refusals carry a field path at all; this is the half that
 * puts the message where the user is looking.
 *
 * <h2>Why an unmatched path is surfaced rather than dropped</h2>
 *
 * If the server names a field this form does not have, the tempting behaviour is to ignore it.
 * That is the worst option: the server took the trouble to produce a specific message, the user
 * sees nothing, and nobody ever learns the contract drifted. It goes to the form-level error
 * instead, naming the path, so a mismatch is visible in the UI the first time it happens.
 *
 * <h2>Debouncing</h2>
 *
 * There is none here and there should not be: this runs once, on a rejected submit. Debouncing
 * belongs only on rules that hit the network as the user types (a uniqueness check), and the
 * codebase already has `use-debounced-value` for that. Do not add a debounce to a synchronous
 * rule — zod rules are cheap, and a delayed string-length message just feels broken.
 */

/** What the binder did, so a caller can assert its own contract in a test. */
export interface AppliedServerErrors {
  /** Form paths that received a field-level error, in the order the server listed them. */
  boundFields: string[];
  /** Server paths that matched no field in this form and went to the form-level error. */
  unmatchedFields: string[];
  /** True when anything at all was bound to a specific field. */
  hasFieldErrors: boolean;
}

/**
 * @param form    the react-hook-form instance, as returned by `useStandardForm` or `useForm`
 * @param error   the thrown value from a mutation; anything that is not an `ApiError` is handled
 *                as a form-level message rather than crashing the form
 * @param fieldMap optional server-field → form-field translation. A form may collect rupees where
 *                the API takes paisa, and binding to the API's name would lose the message.
 */
export function applyServerFieldErrors<TValues extends FieldValues>(
  form: UseFormReturn<TValues>,
  error: unknown,
  fieldMap?: Readonly<Record<string, string>>,
): AppliedServerErrors {
  const result: AppliedServerErrors = {
    boundFields: [],
    unmatchedFields: [],
    hasFieldErrors: false,
  };

  if (!(error instanceof ApiError) || error.fieldErrors.length === 0) {
    // No field path to bind. Keep the existing behaviour exactly: formatUserFacingError owns the
    // code→sentence map and is used by screens outside this phase, so it is the fallback rather
    // than something reimplemented here.
    form.setError("root", { type: "server", message: formatUserFacingError(error) });
    return result;
  }

  const unmatchedMessages: string[] = [];

  for (const fieldError of error.fieldErrors) {
    const target = fieldMap?.[fieldError.field] ?? fieldError.field;

    if (isFieldInForm(form, target)) {
      form.setError(target as Path<TValues>, { type: "server", message: fieldError.issue });
      result.boundFields.push(target);
    } else {
      result.unmatchedFields.push(fieldError.field);
      unmatchedMessages.push(`${fieldError.issue} (${fieldError.field})`);
    }
  }

  if (unmatchedMessages.length > 0) {
    form.setError("root", { type: "server", message: unmatchedMessages.join(" ") });
  }

  result.hasFieldErrors = result.boundFields.length > 0;

  // Take the user to the problem instead of asking them to find it. The first bound field is the
  // server's own ordering, which for a multi-field refusal is the order the API validated in.
  if (result.boundFields.length > 0) {
    form.setFocus(result.boundFields[0] as Path<TValues>);
  }

  return result;
}

/**
 * Whether this form actually has a field at `path`.
 *
 * <p>Read from the form's VALUES rather than from a registry of mounted inputs: a field inside a
 * collapsed section or an unmounted tab is still part of the form and should still receive its
 * error. Walking the default/current values covers dotted and indexed paths (`address.city`,
 * `slabs.0.ratePct`) with the same segment semantics `createZodResolver` already uses.
 */
function isFieldInForm<TValues extends FieldValues>(
  form: UseFormReturn<TValues>,
  path: string,
): boolean {
  const segments = path.split(".");
  let cursor: unknown = form.getValues();

  for (const segment of segments) {
    if (cursor == null || typeof cursor !== "object") {
      return false;
    }
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= cursor.length) {
        return false;
      }
      cursor = cursor[index];
      continue;
    }
    const record = cursor as Record<string, unknown>;
    if (!(segment in record)) {
      return false;
    }
    cursor = record[segment];
  }

  return true;
}
