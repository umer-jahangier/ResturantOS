package io.restaurantos.purchasing.feign;

import io.restaurantos.purchasing.config.FeignClientConfig;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;

import java.util.List;
import java.util.UUID;

/**
 * The unit codes the tenant defines, straight from inventory-service's registry — the same list a
 * goods receipt will later be converted by.
 *
 * <p>{@code contextId} is required: three other {@code @FeignClient}s already target
 * {@code inventory-service}, and Spring Cloud OpenFeign registers one specification bean per name
 * unless each declares its own context.
 */
@FeignClient(name = "inventory-service", contextId = "inventoryUomClient", configuration = FeignClientConfig.class)
public interface InventoryUomClient {

    @GetMapping("/internal/inventory/uom-codes")
    List<String> listUomCodes(@RequestHeader("X-Tenant-Id") UUID tenantId);
}
