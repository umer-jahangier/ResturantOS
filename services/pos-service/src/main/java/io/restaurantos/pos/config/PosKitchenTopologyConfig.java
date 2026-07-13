package io.restaurantos.pos.config;

import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.config.SimpleRabbitListenerContainerFactory;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.support.converter.SimpleMessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.ArrayList;
import java.util.List;

/**
 * Declares the RabbitMQ topology for POS consuming kitchen.topic events.
 * Specifically: pos.order-ready.queue ← kitchen.topic (kitchen.order.ready), and
 * pos.kitchen-item-status.queue ← kitchen.topic (kitchen.item.status-changed) for the
 * fine-grained per-item sync (POS-20).
 */
@Configuration
public class PosKitchenTopologyConfig {

    public static final String POS_ORDER_READY_QUEUE = "pos.order-ready.queue";
    public static final String POS_KITCHEN_ITEM_STATUS_QUEUE = "pos.kitchen-item-status.queue";
    public static final String KITCHEN_TOPIC_EXCHANGE = "kitchen.topic";
    public static final String DLX = "restaurantos.dlx";

    @Bean
    public TopicExchange kitchenTopicExchange() {
        return ExchangeBuilder.topicExchange(KITCHEN_TOPIC_EXCHANGE).durable(true).build();
    }

    @Bean
    public Queue posOrderReadyQueue() {
        return QueueBuilder.durable(POS_ORDER_READY_QUEUE)
                .withArgument("x-dead-letter-exchange", DLX)
                .withArgument("x-dead-letter-routing-key", POS_ORDER_READY_QUEUE + ".dlq")
                .build();
    }

    @Bean
    public Binding posOrderReadyBinding(Queue posOrderReadyQueue, TopicExchange kitchenTopicExchange) {
        return BindingBuilder.bind(posOrderReadyQueue)
                .to(kitchenTopicExchange)
                .with("kitchen.order.ready");
    }

    @Bean
    public Queue posKitchenItemStatusQueue() {
        return QueueBuilder.durable(POS_KITCHEN_ITEM_STATUS_QUEUE)
                .withArgument("x-dead-letter-exchange", DLX)
                .withArgument("x-dead-letter-routing-key", POS_KITCHEN_ITEM_STATUS_QUEUE + ".dlq")
                .build();
    }

    @Bean
    public Binding posKitchenItemStatusBinding(Queue posKitchenItemStatusQueue, TopicExchange kitchenTopicExchange) {
        return BindingBuilder.bind(posKitchenItemStatusQueue)
                .to(kitchenTopicExchange)
                .with("kitchen.item.status-changed");
    }

    /**
     * Dead-letter topology: the shared DLX plus a durable {@code <queue>.dlq} per POS consumer queue,
     * bound to the DLX with routing key {@code <queue>.dlq}. Declared in code (idempotent) so the DLQ
     * destinations always exist — {@code pos.kitchen-item-status.queue.dlq} was in fact missing, so a
     * dead-lettered item-status event would have been silently dropped. The
     * {@link io.restaurantos.pos.consumer.PosDeadLetterMonitor} listens on them.
     */
    @Bean
    public Declarables posDeadLetterTopology() {
        DirectExchange dlx = ExchangeBuilder.directExchange(DLX).durable(true).build();
        List<Declarable> declarables = new ArrayList<>();
        declarables.add(dlx);
        for (String sourceQueue : List.of(POS_ORDER_READY_QUEUE, POS_KITCHEN_ITEM_STATUS_QUEUE)) {
            Queue dlq = QueueBuilder.durable(sourceQueue + ".dlq").build();
            declarables.add(dlq);
            declarables.add(BindingBuilder.bind(dlq).to(dlx).with(sourceQueue + ".dlq"));
        }
        return new Declarables(declarables);
    }

    /**
     * Dedicated listener factory for the DLQ monitor: passthrough {@link SimpleMessageConverter} so
     * the monitor can read arbitrary/corrupt (non-JSON) dead-letter bodies without itself throwing a
     * MessageConversionException. See KitchenRabbitConfig#dlqListenerContainerFactory.
     */
    @Bean
    public SimpleRabbitListenerContainerFactory dlqListenerContainerFactory(ConnectionFactory connectionFactory) {
        SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
        factory.setConnectionFactory(connectionFactory);
        factory.setMessageConverter(new SimpleMessageConverter());
        // If the monitor itself ever fails, drop rather than requeue (the DLQ has no further DLX).
        factory.setDefaultRequeueRejected(false);
        return factory;
    }
}
