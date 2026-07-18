package io.restaurantos.inventory.config;

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

/**
 * Security wiring for inventory-service: JWT filter chain, the shared OPA-backed
 * {@link AuthorizationService} bean every inventory controller injects, and the
 * /internal/** secret filter. {@link OpaClient} itself is auto-configured by
 * SharedAutoConfiguration from restaurantos.opa.url — NOT redeclared here.
 */
@Configuration
@EnableMethodSecurity
public class InventorySecurityConfig {

    private final InventoryInternalServiceFilter internalServiceFilter;

    public InventorySecurityConfig(InventoryInternalServiceFilter internalServiceFilter) {
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
                .anyRequest().authenticated()
            )
            .addFilterBefore(internalServiceFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterAfter(jwtAuthenticationFilter, InventoryInternalServiceFilter.class);
        return http.build();
    }
}
