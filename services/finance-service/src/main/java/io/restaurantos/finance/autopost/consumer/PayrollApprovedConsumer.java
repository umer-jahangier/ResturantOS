package io.restaurantos.finance.autopost.consumer;

import io.restaurantos.finance.autopost.AutoPostingRecipeEngine;
import io.restaurantos.finance.autopost.ProcessedEventService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.event.EventEnvelopeReader;
import io.restaurantos.shared.tenant.TenantAwareMessageProcessor;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * PAYROLL_RUN_APPROVED (from hr-service on hr.topic) -> the gross payroll journal entry
 * (DR 6200 / CR 2300). HR publishes a generic Map payload, so the envelope is read untyped.
 * The queue + binding are broker-provisioned in rabbitmq-definitions (hr.topic/hr.payroll.approved).
 */
@Component
public class PayrollApprovedConsumer {

    public static final String CONSUMER_NAME = "finance.payroll-approved";
    public static final String QUEUE_NAME = "finance.payroll-approved.queue";

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
        @SuppressWarnings("unchecked")
        EventEnvelope<Map<String, Object>> envelope =
                (EventEnvelope<Map<String, Object>>) (EventEnvelope<?>) envelopeReader.read(message, Map.class);
        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                tenantAwareMessageProcessor.process(envelope, recipeEngine::postPayrollApproved));
    }
}
