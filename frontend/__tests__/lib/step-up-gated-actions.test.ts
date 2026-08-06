import { afterEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { ApiError } from "@/lib/errors";
import { FinanceRepository } from "@/lib/repositories/finance.repository";
import { HrRepository } from "@/lib/repositories/hr.repository";
import { clearSession, seedSession } from "@/__tests__/utils/auth-fixtures";

// The two step-up-gated writes in the product: accounting-period close and payroll approval.
// Both are gated server-side on the access token's `totp_verified` claim, which the gateway
// turns into the `X-TOTP-Verified` header after deleting any inbound copy.

const PERIOD_ID = "22222222-2222-2222-8222-222222222222";
const RUN_ID = "33333333-3333-3333-8333-333333333333";

const CLOSE_URL = `*/api/v1/finance/periods/${PERIOD_ID}/close`;
const APPROVE_URL = `*/api/v1/hr/payroll-runs/${RUN_ID}/approve`;

/** finance-service's flat error envelope. */
function financeError(code: string, message: string, status: number) {
  return HttpResponse.json({ code, message, timestamp: "2026-08-06T00:00:00Z" }, { status });
}

/** hr-service's shared `{error:{...}}` envelope. */
function hrError(code: string, message: string, status: number) {
  return HttpResponse.json({ error: { code, message, details: [], traceId: "t" } }, { status });
}

afterEach(() => clearSession());

describe("the client never asserts its own step-up", () => {
  // The gateway deletes any inbound X-TOTP-Verified before authentication runs, so a client-set
  // header is not merely useless — sending one describes a trust model that no longer exists and
  // invites the next reader to believe the gate is client-side.
  it.each([
    [
      "period close",
      CLOSE_URL,
      () => FinanceRepository.closePeriod(PERIOD_ID),
      () => HttpResponse.json({ data: periodPayload() }),
    ],
    [
      "payroll approval",
      APPROVE_URL,
      () => HrRepository.approveRun(RUN_ID),
      () => HttpResponse.json({ data: runPayload() }),
    ],
  ])("sends no X-TOTP-Verified header on %s", async (_label, url, call, ok) => {
    seedSession();
    let sentHeader: string | null = "unset";
    server.use(
      http.post(url, ({ request }) => {
        sentHeader = request.headers.get("X-TOTP-Verified");
        return ok();
      }),
    );

    await call();

    expect(sentHeader).toBeNull();
  });
});

describe("TOTP_REQUIRED is recognisable to the caller", () => {
  it("surfaces finance's flat 403 envelope as an ApiError the UI can branch on", async () => {
    seedSession();
    server.use(
      http.post(CLOSE_URL, () =>
        financeError("TOTP_REQUIRED", "TOTP step-up verification is required", 403),
      ),
    );

    const error = await FinanceRepository.closePeriod(PERIOD_ID).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isTotpRequired()).toBe(true);
  });

  it("surfaces hr's `{error:{code}}` 403 envelope the same way", async () => {
    seedSession();
    server.use(
      http.post(APPROVE_URL, () =>
        hrError("TOTP_REQUIRED", "TOTP step-up verification is required", 403),
      ),
    );

    const error = await HrRepository.approveRun(RUN_ID).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isTotpRequired()).toBe(true);
  });

  // 403 rather than 401 is load-bearing on the client, not just a taste call: the api-client
  // refreshes once on any 401 and replays the request. `totp_verified` is deliberately not carried
  // across refresh, so on a 401 that replay would fail identically — a wasted round trip whose
  // second response is the one the UI ends up reporting.
  it("does not make the caller pay for a refresh that cannot help", async () => {
    seedSession();
    let refreshes = 0;
    server.use(
      http.post("*/api/v1/auth/refresh", () => {
        refreshes += 1;
        return HttpResponse.json({ data: { accessToken: "x", expiresIn: 3600 } });
      }),
      http.post(APPROVE_URL, () =>
        hrError("TOTP_REQUIRED", "TOTP step-up verification is required", 403),
      ),
    );

    await HrRepository.approveRun(RUN_ID).catch(() => undefined);

    expect(refreshes).toBe(0);
  });
});

function periodPayload() {
  return {
    id: PERIOD_ID,
    fiscalYear: 2026,
    periodNo: 1,
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    status: "LOCKED",
    lockedBy: "55555555-5555-5555-8555-555555555555",
    lockedAt: "2026-08-01T00:00:00Z",
  };
}

function runPayload() {
  return {
    id: RUN_ID,
    branchId: "44444444-4444-4444-8444-444444444444",
    periodMonth: 7,
    periodYear: 2026,
    status: "APPROVED",
    totalGrossPaisa: 100000,
    totalNetPaisa: 90000,
    totalTaxPaisa: 5000,
    totalEobiPaisa: 2000,
    totalAdvancesPaisa: 3000,
    totalLateArrivalPaisa: 0,
  };
}
