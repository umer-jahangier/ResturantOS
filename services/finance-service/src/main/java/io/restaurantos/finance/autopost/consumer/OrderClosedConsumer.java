package io.restaurantos.finance.autopost.consumer;

import io.restaurantos.finance.autopost.AutoPostingRecipeEngine;
import io.restaurantos.finance.autopost.ProcessedEventService;
import io.restaurantos.finance.config.FinanceRabbitConfig;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.event.EventEnvelopeReader;
import io.restaurantos.shared.event.payload.PosEventContract;
import io.restaurantos.shared.tenant.TenantAwareMessageProcessor;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

/**
 * ORDER_CLOSED -> the revenue journal entry: DR each tender, CR net revenue + service charge + output tax.
 *
 * <p>Parses through {@link EventEnvelopeReader} — a typed, tolerant read that dead-letters a
 * poison message instead of the previous catch-and-return-null, which ACKed and destroyed any
 * event it could not parse.
 */
@Component
public class OrderClosedConsumer {

    public static final String CONSUMER_NAME = "finance.order-closed";
    public static final String QUEUE_NAME = FinanceRabbitConfig.ORDER_CLOSED_QUEUE;

    private final ProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final AutoPostingRecipeEngine recipeEngine;
    private final EventEnvelopeReader envelopeReader;

    public OrderClosedConsumer(ProcessedEventService processedEventService,
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
        EventEnvelope<PosEventContract.OrderClosedPayload> envelope =
                envelopeReader.read(message, PosEventContract.OrderClosedPayload.class);
        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                tenantAwareMessageProcessor.process(envelope, recipeEngine::postOrderRevenue));
    }
}
