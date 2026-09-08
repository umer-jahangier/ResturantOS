package io.restaurantos.audit.config;

import io.restaurantos.shared.event.payload.HrEventContract;
import io.restaurantos.shared.event.payload.InventoryEventContract;
import io.restaurantos.shared.event.payload.PosEventContract;
import io.restaurantos.shared.event.payload.PurchasingEventContract;
import io.restaurantos.shared.event.payload.UserLifecycleEventContract;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Declarable;
import org.springframework.amqp.core.Declarables;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.ExchangeBuilder;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.ArrayList;
import java.util.List;

/**
 * RabbitMQ topology for audit-service.
 *
 * <h3>Why this class now declares what it consumes</h3>
 *
 * <p>It used to declare nothing. The javadoc said the queue "is already declared and bound to all 9
 * topic exchanges with '#' in rabbitmq-definitions.json — no binding changes needed here", and that
 * was true of docker-compose, which loads that file via {@code load_definitions}. The k8s deployment
 * does not: it imports the same topology once, over the management API, from a bootstrap Job.
 *
 * <p>The difference is what happens AFTER provisioning. Measured on dev, 2026-09-08: the broker had
 * lost its data at some point, and every service that declares its own topology — pos, kitchen,
 * inventory, reporting, crm, finance — silently rebuilt its queues on next startup. 52 queues were
 * present and healthy. audit-service was the only consumer that declares nothing, so
 * {@code audit.all-events.queue} stayed missing, {@code @RabbitListener} did a PASSIVE declaration
 * against a queue that was not there, and the container died on
 * {@code channel.close(404) NOT_FOUND - no queue 'audit.all-events.queue'}.
 *
 * <p><b>It had crash-looped 3,051 times over 11 days</b>, and the operator health page read
 * "Not registered — nothing is currently advertising this service. While it is down, the activity
 * trail stops recording." The bootstrap Job is not a repair mechanism: it carries
 * {@code ttlSecondsAfterFinished} and only ever runs during a deploy, so anything it provisions is
 * gone for good the moment the broker is reset between deploys.
 *
 * <p>Declaring here makes audit-service self-healing on exactly the same terms as its six siblings.
 * AMQP declarations are idempotent, so on a broker already provisioned from the definitions file —
 * or by the bootstrap Job — every one of these is a no-op.
 *
 * <h3>Why the exchanges are declared too, and not just the bindings</h3>
 *
 * <p>A binding cannot be created against an exchange that does not exist yet, and audit-service has
 * no ordering guarantee against the nine services that own these exchanges — it is frequently the
 * first thing up. Declaring them is idempotent and costs nothing; NOT declaring them reintroduces
 * the same startup failure through a different door.
 *
 * @see io.restaurantos.audit.consumer.AllEventsConsumer
 */
@Configuration
public class AuditRabbitConfig {

    public static final String ALL_EVENTS_QUEUE = "audit.all-events.queue";
    public static final String DLX = "restaurantos.dlx";

    /**
     * Every topic exchange whose traffic the audit trail must capture.
     *
     * <p>Five resolve through their shared contract constant. Four — finance, platform, kitchen and
     * notifications — have no constant in shared-lib and are spelled literally here. That asymmetry
     * is inherited, not introduced: {@code deploy/init/rabbitmq-definitions.json} is the source of
     * truth for the set, and this list is kept identical to the nine bindings it declares for this
     * queue. A new topic exchange must be added in BOTH places or the trail silently stops covering
     * it — which is the failure mode this whole class exists to make impossible.
     */
    private static final List<String> AUDITED_TOPIC_EXCHANGES = List.of(
            PosEventContract.EXCHANGE,
            InventoryEventContract.EXCHANGE,
            PurchasingEventContract.EXCHANGE,
            HrEventContract.EXCHANGE,
            UserLifecycleEventContract.EXCHANGE,
            "finance.topic",
            "platform.topic",
            "kitchen.topic",
            "notifications.topic");

    /** Exposed so the topology-closure test can assert this queue has a live listener. */
    public static List<String> consumedQueues() {
        return List.of(ALL_EVENTS_QUEUE);
    }

    @Bean
    public MessageConverter jsonMessageConverter() {
        return new Jackson2JsonMessageConverter();
    }

    @Bean
    public Declarables auditEventTopology() {
        List<Declarable> declarables = new ArrayList<>();

        String dlqName = ALL_EVENTS_QUEUE + ".dlq";
        DirectExchange dlx = ExchangeBuilder.directExchange(DLX).durable(true).build();

        // Arguments MUST match the definitions file exactly. A durable queue that already exists
        // with different arguments is not reconfigured — the declaration is REJECTED with a 406
        // PRECONDITION_FAILED, which fails startup just as surely as the 404 this replaces.
        Queue queue = QueueBuilder.durable(ALL_EVENTS_QUEUE)
                .withArgument("x-dead-letter-exchange", DLX)
                .withArgument("x-dead-letter-routing-key", dlqName)
                .build();
        Queue dlq = QueueBuilder.durable(dlqName).build();

        declarables.add(dlx);
        declarables.add(queue);
        declarables.add(dlq);
        declarables.add(BindingBuilder.bind(dlq).to(dlx).with(dlqName));

        // '#' — every routing key on every audited exchange. The audit trail is a fan-in of the
        // whole product by design; a narrower key here would silently stop recording whichever
        // event types it failed to anticipate.
        for (String exchange : AUDITED_TOPIC_EXCHANGES) {
            TopicExchange topic = ExchangeBuilder.topicExchange(exchange).durable(true).build();
            declarables.add(topic);
            declarables.add(BindingBuilder.bind(queue).to(topic).with("#"));
        }

        return new Declarables(declarables);
    }
}
