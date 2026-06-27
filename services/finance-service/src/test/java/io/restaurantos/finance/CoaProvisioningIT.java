package io.restaurantos.finance;

import io.restaurantos.finance.dto.ProvisioningResult;
import io.restaurantos.finance.repository.ChartOfAccountRepository;
import io.restaurantos.finance.seed.PakistanRestaurantCoaTemplate;
import io.restaurantos.finance.service.ProvisioningService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration tests for COA provisioning via /internal/tenants/{id}/provision.
 * Extends FinanceTestBase which provides the shared static Postgres container.
 */
class CoaProvisioningIT extends FinanceTestBase {

    private static final int TEMPLATE_SIZE = PakistanRestaurantCoaTemplate.build(UUID.randomUUID()).size();

    @Autowired
    private ProvisioningService provisioningService;

    @Autowired
    private ChartOfAccountRepository coaRepo;

    @Autowired
    private TenantContext tenantContext;

    @Test
    void provision_seedsAllTemplateAccounts() {
        UUID tenantId = UUID.randomUUID();
        ProvisioningResult result = provisioningService.provision(tenantId, 2026);
        assertThat(result.accountsSeeded()).isEqualTo(TEMPLATE_SIZE);
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
