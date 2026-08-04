package io.restaurantos.crm.consumer;

import io.restaurantos.crm.config.CrmRabbitConfig;
import io.restaurantos.crm.service.LoyaltyService;
import io.restaurantos.crm.service.ProcessedEventService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.event.EventEnvelopeReader;
import io.restaurantos.shared.event.payload.PosEventContract;
import io.restaurantos.shared.tenant.TenantAwareMessageProcessor;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

/**
 * ORDER_CLOSED -> loyalty accrual.
 *
 * <p>A null {@code customerId} is a walk-in and accrues nothing. That is correct — and it was also
 * the only branch this consumer ever took in practice, because until the POS customer picker
 * shipped there was no way to attach a customer to an order at all.
 */
@Component
public class OrderClosedLoyaltyConsumer {

    public static final String CONSUMER_NAME = "crm.order-closed";
    public static final String QUEUE_NAME = CrmRabbitConfig.ORDER_CLOSED_QUEUE;

    private final ProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final LoyaltyService loyaltyService;
    private final EventEnvelopeReader envelopeReader;

    public OrderClosedLoyaltyConsumer(ProcessedEventService processedEventService,
                                      TenantAwareMessageProcessor tenantAwareMessageProcessor,
                                      LoyaltyService loyaltyService,
                                      EventEnvelopeReader envelopeReader) {
        this.processedEventService = processedEventService;
        this.tenantAwareMessageProcessor = tenantAwareMessageProcessor;
        this.loyaltyService = loyaltyService;
        this.envelopeReader = envelopeReader;
    }

    @RabbitListener(queues = QUEUE_NAME)
    public void onMessage(Message message) {
        EventEnvelope<PosEventContract.OrderClosedPayload> envelope =
                envelopeReader.read(message, PosEventContract.OrderClosedPayload.class);
        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                tenantAwareMessageProcessor.process(envelope, this::handle));
    }

    private void handle(EventEnvelope<PosEventContract.OrderClosedPayload> envelope) {
        PosEventContract.OrderClosedPayload payload = envelope.payload();
        if (payload.customerId() == null) {
            return;
        }
        loyaltyService.ensureTierConfig(envelope.tenantId());
        loyaltyService.accrueForOrder(payload.customerId(), payload.orderId(), payload.totalPaisa());
    }
}
