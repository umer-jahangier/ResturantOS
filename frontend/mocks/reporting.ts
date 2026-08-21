import { http, HttpResponse } from "msw";

// NOTE: ids below must be well-formed UUIDs (hex only) — apiFbrTaxSummarySchema/
// apiDashboardTileSchema validate id-ish fields with z.string().uuid(), and
// ReportingRepository always .parse()s before adapting (FE-08). 10-03-D precedent: a mock id with
// a non-hex letter prefix silently fails z.string().uuid() with no test catching it.
const BRANCH = "b0000001-0000-4000-8000-000000000001";

function ok<T>(data: T) {
  return HttpResponse.json({ data, meta: null, warnings: [] });
}

/** Mirrors ReportCatalog.java's 7 real reports exactly (code/title/category/columns). */
const REPORT_DEFINITIONS = [
  {
    code: "sales-by-day",
    title: "Sales by Day",
    category: "sales",
    columns: [
      "business_date",
      "order_count",
      "subtotal_paisa",
      "discount_paisa",
      "tax_paisa",
      "total_paisa",
    ],
  },
  {
    code: "sales-by-item",
    title: "Sales by Item",
    category: "sales",
    columns: [
      "menu_item_id",
      "item_name",
      "qty",
      "revenue_inc_tax_paisa",
      "cogs_paisa",
      "gross_margin_paisa",
    ],
  },
  {
    code: "sales-by-hour",
    title: "Sales by Hour (Peak Hours)",
    category: "sales",
    columns: ["hour_of_day", "order_count", "revenue_paisa"],
  },
  {
    code: "sales-by-order-type",
    title: "Sales by Order Type",
    category: "sales",
    columns: ["order_type", "order_count", "revenue_paisa"],
  },
  {
    // Re-synced with ReportCatalog.java:157-176 (12-08's fixture predated the move to
    // sales_discount_facts and still described the old day-grain shape, while this file's
    // header claimed all seven mirror the Java "exactly"). A fixture that misdescribes the
    // wire is a test suite that passes on a contract nobody ships.
    code: "discount-summary",
    title: "Discount Summary",
    category: "sales",
    columns: [
      "business_date",
      "order_no",
      "scope",
      "item_name",
      "discount_type",
      "discount_source",
      "discount_value",
      "amount_paisa",
      "reason",
      "applied_by",
      "closed_at",
    ],
  },
  {
    code: "till-sessions",
    title: "Till Sessions",
    category: "cash",
    columns: [
      "till_session_id",
      "cashier_id",
      "business_date",
      "expected_cash_paisa",
      "counted_cash_paisa",
      "variance_paisa",
      "closed_at",
    ],
  },
  {
    code: "purchases-by-po",
    title: "Purchases by Purchase Order",
    category: "purchasing",
    columns: [
      "purchase_order_id",
      "business_date",
      "invoice_count",
      "spend_paisa",
      "input_tax_paisa",
    ],
  },
] as const;

/**
 * Fixture rows per report code. `sales-by-item` always includes a row with `cogs_paisa`/
 * `gross_margin_paisa` NULL — the 12-05 Phase-8-deferred contract — so both the journey test and
 * the page's manual click-path exercise the "—, never 0" rendering path by default.
 */
const REPORT_ROWS: Record<string, Record<string, unknown>[]> = {
  "sales-by-day": [
    {
      business_date: "2026-07-15",
      order_count: 42,
      subtotal_paisa: 500_000,
      discount_paisa: 10_000,
      tax_paisa: 45_000,
      total_paisa: 535_000,
    },
    {
      business_date: "2026-07-16",
      order_count: 51,
      subtotal_paisa: 610_000,
      discount_paisa: 15_000,
      tax_paisa: 53_550,
      total_paisa: 648_550,
    },
  ],
  /**
   * The demo's own "Revenue by Hour" curve (DEMO-STATS L243), in paisa: the double peak at
   * 13:00 and 19:00 that N12 calls the one demo stat that informs a rota decision. Hour 15 is
   * deliberately ABSENT rather than zero — ClickHouse's `GROUP BY toHour(closed_at)` returns no
   * row for an hour in which nothing closed, so the gap-filling path is the DEFAULT path here
   * and not an edge case a test has to opt into.
   */
  "sales-by-hour": [
    { hour_of_day: 10, order_count: 4, revenue_paisa: 12_000 },
    { hour_of_day: 11, order_count: 7, revenue_paisa: 24_000 },
    { hour_of_day: 12, order_count: 16, revenue_paisa: 58_000 },
    { hour_of_day: 13, order_count: 19, revenue_paisa: 64_000 },
    { hour_of_day: 14, order_count: 12, revenue_paisa: 42_000 },
    { hour_of_day: 16, order_count: 9, revenue_paisa: 32_000 },
    { hour_of_day: 17, order_count: 13, revenue_paisa: 48_000 },
    { hour_of_day: 18, order_count: 22, revenue_paisa: 82_000 },
    { hour_of_day: 19, order_count: 27, revenue_paisa: 96_000 },
    { hour_of_day: 20, order_count: 24, revenue_paisa: 84_000 },
    { hour_of_day: 21, order_count: 15, revenue_paisa: 56_000 },
  ],
  "sales-by-order-type": [
    { order_type: "DINE_IN", order_count: 96, revenue_paisa: 348_000 },
    { order_type: "TAKEAWAY", order_count: 41, revenue_paisa: 132_000 },
    { order_type: "DELIVERY", order_count: 31, revenue_paisa: 118_000 },
  ],
  "sales-by-item": [
    {
      menu_item_id: "11111111-1111-4111-8111-111111110001",
      item_name: "Chicken Karahi",
      qty: 30,
      revenue_inc_tax_paisa: 150_000,
      cogs_paisa: null,
      gross_margin_paisa: null,
    },
    {
      menu_item_id: "11111111-1111-4111-8111-111111110002",
      item_name: "Seekh Kebab",
      qty: 18,
      revenue_inc_tax_paisa: 72_000,
      cogs_paisa: null,
      gross_margin_paisa: null,
    },
  ],
};

