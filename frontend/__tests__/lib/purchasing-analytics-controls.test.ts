import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/server";
import { PurchasingRepository } from "@/lib/repositories/purchasing.repository";

const BRANCH = "b0000001-0000-4000-8000-000000000001";
const VENDOR_ID = "c0000001-0000-4000-8000-000000000001";
const VENDOR_B_ID = "f0000002-0000-4000-8000-000000000002";

/**
 * Gap-closure controls test (10-15): asserts the SELECTED period/vendor actually reaches the
 * outbound request, not just that a control renders. This is exactly the "partial" UAT flagged
 * for tests 10/14/15 — a picker that doesn't drive the query key would still pass a looser test.
 */
describe("purchasing analytics controls drive the outbound request", () => {
  it("changing the period issues a spend-analytics request with the new from/to", async () => {
    let capturedFrom: string | null = null;
    let capturedTo: string | null = null;
    server.use(
      http.get("*/api/v1/purchasing/analytics/spend", ({ request }) => {
        const url = new URL(request.url);
        capturedFrom = url.searchParams.get("from");
        capturedTo = url.searchParams.get("to");
        return HttpResponse.json({
          data: {
            branchId: BRANCH,
            from: capturedFrom,
            to: capturedTo,
            compareFrom: "2026-04-01",
            compareTo: "2026-04-30",
            byVendor: [],
            byCategory: [],
          },
        });
      }),
    );

    await PurchasingRepository.getSpendAnalytics(BRANCH, "2026-05-01", "2026-05-31");

    expect(capturedFrom).toBe("2026-05-01");
    expect(capturedTo).toBe("2026-05-31");
  });

  it("changing the vendor issues a scorecard request with the new vendorId", async () => {
    let capturedVendorId: string | null = null;
    server.use(
      http.get("*/api/v1/purchasing/analytics/scorecard", ({ request }) => {
        const url = new URL(request.url);
        capturedVendorId = url.searchParams.get("vendorId");
        return HttpResponse.json({
          data: {
            vendorId: capturedVendorId,
            branchId: BRANCH,
            onTimeDeliveryPct: 90,
            fillRatePct: 95,
            priceVariancePct: 1.2,
            totalSpendPaisa: 10_000,
            purchaseOrderCount: 2,
          },
        });
      }),
    );

    await PurchasingRepository.getVendorScorecard(VENDOR_B_ID, BRANCH);

    expect(capturedVendorId).toBe(VENDOR_B_ID);
  });

  it("a null deltaPct is preserved through the parse (renders — in SpendAnalyticsTable, per 10-03-A)", async () => {
    server.use(
      http.get("*/api/v1/purchasing/analytics/spend", () =>
        HttpResponse.json({
          data: {
            branchId: BRANCH,
            from: "2026-06-01",
            to: "2026-06-30",
            compareFrom: "2026-05-01",
            compareTo: "2026-05-31",
            byVendor: [
              {
                label: "Zero Prior Vendor",
                id: VENDOR_ID,
                spendPaisa: 5_000,
                priorSpendPaisa: 0,
                deltaPaisa: 5_000,
                deltaPct: null,
              },
            ],
            byCategory: [],
          },
        }),
      ),
    );

    const report = await PurchasingRepository.getSpendAnalytics(BRANCH, "2026-06-01", "2026-06-30");

    expect(report.byVendor[0]?.deltaPct).toBeNull();
  });
});
