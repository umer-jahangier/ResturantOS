package io.restaurantos.auth.controller;

import io.restaurantos.auth.config.AuthJwtProperties;
import io.restaurantos.auth.dto.request.LoginRequest;
import io.restaurantos.auth.dto.response.LoginResponse;
import io.restaurantos.auth.dto.response.TokenResponse;
import io.restaurantos.auth.exception.AuthenticationFailedException;
import io.restaurantos.auth.service.AuthService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    static final String REFRESH_COOKIE = "refresh_token";

    private final AuthService authService;
    private final AuthJwtProperties jwtProperties;

    public AuthController(AuthService authService, AuthJwtProperties jwtProperties) {
        this.authService = authService;
        this.jwtProperties = jwtProperties;
    }

    @PostMapping("/login")
    public ResponseEntity<ApiResponse<LoginResponse>> login(@Valid @RequestBody LoginRequest request,
                                                            HttpServletRequest httpRequest) {
        AuthService.LoginResult result = authService.login(
            request, httpRequest.getHeader("User-Agent"), clientIp(httpRequest));
        return ResponseEntity.ok()
            .header(HttpHeaders.SET_COOKIE, refreshCookie(result.refreshToken(), jwtProperties.getRefreshTtlSeconds()).toString())
            .body(ApiResponse.ok(result.body()));
    }

    @PostMapping("/refresh")
    public ResponseEntity<ApiResponse<TokenResponse>> refresh(HttpServletRequest httpRequest) {
        String token = readRefreshCookie(httpRequest);
        TokenResponse body = authService.refresh(token);
        return ResponseEntity.ok(ApiResponse.ok(body));
    }

    @PostMapping("/logout")
    public ResponseEntity<ApiResponse<Void>> logout(HttpServletRequest httpRequest) {
        authService.logout(readRefreshCookie(httpRequest));
        ResponseCookie cleared = ResponseCookie.from(REFRESH_COOKIE, "")
            .httpOnly(true).secure(true).sameSite("Strict")
            .path("/api/v1/auth").maxAge(0).build();
        return ResponseEntity.ok()
            .header(HttpHeaders.SET_COOKIE, cleared.toString())
            .body(ApiResponse.ok(null));
    }

    static ResponseCookie refreshCookie(String value, long maxAgeSeconds) {
        return ResponseCookie.from(REFRESH_COOKIE, value)
            .httpOnly(true)
            .secure(true)
            .sameSite("Strict")
            .path("/api/v1/auth")
            .maxAge(maxAgeSeconds)
            .build();
    }

    private static String readRefreshCookie(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            throw new AuthenticationFailedException("Missing refresh token");
        }
        for (Cookie cookie : cookies) {
            if (REFRESH_COOKIE.equals(cookie.getName())) {
                return cookie.getValue();
            }
        }
        throw new AuthenticationFailedException("Missing refresh token");
    }

    private static String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
