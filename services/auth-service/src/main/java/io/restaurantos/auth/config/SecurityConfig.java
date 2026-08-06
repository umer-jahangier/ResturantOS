package io.restaurantos.auth.config;

import io.restaurantos.shared.security.JwtAuthenticationFilter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;
    private final InternalServiceFilter internalServiceFilter;

    public SecurityConfig(JwtAuthenticationFilter jwtAuthenticationFilter,
                          InternalServiceFilter internalServiceFilter) {
        this.jwtAuthenticationFilter = jwtAuthenticationFilter;
        this.internalServiceFilter = internalServiceFilter;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .cors(Customizer.withDefaults())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health/**", "/actuator/prometheus", "/.well-known/jwks.json").permitAll()
                .requestMatchers("/api/v1/auth/login", "/api/v1/auth/refresh", "/api/v1/auth/logout", "/api/v1/auth/reset-password/**", "/api/v1/auth/tenants/**").permitAll()
                // First-time TOTP enrolment cannot require a token: the step-up rule withholds the
                // token until a code exists, and the code cannot exist until enrolment. Both
                // endpoints verify the password themselves and refuse once a secret is present.
                .requestMatchers("/api/v1/auth/2fa/bootstrap", "/api/v1/auth/2fa/bootstrap/verify").permitAll()
                // Forced password change (13-08, D-17). Public for the same reason /login is: the
                // account is refused a token until its password changes, so the caller cannot have
                // one. It authenticates itself twice over — a single-use change token plus the
                // current password — and resolves the account from the token, never the body.
                //
                // Registered FULLY QUALIFIED and pinned to POST, not as the prefix
                // "/api/v1/auth/change-password/**" and emphatically not as the bare
                // "/api/v1/auth/change-password". This list matches by exact path while the
                // gateway's PUBLIC_PATHS matches by startsWith, so the bare path would expose the
                // AUTHENTICATED self-service endpoint at the edge; both files must agree on which
                // of the two is public, and both say the same thing at the site. Same reasoning
                // 13-05 recorded for the platform login matcher.
                .requestMatchers(HttpMethod.POST, "/api/v1/auth/change-password/forced").permitAll()
                // /internal/auth/** is gated by InternalServiceFilter (constant-time X-Internal-Service secret check)
                // rather than JWT auth; permitAll here so the filter chain reaches InternalServiceFilter.
                .requestMatchers("/internal/auth/**").permitAll()
                .anyRequest().authenticated())
            // InternalServiceFilter must run BEFORE JwtAuthenticationFilter so internal paths
            // are rejected at secret check without attempting JWT validation.
            .addFilterBefore(internalServiceFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterAfter(jwtAuthenticationFilter, InternalServiceFilter.class)
            .exceptionHandling(ex -> ex
                .authenticationEntryPoint((req, res, e) -> writeError(res, HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED"))
                .accessDeniedHandler((req, res, e) -> writeError(res, HttpStatus.FORBIDDEN, "PERMISSION_DENIED")));
        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(12);
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOriginPatterns(List.of("https://*.restaurantos.io", "http://localhost:3000"));
        config.setAllowedMethods(List.of("GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type", "Idempotency-Key", "If-Match", "X-Request-Id"));
        config.setExposedHeaders(List.of("X-Upgrade-CTA-URL", "X-Quota-Resource", "X-Quota-Warning"));
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
