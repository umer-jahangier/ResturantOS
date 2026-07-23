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
// Second line on the primary fixture PO — required to make a GENUINE per-line partial receipt
// testable/click-throughable (one line fully received, the other partially -> PARTIALLY_RECEIVED).
const LINE_ID_2 = "e0000001-0000-4000-8000-000000000002";
const ING_1 = "11111111-1111-4111-8111-111111110001";
const ING_2 = "11111111-1111-4111-8111-111111110002";

// 08.2-13 (PUR-07): vendor item catalog fixtures. VENDOR_ITEM_1 has two price rows so the
// price-change history table has a real delta to render; VENDOR_ITEM_3 is archived (excluded from
// the default catalog list, but its price history is preserved — nothing is ever deleted).
const VENDOR_ITEM_1 = "a1000001-0000-4000-8000-000000000001";
const VENDOR_ITEM_2 = "a1000001-0000-4000-8000-000000000002";
const VENDOR_ITEM_3 = "a1000001-0000-4000-8000-000000000003";
const VENDOR_ITEM_PRICE_1A = "a2000001-0000-4000-8000-000000000001";
const VENDOR_ITEM_PRICE_1B = "a2000001-0000-4000-8000-000000000002";
const VENDOR_ITEM_PRICE_2A = "a2000001-0000-4000-8000-000000000003";
const VENDOR_CATEGORY_PRODUCE = "a3000001-0000-4000-8000-000000000001";

let poStatus = "SENT";
// Per-line received-to-date, keyed by poLineId — the regression pin for the "one qty broadcast to
// every line" bug (10-12 gap closure). Ordered qty: LINE_ID=100, LINE_ID_2=50.
const receivedByLine: Record<string, string> = { [LINE_ID]: "0", [LINE_ID_2]: "0" };
let grnQty = "0";
let closedAt: string | null = null;
let closeReason: string | null = null;

interface MockInvoiceLine {
  id: string;
  poLineId: string;
  qty: string;
  unitPricePaisa: number;
  lineTotalPaisa: number;
  matchStatus: string;
  grnQty: string;
  poQty: string;
  poUnitPricePaisa: number;
}

interface MockInvoice {
  id: string;
  vendorId: string;
  purchaseOrderId: string;
  branchId: string;
  invoiceNo: string;
  invoiceDate: string;
  status: string;
  totalPaisa: number;
  inputTaxPaisa: number;
  matchOverrideReason: string | null;
  lines: MockInvoiceLine[];
}

interface MockApPaymentAllocation {
  invoiceId: string;
  amountPaisa: number;
}

interface MockApPayment {
  id: string;
  vendorId: string;
  branchId: string;
  paymentDate: string;
  amountPaisa: number;
  bankAccountCode: string;
  allocations: MockApPaymentAllocation[];
}

const invoices: MockInvoice[] = [];
const apPayments: MockApPayment[] = [];

/**
 * Mirrors `ThreeWayMatchService.matchLine` + the default `TenantMatchTolerance` row
 * (`qtyOverPct=0`, `qtyUnderPct=0.05`, `priceOverPct=0.02`, `priceUnderPct=0.10`) exactly, so the
 * mock does not teach the invoice-journey test a tolerance the real backend does not enforce.
 */
function matchLineStatus(receivedQty: number, invQty: number, poPrice: number, invPrice: number): string {
  if (receivedQty <= 0) return "MISSING_GRN";
  if (invQty > receivedQty * 1.0) return "QTY_OVER";
  if (invQty < receivedQty * 0.95) return "QTY_UNDER";
  const ratio = poPrice === 0 ? 1 : invPrice / poPrice;
  if (ratio > 1.02) return "PRICE_OVER";
  if (ratio < 0.9) return "PRICE_UNDER";
  return "OK";
}

