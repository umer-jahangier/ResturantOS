package io.restaurantos.hr.payroll.tax;

import io.restaurantos.hr.entity.TaxConfigEntity;
import io.restaurantos.hr.repository.TaxConfigRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

/**
 * Loads the active {@code tax_config} row for the current tenant + fiscal year and exposes it as
 * parsed slabs + EOBI parameters. Throws if none is configured — payroll must NEVER fall back to
 * hardcoded rates.
 */
@Service
public class TaxConfigService {

    private final TaxConfigRepository repository;
    private final TenantContext tenantContext;

    public TaxConfigService(TaxConfigRepository repository, TenantContext tenantContext) {
        this.repository = repository;
        this.tenantContext = tenantContext;
    }

    public ActiveTaxConfig getActiveConfig(int fiscalYear) {
        UUID tenantId = tenantContext.getTenantId()
                .orElseThrow(() -> new IllegalStateException("No tenant context for tax_config lookup"));
        TaxConfigEntity e = repository.findByTenantIdAndFiscalYearAndActiveTrue(tenantId, fiscalYear)
                .orElseThrow(() -> new IllegalStateException(
                        "No active tax_config for tenant " + tenantId + " fiscal year " + fiscalYear));
        return new ActiveTaxConfig(
                e.getIncomeTaxSlabs(),
                e.getSurchargeThresholdPaisa(),
                e.getSurchargeRatePct(),
                e.getEobiEmployerRatePct(),
                e.getEobiEmployeeRatePct(),
                e.getEobiWageBasePaisa());
    }

    /** Parsed, ready-to-compute view of a tax_config row. */
    public record ActiveTaxConfig(
            List<TaxSlab> slabs,
            long surchargeThresholdPaisa,
            double surchargeRatePct,
            double eobiEmployerRatePct,
            double eobiEmployeeRatePct,
            long eobiWageBasePaisa) {
    }
}
