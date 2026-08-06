package io.restaurantos.auth.exception;

import java.time.Instant;

/**
 * The credential was correct, and the account may not have a token until its password is changed
 * (D-17).
 *
 * <p><b>Why a refusal rather than a restricted token.</b> Two designs were available: mint an
 * access token with an emptied permission list and a marker claim, or refuse the login outright and
 * hand back a token scoped to one operation. An emptied-permission token is still a structurally
 * valid access token to every filter, gateway rule and {@code @PreAuthorize} expression in the
 * system, so its safety would depend on every current and future authorization check treating an
 * empty permission list as a refusal. Nobody can hold that invariant across twenty services. A
 * refusal is checkable in exactly one place, which is here.
 *
 * <p>This is thrown <i>after</i> the password comparison succeeds and the failed-attempt counter is
 * cleared, which is what keeps it from becoming an account-existence oracle: a wrong password for a
 * flagged account produces the ordinary generic authentication failure, indistinguishable from a
 * wrong password for any other account or for no account at all.
 *
 * <p>It carries no email, no user id and no tenant id — only the change token it just minted and
 * that token's deadline. The message is a constant.
 */
public class PasswordChangeRequiredException extends RuntimeException {

    private final transient String changeToken;
    private final transient Instant expiresAt;

    public PasswordChangeRequiredException(String changeToken, Instant expiresAt) {
        super("Password change required before this account can be used");
        this.changeToken = changeToken;
        this.expiresAt = expiresAt;
    }

    /**
     * The single-use token that {@code POST /api/v1/auth/change-password/forced} will accept, once,
     * alongside the current password.
     */
    public String changeToken() {
        return changeToken;
    }

    public Instant expiresAt() {
        return expiresAt;
    }
}
