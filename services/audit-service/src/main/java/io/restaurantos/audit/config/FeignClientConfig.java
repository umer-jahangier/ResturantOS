package io.restaurantos.audit.config;

import feign.RequestInterceptor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Attaches the shared internal-service secret to every outbound Feign call.
 *
 * <p>Identical in shape to pos-service's and finance-service's, deliberately: {@code /internal/**}
 * on every service is gated by one header and one secret, and a second convention here would be a
 * second thing to keep in step.
 */
@Configuration
public class FeignClientConfig {

    @Value("${restaurantos.internal.secret:dev-internal-secret}")
    private String internalSecret;

    @Bean
    public RequestInterceptor internalServiceInterceptor() {
        return template -> template.header("X-Internal-Service", internalSecret);
    }
}
