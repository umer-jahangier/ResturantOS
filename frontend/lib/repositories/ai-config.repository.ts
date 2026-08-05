import { get, put, post, del } from "@/lib/api-client/request";
import {
  apiAiConfigResponseSchema,
  apiAiConfigTestResponseSchema,
  type ApiAiConfigRequest,
  type ApiAiConfigResponse,
  type ApiAiConfigTestRequest,
  type ApiAiConfigTestResponse,
} from "@/lib/api-client/schemas/ai-config.schema";

export const AiConfigRepository = {
  /**
   * GET /api/v1/nlq/ai-config — returns the tenant's AI config (masked key) or null if
   * no config exists. OWNER/TENANT_ADMIN only.
   */
  async getConfig(): Promise<ApiAiConfigResponse | null> {
    const raw = await get("/api/v1/nlq/ai-config");
    if (raw == null) return null;
    return apiAiConfigResponseSchema.parse(raw);
  },

  /**
   * PUT /api/v1/nlq/ai-config — create or update the tenant's AI config.
   */
  async saveConfig(data: ApiAiConfigRequest): Promise<ApiAiConfigResponse> {
    const raw = await put("/api/v1/nlq/ai-config", data);
    return apiAiConfigResponseSchema.parse(raw);
  },

  /**
   * DELETE /api/v1/nlq/ai-config — delete the tenant's AI config. NLQ becomes
   * unconfigured until re-added.
   */
  async deleteConfig(): Promise<void> {
    await del("/api/v1/nlq/ai-config");
  },

  /**
   * POST /api/v1/nlq/ai-config/test — test connection with provided credentials.
   * Does NOT save anything.
   */
  async testConnection(data: ApiAiConfigTestRequest): Promise<ApiAiConfigTestResponse> {
    const raw = await post("/api/v1/nlq/ai-config/test", data);
    return apiAiConfigTestResponseSchema.parse(raw);
  },
};
