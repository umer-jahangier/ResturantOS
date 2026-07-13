package io.restaurantos.kitchen.config;

import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.config.SimpleRabbitListenerContainerFactory;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.amqp.support.converter.SimpleMessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.ArrayList;
import java.util.List;

/**
 * RabbitMQ topology for kitchen-service.
 * Declares queues and bindings to pos.topic (consumed events) and kitchen.topic (published events).
 * Spring AmqpAdmin applies declarations at startup; existing RabbitMQ defs are a no-op.
 */
@Configuration
public class KitchenRabbitConfig {

    // Consumed from pos.topic
    public static final String KITCHEN_ORDER_SENT_QUEUE  = "kitchen.order-sent.queue";
    public static final String KITCHEN_ORDER_VOIDED_QUEUE = "kitchen.order-voided.queue";
    public static final String KITCHEN_ITEM_CANCELLED_QUEUE = "kitchen.item-cancelled.queue";
    public static final String KITCHEN_ITEM_SERVED_QUEUE = "kitchen.item-served.queue";
    public static final String KITCHEN_ORDER_CLOSED_QUEUE = "kitchen.order-closed.queue";

    // Exchange names
    public static final String POS_TOPIC_EXCHANGE     = "pos.topic";
    public static final String KITCHEN_TOPIC_EXCHANGE = "kitchen.topic";
    public static final String DLX                    = "restaurantos.dlx";

    @Bean
    public TopicExchange posTopic() {
        return ExchangeBuilder.topicExchange(POS_TOPIC_EXCHANGE).durable(true).build();
    }

    @Bean
    public TopicExchange kitchenTopic() {
        return ExchangeBuilder.topicExchange(KITCHEN_TOPIC_EXCHANGE).durable(true).build();
    }

    @Bean
    public Queue kitchenOrderSentQueue() {
        return QueueBuilder.durable(KITCHEN_ORDER_SENT_QUEUE)
                .withArgument("x-dead-letter-exchange", DLX)
                .withArgument("x-dead-letter-routing-key", KITCHEN_ORDER_SENT_QUEUE + ".dlq")
                .build();
    }

    @Bean
    public Queue kitchenOrderVoidedQueue() {
        return QueueBuilder.durable(KITCHEN_ORDER_VOIDED_QUEUE)
                .withArgument("x-dead-letter-exchange", DLX)
                .withArgument("x-dead-letter-routing-key", KITCHEN_ORDER_VOIDED_QUEUE + ".dlq")
                .build();
    }

    @Bean
    public Binding kitchenOrderSentBinding(Queue kitchenOrderSentQueue, TopicExchange posTopic) {
        return BindingBuilder.bind(kitchenOrderSentQueue)
                .to(posTopic)
                .with("pos.order.sent_to_kds");
    }

    @Bean
    public Binding kitchenOrderVoidedBinding(Queue kitchenOrderVoidedQueue, TopicExchange posTopic) {
        return BindingBuilder.bind(kitchenOrderVoidedQueue)
                .to(posTopic)
                .with("pos.order.voided");
    }

    @Bean
    public Queue kitchenItemCancelledQueue() {
        return QueueBuilder.durable(KITCHEN_ITEM_CANCELLED_QUEUE)
                .withArgument("x-dead-letter-exchange", DLX)
                .withArgument("x-dead-letter-routing-key", KITCHEN_ITEM_CANCELLED_QUEUE + ".dlq")
                .build();
    }

    @Bean
    public Binding kitchenItemCancelledBinding(Queue kitchenItemCancelledQueue, TopicExchange posTopic) {
        return BindingBuilder.bind(kitchenItemCancelledQueue)
                .to(posTopic)
                .with("pos.order.item_cancelled");
    }

    @Bean
    public Queue kitchenItemServedQueue() {
        return QueueBuilder.durable(KITCHEN_ITEM_SERVED_QUEUE)
                .withArgument("x-dead-letter-exchange", DLX)
                .withArgument("x-dead-letter-routing-key", KITCHEN_ITEM_SERVED_QUEUE + ".dlq")
                .build();
    }

    @Bean
    public Binding kitchenItemServedBinding(Queue kitchenItemServedQueue, TopicExchange posTopic) {
        return BindingBuilder.bind(kitchenItemServedQueue)
                .to(posTopic)
                .with("pos.order.item_served");
    }

    @Bean
    public Queue kitchenOrderClosedQueue() {
        return QueueBuilder.durable(KITCHEN_ORDER_CLOSED_QUEUE)
                .withArgument("x-dead-letter-exchange", DLX)
                .withArgument("x-dead-letter-routing-key", KITCHEN_ORDER_CLOSED_QUEUE + ".dlq")
                .build();
    }

    @Bean
    public Binding kitchenOrderClosedBinding(Queue kitchenOrderClosedQueue, TopicExchange posTopic) {
        return BindingBuilder.bind(kitchenOrderClosedQueue)
                .to(posTopic)
                .with("pos.order.closed");
    }

    /**
     * Dead-letter topology: the shared DLX (direct, durable) plus one durable {@code <queue>.dlq} per
     * consumer queue, each bound to the DLX with routing key {@code <queue>.dlq} — matching the
     * x-dead-letter-routing-key set on the source queues above. Declared in code (idempotent — a
     * pre-existing definition from rabbitmq-definitions.json is a no-op) so the DLQ destinations
     * always exist: without them a dead-lettered message routes to the DLX with no bound queue and is
     * SILENTLY DROPPED (3 of these .dlq queues were in fact missing before this). The
     * {@link io.restaurantos.kitchen.consumer.KitchenDeadLetterMonitor} listens on them.
     */
    @Bean
    public Declarables kitchenDeadLetterTopology() {
        DirectExchange dlx = ExchangeBuilder.directExchange(DLX).durable(true).build();
        List<Declarable> declarables = new ArrayList<>();
        declarables.add(dlx);
        for (String sourceQueue : List.of(KITCHEN_ORDER_SENT_QUEUE, KITCHEN_ORDER_VOIDED_QUEUE,
                KITCHEN_ITEM_CANCELLED_QUEUE, KITCHEN_ITEM_SERVED_QUEUE, KITCHEN_ORDER_CLOSED_QUEUE)) {
            Queue dlq = QueueBuilder.durable(sourceQueue + ".dlq").build();
            declarables.add(dlq);
            declarables.add(BindingBuilder.bind(dlq).to(dlx).with(sourceQueue + ".dlq"));
        }
        return new Declarables(declarables);
    }

    @Bean
    public MessageConverter kitchenJsonMessageConverter() {
        return new Jackson2JsonMessageConverter();
    }

    /**
     * Dedicated listener factory for the DLQ monitor: uses a passthrough {@link SimpleMessageConverter}
     * (byte[]/String) instead of the JSON converter, because a dead-letter can carry an arbitrary or
     * corrupt (non-JSON) payload — the very poison that got it dead-lettered. With the default JSON
     * factory the monitor would itself throw a MessageConversionException before it could log/count.
     */
    @Bean
    public SimpleRabbitListenerContainerFactory dlqListenerContainerFactory(ConnectionFactory connectionFactory) {
        SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
        factory.setConnectionFactory(connectionFactory);
        factory.setMessageConverter(new SimpleMessageConverter());
        // If the monitor itself ever fails, drop rather than requeue (the DLQ has no further DLX) —
        // never loop on a dead-letter.
        factory.setDefaultRequeueRejected(false);
        return factory;
    }
}
