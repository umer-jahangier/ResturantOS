package io.restaurantos.audit.config;

import io.restaurantos.shared.security.JwksKeyProvider;
import io.restaurantos.shared.security.JwtAuthenticationFilter;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.client.RestClient;

/**
 * Security configuration for audit-service.
 *
 * <ul>
 *   <li>Actuator health/prometheus are public.</li>
 *   <li>{@code /internal/audit/**} is gated by the {@code X-Internal-Service-Secret} filter.</li>
 *   <li>{@code /api/v1/audit/**} is authenticated by JWT and then gated per-method on
 *       {@code audit.log.view} — 15-01 added the first user-facing endpoint this service has had.</li>
 * </ul>
 *
 * <p>{@code @EnableMethodSecurity} is new here and is load-bearing. Without it a
 * {@code @PreAuthorize} annotation is inert — the method runs, the annotation is decoration, and the
 * endpoint is open to any authenticated user of any role. The service previously had no method
 * security precisely because it had no user-facing endpoints; adding one without this line would
 * have published the entire tenant's audit log to every KITCHEN_STAFF token. {@code
 * AuditPermissionGateIT} asserts a token without the permission is refused, so the annotation being
 * live is a tested property and not an assumption about configuration.
 */
@Configuration
@EnableMethodSecurity
public class AuditSecurityConfig {

    @Value("${restaurantos.internal.secret:dev-internal-secret}")
    private String internalSecret;

    @Bean
    public InternalServiceFilter internalServiceFilter() {
        return new InternalServiceFilter(internalSecret);
    }

    @Bean
    public JwksKeyProvider jwksKeyProvider(@Value("${restaurantos.jwks.uri}") String jwksUri) {
        return new JwksKeyProvider(jwksUri, RestClient.create());
    }

    @Bean
    public JwtAuthenticationFilter jwtAuthenticationFilter(JwksKeyProvider jwksKeyProvider,
                                                           TenantContext tenantContext) {
        return new JwtAuthenticationFilter(jwksKeyProvider, tenantContext);
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http,
                                           JwtAuthenticationFilter jwtAuthenticationFilter)
            throws Exception {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health/**", "/actuator/prometheus").permitAll()
                .requestMatchers("/internal/audit/**").permitAll()
                // Authentication only at this layer; the permission is enforced by @PreAuthorize
                // on the handler, which is where the tenant context is also available.
                .requestMatchers("/api/v1/audit/**").authenticated()
                .anyRequest().denyAll())
            .addFilterBefore(internalServiceFilter(), UsernamePasswordAuthenticationFilter.class)
            .addFilterAfter(jwtAuthenticationFilter, InternalServiceFilter.class)
            .exceptionHandling(ex -> ex
                .authenticationEntryPoint((req, res, e) -> writeError(res, HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED"))
                .accessDeniedHandler((req, res, e) -> writeError(res, HttpStatus.FORBIDDEN, "PERMISSION_DENIED")));
        return http.build();
    }

    private void writeError(HttpServletResponse res, HttpStatus status, String code)
            throws java.io.IOException {
        res.setStatus(status.value());
        res.setContentType("application/json");
        res.getWriter().write("{\"error\":{\"code\":\"" + code + "\",\"message\":\"" + code + "\"}}");
    }
}
