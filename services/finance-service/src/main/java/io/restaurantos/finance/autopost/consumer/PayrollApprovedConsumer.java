package io.restaurantos.finance.autopost.consumer;

import io.restaurantos.finance.autopost.AutoPostingRecipeEngine;
import io.restaurantos.finance.autopost.ProcessedEventService;
import io.restaurantos.finance.config.FinanceRabbitConfig;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.event.EventEnvelopeReader;
import io.restaurantos.shared.event.payload.HrEventContract;
import io.restaurantos.shared.tenant.TenantAwareMessageProcessor;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

/**
 * PAYROLL_RUN_APPROVED (from hr-service on hr.topic) -> the payroll obligation journal entry
 * (DR salary expense · CR wages payable + PAYE + EOBI + employee advances).
 *
 * <p>Reads the shared {@link HrEventContract.PayrollApprovedPayload}, not a
 * {@code Map<String, Object>}. The untyped read was the last survivor of the seam class the
 * 2026-08-02 integration repair removed everywhere else: a missing key deserialized to {@code 0},
 * the recipe's zero-guard returned early, and the message was acked and marked processed with
 * nothing posted. A producer rename is now a compile error.
 */
@Component
public class PayrollApprovedConsumer {

    public static final String CONSUMER_NAME = "finance.payroll-approved";
    public static final String QUEUE_NAME = FinanceRabbitConfig.PAYROLL_APPROVED_QUEUE;

    private final ProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final AutoPostingRecipeEngine recipeEngine;
    private final EventEnvelopeReader envelopeReader;

    public PayrollApprovedConsumer(ProcessedEventService processedEventService,
                                   TenantAwareMessageProcessor tenantAwareMessageProcessor,
                                   AutoPostingRecipeEngine recipeEngine,
                                   EventEnvelopeReader envelopeReader) {
        this.processedEventService = processedEventService;
        this.tenantAwareMessageProcessor = tenantAwareMessageProcessor;
        this.recipeEngine = recipeEngine;
        this.envelopeReader = envelopeReader;
    }

    @RabbitListener(queues = QUEUE_NAME)
    public void onMessage(Message message) {
        EventEnvelope<HrEventContract.PayrollApprovedPayload> envelope =
                envelopeReader.read(message, HrEventContract.PayrollApprovedPayload.class);
        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                tenantAwareMessageProcessor.process(envelope, recipeEngine::postPayrollApproved));
    }
}
