import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { ReportingRepository } from "@/lib/repositories/reporting.repository";

const BRANCH = "b0000001-0000-4000-8000-000000000001";

describe("ReportingRepository journey (12-08, MSW round-trip)", () => {
  it("listReports_roundTrips: repository -> Zod parse -> adapter -> model", async () => {
    const reports = await ReportingRepository.listReports();
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.some((r) => r.code === "sales-by-item")).toBe(true);
    expect(reports.every((r) => Array.isArray(r.columns) && r.columns.length > 0)).toBe(true);
  });

  it("runReport_parsesNullCogs: a fixture row with cogs_paisa null survives the parse as null, never 0", async () => {
    const result = await ReportingRepository.runReport("sales-by-item", {
      branchId: BRANCH,
      from: "2026-07-01",
      to: "2026-07-18",
    });
    expect(result.rows.length).toBeGreaterThan(0);
    const row = result.rows[0]!;
    expect(row.cogs_paisa).toBeNull();
    expect(row.gross_margin_paisa).toBeNull();
    // The honest-degradation contract: never a manufactured 0.
    expect(row.cogs_paisa).not.toBe(0);
    expect(result.dataNotes.length).toBeGreaterThan(0);
  });

  it("fbrSummary_roundTrips: a NEGATIVE netPayablePaisa survives unclamped", async () => {
    const summary = await ReportingRepository.fbrTaxSummary({
      branchId: BRANCH,
      from: "2026-07-01",
      to: "2026-07-18",
    });
    expect(summary.netPayablePaisa).toBeLessThan(0);
    expect(summary.branchId).toBe(BRANCH);
  });

  it("fbrSummary_roundTrips: a missing ntn/fbrStrn degrades gracefully (not a failed parse)", async () => {
    server.use(
      http.get("*/api/v1/reporting/reports/fbr-tax-summary", () =>
        HttpResponse.json({
          data: {
            branchId: BRANCH,
            branchName: "Main Branch",
            ntn: null,
            fbrStrn: null,
            periodFrom: "2026-07-01",
            periodTo: "2026-07-18",
            outputTaxPaisa: 10_000,
            taxableSalesPaisa: 100_000,
            inputTaxPaisa: 2_000,
            taxablePurchasesPaisa: 20_000,
            netPayablePaisa: 8_000,
            salesOrderCount: 5,
            purchaseInvoiceCount: 1,
            durationMs: 12,
            dataNotes: ["Branch tax registration unavailable."],
          },
          meta: null,
          warnings: [],
        }),
      ),
    );

    const summary = await ReportingRepository.fbrTaxSummary({
      branchId: BRANCH,
      from: "2026-07-01",
      to: "2026-07-18",
    });
    expect(summary.ntn).toBeNull();
    expect(summary.fbrStrn).toBeNull();
    expect(summary.netPayablePaisa).toBe(8_000);
  });

  it("dashboardTiles_roundTrips: exactly one of valuePaisa/valueNumber populated per tile", async () => {
    const tiles = await ReportingRepository.dashboardTiles(BRANCH);
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      const populatedCount = [tile.valuePaisa, tile.valueNumber].filter((v) => v !== null).length;
      expect(populatedCount).toBe(1);
    }
    expect(tiles.some((t) => t.tileId === "average-order-value")).toBe(true);
    // open-tills was deliberately DROPPED by 12-06 — never invented on the frontend either.
    expect(tiles.some((t) => t.tileId === "open-tills")).toBe(false);
  });
});
