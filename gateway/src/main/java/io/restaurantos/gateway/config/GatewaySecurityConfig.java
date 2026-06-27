package io.restaurantos.gateway.config;

import io.restaurantos.shared.security.JwksKeyProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.reactive.EnableWebFluxSecurity;
import org.springframework.security.config.web.server.ServerHttpSecurity;
import org.springframework.security.web.server.SecurityWebFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.reactive.CorsConfigurationSource;
import org.springframework.web.cors.reactive.UrlBasedCorsConfigurationSource;

import java.util.List;
/**
 * Spring Security 7 reactive {@link SecurityWebFilterChain} for the gateway.
 *
 * <p>Authentication is enforced by {@link io.restaurantos.gateway.filter.JwtGlobalFilter}
 * (a custom GlobalFilter), NOT by Spring Security's OAuth2 resource server. Spring Security
 * here serves only to disable CSRF (WebFlux apps don't need it for API usage) and
 * allow all requests through — the GlobalFilter chain owns the actual JWT validation.
 *
 * <p>Uses lambda DSL ({@link ServerHttpSecurity}) — {@code WebSecurityConfigurerAdapter}
 * was removed in Spring Security 7 (State of the Art reference).
 */
@Configuration
@EnableWebFluxSecurity
public class GatewaySecurityConfig {

    @Value("${restaurantos.jwks.uri}")
    private String jwksUri;

    /**
     * Provides a {@link JwksKeyProvider} bean that fetches and caches RS256 public keys
     * from the auth-service JWKS endpoint. JwtGlobalFilter uses this for JWT signature
     * verification (reuse shared-lib; do NOT re-implement key caching).
     *
     * <p>{@code @ConditionalOnMissingBean} allows test configurations to provide a
     * pre-seeded test keypair without HTTP fetching.
     */
    @Bean
    @org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean(JwksKeyProvider.class)
    public JwksKeyProvider jwksKeyProvider() {
        // Use a plain RestClient (no baseUrl) — JwksKeyProvider passes the full JWKS URL
        // to RestClient.get().uri(...). Other services (user, finance, file) use the same
        // pattern. Setting baseUrl to the full JWKS path breaks key fetch on some hosts.
        return new JwksKeyProvider(jwksUri, org.springframework.web.client.RestClient.create());
    }

    @Bean
    public SecurityWebFilterChain securityWebFilterChain(ServerHttpSecurity http) {
        return http
                .csrf(ServerHttpSecurity.CsrfSpec::disable)
                // Edge CORS: the gateway is the only browser-facing origin, so it must answer
                // the preflight (OPTIONS) for JSON requests. Without this, Spring Security's
                // WebFlux chain replies 200 with no Access-Control-Allow-Origin and the browser
                // blocks the call (surfaces as "Network Error" in the SPA). DefaultCorsProcessor
                // skips adding headers when an upstream response already carries them, so this
                // does not duplicate the per-service CORS headers on proxied responses.
                .cors(Customizer.withDefaults())
                .authorizeExchange(exchanges -> exchanges
                        // Public paths: auth, JWKS, actuator, and fallback — permit all
                        .pathMatchers(
                                "/api/v1/auth/login",
                                "/api/v1/auth/refresh",
                                "/api/v1/auth/reset-password/**",
                                "/.well-known/**",
                                "/actuator/health/**",
                                "/actuator/prometheus",
                                "/fallback/**"
                        ).permitAll()
                        // All other paths: permit at the Security layer — JwtGlobalFilter
                        // enforces authentication before the request reaches any upstream.
                        .anyExchange().permitAll()
                )
                .httpBasic(ServerHttpSecurity.HttpBasicSpec::disable)
                .formLogin(ServerHttpSecurity.FormLoginSpec::disable)
                .build();
    }

    /**
     * Edge CORS policy for browser clients. Mirrors the per-service allowlist
     * (auth-service SecurityConfig) so the SPA on http://localhost:3000 and
     * production *.restaurantos.io origins can call the gateway with credentials.
     */
    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOriginPatterns(List.of("https://*.restaurantos.io", "http://localhost:3000"));
        config.setAllowedMethods(List.of("GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type", "Idempotency-Key", "If-Match", "X-Request-Id"));
        config.setExposedHeaders(List.of("X-Upgrade-CTA-URL", "X-Quota-Resource", "X-Quota-Warning"));
        config.setAllowCredentials(true);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
