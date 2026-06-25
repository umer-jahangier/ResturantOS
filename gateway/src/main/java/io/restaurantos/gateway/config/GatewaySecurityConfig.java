package io.restaurantos.gateway.config;

import io.restaurantos.shared.security.JwksKeyProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.reactive.EnableWebFluxSecurity;
import org.springframework.security.config.web.server.ServerHttpSecurity;
import org.springframework.security.web.server.SecurityWebFilterChain;
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
        org.springframework.web.client.RestClient restClient =
                org.springframework.web.client.RestClient.builder()
                        .baseUrl(jwksUri)
                        .build();
        return new JwksKeyProvider(jwksUri, restClient);
    }

    @Bean
    public SecurityWebFilterChain securityWebFilterChain(ServerHttpSecurity http) {
        return http
                .csrf(ServerHttpSecurity.CsrfSpec::disable)
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
}
