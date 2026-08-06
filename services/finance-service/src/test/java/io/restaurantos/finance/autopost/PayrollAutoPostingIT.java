package io.restaurantos.finance.autopost;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.finance.FinanceServiceApplication;
import io.restaurantos.finance.config.InternalTenantContextHelper;
import io.restaurantos.finance.domain.enums.JeStatus;
import io.restaurantos.finance.repository.JournalEntryRepository;
import io.restaurantos.finance.service.ProvisioningService;
import io.restaurantos.finance.util.PakistanFiscalYear;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.event.payload.HrEventContract;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.time.Instant;
import java.util.UUID;

import static java.util.concurrent.TimeUnit.SECONDS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/**
 * HR-03 consumer side: an approved+paid HR payroll run posts two balanced JEs in finance,
 * idempotently, and leaves 2300 Wages Payable at exactly zero.
 *
 * <p><b>Payloads come from {@link HrEventContract}, not from a hand-written map.</b> This test used
 * to author {@code Map.of("runId", ..., "totalGrossPaisa", ...)} using the CONSUMER's own key
 * names, which is the precise pattern that let four dead seams pass a green suite in the 2026-08-02
 * audit: the test and the consumer agreed with each other and neither agreed with the producer.
 * Building the record the producer publishes means a field rename now breaks compilation here.
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

    // A run with every deduction component non-zero, so the split across 2300/2310/2320/1750 is
    // actually exercised. net = gross - tax - eobi - advances - lateArrival.
    private static final long GROSS = 25_000_000L;
    private static final long TAX = 679_100L;
    private static final long EOBI = 37_000L;
    private static final long ADVANCES = 1_200_000L;
    private static final long LATE_ARRIVAL = 150_000L;
    private static final long NET = GROSS - TAX - EOBI - ADVANCES - LATE_ARRIVAL;

    @Test
    void payrollApprovedThenPaid_postBalancedJes_idempotently() throws Exception {
        UUID runId = UUID.randomUUID();

        // APPROVED -> DR salary expense (gross - lateArrival) / CR wages payable + PAYE + EOBI +
        // employee advances. Resolving those tags proves finance V9 seeded 2310/2320/1750.
        publish(HrEventContract.PAYROLL_RUN_APPROVED_KEY, HrEventContract.PAYROLL_RUN_APPROVED, approvedPayload(runId));
        awaitJe(AutoPostingRecipeEngine.SOURCE_PAYROLL_APPROVED, runId);

        // PAID -> net JE (DR 2300 / CR Bank).
        publish(HrEventContract.PAYROLL_RUN_PAID_KEY, HrEventContract.PAYROLL_RUN_PAID, paidPayload(runId));
        awaitJe(AutoPostingRecipeEngine.SOURCE_PAYROLL_PAID, runId);

        // Replays must not post a duplicate (PostedSourceEvent guard) — the finders below are
        // single-valued, so a second JE for the same (sourceType, sourceId) would fail them.
        publish(HrEventContract.PAYROLL_RUN_APPROVED_KEY, HrEventContract.PAYROLL_RUN_APPROVED, approvedPayload(runId));
        publish(HrEventContract.PAYROLL_RUN_PAID_KEY, HrEventContract.PAYROLL_RUN_PAID, paidPayload(runId));
        awaitJe(AutoPostingRecipeEngine.SOURCE_PAYROLL_APPROVED, runId);
        awaitJe(AutoPostingRecipeEngine.SOURCE_PAYROLL_PAID, runId);

        // The drift regression, end to end and against real seeded accounts: 2300 must be flat once
        // the run is approved and paid. Under the old recipe (CR gross / DR net) it was left holding
        // tax + eobi + advances + lateArrival, with both entries individually balanced.
        assertThat(accountBalance("2300"))
                .as("2300 Wages Payable must clear to exactly zero across the approved+paid pair")
                .isZero();
        assertThat(accountBalance("2310")).isEqualTo(TAX);
        assertThat(accountBalance("2320")).isEqualTo(EOBI);
        assertThat(accountBalance("1750")).isEqualTo(ADVANCES);
        assertThat(accountBalance("6200")).isEqualTo(-(GROSS - LATE_ARRIVAL));
        assertThat(accountBalance("1110")).isEqualTo(NET);
    }

    private HrEventContract.PayrollApprovedPayload approvedPayload(UUID runId) {
        return new HrEventContract.PayrollApprovedPayload(
                runId, branchId, 8, 2025, GROSS, NET, TAX, EOBI, ADVANCES, LATE_ARRIVAL);
    }

    private HrEventContract.PayrollPaidPayload paidPayload(UUID runId) {
        return new HrEventContract.PayrollPaidPayload(runId, branchId, 8, 2025, NET);
    }

    /** Signed credit-minus-debit total across this tenant's payroll JEs, by account code. */
    private long accountBalance(String accountCode) {
        tenantHelper.activate(tenantId);
        try {
            // Lines are LAZY, so the traversal has to happen inside a transaction.
            return new org.springframework.transaction.support.TransactionTemplate(txManager).execute(status ->
                    jeRepo.findAll().stream()
                            .filter(e -> tenantId.equals(e.getTenantId()))
                            .flatMap(e -> e.getLines().stream())
                            .filter(l -> accountCode.equals(l.getAccountCode()))
                            .mapToLong(l -> l.getCreditPaisa() - l.getDebitPaisa())
                            .sum());
        } finally {
            tenantHelper.clear();
        }
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
