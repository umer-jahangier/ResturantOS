import { z } from "zod";

/**
 * Mirrors `NlqQueryRequest` (services/nlq-service .../dto/NlqQueryRequest.java) EXACTLY: the
 * ENTIRE request body is a single `question` string. No `tenantId`, no `branchId`, no `role`, no
 * `sql` field — every scoping value is derived server-side from the validated JWT (10-10-B's
 * "impossible-by-construction tenant isolation"). A client-supplied `sql` field would hand an
 * attacker a way around Claude + the validator entirely; neither this schema nor the repository
 * that uses it may ever grow one.
 */
export const apiNlqQueryRequestSchema = z.object({
  question: z.string().min(1).max(2000),
});

/**
 * A single result row. `NlqQueryResponse.rows` is `List<Map<String,Object>>` on the Java side —
 * genuinely dynamic column names per question — but every cell value that can come back from the
 * `nlq_readonly` ClickHouse profile is a primitive: string, number, or null (money is a paisa
 * integer; dates/text are strings). Modeled as a typed union record (not `z.record(z.unknown())`)
 * so the domain model's row type stays free of `unknown`/`any`.
 */
export const apiNlqRowSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

/**
 * Mirrors `NlqQueryResponse` (services/nlq-service .../dto/NlqQueryResponse.java) EXACTLY.
 * `narrative` is nullable — a Claude-Haiku narration failure never fails the request (12-07
 * returns rows with narrative: null rather than a 5xx). `sql` is the EXECUTED, post-validation,
 * tenant/branch-scoped SQL — safe to render, and deliberately returned so the answer is auditable.
 */
export const apiNlqQueryResponseSchema = z.object({
  question: z.string(),
  sql: z.string(),
  rows: z.array(apiNlqRowSchema),
  columns: z.array(z.string()),
  rowCount: z.number().int(),
  narrative: z.string().nullable(),
  cacheHit: z.boolean(),
  durationMs: z.number(),
});
