import { get, getPaginated, post, put, type PaginatedResult } from "@/lib/api-client/request";
import {
  apiOrderSuggestionsResponseSchema,
  createDraftsFromSuggestionsInputSchema,
  apiApPaymentSchema,
  apiBankAccountSchema,
  apiPurchaseOrderSchema,
  apiSpendAnalyticsSchema,
  apiVendorCategorySchema,
  apiVendorInvoiceSchema,
  apiVendorItemPriceChangeSchema,
  apiVendorItemPriceSchema,
  apiVendorItemSchema,
  apiVendorScorecardSchema,
  apiVendorSchema,
  createApPaymentInputSchema,
  createPurchaseOrderInputSchema,
  createVendorInvoiceInputSchema,
  createVendorItemInputSchema,
  overrideMatchInputSchema,
  recordVendorItemPriceInputSchema,
  rejectPoInputSchema,
  updateVendorItemInputSchema,
  vendorCategoriesInputSchema,
  vendorInputSchema,
  type InvoiceStatus,
  type PoStatus,
} from "@/lib/api-client/schemas/purchasing.schema";
import {
  adaptOrderSuggestionsResponse,
  adaptApPayment,
  adaptPurchaseOrder,
  adaptSpendAnalytics,
  adaptVendor,
  adaptVendorCategory,
  adaptVendorInvoice,
  adaptVendorItem,
  adaptVendorItemPrice,
  adaptVendorItemPriceChange,
  adaptVendorScorecard,
} from "@/lib/adapters/purchasing.adapter";
import type {
  CreateDraftsFromSuggestionsInput,
  OrderSuggestionsResponse,
  ApPayment,
  ApPaymentInput,
  BankAccount,
  PurchaseOrder,
  PurchaseOrderInput,
  SpendAnalytics,
  UpdateVendorItemInput,
  Vendor,
  VendorCategoriesInput,
  VendorCategory,
  VendorInput,
  VendorInvoice,
  VendorInvoiceInput,
  VendorItem,
  VendorItemInput,
  VendorItemPrice,
  VendorItemPriceChange,
  VendorItemPriceInput,
  VendorScorecard,
} from "@/lib/adapters/purchasing.adapter";

