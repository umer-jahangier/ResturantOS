package io.restaurantos.inventory.feign;

import io.restaurantos.inventory.config.FeignClientConfig;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;

import java.util.UUID;

/**
 * How many vendor-catalog rows still pack in a unit — the cross-database half of the unit-retire
 * guard (36-05).
 *
 * <p>Inventory owns {@code units_of_measure} and is the only place a unit can be retired. But a
 * unit code is a foreign key <b>by value</b> into {@code purchasing_db.vendor_items.pack_uom},
 * across a database boundary no constraint can span, and inventory converts a goods receipt by
 * looking that exact string up. Retiring a unit a catalog row still packs in would leave every
 * receipt against that row unable to convert — received at face value, silently wrong in both
 * quantity and cost. That is the defect this phase measured twice.
 *
 * <p><b>No fallback, deliberately.</b> Every other internal client in this service that degrades
 * does so on a READ that has a safe default. This one is an input to a WRITE decision, and its two
 * possible failure modes are not symmetric: treating an unreachable purchasing-service as "no
 * catalog rows use it" would retire a unit that is in use, and retiring a unit is not urgent while
 * a wrong retire is expensive to discover. So a transport failure propagates, the retire is refused,
 * and the refusal says the check could not be made.
 *
 * <p>Tenant travels as an explicit {@code X-Tenant-Id} header: an internal call carries no user
 * principal the callee could derive a tenant from.
 */
@FeignClient(name = "purchasing-service", contextId = "purchasingUomUsageClient",
        configuration = FeignClientConfig.class)
public interface PurchasingUomUsageClient {

    @GetMapping("/internal/purchasing/uom-usage")
    UomUsageResponse uomUsage(@RequestHeader("X-Tenant-Id") UUID tenantId,
                              @RequestParam("code") String code);

    record UomUsageResponse(long vendorItemCount) {}
}
