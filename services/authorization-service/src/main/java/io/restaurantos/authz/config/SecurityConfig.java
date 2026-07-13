package io.restaurantos.authz.config;

import io.restaurantos.shared.security.JwtAuthenticationFilter;
import io.restaurantos.shared.tenant.TenantFilterInterceptor;
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
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
@EnableMethodSecurity
public class SecurityConfig implements WebMvcConfigurer {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;
    private final InternalServiceFilter internalServiceFilter;
    private final TenantFilterInterceptor tenantFilterInterceptor;

    public SecurityConfig(JwtAuthenticationFilter jwtAuthenticationFilter,
                          InternalServiceFilter internalServiceFilter,
                          TenantFilterInterceptor tenantFilterInterceptor) {
        this.jwtAuthenticationFilter = jwtAuthenticationFilter;
        this.internalServiceFilter = internalServiceFilter;
        this.tenantFilterInterceptor = tenantFilterInterceptor;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .cors(Customizer.withDefaults())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health/**", "/actuator/prometheus").permitAll()
                // /internal/authorize is dual-gated ON PURPOSE: InternalServiceFilter proves the
                // CALLER is a trusted service (X-Internal-Service secret), and .authenticated()
                // proves the SUBJECT is a real user — the endpoint reads JwtClaims off the
                // SecurityContext to decide on that user's permissions/tenant/branch. Callers must
                // therefore forward the end user's Authorization header (see each service's
                // FeignClientConfig); a service-only credential cannot authorize a user action.
                .requestMatchers("/internal/**").authenticated()
                .anyRequest().authenticated())
            .addFilterBefore(internalServiceFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
            .exceptionHandling(ex -> ex
                .authenticationEntryPoint((req, res, e) -> writeError(res, HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED"))
                .accessDeniedHandler((req, res, e) -> writeError(res, HttpStatus.FORBIDDEN, "PERMISSION_DENIED")));
        return http.build();
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(tenantFilterInterceptor).addPathPatterns("/**");
    }

    private void writeError(jakarta.servlet.http.HttpServletResponse res, HttpStatus status, String code)
            throws java.io.IOException {
        res.setStatus(status.value());
        res.setContentType("application/json");
        res.getWriter().write("{\"error\":{\"code\":\"" + code + "\",\"message\":\"" + code + "\"}}");
    }
}
