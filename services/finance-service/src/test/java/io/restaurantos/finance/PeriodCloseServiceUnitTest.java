package io.restaurantos.finance;

import io.restaurantos.finance.domain.enums.PeriodStatus;
import io.restaurantos.finance.domain.model.AccountingPeriod;
import io.restaurantos.finance.exception.PeriodPreCheckException;
import io.restaurantos.finance.exception.TotpRequiredException;
import io.restaurantos.finance.feign.InventoryInternalClient;
import io.restaurantos.finance.feign.PosInternalClient;
import io.restaurantos.finance.feign.PurchasingInternalClient;
import io.restaurantos.finance.mapper.PeriodMapper;
import io.restaurantos.finance.repository.AccountingPeriodRepository;
import io.restaurantos.finance.service.PeriodCloseService;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class PeriodCloseServiceUnitTest {

    @Mock
    private AccountingPeriodRepository periodRepo;
    @Mock
    private PeriodMapper periodMapper;
    @Mock
    private PosInternalClient posClient;
    @Mock
    private InventoryInternalClient inventoryClient;
    @Mock
    private PurchasingInternalClient purchasingClient;
    @Mock
    private TenantContext tenantContext;
    @Mock
    private EventPublisher eventPublisher;
    @Mock
    private EntityManager entityManager;
    @Mock
    private Query nativeQuery;

    private PeriodCloseService service;

    private AccountingPeriod openPeriod;
    private UUID periodId;

    @BeforeEach
    void setUp() {
        UUID tenantId = UUID.randomUUID();
        when(tenantContext.getTenantId()).thenReturn(Optional.of(tenantId));
        when(tenantContext.requireTenantId()).thenReturn(tenantId);
        when(entityManager.createNativeQuery(anyString())).thenReturn(nativeQuery);
        when(nativeQuery.setParameter(anyString(), any())).thenReturn(nativeQuery);
        when(nativeQuery.getSingleResult()).thenReturn("");

        service = new PeriodCloseService(
                periodRepo, periodMapper,
                posClient, inventoryClient, purchasingClient,
                tenantContext, eventPublisher, entityManager
        );

        periodId = UUID.randomUUID();
        openPeriod = new AccountingPeriod();
        openPeriod.setFiscalYear(2026);
        openPeriod.setPeriodNo(1);
        openPeriod.setStartDate(LocalDate.of(2025, 7, 1));
        openPeriod.setEndDate(LocalDate.of(2025, 7, 31));
        openPeriod.setStatus(PeriodStatus.OPEN);
    }

    @Test
    void close_withAllStubsReturnZero_succeeds() {
        when(periodRepo.findById(periodId)).thenReturn(Optional.of(openPeriod));
        when(posClient.getOpenOrderCount(any(), any())).thenReturn(0L);
        when(inventoryClient.getPendingGrnCount(any())).thenReturn(0L);
        when(purchasingClient.getUnmatchedInvoiceCount(any())).thenReturn(0L);
        when(tenantContext.getUserId()).thenReturn(Optional.empty());
        when(periodRepo.save(any())).thenReturn(openPeriod);

        service.close(periodId, true);

        assertThat(openPeriod.getStatus()).isEqualTo(PeriodStatus.LOCKED);
        assertThat(openPeriod.getLockedAt()).isNotNull();
        verify(periodRepo).save(openPeriod);
    }

    @Test
    void close_whenPosClientReturnsOpenOrders_throwsPeriodPreCheckException() {
        when(periodRepo.findById(periodId)).thenReturn(Optional.of(openPeriod));
        when(posClient.getOpenOrderCount(any(), any())).thenReturn(5L);

        assertThatThrownBy(() -> service.close(periodId, true))
                .isInstanceOf(PeriodPreCheckException.class)
                .hasMessageContaining("open orders: 5");
    }

    @Test
    void close_withTotpFalse_throwsTotpRequiredException() {
        assertThatThrownBy(() -> service.close(periodId, false))
                .isInstanceOf(TotpRequiredException.class);

        verifyNoInteractions(periodRepo);
    }
}
