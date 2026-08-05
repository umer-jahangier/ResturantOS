package io.restaurantos.nlq.llm;

/**
 * Thrown whenever an LLM provider API cannot be used to satisfy a request — a non-2xx response
 * (401 unauthenticated, 429 rate-limited, 5xx server error), a network/timeout failure, or a
 * missing/invalid API key. The exception handler maps this to HTTP 503.
 *
 * <p><b>Fail closed.</b> There is no fallback SQL generation path and no cached "last known good"
 * answer substituted on failure — an LLM failure means the request fails, full stop.
 *
 * <p>Replaces the original {@code ClaudeUnavailableException} as the multi-provider equivalent.
 * All three client implementations (Claude, OpenAI, Gemini) throw this same type so the
 * exception handler needs only one catch clause.
 */
public class LlmUnavailableException extends RuntimeException {

    public LlmUnavailableException(String message) {
        super(message);
    }

    public LlmUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
