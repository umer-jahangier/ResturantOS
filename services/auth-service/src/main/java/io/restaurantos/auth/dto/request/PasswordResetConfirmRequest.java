package io.restaurantos.auth.dto.request;

import io.restaurantos.shared.validation.StrongPassword;
import jakarta.validation.constraints.NotBlank;

/**
 * Completes a password reset.
 *
 * <p>{@code newPassword} carries the shared {@link StrongPassword} rule. It used to carry
 * {@code @Size(min = 8, max = 128)}, which was the entirety of this platform's password policy —
 * on this one field, in this one service.
 */
public record PasswordResetConfirmRequest(
    @NotBlank String token,
    @NotBlank @StrongPassword String newPassword
) {}
