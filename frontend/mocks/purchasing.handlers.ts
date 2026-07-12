import { http, HttpResponse } from "msw";

// NOTE: ids below must be well-formed UUIDs (hex only) — apiVendorSchema/apiPurchaseOrderSchema/
// apiPoLineSchema/apiSpendBucketSchema/apiVendorScorecardSchema all validate id-ish fields with
// z.string().uuid(), and PurchasingRepository always .parse()s before adapting (FE-08).
const TENANT = "a0000001-0000-4000-8000-000000000001";
const BRANCH = "b0000001-0000-4000-8000-000000000001";
const VENDOR_ID = "c0000001-0000-4000-8000-000000000001";
const VENDOR_B_ID = "f0000002-0000-4000-8000-000000000002";
const PO_ID = "d0000001-0000-4000-8000-000000000001";
const LINE_ID = "e0000001-0000-4000-8000-000000000001";
const ING_1 = "11111111-1111-4111-8111-111111110001";

let poStatus = "SENT";
let grnQty = "0";
let closedAt: string | null = null;
let closeReason: string | null = null;
const invoices: Record<string, unknown> = {};

interface MockPoLine {
  id: string;
  ingredientId: string;
  qty: string;
  uom: string;
  unitPricePaisa: number;
  lineTotalPaisa: number;
}

interface MockPo {
  id: string;
  vendorId: string;
  branchId: string;
  status: string;
  expectedDeliveryDate: string | null;
  totalPaisa: number;
  notes: string | null;
  requesterId: string | null;
  submittedAt: string | null;
  requiredTiers: number;
  tiersApproved: number;
  closedAt: string | null;
  closeReason: string | null;
  lines: MockPoLine[];
}

interface CreatePoBody {
  vendorId: string;
  branchId: string;
  expectedDeliveryDate?: string | null;
  notes?: string | null;
  lines: { ingredientId: string; qty: string; uom: string; unitPricePaisa: number }[];
}

/**
 * F9 (10-12): the primary detail PO (`PO_ID`, wired to the shared `poStatus`/`grnQty`/`closedAt`/
 * `closeReason` module state above so the existing close/mock-receive handlers keep working
 * unmodified) plus any POs created through `POST /purchase-orders` during a test/dev session.
 */
const purchaseOrders: MockPo[] = [
  {
    id: PO_ID,
    vendorId: VENDOR_ID,
    branchId: BRANCH,
    status: poStatus,
    expectedDeliveryDate: "2026-06-14",
    totalPaisa: 100_000,
    notes: null,
    requesterId: null,
    submittedAt: null,
    requiredTiers: 1,
    tiersApproved: 0,
    closedAt,
    closeReason,
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
  },
];

/** Approvers already recorded per PO id — mirrors 10-07's distinct-approver rule. */
const approversByPo: Record<string, Set<string>> = {};
const CURRENT_APPROVER = "manager-1";

function findPo(id: string): MockPo | undefined {
  return purchaseOrders.find((p) => p.id === id);
}

interface MockVendor {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  paymentTerms: string;
  ntn: string | null;
  strn: string | null;
  leadTimeDays: number | null;
  bankAccountLast4: string | null;
  notes: string | null;
  active: boolean;
}

interface VendorWriteBody {
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  paymentTerms: string;
  ntn?: string;
  strn?: string;
  leadTimeDays?: number;
  bankAccountNo?: string;
  notes?: string;
}

const vendors: MockVendor[] = [
  {
    id: VENDOR_ID,
    name: "Fresh Foods Ltd",
    contactPerson: "Ali",
    phone: "03001234567",
    email: null,
    address: null,
    paymentTerms: "NET30",
    ntn: null,
    strn: null,
    leadTimeDays: null,
    bankAccountLast4: "3456",
    notes: null,
    active: true,
  },
];

/** Mirrors VendorService.apply(): last4 = final 4 digits of the account, non-digits stripped. */
function last4(bankAccountNo: string): string {
  const digits = bankAccountNo.replace(/\D/g, "");
  return digits.slice(-4);
}

