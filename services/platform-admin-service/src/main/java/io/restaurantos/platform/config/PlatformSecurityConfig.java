package io.restaurantos.platform.config;

import io.restaurantos.shared.security.JwksKeyProvider;
import io.restaurantos.shared.security.JwtAuthenticationFilter;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.Customizer;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.client.RestClient;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;

/**
 * Security configuration for platform-admin-service (Security 7 lambda DSL, Doc 9).
 * - /api/v1/platform/** requires SUPER_ADMIN authority (SuperAdmin JWT from platform users)
 * - /internal/platform/** gated by PlatformInternalServiceFilter (X-Internal-Service secret)
 * - Actuator health/prometheus permit all
 */
@Configuration
@EnableMethodSecurity
public class PlatformSecurityConfig {
    /**
     * Browser origins allowed to call this service, comma-separated.
     *
     * <p>Hardcoded until 2026-08-21 to {@code https://*.restaurantos.io,
     * http://localhost:3000}, which meant any deployment on another domain
     * rejected every browser request with 403 "Invalid CORS request" — AFTER the
     * gateway had already allowed it and attached its own Access-Control headers,
     * so the response looked CORS-approved and was refused anyway.
     *
     * <p>It hid from testing because curl sends no Origin header, so CORS never
     * engages and the endpoint reports perfectly healthy. Only a browser sees it.
     *
     * <p>The default preserves the previous behaviour exactly.
     */
    @org.springframework.beans.factory.annotation.Value(
        "${CORS_ALLOWED_ORIGINS:https://*.restaurantos.io,http://localhost:3000}")
    private String corsAllowedOrigins;

    private List<String> corsOriginPatterns() {
        return java.util.Arrays.stream(corsAllowedOrigins.split(","))
            .map(String::trim).filter(o -> !o.isEmpty()).toList();
    }


    private final TenantContext tenantContext;

    public PlatformSecurityConfig(TenantContext tenantContext) {
        this.tenantContext = tenantContext;
    }

    @Bean
    public JwksKeyProvider jwksKeyProvider(@Value("${restaurantos.jwks.uri}") String jwksUri) {
        return new JwksKeyProvider(jwksUri, RestClient.create());
    }

    @Bean
    public JwtAuthenticationFilter jwtAuthenticationFilter(JwksKeyProvider jwksKeyProvider) {
        return new JwtAuthenticationFilter(jwksKeyProvider, tenantContext);
    }

    @Bean
    public PlatformInternalServiceFilter platformInternalServiceFilter(
            @Value("${restaurantos.internal.secret:dev-internal-secret}") String secret) {
        return new PlatformInternalServiceFilter(secret);
    }

    /**
     * Cost 12, matching auth-service's {@code SecurityConfig#passwordEncoder} exactly.
     *
     * <p>The cost is not a free parameter: it has to equal the cost the seeds and {@code
     * scripts/onboarding.py} hash with, or {@code platform_users.password_hash} values written by
     * one and verified by the other would still match (bcrypt encodes its cost in the hash) but the
     * dummy-hash comparison in {@link io.restaurantos.platform.service.PlatformAuthService} would
     * take a different amount of time from a real one — reintroducing the account-enumeration timing
     * channel the dummy exists to close.
     */
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(12);
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http,
                                           JwtAuthenticationFilter jwtAuthenticationFilter,
                                           PlatformInternalServiceFilter platformInternalServiceFilter) throws Exception {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .cors(Customizer.withDefaults())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health/**", "/actuator/prometheus").permitAll()
                // /internal/platform/** gated by PlatformInternalServiceFilter (secret check), not JWT
                .requestMatchers("/internal/platform/**").permitAll()
                // The SuperAdmin login (13-05). Public for the same reason /api/v1/auth/login is:
                // the caller has no token and cannot obtain one until this succeeds.
                //
                // Registered in its FULLY QUALIFIED form and pinned to POST. The prefix
                // /api/v1/platform/auth/** would be a standing invitation for a later plan to add a
                // platform password-reset or token-exchange endpoint under it and have it silently
                // inherit permitAll — which is exactly the mistake 13-01 avoided at the gateway by
                // registering /api/v1/auth/change-password/forced rather than the bare path.
                //
                // MUST stay above anyRequest(): authorizeHttpRequests matchers are evaluated in
                // declaration order and the catch-all would otherwise claim this path first.
                .requestMatchers(HttpMethod.POST, "/api/v1/platform/auth/login").permitAll()
                // Public API requires a valid JWT; SUPER_ADMIN role enforced at method-security level
                .anyRequest().authenticated())
            .addFilterBefore(platformInternalServiceFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterAfter(jwtAuthenticationFilter, PlatformInternalServiceFilter.class)
            .exceptionHandling(ex -> ex
                .authenticationEntryPoint((req, res, e) -> writeError(res, HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED"))
                .accessDeniedHandler((req, res, e) -> writeError(res, HttpStatus.FORBIDDEN, "PERMISSION_DENIED")));
        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOriginPatterns(corsOriginPatterns());
        config.setAllowedMethods(List.of("GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-Request-Id", "Idempotency-Key"));
        config.setAllowCredentials(true);
        UrlBasedCorsConfigurationSource src = new UrlBasedCorsConfigurationSource();
        src.registerCorsConfiguration("/**", config);
        return src;
    }

    private void writeError(HttpServletResponse res, HttpStatus status, String code) throws IOException {
        res.setStatus(status.value());
        res.setContentType("application/json");
        res.getWriter().write("{\"error\":{\"code\":\"" + code + "\",\"message\":\"" + code + "\"}}");
    }

    /**
     * Internal service filter for /internal/platform/** — mirrors InternalServiceFilter in auth-service.
     * Constant-time X-Internal-Service secret comparison (Doc 4 §4.1).
     */
    public static class PlatformInternalServiceFilter extends OncePerRequestFilter {

        public static final String HEADER = "X-Internal-Service";

        private final byte[] secretBytes;

        public PlatformInternalServiceFilter(String secret) {
            this.secretBytes = secret.getBytes(StandardCharsets.UTF_8);
        }

        @Override
        protected boolean shouldNotFilter(HttpServletRequest request) {
            return !request.getRequestURI().startsWith("/internal/");
        }

        @Override
        protected void doFilterInternal(HttpServletRequest request,
                                        HttpServletResponse response,
                                        FilterChain chain) throws ServletException, IOException {
            String provided = request.getHeader(HEADER);
            if (!isValid(provided)) {
                response.setStatus(HttpServletResponse.SC_FORBIDDEN);
                response.setContentType("application/json");
                response.getWriter().write(
                    "{\"error\":{\"code\":\"INTERNAL_AUTH_REQUIRED\",\"message\":\"Missing or invalid X-Internal-Service secret\"}}"
                );
                return;
            }
            chain.doFilter(request, response);
        }

        private boolean isValid(String provided) {
            if (provided == null) return false;
            byte[] providedBytes = provided.getBytes(StandardCharsets.UTF_8);
            return MessageDigest.isEqual(secretBytes, providedBytes);
        }
    }
}
