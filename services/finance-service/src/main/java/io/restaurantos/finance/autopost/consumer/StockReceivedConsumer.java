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
 * STOCK_RECEIVED -> DR inventory, CR GR/IR clearing.
 *
 * <p>New. The queue and its binding shipped with Phase 9 but no listener was ever written, so
 * every manual receipt and every goods receipt pushed a message onto a durable queue nothing
 * drained — unbounded growth, and no ledger entry for stock that had physically arrived.
 *
 * <p>Parses through {@link EventEnvelopeReader} — a typed, tolerant read that dead-letters a
 * poison message instead of the previous catch-and-return-null, which ACKed and destroyed any
 * event it could not parse.
 */
@Component
public class StockReceivedConsumer {

    public static final String CONSUMER_NAME = "finance.stock-received";
    public static final String QUEUE_NAME = FinanceRabbitConfig.STOCK_RECEIVED_QUEUE;

    private final ProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final AutoPostingRecipeEngine recipeEngine;
    private final EventEnvelopeReader envelopeReader;

    public StockReceivedConsumer(ProcessedEventService processedEventService,
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
        EventEnvelope<InventoryEventContract.StockReceivedPayload> envelope =
                envelopeReader.read(message, InventoryEventContract.StockReceivedPayload.class);
        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                tenantAwareMessageProcessor.process(envelope, recipeEngine::postStockReceipt));
    }
}
