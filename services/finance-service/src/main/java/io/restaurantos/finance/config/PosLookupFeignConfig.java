package io.restaurantos.finance.config;

import feign.Request;
import io.restaurantos.shared.tenant.TenantContext;
import feign.RequestInterceptor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.concurrent.TimeUnit;

/**
 * Feign configuration for the journal-entry source lookup (37-04).
 *
 * <p>Separate from {@link FeignClientConfig} for one reason: an EXPLICIT short timeout. This call
 * is an enrichment on a ledger read. Inheriting Feign's default (10s connect / 60s read) would let
 * a wedged pos-service hold a finance screen open for a minute to decorate a number that is already
 * correct and already on the page. Two seconds, then give up and say so.
 */
@Configuration
public class PosLookupFeignConfig {

    @Value("${restaurantos.internal.secret:dev-internal-secret}")
    private String internalSecret;

    @Value("${restaurantos.source-lookup.connect-timeout-ms:1000}")
    private long connectTimeoutMs;

    @Value("${restaurantos.source-lookup.read-timeout-ms:2000}")
    private long readTimeoutMs;

    private final TenantContext tenantContext;

    public PosLookupFeignConfig(TenantContext tenantContext) {
        this.tenantContext = tenantContext;
    }

    @Bean
    public Request.Options sourceLookupTimeouts() {
        return new Request.Options(
                connectTimeoutMs, TimeUnit.MILLISECONDS,
                readTimeoutMs, TimeUnit.MILLISECONDS,
                true);
    }

    /**
     * pos-service scopes the summary read by tenant via RLS, and takes the tenant from
     * {@code X-Tenant-Id}. Forwarded from the authenticated context — never from a caller-supplied
     * parameter, so a client cannot ask about another tenant's order.
     */
    @Bean
    public RequestInterceptor sourceLookupInterceptor() {
        return template -> {
            template.header("X-Internal-Service", internalSecret);
            tenantContext.getTenantId().ifPresent(t -> template.header("X-Tenant-Id", t.toString()));
        };
    }
}