/**
 * Mirrors VendorService.apply(): every field is overwritten, EXCEPT bankAccountNo — a blank or
 * absent account leaves the stored (encrypted) value untouched. The full account number is never
 * echoed back; only `bankAccountLast4` is.
 */
function applyVendorWrite(target: MockVendor, body: VendorWriteBody): MockVendor {
  const next: MockVendor = {
    ...target,
    name: body.name,
    paymentTerms: body.paymentTerms,
    contactPerson: body.contactPerson ?? null,
    phone: body.phone ?? null,
    email: body.email ?? null,
    address: body.address ?? null,
    ntn: body.ntn ?? null,
    strn: body.strn ?? null,
    leadTimeDays: body.leadTimeDays ?? null,
    notes: body.notes ?? null,
  };
  if (body.bankAccountNo && body.bankAccountNo.trim() !== "") {
    next.bankAccountLast4 = last4(body.bankAccountNo);
  }
  return next;
}

function ok<T>(data: T) {
  return HttpResponse.json({ data, meta: null, warnings: [] });
}

function apiError(code: string, message: string, status: number) {
  return HttpResponse.json(
    { error: { code, message, details: [], traceId: "mock-trace-id" } },
    { status },
  );
}

/** MSW fixtures F1–F8 for frontend-only purchasing dev (Phase 10). */
export const purchasingHandlers = [
  http.get("*/api/v1/purchasing/vendors", () => ok(vendors)),

  // PUR-01: create a vendor. The account number is write-only — the response carries last4 only.
  http.post("*/api/v1/purchasing/vendors", async ({ request }) => {
    const body = (await request.json()) as VendorWriteBody;
    if (!body.name?.trim() || !body.paymentTerms?.trim()) {
      return apiError("VALIDATION_ERROR", "name and paymentTerms are required", 400);
    }
    const seq = String(vendors.length + 1).padStart(12, "0");
    const created = applyVendorWrite(
      {
        id: `c0000001-0000-4000-8000-${seq}`,
        name: body.name,
        contactPerson: null,
        phone: null,
        email: null,
        address: null,
        paymentTerms: body.paymentTerms,
        ntn: null,
        strn: null,
        leadTimeDays: null,
        bankAccountLast4: null,
        notes: null,
        active: true,
      },
      body,
    );
    vendors.push(created);
    return ok(created);
  }),

  // PUR-01: update a vendor. A blank/absent bankAccountNo preserves the stored account.
  http.put("*/api/v1/purchasing/vendors/:id", async ({ params, request }) => {
    const body = (await request.json()) as VendorWriteBody;
    const idx = vendors.findIndex((v) => v.id === params.id);
    if (idx === -1) return apiError("NOT_FOUND", "Vendor not found", 404);
    const updated = applyVendorWrite(vendors[idx]!, body);
    vendors[idx] = updated;
    return ok(updated);
  }),

  // 10-10: branch-scoped PO list, optionally narrowed by ?status=. The primary fixture (PO_ID)
  // always reflects the shared poStatus/closedAt/closeReason module state so a submit->approve->
  // send->receive->close sequence stays consistent whether read through the list or the detail
  // endpoint.
  http.get("*/api/v1/purchasing/purchase-orders", ({ request }) => {
    const url = new URL(request.url);
    const statuses = url.searchParams.getAll("status");
    const rows = purchaseOrders.map((p) => (p.id === PO_ID ? { ...p, status: poStatus, closedAt, closeReason } : p));
    const filtered = statuses.length > 0 ? rows.filter((p) => statuses.includes(p.status)) : rows;
    return ok(filtered);
  }),

  // 10-12: create a DRAFT PO. `qty * unitPricePaisa` (rounded) becomes each line's total; the PO
  // total is the sum of line totals.
  http.post("*/api/v1/purchasing/purchase-orders", async ({ request }) => {
    const body = (await request.json()) as CreatePoBody;
    if (!body.vendorId || !body.branchId || !body.lines?.length) {
      return apiError("VALIDATION_ERROR", "vendorId, branchId and at least one line are required", 400);
    }
    const seq = String(purchaseOrders.length + 1).padStart(12, "0");
    const id = `d0000002-0000-4000-8000-${seq}`;
    const lines: MockPoLine[] = body.lines.map((l, idx) => {
      const lineTotalPaisa = Math.round(Number(l.qty) * l.unitPricePaisa);
      return {
        id: `e0000002-0000-4000-8000-${String(idx + 1).padStart(12, "0")}`,
        ingredientId: l.ingredientId,
        qty: l.qty,
        uom: l.uom,
        unitPricePaisa: l.unitPricePaisa,
        lineTotalPaisa,
      };
    });
    const created: MockPo = {
      id,
      vendorId: body.vendorId,
      branchId: body.branchId,
      status: "DRAFT",
      expectedDeliveryDate: body.expectedDeliveryDate ?? null,
      totalPaisa: lines.reduce((sum, l) => sum + l.lineTotalPaisa, 0),
      notes: body.notes ?? null,
      requesterId: null,
      submittedAt: null,
      requiredTiers: 1,
      tiersApproved: 0,
      closedAt: null,
      closeReason: null,
      lines,
    };
    purchaseOrders.push(created);
    return ok(created);
  }),

  http.post("*/api/v1/purchasing/purchase-orders/:id/submit", ({ params }) => {
    const po = findPo(params.id as string);
    if (!po) return apiError("NOT_FOUND", "Purchase order not found", 404);
    if (po.id === PO_ID) poStatus = "PENDING_APPROVAL";
    po.status = "PENDING_APPROVAL";
    po.submittedAt = "2026-06-15T09:00:00Z";
    return ok(po.id === PO_ID ? { ...po, status: poStatus } : po);
  }),

  http.post("*/api/v1/purchasing/purchase-orders/:id/withdraw", ({ params }) => {
    const po = findPo(params.id as string);
    if (!po) return apiError("NOT_FOUND", "Purchase order not found", 404);
    if (po.id === PO_ID) poStatus = "DRAFT";
    po.status = "DRAFT";
    return ok(po.id === PO_ID ? { ...po, status: poStatus } : po);
  }),

  // 10-07: distinct-approver rule — the same mock "current user" approving the same PO twice is a
  // 409 DUPLICATE_APPROVER, mirroring the real backend's PoApprovalService.
  http.post("*/api/v1/purchasing/purchase-orders/:id/approve", ({ params }) => {
    const po = findPo(params.id as string);
    if (!po) return apiError("NOT_FOUND", "Purchase order not found", 404);
    const approvers = (approversByPo[po.id] ??= new Set());
    if (approvers.has(CURRENT_APPROVER)) {
      return apiError("DUPLICATE_APPROVER", "You have already approved this purchase order", 409);
    }
    approvers.add(CURRENT_APPROVER);
    po.tiersApproved += 1;
    if (po.tiersApproved >= po.requiredTiers) {
      po.status = "APPROVED";
      if (po.id === PO_ID) poStatus = "APPROVED";
    }
    return ok(po.id === PO_ID ? { ...po, status: poStatus } : po);
  }),

  http.post("*/api/v1/purchasing/purchase-orders/:id/reject", async ({ params, request }) => {
    const po = findPo(params.id as string);
    if (!po) return apiError("NOT_FOUND", "Purchase order not found", 404);
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    if (!body.reason || !body.reason.trim()) {
      return apiError("VALIDATION_ERROR", "A reason is required to reject a purchase order", 400);
    }
    po.status = "REJECTED";
    if (po.id === PO_ID) poStatus = "REJECTED";
    return ok(po.id === PO_ID ? { ...po, status: poStatus } : po);
  }),

  http.post("*/api/v1/purchasing/purchase-orders/:id/send", ({ params }) => {
    const po = findPo(params.id as string);
    if (!po) return apiError("NOT_FOUND", "Purchase order not found", 404);
    if (po.status !== "APPROVED") {
      return apiError("INVALID_PO_STATE", "Only an APPROVED purchase order can be sent", 409);
    }
    po.status = "SENT";
    if (po.id === PO_ID) poStatus = "SENT";
    return ok(po.id === PO_ID ? { ...po, status: poStatus } : po);
  }),

  http.get("*/api/v1/purchasing/purchase-orders/:id", ({ params }) => {
    const po = findPo(params.id as string);
    if (po && po.id !== PO_ID) return ok(po);
    return ok({
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
      tiersApproved: po?.tiersApproved ?? 1,
      closedAt,
      closeReason,
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
    });
  }),

  http.post("*/api/v1/purchasing/purchase-orders/:poId/mock-receive", async ({ params, request }) => {
    const body = (await request.json()) as { lines: { poLineId: string; receivedQty: string }[] };
    const received = body.lines[0]?.receivedQty ?? "100";
    grnQty = received;
    poStatus = received === "100" ? "FULLY_RECEIVED" : "PARTIALLY_RECEIVED";
    return ok({ poId: params.poId, status: poStatus, grnIds: ["g0000001-0000-4000-8000-000000000001"] });
  }),

  // PUR-02 gap closure: close a FULLY_RECEIVED PO, or short-close a PARTIALLY_RECEIVED PO with a
  // mandatory reason — mirrors PurchaseOrderService.close() state guard.
  http.post("*/api/v1/purchasing/purchase-orders/:poId/close", async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { reason?: string | null };
    if (poStatus !== "FULLY_RECEIVED" && poStatus !== "PARTIALLY_RECEIVED") {
      return apiError("INVALID_PO_STATE", "Only FULLY_RECEIVED or PARTIALLY_RECEIVED PO can be closed", 409);
    }
    if (poStatus === "PARTIALLY_RECEIVED" && (!body.reason || !body.reason.trim())) {
      return apiError("INVALID_PO_STATE", "Short-close requires a reason", 409);
    }
    poStatus = "CLOSED";
    closedAt = "2026-06-20T10:00:00Z";
    closeReason = body.reason ?? null;
    return ok({
      id: params.poId,
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
      closedAt,
      closeReason,
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
    });
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
      priceVariancePct: grnQty === "0" ? 0 : 3.5,
      totalSpendPaisa: 100_000,
      purchaseOrderCount: 1,
    }),
  ),

  // F8: spend analytics — 2 vendors, 3 categories, current (Jun 2026) vs prior (May 2026) period.
  http.get("*/api/v1/purchasing/analytics/spend", () =>
    ok({
      branchId: BRANCH,
      from: "2026-06-01",
      to: "2026-06-30",
      compareFrom: "2026-05-02",
      compareTo: "2026-05-31",
      byVendor: [
        {
          label: "Fresh Foods Ltd",
          id: VENDOR_ID,
          spendPaisa: 80_000,
          priorSpendPaisa: 65_000,
          deltaPaisa: 15_000,
          deltaPct: 23.08,
        },
        {
          label: "Value Meats",
          id: VENDOR_B_ID,
          spendPaisa: 20_000,
          priorSpendPaisa: 0,
          deltaPaisa: 20_000,
          deltaPct: null,
        },
      ],
      byCategory: [
        {
          label: "Produce",
          id: null,
          spendPaisa: 50_000,
          priorSpendPaisa: 40_000,
          deltaPaisa: 10_000,
          deltaPct: 25,
        },
        {
          label: "Dairy",
          id: null,
          spendPaisa: 30_000,
          priorSpendPaisa: 25_000,
          deltaPaisa: 5_000,
          deltaPct: 20,
        },
        {
          label: "Meat",
          id: null,
          spendPaisa: 20_000,
          priorSpendPaisa: 0,
          deltaPaisa: 20_000,
          deltaPct: null,
        },
      ],
    }),
  ),
];
