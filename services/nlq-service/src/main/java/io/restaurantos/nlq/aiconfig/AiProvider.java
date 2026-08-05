package io.restaurantos.nlq.aiconfig;

/**
 * The LLM providers a tenant may configure for NLQ.
 *
 * <p>Stored as a {@code VARCHAR(20)} in {@code tenant_ai_config.provider} and serialised to/from
 * JSON as-is (upper-case enum name). Adding a new provider here requires a matching
 * {@code LlmClient} implementation and a branch in {@link io.restaurantos.nlq.llm.LlmClientFactory}.
 */
public enum AiProvider {
    ANTHROPIC,
    OPENAI,
    GEMINI
}
