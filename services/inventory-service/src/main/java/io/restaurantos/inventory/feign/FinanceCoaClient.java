package io.restaurantos.inventory.feign;

import io.restaurantos.inventory.config.FeignClientConfig;
import io.restaurantos.shared.api.ApiResponse;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Chart-of-accounts lookup against finance-service, over the {@code X-Internal-Service}
 * shared-secret seam. The mirror image of finance's own {@code InventoryInternalClient}.
 *
 * <p>Deliberately has NO {@code fallback}. Every other internal client in this repo degrades to a
 * safe default, but both of these calls are inputs to a WRITE decision: silently treating an
 * unreachable finance-service as "no accounts matched" would turn a transient outage into a
 * category saved with an unvalidated GL account — precisely the class of silent bad data this
 * whole seam exists to eliminate. Failures propagate and surface as a 503 the form can retry.
 *
 * <p>Tenant travels as an explicit {@code X-Tenant-Id} header, matching every other
 * {@code /internal/**} endpoint here: internal calls carry no user principal the callee could
 * derive a tenant from.
 */
@FeignClient(name = "finance-service", configuration = FeignClientConfig.class)
public interface FinanceCoaClient {

    @GetMapping("/internal/finance/accounts/search")
    ApiResponse<List<GlAccountDto>> searchAccounts(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestParam("q") String q,
            @RequestParam("types") List<String> types,
            @RequestParam("size") int size);

    /** Returns only the codes that resolved — absent means "no such account for this tenant". */
    @PostMapping("/internal/finance/accounts/resolve")
    ApiResponse<Map<String, GlAccountDto>> resolveByCodes(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestBody List<String> codes);

    @PostMapping("/internal/finance/accounts/resolve-by-id")
    ApiResponse<Map<UUID, GlAccountDto>> resolveByIds(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestBody List<UUID> ids);
}
