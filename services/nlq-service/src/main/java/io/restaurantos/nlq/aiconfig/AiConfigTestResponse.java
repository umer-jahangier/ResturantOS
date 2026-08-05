package io.restaurantos.nlq.aiconfig;

/**
 * Response body for {@code POST /api/v1/nlq/ai-config/test}.
 */
public record AiConfigTestResponse(boolean success, String message) {
}
