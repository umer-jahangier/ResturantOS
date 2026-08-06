package io.restaurantos.auth.dto.request;

import io.restaurantos.shared.validation.StrongPassword;
import jakarta.validation.constraints.NotBlank;

/**
 * Self-service password change.
 *
 * <p><b>There is deliberately no field naming the account.</b> The user id comes from the
 * authenticated principal and from nowhere else. A change-password endpoint that accepts a target
 * is a horizontal-privilege-escalation endpoint one authorization bug away from letting any
 * logged-in user take over any other account, and the cheapest way to never have that bug is to
 * have nowhere to put the target. Unknown JSON properties are ignored by the deserialiser, so a
 * caller may send {@code userId} and it does nothing — asserted in {@code PasswordChangeIT}.
 *
 * <p>{@code currentPassword} is only {@code @NotBlank}: it is an existing credential, and the
 * strength rule must never be applied to one (see {@code LoginRequest}).
 */
public record ChangePasswordRequest(
    @NotBlank String currentPassword,
    @NotBlank @StrongPassword String newPassword
) {}
