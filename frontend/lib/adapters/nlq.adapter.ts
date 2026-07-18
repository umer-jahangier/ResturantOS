// Layer-2 adapter: raw API shape -> domain model.

import type { z } from "zod";
import type { apiNlqQueryResponseSchema, apiNlqRowSchema } from "@/lib/api-client/schemas/nlq.schema";
import type { NlqResult, NlqRow } from "@/lib/models/nlq.model";

export type ApiNlqRow = z.infer<typeof apiNlqRowSchema>;
export type ApiNlqQueryResponse = z.infer<typeof apiNlqQueryResponseSchema>;

/** Passes the row through as-is — the shape is dynamic per question, already Zod-validated. */
export function adaptNlqRow(raw: ApiNlqRow): NlqRow {
  return raw;
}

export function adaptNlqResult(raw: ApiNlqQueryResponse): NlqResult {
  return {
    question: raw.question,
    sql: raw.sql,
    rows: raw.rows.map(adaptNlqRow),
    columns: raw.columns,
    rowCount: raw.rowCount,
    narrative: raw.narrative,
    cacheHit: raw.cacheHit,
    durationMs: raw.durationMs,
  };
}
