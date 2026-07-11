package io.restaurantos.finance;

import io.restaurantos.finance.feign.InventoryInternalClient;
import io.restaurantos.finance.feign.PosInternalClient;
import io.restaurantos.finance.feign.PurchasingInternalClient;
import io.restaurantos.finance.repository.AccountingPeriodRepository;
import io.restaurantos.finance.service.AccountingPeriodService;
import io.restaurantos.finance.service.ProvisioningService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.time.LocalDate;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Dedicated test class (not a method inside AccountingPeriodIT) because Spring caches the
 * application context per unique property set — flipping finance.period.auto-seed-on-miss
 * per-test-method is not possible without forcing a context reload. FinanceTestBase does not
 * pin this key via @DynamicPropertySource, so @TestPropertySource cleanly overrides it here.
 */
@TestPropertySource(properties = "finance.period.auto-seed-on-miss=false")
class AccountingPeriodAutoSeedToggleIT extends FinanceTestBase {

    @Autowired
    private ProvisioningService provisioningService;

    @Autowired
    private AccountingPeriodService periodService;

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
    void getPeriodStatus_toggleOff_missThrowsPeriodNotFound() {
        // Seed only Pakistan FY2026 (period 1 = July 2025, period 12 = June 2026).
        // Deliberately do not seed FY2027.
        provisioningService.provision(tenantId, 2026);
        tenantContext.set(tenantId, null, null, null);

        // July 10 2026 falls outside FY2026 (ends June 30 2026) — belongs to FY2027,
        // deliberately near the Jul-1 fiscal-year boundary per RESEARCH.md Pitfall 5.
        assertThatThrownBy(() -> periodService.getPeriodStatus(UUID.randomUUID(), LocalDate.of(2026, 7, 10)))
                .isInstanceOf(io.restaurantos.finance.exception.PeriodNotFoundException.class);

        // Off-path must not self-heal: no FY2027 periods should have been seeded as a side effect.
        assertThat(periodRepo.findByTenantIdAndFiscalYearOrderByPeriodNo(tenantId, 2027)).isEmpty();
    }
}
