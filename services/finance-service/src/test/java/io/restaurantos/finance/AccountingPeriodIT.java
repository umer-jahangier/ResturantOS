package io.restaurantos.finance;

import io.restaurantos.finance.domain.enums.PeriodStatus;
import io.restaurantos.finance.dto.AccountingPeriodDto;
import io.restaurantos.finance.dto.CreateJeLineRequest;
import io.restaurantos.finance.dto.CreateJeRequest;
import io.restaurantos.finance.dto.ProvisioningResult;
import io.restaurantos.finance.feign.InventoryInternalClient;
import io.restaurantos.finance.feign.PosInternalClient;
import io.restaurantos.finance.feign.PurchasingInternalClient;
import io.restaurantos.finance.repository.AccountingPeriodRepository;
import io.restaurantos.finance.service.AccountingPeriodService;
import io.restaurantos.finance.service.JournalEntryService;
import io.restaurantos.finance.service.PeriodCloseService;
import io.restaurantos.finance.service.ProvisioningService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Integration tests for AccountingPeriod seeding and period close/lock workflow.
 */
class AccountingPeriodIT extends FinanceTestBase {

    @Autowired
    private ProvisioningService provisioningService;

    @Autowired
    private AccountingPeriodService periodService;

    @Autowired
    private PeriodCloseService periodCloseService;

    @Autowired
    private JournalEntryService jeService;

    @Autowired
    private AccountingPeriodRepository periodRepo;

    @Autowired
    private TenantContext tenantContext;

    // Feign clients mocked so tests don't need real downstream services
    @MockitoBean
    private PosInternalClient posClient;

    @MockitoBean
    private InventoryInternalClient inventoryClient;

    @MockitoBean
    private PurchasingInternalClient purchasingClient;

    private UUID tenantId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        // All pre-checks pass (stubs return 0)
        when(posClient.getOpenOrderCount(any(), any())).thenReturn(0L);
        when(inventoryClient.getPendingGrnCount(any())).thenReturn(0L);
        when(purchasingClient.getUnmatchedInvoiceCount(any())).thenReturn(0L);
    }

    @Test
    void seedTwelvePeriodsForFiscalYear() {
        ProvisioningResult result = provisioningService.provision(tenantId, 2026);
        // provision() clears TenantContext in finally; re-set for subsequent queries
        tenantContext.set(tenantId, null, null, null);

        assertThat(result.periodsSeeded()).isEqualTo(12);

        List<AccountingPeriodDto> periods = periodService.listByFiscalYear(2026);
        assertThat(periods).hasSize(12);

        // Pakistan FY 2026: period 1 = July 2025, period 12 = June 2026
        AccountingPeriodDto period1 = periods.stream()
                .filter(p -> p.periodNo() == 1)
                .findFirst().orElseThrow();
        assertThat(period1.startDate()).isEqualTo(LocalDate.of(2025, 7, 1));

        AccountingPeriodDto period12 = periods.stream()
                .filter(p -> p.periodNo() == 12)
                .findFirst().orElseThrow();
        assertThat(period12.endDate()).isEqualTo(LocalDate.of(2026, 6, 30));

        assertThat(periods).allMatch(p -> p.status() == PeriodStatus.OPEN);
    }

    @Test
    void seedingIsIdempotent() {
        provisioningService.provision(tenantId, 2026);
        ProvisioningResult secondResult = provisioningService.provision(tenantId, 2026);
        tenantContext.set(tenantId, null, null, null);

        assertThat(secondResult.periodsSeeded()).isEqualTo(0);
        assertThat(periodService.listByFiscalYear(2026)).hasSize(12);
    }

    @Test
    void closePeriod_happyPath() {
        provisioningService.provision(tenantId, 2026);
        tenantContext.set(tenantId, null, null, null);
        List<AccountingPeriodDto> periods = periodService.listByFiscalYear(2026);
        UUID periodId = periods.get(0).id();

        AccountingPeriodDto closed = periodCloseService.close(periodId, true);

        assertThat(closed.status()).isEqualTo(PeriodStatus.LOCKED);
        assertThat(closed.lockedAt()).isNotNull();
    }

    @Test
    void postToLockedPeriod_returns423() {
        // Provision + set tenant context for JE posting
        UUID jeUserId = UUID.randomUUID();
        tenantId = UUID.randomUUID();
        provisioningService.provision(tenantId, 2026);
        tenantContext.set(tenantId, null, jeUserId, null);

        // Find the June 2026 period (period 12 in Pakistan FY 2026)
        List<AccountingPeriodDto> periods = periodService.listByFiscalYear(2026);
        AccountingPeriodDto junePeriod = periods.stream()
                .filter(p -> p.periodNo() == 12)
                .findFirst().orElseThrow();

        // Lock the period
        periodCloseService.close(junePeriod.id(), true);

        // Attempt to create a JE for a date inside the locked period (June 2026)
        LocalDate jeDate = LocalDate.of(2026, 6, 15);
        assertThatThrownBy(() -> jeService.create(new CreateJeRequest(
                jeDate, "Test entry to locked period",
                null, "TEST", null,
                List.of(
                        new CreateJeLineRequest("1010", "Cash", 5000L, 0L),
                        new CreateJeLineRequest("4100", "Revenue", 0L, 5000L)
                )
        ))).isInstanceOf(io.restaurantos.finance.exception.PeriodLockedException.class)
           .satisfies(e -> {
               var ple = (io.restaurantos.finance.exception.PeriodLockedException) e;
               assertThat(ple.getPeriodId()).isEqualTo(junePeriod.id());
           });
    }

    @Test
    void closePeriod_withoutTotp_returns403() {
        provisioningService.provision(tenantId, 2026);
        tenantContext.set(tenantId, null, null, null);
        List<AccountingPeriodDto> periods = periodService.listByFiscalYear(2026);
        UUID periodId = periods.get(0).id();

        assertThatThrownBy(() -> periodCloseService.close(periodId, false))
                .isInstanceOf(io.restaurantos.finance.exception.TotpRequiredException.class);
    }
}
