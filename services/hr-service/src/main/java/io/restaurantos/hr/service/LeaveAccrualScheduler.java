package io.restaurantos.hr.service;

import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Year;
import java.util.UUID;

/**
 * Monthly cross-tenant leave accrual. Runs once a month (the cron IS the idempotency — one accrual
 * per period), enumerates tenants via the SECURITY DEFINER {@code hr_tenant_ids()} function (a
 * scheduled thread has no tenant context and would see nothing under FORCE RLS), and for each tenant
 * sets {@link TenantContext} — so {@code TenantAwareDataSource} scopes the accrual's connection to
 * that tenant — then calls {@link LeaveService#accrue}. A per-tenant failure is logged and skipped,
 * never aborting the whole run.
 */
@Component
public class LeaveAccrualScheduler {

    private static final Logger log = LoggerFactory.getLogger(LeaveAccrualScheduler.class);

    private final LeaveService leaveService;
    private final TenantContext tenantContext;

    public LeaveAccrualScheduler(LeaveService leaveService, TenantContext tenantContext) {
        this.leaveService = leaveService;
        this.tenantContext = tenantContext;
    }

    // 02:00 on the 1st of every month by default; overridable per environment.
    @Scheduled(cron = "${restaurantos.hr.leave-accrual-cron:0 0 2 1 * *}")
    public void accrueMonthly() {
        int year = Year.now().getValue();
        int tenants = 0;
        for (UUID tenantId : leaveService.listTenantIdsForAccrual()) {
            try {
                tenantContext.set(tenantId, null, null, null);
                leaveService.accrue(year);
                tenants++;
            } catch (Exception e) {
                log.warn("Leave accrual failed for tenant {}: {}", tenantId, e.getMessage());
            } finally {
                tenantContext.clear();
            }
        }
        log.info("Monthly leave accrual completed for {} tenant(s), year {}", tenants, year);
    }
}
