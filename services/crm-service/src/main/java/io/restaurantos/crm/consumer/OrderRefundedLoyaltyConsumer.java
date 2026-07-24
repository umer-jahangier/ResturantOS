package io.restaurantos.crm.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.crm.service.LoyaltyService;
import io.restaurantos.crm.service.ProcessedEventService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.tenant.TenantAwareMessageProcessor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;

@Component
@Slf4j
public class OrderRefundedLoyaltyConsumer {

    public static final String CONSUMER_NAME = "crm.order-refunded";
    public static final String QUEUE_NAME = "crm.order-refunded.queue";

    private final ProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final LoyaltyService loyaltyService;
    private final ObjectMapper objectMapper;

    public OrderRefundedLoyaltyConsumer(ProcessedEventService processedEventService,
                                        TenantAwareMessageProcessor tenantAwareMessageProcessor,
                                        LoyaltyService loyaltyService,
                                        ObjectMapper objectMapper) {
        this.processedEventService = processedEventService;
        this.tenantAwareMessageProcessor = tenantAwareMessageProcessor;
        this.loyaltyService = loyaltyService;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = QUEUE_NAME)
    public void onMessage(Message message) {
        EventEnvelope<Map<String, Object>> envelope = deserialize(message);
        if (envelope == null) {
            return;
        }
        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                tenantAwareMessageProcessor.process(envelope, this::handle));
    }

    private void handle(EventEnvelope<Map<String, Object>> envelope) {
        Map<String, Object> payload = envelope.payload();
        Object customerIdObj = payload.get("customerId");
        if (customerIdObj == null) {
            return;
        }
        UUID customerId = UUID.fromString(customerIdObj.toString());
        UUID orderId = UUID.fromString(payload.get("orderId").toString());
        long refundPaisa = longVal(payload, "refundPaisa");
        loyaltyService.debitForRefund(customerId, orderId, refundPaisa);
    }

    @SuppressWarnings("unchecked")
    private EventEnvelope<Map<String, Object>> deserialize(Message message) {
        try {
            return objectMapper.readValue(message.getBody(),
                    objectMapper.getTypeFactory().constructParametricType(EventEnvelope.class, Map.class));
        } catch (Exception e) {
            log.error("OrderRefundedLoyaltyConsumer: deserialize failed: {}", e.getMessage());
            return null;
        }
    }

    private static long longVal(Map<String, Object> map, String key) {
        Object v = map.get(key);
        if (v instanceof Number n) {
            return n.longValue();
        }
        return v != null ? Long.parseLong(v.toString()) : 0L;
    }
}
