package io.restaurantos.nlq.llm;

import java.util.List;
import java.util.Map;

/**
 * Strategy interface for LLM providers used by NLQ.
 *
 * <p>Each implementation wraps a single provider's HTTP API (Anthropic, OpenAI, Google Gemini).
 * Instances are <b>not</b> Spring beans — they are constructed per-request by
 * {@link LlmClientFactory} from the tenant's {@code tenant_ai_config} row.
 *
 * <p>The same security contract applies to every implementation:
 * <ul>
 *   <li>The user's question is <b>untrusted input</b> — placed ONLY in the user-turn message,
 *       never concatenated into the system prompt.
 *   <li>The model's SQL output is <b>untrusted</b> — handed to {@code SqlValidationPipeline} as-is.
 *   <li>Fails closed: any non-2xx response, network error, or timeout throws
 *       {@link LlmUnavailableException}.
 * </ul>
 */
public interface LlmClient {

    /**
     * Generate a ClickHouse SELECT statement from a natural-language question.
     *
     * @param question     the caller's raw question — UNTRUSTED.
     * @param schemaPrompt the role-scoped system prompt built by {@code SchemaPromptBuilder}.
     * @return the model's raw SQL text, markdown fences stripped. Hand to
     *         {@code SqlValidationPipeline.validate(...)} as-is.
     */
    String generateSql(String question, String schemaPrompt);

    /**
     * Best-effort narration of query results. The caller MUST treat a failure here as non-fatal
     * (return rows with a {@code null} narrative).
     */
    String narrate(String question, List<Map<String, Object>> rows);
}
