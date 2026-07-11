package io.restaurantos.purchasing.feign;

import io.restaurantos.purchasing.config.FeignClientConfig;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Phase 8 inventory GRN contract. Unused while {@code integration-mode=mock}.
 */
@FeignClient(name = "inventory-service", configuration = FeignClientConfig.class)
public interface InventoryGrnClient {

    @GetMapping("/internal/inventory/po-lines/{poLineId}/grn-summary")
    GrnSummaryResponse getGrnSummary(@PathVariable UUID poLineId);

    record GrnSummaryResponse(
            UUID poLineId,
            UUID poId,
            UUID grnId,
            BigDecimal receivedQty,
            BigDecimal orderedQty,
            Instant receivedAt
    ) {}
}
