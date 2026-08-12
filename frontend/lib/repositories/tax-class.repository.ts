import { del, get, post, put } from "@/lib/api-client/request";
import {
  apiTaxClassSchema,
  createTaxClassInputSchema,
  updateTaxClassInputSchema,
  type CreateTaxClassInput,
  type UpdateTaxClassInput,
} from "@/lib/api-client/schemas/tax-class.schema";
import { adaptTaxClass } from "@/lib/adapters/tax-class.adapter";
import type { TaxClass } from "@/lib/models/tax-class.model";
import { z } from "zod";

/**
 * Layer-2 repository for the sales-tax catalogue (F16).
 *
 * <h3>The read and the writes carry different permissions on purpose</h3>
 *
 * `pos.menu.view` reads; `pos.tax.manage` writes. Classifying a dish is menu work a manager does
 * weekly; deciding that "standard rate" MEANS 17% is a statutory fact about the business that
 * mis-states the tax return rather than one bill. See auth changeset 091.
 *
 * <h3>Every write sends every field</h3>
 *
 * PUT is a REPLACE. `updateTaxClassInputSchema` requires `active` for the same reason
 * `updateMenuItemInputSchema` requires `taxRateCode`: wipe-by-omission has already happened once
 * in this codebase, on this exact subject matter.
 */
export const TaxClassRepository = {
  async list(): Promise<TaxClass[]> {
    const raw = await get<unknown>("/api/v1/pos/tax-classes");
    return z.array(apiTaxClassSchema).parse(raw).map(adaptTaxClass);
  },

  async create(input: CreateTaxClassInput): Promise<TaxClass> {
    const body = createTaxClassInputSchema.parse(input);
    const raw = await post<typeof body, unknown>("/api/v1/pos/tax-classes", body);
    return adaptTaxClass(apiTaxClassSchema.parse(raw));
  },

  async update(id: string, input: UpdateTaxClassInput): Promise<TaxClass> {
    const body = updateTaxClassInputSchema.parse(input);
    const raw = await put<typeof body, unknown>(
      `/api/v1/pos/tax-classes/${encodeURIComponent(id)}`,
      body,
    );
    return adaptTaxClass(apiTaxClassSchema.parse(raw));
  },

  /**
   * Refused by the server with `TAX_CLASS_IN_USE` while any category or item still names it —
   * the message counts them. Deactivating is the supported way to retire a rate that is in use.
   */
  async remove(id: string): Promise<void> {
    await del<void>(`/api/v1/pos/tax-classes/${encodeURIComponent(id)}`);
  },
};
