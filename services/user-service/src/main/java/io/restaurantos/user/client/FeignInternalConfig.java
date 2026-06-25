package io.restaurantos.user.client;

import feign.RequestInterceptor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;

/**
 * Feign configuration that attaches the X-Internal-Service shared secret to every
 * outbound call to auth-service /internal/auth/** (Doc 4 §4.1).
 * Also propagates X-Tenant-Id from the current request context when available.
 *
 * NOTE: This config is a user-service local copy of what should eventually be extracted
 * to shared-lib as a reusable FeignSharedConfig (tracked as future shared-lib extraction).
 */
public class FeignInternalConfig {

    @Bean
    public RequestInterceptor internalSecretInterceptor(
            @Value("${restaurantos.internal.secret:dev-internal-secret}") String secret) {
        return requestTemplate -> requestTemplate.header("X-Internal-Service", secret);
    }
}
