import { get, post } from "@/lib/api-client/request";
import {
  apiCreateCustomerSchema,
  apiCustomerPageSchema,
  apiCustomerSummarySchema,
  apiPromotionSchema,
} from "@/lib/api-client/schemas/crm.schema";
import { adaptCustomer, adaptPromotion } from "@/lib/adapters/crm.adapter";
import type { CreateCustomerPayload, Customer, Promotion } from "@/lib/models/crm.model";
import { z } from "zod";

export const CrmRepository = {
  /**
   * GET /api/v1/crm/customers/search — one endpoint for the CRM grid AND the POS picker, so a
   * cashier attaching a customer to an order needs only `crm.customer.view`.
   */
  async searchCustomers(q: string, size = 20): Promise<Customer[]> {
    const raw = await get<unknown>("/api/v1/crm/customers/search", { q, size });
    return apiCustomerPageSchema.parse(raw).content.map(adaptCustomer);
  },

  async getCustomer(id: string): Promise<Customer> {
    const raw = await get<unknown>(`/api/v1/crm/customers/${id}/detail`);
    return adaptCustomer(apiCustomerSummarySchema.parse(raw));
  },

  async createCustomer(payload: CreateCustomerPayload): Promise<Customer> {
    const body = apiCreateCustomerSchema.parse(payload);
    const raw = await post<unknown, unknown>("/api/v1/crm/customers", body);
    // POST returns the bare customer (no loyalty account exists yet on create).
    return adaptCustomer(
      apiCustomerSummarySchema.parse({
        pointsBalance: 0,
        lifetimeSpendPaisa: 0,
        ...(raw as object),
      }),
    );
  },

  async listPromotions(): Promise<Promotion[]> {
    const raw = await get<unknown>("/api/v1/crm/promotions");
    return z.array(apiPromotionSchema).parse(raw).map(adaptPromotion);
  },
};
