package io.restaurantos.nlq.execution;

/**
 * Thrown when a result would exceed the configured row cap ({@code restaurantos.nlq.max-result-rows})
 * — either because the {@code nlq_readonly} ClickHouse profile threw its own
 * {@code TOO_MANY_ROWS_OR_BYTES} overflow (plan 12-02: {@code result_overflow_mode = 'throw' CONST}),
 * or because this executor's own client-side check caught more rows than the cap before returning
 * them.
 *
 * <p><b>A capped result is an ERROR, never a silent truncation.</b> A truncated result that looks
 * complete is worse than an outright rejection — the caller would act on incomplete data believing
 * it whole. This exception exists precisely so that path can never happen.
 */
public class NlqRowCapExceededException extends RuntimeException {
    public NlqRowCapExceededException(String message) {
        super(message);
    }

    public NlqRowCapExceededException(String message, Throwable cause) {
        super(message, cause);
    }
}
