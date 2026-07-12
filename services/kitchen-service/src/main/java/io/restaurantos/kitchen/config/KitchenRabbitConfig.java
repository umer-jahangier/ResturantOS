package io.restaurantos.kitchen.config;

import org.springframework.amqp.core.*;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

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
    public MessageConverter kitchenJsonMessageConverter() {
        return new Jackson2JsonMessageConverter();
    }
}
