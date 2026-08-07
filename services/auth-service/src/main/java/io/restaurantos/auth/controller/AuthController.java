package io.restaurantos.auth.controller;

import io.restaurantos.auth.config.AuthCookieProperties;
import io.restaurantos.auth.config.AuthJwtProperties;
import io.restaurantos.auth.dto.request.LoginRequest;
import io.restaurantos.auth.dto.response.LoginResponse;
import io.restaurantos.auth.dto.response.TenantBrandingResponse;
import io.restaurantos.auth.dto.response.TokenResponse;
import io.restaurantos.auth.entity.AuthTenantEntity;
import io.restaurantos.auth.exception.AuthenticationFailedException;
import io.restaurantos.auth.repository.AuthTenantRepository;
import io.restaurantos.auth.service.AuthService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Optional;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    static final String REFRESH_COOKIE = "refresh_token";

    private final AuthService authService;
    private final AuthJwtProperties jwtProperties;
    private final AuthCookieProperties cookieProperties;
    private final AuthTenantRepository authTenantRepository;

    public AuthController(AuthService authService,
                          AuthJwtProperties jwtProperties,
                          AuthCookieProperties cookieProperties,
                          AuthTenantRepository authTenantRepository) {
        this.authService = authService;
        this.jwtProperties = jwtProperties;
        this.cookieProperties = cookieProperties;
        this.authTenantRepository = authTenantRepository;
    }

    /**
     * Public branding lookup: slug → {slug, name}, and (14b/GA-032) tenant id → the same pair.
     *
     * <h3>Why the id form was added</h3>
     *
     * <p>The app shell had no way to name the tenant a user is signed into. The access token
     * carries {@code tenant_id} but no name or slug, {@code LoginResponse} carries neither, and
     * {@code /api/v1/branches/mine} returns branch names only. So {@code use-tenant-brand.ts}
     * resolved the brand from {@code NEXT_PUBLIC_DEFAULT_TENANT_SLUG} — a BUILD-TIME environment
     * variable — and every signed-in user of every tenant saw whichever brand that variable
     * happened to name. Live, {@code owner@terrace.local} read "Lume" in the sidebar while the
     * branch chip beside it correctly read "Floating Terrace HQ".
     *
     * <p>An id lookup is the smallest thing that makes the shell read from the SESSION. The
     * alternative — a {@code tenant_name} JWT claim — puts a mutable display string into a signed
     * credential, where a rebrand cannot take effect until every token expires.
     *
     * <h3>Disclosure</h3>
     *
     * <p>No new class of information: this endpoint already returns {@code {slug, name}} of an
     * ACTIVE tenant to an unauthenticated caller, and it is registered in the gateway's
     * {@code PUBLIC_PATHS} so the login page can brand itself before anyone has a token. The id
     * form is strictly HARDER to enumerate than the slug form it joins — {@code floating-terrace}
     * is guessable, a v4 UUID is not. Suspended and pending tenants stay invisible through both.
     */
    @GetMapping("/tenants/{slugOrId}")
    public ResponseEntity<ApiResponse<TenantBrandingResponse>> tenantBranding(@PathVariable String slugOrId) {
        String key = slugOrId.trim();
        return resolveTenant(key)
            .filter(t -> "ACTIVE".equals(t.getStatus()))
            .map(t -> ResponseEntity.ok(ApiResponse.ok(
                new TenantBrandingResponse(t.getSlug(), t.getName()))))
            .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Slug first, then id. A slug can never parse as a UUID (slugs are lowercase-hyphen and are
     * minted from a brand name), so the two namespaces cannot collide and the order is a matter of
     * cost, not correctness — the overwhelmingly common caller is the login page, with a slug.
     */
    private Optional<AuthTenantEntity> resolveTenant(String key) {
        Optional<AuthTenantEntity> bySlug = authTenantRepository.findBySlug(key);
        if (bySlug.isPresent()) {
            return bySlug;
        }
        try {
            return authTenantRepository.findById(UUID.fromString(key));
        } catch (IllegalArgumentException notAUuid) {
            return Optional.empty();
        }
    }

    @PostMapping("/login")
    public ResponseEntity<ApiResponse<LoginResponse>> login(@Valid @RequestBody LoginRequest request,
                                                            HttpServletRequest httpRequest) {
        AuthService.LoginResult result = authService.login(
            request, httpRequest.getHeader("User-Agent"), clientIp(httpRequest));
        return ResponseEntity.ok()
            .header(HttpHeaders.SET_COOKIE, refreshCookie(result.refreshToken(), jwtProperties.getRefreshTtlSeconds(), cookieProperties.isSecure()).toString())
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
            .httpOnly(true).secure(cookieProperties.isSecure()).sameSite("Strict")
            .path("/api/v1/auth").maxAge(0).build();
        return ResponseEntity.ok()
            .header(HttpHeaders.SET_COOKIE, cleared.toString())
            .body(ApiResponse.ok(null));
    }

    static ResponseCookie refreshCookie(String value, long maxAgeSeconds, boolean secure) {
        return ResponseCookie.from(REFRESH_COOKIE, value)
            .httpOnly(true)
            .secure(secure)
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
