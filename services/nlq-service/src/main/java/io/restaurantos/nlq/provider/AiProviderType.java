package io.restaurantos.nlq.provider;

/**
 * The AI providers this platform can talk to.
 *
 * <p><b>EXACTLY ONE VALUE, ON PURPOSE.</b> An earlier attempt at this feature
 * ({@code origin/Mufazzal} @ d11d4ae5) shipped {@code OPENAI} and {@code GEMINI} clients — 149
 * lines each — with no test of either against a real API. An enum branch nobody has ever run is
 * the exact "structurally present, behaviourally absent" defect this codebase keeps paying for.
 *
 * <p>The seam is still real: {@link LlmProviderRegistry} performs the lookup on every single NLQ
 * query, so a second value cannot be added without its implementation being exercised. Adding one
 * is a new constant, a new {@code @Component}, an entry in the migration's
 * {@code nlq_tenant_ai_settings_provider_chk} CHECK constraint, and its own integration test.
 */
public enum AiProviderType {

    /** Anthropic Messages API ({@code POST {base-url}/v1/messages}). */
    ANTHROPIC;

    /**
     * Parses a stored/submitted provider string, failing loudly rather than defaulting.
     *
     * <p>A silent default here would mean a tenant who typed "openai" gets their key sent to
     * Anthropic, which then refuses it — a confusing 401 for a problem that is really "we do not
     * support that provider yet".
     */
    public static AiProviderType parse(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("provider is required");
        }
        for (AiProviderType type : values()) {
            if (type.name().equalsIgnoreCase(raw.trim())) {
                return type;
            }
        }
        throw new IllegalArgumentException("Unsupported AI provider: " + raw.trim());
    }
}
