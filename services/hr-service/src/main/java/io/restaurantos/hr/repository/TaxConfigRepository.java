package io.restaurantos.hr.repository;

import io.restaurantos.hr.entity.TaxConfigEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface TaxConfigRepository extends JpaRepository<TaxConfigEntity, UUID> {

    /** What payroll asks for. An empty result is refused, never defaulted. */
    Optional<TaxConfigEntity> findByTenantIdAndFiscalYearAndActiveTrue(UUID tenantId, Integer fiscalYear);

    /**
     * The same year regardless of the active flag — what a SAVE needs.
     *
     * <p>{@code uk_tax_config_tenant_fy} is UNIQUE on (tenant_id, fiscal_year), so a second row for
     * a year cannot exist. A save therefore has to find and update the existing row rather than
     * insert beside it; looking only at the active ones would miss a deactivated year and turn an
     * edit into a constraint violation reported as a bare 409.
     */
    Optional<TaxConfigEntity> findByTenantIdAndFiscalYear(UUID tenantId, Integer fiscalYear);

    /** Newest year first — the order the settings screen lists them in. */
    List<TaxConfigEntity> findAllByTenantIdOrderByFiscalYearDesc(UUID tenantId);
}
