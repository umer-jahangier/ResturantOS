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
 * PAYROLL_RUN_PAID (from hr-service on hr.topic) -> the net disbursement journal entry
 * (DR wages payable · CR bank), typed on {@link HrEventContract.PayrollPaidPayload}.
 */
@Component
public class PayrollPaidConsumer {

    public static final String CONSUMER_NAME = "finance.payroll-paid";
    public static final String QUEUE_NAME = FinanceRabbitConfig.PAYROLL_PAID_QUEUE;

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
        EventEnvelope<HrEventContract.PayrollPaidPayload> envelope =
                envelopeReader.read(message, HrEventContract.PayrollPaidPayload.class);
        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                tenantAwareMessageProcessor.process(envelope, recipeEngine::postPayrollPaid));
    }
}
