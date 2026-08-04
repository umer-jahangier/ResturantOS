import { describe, expect, it } from "vitest";

import { NlqRepository } from "@/lib/repositories/nlq.repository";
import { ApiError } from "@/lib/api-client/errors";

/**
 * 12-09 NLQ frontend journey — repository → Zod parse → adapter → model, MSW-backed. The rejection
 * path matters as much as the happy path (NLQ refuses queries by design), so every assertion here
 * checks that a refusal surfaces as a typed {@link ApiError} carrying the backend's RejectionCode —
 * never a thrown parse error or an opaque crash. Fixtures live in `frontend/mocks/nlq.ts`.
 */
describe("NlqRepository journey (12-09, MSW round-trip)", () => {
  it("runQuery_happyPath: returns rows, the executed SQL, columns and a narrative", async () => {
    const result = await NlqRepository.runQuery("what were my top selling items last week");

    expect(result.rows.length).toBeGreaterThan(0);
    // The executed, tenant/branch-scoped SQL is surfaced (deliberately shown to the user).
    expect(result.sql).toContain("tenant_id");
    expect(result.columns.length).toBeGreaterThan(0);
    expect(result.rowCount).toBe(result.rows.length);
  });

  it("runQuery_nullNarrative: a null narrative is a valid result, not a failure", async () => {
    const result = await NlqRepository.runQuery("__null_narrative revenue last week");
    expect(result.narrative).toBeNull();
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("runQuery_missingTenantFilter: rejected as TENANT_FILTER_MISSING, not a crash", async () => {
    await expect(
      NlqRepository.runQuery("__reject_tenant_filter show all revenue"),
    ).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.code === "TENANT_FILTER_MISSING");
  });

  it("runQuery_piiColumn: rejected as PII_COLUMN_DENIED", async () => {
    await expect(
      NlqRepository.runQuery("__reject_pii list customer phone numbers"),
    ).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.code === "PII_COLUMN_DENIED");
  });

  it("runQuery_writeAttempt: a non-read query is rejected as SHAPE_INVALID", async () => {
    await expect(
      NlqRepository.runQuery("__reject_shape delete all orders"),
    ).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.code === "SHAPE_INVALID");
  });

  it("runQuery_overQuota: surfaces the 429 quota rejection as a typed code", async () => {
    await expect(
      NlqRepository.runQuery("__reject_quota one more question"),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.code === "QUOTA_EXCEEDED_HOURLY",
    );
  });
});
