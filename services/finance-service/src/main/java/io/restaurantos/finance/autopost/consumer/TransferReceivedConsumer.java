package io.restaurantos.finance.autopost.consumer;

import io.restaurantos.finance.autopost.AutoPostingRecipeEngine;
import io.restaurantos.finance.autopost.ProcessedEventService;
import io.restaurantos.finance.config.FinanceRabbitConfig;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.event.EventEnvelopeReader;
import io.restaurantos.shared.event.payload.InventoryEventContract;
import io.restaurantos.shared.tenant.TenantAwareMessageProcessor;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

/**
 * TRANSFER_RECEIVED -> DR inventory, CR goods in transit at the receiving branch.
 *
 * <p>Parses through {@link EventEnvelopeReader} — a typed, tolerant read that dead-letters a
 * poison message instead of the previous catch-and-return-null, which ACKed and destroyed any
 * event it could not parse.
 */
@Component
public class TransferReceivedConsumer {

    public static final String CONSUMER_NAME = "finance.transfer-received";
    public static final String QUEUE_NAME = FinanceRabbitConfig.TRANSFER_RECEIVED_QUEUE;

    private final ProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final AutoPostingRecipeEngine recipeEngine;
    private final EventEnvelopeReader envelopeReader;

    public TransferReceivedConsumer(ProcessedEventService processedEventService,
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
        EventEnvelope<InventoryEventContract.TransferReceivedPayload> envelope =
                envelopeReader.read(message, InventoryEventContract.TransferReceivedPayload.class);
        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                tenantAwareMessageProcessor.process(envelope, recipeEngine::postTransferReceived));
    }
}
