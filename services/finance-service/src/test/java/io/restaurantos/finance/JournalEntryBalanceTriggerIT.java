package io.restaurantos.finance;

import io.restaurantos.finance.domain.enums.JeStatus;
import io.restaurantos.finance.repository.AccountingPeriodRepository;
import io.restaurantos.finance.repository.JournalEntryRepository;
import io.restaurantos.finance.service.JournalEntryService;
import io.restaurantos.finance.service.ProvisioningService;
import io.restaurantos.finance.dto.CreateJeRequest;
import io.restaurantos.finance.dto.CreateJeLineRequest;
import io.restaurantos.finance.feign.InventoryInternalClient;
import io.restaurantos.finance.feign.PosInternalClient;
import io.restaurantos.finance.feign.PurchasingInternalClient;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Proves that the DEFERRABLE INITIALLY DEFERRED balance trigger fires at commit.
 * CRITICAL: lines must be added AND post() called within the SAME @Transactional scope.
 */
class JournalEntryBalanceTriggerIT extends FinanceTestBase {

    @MockitoBean
    private PosInternalClient posClient;

    @MockitoBean
    private InventoryInternalClient inventoryClient;

    @MockitoBean
    private PurchasingInternalClient purchasingClient;

    @Autowired
    private JournalEntryService jeService;

    @Autowired
    private ProvisioningService provisioningService;

    @Autowired
    private TenantContext tenantContext;

    @Autowired
    private AccountingPeriodRepository periodRepo;

    @Autowired
    private JournalEntryRepository jeRepo;

    private UUID tenantId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        provisioningService.provision(tenantId, 2026);
        tenantContext.set(tenantId, null, null, null);
    }

    @Test
    void unbalancedJeIsRejectedAtCommit() {
        // Create a DRAFT JE first
        var draftDto = jeService.create(new CreateJeRequest(
                LocalDate.of(2026, 6, 15),
                "Unbalanced test entry",
                null, "TEST", null,
                List.of(new CreateJeLineRequest("1010", "Cash debit", 5000L, 0L))
        ));

        // post() — the deferred trigger fires at commit and MUST throw for unbalanced entry
        assertThatThrownBy(() -> jeService.post(draftDto.id()))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("JE_UNBALANCED");
    }

    @Test
    void balancedJePostsSuccessfully() {
        var draftDto = jeService.create(new CreateJeRequest(
                LocalDate.of(2026, 6, 15),
                "Balanced sales entry",
                null, "POS", null,
                List.of(
                        new CreateJeLineRequest("1010", "Cash in", 10000L, 0L),
                        new CreateJeLineRequest("4100", "Revenue out", 0L, 10000L)
                )
        ));

        var posted = jeService.post(draftDto.id());

        assertThat(posted.status()).isEqualTo(JeStatus.POSTED);
        assertThat(posted.entryNo()).matches("JE-2026-\\d{6}");
    }
}
