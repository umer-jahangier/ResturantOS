package io.restaurantos.auth.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

/**
 * A privilege-bearing internal write arrived without {@code X-Acting-User-Id}.
 *
 * <p>Every write on {@code /internal/auth/**} that can change WHAT A USER MAY DO has to know who is
 * asking, because the rule it must enforce — you may not grant authority you do not hold — is a
 * statement about the asker. Before this, {@code /internal/auth/**} carried no identity at all, so
 * auth-service could not enforce it and the check could only live in the calling service, where
 * anything reaching the internal port bypasses it.
 *
 * <p><b>The header is required, and its absence is a refusal rather than a skipped check.</b> An
 * optional header that disables a security check when omitted fails open, silently, and would be
 * omitted by the first caller written by someone who had not read this class. 13-07 named that
 * failure mode explicitly when it recommended this contract.
 *
 * <p>Deliberately distinct from {@code INTERNAL_AUTH_REQUIRED} (the shared-secret gate) and from
 * {@code ROLE_CEILING_EXCEEDED} (identity present, authority insufficient), so a caller can tell
 * "you did not say who you are" from "you may not do this".
 */
public class ActingUserRequiredException extends RestaurantOsException {

    public ActingUserRequiredException(String operation) {
        super("ACTING_USER_REQUIRED",
            "The X-Acting-User-Id header is required on " + operation
                + ": the acting user's own authority bounds what this request may grant");
    }
}
