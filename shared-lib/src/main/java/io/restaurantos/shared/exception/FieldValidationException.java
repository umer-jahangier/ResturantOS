package io.restaurantos.shared.exception;

import java.util.List;
import java.util.Objects;

/**
 * A domain rule refused the request, and the rule knows which input to blame.
 *
 * <h2>Why this exists</h2>
 *
 * <p>Bean validation already produced {@code 400 VALIDATION_FAILED} with
 * {@code details:[{field,issue}]}, and the web client already parsed that into {@code fieldErrors}.
 * Business rules had no equivalent: they threw {@code IllegalArgumentException} or
 * {@code IllegalStateException}, which reached the catch-all and came back as
 * {@code 500 INTERNAL_ERROR — An unexpected error occurred}. A form could not bind such a refusal
 * to an input, so the user was told the server had broken when in fact one field was wrong.
 *
 * <p>This carries the same {@code (field, instruction)} pairs into the same envelope, so the client
 * needs no second parser and every service inherits the behaviour from shared-lib without editing
 * its own handler.
 *
 * <h2>Why 422 and not 400</h2>
 *
 * <p>400 stays reserved for bean validation — the request was malformed. 422 means the request was
 * syntactically well-formed, passed every declarative constraint, and was refused by a rule that
 * needed to look at stored data (a balance, a branch, an existing row). Keeping the two apart lets
 * a client tell "your JSON is wrong" from "your business input is wrong" without reading prose.
 *
 * <h2>Writing the instruction</h2>
 *
 * <p>The instruction is read by the person filling the form, so it names the rule and the way out,
 * and it includes the number where the rule has one — "Only 3.5 days remain of Annual leave; you
 * requested 5" is actionable where "Insufficient leave balance" is not. It must never contain the
 * database's own vocabulary: a table, column or constraint name in an error toast is a schema leak
 * and tells the user nothing they can act on. {@code FieldErrorContractTest} enforces that.
 *
 * @see DuplicateValueException for the narrower case of colliding with an existing row
 */
public class FieldValidationException extends RestaurantOsException {

    /**
     * One refused input.
     *
     * @param field       the path the client binds to, matching the request DTO's own field name
     *                    (dotted for nested paths, and dotted for INDEXED ones too —
     *                    {@code slabs.2.ratePct}, not {@code slabs[2].ratePct}) so a form can find
     *                    the input without a translation table. The bracket spelling is what
     *                    Spring's own binding result produces and what
     *                    {@code GlobalExceptionHandler.toClientPath} normalises away; the web
     *                    client splits a path on "." and cannot resolve a bracketed segment
     * @param instruction what the person filling the form should do about it
     */
    public record Violation(String field, String instruction) {
        public Violation {
            Objects.requireNonNull(field, "field");
            Objects.requireNonNull(instruction, "instruction");
        }
    }

    private final transient List<Violation> violations;

    /** The common case: one rule, one field. The exception message is the instruction itself. */
    public FieldValidationException(String code, String field, String instruction) {
        this(code, instruction, List.of(new Violation(field, instruction)));
    }

    /** As above, preserving the underlying failure for the log without exposing it to the caller. */
    public FieldValidationException(String code, String field, String instruction, Throwable cause) {
        this(code, instruction, List.of(new Violation(field, instruction)), cause);
    }

    /**
     * Several rules at once. Report them together rather than one per round trip — a form that
     * surfaces its second error only after the first is fixed is the experience this phase exists
     * to remove.
     *
     * @param message a summary for callers that render only the top-level message; the per-field
     *                instructions are the part a form actually uses
     */
    public FieldValidationException(String code, String message, List<Violation> violations) {
        super(code, message);
        this.violations = List.copyOf(violations);
    }

    public FieldValidationException(String code, String message, List<Violation> violations, Throwable cause) {
        super(code, message, cause);
        this.violations = List.copyOf(violations);
    }

    /** Immutable, in the order supplied — the order the form will render them in. */
    public List<Violation> getViolations() {
        return violations;
    }
}
