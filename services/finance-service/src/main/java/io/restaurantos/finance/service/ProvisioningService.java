package io.restaurantos.finance.service;

import io.restaurantos.finance.domain.enums.PeriodStatus;
import io.restaurantos.finance.domain.model.AccountingPeriod;
import io.restaurantos.finance.dto.ProvisioningResult;
import io.restaurantos.finance.repository.AccountingPeriodRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.UUID;

@Service
@Transactional
public class ProvisioningService {

    private final CoaService coaService;
    private final AccountingPeriodRepository periodRepo;
    private final TenantContext tenantContext;

    public ProvisioningService(CoaService coaService,
                                AccountingPeriodRepository periodRepo,
                                TenantContext tenantContext) {
        this.coaService = coaService;
        this.periodRepo = periodRepo;
        this.tenantContext = tenantContext;
    }

    public ProvisioningResult provision(UUID tenantId, int fiscalYear) {
        tenantContext.set(tenantId, null, null, null);
        try {
            int accountsSeeded = coaService.seedForTenant(tenantId);
            int periodsSeeded = seedAccountingPeriods(tenantId, fiscalYear);
            return new ProvisioningResult(accountsSeeded, periodsSeeded);
        } finally {
            tenantContext.clear();
        }
    }

    private int seedAccountingPeriods(UUID tenantId, int fiscalYear) {
        int count = 0;
        for (int month = 1; month <= 12; month++) {
            if (!periodRepo.existsByFiscalYearAndPeriodNo(fiscalYear, month)) {
                AccountingPeriod period = new AccountingPeriod();
                period.setTenantId(tenantId);
                period.setFiscalYear(fiscalYear);
                period.setPeriodNo(month);
                period.setStartDate(LocalDate.of(fiscalYear, month, 1));
                period.setEndDate(LocalDate.of(fiscalYear, month, 1).withDayOfMonth(
                        LocalDate.of(fiscalYear, month, 1).lengthOfMonth()));
                period.setStatus(PeriodStatus.OPEN);
                periodRepo.save(period);
                count++;
            }
        }
        return count;
    }
}
