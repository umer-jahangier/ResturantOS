import { get, post, put } from "@/lib/api-client/request";
import {
  apiApPaymentSchema,
  apiPurchaseOrderSchema,
  apiSpendAnalyticsSchema,
  apiVendorInvoiceSchema,
  apiVendorScorecardSchema,
  apiVendorSchema,
  createApPaymentInputSchema,
  createPurchaseOrderInputSchema,
  createVendorInvoiceInputSchema,
  overrideMatchInputSchema,
  rejectPoInputSchema,
  vendorInputSchema,
  type InvoiceStatus,
  type PoStatus,
} from "@/lib/api-client/schemas/purchasing.schema";
import {
  adaptApPayment,
  adaptPurchaseOrder,
  adaptSpendAnalytics,
  adaptVendor,
  adaptVendorInvoice,
  adaptVendorScorecard,
} from "@/lib/adapters/purchasing.adapter";
import type {
  ApPayment,
  ApPaymentInput,
  PurchaseOrder,
  PurchaseOrderInput,
  SpendAnalytics,
  Vendor,
  VendorInput,
  VendorInvoice,
  VendorInvoiceInput,
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

  async getSpendAnalytics(branchId: string, from: string, to: string): Promise<SpendAnalytics> {
    const raw = await get("/api/v1/purchasing/analytics/spend", { branchId, from, to });
    return adaptSpendAnalytics(apiSpendAnalyticsSchema.parse(raw));
  },

  async getVendorScorecard(vendorId: string, branchId: string): Promise<VendorScorecard> {
    const raw = await get("/api/v1/purchasing/analytics/scorecard", { vendorId, branchId });
    return adaptVendorScorecard(apiVendorScorecardSchema.parse(raw));
  },
};
