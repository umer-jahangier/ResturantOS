import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { ApiError } from "@/lib/api-client/errors";
import { FinanceRepository } from "@/lib/repositories/finance.repository";

const BRANCH_ID = "b0000001-0000-4000-8000-000000000001";
const EXISTING_ACCOUNT_ID = "e2000001-0000-4000-8000-000000000001";

describe("FinanceRepository AR journey (FIN-05 AR half, 10-18, MSW round-trip)", () => {
  it("creates a house account that starts at balance zero", async () => {
    const created = await FinanceRepository.createCustomerAccount({
      branchId: BRANCH_ID,
      accountCode: "HA-TEST-1",
      name: "Test Corp",
      creditLimitPaisa: 5_000_000,
      paymentTermsDays: 30,
    });

    expect(created.balancePaisa).toBe(0);
    expect(created.status).toBe("ACTIVE");
  });

  it("charging a house account increases its balance", async () => {
    const before = await FinanceRepository.listCustomerAccounts();
    const account = before.data.find((a) => a.id === EXISTING_ACCOUNT_ID);
    expect(account).toBeDefined();
    const startingBalance = account!.balancePaisa;

    const charged = await FinanceRepository.createArCharge({
      branchId: BRANCH_ID,
      customerAccountId: EXISTING_ACCOUNT_ID,
      txnDate: "2026-07-13",
      amountPaisa: 40_000,
    });

    expect(charged.txnType).toBe("CHARGE");
    expect(charged.balanceAfterPaisa).toBe(startingBalance + 40_000);
  });

  it("charging past the credit limit surfaces an ApiError with code CREDIT_LIMIT_EXCEEDED (not a bare throw)", async () => {
    server.use(
      http.post("*/api/v1/finance/ar/charges", () =>
        HttpResponse.json(
          {
            code: "CREDIT_LIMIT_EXCEEDED",
            message:
              "Charge of 7000000 paisa would exceed credit limit 10000000 paisa (current balance 4000000 paisa) for account " +
              EXISTING_ACCOUNT_ID,
            timestamp: new Date().toISOString(),
          },
          { status: 422 },
        ),
      ),
    );

    const err = await FinanceRepository.createArCharge({
      branchId: BRANCH_ID,
      customerAccountId: EXISTING_ACCOUNT_ID,
      txnDate: "2026-07-13",
      amountPaisa: 70_000,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("CREDIT_LIMIT_EXCEEDED");
    expect((err as ApiError).status).toBe(422);
    // The credit limit and current balance must be present in the message the UI shows —
    // a bare throw with no numbers would let the UI render a generic error (10-06-A).
    expect((err as ApiError).message).toContain("10000000");
    expect((err as ApiError).message).toContain("4000000");
  });

  it("settling reduces the balance", async () => {
    const charged = await FinanceRepository.createArCharge({
      branchId: BRANCH_ID,
      customerAccountId: EXISTING_ACCOUNT_ID,
      txnDate: "2026-07-13",
      amountPaisa: 10_000,
    });
    const balanceAfterCharge = charged.balanceAfterPaisa;

    const settled = await FinanceRepository.createArSettlement({
      branchId: BRANCH_ID,
      customerAccountId: EXISTING_ACCOUNT_ID,
      txnDate: "2026-07-13",
      amountPaisa: 10_000,
    });

    expect(settled.txnType).toBe("SETTLEMENT");
    expect(settled.balanceAfterPaisa).toBe(balanceAfterCharge - 10_000);
  });

  it("settling more than the outstanding balance is rejected", async () => {
    const err = await FinanceRepository.createArSettlement({
      branchId: BRANCH_ID,
      customerAccountId: EXISTING_ACCOUNT_ID,
      txnDate: "2026-07-13",
      amountPaisa: 999_999_999,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("AR_SETTLEMENT_EXCEEDS_BALANCE");
  });

  it("getArAging parses and adapts four buckets", async () => {
    const aging = await FinanceRepository.getArAging(BRANCH_ID);
    expect(aging.buckets).toHaveLength(4);
    expect(aging.buckets.map((b) => b.label)).toEqual([
      "Current",
      "31-60 days",
      "61-90 days",
      "Over 90 days",
    ]);
  });

  it("a zero-receivable response yields empty buckets, not a crash", async () => {
    server.use(
      http.get("*/api/v1/finance/ar/aging", () =>
        HttpResponse.json({
          data: { totalArPaisa: 0, buckets: [] },
          meta: null,
          warnings: [],
        }),
      ),
    );

    const aging = await FinanceRepository.getArAging(BRANCH_ID);
    expect(aging.totalArPaisa).toBe(0);
    expect(aging.buckets).toEqual([]);
  });

  it("getCustomerAccountStatement returns the account, balance and transactions", async () => {
    const statement = await FinanceRepository.getCustomerAccountStatement(EXISTING_ACCOUNT_ID);
    expect(statement.account.id).toBe(EXISTING_ACCOUNT_ID);
    expect(statement.balancePaisa).toBe(statement.account.balancePaisa);
  });
});
