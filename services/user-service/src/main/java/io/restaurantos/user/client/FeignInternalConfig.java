package io.restaurantos.user.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import feign.RequestInterceptor;
import feign.codec.ErrorDecoder;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;

/**
 * Feign configuration that attaches the X-Internal-Service shared secret to every
 * outbound call to auth-service /internal/auth/** (Doc 4 §4.1).
 * Also propagates X-Tenant-Id from the current request context when available.
 *
 * NOTE: This config is a user-service local copy of what should eventually be extracted
 * to shared-lib as a reusable FeignSharedConfig (tracked as future shared-lib extraction).
 *
 * <p>This class is a Feign {@code configuration} class, not a {@code @Configuration} class — the
 * beans below live in the per-client child context and are NOT visible to the application context.
 * That is why the {@link ErrorDecoder} is declared here rather than as an ordinary bean: declared
 * globally it would also replace the decoder of any other Feign client added later, which is a
 * decision that belongs to that client.
 */
public class FeignInternalConfig {

    @Bean
    public RequestInterceptor internalSecretInterceptor(
            @Value("${restaurantos.internal.secret:dev-internal-secret}") String secret) {
        return requestTemplate -> requestTemplate.header("X-Internal-Service", secret);
    }

    /**
     * Replaces Feign's default decoder, which raises an undifferentiated {@code FeignException} and
     * so turned every upstream refusal into a 500 at the public door. See {@link UpstreamErrorDecoder}.
     */
    @Bean
    public ErrorDecoder upstreamErrorDecoder(ObjectMapper objectMapper) {
        return new UpstreamErrorDecoder(objectMapper);
    }
}
