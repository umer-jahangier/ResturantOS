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
 * {@link LlmClient} implementation for the Google Generative Language API (Gemini).
 * ({@code POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}}).
 *
 * <p>Plain {@code java.net.http.HttpClient} — same approach as the other LlmClient implementations.
 *
 * <p>Same security contract: untrusted user input placed only in the user content part,
 * model output handed to {@code SqlValidationPipeline} as-is.
 *
 * <p>Fails closed: any non-2xx response, network error, or timeout throws
 * {@link LlmUnavailableException}.
 */
public class GeminiClient implements LlmClient {

    private static final Logger log = LoggerFactory.getLogger(GeminiClient.class);
    private static final String BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
    private static final Duration CALL_TIMEOUT = Duration.ofSeconds(10);
    private static final int MAX_NARRATIVE_ROW_SAMPLE = 20;

    private static final String NARRATIVE_SYSTEM_PROMPT = """
            You are a helpful restaurant-analytics assistant. You are given a user's question and \
            a JSON sample of the rows a SQL query already returned for it. Write a short (1-3 \
            sentence) plain-English narrative answer using ONLY the numbers present in the sample. \
            Never invent a number that is not in the data. All money columns are integer paisa \
            (100 paisa = 1 rupee) — convert to rupees when narrating, do not report raw paisa.""";

    private final HttpClient httpClient;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final String apiKey;
    private final String modelSql;
    private final String modelNarrative;

    public GeminiClient(String apiKey, String modelSql, String modelNarrative) {
        this.apiKey = apiKey;
        this.modelSql = modelSql;
        this.modelNarrative = modelNarrative;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(CALL_TIMEOUT)
                .build();
    }

    @Override
    public String generateSql(String question, String schemaPrompt) {
        String raw = call(modelSql, schemaPrompt, question);
        return stripMarkdownFences(raw);
    }

    @Override
    public String narrate(String question, List<Map<String, Object>> rows) {
        String userTurn = "Question: " + question + "\n\nResult sample (JSON): " + rowSampleJson(rows);
        return call(modelNarrative, NARRATIVE_SYSTEM_PROMPT, userTurn);
    }

    private String call(String model, String systemPrompt, String userMessage) {
        if (apiKey == null || apiKey.isBlank()) {
            throw new LlmUnavailableException("Gemini API key is not configured");
        }
        try {
            // Gemini generateContent API format:
            // systemInstruction: { parts: [{ text: ... }] }
            // contents: [{ role: "user", parts: [{ text: ... }] }]
            Map<String, Object> body = Map.of(
                    "systemInstruction", Map.of(
                            "parts", List.of(Map.of("text", systemPrompt))),
                    "contents", List.of(
                            Map.of("role", "user",
                                    "parts", List.of(Map.of("text", userMessage)))));
            String jsonBody = objectMapper.writeValueAsString(body);

            String url = BASE_URL + "/models/" + model + ":generateContent?key=" + apiKey;
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(CALL_TIMEOUT)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() != 200) {
                log.warn("[nlq-gemini] Gemini API returned HTTP {} for model {}", response.statusCode(), model);
                throw new LlmUnavailableException("Gemini API returned HTTP " + response.statusCode());
            }

            JsonNode root = objectMapper.readTree(response.body());
            JsonNode candidates = root.path("candidates");
            if (!candidates.isArray() || candidates.isEmpty()) {
                throw new LlmUnavailableException("Gemini API returned no candidates");
            }
            JsonNode parts = candidates.get(0).path("content").path("parts");
            if (!parts.isArray() || parts.isEmpty()) {
                throw new LlmUnavailableException("Gemini API returned no content parts");
            }
            String text = parts.get(0).path("text").asText(null);
            if (text == null || text.isBlank()) {
                throw new LlmUnavailableException("Gemini API returned an empty response");
            }
            return text;
        } catch (LlmUnavailableException ex) {
            throw ex;
        } catch (IOException ex) {
            throw new LlmUnavailableException("Gemini API call failed: " + ex.getClass().getSimpleName(), ex);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new LlmUnavailableException("Gemini API call interrupted", ex);
        } catch (RuntimeException ex) {
            throw new LlmUnavailableException("Gemini API call failed", ex);
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
