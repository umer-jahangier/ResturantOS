package io.restaurantos.nlq.provider;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.nlq.claude.ClaudeUnavailableException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * Anthropic Messages API ({@code POST {base-url}/v1/messages}) — the wire half of what used to be
 * {@code ClaudeClient}. No Anthropic SDK dependency: one JSON request and one JSON response does
 * not justify adding one.
 *
 * <h3>ONE shared HttpClient, constructed once</h3>
 *
 * <p>Credentials arrive per call, so there is no reason to build a client per request — and a real
 * reason not to. The earlier attempt at this feature ({@code origin/Mufazzal}) constructed a new
 * client object per request, each running {@code HttpClient.newBuilder().build()}, which allocates
 * a selector thread and a connection pool that are never closed. Under any load that is a thread
 * and file-descriptor leak. The client here is stateless with respect to the key — the key travels
 * in a per-request header — so sharing it is both safe and correct.
 *
 * <h3>The 401/403 split is the whole point of this class</h3>
 *
 * <p>Before this change every non-200 collapsed into "temporarily unavailable", so a wrong API key
 * told the owner to retry a condition that would never clear. 401 and 403 now raise
 * {@link AiCredentialRejectedException}; everything else stays
 * {@link ClaudeUnavailableException}, unchanged.
 *
 * <p>The provider's response body is never logged and never propagated — on an auth failure it can
 * echo request metadata, and on any failure it is attacker-influenced text.
 */
@Component
public class AnthropicLlmProvider implements LlmProvider {

    private static final Logger log = LoggerFactory.getLogger(AnthropicLlmProvider.class);
    private static final Duration CALL_TIMEOUT = Duration.ofSeconds(10);

    /** SERVER-SIDE CONSTANT. Never tenant input — a tenant-supplied base URL is an SSRF primitive. */
    public static final String DEFAULT_BASE_URL = "https://api.anthropic.com";

    private final HttpClient httpClient;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public AnthropicLlmProvider() {
        this.httpClient = HttpClient.newBuilder().connectTimeout(CALL_TIMEOUT).build();
    }

    @Override
    public AiProviderType type() {
        return AiProviderType.ANTHROPIC;
    }

    @Override
    public String complete(LlmCredentials credentials, LlmCall call) {
        if (credentials == null || credentials.apiKey() == null || credentials.apiKey().isBlank()) {
            // Never logged: the key never appears in any log line, here or anywhere else.
            throw new ClaudeUnavailableException("Anthropic API key is not configured");
        }
        try {
            Map<String, Object> body = Map.of(
                    "model", call.model(),
                    "max_tokens", call.maxTokens(),
                    "system", call.systemPrompt(),
                    // UNTRUSTED input goes in the user turn ONLY, never concatenated into `system`.
                    "messages", List.of(Map.of("role", "user", "content", call.userTurn())));
            String jsonBody = objectMapper.writeValueAsString(body);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(credentials.baseUrl() + "/v1/messages"))
                    .timeout(CALL_TIMEOUT)
                    .header("x-api-key", credentials.apiKey())
                    .header("anthropic-version", "2023-06-01")
                    .header("content-type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            int status = response.statusCode();

            if (status == 401 || status == 403) {
                // Status only. No body, no key, no fragment of either — this line is written on a
                // path where the request carried a credential.
                log.warn("[nlq-anthropic] Provider REFUSED the API credential (HTTP {}) for model {}",
                        status, call.model());
                // UNSTAMPED on purpose — this class does not know whose key it just sent.
                // NlqLlmGateway rethrows a copy stamped with the resolved source.
                throw new AiCredentialRejectedException();
            }
            if (status != 200) {
                log.warn("[nlq-anthropic] Anthropic API returned HTTP {} for model {}", status, call.model());
                throw new ClaudeUnavailableException("Anthropic API returned HTTP " + status);
            }

            JsonNode root = objectMapper.readTree(response.body());
            JsonNode contentArray = root.path("content");
            if (!contentArray.isArray() || contentArray.isEmpty()) {
                throw new ClaudeUnavailableException("Anthropic API returned no content");
            }
            String text = contentArray.get(0).path("text").asText(null);
            if (text == null || text.isBlank()) {
                throw new ClaudeUnavailableException("Anthropic API returned an empty response");
            }
            return text;
        } catch (ClaudeUnavailableException ex) {
            // Covers AiCredentialRejectedException too (it is a subclass) — rethrown unwrapped so
            // the credential branch is not flattened back into the generic one by the catch below.
            throw ex;
        } catch (IOException ex) {
            throw new ClaudeUnavailableException("Anthropic API call failed: " + ex.getClass().getSimpleName(), ex);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new ClaudeUnavailableException("Anthropic API call interrupted", ex);
        } catch (RuntimeException ex) {
            throw new ClaudeUnavailableException("Anthropic API call failed", ex);
        }
    }
}
