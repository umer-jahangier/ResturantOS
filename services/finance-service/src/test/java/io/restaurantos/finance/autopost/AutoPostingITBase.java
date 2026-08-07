package io.restaurantos.finance.autopost;

import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * Shared Postgres + RabbitMQ for the auto-posting consumer ITs.
 *
 * <p>These are the only finance ITs that need a REAL broker — they drive the actual
 * {@code @RabbitListener}s end to end. Each used to declare its own {@code @Container} pair, so a
 * full-suite run started two RabbitMQ containers back to back and the second intermittently timed
 * out under load ({@code ContainerLaunchException}) while both passed in isolation. Static
 * singletons started once per JVM, matching the pattern {@code InventoryTestBase},
 * {@code PosTestBase} and {@code KitchenTestBase} already use for Postgres.
 *
 * <p>No {@code missing-queues-fatal} escape hatch and no hand-declared topology: FinanceRabbitConfig
 * declares every queue, binding and DLQ itself, so these ITs prove that it does.
 */
abstract class AutoPostingITBase {

    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16"))
                    .withDatabaseName("finance_db")
                    .withUsername("finance_user")
                    .withPassword("finance_pass");

    static final RabbitMQContainer RABBIT =
            new RabbitMQContainer(DockerImageName.parse("rabbitmq:3.12-management"));

    static {
        System.setProperty("TESTCONTAINERS_RYUK_DISABLED", "true");
        POSTGRES.start();
        RABBIT.start();
    }

    @DynamicPropertySource
    static void autoPostingProperties(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        r.add("spring.flyway.enabled", () -> "true");
        r.add("spring.rabbitmq.host", RABBIT::getHost);
        r.add("spring.rabbitmq.port", () -> String.valueOf(RABBIT.getAmqpPort()));
        r.add("spring.rabbitmq.username", RABBIT::getAdminUsername);
        r.add("spring.rabbitmq.password", RABBIT::getAdminPassword);
        r.add("eureka.client.enabled", () -> "false");
        r.add("spring.cloud.config.enabled", () -> "false");
        r.add("TESTCONTAINERS_RYUK_DISABLED", () -> "true");

        // Mirror the production listener block from src/main/resources/application.yml.
        //
        // These ITs drive the REAL @RabbitListeners, so they must run the real consumer semantics.
        // They did not: src/test/resources/application.yml shadows the main one on the test
        // classpath, so every listener property was absent here and the containers fell back to
        // Spring AMQP's default of default-requeue-rejected=TRUE — a failed message nacked back
        // onto the head of the same queue with no delay, forever.
        //
        // Measured, not assumed: three deliberately unbalanced ORDER_CLOSED events produced
        // 11,228 rejected posting attempts in a single ~20s run with the default, and 4 with this
        // block. Setting it here rather than in the test YAML keeps the shadowing question out of
        // it entirely — this is the same mechanism the datasource and broker already use above.
        r.add("spring.rabbitmq.listener.simple.acknowledge-mode", () -> "auto");
        r.add("spring.rabbitmq.listener.simple.default-requeue-rejected", () -> "false");
        r.add("spring.rabbitmq.listener.simple.retry.enabled", () -> "true");
        r.add("spring.rabbitmq.listener.simple.retry.initial-interval", () -> "2000");
        r.add("spring.rabbitmq.listener.simple.retry.max-attempts", () -> "3");
        r.add("spring.rabbitmq.listener.simple.retry.multiplier", () -> "2.0");
        r.add("spring.rabbitmq.listener.simple.retry.max-interval", () -> "8000");
    }
}
