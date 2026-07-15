package io.restaurantos.reporting.feign;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import io.restaurantos.reporting.config.FeignClientConfig;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

import java.util.UUID;

/**
 * Internal branch lookup — used by {@link io.restaurantos.reporting.support.BranchTimeZoneResolver}
 * to resolve a branch's IANA timezone for the business-day bucketing formula. Uses
 * {@link FeignClientConfig}'s verbatim {@code forwardCallerJwt()} interceptor (12-01), though
 * consumers running on an AMQP thread carry no inbound HTTP request so it correctly no-ops and the
 * call goes out as X-Internal-Service + X-Tenant-Id only — empirically confirmed sufficient:
 * {@code GET /internal/users/branches/{branchId}} is gated ONLY by
 * {@code UserInternalServiceFilter} (constant-time X-Internal-Service secret check); it does not
 * require a caller JWT. See 12-03-SUMMARY.md.
 */
@FeignClient(name = "user-service", configuration = FeignClientConfig.class)
public interface UserInternalClient {

    @GetMapping("/internal/users/branches/{branchId}")
    BranchInternalDto getBranch(@PathVariable("branchId") UUID branchId);

    /**
     * Minimal local mirror of user-service's {@code BranchEntity} — only the field this service
     * needs (timezone). Deliberately NOT the full entity: reporting-service does not depend on
     * user-service, and a narrow DTO tolerates additive fields on the producer side by construction
     * (unknown JSON properties are simply never mapped).
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record BranchInternalDto(UUID id, String timezone) {}
}
