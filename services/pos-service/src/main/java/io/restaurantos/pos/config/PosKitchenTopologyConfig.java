package io.restaurantos.pos.config;

import org.springframework.amqp.core.*;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Declares the RabbitMQ topology for POS consuming kitchen.topic events.
 * Specifically: pos.order-ready.queue ← kitchen.topic (kitchen.order.ready).
 */
@Configuration
public class PosKitchenTopologyConfig {

    public static final String POS_ORDER_READY_QUEUE = "pos.order-ready.queue";
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
}
