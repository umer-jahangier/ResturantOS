import { http, HttpResponse } from "msw";

const TENANT = "a0000001-0000-4000-8000-000000000001";
const BRANCH = "b0000001-0000-4000-8000-000000000001";
const VENDOR_ID = "v0000001-0000-4000-8000-000000000001";
const PO_ID = "p0000001-0000-4000-8000-000000000001";
const LINE_ID = "l0000001-0000-4000-8000-000000000001";
const ING_1 = "11111111-1111-4111-8111-111111110001";

let poStatus = "SENT";
let grnQty = "0";
const invoices: Record<string, unknown> = {};

function ok<T>(data: T) {
  return HttpResponse.json({ data, meta: null, warnings: [] });
}

/** MSW fixtures F1–F6 for frontend-only purchasing dev (Phase 10). */
export const purchasingHandlers = [
  http.get("*/api/v1/purchasing/vendors", () =>
    ok([
      {
        id: VENDOR_ID,
        name: "Fresh Foods Ltd",
        contactPerson: "Ali",
        phone: "03001234567",
        paymentTerms: "NET30",
        bankAccountLast4: "3456",
        active: true,
      },
    ]),
  ),

  http.get("*/api/v1/purchasing/purchase-orders/:id", ({ params }) =>
    ok({
      id: params.id,
      vendorId: VENDOR_ID,
      branchId: BRANCH,
      status: poStatus,
      expectedDeliveryDate: "2026-06-14",
      totalPaisa: 100_000,
      notes: null,
      requesterId: null,
      submittedAt: null,
      requiredTiers: 1,
      tiersApproved: 1,
      lines: [
        {
          id: LINE_ID,
          ingredientId: ING_1,
          qty: "100",
          uom: "kg",
          unitPricePaisa: 1000,
          lineTotalPaisa: 100_000,
        },
      ],
    }),
  ),

  http.post("*/api/v1/purchasing/purchase-orders/:poId/mock-receive", async ({ params, request }) => {
    const body = (await request.json()) as { lines: { poLineId: string; receivedQty: string }[] };
    const received = body.lines[0]?.receivedQty ?? "100";
    grnQty = received;
    poStatus = received === "100" ? "FULLY_RECEIVED" : "PARTIALLY_RECEIVED";
    return ok({ poId: params.poId, status: poStatus, grnIds: ["g0000001-0000-4000-8000-000000000001"] });
  }),

  http.post("*/api/v1/purchasing/invoices", async ({ request }) => {
    const body = (await request.json()) as {
      purchaseOrderId: string;
      invoiceNo: string;
      lines: { poLineId: string; qty: string; unitPricePaisa: number }[];
    };
    const hasGrn = parseFloat(grnQty) > 0;
    const priceOk = body.lines.every((l) => l.unitPricePaisa <= 1020);
    const matchStatus = !hasGrn ? "MISSING_GRN" : priceOk ? "OK" : "PRICE_OVER";
    const invoiceStatus = matchStatus === "OK" ? "MATCHED" : "MISMATCHED";
    const id = `i0000001-0000-4000-8000-${String(Object.keys(invoices).length + 1).padStart(12, "0")}`;
    const invoice = {
      id,
      vendorId: VENDOR_ID,
      purchaseOrderId: body.purchaseOrderId,
      branchId: BRANCH,
      invoiceNo: body.invoiceNo,
      invoiceDate: "2026-06-16",
      status: invoiceStatus,
      totalPaisa: 100_000,
      inputTaxPaisa: 0,
      matchOverrideReason: null,
      lines: body.lines.map((l, idx) => ({
        id: `il-${idx}`,
        poLineId: l.poLineId,
        qty: l.qty,
        unitPricePaisa: l.unitPricePaisa,
        lineTotalPaisa: Number(l.qty) * l.unitPricePaisa,
        matchStatus,
        grnQty: grnQty,
        poQty: "100",
        poUnitPricePaisa: 1000,
      })),
    };
    invoices[id] = invoice;
    return ok(invoice);
  }),

  http.get("*/api/v1/purchasing/invoices/:id", ({ params }) => ok(invoices[params.id as string] ?? invoices[Object.keys(invoices)[0] ?? ""])),

  http.get("*/api/v1/purchasing/analytics/scorecard", () =>
    ok({
      vendorId: VENDOR_ID,
      branchId: BRANCH,
      onTimeDeliveryPct: grnQty === "0" ? 0 : 85,
      fillRatePct: grnQty === "0" ? 0 : 100,
      totalSpendPaisa: 100_000,
      purchaseOrderCount: 1,
    }),
  ),
];
