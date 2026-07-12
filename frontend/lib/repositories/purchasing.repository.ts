import { get, post, put } from "@/lib/api-client/request";
import {
  apiPurchaseOrderSchema,
  apiSpendAnalyticsSchema,
  apiVendorInvoiceSchema,
  apiVendorScorecardSchema,
  apiVendorSchema,
  createPurchaseOrderInputSchema,
  rejectPoInputSchema,
  vendorInputSchema,
  type PoStatus,
} from "@/lib/api-client/schemas/purchasing.schema";
import {
  adaptPurchaseOrder,
  adaptSpendAnalytics,
  adaptVendor,
  adaptVendorInvoice,
  adaptVendorScorecard,
} from "@/lib/adapters/purchasing.adapter";
import type {
  PurchaseOrder,
  PurchaseOrderInput,
  SpendAnalytics,
  Vendor,
  VendorInput,
  VendorInvoice,
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

  async createInvoice(body: unknown): Promise<VendorInvoice> {
    const raw = await post("/api/v1/purchasing/invoices", body);
    return adaptVendorInvoice(apiVendorInvoiceSchema.parse(raw));
  },

  async getInvoice(id: string): Promise<VendorInvoice> {
    const raw = await get(`/api/v1/purchasing/invoices/${id}`);
    return adaptVendorInvoice(apiVendorInvoiceSchema.parse(raw));
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
