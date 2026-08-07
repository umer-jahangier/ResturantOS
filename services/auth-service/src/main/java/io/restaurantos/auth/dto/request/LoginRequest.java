package io.restaurantos.auth.dto.request;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

/**
 * Credentials for a login.
 *
 * <p><b>{@code password} must NOT carry {@code @StrongPassword}, and this comment exists so that
 * the omission is not later read as an oversight and "fixed".</b> This field carries a credential
 * the user already has. Validating it against a policy that did not exist when it was chosen would
 * refuse the login of every account whose password predates the policy — before the encoder is
 * ever consulted, so not even the correct password would get in. That is a total, self-inflicted
 * lockout delivered as a 400, and it is the class of failure this phase exists to repair rather
 * than to add to. The strength rule belongs on the fields where a password is CHOSEN
 * ({@code PasswordResetConfirmRequest.newPassword}, {@code ChangePasswordRequest.newPassword}),
 * which is where it is.
 */
public record LoginRequest(
    @NotBlank @Email String email,
    @NotBlank String password,
    String tenantSlug,
    String totpCode
) {

    /**
     * {@code tenantSlug} lost its {@code @NotBlank} in 16a-01, and that omission is the plan.
     *
     * <p>Requiring it made every human type an identifier they had no way to know, and it is why the
     * SuperAdmin — who belongs to no tenant at all — had no login form to use. The slug is now a
     * <b>hint</b>: supplied by a subdomain or {@code ?tenant=} when one is available, absent
     * otherwise, and in the absent case the server resolves it from the credential.
     *
     * <p><b>Absent does not mean "any tenant".</b> {@code LoginIdentityResolver} names a tenant only
     * where the submitted password verified against that tenant's row. The removal of this
     * annotation widens what may be SUBMITTED, not what may be entered.
     *
     * <p>Blank and whitespace-only are normalised to absent here rather than at the four call sites
     * that read it, so {@code {"tenantSlug": ""}} and an omitted field cannot take different paths —
     * a distinction no client intends to draw and every client would eventually draw by accident.
     */
    public boolean hasTenantHint() {
        return tenantSlug != null && !tenantSlug.isBlank();
    }

    /** The trimmed hint, or null when none was supplied. */
    public String tenantHint() {
        return hasTenantHint() ? tenantSlug.trim() : null;
    }

    /** This request with an explicit slug — how the unified path re-enters the tenant login. */
    public LoginRequest withTenantSlug(String slug) {
        return new LoginRequest(email, password, slug, totpCode);
    }
}
