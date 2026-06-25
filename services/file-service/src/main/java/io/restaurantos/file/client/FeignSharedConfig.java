package io.restaurantos.file.client;

import feign.RequestInterceptor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;

/**
 * Feign configuration that attaches the X-Internal-Service shared secret to every
 * outbound call from file-service to internal service endpoints (Doc 4 §4.1).
 * Mirrors the pattern in user-service FeignInternalConfig (tracked as shared-lib extraction tech debt).
 */
public class FeignSharedConfig {

    @Bean
    public RequestInterceptor internalSecretInterceptor(
            @Value("${restaurantos.internal.secret:dev-internal-secret}") String secret) {
        return requestTemplate -> requestTemplate.header("X-Internal-Service", secret);
    }
}
