package io.restaurantos.auth.service;

import io.restaurantos.auth.dto.request.LoginRequest;
import io.restaurantos.auth.dto.response.LoginResponse;
import io.restaurantos.auth.dto.response.TokenResponse;

public interface AuthService {

    LoginResult login(LoginRequest request, String userAgent, String ip);

    TokenResponse refresh(String rawRefreshToken);

    void logout(String rawRefreshToken);

    record LoginResult(LoginResponse body, String refreshToken) {}
}
