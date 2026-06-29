package io.restaurantos.pos.feign;

import io.restaurantos.pos.config.FeignClientConfig;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.exception.PeriodLockedException;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Feign client for Finance service period-status check.
 * Fail-closed: any exception (Finance unreachable) must bubble as PeriodLockedException.
 * Callers must wrap invocations in try/catch and convert to PeriodLockedException.
 */
@FeignClient(name = "finance-service", configuration = FeignClientConfig.class)
public interface FinancePeriodClient {

    /**
     * Returns the period status for a given branch and business date.
     * The finance controller at GET /internal/finance/periods/status is called directly.
     */
    @GetMapping("/internal/finance/periods/status")
    ApiResponse<PeriodStatusDto> getPeriodStatus(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestParam UUID branchId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date);

    /**
     * Resolved period status DTO — mirrors finance-service's PeriodStatusResponse.
     */
    record PeriodStatusDto(
            UUID periodId,
            String status,
            int fiscalYear,
            int periodNo
    ) {
        public boolean isLocked() {
            return "LOCKED".equals(status) || "CLOSED".equals(status);
        }
    }

    /**
     * Convenience: fetch period status and throw PeriodLockedException if locked/closed/unreachable.
     * Fail-closed: Finance unreachable == LOCKED (never close into unknown period).
     */
    static void assertPeriodOpen(FinancePeriodClient client, UUID tenantId, UUID branchId, LocalDate businessDate) {
        try {
            ApiResponse<PeriodStatusDto> resp = client.getPeriodStatus(tenantId, branchId, businessDate);
            if (resp == null || resp.data() == null || resp.data().isLocked()) {
                throw new PeriodLockedException("Accounting period is locked or closed for date: " + businessDate);
            }
        } catch (PeriodLockedException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new PeriodLockedException("Finance service unreachable — treating period as locked: " + ex.getMessage());
        }
    }
}
