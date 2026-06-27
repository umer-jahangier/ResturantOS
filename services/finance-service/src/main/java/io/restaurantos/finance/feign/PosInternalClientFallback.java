package io.restaurantos.finance.feign;

import org.springframework.stereotype.Component;

import java.time.LocalDate;

/**
 * Circuit-breaker fallback for PosInternalClient.
 * Phase 6: stubs return 0 (no open orders).
 * TODO Phase 7: implement real POS endpoint.
 */
@Component
public class PosInternalClientFallback implements PosInternalClient {

    @Override
    public long getOpenOrderCount(LocalDate periodStart, LocalDate periodEnd) {
        return 0L;
    }
}
