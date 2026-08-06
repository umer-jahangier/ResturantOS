package io.restaurantos.hr.service;

import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.YearMonth;
import java.util.UUID;

/**
 * Monthly cross-tenant leave accrual.
 *
 * <p><b>Idempotency lives in {@link LeaveService#accrue}, not in the cron.</b> This class used to
 * claim "the cron IS the idempotency — one accrual per period". It never was: {@code @Scheduled}
 * fires on every replica, so an N-replica deployment granted N times the leave, and any manual
 * re-trigger double-accrued with no way to detect it afterwards. Accrual is now keyed on
 * (employee, leave type, year, month) in {@code leave_accrual_log}, whose unique constraint is
 * also the distributed lock.
 *
 * <p>Enumerates tenants via the SECURITY DEFINER {@code hr_tenant_ids()} function (a scheduled
 * thread has no tenant context and would see nothing under FORCE RLS), and for each tenant sets
 * {@link TenantContext} — so {@code TenantAwareDataSource} scopes the accrual's connection to that
 * tenant. A per-tenant failure is logged and skipped, never aborting the whole run.
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
        YearMonth period = YearMonth.now();
        int tenants = 0;
        int accruedRows = 0;
        for (UUID tenantId : leaveService.listTenantIdsForAccrual()) {
            try {
                tenantContext.set(tenantId, null, null, null);
                accruedRows += leaveService.accrue(period.getYear(), period.getMonthValue());
                tenants++;
            } catch (Exception e) {
                log.warn("Leave accrual failed for tenant {}: {}", tenantId, e.getMessage());
            } finally {
                tenantContext.clear();
            }
        }
        log.info("Monthly leave accrual completed for {} tenant(s), period {} — {} balance(s) accrued "
                + "(0 means every tenant was already accrued for this period, which is expected on a "
                + "second replica or a re-run)", tenants, period, accruedRows);
    }
}
