package io.restaurantos.finance.service;

import io.restaurantos.finance.domain.enums.PeriodStatus;
import io.restaurantos.finance.domain.model.AccountingPeriod;
import io.restaurantos.finance.dto.AccountingPeriodDto;
import io.restaurantos.finance.dto.PeriodStatusResponse;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AccountingPeriodService {

    /**
     * Seeds 12 accounting periods for the given tenant + fiscal year.
     * Pakistan FY: period 1 = July of (fiscalYear-1), period 12 = June of fiscalYear.
     * Idempotent: skips existing periods.
     *
     * @return number of periods actually inserted
     */
    int seedForTenant(UUID tenantId, int fiscalYear);

    List<AccountingPeriodDto> listByFiscalYear(int fiscalYear);

    List<AccountingPeriodDto> listByStatus(PeriodStatus status);

    List<AccountingPeriodDto> listOpenPeriods();

    AccountingPeriodDto getById(UUID id);

    Optional<AccountingPeriod> getCurrentOpenPeriod();

    PeriodStatusResponse getPeriodStatus(UUID branchId, LocalDate date);
}
