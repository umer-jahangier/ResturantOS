package io.restaurantos.auth.controller;

import io.restaurantos.auth.dto.request.ChangePasswordRequest;
import io.restaurantos.auth.dto.request.ForcedPasswordChangeRequest;
import io.restaurantos.auth.exception.AuthenticationFailedException;
import io.restaurantos.auth.service.PasswordChangeService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.security.JwtClaims;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code POST /api/v1/auth/change-password} — a logged-in user changes their own password.
 *
 * <p><b>Not public, at either layer, and that is not an oversight to be tidied.</b> It is absent
 * from this service's {@code permitAll} list, so {@code SecurityConfig}'s catch-all
 * {@code .anyRequest().authenticated()} covers it; and it is absent from the gateway's
 * {@code PUBLIC_PATHS}, where plan 13-01 registered only the FULLY QUALIFIED
 * {@code /api/v1/auth/change-password/forced} that 13-08 adds. {@code isPublicPath} matches with
 * {@code startsWith}, so registering the bare path there would silently expose this endpoint too.
 *
 * <p>The subject is read from the authenticated principal. There is no path variable and no body
 * field naming an account — see {@link ChangePasswordRequest}.
 */
@RestController
@RequestMapping("/api/v1/auth")
public class PasswordChangeController {

    private final PasswordChangeService passwordChangeService;

    public PasswordChangeController(PasswordChangeService passwordChangeService) {
        this.passwordChangeService = passwordChangeService;
    }

    @PostMapping("/change-password")
    public ResponseEntity<ApiResponse<Void>> changePassword(@Valid @RequestBody ChangePasswordRequest request) {
        JwtClaims claims = currentClaims();
        passwordChangeService.changeOwnPassword(
            claims.tenantId(), claims.subject(), request.currentPassword(), request.newPassword());
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    /**
     * {@code POST /api/v1/auth/change-password/forced} — the way past the forced-change gate, for a
     * caller who by definition has no token (D-17).
     *
     * <p><b>Public, at both layers, and deliberately so.</b> It is in this service's
     * {@code permitAll} list as an exact path pinned to POST, and it is the ONLY password path in
     * the gateway's {@code PUBLIC_PATHS} — registered there by 13-01 in its fully qualified form
     * because {@code isPublicPath} matches with {@code startsWith}, so the bare
     * {@code /api/v1/auth/change-password} would have swept the authenticated sibling above in with
     * it. Neither list may ever be shortened to the bare path.
     *
     * <p>Being public, its own proof has to be at least as strong as the login it replaces, which is
     * why it takes a single-use change token AND the current password — see
     * {@link ForcedPasswordChangeRequest}. It reads no principal, because there is none to read.
     */
    @PostMapping("/change-password/forced")
    public ResponseEntity<ApiResponse<Void>> forcedChangePassword(
            @Valid @RequestBody ForcedPasswordChangeRequest request) {
        passwordChangeService.changeForcedPassword(
            request.changeToken(), request.currentPassword(), request.newPassword());
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    /**
     * The security chain already refuses an unauthenticated request, so reaching this method with
     * no principal means the chain was misconfigured. Failing with the authentication exception
     * rather than a {@code NullPointerException} keeps that a 401 instead of a 500 — the caller's
     * situation is the same either way, and a 500 on a credential endpoint is a worse thing to
     * page on than it is to read.
     */
    private JwtClaims currentClaims() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof JwtClaims claims)) {
            throw new AuthenticationFailedException("Invalid credentials");
        }
        return claims;
    }
}