/** MSW fixtures for the 12-08 reporting frontend — RPT-01 (reports/FBR) and RPT-02 (dashboard). */
export const reportingHandlers = [
  http.get("*/api/v1/reporting/reports", () => ok(REPORT_DEFINITIONS)),

  http.post("*/api/v1/reporting/reports/:code/run", async ({ params, request }) => {
    const code = params.code as string;
    const def = REPORT_DEFINITIONS.find((r) => r.code === code);
    if (!def) {
      return HttpResponse.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Unknown report code",
            details: [],
            traceId: "mock-trace-id",
          },
        },
        { status: 404 },
      );
    }
    await request.json().catch(() => ({}));
    const rows = REPORT_ROWS[code] ?? [];
    const dataNotes =
      code === "sales-by-item"
        ? ["COGS and margin require Inventory (Phase 8) and are not yet available."]
        : [];
    return ok({
      code: def.code,
      title: def.title,
      columns: def.columns,
      rows,
      rowCount: rows.length,
      durationMs: 42,
      dataNotes,
    });
  }),

  // FBR Tax Summary — default fixture has input tax exceeding output tax, so netPayablePaisa is
  // NEGATIVE (a legitimate refundable credit), exercising that rendering path by default.
  http.get("*/api/v1/reporting/reports/fbr-tax-summary", ({ request }) => {
    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId") ?? BRANCH;
    const from = url.searchParams.get("from") ?? "2026-07-01";
    const to = url.searchParams.get("to") ?? "2026-07-18";
    return ok({
      branchId,
      branchName: "Main Branch",
      ntn: "1234567-8",
      fbrStrn: "03-00-1234-567-89",
      periodFrom: from,
      periodTo: to,
      outputTaxPaisa: 45_000,
      taxableSalesPaisa: 500_000,
      inputTaxPaisa: 60_000,
      taxablePurchasesPaisa: 400_000,
      netPayablePaisa: -15_000,
      salesOrderCount: 42,
      purchaseInvoiceCount: 8,
      durationMs: 37,
      dataNotes: [],
    });
  }),

  http.get("*/api/v1/reporting/dashboard/:branchId/tiles", () =>
    ok([
      {
        tileId: "todays-revenue",
        title: "Today's Revenue",
        valuePaisa: 535_000,
        valueNumber: null,
        unit: "PKR",
        businessDate: "2026-07-18",
        computedAt: "2026-07-18T09:15:30.123Z",
      },
      {
        tileId: "todays-orders",
        title: "Today's Orders",
        valuePaisa: null,
        valueNumber: 42,
        unit: "count",
        businessDate: "2026-07-18",
        computedAt: "2026-07-18T09:15:30.123Z",
      },
      {
        tileId: "todays-tax",
        title: "Today's Tax",
        valuePaisa: 45_000,
        valueNumber: null,
        unit: "PKR",
        businessDate: "2026-07-18",
        computedAt: "2026-07-18T09:15:30.123Z",
      },
      {
        tileId: "average-order-value",
        title: "Average Order Value",
        valuePaisa: 12_738,
        valueNumber: null,
        unit: "PKR",
        businessDate: "2026-07-18",
        computedAt: "2026-07-18T09:15:30.123Z",
      },
    ]),
  ),
];
