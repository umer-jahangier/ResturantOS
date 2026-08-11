package io.restaurantos.auth.service;

import io.restaurantos.auth.dto.request.LoginRequest;
import io.restaurantos.auth.dto.response.LoginResponse;
import io.restaurantos.auth.dto.response.TokenResponse;
import io.restaurantos.auth.entity.UserEntity;

public interface AuthService {

    LoginResult login(LoginRequest request, String userAgent, String ip);

    RefreshResult refresh(String rawRefreshToken);

    void logout(String rawRefreshToken);

    /** Password-only identity check backing the unauthenticated TOTP bootstrap. */
    UserEntity authenticateForTotpBootstrap(String tenantSlug, String email, String password, String ip);

    /**
     * @param refreshTtlSeconds {@code Max-Age} for the refresh cookie. Carried with the token since
     *        16b-01 rather than read from {@code jwtProperties} by the controller, because the two
     *        login paths no longer agree on it: a tenant session gets 7 days and a platform session
     *        gets 30 minutes. Had the controller kept choosing, the platform cookie would have
     *        silently outlived its session row by 335×, and the mismatch would only ever have
     *        surfaced as a puzzling 401 long after the cookie was written.
     */
    record LoginResult(LoginResponse body, String refreshToken, long refreshTtlSeconds) {}

    /**
     * The outcome of a refresh, plus whatever cookie the caller must now write (16b-01).
     *
     * <h3>Why a refresh can hand back a token at all</h3>
     *
     * <p>Before 16b-01 this was a bare {@link TokenResponse}, because a refresh never changed the
     * refresh cookie: the tenant path's token is reusable for its whole 7 days. A PLATFORM session
     * is single-use — redeeming it revokes it — so the response has to carry the successor, or the
     * browser would be left holding a token that has just been invalidated.
     *
     * @param rotatedRefreshToken the successor token, or {@code null} when the presented one is
     *                            still valid and no cookie should be written. <b>Null on every
     *                            tenant refresh</b>, which is what keeps that path's observable
     *                            behaviour identical to what it was.
     * @param rotatedTtlSeconds   {@code Max-Age} for the successor cookie; meaningless and ignored
     *                            when {@code rotatedRefreshToken} is null
     */
    record RefreshResult(TokenResponse body, String rotatedRefreshToken, long rotatedTtlSeconds) {
        /** True when the caller must write a new {@code refresh_token} cookie. */
        public boolean rotated() {
            return rotatedRefreshToken != null;
        }
    }
}
