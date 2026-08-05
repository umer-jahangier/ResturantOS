package io.restaurantos.nlq.llm;

import io.restaurantos.nlq.aiconfig.AiProvider;
import io.restaurantos.nlq.claude.ClaudeClient;
import org.springframework.stereotype.Component;

/**
 * Constructs the correct {@link LlmClient} implementation from a tenant's AI config.
 *
 * <p>Each call produces a <b>new</b> instance — these are lightweight HTTP-client wrappers,
 * not expensive pooled resources. The per-request cost is negligible compared to the LLM call
 * itself (10s network round-trip).
 */
@Component
public class LlmClientFactory {

    private static final String ANTHROPIC_BASE_URL = "https://api.anthropic.com";
    private static final String OPENAI_BASE_URL = "https://api.openai.com";

    // Default model IDs per provider — used when the tenant leaves model fields null/blank.
    private static final String CLAUDE_DEFAULT_SQL = "claude-sonnet-4-6";
    private static final String CLAUDE_DEFAULT_NARRATIVE = "claude-haiku-4-5";
    private static final String OPENAI_DEFAULT_SQL = "gpt-4o";
    private static final String OPENAI_DEFAULT_NARRATIVE = "gpt-4o-mini";
    private static final String GEMINI_DEFAULT_SQL = "gemini-2.5-flash";
    private static final String GEMINI_DEFAULT_NARRATIVE = "gemini-2.5-flash";

    /**
     * Creates an {@link LlmClient} for the given provider and credentials.
     *
     * @param provider       the LLM provider to use.
     * @param apiKey         the tenant's API key (plaintext, decrypted from DB).
     * @param modelSql       the model ID for SQL generation, or {@code null}/blank for the
     *                       provider's default.
     * @param modelNarrative the model ID for narration, or {@code null}/blank for the provider's
     *                       default.
     */
    public LlmClient create(AiProvider provider, String apiKey,
                             String modelSql, String modelNarrative) {
        return switch (provider) {
            case ANTHROPIC -> new ClaudeClient(
                    ANTHROPIC_BASE_URL, apiKey,
                    defaultIfBlank(modelSql, CLAUDE_DEFAULT_SQL),
                    defaultIfBlank(modelNarrative, CLAUDE_DEFAULT_NARRATIVE));
            case OPENAI -> new OpenAiClient(
                    OPENAI_BASE_URL, apiKey,
                    defaultIfBlank(modelSql, OPENAI_DEFAULT_SQL),
                    defaultIfBlank(modelNarrative, OPENAI_DEFAULT_NARRATIVE));
            case GEMINI -> new GeminiClient(
                    apiKey,
                    defaultIfBlank(modelSql, GEMINI_DEFAULT_SQL),
                    defaultIfBlank(modelNarrative, GEMINI_DEFAULT_NARRATIVE));
        };
    }

    private static String defaultIfBlank(String value, String defaultValue) {
        return (value == null || value.isBlank()) ? defaultValue : value;
    }
}
