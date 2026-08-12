package io.restaurantos.nlq.provider;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.sun.net.httpserver.HttpServer;
import io.restaurantos.nlq.claude.ClaudeUnavailableException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The 401/403 split, proved against a real HTTP server rather than a mock.
 *
 * <p><b>The defect this fixes.</b> Before this change every non-200 from Anthropic collapsed into
 * {@code ClaudeUnavailableException} → 503 {@code CLAUDE_UNAVAILABLE} / "temporarily unavailable".
 * A tenant with a wrong API key was therefore told to wait out a condition that would never clear
 * on its own. It was never a 500 — it was worse than a 500, because it looked like someone else's
 * problem.
 *
 * <p>A {@code com.sun.net.httpserver.HttpServer} on an ephemeral port is used instead of WireMock:
 * it is in the JDK, so it adds no dependency, and it exercises the real {@code java.net.http}
 * client, real socket, real status parsing. A mocked HttpClient would prove the test's own
 * assumptions about the client, not the provider's behaviour.
 */
class AnthropicLlmProviderTest {

    /**
     * A syntactically plausible but ENTIRELY FAKE key. It is a string to assert the ABSENCE of —
     * no real credential is used, needed, or entered anywhere in this codebase's tests.
     */
    private static final String FAKE_KEY = "sk-ant-TEST-not-a-real-key-000000000000";

    private HttpServer server;
    private String baseUrl;
    private final AtomicInteger status = new AtomicInteger(200);
    private final AtomicReference<String> body = new AtomicReference<>(
            "{\"content\":[{\"text\":\"SELECT 1\"}]}");
    private final List<String> receivedApiKeys = new ArrayList<>();

    private AnthropicLlmProvider provider;
    private ListAppender<ILoggingEvent> logAppender;
    private Logger providerLogger;

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/messages", exchange -> {
            receivedApiKeys.add(exchange.getRequestHeaders().getFirst("x-api-key"));
            byte[] payload = body.get().getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status.get(), payload.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(payload);
            }
        });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
        provider = new AnthropicLlmProvider();

        providerLogger = (Logger) LoggerFactory.getLogger(AnthropicLlmProvider.class);
        logAppender = new ListAppender<>();
        logAppender.start();
        providerLogger.addAppender(logAppender);
        providerLogger.setLevel(Level.TRACE);
    }

    @AfterEach
    void stopServer() {
        providerLogger.detachAppender(logAppender);
        server.stop(0);
    }

    private LlmCredentials creds() {
        return new LlmCredentials(baseUrl, FAKE_KEY, "model-sql", "model-narrative");
    }

    private LlmCall call() {
        return new LlmCall("model-sql", "system", "question", 16);
    }

    // ── The split ────────────────────────────────────────────────────────────────

    @ParameterizedTest(name = "HTTP {0} is a REFUSED CREDENTIAL, not an outage")
    @ValueSource(ints = {401, 403})
    void authFailureRaisesCredentialRejected(int authStatus) {
        status.set(authStatus);
        body.set("{\"error\":{\"message\":\"invalid x-api-key\"}}");

        assertThatThrownBy(() -> provider.complete(creds(), call()))
                .as("""
                    HTTP %d must raise AiCredentialRejectedException. If this fails with a plain \
                    ClaudeUnavailableException, the 401/403 branch in AnthropicLlmProvider.complete \
                    has been removed or reordered, and a wrong API key is once again reported to \
                    the owner as "the service is temporarily unavailable" — advice to wait out a \
                    condition that never clears.""".formatted(authStatus))
                .isInstanceOf(AiCredentialRejectedException.class);
    }

    @ParameterizedTest(name = "HTTP {0} stays a transient outage")
    @ValueSource(ints = {429, 500, 502, 503, 529})
    void otherFailuresStayUnavailable(int otherStatus) {
        status.set(otherStatus);

        assertThatThrownBy(() -> provider.complete(creds(), call()))
                .isInstanceOf(ClaudeUnavailableException.class)
                .as("a 5xx or a rate limit must NOT be reported as a bad credential — that would "
                        + "send an owner to replace a key that is perfectly good")
                .isNotInstanceOf(AiCredentialRejectedException.class);
    }

    @Test
    @DisplayName("the happy path still returns the model's text unmodified")
    void successReturnsTextUnmodified() {
        status.set(200);
        body.set("{\"content\":[{\"text\":\"SELECT order_no FROM sales_order_facts\"}]}");

        assertThat(provider.complete(creds(), call()))
                .isEqualTo("SELECT order_no FROM sales_order_facts");
    }

    @Test
    @DisplayName("the key IS sent to the provider — the positive control for the leak tests below")
    void keyReachesTheProvider() {
        status.set(200);
        provider.complete(creds(), call());

        // Without this, every "the key does not appear in X" assertion below could pass simply
        // because the key was never in play at all.
        assertThat(receivedApiKeys).containsExactly(FAKE_KEY);
    }

    // ── The key must not escape ──────────────────────────────────────────────────

    @Test
    @DisplayName("a refused credential never puts the key, or the provider's body, in the exception")
    void rejectionCarriesNoKeyAndNoProviderBody() {
        status.set(401);
        body.set("{\"error\":{\"message\":\"invalid x-api-key: " + FAKE_KEY + "\"}}");

        assertThatThrownBy(() -> provider.complete(creds(), call()))
                .isInstanceOf(AiCredentialRejectedException.class)
                .satisfies(ex -> {
                    assertThat(ex.getMessage()).doesNotContain(FAKE_KEY);
                    // The provider echoing our own key back is not hypothetical — the body above is
                    // shaped exactly like a real auth-failure payload.
                    assertThat(ex.getMessage()).doesNotContain("invalid x-api-key");
                });
    }

    @Test
    @DisplayName("no log line written on the auth-failure path contains the key")
    void keyNeverAppearsInLogs() {
        status.set(401);
        body.set("{\"error\":{\"message\":\"invalid x-api-key: " + FAKE_KEY + "\"}}");

        try {
            provider.complete(creds(), call());
        } catch (AiCredentialRejectedException expected) {
            // The point of the test is what got logged on the way out.
        }

        // Positive control first: the warn line must actually have been written, otherwise the
        // absence assertion below is vacuous.
        assertThat(logAppender.list)
                .as("the provider must log SOMETHING on a refused credential, or this test proves nothing")
                .isNotEmpty();

        for (ILoggingEvent event : logAppender.list) {
            assertThat(event.getFormattedMessage())
                    .as("a log line on the credential path leaked the key")
                    .doesNotContain(FAKE_KEY);
        }
    }

    @Test
    @DisplayName("LlmCredentials.toString() suppresses the key")
    void credentialsToStringSuppressesTheKey() {
        // The single most likely accidental leak: log.debug("creds={}", credentials). A record's
        // generated toString would print every component.
        assertThat(creds().toString()).doesNotContain(FAKE_KEY).contains("apiKey=***");
    }

    @Test
    @DisplayName("a blank key fails before any request is made")
    void blankKeyIsRejectedLocally() {
        assertThatThrownBy(() -> provider.complete(
                new LlmCredentials(baseUrl, "  ", "m", "n"), call()))
                .isInstanceOf(ClaudeUnavailableException.class);

        assertThat(receivedApiKeys).as("no outbound request should have been made").isEmpty();
    }
}
