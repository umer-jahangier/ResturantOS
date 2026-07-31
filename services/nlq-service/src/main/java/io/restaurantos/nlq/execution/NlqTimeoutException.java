package io.restaurantos.nlq.execution;

/**
 * Thrown when the validated SQL fails to complete within the configured wall-clock ceiling
 * ({@code restaurantos.nlq.timeout-seconds}, default 5s) — either because the client-side JDBC
 * {@code queryTimeout} fired, or because the {@code nlq_readonly} ClickHouse profile's
 * {@code max_execution_time} killed the query server-side (plan 12-02, empirically proven real
 * wall-clock, not just a config value). The controller (12-07) maps this to a 400
 * {@code QUERY_TIMEOUT}.
 */
public class NlqTimeoutException extends RuntimeException {
    public NlqTimeoutException(String message) {
        super(message);
    }

    public NlqTimeoutException(String message, Throwable cause) {
        super(message, cause);
    }
}
