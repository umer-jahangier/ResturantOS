package io.restaurantos.authz.config;

import io.restaurantos.shared.security.JwtAuthenticationFilter;
import io.restaurantos.shared.security.JwksKeyProvider;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.time.Duration;

@Configuration
public class JwtConfig {

    @Bean
    @ConditionalOnMissingBean(JwksKeyProvider.class)
    public JwksKeyProvider jwksKeyProvider(@Value("${restaurantos.jwt.jwks-url}") String jwksUrl) {
        // Timeouts are mandatory here. JwksKeyProvider bounds how long a CALLER waits for another
        // thread's refresh, but nothing bounds the FETCHING thread except this client — so without
        // these the fetcher leaks against an unresponsive auth-service, one thread per TTL expiry.
        //
        // The unbounded version of this exact call is what wedged four services during phase 13:
        // /actuator/health kept answering while every authenticated path hung, so no liveness probe
        // ever restarted them. See JwksKeyProvider.refresh() and JwksKeyProviderWedgeTest.
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(2));
        factory.setReadTimeout(Duration.ofSeconds(3));
        RestClient restClient = RestClient.builder().requestFactory(factory).build();
        return new JwksKeyProvider(jwksUrl, restClient);
    }

    @Bean
    public JwtAuthenticationFilter jwtAuthenticationFilter(JwksKeyProvider jwksKeyProvider,
                                                           TenantContext tenantContext) {
        return new JwtAuthenticationFilter(jwksKeyProvider, tenantContext);
    }
}
