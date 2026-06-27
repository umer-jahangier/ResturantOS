package io.restaurantos.finance.service;

import io.restaurantos.finance.dto.GlBalanceDto;
import io.restaurantos.finance.dto.JournalLineDto;
import io.restaurantos.finance.mapper.JournalEntryMapper;
import io.restaurantos.finance.repository.ChartOfAccountRepository;
import io.restaurantos.finance.repository.JournalLineRepository;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.shared.tenant.TenantGucHelper;
import jakarta.persistence.EntityManager;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@Transactional(readOnly = true)
public class GlService {

    private final JournalLineRepository lineRepo;
    private final ChartOfAccountRepository coaRepo;
    private final JournalEntryMapper mapper;
    private final TenantContext tenantContext;
    private final EntityManager entityManager;

    public GlService(JournalLineRepository lineRepo,
                     ChartOfAccountRepository coaRepo,
                     JournalEntryMapper mapper,
                     TenantContext tenantContext,
                     EntityManager entityManager) {
        this.lineRepo = lineRepo;
        this.coaRepo = coaRepo;
        this.mapper = mapper;
        this.tenantContext = tenantContext;
        this.entityManager = entityManager;
    }

    private void ensureTenantGuc() {
        TenantGucHelper.apply(entityManager, tenantContext);
    }

    public List<GlBalanceDto> getGlBalances(UUID periodId, UUID branchId) {
        ensureTenantGuc();
        List<Object[]> raw = lineRepo.findGlBalancesRaw(periodId, branchId);
        return raw.stream()
                .map(row -> {
                    String code = (String) row[0];
                    long dr = ((Number) row[1]).longValue();
                    long cr = ((Number) row[2]).longValue();
                    String accountName = coaRepo.findByCode(code)
                            .map(a -> a.getName())
                            .orElse(code);
                    return new GlBalanceDto(code, accountName, dr, cr, dr - cr);
                })
                .toList();
    }

    public Page<JournalLineDto> getGlEntries(
            String accountCode, UUID periodId, UUID branchId, Pageable pageable) {
        ensureTenantGuc();
        return lineRepo
                .findPostedByAccountCodeAndPeriodIdAndBranchId(
                        accountCode, periodId, branchId, pageable)
                .map(mapper::toLineDto);
    }
}
