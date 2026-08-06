import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";
import type { ZodType } from "zod";

/**
 * Writes one issue's error into `target` at the position `path` describes, building whatever
 * nested objects/arrays are missing along the way. `path` segments are numeric for array indices
 * (e.g. `["lines", 0, "vendorItemId"]`), so the container created for a numeric next-segment is a
 * real array — matching the shape react-hook-form's own `getFieldState("lines.0.vendorItemId", …)`
 * walks via its internal `get()` utility. The first issue recorded for a given leaf wins, mirroring
 * this resolver's pre-existing "first error per field" behaviour.
 */
function setNestedError(
  target: Record<string, unknown>,
  path: (string | number)[],
  error: { type: string; message: string },
): void {
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]!;
    const existing = cursor[key as string];
    if (existing == null || typeof existing !== "object") {
      cursor[key as string] = typeof path[i + 1] === "number" ? [] : {};
    }
    cursor = cursor[key as string] as Record<string, unknown>;
  }
  const lastKey = path[path.length - 1]!;
  if (cursor[lastKey as string] === undefined) {
    cursor[lastKey as string] = error;
  }
}

// Minimal react-hook-form resolver backed by a Zod schema. We hand-roll this
// instead of pulling in `@hookform/resolvers` because `frontend/package.json`
// is owned by plan 04-03 (parallel-safety); see SUMMARY for the dependency note.
//
// 08.2-19: rewritten to walk each issue's FULL path (not just its first segment) so a nested
// field — e.g. a purchase-order line's `lines.{idx}.vendorItemId` — gets its own error entry
// instead of every line-level issue collapsing into one flat, unaddressable `errors.lines` object
// (which no `<FormMessage>` in the app could ever resolve, since react-hook-form's own field-state
// lookup walks the full dotted/indexed path).
export function createZodResolver<TValues extends FieldValues>(
  schema: ZodType<TValues>,
): Resolver<TValues> {
  return (values) => {
    const result = schema.safeParse(values);
    if (result.success) {
      return { values: result.data, errors: {} };
    }

    const errors: FieldErrors<TValues> = {};
    for (const issue of result.error.issues) {
      if (issue.path.length === 0) continue;
      const path = issue.path.filter(
        (segment): segment is string | number =>
          typeof segment === "string" || typeof segment === "number",
      );
      if (path.length === 0) continue;
      setNestedError(errors as Record<string, unknown>, path, {
        type: String(issue.code),
        message: issue.message,
      });
    }

    return { values: {}, errors };
  };
}
