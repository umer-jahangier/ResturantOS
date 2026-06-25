import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";
import type { ZodType } from "zod";

// Minimal react-hook-form resolver backed by a Zod schema. We hand-roll this
// instead of pulling in `@hookform/resolvers` because `frontend/package.json`
// is owned by plan 04-03 (parallel-safety); see SUMMARY for the dependency note.
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
      const key = issue.path[0];
      if (typeof key === "string" && !(key in errors)) {
        (errors as Record<string, { type: string; message: string }>)[key] = {
          type: String(issue.code),
          message: issue.message,
        };
      }
    }

    return { values: {}, errors };
  };
}
