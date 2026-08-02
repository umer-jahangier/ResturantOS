package io.restaurantos.inventory.consumer;

import io.restaurantos.inventory.config.InventoryRabbitConfig;
import io.restaurantos.inventory.dto.ReceiptDtos.ReceiveStockRequest;
import io.restaurantos.inventory.service.ProcessedEventService;
import io.restaurantos.inventory.service.ReceiptService;
import io.restaurantos.inventory.service.TenantRegistryService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.event.EventEnvelopeReader;
import io.restaurantos.shared.event.payload.PurchasingEventContract;
import io.restaurantos.shared.tenant.TenantAwareMessageProcessor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

/**
 * GRN_RECEIVED → real stock.
 *
 * <p><b>The gap this closes.</b> purchasing-service could approve a PO, receive goods against it,
 * post the GR/IR journal entry and match a vendor invoice — and none of it ever touched inventory.
 * It published a {@code STOCK_RECEIVED} message onto inventory's own exchange, in a shape
 * inventory does not publish, that nothing consumed. So {@code qty_on_hand}, {@code stock_lots}
 * and moving-average cost only ever moved through the manual receipt screen: depletion ran against
 * stock purchasing believed it had already delivered, COGS was valued off hand-typed costs while
 * AP was valued off invoices, and Phase 08.2's whole vendor catalog with its effective-dated
 * pricing fed a receipt that changed nothing.
 *
 * <p>This consumer routes each GRN line through {@link ReceiptService} — the same tested path the
 * manual receipt screen uses, so lot creation, MAC recomputation and the real STOCK_RECEIVED event
 * are all shared rather than reimplemented. Inventory keeps sole ownership of the stock write.
 *
 * <p><b>Idempotent on the envelope's eventId</b> via {@code processed_events}, so purchasing may
 * retry freely without double-receiving. Each resulting movement is stamped
 * {@code referenceType='GRN'} + the grnId, which is what makes a stock lot traceable back to the
 * purchase order that caused it.
 */
@Component
public class GrnReceivedConsumer {

    private static final Logger log = LoggerFactory.getLogger(GrnReceivedConsumer.class);

    static final String CONSUMER_NAME = "inventory.grn-received";

    private final ProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final ReceiptService receiptService;
    private final TenantRegistryService tenantRegistryService;
    private final EventEnvelopeReader envelopeReader;

    public GrnReceivedConsumer(ProcessedEventService processedEventService,
                               TenantAwareMessageProcessor tenantAwareMessageProcessor,
                               ReceiptService receiptService,
                               TenantRegistryService tenantRegistryService,
                               EventEnvelopeReader envelopeReader) {
        this.processedEventService = processedEventService;
        this.tenantAwareMessageProcessor = tenantAwareMessageProcessor;
        this.receiptService = receiptService;
        this.tenantRegistryService = tenantRegistryService;
        this.envelopeReader = envelopeReader;
    }

    @RabbitListener(queues = InventoryRabbitConfig.INVENTORY_GRN_RECEIVED_QUEUE)
    public void onMessage(Message message) {
        EventEnvelope<PurchasingEventContract.GrnReceivedPayload> envelope =
                envelopeReader.read(message, PurchasingEventContract.GrnReceivedPayload.class);
        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                tenantAwareMessageProcessor.process(envelope, this::handle));
    }

    private void handle(EventEnvelope<PurchasingEventContract.GrnReceivedPayload> envelope) {
        PurchasingEventContract.GrnReceivedPayload payload = envelope.payload();

        // Same registration the manual write paths perform, so the nightly expiry sweep can
        // discover a tenant whose stock only ever arrived through purchasing.
        tenantRegistryService.registerTenant(envelope.tenantId());

        for (PurchasingEventContract.GrnLine line : payload.lines()) {
            if (line.ingredientId() == null) {
                // A PO line raised against a free-text description rather than a catalog item has
                // nothing to receive INTO. Skipping is correct — but it is a real coverage hole in
                // the procurement catalog, so it must be visible rather than silent.
                log.warn("GRN {} line {} has no ingredientId; no stock movement recorded",
                        payload.grnId(), line.poLineId());
                continue;
            }
            receiptService.receive(new ReceiveStockRequest(
                    line.ingredientId(),
                    payload.branchId(),
                    line.qtyReceived(),
                    line.unitCostPaisa(),
                    line.expiryDate(),
                    "GRN",
                    payload.grnId()));
        }
    }
}
