package io.restaurantos.finance.config;

import io.restaurantos.shared.event.payload.HrEventContract;
import io.restaurantos.shared.event.payload.InventoryEventContract;
import io.restaurantos.shared.event.payload.PosEventContract;
import org.springframework.amqp.core.Declarable;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Declarables;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.ExchangeBuilder;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.ArrayList;
import java.util.List;

/**
 * RabbitMQ topology for finance-service's auto-posting consumers.
 *
 * <p><b>Why this exists.</b> pos, kitchen, inventory and reporting each declare their queues,
 * bindings and DLQs as idempotent beans; finance-service and crm-service did not, and relied
 * entirely on {@code deploy/init/rabbitmq-definitions.json} being loaded into the broker. The tell
 * was in the ITs, which set {@code missing-queues-fatal=false} and declared the topology by hand.
 * On any broker not booted from that one file — a managed broker, a k8s deployment, a fresh test
 * container — the listeners never attached and the service still reported healthy.
 *
 * <p>Declarations are idempotent, so where the definitions file HAS pre-provisioned the topology
 * these are a no-op. Mirrors {@code InventoryRabbitConfig}'s pattern exactly, including a per-queue
 * DLQ bound to the shared DLX: a dead-lettered message with no bound destination is silently
 * dropped, which is precisely the failure this service must never have.
 */
@Configuration
public class FinanceRabbitConfig {

    public static final String ORDER_CLOSED_QUEUE = "finance.order-closed.queue";
    public static final String ORDER_REFUNDED_QUEUE = "finance.order-refunded.queue";
    public static final String STOCK_DEPLETED_QUEUE = "finance.stock-depleted.queue";
    public static final String STOCK_RECEIVED_QUEUE = "finance.stock-received.queue";
    public static final String WASTAGE_QUEUE = "finance.wastage.queue";
    public static final String COUNT_VARIANCE_QUEUE = "finance.count-variance.queue";
    public static final String TRANSFER_SHIPPED_QUEUE = "finance.transfer-shipped.queue";
    public static final String TRANSFER_RECEIVED_QUEUE = "finance.transfer-received.queue";
    public static final String PAYROLL_APPROVED_QUEUE = "finance.payroll-approved.queue";
    public static final String PAYROLL_PAID_QUEUE = "finance.payroll-paid.queue";
    /** hr-service publishes payroll events on this topic exchange. */
    public static final String HR_EXCHANGE = HrEventContract.EXCHANGE;

    public static final String DLX = "restaurantos.dlx";

    /** Every queue this service consumes, paired with the exchange + routing key that feeds it. */
    private static final List<Subscription> SUBSCRIPTIONS = List.of(
            new Subscription(ORDER_CLOSED_QUEUE, PosEventContract.EXCHANGE, PosEventContract.ORDER_CLOSED_KEY),
            new Subscription(ORDER_REFUNDED_QUEUE, PosEventContract.EXCHANGE, PosEventContract.ORDER_REFUNDED_KEY),
            new Subscription(STOCK_DEPLETED_QUEUE, InventoryEventContract.EXCHANGE, InventoryEventContract.STOCK_DEPLETED_KEY),
            new Subscription(STOCK_RECEIVED_QUEUE, InventoryEventContract.EXCHANGE, InventoryEventContract.STOCK_RECEIVED_KEY),
            new Subscription(WASTAGE_QUEUE, InventoryEventContract.EXCHANGE, InventoryEventContract.WASTAGE_RECORDED_KEY),
            new Subscription(COUNT_VARIANCE_QUEUE, InventoryEventContract.EXCHANGE, InventoryEventContract.COUNT_VARIANCE_POSTED_KEY),
            new Subscription(TRANSFER_SHIPPED_QUEUE, InventoryEventContract.EXCHANGE, InventoryEventContract.TRANSFER_SHIPPED_KEY),
            new Subscription(TRANSFER_RECEIVED_QUEUE, InventoryEventContract.EXCHANGE, InventoryEventContract.TRANSFER_RECEIVED_KEY),
            new Subscription(PAYROLL_APPROVED_QUEUE, HR_EXCHANGE, HrEventContract.PAYROLL_RUN_APPROVED_KEY),
            new Subscription(PAYROLL_PAID_QUEUE, HR_EXCHANGE, HrEventContract.PAYROLL_RUN_PAID_KEY));

    /** Exposed so the topology-closure test can assert every queue here has a live listener. */
    public static List<String> consumedQueues() {
        return SUBSCRIPTIONS.stream().map(Subscription::queue).toList();
    }

    private record Subscription(String queue, String exchange, String routingKey) {}

    @Bean
    public Declarables financeEventTopology() {
        List<Declarable> declarables = new ArrayList<>();

        TopicExchange posTopic = ExchangeBuilder.topicExchange(PosEventContract.EXCHANGE).durable(true).build();
        TopicExchange inventoryTopic = ExchangeBuilder.topicExchange(InventoryEventContract.EXCHANGE).durable(true).build();
        TopicExchange hrTopic = ExchangeBuilder.topicExchange(HR_EXCHANGE).durable(true).build();
        DirectExchange dlx = ExchangeBuilder.directExchange(DLX).durable(true).build();
        declarables.add(posTopic);
        declarables.add(inventoryTopic);
        declarables.add(hrTopic);
        declarables.add(dlx);

        for (Subscription s : SUBSCRIPTIONS) {
            String dlqName = s.queue() + ".dlq";

            Queue queue = QueueBuilder.durable(s.queue())
                    .withArgument("x-dead-letter-exchange", DLX)
                    .withArgument("x-dead-letter-routing-key", dlqName)
                    .build();
            Queue dlq = QueueBuilder.durable(dlqName).build();

            TopicExchange source;
            if (s.exchange().equals(PosEventContract.EXCHANGE)) {
                source = posTopic;
            } else if (s.exchange().equals(InventoryEventContract.EXCHANGE)) {
                source = inventoryTopic;
            } else {
                source = hrTopic;
            }

            declarables.add(queue);
            declarables.add(dlq);
            declarables.add(BindingBuilder.bind(queue).to(source).with(s.routingKey()));
            declarables.add(BindingBuilder.bind(dlq).to(dlx).with(dlqName));
        }

        return new Declarables(declarables);
    }

}