// 08.2-13 (PUR-08): vendorItemId/vendorSku/packDescription/priceOverridden are all null for a
// legacy (hand-typed-ingredient) line — only lines created from vendorItemId populate them.
interface MockPoLine {
  id: string;
  ingredientId: string;
  qty: string;
  uom: string;
  unitPricePaisa: number;
  lineTotalPaisa: number;
  vendorItemId: string | null;
  vendorSku: string | null;
  packDescription: string | null;
  priceOverridden: boolean;
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

/**
 * A PO-creation line body may carry EITHER `vendorItemId` (08.2-10's catalog-driven path — `uom`/
 * `unitPricePaisa` optional, server-filled from the catalog) OR the legacy hand-typed
 * `ingredientId`+`uom`+`unitPricePaisa`, mirroring `CreatePurchaseOrderRequest.Line`'s real
 * mutually-exclusive contract.
 */
interface CreatePoLineBody {
  vendorItemId?: string;
  ingredientId?: string;
  qty: string;
  uom?: string;
  unitPricePaisa?: number;
}

interface CreatePoBody {
  vendorId: string;
  branchId: string;
  expectedDeliveryDate?: string | null;
  notes?: string | null;
  lines: CreatePoLineBody[];
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
    totalPaisa: 150_000,
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
        vendorItemId: null,
        vendorSku: null,
        packDescription: null,
        priceOverridden: false,
      },
      {
        id: LINE_ID_2,
        ingredientId: ING_2,
        qty: "50",
        uom: "kg",
        unitPricePaisa: 1000,
        lineTotalPaisa: 50_000,
        vendorItemId: null,
        vendorSku: null,
        packDescription: null,
        priceOverridden: false,
      },
    ],
  },
];

// ── Vendor item catalog (PUR-07) ────────────────────────────────────────────────────────────

interface MockVendorItem {
  id: string;
  vendorId: string;
  ingredientId: string;
  vendorSku: string | null;
  vendorDescription: string | null;
  orderUom: string;
  packDescription: string | null;
  packQty: string;
  packUom: string;
  minOrderQty: string | null;
  orderMultiple: string | null;
  leadTimeDays: number | null;
  preferred: boolean;
  catchWeight: boolean;
  archivedAt: string | null;
}

interface MockVendorItemPrice {
  id: string;
  vendorItemId: string;
  branchId: string | null;
  unitPricePaisa: number;
  priceUom: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  source: string | null;
  contractPrice: boolean;
}

interface MockVendorCategory {
  categoryId: string;
  categoryName: string;
  preferred: boolean;
}

/** Two vendors, three catalog items (one archived) — VENDOR_ITEM_1 carries two price rows. */
const vendorItems: MockVendorItem[] = [
  {
    id: VENDOR_ITEM_1,
    vendorId: VENDOR_ID,
    ingredientId: ING_1,
    vendorSku: "FF-CHKN-01",
    vendorDescription: "Chicken breast, boneless",
    orderUom: "kg",
    packDescription: "10kg case",
    packQty: "10",
    packUom: "kg",
    minOrderQty: "10",
    orderMultiple: "10",
    leadTimeDays: 2,
    preferred: true,
    catchWeight: false,
    archivedAt: null,
  },
  {
    id: VENDOR_ITEM_2,
    vendorId: VENDOR_ID,
    ingredientId: ING_2,
    vendorSku: "FF-TOM-01",
    vendorDescription: "Roma tomatoes",
    orderUom: "kg",
    packDescription: "5kg crate",
    packQty: "5",
    packUom: "kg",
    minOrderQty: "5",
    orderMultiple: "5",
    leadTimeDays: 1,
    preferred: false,
    catchWeight: false,
    archivedAt: null,
  },
  {
    id: VENDOR_ITEM_3,
    vendorId: VENDOR_ID,
    ingredientId: ING_1,
    vendorSku: "FF-CHKN-02",
    vendorDescription: "Chicken breast, bulk pack (discontinued)",
    orderUom: "kg",
    packDescription: "25kg case",
    packQty: "25",
    packUom: "kg",
    minOrderQty: "25",
    orderMultiple: "25",
    leadTimeDays: 3,
    preferred: false,
    catchWeight: false,
    archivedAt: "2026-05-01T00:00:00Z",
  },
];

