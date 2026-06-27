package io.restaurantos.finance.repository;

import io.restaurantos.finance.domain.model.AccountingPeriod;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface AccountingPeriodRepository extends JpaRepository<AccountingPeriod, UUID> {

    Optional<AccountingPeriod> findByStartDateLessThanEqualAndEndDateGreaterThanEqual(
            LocalDate date1, LocalDate date2);

    boolean existsByFiscalYearAndPeriodNo(int fiscalYear, int periodNo);
}
