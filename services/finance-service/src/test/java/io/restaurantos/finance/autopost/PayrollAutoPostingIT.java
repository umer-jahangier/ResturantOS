package io.restaurantos.finance.autopost;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.finance.FinanceServiceApplication;
import io.restaurantos.finance.config.InternalTenantContextHelper;
import io.restaurantos.finance.domain.enums.JeStatus;
import io.restaurantos.finance.repository.JournalEntryRepository;
import io.restaurantos.finance.service.ProvisioningService;
import io.restaurantos.finance.util.PakistanFiscalYear;
import io.restaurantos.shared.event.EventEnvelope;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static java.util.concurrent.TimeUnit.SECONDS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/**
 * HR-03 consumer side: an approved+paid HR payroll run posts two balanced JEs in finance
 * (DR 6200 / CR 2300 gross; DR 2300 / CR Bank net), idempotently.
 */
@SpringBootTest(classes = FinanceServiceApplication.class)
class PayrollAutoPostingIT extends AutoPostingITBase {

    @MockitoBean
    private io.restaurantos.shared.idempotency.IdempotencyKeyRepository idempotencyKeyRepository;

    @MockitoBean
    private io.restaurantos.shared.event.OutboxRepository outboxRepository;

    @Autowired private ProvisioningService provisioningService;
    @Autowired private InternalTenantContextHelper tenantHelper;
    @Autowired private JournalEntryRepository jeRepo;
    @Autowired private org.springframework.transaction.PlatformTransactionManager txManager;
    @Autowired private RabbitTemplate rabbitTemplate;
    @Autowired private ObjectMapper objectMapper;

    private UUID tenantId;
    private UUID branchId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantHelper.activate(tenantId);
        try {
            provisioningService.provision(tenantId, PakistanFiscalYear.current());
        } finally {
            tenantHelper.clear();
        }
    }

    @Test
    void payrollApprovedThenPaid_postBalancedJes_idempotently() throws Exception {
        UUID runId = UUID.randomUUID();

        // APPROVED -> gross JE (DR 6200 / CR 2300).
        publish("hr.payroll.approved", "PAYROLL_RUN_APPROVED", Map.of(
                "runId", runId.toString(),
                "branchId", branchId.toString(),
                "periodMonth", 8,
                "periodYear", 2025,
                "totalGrossPaisa", 25_000_000L));
        awaitJe(AutoPostingRecipeEngine.SOURCE_PAYROLL_APPROVED, runId);

        // PAID -> net JE (DR 2300 / CR Bank).
        publish("hr.payroll.paid", "PAYROLL_RUN_PAID", Map.of(
                "runId", runId.toString(),
                "branchId", branchId.toString(),
                "totalNetPaisa", 23_000_000L));
        awaitJe(AutoPostingRecipeEngine.SOURCE_PAYROLL_PAID, runId);

        // Replays must not post a duplicate (PostedSourceEvent guard) — the finders below are
        // single-valued, so a second JE for the same (sourceType, sourceId) would fail them.
        publish("hr.payroll.approved", "PAYROLL_RUN_APPROVED", Map.of(
                "runId", runId.toString(), "branchId", branchId.toString(), "totalGrossPaisa", 25_000_000L));
        publish("hr.payroll.paid", "PAYROLL_RUN_PAID", Map.of(
                "runId", runId.toString(), "branchId", branchId.toString(), "totalNetPaisa", 23_000_000L));
        awaitJe(AutoPostingRecipeEngine.SOURCE_PAYROLL_APPROVED, runId);
        awaitJe(AutoPostingRecipeEngine.SOURCE_PAYROLL_PAID, runId);
    }

    private void awaitJe(String sourceType, UUID sourceId) {
        await().atMost(15, SECONDS).untilAsserted(() -> {
            tenantHelper.activate(tenantId);
            try {
                var je = jeRepo.findByTenantIdAndSourceTypeAndSourceId(tenantId, sourceType, sourceId);
                assertThat(je).isPresent();
                assertThat(je.get().getStatus()).isEqualTo(JeStatus.POSTED);
                long[] dc = debitsAndCredits(je.get().getId());
                assertThat(dc[0]).isEqualTo(dc[1]);
                assertThat(dc[0]).isGreaterThan(0L);
            } finally {
                tenantHelper.clear();
            }
        });
    }

    private long[] debitsAndCredits(UUID jeId) {
        return new org.springframework.transaction.support.TransactionTemplate(txManager).execute(status -> {
            var entry = jeRepo.findById(jeId).orElseThrow();
            long debits = entry.getLines().stream().mapToLong(l -> l.getDebitPaisa()).sum();
            long credits = entry.getLines().stream().mapToLong(l -> l.getCreditPaisa()).sum();
            return new long[]{debits, credits};
        });
    }

    private void publish(String routingKey, String eventType, Object payload) throws Exception {
        EventEnvelope<Object> envelope = new EventEnvelope<>(
                UUID.randomUUID(), eventType, tenantId, branchId, Instant.now(),
                UUID.randomUUID(), 1, "hr-service", payload);
        byte[] body = objectMapper.writeValueAsBytes(envelope);
        rabbitTemplate.send("hr.topic", routingKey, new org.springframework.amqp.core.Message(body));
    }
}
