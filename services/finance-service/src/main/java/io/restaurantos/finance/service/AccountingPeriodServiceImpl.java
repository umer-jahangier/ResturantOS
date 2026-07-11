package io.restaurantos.finance.service;

import io.restaurantos.finance.domain.enums.PeriodStatus;
import io.restaurantos.finance.domain.model.AccountingPeriod;
import io.restaurantos.finance.dto.AccountingPeriodDto;
import io.restaurantos.finance.dto.PeriodStatusResponse;
import io.restaurantos.finance.exception.PeriodNotFoundException;
import io.restaurantos.finance.mapper.PeriodMapper;
import io.restaurantos.finance.repository.AccountingPeriodRepository;
import io.restaurantos.finance.util.PakistanFiscalYear;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.shared.tenant.TenantGucHelper;
import jakarta.persistence.EntityManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
@Transactional
public class AccountingPeriodServiceImpl implements AccountingPeriodService {

    private static final Logger log = LoggerFactory.getLogger(AccountingPeriodServiceImpl.class);

    private final AccountingPeriodRepository periodRepo;
    private final PeriodMapper periodMapper;
    private final TenantContext tenantContext;
    private final EntityManager entityManager;

    @Value("${finance.period.auto-seed-on-miss:true}")
    private boolean autoSeedOnMiss;

    public AccountingPeriodServiceImpl(AccountingPeriodRepository periodRepo,
                                        PeriodMapper periodMapper,
                                        TenantContext tenantContext,
                                        EntityManager entityManager) {
        this.periodRepo = periodRepo;
        this.periodMapper = periodMapper;
        this.tenantContext = tenantContext;
        this.entityManager = entityManager;
    }

    private void ensureTenantGuc() {
        TenantGucHelper.apply(entityManager, tenantContext);
    }

    /**
     * Seeds 12 accounting periods for Pakistan FY (Jul–Jun).
     * Period 1 = July of (fiscalYear-1), Period 12 = June of fiscalYear.
     * Formula: month = ((6 + periodNo - 1) % 12) + 1
     * Verified: periodNo=1→7(Jul), periodNo=6→12(Dec), periodNo=7→1(Jan), periodNo=12→6(Jun)
     */
    @Override
    public int seedForTenant(UUID tenantId, int fiscalYear) {
        ensureTenantGuc();
        int seeded = 0;
        int startCalYear = fiscalYear - 1;
        for (int periodNo = 1; periodNo <= 12; periodNo++) {
            if (periodRepo.existsByTenantIdAndFiscalYearAndPeriodNo(tenantId, fiscalYear, periodNo)) {
                continue;
            }
            int month = ((6 + periodNo - 1) % 12) + 1;
            int year = (periodNo <= 6) ? startCalYear : fiscalYear;
            LocalDate start = LocalDate.of(year, month, 1);
            LocalDate end = start.withDayOfMonth(start.lengthOfMonth());

            AccountingPeriod p = new AccountingPeriod();
            p.setTenantId(tenantId);
            p.setFiscalYear(fiscalYear);
            p.setPeriodNo(periodNo);
            p.setStartDate(start);
            p.setEndDate(end);
            p.setStatus(PeriodStatus.OPEN);
            periodRepo.save(p);
            seeded++;
        }
        return seeded;
    }

    @Override
    @Transactional(readOnly = true)
    public List<AccountingPeriodDto> listByFiscalYear(int fiscalYear) {
        ensureTenantGuc();
        UUID tid = tenantContext.requireTenantId();
        return periodRepo.findByTenantIdAndFiscalYearOrderByPeriodNo(tid, fiscalYear)
                .stream()
                .map(periodMapper::toDto)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<AccountingPeriodDto> listByStatus(PeriodStatus status) {
        ensureTenantGuc();
        UUID tid = tenantContext.requireTenantId();
        return periodRepo.findByTenantIdAndStatusOrderByStartDateAsc(tid, status)
                .stream()
                .map(periodMapper::toDto)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<AccountingPeriodDto> listOpenPeriods() {
        return listByStatus(PeriodStatus.OPEN);
    }

    @Override
    @Transactional(readOnly = true)
    public AccountingPeriodDto getById(UUID id) {
        ensureTenantGuc();
        return periodRepo.findById(id)
                .map(periodMapper::toDto)
                .orElseThrow(() -> new PeriodNotFoundException(id));
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<AccountingPeriod> getCurrentOpenPeriod() {
        ensureTenantGuc();
        UUID tid = tenantContext.requireTenantId();
        return periodRepo.findFirstByTenantIdAndStatusOrderByEndDateDesc(tid, PeriodStatus.OPEN);
    }

    @Override
    @Transactional
    public PeriodStatusResponse getPeriodStatus(UUID branchId, LocalDate date) {
        ensureTenantGuc();
        UUID tid = tenantContext.requireTenantId();
        AccountingPeriod period = periodRepo
                .findByTenantIdAndStartDateLessThanEqualAndEndDateGreaterThanEqual(tid, date, date)
                .orElseGet(() -> {
                    if (!autoSeedOnMiss) {
                        throw new PeriodNotFoundException(null);
                    }
                    int fiscalYear = PakistanFiscalYear.forDate(date);
                    log.warn("Auto-seeding accounting periods on miss: tenantId={}, requestedDate={}, fiscalYear={}",
                            tid, date, fiscalYear);
                    seedForTenant(tid, fiscalYear);
                    return periodRepo
                            .findByTenantIdAndStartDateLessThanEqualAndEndDateGreaterThanEqual(tid, date, date)
                            .orElseThrow(() -> new PeriodNotFoundException(null));
                });
        return new PeriodStatusResponse(
                period.getId(), period.getStatus(), period.getFiscalYear(), period.getPeriodNo());
    }
}