export const PurchasingRepository = {
  async listVendors(): Promise<Vendor[]> {
    const raw = await get<unknown[]>("/api/v1/purchasing/vendors");
    return (raw ?? []).map((v) => adaptVendor(apiVendorSchema.parse(v)));
  },

  async createVendor(input: VendorInput): Promise<Vendor> {
    const raw = await post("/api/v1/purchasing/vendors", vendorInputSchema.parse(input));
    return adaptVendor(apiVendorSchema.parse(raw));
  },

  async updateVendor(id: string, input: VendorInput): Promise<Vendor> {
    const raw = await put(`/api/v1/purchasing/vendors/${id}`, vendorInputSchema.parse(input));
    return adaptVendor(apiVendorSchema.parse(raw));
  },

  // ── Vendor item catalog (PUR-07) ────────────────────────────────────────────────────────
  /** Paginated GET — mirrors VendorItemController#list (default page=0, size=20). */
  async listVendorItems(vendorId: string, page = 0, size = 20): Promise<PaginatedResult<VendorItem>> {
    const result = await getPaginated<unknown>(`/api/v1/purchasing/vendors/${vendorId}/items`, {
      page,
      size,
    });
    return {
      data: result.data.map((v) => adaptVendorItem(apiVendorItemSchema.parse(v))),
      meta: result.meta,
    };
  },

  async createVendorItem(vendorId: string, input: VendorItemInput): Promise<VendorItem> {
    const raw = await post(
      `/api/v1/purchasing/vendors/${vendorId}/items`,
      createVendorItemInputSchema.parse(input),
    );
    return adaptVendorItem(apiVendorItemSchema.parse(raw));
  },

  /** No ingredientId here — the catalog row's ingredient reference is immutable once set. */
  async updateVendorItem(vendorItemId: string, input: UpdateVendorItemInput): Promise<VendorItem> {
    const raw = await put(
      `/api/v1/purchasing/vendor-items/${vendorItemId}`,
      updateVendorItemInputSchema.parse(input),
    );
    return adaptVendorItem(apiVendorItemSchema.parse(raw));
  },

  /** Archive is a POST sub-resource — this catalog never issues an HTTP DELETE. */
  async archiveVendorItem(vendorItemId: string): Promise<VendorItem> {
    const raw = await post(`/api/v1/purchasing/vendor-items/${vendorItemId}/archive`);
    return adaptVendorItem(apiVendorItemSchema.parse(raw));
  },

  async listVendorItemPrices(vendorItemId: string): Promise<VendorItemPrice[]> {
    const raw = await get<unknown[]>(`/api/v1/purchasing/vendor-items/${vendorItemId}/prices`);
    return (raw ?? []).map((p) => adaptVendorItemPrice(apiVendorItemPriceSchema.parse(p)));
  },

  /**
   * The ONLY write to a vendor item's price. This repository has no method that edits a
   * previously recorded price in place — recording a price is always a create, mirroring the
   * backend's append-only `VendorItemPriceService.recordNewPrice` (T-08.2-131).
   */
  async recordVendorItemPrice(vendorItemId: string, input: VendorItemPriceInput): Promise<VendorItemPrice> {
    const raw = await post(
      `/api/v1/purchasing/vendor-items/${vendorItemId}/prices`,
      recordVendorItemPriceInputSchema.parse(input),
    );
    return adaptVendorItemPrice(apiVendorItemPriceSchema.parse(raw));
  },

  async listVendorPriceChanges(vendorId: string, since?: string): Promise<VendorItemPriceChange[]> {
    const raw = await get<unknown[]>(`/api/v1/purchasing/vendors/${vendorId}/price-changes`, { since });
    return (raw ?? []).map((c) => adaptVendorItemPriceChange(apiVendorItemPriceChangeSchema.parse(c)));
  },

  async listVendorCategories(vendorId: string): Promise<VendorCategory[]> {
    const raw = await get<unknown[]>(`/api/v1/purchasing/vendors/${vendorId}/categories`);
    return (raw ?? []).map((c) => adaptVendorCategory(apiVendorCategorySchema.parse(c)));
  },

  /** The controller takes the replacement set directly as a JSON array body, no wrapper object. */
  async replaceVendorCategories(vendorId: string, input: VendorCategoriesInput): Promise<VendorCategory[]> {
    const raw = await put<unknown, unknown[]>(
      `/api/v1/purchasing/vendors/${vendorId}/categories`,
      vendorCategoriesInputSchema.parse(input),
    );
    return (raw ?? []).map((c) => adaptVendorCategory(apiVendorCategorySchema.parse(c)));
  },

  /** 10-10: branch-scoped PO list, optionally narrowed by status. Tenant is server-resolved. */
  async listPurchaseOrders(branchId: string, status?: PoStatus[]): Promise<PurchaseOrder[]> {
    const params: Record<string, unknown> = { branchId };
    if (status && status.length > 0) params.status = status;
    const raw = await get<unknown[]>("/api/v1/purchasing/purchase-orders", params);
    return (raw ?? []).map((po) => adaptPurchaseOrder(apiPurchaseOrderSchema.parse(po)));
  },

  async createPurchaseOrder(input: PurchaseOrderInput): Promise<PurchaseOrder> {
    const raw = await post(
      "/api/v1/purchasing/purchase-orders",
      createPurchaseOrderInputSchema.parse(input),
    );
    return adaptPurchaseOrder(apiPurchaseOrderSchema.parse(raw));
  },

  async submitPurchaseOrder(id: string): Promise<PurchaseOrder> {
    const raw = await post(`/api/v1/purchasing/purchase-orders/${id}/submit`, {});
    return adaptPurchaseOrder(apiPurchaseOrderSchema.parse(raw));
  },

  async withdrawPurchaseOrder(id: string): Promise<PurchaseOrder> {
    const raw = await post(`/api/v1/purchasing/purchase-orders/${id}/withdraw`, {});
    return adaptPurchaseOrder(apiPurchaseOrderSchema.parse(raw));
  },

  async approvePurchaseOrder(id: string): Promise<PurchaseOrder> {
    const raw = await post(`/api/v1/purchasing/purchase-orders/${id}/approve`, {});
    return adaptPurchaseOrder(apiPurchaseOrderSchema.parse(raw));
  },

  async rejectPurchaseOrder(id: string, reason: string): Promise<PurchaseOrder> {
    const raw = await post(
      `/api/v1/purchasing/purchase-orders/${id}/reject`,
      rejectPoInputSchema.parse({ reason }),
    );
    return adaptPurchaseOrder(apiPurchaseOrderSchema.parse(raw));
  },

  async sendPurchaseOrder(id: string): Promise<PurchaseOrder> {
    const raw = await post(`/api/v1/purchasing/purchase-orders/${id}/send`, {});
    return adaptPurchaseOrder(apiPurchaseOrderSchema.parse(raw));
  },

  async getPurchaseOrder(id: string): Promise<PurchaseOrder> {
    const raw = await get(`/api/v1/purchasing/purchase-orders/${id}`);
    return adaptPurchaseOrder(apiPurchaseOrderSchema.parse(raw));
  },

  async mockReceive(poId: string, lines: { poLineId: string; receivedQty: string }[]): Promise<void> {
    await post(`/api/v1/purchasing/purchase-orders/${poId}/mock-receive`, { lines });
  },

  async closePurchaseOrder(poId: string, reason?: string): Promise<PurchaseOrder> {
    const raw = await post(`/api/v1/purchasing/purchase-orders/${poId}/close`, { reason: reason ?? null });
    return adaptPurchaseOrder(apiPurchaseOrderSchema.parse(raw));
  },

  /** 10-10: branch-scoped invoice list, optionally narrowed by status. Tenant is server-resolved. */
  async listInvoices(branchId: string, status?: InvoiceStatus[]): Promise<VendorInvoice[]> {
    const params: Record<string, unknown> = { branchId };
    if (status && status.length > 0) params.status = status;
    const raw = await get<unknown[]>("/api/v1/purchasing/invoices", params);
    return (raw ?? []).map((inv) => adaptVendorInvoice(apiVendorInvoiceSchema.parse(inv)));
  },

  /**
   * Book a vendor invoice against a PO. TIGHTENED from `body: unknown` (dead-code signature, no
   * caller anywhere) to a real Zod-validated `VendorInvoiceInput` (10-13 gap closure) — the first
   * caller is `useCreateVendorInvoice`.
   */
  async createInvoice(input: VendorInvoiceInput): Promise<VendorInvoice> {
    const raw = await post("/api/v1/purchasing/invoices", createVendorInvoiceInputSchema.parse(input));
    return adaptVendorInvoice(apiVendorInvoiceSchema.parse(raw));
  },

  async getInvoice(id: string): Promise<VendorInvoice> {
    const raw = await get(`/api/v1/purchasing/invoices/${id}`);
    return adaptVendorInvoice(apiVendorInvoiceSchema.parse(raw));
  },

  /** Override a MISMATCHED invoice's failed 3-way match with a mandatory justification. */
  async overrideMatch(id: string, justification: string): Promise<VendorInvoice> {
    const raw = await post(
      `/api/v1/purchasing/invoices/${id}/override-match`,
      overrideMatchInputSchema.parse({ justification }),
    );
    return adaptVendorInvoice(apiVendorInvoiceSchema.parse(raw));
  },

  /**
   * First frontend consumer of `POST /api/v1/purchasing/payments` — posts AP -> Bank in finance
   * and publishes `AP_PAYMENT_PROCESSED` (ROADMAP SC#3). No `GET /payments` list endpoint exists
   * on the backend (`ApPaymentController` is POST-only) — the payments page is driven off the
   * invoice list (status MATCHED/APPROVED_FOR_PAYMENT/PAID), not a separate payments query.
   */
  async createApPayment(input: ApPaymentInput): Promise<ApPayment> {
    const raw = await post("/api/v1/purchasing/payments", createApPaymentInputSchema.parse(input));
    return adaptApPayment(apiApPaymentSchema.parse(raw));
  },

  /**
   * The accounts a payment can be paid from — a scoped proxy onto finance's chart of accounts,
   * gated on `vendor.payment.create` rather than `finance.coa.view`. Read directly from finance,
   * a MANAGER (who may pay) gets 403 and the picker is empty, which is why this endpoint exists.
   */
  async listBankAccounts(): Promise<BankAccount[]> {
    const raw = await get<unknown[]>("/api/v1/purchasing/bank-accounts");
    return (raw ?? []).map((a) => apiBankAccountSchema.parse(a));
  },

  async getSpendAnalytics(branchId: string, from: string, to: string): Promise<SpendAnalytics> {
    const raw = await get("/api/v1/purchasing/analytics/spend", { branchId, from, to });
    return adaptSpendAnalytics(apiSpendAnalyticsSchema.parse(raw));
  },

  async getVendorScorecard(vendorId: string, branchId: string): Promise<VendorScorecard> {
    const raw = await get("/api/v1/purchasing/analytics/scorecard", { vendorId, branchId });
    return adaptVendorScorecard(apiVendorScorecardSchema.parse(raw));
  },

  // ── Order suggestions ────────────────────────────────────────────────────────────────────
  /** What is below its reorder point at `branchId`, how much to buy, and from whom. */
  async getOrderSuggestions(branchId: string): Promise<OrderSuggestionsResponse> {
    const raw = await get("/api/v1/purchasing/order-suggestions", { branchId });
    return adaptOrderSuggestionsResponse(apiOrderSuggestionsResponseSchema.parse(raw));
  },

  /** Turns the accepted lines into one DRAFT purchase order per vendor. */
  async createDraftsFromSuggestions(
    input: CreateDraftsFromSuggestionsInput,
  ): Promise<PurchaseOrder[]> {
    const raw = await post(
      "/api/v1/purchasing/order-suggestions/drafts",
      createDraftsFromSuggestionsInputSchema.parse(input),
    );
    return ((raw ?? []) as unknown[]).map((po) =>
      adaptPurchaseOrder(apiPurchaseOrderSchema.parse(po)),
    );
  },
};
