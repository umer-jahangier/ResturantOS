package io.restaurantos.platform.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

import java.util.List;

/**
 * A tier change was refused because the target tier's limits fall below what the tenant is already
 * using (13-14, threat T-13-14-E).
 *
 * <p><b>Why this is a refusal and not a warning.</b> Applying the lower numbers anyway leaves a
 * tenant persistently over its own limit. Nothing fails at the moment of the downgrade; it fails
 * days later, at whichever unrelated call site next asks "is this tenant within its branch cap",
 * and by then the downgrade is not an obvious suspect. The SuperAdmin who wants it anyway says so
 * with {@code force: true}, which is recorded in the log line.
 *
 * <p>The message names every violated limit WITH the current usage, because "over the limit" alone
 * does not tell an operator whether to raise the tier or remove a branch.
 */
public class TierLimitExceededException extends RestaurantOsException {

    /**
     * @param limit    which ceiling was breached, in the tenant's own vocabulary ("branches")
     * @param usage    what the tenant is using now
     * @param ceiling  what the target tier allows
     */
    public record Violation(String limit, long usage, int ceiling) {
        @Override
        public String toString() {
            return limit + ": in use " + usage + ", " + "target tier allows " + ceiling;
        }
    }

    private final transient List<Violation> violations;

    public TierLimitExceededException(String targetTier, List<Violation> violations) {
        super("TIER_LIMIT_EXCEEDED",
            "Downgrade to " + targetTier + " refused — the tenant is already over the target tier's "
                + "limits (" + violations.stream().map(Violation::toString).reduce((a, b) -> a + "; " + b).orElse("")
                + "). Reduce usage first, or repeat the request with force=true to apply the tier anyway.");
        this.violations = List.copyOf(violations);
    }

    public List<Violation> violations() {
        return violations;
    }
}
