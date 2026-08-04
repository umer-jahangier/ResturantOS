package io.restaurantos.finance.feign;

import io.restaurantos.finance.exception.PeriodPreCheckException;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Circuit-breaker fallback for {@link PurchasingInternalClient}.
 *
 * <p><b>Fails closed.</b> Both methods used to return {@code 0} — "nothing outstanding" — whenever
 * purchasing-service was unreachable, which let an accountant lock a period precisely when the
 * system could not tell them whether receipts or invoices were outstanding. For a pre-check whose
 * entire job is to block a close, an unknown answer must be treated as a blocking answer, matching
 * the fail-closed posture the gateway and OPA already take.
 */
@Component
public class PurchasingInternalClientFallback implements PurchasingInternalClient {

    @Override
    public long getUnmatchedInvoiceCount(LocalDate periodEnd) {
        throw new PeriodPreCheckException(
                "cannot verify unmatched vendor invoices — purchasing-service is unavailable");
    }

    @Override
    public long getPendingGrnCount(UUID tenantId, LocalDate periodEnd) {
        throw new PeriodPreCheckException(
                "cannot verify pending goods receipts — purchasing-service is unavailable");
    }
}
