import { post } from "@/lib/api-client/request";
import {
  apiNlqQueryRequestSchema,
  apiNlqQueryResponseSchema,
} from "@/lib/api-client/schemas/nlq.schema";
import { adaptNlqResult } from "@/lib/adapters/nlq.adapter";
import type { NlqResult } from "@/lib/models/nlq.model";

export const NlqRepository = {
  /**
   * POST /api/v1/nlq/query — the request body carries ONLY `question` (parsed through the
   * request schema so a future refactor can never "helpfully" start sending tenantId/branchId/
   * sql). `.parse()`s the response before adapting (FE-08).
   */
  async runQuery(question: string): Promise<NlqResult> {
    const body = apiNlqQueryRequestSchema.parse({ question });
    const raw = await post("/api/v1/nlq/query", body);
    return adaptNlqResult(apiNlqQueryResponseSchema.parse(raw));
  },
};
