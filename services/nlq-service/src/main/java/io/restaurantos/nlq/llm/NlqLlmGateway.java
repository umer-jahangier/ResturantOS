package io.restaurantos.nlq.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.nlq.claude.SchemaPromptBuilder;
import io.restaurantos.nlq.provider.AiCredentialRejectedException;
import io.restaurantos.nlq.provider.LlmCall;
import io.restaurantos.nlq.provider.LlmProviderRegistry;
import io.restaurantos.nlq.settings.AiKeyStateWriter;
import io.restaurantos.nlq.settings.CredentialSource;
import io.restaurantos.nlq.settings.LlmCredentialResolver;
import io.restaurantos.nlq.settings.ResolvedLlm;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The NLQ domain's face onto whichever AI provider a tenant is using. Replaces the old
 * {@code ClaudeClient}, which hard-wired one fleet-wide key from deploy config.
 *
 * <h3>What moved, and why the split is here</h3>
 *
 * <p>{@code ClaudeClient} did two unrelated jobs: it owned NLQ prompt policy (the system prompts,
 * the token caps, markdown-fence stripping) and it spoke Anthropic's wire protocol. The second is
 * now {@code AnthropicLlmProvider} and is selected per call; the first stays here, where the NLQ
 * domain can see it. That is what makes a second provider a new class rather than a second copy of
 * the pipeline.
 *
 * <p><b>The user's question is UNTRUSTED INPUT</b> — a prompt-injection vector. It goes only into
 * the user turn, never into the system prompt. Nothing here makes the model's SQL safe: the
 * 7-stage {@code SqlValidationPipeline} does that, and this class is a rejection-rate
 * optimisation, not a security control.
 *
 * <h3>Per-tenant billing, per-tenant blame</h3>
 *
 * <p>Every call resolves credentials for the calling tenant first. On a 401/403 the exception is
 * re-stamped with the resolved {@link CredentialSource} — only this layer knows whose key it just
 * sent — and, when it was the tenant's own, {@code key_state} is flipped to REJECTED in a separate
 * transaction so the settings screen tells the truth without anyone re-testing.
 */
@Component
public class NlqLlmGateway {

    private static final int MAX_SQL_TOKENS = 1024;
    private static final int MAX_NARRATIVE_TOKENS = 300;
    private static final int MAX_NARRATIVE_ROW_SAMPLE = 20;

    private static final String NARRATIVE_SYSTEM_PROMPT = """
            You are a helpful restaurant-analytics assistant. You are given a user's question and \
            a JSON sample of the rows a SQL query already returned for it. Write a short (1-3 \
            sentence) plain-English narrative answer using ONLY the numbers present in the sample. \
            Never invent a number that is not in the data. All money columns are integer paisa \
            (100 paisa = 1 rupee) — convert to rupees when narrating, do not report raw paisa.""";

    private final LlmCredentialResolver credentialResolver;
    private final LlmProviderRegistry providerRegistry;
    private final AiKeyStateWriter keyStateWriter;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public NlqLlmGateway(LlmCredentialResolver credentialResolver,
                          LlmProviderRegistry providerRegistry,
                          AiKeyStateWriter keyStateWriter) {
        this.credentialResolver = credentialResolver;
        this.providerRegistry = providerRegistry;
        this.keyStateWriter = keyStateWriter;
    }

    /**
     * @param schemaPrompt the role-scoped system prompt built by {@link SchemaPromptBuilder}.
     * @return the model's raw SQL, markdown fences stripped, otherwise UNMODIFIED — hand it to
     *         {@code SqlValidationPipeline.validate(...)} as-is. Never "clean it up" further here;
     *         that would create a false sense that the model's output is trustworthy.
     */
    public String generateSql(UUID tenantId, String question, String schemaPrompt) {
        ResolvedLlm resolved = credentialResolver.resolve(tenantId);
        String raw = call(tenantId, resolved,
                new LlmCall(resolved.credentials().modelSql(), schemaPrompt, question, MAX_SQL_TOKENS));
        return stripMarkdownFences(raw);
    }

    /**
     * Best-effort narration — the caller MUST treat a failure here as non-fatal to the overall
     * request (return rows with a {@code null} narrative).
     */
    public String narrate(UUID tenantId, String question, List<Map<String, Object>> rows) {
        ResolvedLlm resolved = credentialResolver.resolve(tenantId);
        String userTurn = "Question: " + question + "\n\nResult sample (JSON): " + rowSampleJson(rows);
        return call(tenantId, resolved, new LlmCall(resolved.credentials().modelNarrative(),
                NARRATIVE_SYSTEM_PROMPT, userTurn, MAX_NARRATIVE_TOKENS));
    }

    private String call(UUID tenantId, ResolvedLlm resolved, LlmCall llmCall) {
        try {
            String text = providerRegistry.get(resolved.provider())
                    .complete(resolved.credentials(), llmCall);
            if (resolved.source() == CredentialSource.TENANT) {
                // A successful call is proof the key works. Promotes UNVERIFIED (saved during a
                // provider outage) and clears a stale REJECTED, so the screen self-heals.
                keyStateWriter.markVerified(tenantId);
            }
            return text;
        } catch (AiCredentialRejectedException ex) {
            if (resolved.source() == CredentialSource.TENANT) {
                // Separate transaction — this one is about to roll back. See AiKeyStateWriter.
                keyStateWriter.markRejected(tenantId);
            }
            // Re-stamped with the source: the provider raised it unstamped because it does not
            // know whose key it sent. Only this layer does.
            throw new AiCredentialRejectedException(resolved.source() == CredentialSource.TENANT
                    ? AiCredentialRejectedException.Source.TENANT
                    : AiCredentialRejectedException.Source.PLATFORM);
        }
    }

    private String rowSampleJson(List<Map<String, Object>> rows) {
        List<Map<String, Object>> sample = rows.size() > MAX_NARRATIVE_ROW_SAMPLE
                ? rows.subList(0, MAX_NARRATIVE_ROW_SAMPLE)
                : rows;
        try {
            return objectMapper.writeValueAsString(sample);
        } catch (Exception ex) {
            return "[]";
        }
    }

    private static String stripMarkdownFences(String raw) {
        String trimmed = raw.trim();
        if (!trimmed.startsWith("```")) {
            return trimmed;
        }
        int firstNewline = trimmed.indexOf('\n');
        String withoutOpenFence = firstNewline >= 0 ? trimmed.substring(firstNewline + 1) : trimmed;
        int closeFence = withoutOpenFence.lastIndexOf("```");
        String withoutFences = closeFence >= 0 ? withoutOpenFence.substring(0, closeFence) : withoutOpenFence;
        return withoutFences.trim();
    }
}
