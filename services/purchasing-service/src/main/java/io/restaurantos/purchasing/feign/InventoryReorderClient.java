package io.restaurantos.purchasing.feign;

import io.restaurantos.purchasing.config.FeignClientConfig;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * What is low at a branch, and by how much — inventory's half of an order suggestion.
 *
 * <p>Deliberately has NO mock counterpart, unlike {@link InventoryCategoryClient} and
 * {@code GrnDataPort}. Those exist because purchasing shipped before the real inventory endpoints
 * did, and a mock let the surrounding work proceed. There is nothing useful to fake here: a
 * suggestion list built from invented shortfalls would be actively misleading — someone would
 * order against it. If inventory cannot be reached the suggestions endpoint fails, honestly, with
 * a 503.
 *
 * <p>{@code contextId} is required: two other clients already target {@code inventory-service},
 * and Spring Cloud OpenFeign registers one specification bean per name unless a distinct
 * {@code contextId} is given (see {@link InventoryCategoryClient}'s note).
 */
@FeignClient(name = "inventory-service", contextId = "inventoryReorderClient", configuration = FeignClientConfig.class)
public interface InventoryReorderClient {

    @GetMapping("/internal/inventory/reorder-shortfalls")
    ReorderShortfallsResponse getShortfalls(@RequestParam("branchId") UUID branchId);

    /** Mirrors {@code ReorderDtos.ReorderShortfallsResponse} on the inventory side field-for-field. */
    record ReorderShortfallsResponse(UUID branchId, List<ReorderShortfall> items, int blockedCount) {}

    /**
     * Mirrors {@code ReorderDtos.ReorderShortfallDto}. {@code suggestedQty} is in the ingredient's
     * STOCK unit and is null exactly when {@code blockedReason} is set.
     */
    record ReorderShortfall(
            UUID ingredientId,
            String ingredientName,
            String sku,
            String baseUomCode,
            UUID categoryId,
            String categoryName,
            BigDecimal qtyOnHand,
            BigDecimal reorderPoint,
            BigDecimal parLevel,
            BigDecimal suggestedQty,
            String blockedReason) {}
}
