package io.restaurantos.platform.client;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

/**
 * Feign client for finance-service internal CoA seeding (Doc 4 §4.2, FD-1 step 5).
 * finance-service is a LATER phase. When provisioning.seed-coa.enabled=false (default dev),
 * TenantProvisioningService skips this call and marks COA as deferred.
 * In production (enabled=true) a finance failure becomes a saga compensation step.
 */
@FeignClient(
    name = "finance-service",
    url = "${restaurantos.finance-service.uri:}",
    configuration = FeignSharedConfig.class
)
public interface FinanceInternalClient {

    @PostMapping("/internal/finance/tenants/{tenantId}/seed-coa")
    Map<String, Object> seedCoa(@PathVariable UUID tenantId);
}
