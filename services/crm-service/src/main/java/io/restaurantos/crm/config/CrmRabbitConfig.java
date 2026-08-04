package io.restaurantos.crm.config;

import io.restaurantos.shared.event.payload.PosEventContract;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Declarable;
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
 * RabbitMQ topology for crm-service's loyalty consumers.
 *
 * <p>crm-service, like finance-service, previously declared no topology in code and depended
 * entirely on {@code deploy/init/rabbitmq-definitions.json} being loaded into the broker — unlike
 * pos, kitchen, inventory and reporting, which all declare their own. Declarations are idempotent,
 * so on a broker already provisioned from that file these are a no-op.
 *
 * @see io.restaurantos.crm.consumer.OrderClosedLoyaltyConsumer
 */
@Configuration
public class CrmRabbitConfig {

    public static final String ORDER_CLOSED_QUEUE = "crm.order-closed.queue";
    public static final String ORDER_REFUNDED_QUEUE = "crm.order-refunded.queue";

    public static final String DLX = "restaurantos.dlx";

    private static final List<Subscription> SUBSCRIPTIONS = List.of(
            new Subscription(ORDER_CLOSED_QUEUE, PosEventContract.ORDER_CLOSED_KEY),
            new Subscription(ORDER_REFUNDED_QUEUE, PosEventContract.ORDER_REFUNDED_KEY));

    /** Exposed so the topology-closure test can assert every queue here has a live listener. */
    public static List<String> consumedQueues() {
        return SUBSCRIPTIONS.stream().map(Subscription::queue).toList();
    }

    private record Subscription(String queue, String routingKey) {}

    @Bean
    public Declarables crmEventTopology() {
        List<Declarable> declarables = new ArrayList<>();

        TopicExchange posTopic = ExchangeBuilder.topicExchange(PosEventContract.EXCHANGE).durable(true).build();
        DirectExchange dlx = ExchangeBuilder.directExchange(DLX).durable(true).build();
        declarables.add(posTopic);
        declarables.add(dlx);

        for (Subscription s : SUBSCRIPTIONS) {
            String dlqName = s.queue() + ".dlq";

            Queue queue = QueueBuilder.durable(s.queue())
                    .withArgument("x-dead-letter-exchange", DLX)
                    .withArgument("x-dead-letter-routing-key", dlqName)
                    .build();
            Queue dlq = QueueBuilder.durable(dlqName).build();

            declarables.add(queue);
            declarables.add(dlq);
            declarables.add(BindingBuilder.bind(queue).to(posTopic).with(s.routingKey()));
            declarables.add(BindingBuilder.bind(dlq).to(dlx).with(dlqName));
        }

        return new Declarables(declarables);
    }
}
