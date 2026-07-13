import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { ApiError } from "@/lib/api-client/errors";
import { FinanceRepository } from "@/lib/repositories/finance.repository";

const BRANCH_ID = "b0000001-0000-4000-8000-000000000001";

describe("FinanceRepository expense journey (FIN-05, 10-14 gap closure, MSW round-trip)", () => {
  it("creates an expense that starts PENDING_APPROVAL", async () => {
    const created = await FinanceRepository.createExpense({
      branchId: BRANCH_ID,
      expenseDate: "2026-07-13",
      expenseAccountCode: "6100",
      description: "Test expense",
      amountPaisa: 500_000,
    });

    expect(created.status).toBe("PENDING_APPROVAL");
    expect(created.amountPaisa).toBe(500_000);
    expect(created.approvedBy).toBeNull();
  });

  it("approves an expense within the mock's OPA approval limit -> APPROVED", async () => {
    const created = await FinanceRepository.createExpense({
      branchId: BRANCH_ID,
      expenseDate: "2026-07-13",
      expenseAccountCode: "6100",
      amountPaisa: 250_000,
    });

    const approved = await FinanceRepository.approveExpense(created.id);
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedBy).not.toBeNull();
    expect(approved.approvedAt).not.toBeNull();
  });

  it("approving an over-limit expense surfaces an ApiError with code EXPENSE_APPROVAL_LIMIT_EXCEEDED (not a generic throw)", async () => {
    server.use(
      http.post("*/api/v1/finance/expenses/:id/approve", () =>
        HttpResponse.json(
          {
            error: {
              code: "EXPENSE_APPROVAL_LIMIT_EXCEEDED",
              message: "This expense exceeds your approval limit",
              details: [],
              traceId: "mock-trace-id",
            },
          },
          { status: 403 },
        ),
      ),
    );

    const err = await FinanceRepository.approveExpense(
      "d1000001-0000-4000-8000-000000000001",
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("EXPENSE_APPROVAL_LIMIT_EXCEEDED");
    expect((err as ApiError).status).toBe(403);
  });

  it("rejecting with an empty reason is rejected client-side by the Zod schema before any network call", async () => {
    let requestFired = false;
    server.use(
      http.post("*/api/v1/finance/expenses/:id/reject", () => {
        requestFired = true;
        return HttpResponse.json({ data: null, meta: null, warnings: [] });
      }),
    );

    await expect(
      FinanceRepository.rejectExpense("d1000001-0000-4000-8000-000000000001", "   "),
    ).rejects.toThrow();
    expect(requestFired).toBe(false);
  });

  it("rejects a pending expense with a real, non-empty reason", async () => {
    const created = await FinanceRepository.createExpense({
      branchId: BRANCH_ID,
      expenseDate: "2026-07-13",
      expenseAccountCode: "6100",
      amountPaisa: 100_000,
    });

    const rejected = await FinanceRepository.rejectExpense(created.id, "Not a valid business expense");
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejectReason).toBe("Not a valid business expense");
  });

  it("getApAging parses and adapts all four buckets", async () => {
    const aging = await FinanceRepository.getApAging(BRANCH_ID);
    expect(aging.buckets).toHaveLength(4);
    expect(aging.buckets.map((b) => b.label)).toEqual(["Current", "31-60", "61-90", "Over 90"]);
    expect(aging.totalApPaisa).toBeGreaterThan(0);
  });

  it("a zero-payables response yields empty buckets, not a crash", async () => {
    server.use(
      http.get("*/api/v1/finance/ap/aging", () =>
        HttpResponse.json({
          data: { totalApPaisa: 0, buckets: [] },
          meta: null,
          warnings: [],
        }),
      ),
    );

    const aging = await FinanceRepository.getApAging(BRANCH_ID);
    expect(aging.totalApPaisa).toBe(0);
    expect(aging.buckets).toEqual([]);
  });
});
