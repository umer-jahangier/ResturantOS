import { describe, expect, it } from "vitest";
import { PurchasingRepository } from "@/lib/repositories/purchasing.repository";

describe("PurchasingRepository.getSpendAnalytics (F8 MSW fixture, Zod parse-before-adapt)", () => {
  it("parses the /analytics/spend payload with by-vendor and by-category buckets", async () => {
    const report = await PurchasingRepository.getSpendAnalytics(
      "b0000001-0000-4000-8000-000000000001",
      "2026-06-01",
      "2026-06-30",
    );

    expect(report.byVendor.length).toBeGreaterThanOrEqual(2);
    expect(report.byCategory.length).toBeGreaterThanOrEqual(3);

    const produce = report.byCategory.find((b) => b.label === "Produce");
    expect(produce?.spendPaisa).toBe(50_000);
    expect(produce?.deltaPct).toBeCloseTo(25, 0);

    const meat = report.byCategory.find((b) => b.label === "Meat");
    expect(meat?.priorSpendPaisa).toBe(0);
    expect(meat?.deltaPct).toBeNull();
  });
});

describe("PurchasingRepository.getVendorScorecard (Zod parse-before-adapt)", () => {
  it("parses the /analytics/scorecard payload including priceVariancePct", async () => {
    const scorecard = await PurchasingRepository.getVendorScorecard(
      "c0000001-0000-4000-8000-000000000001",
      "b0000001-0000-4000-8000-000000000001",
    );

    expect(typeof scorecard.priceVariancePct).toBe("number");
    expect(typeof scorecard.onTimeDeliveryPct).toBe("number");
  });
});
