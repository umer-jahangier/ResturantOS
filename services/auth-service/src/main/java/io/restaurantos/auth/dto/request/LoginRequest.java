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
    @NotBlank String tenantSlug,
    String totpCode
) {}
