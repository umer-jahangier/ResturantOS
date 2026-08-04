package io.restaurantos.nlq.config;

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
public class NlqSecurityConfig {

    private final NlqInternalServiceFilter internalServiceFilter;

    public NlqSecurityConfig(NlqInternalServiceFilter internalServiceFilter) {
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
    public SecurityFilterChain securityFilterChain(HttpSecurity http,
                                                    JwtAuthenticationFilter jwtAuthenticationFilter) throws Exception {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/internal/**").permitAll()
                .requestMatchers("/actuator/**").permitAll()
                // Every /api/v1/nlq/** endpoint is authenticated: the JWT is validated at the
                // service (defence-in-depth) — the gateway check is not sufficient on its own,
                // and the impersonation stamp (NLQ-02) is read off the validated JWT, not a header.
                .anyRequest().authenticated()
            )
            .addFilterBefore(internalServiceFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterAfter(jwtAuthenticationFilter, NlqInternalServiceFilter.class);
        return http.build();
    }
}
