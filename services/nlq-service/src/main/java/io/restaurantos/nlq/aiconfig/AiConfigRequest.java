package io.restaurantos.nlq.aiconfig;

import jakarta.validation.constraints.NotNull;

/**
 * Request body for {@code PUT /api/v1/nlq/ai-config}.
 *
 * @param provider       the LLM provider (required).
 * @param apiKey         the API key (required on create, optional on update if not changing).
 * @param modelSql       the model ID for SQL generation (null → provider default).
 * @param modelNarrative the model ID for narration (null → provider default).
 * @param enabled        whether NLQ is active for this tenant.
 */
public record AiConfigRequest(
        @NotNull(message = "provider is required")
        AiProvider provider,
        String apiKey,
        String modelSql,
        String modelNarrative,
        boolean enabled) {
}
