package io.restaurantos.finance.feign;

import org.springframework.stereotype.Component;

import java.time.LocalDate;

/**
 * Circuit-breaker fallback for PurchasingInternalClient.
 * Phase 6: stubs return 0 (no unmatched invoices).
 * TODO Phase 10: implement real purchasing endpoint.
 */
@Component
public class PurchasingInternalClientFallback implements PurchasingInternalClient {

    @Override
    public long getUnmatchedInvoiceCount(LocalDate periodEnd) {
        return 0L;
    }
}
