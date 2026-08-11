package io.restaurantos.shared.exception;

/**
 * The request was well-formed and the caller was entitled to make it, but the record is in a state
 * that does not allow it. Mapped to 409 with no field path — there is no input to bind to, because
 * the fault is the stored record's state and not anything the user typed.
 */
public class StateInvalidException extends RestaurantOsException {

    public StateInvalidException(String message) {
        super("STATE_INVALID", message);
    }

    /**
     * As above, with a specific code so a client can distinguish two refusals that are both 409.
     *
     * <p>Added for D-35-03: "only a CALCULATED run can be approved" and "this run has no branch"
     * are different problems with different fixes, and a screen that receives {@code STATE_INVALID}
     * for both can only render the prose. A code lets it offer the right next action — and lets a
     * payroll screen tell "configure the fiscal year" from "recalculate the run".
     *
     * <p>The generic constructor above still yields {@code STATE_INVALID}, so all 42 existing
     * throw sites are unaffected.
     */
    public StateInvalidException(String code, String message) {
        super(code, message);
    }
}
