package io.restaurantos.shared.event;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * Relays PENDING outbox rows to RabbitMQ. Runs every 1000ms. At-least-once delivery.
 *
 * <p>A row is marked SENT only once the BROKER HAS CONFIRMED it. This is the whole point:
 * {@code basic.publish} is fire-and-forget, so without publisher confirms {@code send()} returns
 * normally even when the broker discards the message — which previously let the relay mark rows
 * SENT that were never delivered, with no record anywhere that the event had been lost. Two
 * failures were observed in practice:
 * <ul>
 *   <li>a row whose exchange did not exist was marked SENT while the broker answered
 *       {@code 404 NOT_FOUND} on the channel; and</li>
 *   <li>that 404 closed the shared cached channel, so unrelated, correctly-addressed messages
 *       published in the same batch were destroyed — and also marked SENT.</li>
 * </ul>
 *
 * <p>Each row is therefore published inside its own {@link RabbitTemplate#invoke} scope, which
 * binds a dedicated channel, and is only marked SENT when {@code waitForConfirms} returns an ack.
 * A dedicated channel per row is what contains the blast radius: a poison row can still have its
 * own channel killed, but it can no longer take its neighbours down with it.
 *
 * <p>Anything that is not an ack — nack, timeout, exception — leaves the row PENDING so the next
 * tick retries it. Nothing is ever dropped. The cost of that guarantee is that a permanently
 * undeliverable row retries indefinitely, so {@link #warnUndeliverable} escalates to ERROR once a
 * row has been stuck longer than {@link #STUCK_THRESHOLD}; alert on that log or on a
 * "age of oldest PENDING row" metric. There is deliberately no FAILED state and no attempt
 * counter — both would need a schema migration across the nine services that own an event_outbox.
 *
 * <p>At-least-once is now an accurate description rather than an aspiration, and it cuts both
 * ways: a confirm that times out AFTER the broker actually accepted the message leaves the row
 * PENDING and the next tick publishes it again. Consumers must therefore stay idempotent — which
 * is what {@code IdempotencyService} and the idempotent-consumer pattern in this library are for.
 *
 * <p>Note on unroutable messages: a publish to a real exchange that matches no binding is
 * CONFIRMED by the broker and is treated here as success. That is correct — fan-out events with
 * no subscriber yet are normal, and failing them would turn healthy publishes into infinite
 * retries. Detecting them needs publisher RETURNS (mandatory=true), which is a different signal
 * and deliberately not wired to the SENT decision.
 *
 * <p>CRITICAL (SC5 double-encode fix): publishes stored JSON as RAW Message bytes,
 * NOT via rabbitTemplate.convertAndSend(jsonString) which would re-serialize the
 * string (JSON-of-a-JSON-String = double-encode). Instead:
 *   1. Take stored envelopeJson String
 *   2. getBytes(UTF_8) → raw bytes
 *   3. Build MessageProperties with contentType=application/json
 *   4. call rabbitTemplate.send(exchange, routingKey, message) inside a confirm scope
 *
 * Consumer side must use Jackson2JsonMessageConverter backed by the same ObjectMapper
 * to reconstruct EventEnvelope&lt;Payload&gt; from the application/json bytes.
 */
public class OutboxRelay {

    private static final Logger log = LoggerFactory.getLogger(OutboxRelay.class);

    /** How long to wait for the broker to confirm one publish before giving up and retrying. */
    static final long CONFIRM_TIMEOUT_MS = 5_000L;

    /** Past this age a PENDING row is not slow, it is undeliverable, and a human should look. */
    static final Duration STUCK_THRESHOLD = Duration.ofMinutes(5);

    /** Give up on the rest of the batch after this many failures in a row; retry next tick. */
    static final int MAX_CONSECUTIVE_FAILURES = 5;

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
        int consecutiveFailures = 0;
        for (int i = 0; i < pending.size(); i++) {
            OutboxEntry e = pending.get(i);
            if (publishAndAwaitConfirm(e)) {
                e.setStatus("SENT");
                e.setSentAt(Instant.now());
                consecutiveFailures = 0;
            } else {
                warnUndeliverable(e);
                // Waiting out the confirm timeout on every row of a 200-row batch would hold this
                // transaction open for minutes while the broker is unhealthy. Once several rows in
                // a row have failed, stop early: the remainder stay PENDING and the next tick — a
                // second later — picks them up. Bounds the worst case to roughly
                // MAX_CONSECUTIVE_FAILURES * CONFIRM_TIMEOUT_MS instead of the whole batch.
                if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                    log.warn("Aborting relay batch after {} consecutive delivery failures; {} row(s) "
                             + "remain PENDING and will be retried on the next tick",
                             consecutiveFailures, pending.size() - i - 1);
                    return;
                }
            }
        }
    }

    /**
     * Publishes one row on its own channel and waits for the broker's ack.
     *
     * @return true only if the broker positively confirmed the message. False for a nack, a
     *         confirm timeout, or any exception — in every one of those cases the caller must
     *         leave the row PENDING rather than assume delivery.
     */
    private boolean publishAndAwaitConfirm(OutboxEntry e) {
        MessageProperties props = new MessageProperties();
        props.setContentType("application/json");
        props.setContentEncoding("UTF-8");
        Message message = new Message(e.getEnvelopeJson().getBytes(StandardCharsets.UTF_8), props);

        try {
            Boolean acked = rabbitTemplate.invoke(ops -> {
                ops.send(e.getExchange(), e.getRoutingKey(), message);
                return ops.waitForConfirms(CONFIRM_TIMEOUT_MS);
            });
            if (Boolean.TRUE.equals(acked)) {
                return true;
            }
            log.warn("Broker did not confirm outbox event {} ({}) -> exchange '{}' key '{}'; "
                     + "leaving PENDING for retry", e.getEventId(), e.getEventType(),
                     e.getExchange(), e.getRoutingKey());
            return false;
        } catch (IllegalStateException ise) {
            // waitForConfirms throws this when the connection factory has confirms switched off.
            // Loud and repeated on purpose: the relay cannot honour its delivery guarantee, and a
            // silent fallback to "publish and hope" is exactly the defect this class was fixed for.
            log.error("Publisher confirms are DISABLED on the RabbitMQ connection factory, so "
                      + "outbox delivery cannot be verified. Outbox event {} left PENDING. Set "
                      + "spring.rabbitmq.publisher-confirm-type=simple (or correlated).",
                      e.getEventId(), ise);
            return false;
        } catch (Exception ex) {
            log.warn("Publish failed for outbox event {} ({}) -> exchange '{}' key '{}'; "
                     + "leaving PENDING for retry", e.getEventId(), e.getEventType(),
                     e.getExchange(), e.getRoutingKey(), ex);
            return false;
        }
    }

    /**
     * Nothing is dropped, so an undeliverable row would otherwise retry forever in silence.
     * Escalate once it is old enough that "the broker is briefly unavailable" stops being a
     * plausible explanation.
     */
    private void warnUndeliverable(OutboxEntry e) {
        Duration age = Duration.between(e.getCreatedAt(), Instant.now());
        if (age.compareTo(STUCK_THRESHOLD) > 0) {
            log.error("Outbox event {} ({}) -> exchange '{}' has been undeliverable for {}m. It is "
                      + "still being retried and will NOT be dropped, but it needs attention — "
                      + "most likely the exchange does not exist or the broker is rejecting it.",
                      e.getEventId(), e.getEventType(), e.getExchange(), age.toMinutes());
        }
    }
}
