package io.restaurantos.authz.config;

import io.restaurantos.shared.security.JwtAuthenticationFilter;
import io.restaurantos.shared.security.JwksKeyProvider;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

@Configuration
public class JwtConfig {

    @Bean
    @ConditionalOnMissingBean(JwksKeyProvider.class)
    public JwksKeyProvider jwksKeyProvider(@Value("${restaurantos.jwt.jwks-url}") String jwksUrl) {
        RestClient restClient = RestClient.builder().build();
        return new JwksKeyProvider(jwksUrl, restClient);
    }

    @Bean
    public JwtAuthenticationFilter jwtAuthenticationFilter(JwksKeyProvider jwksKeyProvider,
                                                           TenantContext tenantContext) {
        return new JwtAuthenticationFilter(jwksKeyProvider, tenantContext);
    }
}
