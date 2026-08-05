package io.restaurantos.nlq.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * {@link LlmClient} implementation for the OpenAI Chat Completions API
 * ({@code POST {base-url}/v1/chat/completions}).
 *
 * <p>Plain {@code java.net.http.HttpClient} — same approach as {@code ClaudeClient}: no SDK,
 * one JSON request, one JSON response.
 *
 * <p>Same security contract as all {@link LlmClient} implementations: the user's question is
 * UNTRUSTED INPUT placed only in a user-role message, and the model's SQL output is handed to
 * {@code SqlValidationPipeline} as-is.
 *
 * <p>Fails closed: any non-2xx response, network error, or timeout throws
 * {@link LlmUnavailableException}.
 */
public class OpenAiClient implements LlmClient {

    private static final Logger log = LoggerFactory.getLogger(OpenAiClient.class);
    private static final Duration CALL_TIMEOUT = Duration.ofSeconds(10);
    private static final int MAX_SQL_TOKENS = 1024;
    private static final int MAX_NARRATIVE_TOKENS = 300;
    private static final int MAX_NARRATIVE_ROW_SAMPLE = 20;

    private static final String NARRATIVE_SYSTEM_PROMPT = """
            You are a helpful restaurant-analytics assistant. You are given a user's question and \
            a JSON sample of the rows a SQL query already returned for it. Write a short (1-3 \
            sentence) plain-English narrative answer using ONLY the numbers present in the sample. \
            Never invent a number that is not in the data. All money columns are integer paisa \
            (100 paisa = 1 rupee) — convert to rupees when narrating, do not report raw paisa.""";

    private final HttpClient httpClient;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final String baseUrl;
    private final String apiKey;
    private final String modelSql;
    private final String modelNarrative;

    public OpenAiClient(String baseUrl, String apiKey, String modelSql, String modelNarrative) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
        this.modelSql = modelSql;
        this.modelNarrative = modelNarrative;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(CALL_TIMEOUT)
                .build();
    }

    @Override
    public String generateSql(String question, String schemaPrompt) {
        String raw = call(modelSql, schemaPrompt, question, MAX_SQL_TOKENS);
        return stripMarkdownFences(raw);
    }

    @Override
    public String narrate(String question, List<Map<String, Object>> rows) {
        String userTurn = "Question: " + question + "\n\nResult sample (JSON): " + rowSampleJson(rows);
        return call(modelNarrative, NARRATIVE_SYSTEM_PROMPT, userTurn, MAX_NARRATIVE_TOKENS);
    }

    private String call(String model, String systemPrompt, String userMessage, int maxTokens) {
        if (apiKey == null || apiKey.isBlank()) {
            throw new LlmUnavailableException("OpenAI API key is not configured");
        }
        try {
            // OpenAI Chat Completions API format:
            // messages: [{role: "system", content: ...}, {role: "user", content: ...}]
            Map<String, Object> body = Map.of(
                    "model", model,
                    "max_tokens", maxTokens,
                    "messages", List.of(
                            Map.of("role", "system", "content", systemPrompt),
                            Map.of("role", "user", "content", userMessage)));
            String jsonBody = objectMapper.writeValueAsString(body);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/v1/chat/completions"))
                    .timeout(CALL_TIMEOUT)
                    .header("Authorization", "Bearer " + apiKey)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() != 200) {
                log.warn("[nlq-openai] OpenAI API returned HTTP {} for model {}", response.statusCode(), model);
                throw new LlmUnavailableException("OpenAI API returned HTTP " + response.statusCode());
            }

            JsonNode root = objectMapper.readTree(response.body());
            JsonNode choices = root.path("choices");
            if (!choices.isArray() || choices.isEmpty()) {
                throw new LlmUnavailableException("OpenAI API returned no choices");
            }
            String text = choices.get(0).path("message").path("content").asText(null);
            if (text == null || text.isBlank()) {
                throw new LlmUnavailableException("OpenAI API returned an empty response");
            }
            return text;
        } catch (LlmUnavailableException ex) {
            throw ex;
        } catch (IOException ex) {
            throw new LlmUnavailableException("OpenAI API call failed: " + ex.getClass().getSimpleName(), ex);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new LlmUnavailableException("OpenAI API call interrupted", ex);
        } catch (RuntimeException ex) {
            throw new LlmUnavailableException("OpenAI API call failed", ex);
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
