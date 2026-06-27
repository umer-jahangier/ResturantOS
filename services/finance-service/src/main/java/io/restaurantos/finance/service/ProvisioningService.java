package io.restaurantos.finance.service;

import io.restaurantos.finance.dto.ProvisioningResult;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@Transactional
public class ProvisioningService {

    private final CoaService coaService;
    private final AccountingPeriodService periodService;
    private final TenantContext tenantContext;

    public ProvisioningService(CoaService coaService,
                                AccountingPeriodService periodService,
                                TenantContext tenantContext) {
        this.coaService = coaService;
        this.periodService = periodService;
        this.tenantContext = tenantContext;
    }

    public ProvisioningResult provision(UUID tenantId, int fiscalYear) {
        tenantContext.set(tenantId, null, null, null);
        try {
            int accountsSeeded = coaService.seedForTenant(tenantId);
            int periodsSeeded = periodService.seedForTenant(tenantId, fiscalYear);
            return new ProvisioningResult(accountsSeeded, periodsSeeded);
        } finally {
            tenantContext.clear();
        }
    }
}
