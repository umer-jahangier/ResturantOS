package io.restaurantos.pos.consumer;

import io.micrometer.core.instrument.MeterRegistry;
import io.restaurantos.pos.config.PosKitchenTopologyConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * Observability for dead-lettered POS events — the POS-side twin of
 * {@code io.restaurantos.kitchen.consumer.KitchenDeadLetterMonitor}. Any kitchen→POS event a
 * consumer cannot process (poison payload rejected, or retries exhausted) dead-letters to
 * {@code <queue>.dlq}; this logs it at ERROR (original queue + reason + body for replay) and
 * increments the {@code messaging.dead_letter.total} Micrometer counter that alerting scrapes, so a
 * failed consume is visible in minutes instead of vanishing silently.
 */
@Component
public class PosDeadLetterMonitor {

    private static final Logger log = LoggerFactory.getLogger(PosDeadLetterMonitor.class);

    private final MeterRegistry meterRegistry;

    public PosDeadLetterMonitor(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
    }

    @RabbitListener(containerFactory = "dlqListenerContainerFactory", queues = {
            PosKitchenTopologyConfig.POS_ORDER_READY_QUEUE + ".dlq",
            PosKitchenTopologyConfig.POS_KITCHEN_ITEM_STATUS_QUEUE + ".dlq"
    })
    public void onDeadLetter(Message message) {
        String originalQueue = firstDeath(message, "queue");
        String reason = firstDeath(message, "reason");
        String body = new String(message.getBody(), StandardCharsets.UTF_8);

        meterRegistry.counter("messaging.dead_letter.total",
                "service", "pos", "queue", originalQueue).increment();

        log.error("DEAD-LETTER [pos] queue={} reason={} — event permanently failed "
                + "(poison payload or retries exhausted). Captured for replay. body={}",
                originalQueue, reason, body);
    }

    /** Reads a field from the first entry of the RabbitMQ {@code x-death} header, or "unknown". */
    private static String firstDeath(Message message, String key) {
        Object xDeath = message.getMessageProperties().getHeader("x-death");
        if (xDeath instanceof List<?> deaths && !deaths.isEmpty()
                && deaths.get(0) instanceof Map<?, ?> firstDeath) {
            Object value = firstDeath.get(key);
            if (value != null) {
                return value.toString();
            }
        }
        return "unknown";
    }
}