/** VENDOR_ITEM_1's two rows: PRICE_1A is the closed (superseded) row, PRICE_1B is the open one. */
const vendorItemPrices: MockVendorItemPrice[] = [
  {
    id: VENDOR_ITEM_PRICE_1A,
    vendorItemId: VENDOR_ITEM_1,
    branchId: null,
    unitPricePaisa: 90_000,
    priceUom: "kg",
    effectiveFrom: "2026-05-01T00:00:00Z",
    effectiveTo: "2026-06-01T00:00:00Z",
    source: "manual",
    contractPrice: false,
  },
  {
    id: VENDOR_ITEM_PRICE_1B,
    vendorItemId: VENDOR_ITEM_1,
    branchId: null,
    unitPricePaisa: 95_000,
    priceUom: "kg",
    effectiveFrom: "2026-06-01T00:00:00Z",
    effectiveTo: null,
    source: "manual",
    contractPrice: false,
  },
  {
    id: VENDOR_ITEM_PRICE_2A,
    vendorItemId: VENDOR_ITEM_2,
    branchId: null,
    unitPricePaisa: 25_000,
    priceUom: "kg",
    effectiveFrom: "2026-06-01T00:00:00Z",
    effectiveTo: null,
    source: "manual",
    contractPrice: false,
  },
];

const vendorCategoriesByVendor: Record<string, MockVendorCategory[]> = {
  [VENDOR_ID]: [{ categoryId: VENDOR_CATEGORY_PRODUCE, categoryName: "Produce", preferred: true }],
  [VENDOR_B_ID]: [],
};

