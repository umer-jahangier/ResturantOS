package io.restaurantos.nlq.quota;

/**
 * Thrown when Redis (the sole quota-tracking store) cannot be reached. NLQ quota enforcement MUST
 * fail closed — an unmetered LLM endpoint is a billing incident, not a graceful degradation. The
 * controller (12-07) maps this to HTTP 503.
 */
public class QuotaServiceUnavailableException extends RuntimeException {
    public QuotaServiceUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
