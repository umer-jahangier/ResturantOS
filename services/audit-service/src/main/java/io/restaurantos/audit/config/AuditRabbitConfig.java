package io.restaurantos.audit.config;

import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * RabbitMQ configuration for audit-service.
 * The audit.all-events.queue is already declared and bound to all 9 topic exchanges
 * with '#' in rabbitmq-definitions.json — no binding changes needed here.
 *
 * Note: TenantAwareMessageProcessor is NOT redefined here — SharedAutoConfiguration
 * is authoritative and already provides that bean. [03-02-D]
 */
@Configuration
public class AuditRabbitConfig {

    @Bean
    public MessageConverter jsonMessageConverter() {
        return new Jackson2JsonMessageConverter();
    }
}
