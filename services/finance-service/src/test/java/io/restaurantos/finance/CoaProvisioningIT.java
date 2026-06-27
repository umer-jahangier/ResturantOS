package io.restaurantos.finance;

import io.restaurantos.finance.dto.ProvisioningResult;
import io.restaurantos.finance.repository.ChartOfAccountRepository;
import io.restaurantos.finance.service.ProvisioningService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@Testcontainers
class CoaProvisioningIT {

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
    private ProvisioningService provisioningService;

    @Autowired
    private ChartOfAccountRepository coaRepo;

    @Autowired
    private TenantContext tenantContext;

    @Test
    void provision_seedsExactly55Accounts() {
        UUID tenantId = UUID.randomUUID();
        ProvisioningResult result = provisioningService.provision(tenantId, 2026);
        assertThat(result.accountsSeeded()).isEqualTo(55);
    }

    @Test
    void provision_isIdempotent() {
        UUID tenantId = UUID.randomUUID();
        provisioningService.provision(tenantId, 2026);
        ProvisioningResult second = provisioningService.provision(tenantId, 2026);
        assertThat(second.accountsSeeded()).isEqualTo(0);
    }

    @Test
    void provision_seeds12AccountingPeriods() {
        UUID tenantId = UUID.randomUUID();
        ProvisioningResult result = provisioningService.provision(tenantId, 2026);
        assertThat(result.periodsSeeded()).isEqualTo(12);
    }

    @Test
    void getAccountByCode_returnsCashAccount() {
        UUID tenantId = UUID.randomUUID();
        provisioningService.provision(tenantId, 2026);

        tenantContext.set(tenantId, null, null, null);
        try {
            var accounts = coaRepo.findBySystemTag("CASH");
            assertThat(accounts).isNotEmpty();
            assertThat(accounts.get(0).getCode()).isEqualTo("1010");
            assertThat(accounts.get(0).getSystemTag()).isEqualTo("CASH");
        } finally {
            tenantContext.clear();
        }
    }
}
