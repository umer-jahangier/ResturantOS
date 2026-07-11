import { get, post } from "@/lib/api-client/request";
import {
  apiPurchaseOrderSchema,
  apiVendorInvoiceSchema,
  apiVendorSchema,
} from "@/lib/api-client/schemas/purchasing.schema";
import {
  adaptPurchaseOrder,
  adaptVendor,
  adaptVendorInvoice,
} from "@/lib/adapters/purchasing.adapter";
import type { PurchaseOrder, Vendor, VendorInvoice } from "@/lib/adapters/purchasing.adapter";

export const PurchasingRepository = {
  async listVendors(): Promise<Vendor[]> {
    const raw = await get<unknown[]>("/api/v1/purchasing/vendors");
    return (raw ?? []).map((v) => adaptVendor(apiVendorSchema.parse(v)));
  },

  async getPurchaseOrder(id: string): Promise<PurchaseOrder> {
    const raw = await get(`/api/v1/purchasing/purchase-orders/${id}`);
    return adaptPurchaseOrder(apiPurchaseOrderSchema.parse(raw));
  },

  async mockReceive(poId: string, lines: { poLineId: string; receivedQty: string }[]): Promise<void> {
    await post(`/api/v1/purchasing/purchase-orders/${poId}/mock-receive`, { lines });
  },

  async createInvoice(body: unknown): Promise<VendorInvoice> {
    const raw = await post("/api/v1/purchasing/invoices", body);
    return adaptVendorInvoice(apiVendorInvoiceSchema.parse(raw));
  },

  async getInvoice(id: string): Promise<VendorInvoice> {
    const raw = await get(`/api/v1/purchasing/invoices/${id}`);
    return adaptVendorInvoice(apiVendorInvoiceSchema.parse(raw));
  },
};
