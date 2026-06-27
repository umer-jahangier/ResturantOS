package io.restaurantos.finance;

import io.restaurantos.finance.domain.enums.PeriodStatus;
import io.restaurantos.finance.domain.model.AccountingPeriod;
import io.restaurantos.finance.domain.model.JournalEntry;
import io.restaurantos.finance.domain.model.JournalLine;
import io.restaurantos.finance.domain.enums.JeStatus;
import io.restaurantos.finance.repository.AccountingPeriodRepository;
import io.restaurantos.finance.repository.JournalEntryRepository;
import io.restaurantos.finance.service.JournalEntryService;
import io.restaurantos.finance.service.ProvisioningService;
import io.restaurantos.finance.dto.CreateJeRequest;
import io.restaurantos.finance.dto.CreateJeLineRequest;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Proves that the DEFERRABLE INITIALLY DEFERRED balance trigger fires at commit.
 * CRITICAL: lines must be added AND post() called within the SAME @Transactional scope.
 */
@SpringBootTest
@Testcontainers
class JournalEntryBalanceTriggerIT {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
            .withDatabaseName("finance_db")
            .withUsername("finance_user")
            .withPassword("finance_pass");

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("eureka.client.enabled", () -> "false");
        registry.add("spring.cloud.config.enabled", () -> "false");
    }

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
