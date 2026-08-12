package io.restaurantos.pos.feign;

import io.restaurantos.pos.config.FeignClientConfig;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;

import java.util.List;
import java.util.UUID;

/**
 * S0-05's "find the check for 0300…" leg.
 *
 * <p>An order carries a {@code customerId} and nothing else about the guest — phones and names
 * belong to crm-service, and duplicating them into pos_db would create a second copy to keep in
 * step with every customer edit. So Order Management's search resolves the term to customer ids
 * here first, then filters orders on {@code customerId IN (…)}.
 *
 * <p><b>{@code X-Tenant-Id} is required and is not decoration.</b> Internal CRM routes are
 * reached with the shared-secret header and no JWT, so crm-service has nothing else from which
 * to resolve the tenant; without it the call 500s inside {@code requireTenantId()}. Mirrors
 * {@link UserBranchClient}'s contract for the same reason.
 */
@FeignClient(name = "crm-service", contextId = "crmCustomerSearchClient", configuration = FeignClientConfig.class)
public interface CrmCustomerSearchClient {

    @GetMapping("/internal/crm/customers/ids")
    List<UUID> searchCustomerIds(@RequestParam("q") String q,
                                 @RequestParam("limit") int limit,
                                 @RequestHeader("X-Tenant-Id") UUID tenantId);
}
