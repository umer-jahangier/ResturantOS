package io.restaurantos.nlq.aiconfig;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * Request body for {@code POST /api/v1/nlq/ai-config/test}.
 */
public record AiConfigTestRequest(
        @NotNull(message = "provider is required")
        AiProvider provider,
        @NotBlank(message = "apiKey is required for testing")
        String apiKey,
        String modelSql,
        String modelNarrative) {
}
