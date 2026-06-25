package io.restaurantos.gateway.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.reactive.function.client.WebClient;

/**
 * Provides the {@link WebClient.Builder} bean.
 *
 * <p>In Spring Boot 4, WebClient.Builder is no longer auto-configured as a standalone
 * bean — it must be declared explicitly. The builder is prototype-scoped; each call to
 * {@link WebClient.Builder#build()} produces a new immutable {@link WebClient} instance,
 * so it is safe for multiple components (PlatformAdminClient, etc.) to inject the same
 * shared builder and call {@code build()} with their own base URLs.
 */
@Configuration
public class WebClientConfig {

    @Bean
    public WebClient.Builder webClientBuilder() {
        return WebClient.builder();
    }
}
