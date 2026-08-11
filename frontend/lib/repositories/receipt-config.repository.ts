import { get, put } from "@/lib/api-client/request";
import {
  apiReceiptConfigResponseSchema,
  apiReceiptConfigSchema,
} from "@/lib/api-client/schemas/receipt-config.schema";
import {
  adaptReceiptConfigResponse,
  toReceiptConfigWire,
} from "@/lib/adapters/receipt-config.adapter";
import type { ReceiptConfig, ReceiptConfigView } from "@/lib/models/receipt-config.model";

/**
 * The branch printer registry (Phase 26, plan 26-02).
 *
 * <p><b>Where this lives on the server.</b> `branches.receipt_config`, the jsonb column that
 * already existed, reached through user-service's `ReceiptConfigService`. Nothing else in Phase 26
 * touches that column. When Phase 17's tenant-configuration spine lands, the migration repoints
 * this repository and the service behind it — two files, not a search across the fleet.
 *
 * <p><b>Authority.</b> Both endpoints are gated on `rbac.manage | branch.manage`, the same
 * expression a branch write carries. A cashier's session cannot call either.
 *
 * <p><b>What this repository will NOT do.</b> It has no method that turns a failure into an empty
 * configuration. A caller that wants that has to write it themselves, in the open, where a reader
 * can see the decision.
 */
export const ReceiptConfigRepository = {
  /** `GET /api/v1/branches/{id}/receipt-config`. */
  async get(branchId: string): Promise<ReceiptConfigView> {
    const raw = await get<unknown>(`/api/v1/branches/${branchId}/receipt-config`);
    return adaptReceiptConfigResponse(apiReceiptConfigResponseSchema.parse(raw));
  },

  /**
   * `PUT /api/v1/branches/{id}/receipt-config` — a full replacement, not a patch.
   *
   * <p>The request body is `.parse()`d on the way out so a stray key never reaches the wire: the
   * server rejects a malformed registry with a 400 naming the field, and that round-trip is the
   * right one to spend on a real mistake, not on a field the form invented.
   */
  async save(branchId: string, config: ReceiptConfig): Promise<ReceiptConfigView> {
    const body = apiReceiptConfigSchema.parse(toReceiptConfigWire(config));
    const raw = await put<unknown, unknown>(`/api/v1/branches/${branchId}/receipt-config`, body);
    return adaptReceiptConfigResponse(apiReceiptConfigResponseSchema.parse(raw));
  },
};
