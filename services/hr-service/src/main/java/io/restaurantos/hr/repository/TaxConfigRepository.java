package io.restaurantos.hr.repository;

import io.restaurantos.hr.entity.TaxConfigEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface TaxConfigRepository extends JpaRepository<TaxConfigEntity, UUID> {

    Optional<TaxConfigEntity> findByTenantIdAndFiscalYearAndActiveTrue(UUID tenantId, Integer fiscalYear);
}
