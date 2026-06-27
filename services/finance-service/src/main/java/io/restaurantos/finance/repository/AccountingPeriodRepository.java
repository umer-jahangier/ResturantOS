package io.restaurantos.finance.repository;

import io.restaurantos.finance.domain.enums.PeriodStatus;
import io.restaurantos.finance.domain.model.AccountingPeriod;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface AccountingPeriodRepository extends JpaRepository<AccountingPeriod, UUID> {

    List<AccountingPeriod> findByTenantIdAndFiscalYearOrderByPeriodNo(UUID tenantId, int fiscalYear);

    List<AccountingPeriod> findByTenantIdAndStatus(UUID tenantId, PeriodStatus status);

    Optional<AccountingPeriod> findFirstByTenantIdAndStatusOrderByEndDateDesc(UUID tenantId, PeriodStatus status);

    Optional<AccountingPeriod> findByTenantIdAndStartDateLessThanEqualAndEndDateGreaterThanEqual(
            UUID tenantId, LocalDate date1, LocalDate date2);

    boolean existsByTenantIdAndFiscalYearAndPeriodNo(UUID tenantId, int fiscalYear, int periodNo);

    long countByTenantId(UUID tenantId);

    List<AccountingPeriod> findByTenantIdAndStatusOrderByStartDateAsc(
            UUID tenantId, PeriodStatus status);
}
