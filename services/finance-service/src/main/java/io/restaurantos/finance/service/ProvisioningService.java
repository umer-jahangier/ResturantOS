package io.restaurantos.finance.service;

import io.restaurantos.finance.dto.ProvisioningResult;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.shared.tenant.TenantGucHelper;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@Transactional
public class ProvisioningService {

    private final CoaService coaService;
    private final AccountingPeriodService periodService;
    private final TenantContext tenantContext;
    private final EntityManager entityManager;

    public ProvisioningService(CoaService coaService,
                                AccountingPeriodService periodService,
                                TenantContext tenantContext,
                                EntityManager entityManager) {
        this.coaService = coaService;
        this.periodService = periodService;
        this.tenantContext = tenantContext;
        this.entityManager = entityManager;
    }

    public ProvisioningResult provision(UUID tenantId, int fiscalYear) {
        TenantGucHelper.apply(entityManager, tenantContext);
        int accountsSeeded = coaService.seedForTenant(tenantId);
        int periodsSeeded = periodService.seedForTenant(tenantId, fiscalYear);
        return new ProvisioningResult(accountsSeeded, periodsSeeded);
    }
}
