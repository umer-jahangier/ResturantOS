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
    }
}
