package io.restaurantos.auth.service;

import io.restaurantos.auth.dto.request.LoginRequest;
import io.restaurantos.auth.dto.response.LoginResponse;
import io.restaurantos.auth.dto.response.TokenResponse;
import io.restaurantos.auth.entity.UserEntity;

public interface AuthService {

    LoginResult login(LoginRequest request, String userAgent, String ip);

    TokenResponse refresh(String rawRefreshToken);

    void logout(String rawRefreshToken);

    /** Password-only identity check backing the unauthenticated TOTP bootstrap. */
    UserEntity authenticateForTotpBootstrap(String tenantSlug, String email, String password, String ip);

    record LoginResult(LoginResponse body, String refreshToken) {}
}
