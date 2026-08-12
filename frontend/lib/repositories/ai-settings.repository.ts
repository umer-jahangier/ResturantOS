import { del, get, put } from "@/lib/api-client/request";
import {
  apiAiSettingsSchema,
  updateAiSettingsInputSchema,
  type UpdateAiSettingsInput,
} from "@/lib/api-client/schemas/ai-settings.schema";
import { adaptAiSettings } from "@/lib/adapters/ai-settings.adapter";
import type { AiSettings } from "@/lib/models/ai-settings.model";

/**
 * Layer-2 repository for a tenant's AI provider + API key (Program C).
 *
 * <h3>One permission for all three verbs</h3>
 *
 * `nlq.settings.manage` (auth changeset 094) gates read, replace and clear alike — unlike the
 * service-charge screen, which splits `pos.menu.view` from `pos.service_charge.manage`. The split
 * exists there because a MANAGER must be able to look up a number printed on every guest's bill.
 * Nothing here is on a bill: the screen shows a provider, a key state and four characters of a
 * credential, so read access buys a manager nothing and widens who can see the billing posture.
 *
 * <h3>The key goes out and never comes back</h3>
 *
 * `update` sends a key. NOTHING in this file receives one — `apiAiSettingsSchema` is `.strict()`
 * and has no key field, so a server that ever started echoing one back would make `.parse()`
 * THROW here rather than pass the credential into the render tree. "Replace" is a fresh PUT;
 * there is deliberately no reveal call to write.
 */
export const AiSettingsRepository = {
  async get(): Promise<AiSettings> {
    const raw = await get<unknown>("/api/v1/nlq/settings/ai");
    return adaptAiSettings(apiAiSettingsSchema.parse(raw));
  },

  /**
   * Stores a new key. The server probes the provider before committing: a key the provider
   * REFUSES comes back as a 400 with `AI_CREDENTIAL_REJECTED` and nothing is saved, while a
   * provider outage saves the key as UNVERIFIED rather than blocking it.
   */
  async update(input: UpdateAiSettingsInput): Promise<AiSettings> {
    const body = updateAiSettingsInputSchema.parse(input);
    const raw = await put<typeof body, unknown>("/api/v1/nlq/settings/ai", body);
    return adaptAiSettings(apiAiSettingsSchema.parse(raw));
  },

  /** Removes the tenant's key and reverts to the platform's. Idempotent — never a 404. */
  async clear(): Promise<AiSettings> {
    const raw = await del<unknown>("/api/v1/nlq/settings/ai");
    return adaptAiSettings(apiAiSettingsSchema.parse(raw));
  },
};
