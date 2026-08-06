package io.restaurantos.auth.dto.request;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

/**
 * Credentials for the unauthenticated TOTP bootstrap. Carries the same three fields as a login
 * because the endpoint re-authenticates on every call — the password IS the authorization.
 *
 * <p>{@code code} is null for {@code /2fa/bootstrap} (which issues the secret) and carries the
 * first generated code for {@code /2fa/bootstrap/verify} (which activates it).
 *
 * <p><b>{@code password} must NOT carry {@code @StrongPassword}</b>, for the same reason
 * {@code LoginRequest.password} must not: it is an EXISTING credential being presented, not a new
 * one being chosen. Enrolling a second factor is precisely the moment a legacy password must still
 * work — refusing it here would lock the oldest accounts out of TOTP enrolment, and 13-02's
 * step-up finding means tenant admins are exactly those accounts.
 */
public record TotpBootstrapRequest(
    @NotBlank @Email String email,
    @NotBlank String password,
    @NotBlank String tenantSlug,
    String code) {
}
