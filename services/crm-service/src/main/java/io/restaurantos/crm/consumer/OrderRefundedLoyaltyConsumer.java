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
 * ORDER_REFUNDED -> loyalty point debit.
 *
 * <p>This consumer read {@code customerId} off an untyped map and returned early when it was
 * absent. It was ALWAYS absent: the ORDER_REFUNDED payload never carried one. So points accrued on
 * every order and were debited back on none of them — CRM-02's refund half had never once run.
 * {@code customerId} is now part of the shared contract and populated by pos-service, and reading
 * it off a typed record means a future producer change breaks the build instead of the behaviour.
 */
@Component
public class OrderRefundedLoyaltyConsumer {

    public static final String CONSUMER_NAME = "crm.order-refunded";
    public static final String QUEUE_NAME = CrmRabbitConfig.ORDER_REFUNDED_QUEUE;

    private final ProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final LoyaltyService loyaltyService;
    private final EventEnvelopeReader envelopeReader;

    public OrderRefundedLoyaltyConsumer(ProcessedEventService processedEventService,
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
        EventEnvelope<PosEventContract.OrderRefundedPayload> envelope =
                envelopeReader.read(message, PosEventContract.OrderRefundedPayload.class);
        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                tenantAwareMessageProcessor.process(envelope, this::handle));
    }

    private void handle(EventEnvelope<PosEventContract.OrderRefundedPayload> envelope) {
        PosEventContract.OrderRefundedPayload payload = envelope.payload();
        if (payload.customerId() == null) {
            return;
        }
        loyaltyService.debitForRefund(payload.customerId(), payload.orderId(), payload.refundPaisa());
    }
}