/** The row whose window (`effectiveFrom <= now`, `effectiveTo` null or in the future) covers now. */
function currentPriceFor(vendorItemId: string): MockVendorItemPrice | undefined {
  const now = Date.now();
  return vendorItemPrices
    .filter((p) => p.vendorItemId === vendorItemId)
    .filter(
      (p) =>
        new Date(p.effectiveFrom).getTime() <= now &&
        (!p.effectiveTo || new Date(p.effectiveTo).getTime() > now),
    )
    .sort((a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime())[0];
}

function toVendorItemDto(item: MockVendorItem) {
  const price = currentPriceFor(item.id);
  return {
    ...item,
    currentUnitPricePaisa: price?.unitPricePaisa ?? null,
    currentPriceUom: price?.priceUom ?? null,
    currentPriceEffectiveFrom: price?.effectiveFrom ?? null,
  };
}

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

  // ── Vendor item catalog (PUR-07) ──────────────────────────────────────────────────────────

  // Paginated, excludes archived rows by default, attaches the currently effective price to each
  // row — mirrors VendorItemController#list + VendorItemDto's current-price trio.
  http.get("*/api/v1/purchasing/vendors/:vendorId/items", ({ params, request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? "0");
    const size = Number(url.searchParams.get("size") ?? "20");
    const rows = vendorItems.filter((v) => v.vendorId === params.vendorId && !v.archivedAt).map(toVendorItemDto);
    const start = page * size;
    const pageRows = rows.slice(start, start + size);
    return HttpResponse.json({
      data: pageRows,
      meta: { page, size, totalElements: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / size)) },
      warnings: [],
    });
  }),

  // Create a catalog item; an initialUnitPricePaisa seeds the first price row (append-only, via
  // the same currentPriceFor()-backed resolution as every other write path in this file).
  http.post("*/api/v1/purchasing/vendors/:vendorId/items", async ({ params, request }) => {
    const body = (await request.json()) as {
      ingredientId: string;
      vendorSku?: string;
      vendorDescription?: string;
      orderUom: string;
      packDescription?: string;
      packQty: string;
      packUom: string;
      minOrderQty?: string;
      orderMultiple?: string;
      leadTimeDays?: number;
      preferred?: boolean;
      catchWeight?: boolean;
      initialUnitPricePaisa?: number;
      initialPriceUom?: string;
      initialPriceEffectiveFrom?: string;
    };
    if (!body.ingredientId || !body.orderUom?.trim() || !body.packQty || !body.packUom?.trim()) {
      return apiError(
        "VALIDATION_ERROR",
        "ingredientId, orderUom, packQty and packUom are required",
        400,
      );
    }
    const seq = String(vendorItems.length + 1).padStart(12, "0");
    const created: MockVendorItem = {
      id: `a1000001-0000-4000-8000-${seq}`,
      vendorId: params.vendorId as string,
      ingredientId: body.ingredientId,
      vendorSku: body.vendorSku ?? null,
      vendorDescription: body.vendorDescription ?? null,
      orderUom: body.orderUom,
      packDescription: body.packDescription ?? null,
      packQty: body.packQty,
      packUom: body.packUom,
      minOrderQty: body.minOrderQty ?? null,
      orderMultiple: body.orderMultiple ?? null,
      leadTimeDays: body.leadTimeDays ?? null,
      preferred: body.preferred ?? false,
      catchWeight: body.catchWeight ?? false,
      archivedAt: null,
    };
    vendorItems.push(created);
    if (body.initialUnitPricePaisa != null) {
      const priceSeq = String(vendorItemPrices.length + 1).padStart(12, "0");
      vendorItemPrices.push({
        id: `a2000001-0000-4000-8000-${priceSeq}`,
        vendorItemId: created.id,
        branchId: null,
        unitPricePaisa: body.initialUnitPricePaisa,
        priceUom: body.initialPriceUom ?? body.orderUom,
        effectiveFrom: body.initialPriceEffectiveFrom ?? new Date().toISOString(),
        effectiveTo: null,
        source: "manual",
        contractPrice: false,
      });
    }
    return ok(toVendorItemDto(created));
  }),

  // Update a catalog row's pack/UOM/MOQ/lead-time fields — no ingredient reference here (immutable
  // once set) and no price field (price changes go exclusively through the /prices endpoint below).
  http.put("*/api/v1/purchasing/vendor-items/:id", async ({ params, request }) => {
    const idx = vendorItems.findIndex((v) => v.id === params.id);
    if (idx === -1) return apiError("NOT_FOUND", "Vendor item not found", 404);
    const body = (await request.json()) as Partial<MockVendorItem>;
    vendorItems[idx] = { ...vendorItems[idx]!, ...body, id: vendorItems[idx]!.id, vendorId: vendorItems[idx]!.vendorId };
    return ok(toVendorItemDto(vendorItems[idx]!));
  }),

  // Archive a catalog row — a POST sub-resource, never a DELETE. Price history is untouched.
  http.post("*/api/v1/purchasing/vendor-items/:id/archive", ({ params }) => {
    const idx = vendorItems.findIndex((v) => v.id === params.id);
    if (idx === -1) return apiError("NOT_FOUND", "Vendor item not found", 404);
    vendorItems[idx] = { ...vendorItems[idx]!, archivedAt: new Date().toISOString() };
    return ok(toVendorItemDto(vendorItems[idx]!));
  }),

  http.get("*/api/v1/purchasing/vendor-items/:id/prices", ({ params }) =>
    ok(vendorItemPrices.filter((p) => p.vendorItemId === params.id)),
  ),

  /**
   * Record a new price. This handler APPENDS a new row and closes the prior open row's
   * `effectiveTo` — it never overwrites a prior row's `unitPricePaisa`, mirroring
   * `VendorItemPriceService.recordNewPrice` exactly. There is no corresponding update-price
   * handler anywhere in this file.
   */
  http.post("*/api/v1/purchasing/vendor-items/:id/prices", async ({ params, request }) => {
    const vendorItemId = params.id as string;
    if (!vendorItems.some((v) => v.id === vendorItemId)) {
      return apiError("NOT_FOUND", "Vendor item not found", 404);
    }
    const body = (await request.json()) as {
      unitPricePaisa: number;
      priceUom: string;
      effectiveFrom?: string;
      branchId?: string;
      contractPrice?: boolean;
      source?: string;
    };
    if (body.unitPricePaisa == null || !body.priceUom?.trim()) {
      return apiError("VALIDATION_ERROR", "unitPricePaisa and priceUom are required", 400);
    }
    const effectiveFrom = body.effectiveFrom ?? new Date().toISOString();
    const openRow = vendorItemPrices.find((p) => p.vendorItemId === vendorItemId && p.effectiveTo === null);
    if (openRow) openRow.effectiveTo = effectiveFrom;
    const seq = String(vendorItemPrices.length + 1).padStart(12, "0");
    const created: MockVendorItemPrice = {
      id: `a2000001-0000-4000-8000-${seq}`,
      vendorItemId,
      branchId: body.branchId ?? null,
      unitPricePaisa: body.unitPricePaisa,
      priceUom: body.priceUom,
      effectiveFrom,
      effectiveTo: null,
      source: body.source ?? "manual",
      contractPrice: body.contractPrice ?? false,
    };
    vendorItemPrices.push(created);
    return ok(created);
  }),

  // PUR-05/PUR-07: chronological price-change report with HALF_UP-style percentage deltas.
  http.get("*/api/v1/purchasing/vendors/:vendorId/price-changes", ({ params }) => {
    const itemIds = new Set(vendorItems.filter((v) => v.vendorId === params.vendorId).map((v) => v.id));
    const rows = vendorItemPrices
      .filter((p) => itemIds.has(p.vendorItemId))
      .sort((a, b) => new Date(a.effectiveFrom).getTime() - new Date(b.effectiveFrom).getTime());
    const changes = rows.map((row, idx) => {
      const item = vendorItems.find((v) => v.id === row.vendorItemId);
      const previous = rows
        .slice(0, idx)
        .reverse()
        .find((r) => r.vendorItemId === row.vendorItemId);
      const deltaPct = previous
        ? Number((((row.unitPricePaisa - previous.unitPricePaisa) / previous.unitPricePaisa) * 100).toFixed(2))
        : null;
      return {
        vendorItemId: row.vendorItemId,
        vendorSku: item?.vendorSku ?? null,
        vendorDescription: item?.vendorDescription ?? null,
        previousUnitPricePaisa: previous?.unitPricePaisa ?? null,
        newUnitPricePaisa: row.unitPricePaisa,
        deltaPct,
        effectiveFrom: row.effectiveFrom,
      };
    });
    return ok(changes);
  }),

  // Filter/suggestion tags only — never consulted by any authorization decision.
  http.get("*/api/v1/purchasing/vendors/:vendorId/categories", ({ params }) =>
    ok(vendorCategoriesByVendor[params.vendorId as string] ?? []),
  ),

  http.put("*/api/v1/purchasing/vendors/:vendorId/categories", async ({ params, request }) => {
    const categories = (await request.json()) as MockVendorCategory[];
    vendorCategoriesByVendor[params.vendorId as string] = categories;
    return ok(categories);
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

  /**
   * 10-12/08.2-10 (PUR-08): create a DRAFT PO. Each line supplies EITHER `vendorItemId`
   * (catalog-driven — `ingredientId`/`uom`/`unitPricePaisa` are derived from the vendor's active
   * catalog) or the legacy `ingredientId`+`uom`+`unitPricePaisa`. A `vendorItemId` unknown to this
   * mock, archived, or belonging to a different vendor is rejected 422 — mirroring
   * `PurchaseOrderService.create()`'s real cross-vendor/archived/unknown rejection, all
   * indistinguishably. `qty * unitPricePaisa` (rounded) becomes each line's total; the PO total is
   * the sum of line totals.
   */
  http.post("*/api/v1/purchasing/purchase-orders", async ({ request }) => {
    const body = (await request.json()) as CreatePoBody;
    if (!body.vendorId || !body.branchId || !body.lines?.length) {
      return apiError("VALIDATION_ERROR", "vendorId, branchId and at least one line are required", 400);
    }

    const lines: MockPoLine[] = [];
    for (let idx = 0; idx < body.lines.length; idx += 1) {
      const l = body.lines[idx]!;
      if (!l.vendorItemId && !l.ingredientId) {
        return apiError(
          "VALIDATION_ERROR",
          "Each line must supply either vendorItemId or ingredientId",
          400,
        );
      }

      if (l.vendorItemId) {
        const catalogItem = vendorItems.find((v) => v.id === l.vendorItemId);
        if (!catalogItem || catalogItem.vendorId !== body.vendorId || catalogItem.archivedAt) {
          return apiError(
            "VENDOR_ITEM_CATALOG_MISMATCH",
            "The referenced catalog item is unknown, archived, or belongs to a different vendor",
            422,
          );
        }
        const currentPrice = currentPriceFor(catalogItem.id);
        const unitPricePaisa = l.unitPricePaisa ?? currentPrice?.unitPricePaisa ?? 0;
        const priceOverridden =
          l.unitPricePaisa != null &&
          currentPrice != null &&
          l.unitPricePaisa !== currentPrice.unitPricePaisa;
        lines.push({
          id: `e0000002-0000-4000-8000-${String(idx + 1).padStart(12, "0")}`,
          ingredientId: catalogItem.ingredientId,
          qty: l.qty,
          uom: l.uom ?? catalogItem.orderUom,
          unitPricePaisa,
          lineTotalPaisa: Math.round(Number(l.qty) * unitPricePaisa),
          vendorItemId: catalogItem.id,
          vendorSku: catalogItem.vendorSku,
          packDescription: catalogItem.packDescription,
          priceOverridden,
        });
      } else {
        const unitPricePaisa = l.unitPricePaisa ?? 0;
        lines.push({
          id: `e0000002-0000-4000-8000-${String(idx + 1).padStart(12, "0")}`,
          ingredientId: l.ingredientId!,
          qty: l.qty,
          uom: l.uom ?? "",
          unitPricePaisa,
          lineTotalPaisa: Math.round(Number(l.qty) * unitPricePaisa),
          vendorItemId: null,
          vendorSku: null,
          packDescription: null,
          priceOverridden: false,
        });
      }
    }

    const seq = String(purchaseOrders.length + 1).padStart(12, "0");
    const id = `d0000002-0000-4000-8000-${seq}`;
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
      totalPaisa: 150_000,
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
        {
          id: LINE_ID_2,
          ingredientId: ING_2,
          qty: "50",
          uom: "kg",
          unitPricePaisa: 1000,
          lineTotalPaisa: 50_000,
        },
      ],
    });
  }),

  // 10-12 gap closure: per-line receipt. `receivedByLine` is the regression pin for the bug this
  // plan fixes — the OLD handler read only `body.lines[0]` and broadcast it to every line; this
  // one honours each `{poLineId, receivedQty}` pair independently, so line 1 can be received in
  // full while line 2 is only partially received (-> PARTIALLY_RECEIVED, not FULLY_RECEIVED).
  http.post("*/api/v1/purchasing/purchase-orders/:poId/mock-receive", async ({ params, request }) => {
    const body = (await request.json()) as { lines: { poLineId: string; receivedQty: string }[] };
    const orderedQty: Record<string, string> = { [LINE_ID]: "100", [LINE_ID_2]: "50" };
    for (const line of body.lines) {
      receivedByLine[line.poLineId] = line.receivedQty;
    }
    grnQty = body.lines[0]?.receivedQty ?? "0";
    const allFull = Object.entries(orderedQty).every(
      ([lineId, ordered]) => Number(receivedByLine[lineId] ?? "0") >= Number(ordered),
    );
    const anyReceived = Object.values(receivedByLine).some((q) => Number(q) > 0);
    poStatus = allFull ? "FULLY_RECEIVED" : anyReceived ? "PARTIALLY_RECEIVED" : poStatus;
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
      totalPaisa: 150_000,
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
        {
          id: LINE_ID_2,
          ingredientId: ING_2,
          qty: "50",
          uom: "kg",
          unitPricePaisa: 1000,
          lineTotalPaisa: 50_000,
        },
      ],
    });
  }),

  // 10-13: branch-scoped invoice list, optionally narrowed by ?status=. Mirrors the PO list
  // handler's shape (10-10's non-paginated ApiResponse<List<Dto>> contract).
  http.get("*/api/v1/purchasing/invoices", ({ request }) => {
    const url = new URL(request.url);
    const statuses = url.searchParams.getAll("status");
    const rows = statuses.length > 0 ? invoices.filter((i) => statuses.includes(i.status)) : invoices;
    return ok(rows);
  }),

  // 10-13: book a vendor invoice against a PO. Mirrors VendorInvoiceService.create exactly —
  // vendorId/branchId are derived from the PO (never sent by the client), and each line's
  // matchStatus is computed via matchLineStatus() (the same 2%/5%/10% tolerance as the real
  // ThreeWayMatchService, not an invented one), which then determines the invoice-level
  // MATCHED/MISMATCHED status the same way VendorInvoiceService.runMatch does.
  http.post("*/api/v1/purchasing/invoices", async ({ request }) => {
    const body = (await request.json()) as {
      purchaseOrderId: string;
      invoiceNo: string;
      invoiceDate: string;
      inputTaxPaisa?: number;
      lines: { poLineId: string; qty: string; unitPricePaisa: number }[];
    };
    const po = findPo(body.purchaseOrderId);
    if (!po) return apiError("NOT_FOUND", "Purchase order not found", 404);
    if (!["SENT", "PARTIALLY_RECEIVED", "FULLY_RECEIVED"].includes(po.id === PO_ID ? poStatus : po.status)) {
      return apiError("INVALID_PO_STATE", "PO must be sent before invoicing", 409);
    }

    const seq = String(invoices.length + 1).padStart(12, "0");
    const id = `f0000001-0000-4000-8000-${seq}`;
    let allOk = true;
    const lines: MockInvoiceLine[] = body.lines.map((l, idx) => {
      const poLine = po.lines.find((pl) => pl.id === l.poLineId);
      const received = Number(receivedByLine[l.poLineId] ?? "0");
      const invQty = Number(l.qty);
      const poPrice = poLine?.unitPricePaisa ?? 0;
      const matchStatus = matchLineStatus(received, invQty, poPrice, l.unitPricePaisa);
      if (matchStatus !== "OK") allOk = false;
      return {
        id: `g0000002-0000-4000-8000-${String(idx + 1).padStart(12, "0")}`,
        poLineId: l.poLineId,
        qty: l.qty,
        unitPricePaisa: l.unitPricePaisa,
        lineTotalPaisa: Math.round(invQty * l.unitPricePaisa),
        matchStatus,
        grnQty: String(received),
        poQty: poLine?.qty ?? "0",
        poUnitPricePaisa: poPrice,
      };
    });
    const inputTaxPaisa = body.inputTaxPaisa ?? 0;
    const invoice: MockInvoice = {
      id,
      vendorId: po.vendorId,
      purchaseOrderId: po.id,
      branchId: po.branchId,
      invoiceNo: body.invoiceNo,
      invoiceDate: body.invoiceDate,
      status: allOk ? "MATCHED" : "MISMATCHED",
      totalPaisa: lines.reduce((sum, l) => sum + l.lineTotalPaisa, 0),
      inputTaxPaisa,
      matchOverrideReason: null,
      lines,
    };
    invoices.push(invoice);
    return ok(invoice);
  }),

  // 10-13: MISMATCHED -> APPROVED_FOR_PAYMENT with a mandatory justification, mirroring
  // VendorInvoiceService.overrideMatch's state guard.
  http.post("*/api/v1/purchasing/invoices/:id/override-match", async ({ params, request }) => {
    const invoice = invoices.find((i) => i.id === params.id);
    if (!invoice) return apiError("NOT_FOUND", "Invoice not found", 404);
    const body = (await request.json().catch(() => ({}))) as { justification?: string };
    if (!body.justification || !body.justification.trim()) {
      return apiError("VALIDATION_ERROR", "Override justification required", 400);
    }
    if (invoice.status !== "MISMATCHED") {
      return apiError("INVALID_PO_STATE", "Only MISMATCHED invoices can be overridden", 409);
    }
    invoice.matchOverrideReason = body.justification;
    invoice.status = "APPROVED_FOR_PAYMENT";
    return ok(invoice);
  }),

  http.get("*/api/v1/purchasing/invoices/:id", ({ params }) =>
    ok(invoices.find((i) => i.id === params.id) ?? invoices[0]),
  ),

  // 10-13: first mock consumer of POST /payments — pays a MATCHED/APPROVED_FOR_PAYMENT invoice,
  // flips it to PAID, and records the AP payment (mirroring ApPaymentService.create). No
  // GET /payments list handler exists because the real backend has none (ApPaymentController is
  // POST-only) — the payments page reads the invoice list instead.
  http.post("*/api/v1/purchasing/payments", async ({ request }) => {
    const body = (await request.json()) as {
      invoiceId: string;
      paymentDate: string;
      amountPaisa?: number;
      bankAccountCode?: string;
    };
    const invoice = invoices.find((i) => i.id === body.invoiceId);
    if (!invoice) return apiError("NOT_FOUND", "Invoice not found", 404);
    if (invoice.status !== "MATCHED" && invoice.status !== "APPROVED_FOR_PAYMENT") {
      return apiError("INVALID_PO_STATE", "Invoice must be matched before payment", 409);
    }
    const payAmount = body.amountPaisa ?? invoice.totalPaisa + invoice.inputTaxPaisa;
    const seq = String(apPayments.length + 1).padStart(12, "0");
    const payment: MockApPayment = {
      id: `f0000003-0000-4000-8000-${seq}`,
      vendorId: invoice.vendorId,
      branchId: invoice.branchId,
      paymentDate: body.paymentDate,
      amountPaisa: payAmount,
      bankAccountCode: body.bankAccountCode ?? "1110",
      allocations: [{ invoiceId: invoice.id, amountPaisa: payAmount }],
    };
    apPayments.push(payment);
    invoice.status = "PAID";
    return ok(payment);
  }),

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
