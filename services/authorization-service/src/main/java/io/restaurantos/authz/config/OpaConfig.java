package io.restaurantos.authz.config;

import io.restaurantos.shared.authz.AuthorizationService;
import io.restaurantos.shared.authz.DefaultOpaClient;
import io.restaurantos.shared.authz.OpaClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.net.http.HttpClient;
import java.time.Duration;

@Configuration
public class OpaConfig {

    private static final Duration OPA_TIMEOUT = Duration.ofSeconds(2);

    @Bean
    @Primary
    public OpaClient opaClient(@Value("${restaurantos.opa.url}") String opaUrl) {
        HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(OPA_TIMEOUT)
            .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(OPA_TIMEOUT);
        RestClient restClient = RestClient.builder()
            .baseUrl(opaUrl)
            .requestFactory(factory)
            .build();
        return new DefaultOpaClient(restClient);
    }

    @Bean
    public AuthorizationService authorizationService(OpaClient opaClient) {
        return new AuthorizationService(opaClient);
    }
}
