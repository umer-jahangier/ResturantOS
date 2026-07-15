package io.restaurantos.pos.config;

import io.restaurantos.shared.authz.AuthorizationService;
import io.restaurantos.shared.authz.OpaClient;
import io.restaurantos.shared.security.JwksKeyProvider;
import io.restaurantos.shared.security.JwtAuthenticationFilter;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.client.RestClient;

@Configuration
@EnableMethodSecurity
public class PosSecurityConfig {

    private final PosInternalServiceFilter internalServiceFilter;

    public PosSecurityConfig(PosInternalServiceFilter internalServiceFilter) {
        this.internalServiceFilter = internalServiceFilter;
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
    public AuthorizationService authorizationService(OpaClient opaClient) {
        return new AuthorizationService(opaClient);
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http,
                                                    JwtAuthenticationFilter jwtAuthenticationFilter) throws Exception {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/internal/**").permitAll()
                .requestMatchers("/actuator/**").permitAll()
                .requestMatchers("/swagger-ui/**", "/v3/api-docs/**").permitAll()
                // POS order WebSocket handshake — authenticated INSIDE the handler
                // (JWT + pos.order.view + branch-match via the ?token= query param, since
                // browsers cannot set an Authorization header on a WebSocket). Scoped to
                // the dedicated /ws/ segment so it never loosens the REST order endpoints.
                .requestMatchers("/api/v1/pos/ws/**").permitAll()
                .anyRequest().authenticated()
            )
            .addFilterBefore(internalServiceFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterAfter(jwtAuthenticationFilter, PosInternalServiceFilter.class);
        return http.build();
    }
}
