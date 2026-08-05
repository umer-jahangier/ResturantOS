package io.restaurantos.nlq.llm;

/**
 * Thrown when a tenant has not configured an AI provider/key in {@code tenant_ai_config}, or
 * when their config exists but is disabled ({@code enabled = false}).
 *
 * <p>There is <b>no platform-level fallback</b> — every tenant must BYOK. The exception handler
 * maps this to HTTP 503 with the {@code AI_NOT_CONFIGURED} code and a user-friendly message
 * directing the owner to Settings → AI.
 */
public class LlmNotConfiguredException extends RuntimeException {

    public LlmNotConfiguredException(String message) {
        super(message);
    }
}
