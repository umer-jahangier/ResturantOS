package io.restaurantos.shared.event;

import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;

/**
 * Relays PENDING outbox rows to RabbitMQ. Runs every 1000ms. At-least-once delivery.
 *
 * CRITICAL (SC5 double-encode fix): publishes stored JSON as RAW Message bytes,
 * NOT via rabbitTemplate.convertAndSend(jsonString) which would re-serialize the
 * string (JSON-of-a-JSON-String = double-encode). Instead:
 *   1. Take stored envelopeJson String
 *   2. getBytes(UTF_8) → raw bytes
 *   3. Build MessageProperties with contentType=application/json
 *   4. call rabbitTemplate.send(exchange, routingKey, new Message(bytes, props))
 *
 * Consumer side must use Jackson2JsonMessageConverter backed by the same ObjectMapper
 * to reconstruct EventEnvelope<Payload> from the application/json bytes.
 */
public class OutboxRelay {
    private final OutboxRepository outboxRepository;
    private final RabbitTemplate rabbitTemplate;

    public OutboxRelay(OutboxRepository outboxRepository, RabbitTemplate rabbitTemplate) {
        this.outboxRepository = outboxRepository;
        this.rabbitTemplate = rabbitTemplate;
    }

    @Scheduled(fixedDelay = 1000)
    @Transactional
    public void relay() {
        List<OutboxEntry> pending = outboxRepository.findTop200ByStatusOrderByCreatedAtAsc("PENDING");
        for (OutboxEntry e : pending) {
            byte[] body = e.getEnvelopeJson().getBytes(StandardCharsets.UTF_8);
            MessageProperties props = new MessageProperties();
            props.setContentType("application/json");
            props.setContentEncoding("UTF-8");
            Message message = new Message(body, props);
            rabbitTemplate.send(e.getExchange(), e.getRoutingKey(), message);
            e.setStatus("SENT");
            e.setSentAt(Instant.now());
        }
    }
}
