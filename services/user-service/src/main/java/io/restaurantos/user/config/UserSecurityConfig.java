package io.restaurantos.user.config;

import io.restaurantos.shared.security.JwksKeyProvider;
import io.restaurantos.shared.security.JwtAuthenticationFilter;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.Customizer;
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

import java.util.List;

@Configuration
@EnableMethodSecurity
public class UserSecurityConfig {
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


    private final UserInternalServiceFilter internalServiceFilter;
    private final TenantContext tenantContext;

    public UserSecurityConfig(UserInternalServiceFilter internalServiceFilter,
                              TenantContext tenantContext) {
        this.internalServiceFilter = internalServiceFilter;
        this.tenantContext = tenantContext;
    }

    @Bean
    public JwksKeyProvider jwksKeyProvider(
            @Value("${restaurantos.jwks.uri}") String jwksUri) {
        return new JwksKeyProvider(jwksUri, RestClient.create());
    }

    @Bean
    public JwtAuthenticationFilter jwtAuthenticationFilter(JwksKeyProvider jwksKeyProvider) {
        return new JwtAuthenticationFilter(jwksKeyProvider, tenantContext);
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http,
                                           JwtAuthenticationFilter jwtAuthenticationFilter) throws Exception {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .cors(Customizer.withDefaults())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health/**", "/actuator/prometheus").permitAll()
                // /internal/users/** gated by UserInternalServiceFilter, not JWT
                .requestMatchers("/internal/users/**").permitAll()
                .anyRequest().authenticated())
            .addFilterBefore(internalServiceFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterAfter(jwtAuthenticationFilter, UserInternalServiceFilter.class)
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
        config.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-Request-Id"));
        config.setAllowCredentials(true);
        UrlBasedCorsConfigurationSource src = new UrlBasedCorsConfigurationSource();
        src.registerCorsConfiguration("/**", config);
        return src;
    }

    private void writeError(jakarta.servlet.http.HttpServletResponse res, HttpStatus status, String code)
            throws java.io.IOException {
        res.setStatus(status.value());
        res.setContentType("application/json");
        res.getWriter().write("{\"error\":{\"code\":\"" + code + "\",\"message\":\"" + code + "\"}}");
    }
}
