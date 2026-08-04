package io.restaurantos.auth.dto.request;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

/**
 * Credentials for the unauthenticated TOTP bootstrap. Carries the same three fields as a login
 * because the endpoint re-authenticates on every call — the password IS the authorization.
 *
 * <p>{@code code} is null for {@code /2fa/bootstrap} (which issues the secret) and carries the
 * first generated code for {@code /2fa/bootstrap/verify} (which activates it).
 */
public record TotpBootstrapRequest(
    @NotBlank @Email String email,
    @NotBlank String password,
    @NotBlank String tenantSlug,
    String code) {
}
