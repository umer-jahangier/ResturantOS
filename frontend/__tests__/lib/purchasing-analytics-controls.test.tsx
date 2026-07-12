import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { server } from "../../mocks/server";
import { PurchasingRepository } from "@/lib/repositories/purchasing.repository";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import PurchasingAnalyticsPage from "@/app/(tenant)/app/purchasing/analytics/page";

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

/**
 * Real-render-path check (standing lesson 10-06-A: MSW/vitest green is not proof by itself —
 * mount the actual page component, not just the hook/repository layer).
 */
describe("PurchasingAnalyticsPage (real render path)", () => {
  beforeEach(() => seedSession({ branchId: BRANCH }));
  afterEach(() => clearSession());

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return render(<PurchasingAnalyticsPage />, { wrapper: Wrapper });
  }

  it("switching the period preset re-requests spend analytics with the new from/to and updates the comparison header", async () => {
    const seenRanges: { from: string; to: string }[] = [];
    server.use(
      http.get("*/api/v1/purchasing/analytics/spend", ({ request }) => {
        const url = new URL(request.url);
        const from = url.searchParams.get("from")!;
        const to = url.searchParams.get("to")!;
        seenRanges.push({ from, to });
        return HttpResponse.json({
          data: {
            branchId: BRANCH,
            from,
            to,
            compareFrom: "1900-01-01",
            compareTo: "1900-01-31",
            byVendor: [],
            byCategory: [],
          },
        });
      }),
    );

    renderPage();
    const user = userEvent.setup();

    await waitFor(() => expect(seenRanges.length).toBeGreaterThan(0));
    const firstRangeCount = seenRanges.length;

    await user.selectOptions(screen.getByLabelText("Analytics period"), "last-month");

    await waitFor(() => expect(seenRanges.length).toBeGreaterThan(firstRangeCount));
    const latest = seenRanges[seenRanges.length - 1]!;
    expect(latest.from).not.toBe(seenRanges[0]!.from);
    await waitFor(() => expect(screen.getByText(/vs 1900-01-01/)).toBeInTheDocument());
  });

  it("switching the vendor selector re-requests the scorecard with the new vendorId and updates the metrics", async () => {
    server.use(
      http.get("*/api/v1/purchasing/vendors", () =>
        HttpResponse.json({
          data: [
            { id: VENDOR_ID, name: "Fresh Foods Ltd", paymentTerms: "NET30", active: true },
            { id: VENDOR_B_ID, name: "Value Meats", paymentTerms: "NET15", active: true },
          ],
        }),
      ),
      http.get("*/api/v1/purchasing/analytics/scorecard", ({ request }) => {
        const url = new URL(request.url);
        const vendorId = url.searchParams.get("vendorId");
        const isSecondVendor = vendorId === VENDOR_B_ID;
        return HttpResponse.json({
          data: {
            vendorId,
            branchId: BRANCH,
            onTimeDeliveryPct: isSecondVendor ? 42 : 90,
            fillRatePct: isSecondVendor ? 55 : 95,
            priceVariancePct: isSecondVendor ? 9.9 : 1.2,
            totalSpendPaisa: isSecondVendor ? 7_000 : 10_000,
            purchaseOrderCount: 1,
          },
        });
      }),
      http.get("*/api/v1/purchasing/analytics/spend", () =>
        HttpResponse.json({
          data: {
            branchId: BRANCH,
            from: "2026-06-01",
            to: "2026-06-30",
            compareFrom: "2026-05-01",
            compareTo: "2026-05-31",
            byVendor: [],
            byCategory: [],
          },
        }),
      ),
    );

    renderPage();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("90.0%")).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Scorecard vendor"), VENDOR_B_ID);

    await waitFor(() => expect(screen.getByText("42.0%")).toBeInTheDocument());
  });
});
