package io.restaurantos.auth.dto.request;

import io.restaurantos.shared.validation.StrongPassword;
import jakarta.validation.constraints.NotBlank;

/**
 * The body of {@code POST /api/v1/auth/change-password/forced} — the one password-mutating endpoint
 * that is public at the gateway.
 *
 * <p><b>Two proofs, not one, and that is the entire justification for it being public.</b> The
 * endpoint has to be reachable without a token, because the whole point is that the caller cannot
 * obtain one. So it demands both a single-use change token — which is only ever handed to someone
 * who has just presented the correct password at {@code /login} — and that same current password
 * again. Either alone would be a weaker gate than the login it stands in for: the token alone would
 * make a leaked refusal response an account takeover, and the password alone would make this a
 * second login endpoint with none of login's lockout accounting.
 *
 * <p><b>There is deliberately no field naming the account</b>, for the same reason
 * {@link ChangePasswordRequest} has none. The user id comes from the redeemed token and from
 * nowhere else, so there is nowhere to put a target even if a future authorization bug wanted one.
 *
 * <p>{@code currentPassword} is only {@code @NotBlank}: it is an existing credential, and the
 * strength rule must never be applied to one (see {@code LoginRequest}). {@code newPassword}
 * carries {@code @StrongPassword} because it is a password being chosen — and because bean
 * validation runs before this request reaches any service, a new password that fails the policy is
 * refused with a 400 while the change token stays unspent. A user who fumbles the rules must not be
 * locked out of their own recovery.
 */
public record ForcedPasswordChangeRequest(
    @NotBlank String changeToken,
    @NotBlank String currentPassword,
    @NotBlank @StrongPassword String newPassword
) {}
