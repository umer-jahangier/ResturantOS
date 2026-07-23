package io.restaurantos.finance.autopost.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.finance.autopost.AutoPostingRecipeEngine;
import io.restaurantos.finance.autopost.ProcessedEventService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.tenant.TenantAwareMessageProcessor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

import java.util.Map;

@Component
@Slf4j
public class OrderClosedConsumer {

    public static final String CONSUMER_NAME = "finance.order-closed";
    public static final String QUEUE_NAME = "finance.order-closed.queue";

    private final ProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final AutoPostingRecipeEngine recipeEngine;
    private final ObjectMapper objectMapper;

    public OrderClosedConsumer(ProcessedEventService processedEventService,
                               TenantAwareMessageProcessor tenantAwareMessageProcessor,
                               AutoPostingRecipeEngine recipeEngine,
                               ObjectMapper objectMapper) {
        this.processedEventService = processedEventService;
        this.tenantAwareMessageProcessor = tenantAwareMessageProcessor;
        this.recipeEngine = recipeEngine;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = QUEUE_NAME)
    public void onMessage(Message message) {
        EventEnvelope<Map<String, Object>> envelope = deserialize(message);
        if (envelope == null) {
            return;
        }
        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                tenantAwareMessageProcessor.process(envelope, recipeEngine::postOrderRevenue));
    }

    @SuppressWarnings("unchecked")
    private EventEnvelope<Map<String, Object>> deserialize(Message message) {
        try {
            return objectMapper.readValue(message.getBody(),
                    objectMapper.getTypeFactory().constructParametricType(EventEnvelope.class, Map.class));
        } catch (Exception e) {
            log.error("OrderClosedConsumer: deserialize failed: {}", e.getMessage());
            return null;
        }
    }
}
