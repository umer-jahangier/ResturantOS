package io.restaurantos.nlq.validation;

/**
 * Thrown by any stage of {@link SqlValidationPipeline} that refuses to let a query proceed.
 *
 * <p><b>Never</b> carries the offending SQL back to the client verbatim — that would hand an
 * attacker probing the validator a free oracle ("which part of my payload got rejected?"). The
 * safe message is a short, generic, human-readable string. The offending SQL MAY be logged
 * server-side (by the caller of the pipeline, in 12-07) for audit, never echoed in the response.
 */
public class NlqRejectedException extends RuntimeException {

    private final RejectionCode code;

    public NlqRejectedException(RejectionCode code, String safeMessage) {
        super(safeMessage);
        this.code = code;
    }

    public RejectionCode code() {
        return code;
    }
}
