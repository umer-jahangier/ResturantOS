package io.restaurantos.auth.exception;

/**
 * The caller's permissions demand a second factor and they have never enrolled one.
 *
 * <p>Distinct from {@link TotpRequiredException} so the client can tell the two apart: that one
 * means "type your code", this one means "you have no authenticator yet — enrol at
 * {@code /api/v1/auth/2fa/bootstrap}". Collapsing both into TOTP_REQUIRED left the user staring at
 * a code prompt they had no way to satisfy.
 */
public class TotpEnrollmentRequiredException extends RuntimeException {
    public TotpEnrollmentRequiredException(String message) {
        super(message);
    }
}
