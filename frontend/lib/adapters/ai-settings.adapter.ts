import type { ApiAiSettings } from "@/lib/api-client/schemas/ai-settings.schema";
import type { AiSettings } from "@/lib/models/ai-settings.model";

/**
 * Wire shape to domain model.
 *
 * Field-by-field rather than a spread. A spread would silently carry through any extra property
 * the server started sending — including, in the worst case, a key — which is exactly what the
 * schema's `.strict()` is there to prevent. Naming each field means this layer cannot pass along
 * something nobody reviewed.
 */
export function adaptAiSettings(raw: ApiAiSettings): AiSettings {
  return {
    provider: raw.provider,
    source: raw.source,
    keyLast4: raw.keyLast4,
    keyState: raw.keyState,
    lastVerifiedAt: raw.lastVerifiedAt,
    lastRejectedAt: raw.lastRejectedAt,
    updatedAt: raw.updatedAt,
    updatedBy: raw.updatedBy,
    canManage: raw.canManage,
    storageAvailable: raw.storageAvailable,
  };
}
