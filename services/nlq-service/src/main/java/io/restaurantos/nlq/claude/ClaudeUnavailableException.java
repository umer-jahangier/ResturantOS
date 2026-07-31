package io.restaurantos.nlq.claude;

/**
 * Thrown whenever the Anthropic Messages API cannot be used to satisfy a request — a non-2xx
 * response (401 unauthenticated, 429 rate-limited, 5xx server error), a network/timeout failure,
 * or a missing API key. The controller (12-07) maps this to HTTP 503.
 *
 * <p><b>Fail closed.</b> There is no fallback SQL generation path and no cached "last known good"
 * answer substituted on failure — a Claude failure means the request fails, full stop.
 */
public class ClaudeUnavailableException extends RuntimeException {

    public ClaudeUnavailableException(String message) {
        super(message);
    }

    public ClaudeUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
