package io.restaurantos.kitchen.consumer;

import io.micrometer.core.instrument.MeterRegistry;
import io.restaurantos.kitchen.config.KitchenRabbitConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * Observability for dead-lettered kitchen events — the "alerting" layer of the reliability fix.
 *
 * <p>Any event a consumer cannot process — a poison payload rejected via
 * {@code AmqpRejectAndDontRequeueException}, or a processing failure that exhausted the 3 retries —
 * dead-letters to {@code <queue>.dlq}. Without a monitor those DLQs sit silent, which is exactly how
 * the ORDER_CLOSED breakage hid for so long (messages failed and vanished with nobody watching).
 *
 * <p>This listens on every kitchen DLQ and, for each dead-letter, logs at ERROR (original queue +
 * failure reason from the {@code x-death} header + the full body for manual replay) and increments a
 * Micrometer counter {@code messaging.dead_letter.total} tagged by queue — which a metrics/alerting
 * stack (the actuator/Prometheus endpoint) scrapes to page on. Returning normally acks the DLQ
 * message; the alert has already fired via the log line + counter.
 */
@Component
public class KitchenDeadLetterMonitor {

    private static final Logger log = LoggerFactory.getLogger(KitchenDeadLetterMonitor.class);

    private final MeterRegistry meterRegistry;

    public KitchenDeadLetterMonitor(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
    }

    @RabbitListener(containerFactory = "dlqListenerContainerFactory", queues = {
            KitchenRabbitConfig.KITCHEN_ORDER_SENT_QUEUE + ".dlq",
            KitchenRabbitConfig.KITCHEN_ORDER_VOIDED_QUEUE + ".dlq",
            KitchenRabbitConfig.KITCHEN_ITEM_CANCELLED_QUEUE + ".dlq",
            KitchenRabbitConfig.KITCHEN_ORDER_CLOSED_QUEUE + ".dlq"
    })
    public void onDeadLetter(Message message) {
        String originalQueue = firstDeath(message, "queue");
        String reason = firstDeath(message, "reason");
        String body = new String(message.getBody(), StandardCharsets.UTF_8);

        meterRegistry.counter("messaging.dead_letter.total",
                "service", "kitchen", "queue", originalQueue).increment();

        log.error("DEAD-LETTER [kitchen] queue={} reason={} — event permanently failed "
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
