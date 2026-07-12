import { get, post, put } from "@/lib/api-client/request";
import {
  apiPurchaseOrderSchema,
  apiSpendAnalyticsSchema,
  apiVendorInvoiceSchema,
  apiVendorScorecardSchema,
  apiVendorSchema,
  vendorInputSchema,
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
