package io.restaurantos.auth.exception;

/**
 * The caller's permissions demand a second factor and they have never enrolled one.
 *
 * <p>Distinct from {@link TotpRequiredException} so the client can tell the two apart: that one
 * means "type your code", this one means "you have no authenticator yet — enrol at
 * {@code /api/v1/auth/2fa/bootstrap}". Collapsing both into TOTP_REQUIRED left the user staring at
 * a code prompt they had no way to satisfy.
 *
 * <h3>Why the refusal carries the tenant slug (14b / GA-008)</h3>
 *
 * <p>The enrolment endpoint this refusal points at requires a {@code tenantSlug}, and after
 * 16a-01's email-first login <b>the browser does not have one</b> — not having to know it is the
 * entire point of 16a. Without the slug the client can name the deadlock but cannot break it,
 * which is exactly the state the audit found: a provisioned owner met
 * {@code 401 TOTP_ENROLLMENT_REQUIRED} and the UI told them to "ask an administrator to complete
 * enrolment", when the owner IS the only account on the tenant. A brand-new restaurant could not
 * get in at all.
 *
 * <p>The slug travels in {@code ApiError.details}, exactly as the change token does on
 * {@code 403 PASSWORD_CHANGE_REQUIRED}, so every client keeps one error parser instead of two.
 *
 * <p><b>Disclosure rule.</b> This exception is thrown from {@code enforceTotpStepUp}, which runs
 * only <i>after</i> {@code passwordEncoder.matches} has succeeded. The slug is therefore returned
 * solely to a caller who has already PROVEN the password for that account — the same rule under
 * which {@code TenantSelectionRequiredException} returns a list of slugs, and the same one under
 * which {@code AccountLockedException} admits that an account exists. A caller who has not proven
 * the password gets the generic {@code 401 UNAUTHENTICATED} and learns nothing.
 */
public class TotpEnrollmentRequiredException extends RuntimeException {

    private final String tenantSlug;

    public TotpEnrollmentRequiredException(String message, String tenantSlug) {
        super(message);
        this.tenantSlug = tenantSlug;
    }

    /** The tenant the credential authenticated against; the enrolment call needs it. */
    public String tenantSlug() {
        return tenantSlug;
    }
}
