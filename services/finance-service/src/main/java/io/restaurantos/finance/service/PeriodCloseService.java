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
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.shared.tenant.TenantGucHelper;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

@Service
@Transactional
public class PeriodCloseService {

    private static final String FINANCE_EXCHANGE = "finance.topic";
    private static final String PERIOD_CLOSED_KEY = "finance.period.closed";
    private static final String PERIOD_CLOSED_TYPE = "PERIOD_CLOSED";

    private final AccountingPeriodRepository periodRepo;
    private final PeriodMapper periodMapper;
    private final PosInternalClient posClient;
    private final InventoryInternalClient inventoryClient;
    private final PurchasingInternalClient purchasingClient;
    private final TenantContext tenantContext;
    private final EventPublisher eventPublisher;
    private final EntityManager entityManager;

    public PeriodCloseService(AccountingPeriodRepository periodRepo,
                               PeriodMapper periodMapper,
                               PosInternalClient posClient,
                               InventoryInternalClient inventoryClient,
                               PurchasingInternalClient purchasingClient,
                               TenantContext tenantContext,
                               EventPublisher eventPublisher,
                               EntityManager entityManager) {
        this.periodRepo = periodRepo;
        this.periodMapper = periodMapper;
        this.posClient = posClient;
        this.inventoryClient = inventoryClient;
        this.purchasingClient = purchasingClient;
        this.tenantContext = tenantContext;
        this.eventPublisher = eventPublisher;
        this.entityManager = entityManager;
    }

    private void ensureTenantGuc() {
        TenantGucHelper.apply(entityManager, tenantContext);
    }

    /**
     * Closes (locks) an accounting period.
     * Requires TOTP verification, passes all pre-close checks, then sets status=LOCKED.
     */
    public AccountingPeriodDto close(UUID periodId, boolean totpVerified) {
        ensureTenantGuc();
        if (!totpVerified) {
            throw new TotpRequiredException();
        }

        var period = periodRepo.findById(periodId)
                .orElseThrow(() -> new PeriodNotFoundException(periodId));

        if (period.getStatus() != PeriodStatus.OPEN) {
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
        UUID closedBy = tenantContext.getUserId().orElse(null);
        period.setLockedBy(closedBy);
        period.setLockedAt(Instant.now());
        periodRepo.save(period);

        var payload = new java.util.HashMap<String, Object>();
        payload.put("periodId", period.getId());
        payload.put("fiscalYear", period.getFiscalYear());
        payload.put("periodNo", period.getPeriodNo());
        if (closedBy != null) {
            payload.put("closedBy", closedBy);
        }
        eventPublisher.publish(
                FINANCE_EXCHANGE,
                PERIOD_CLOSED_KEY,
                PERIOD_CLOSED_TYPE,
                null,
                payload);

        return periodMapper.toDto(period);
    }
}
