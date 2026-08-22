package io.restaurantos.platform.exception;

import io.restaurantos.shared.exception.StateInvalidException;

import java.util.List;

/**
 * A plan change was refused because the target plan's ceilings fall below what the tenant is
 * MEASURABLY already using.
 *
 * <h3>Why this exists beside {@link TierLimitExceededException} instead of reusing it</h3>
 *
 * <p>They are refusals of different operations with different remedies, and a console that receives
 * one code for both can only render the prose. {@code TIER_LIMIT_EXCEEDED} means "the tier you
 * asked for is too small"; the fix is a different tier or {@code force}. This one means "the PLAN
 * you asked for is too small" — and a plan's ceilings are not necessarily its tier's, because a
 * bespoke plan can carry negotiated numbers. The next action differs.
 *
 * <h3>Only MEASURABLE dimensions can produce a violation</h3>
 *
 * <p>This is the honest half. {@code SubscriptionLimitService} evaluates each ceiling against
 * {@code UsageService.meters}, which reports every dimension as counted / not-metered / unreadable
 * and never defaults an unknown to zero. A dimension nobody counts CANNOT appear here, because a
 * refusal derived from an unmeasured number is a refusal derived from a guess — and, symmetrically,
 * a plan change that is NOT refused is not a statement that the tenant fits. It is a statement that
 * nothing we can measure says otherwise. The response says which is which.
 *
 * <p>Extends {@link StateInvalidException} so shared-lib's {@code GlobalExceptionHandler} maps it to
 * <b>409 CONFLICT</b> carrying this code, with no new handler method anywhere: the request is
 * well-formed and the caller is entitled to make it — what is wrong is the state of the world.
 */
public class SubscriptionLimitExceededException extends StateInvalidException {

    /**
     * @param limit   which ceiling was breached, in the tenant's own vocabulary ("branches")
     * @param usage   what the tenant is measurably using now
     * @param ceiling what the target plan allows
     */
    public record Violation(String limit, long usage, int ceiling) {
        @Override
        public String toString() {
            return limit + ": in use " + usage + ", target plan allows " + ceiling;
        }
    }

    private final transient List<Violation> violations;

    public SubscriptionLimitExceededException(String planCode, List<Violation> violations) {
        super("SUBSCRIPTION_LIMIT_EXCEEDED",
            "Change to plan '" + planCode + "' refused — the tenant is already over that plan's "
                + "limits (" + violations.stream().map(Violation::toString)
                    .reduce((a, b) -> a + "; " + b).orElse("")
                + "). Reduce usage first, or repeat the request with force=true to apply the plan "
                + "anyway. Only measurable dimensions are checked; see the limits endpoint for "
                + "which ones those are.");
        this.violations = List.copyOf(violations);
    }

    public List<Violation> violations() {
        return violations;
    }
}
