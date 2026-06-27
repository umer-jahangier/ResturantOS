package io.restaurantos.finance.feign;

import org.springframework.stereotype.Component;

import java.time.LocalDate;

/**
 * Circuit-breaker fallback for InventoryInternalClient.
 * Phase 6: stubs return 0 (no pending GRNs).
 * TODO Phase 8: implement real inventory endpoint.
 */
@Component
public class InventoryInternalClientFallback implements InventoryInternalClient {

    @Override
    public long getPendingGrnCount(LocalDate periodEnd) {
        return 0L;
    }
}
