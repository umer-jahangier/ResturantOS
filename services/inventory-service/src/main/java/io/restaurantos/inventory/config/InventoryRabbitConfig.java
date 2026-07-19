package io.restaurantos.inventory.config;

import org.springframework.amqp.core.*;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * RabbitMQ topology for inventory-service.
 * Declares the queue + binding consumed from pos.topic (ORDER_CLOSED) and the inventory.topic
 * exchange for published events. Spring AmqpAdmin applies declarations at startup; the queue,
 * DLQ sibling, and pos.topic binding are already pre-provisioned in
 * deploy/init/rabbitmq-definitions.json, so these declarations are an idempotent no-op there —
 * mirrors KitchenRabbitConfig's exact pattern.
 */
@Configuration
public class InventoryRabbitConfig {

    // Consumed from pos.topic
    public static final String INVENTORY_ORDER_CLOSED_QUEUE = "inventory.order-closed.queue";

    /**
     * D-08: unlike every other queue in this service (one-queue-per-event-type), this queue
     * receives BOTH pos.menu_item.upserted and pos.menu_item.deleted routing keys — the consumer
     * parses the envelope's eventType and dispatches to the matching payload class itself.
     */
    public static final String INVENTORY_MENU_ITEM_QUEUE = "inventory.menu-item.queue";

    // Exchange names
    public static final String POS_TOPIC_EXCHANGE = "pos.topic";
    public static final String INVENTORY_TOPIC_EXCHANGE = "inventory.topic";
    public static final String DLX = "restaurantos.dlx";

    @Bean
    public TopicExchange posTopic() {
        return ExchangeBuilder.topicExchange(POS_TOPIC_EXCHANGE).durable(true).build();
    }

    @Bean
    public TopicExchange inventoryTopic() {
        return ExchangeBuilder.topicExchange(INVENTORY_TOPIC_EXCHANGE).durable(true).build();
    }

    @Bean
    public Queue inventoryOrderClosedQueue() {
        return QueueBuilder.durable(INVENTORY_ORDER_CLOSED_QUEUE)
                .withArgument("x-dead-letter-exchange", DLX)
                .withArgument("x-dead-letter-routing-key", INVENTORY_ORDER_CLOSED_QUEUE + ".dlq")
                .build();
    }

    @Bean
    public Binding inventoryOrderClosedBinding(Queue inventoryOrderClosedQueue, TopicExchange posTopic) {
        return BindingBuilder.bind(inventoryOrderClosedQueue)
                .to(posTopic)
                .with("pos.order.closed");
    }

    @Bean
    public Queue inventoryMenuItemQueue() {
        return QueueBuilder.durable(INVENTORY_MENU_ITEM_QUEUE)
                .withArgument("x-dead-letter-exchange", DLX)
                .withArgument("x-dead-letter-routing-key", INVENTORY_MENU_ITEM_QUEUE + ".dlq")
                .build();
    }

    /**
     * D-08 deviation: this queue receives BOTH menu-item event types on the SAME queue via two
     * bindings — MenuItemCatalogConsumer dispatches on the parsed eventType, not the routing key.
     */
    @Bean
    public Binding inventoryMenuItemUpsertedBinding(Queue inventoryMenuItemQueue, TopicExchange posTopic) {
        return BindingBuilder.bind(inventoryMenuItemQueue)
                .to(posTopic)
                .with("pos.menu_item.upserted");
    }

    @Bean
    public Binding inventoryMenuItemDeletedBinding(Queue inventoryMenuItemQueue, TopicExchange posTopic) {
        return BindingBuilder.bind(inventoryMenuItemQueue)
                .to(posTopic)
                .with("pos.menu_item.deleted");
    }

    /**
     * Dead-letter topology: the shared DLX (direct, durable) plus each queue's own durable
     * {@code .dlq} sibling, bound to the DLX with the routing key set as
     * x-dead-letter-routing-key above — mirrors KitchenRabbitConfig's dead-letter topology.
     * Declared in code (idempotent) so the DLQ destination always exists. Extended (not
     * duplicated) for INVENTORY_MENU_ITEM_QUEUE's own .dlq — one shared DLX, per D-08.
     */
    @Bean
    public Declarables inventoryDeadLetterTopology() {
        DirectExchange dlx = ExchangeBuilder.directExchange(DLX).durable(true).build();
        Queue orderClosedDlq = QueueBuilder.durable(INVENTORY_ORDER_CLOSED_QUEUE + ".dlq").build();
        Binding orderClosedDlqBinding = BindingBuilder.bind(orderClosedDlq).to(dlx).with(INVENTORY_ORDER_CLOSED_QUEUE + ".dlq");
        Queue menuItemDlq = QueueBuilder.durable(INVENTORY_MENU_ITEM_QUEUE + ".dlq").build();
        Binding menuItemDlqBinding = BindingBuilder.bind(menuItemDlq).to(dlx).with(INVENTORY_MENU_ITEM_QUEUE + ".dlq");
        return new Declarables(dlx, orderClosedDlq, orderClosedDlqBinding, menuItemDlq, menuItemDlqBinding);
    }

    @Bean
    public MessageConverter inventoryJsonMessageConverter() {
        return new Jackson2JsonMessageConverter();
    }
}
