import { z } from "zod";

/**
 * AI provider enum — mirrors `AiProvider.java`.
 */
export const aiProviderSchema = z.enum(["ANTHROPIC", "OPENAI", "GEMINI"]);

/**
 * Response from `GET /api/v1/nlq/ai-config` — the API key is ALWAYS masked.
 */
export const apiAiConfigResponseSchema = z.object({
  provider: aiProviderSchema,
  maskedApiKey: z.string().nullable(),
  modelSql: z.string().nullable(),
  modelNarrative: z.string().nullable(),
  enabled: z.boolean(),
  updatedAt: z.string().nullable(),
});

/**
 * Request body for `PUT /api/v1/nlq/ai-config`.
 */
export const apiAiConfigRequestSchema = z.object({
  provider: aiProviderSchema,
  apiKey: z.string().optional(),
  modelSql: z.string().nullable().optional(),
  modelNarrative: z.string().nullable().optional(),
  enabled: z.boolean(),
});

/**
 * Request body for `POST /api/v1/nlq/ai-config/test`.
 */
export const apiAiConfigTestRequestSchema = z.object({
  provider: aiProviderSchema,
  apiKey: z.string().min(1),
  modelSql: z.string().nullable().optional(),
  modelNarrative: z.string().nullable().optional(),
});

/**
 * Response from `POST /api/v1/nlq/ai-config/test`.
 */
export const apiAiConfigTestResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type ApiAiConfigResponse = z.infer<typeof apiAiConfigResponseSchema>;
export type ApiAiConfigRequest = z.infer<typeof apiAiConfigRequestSchema>;
export type ApiAiConfigTestRequest = z.infer<typeof apiAiConfigTestRequestSchema>;
export type ApiAiConfigTestResponse = z.infer<typeof apiAiConfigTestResponseSchema>;
