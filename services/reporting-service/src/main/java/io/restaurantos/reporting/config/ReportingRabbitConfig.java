package io.restaurantos.reporting.config;

import org.springframework.amqp.core.*;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.ArrayList;
import java.util.List;

/**
 * RabbitMQ topology for reporting-service's ETL. Consumes EXACTLY the three real, currently
 * publishing events this phase is scoped to — ORDER_CLOSED, TILL_CLOSED, VENDOR_INVOICE_MATCHED.
 * Deliberately declares NO binding to the inventory exchange and NO queue for any not-yet-built
 * inventory/wastage/transfer event from a later phase — those do not exist as running code yet
 * (see 12-03-PLAN.md's scope fence).
 *
 * Structurally cloned from kitchen-service's KitchenRabbitConfig: durable queues + DLX args +
 * bindings + a per-consumer DLQ (PROJECT.md Boundaries constraint — a dead-lettered message
 * without a bound DLQ destination is silently dropped).
 */
@Configuration
public class ReportingRabbitConfig {

    public static final String REPORTING_ORDER_CLOSED_QUEUE = "reporting.order-closed.queue";
    public static final String REPORTING_TILL_CLOSED_QUEUE = "reporting.till-closed.queue";
    public static final String REPORTING_INVOICE_MATCHED_QUEUE = "reporting.invoice-matched.queue";

    public static final String POS_TOPIC_EXCHANGE = "pos.topic";
    public static final String PURCHASING_TOPIC_EXCHANGE = "purchasing.topic";
    public static final String DLX = "restaurantos.dlx";

    @Bean
    public TopicExchange posTopic() {
        return ExchangeBuilder.topicExchange(POS_TOPIC_EXCHANGE).durable(true).build();
    }

    @Bean
    public TopicExchange purchasingTopic() {
        return ExchangeBuilder.topicExchange(PURCHASING_TOPIC_EXCHANGE).durable(true).build();
    }

    @Bean
    public Queue reportingOrderClosedQueue() {
        return QueueBuilder.durable(REPORTING_ORDER_CLOSED_QUEUE)
                .withArgument("x-dead-letter-exchange", DLX)
                .withArgument("x-dead-letter-routing-key", REPORTING_ORDER_CLOSED_QUEUE + ".dlq")
                .build();
    }

    @Bean
    public Binding reportingOrderClosedBinding(Queue reportingOrderClosedQueue, TopicExchange posTopic) {
        return BindingBuilder.bind(reportingOrderClosedQueue)
                .to(posTopic)
                .with("pos.order.closed");
    }

    @Bean
    public Queue reportingTillClosedQueue() {
        return QueueBuilder.durable(REPORTING_TILL_CLOSED_QUEUE)
                .withArgument("x-dead-letter-exchange", DLX)
                .withArgument("x-dead-letter-routing-key", REPORTING_TILL_CLOSED_QUEUE + ".dlq")
                .build();
    }

    @Bean
    public Binding reportingTillClosedBinding(Queue reportingTillClosedQueue, TopicExchange posTopic) {
        return BindingBuilder.bind(reportingTillClosedQueue)
                .to(posTopic)
                .with("pos.till.closed");
    }

    @Bean
    public Queue reportingInvoiceMatchedQueue() {
        return QueueBuilder.durable(REPORTING_INVOICE_MATCHED_QUEUE)
                .withArgument("x-dead-letter-exchange", DLX)
                .withArgument("x-dead-letter-routing-key", REPORTING_INVOICE_MATCHED_QUEUE + ".dlq")
                .build();
    }

    @Bean
    public Binding reportingInvoiceMatchedBinding(Queue reportingInvoiceMatchedQueue, TopicExchange purchasingTopic) {
        return BindingBuilder.bind(reportingInvoiceMatchedQueue)
                .to(purchasingTopic)
                .with("purchasing.invoice.matched");
    }

    /**
     * Dead-letter topology: the shared DLX plus one durable {@code <queue>.dlq} per consumer queue.
     * Declared in code (idempotent) so the DLQ destinations always exist — without them a
     * dead-lettered message routes to the DLX with no bound queue and is silently dropped.
     */
    @Bean
    public Declarables reportingDeadLetterTopology() {
        DirectExchange dlx = ExchangeBuilder.directExchange(DLX).durable(true).build();
        List<Declarable> declarables = new ArrayList<>();
        declarables.add(dlx);
        for (String sourceQueue : List.of(REPORTING_ORDER_CLOSED_QUEUE, REPORTING_TILL_CLOSED_QUEUE,
                REPORTING_INVOICE_MATCHED_QUEUE)) {
            Queue dlq = QueueBuilder.durable(sourceQueue + ".dlq").build();
            declarables.add(dlq);
            declarables.add(BindingBuilder.bind(dlq).to(dlx).with(sourceQueue + ".dlq"));
        }
        return new Declarables(declarables);
    }

    @Bean
    public MessageConverter reportingJsonMessageConverter() {
        return new Jackson2JsonMessageConverter();
    }
}
