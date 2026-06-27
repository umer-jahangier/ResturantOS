package io.restaurantos.finance.config;

import feign.RequestInterceptor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class FeignClientConfig {

    @Value("${restaurantos.internal.secret:dev-internal-secret}")
    private String internalSecret;

    @Bean
    public RequestInterceptor internalServiceInterceptor() {
        return template -> template.header("X-Internal-Secret", internalSecret);
    }
}
