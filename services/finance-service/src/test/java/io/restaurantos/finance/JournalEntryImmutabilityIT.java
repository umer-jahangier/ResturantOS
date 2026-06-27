package io.restaurantos.finance;

import io.restaurantos.finance.domain.enums.JeStatus;
import io.restaurantos.finance.dto.CreateJeLineRequest;
import io.restaurantos.finance.dto.CreateJeRequest;
import io.restaurantos.finance.dto.JournalEntryDto;
import io.restaurantos.finance.feign.InventoryInternalClient;
import io.restaurantos.finance.feign.PosInternalClient;
import io.restaurantos.finance.feign.PurchasingInternalClient;
import io.restaurantos.finance.repository.JournalEntryRepository;
import io.restaurantos.finance.service.JournalEntryService;
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

/**
 * Proves that the immutability trigger blocks UPDATE on POSTED JEs,
 * but allows the reversal link-back update (reversed_by_je).
 */
class JournalEntryImmutabilityIT extends FinanceTestBase {

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
    private JournalEntryRepository jeRepo;

    private UUID tenantId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        provisioningService.provision(tenantId, 2026);
        tenantContext.set(tenantId, null, null, null);
    }

    private JournalEntryDto createAndPostBalancedJe() {
        var draft = jeService.create(new CreateJeRequest(
                LocalDate.of(2026, 6, 15),
                "Test entry for immutability",
                null, "TEST", null,
                List.of(
                        new CreateJeLineRequest("1010", "Cash in", 5000L, 0L),
                        new CreateJeLineRequest("4100", "Revenue", 0L, 5000L)
                )
        ));
        return jeService.post(draft.id());
    }

    @Test
    void updateOnPostedJe_throwsException() {
        var posted = createAndPostBalancedJe();
        var je = jeRepo.findById(posted.id()).orElseThrow();

        // Attempt to tamper with description — immutability trigger should block
        je.setDescription("tampered description");
        assertThatThrownBy(() -> jeRepo.saveAndFlush(je))
                .hasMessageContaining("IMMUTABLE");
    }

    @Test
    void reversePostedJe_succeedsAndLinksOriginal() {
        var posted = createAndPostBalancedJe();

        var reversal = jeService.reverse(posted.id());

        assertThat(reversal.status()).isEqualTo(JeStatus.POSTED);
        assertThat(reversal.reversal()).isTrue();
        assertThat(reversal.reversalOfJe()).isEqualTo(posted.id());

        // Original JE should now have reversedByJe set
        var refreshedOrig = jeService.getById(posted.id());
        assertThat(refreshedOrig.reversedByJe()).isEqualTo(reversal.id());
    }

    @Test
    void reversalLinesSwapDebitCredit() {
        var posted = createAndPostBalancedJe();
        var reversal = jeService.reverse(posted.id());

        // Original: 1010 DR=5000, CR=0. Reversal: 1010 DR=0, CR=5000
        var cashLine = reversal.lines().stream()
                .filter(l -> "1010".equals(l.accountCode()))
                .findFirst()
                .orElseThrow();
        assertThat(cashLine.debitPaisa()).isEqualTo(0L);
        assertThat(cashLine.creditPaisa()).isEqualTo(5000L);
    }
}
