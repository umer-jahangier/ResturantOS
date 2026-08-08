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
 * PAYROLL_RUN_PAID (from hr-service on hr.topic) -> the net disbursement journal entry
 * (DR 2300 / CR Bank). Queue + binding are broker-provisioned (hr.topic/hr.payroll.paid).
 */
@Component
public class PayrollPaidConsumer {

    public static final String CONSUMER_NAME = "finance.payroll-paid";
    public static final String QUEUE_NAME = "finance.payroll-paid.queue";

    private final ProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final AutoPostingRecipeEngine recipeEngine;
    private final EventEnvelopeReader envelopeReader;

    public PayrollPaidConsumer(ProcessedEventService processedEventService,
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
                tenantAwareMessageProcessor.process(envelope, recipeEngine::postPayrollPaid));
    }
}
