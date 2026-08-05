package io.restaurantos.nlq.aiconfig;

import java.time.Instant;

/**
 * Response DTO for the tenant's AI config. The API key is ALWAYS masked — the raw key is never
 * returned to the client.
 */
public record AiConfigResponse(
        AiProvider provider,
        String maskedApiKey,
        String modelSql,
        String modelNarrative,
        boolean enabled,
        Instant updatedAt) {
}
