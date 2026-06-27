package io.restaurantos.finance.service;

import io.restaurantos.finance.domain.enums.PeriodStatus;
import io.restaurantos.finance.dto.AccountingPeriodDto;
import io.restaurantos.finance.exception.PeriodAlreadyLockedException;
import io.restaurantos.finance.exception.PeriodNotFoundException;
import io.restaurantos.finance.exception.PeriodPreCheckException;
import io.restaurantos.finance.exception.TotpRequiredException;
import io.restaurantos.finance.feign.InventoryInternalClient;
import io.restaurantos.finance.feign.PosInternalClient;
import io.restaurantos.finance.feign.PurchasingInternalClient;
import io.restaurantos.finance.mapper.PeriodMapper;
import io.restaurantos.finance.repository.AccountingPeriodRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

@Service
@Transactional
public class PeriodCloseService {

    private final AccountingPeriodRepository periodRepo;
    private final PeriodMapper periodMapper;
    private final PosInternalClient posClient;
    private final InventoryInternalClient inventoryClient;
    private final PurchasingInternalClient purchasingClient;
    private final TenantContext tenantContext;

    public PeriodCloseService(AccountingPeriodRepository periodRepo,
                               PeriodMapper periodMapper,
                               PosInternalClient posClient,
                               InventoryInternalClient inventoryClient,
                               PurchasingInternalClient purchasingClient,
                               TenantContext tenantContext) {
        this.periodRepo = periodRepo;
        this.periodMapper = periodMapper;
        this.posClient = posClient;
        this.inventoryClient = inventoryClient;
        this.purchasingClient = purchasingClient;
        this.tenantContext = tenantContext;
    }

    /**
     * Closes (locks) an accounting period.
     * Requires TOTP verification, passes all pre-close checks, then sets status=LOCKED.
     */
    public AccountingPeriodDto close(UUID periodId, boolean totpVerified) {
        if (!totpVerified) {
            throw new TotpRequiredException();
        }

        var period = periodRepo.findById(periodId)
                .orElseThrow(() -> new PeriodNotFoundException(periodId));

        if (period.getStatus() == PeriodStatus.LOCKED) {
            throw new PeriodAlreadyLockedException(periodId);
        }

        // Pre-close checks via internal Feign clients (Phase 6: fallbacks return 0)
        long openOrders = posClient.getOpenOrderCount(period.getStartDate(), period.getEndDate());
        long pendingGrn = inventoryClient.getPendingGrnCount(period.getEndDate());
        long unmatchedInvoices = purchasingClient.getUnmatchedInvoiceCount(period.getEndDate());

        if (openOrders > 0) {
            throw new PeriodPreCheckException("open orders: " + openOrders);
        }
        if (pendingGrn > 0) {
            throw new PeriodPreCheckException("pending GRNs: " + pendingGrn);
        }
        if (unmatchedInvoices > 0) {
            throw new PeriodPreCheckException("unmatched invoices: " + unmatchedInvoices);
        }

        period.setStatus(PeriodStatus.LOCKED);
        period.setLockedBy(tenantContext.getUserId().orElse(null));
        period.setLockedAt(Instant.now());
        periodRepo.save(period);

        return periodMapper.toDto(period);
    }
}
