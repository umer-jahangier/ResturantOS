package io.restaurantos.finance;

import io.restaurantos.finance.config.InternalTenantContextHelper;
import io.restaurantos.finance.dto.CreateJeLineRequest;
import io.restaurantos.finance.dto.InternalAutoPostJeRequest;
import io.restaurantos.finance.dto.InternalJePostResponse;
import io.restaurantos.finance.dto.PeriodStatusResponse;
import io.restaurantos.finance.service.AccountingPeriodService;
import io.restaurantos.finance.service.JournalEntryService;
import io.restaurantos.finance.service.ProvisioningService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class InternalAutoPostIT extends FinanceTestBase {

    @Autowired
    private ProvisioningService provisioningService;

    @Autowired
    private JournalEntryService jeService;

    @Autowired
    private AccountingPeriodService periodService;

    @Autowired
    private InternalTenantContextHelper tenantHelper;

    private UUID tenantId;
    private UUID branchId;
    private UUID sourceId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        sourceId = UUID.randomUUID();
        tenantHelper.activate(tenantId);
        try {
            provisioningService.provision(tenantId, 2026);
        } finally {
            tenantHelper.clear();
        }
    }

    @Test
    void autoPost_isIdempotentAndPostsBalancedJe() {
        InternalAutoPostJeRequest req = new InternalAutoPostJeRequest(
                branchId,
                LocalDate.of(2026, 6, 15),
                "POS sale",
                "ORDER",
                sourceId,
                List.of(
                        new CreateJeLineRequest("1010", "Cash", 5000L, 0L),
                        new CreateJeLineRequest("4100", "Revenue", 0L, 5000L)));

        tenantHelper.activate(tenantId);
        try {
            InternalJePostResponse first = jeService.autoPostInternal(req);
            InternalJePostResponse second = jeService.autoPostInternal(req);
            assertThat(first.entryNo()).isNotBlank();
            assertThat(second.jeId()).isEqualTo(first.jeId());
            assertThat(second.entryNo()).isEqualTo(first.entryNo());

            PeriodStatusResponse status = periodService.getPeriodStatus(branchId, req.entryDate());
            assertThat(status.status().name()).isEqualTo("OPEN");
        } finally {
            tenantHelper.clear();
        }
    }
}
