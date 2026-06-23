package io.restaurantos.shared.integration;

import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.persistence.autoconfigure.EntityScan;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

/**
 * Minimal test-only Spring Boot application harness for shared-lib integration tests.
 * Not part of production code — exists solely to bootstrap a Spring context
 * for Testcontainers verification tests (resolved decision #3: no sample-service module).
 */
@SpringBootApplication(
    scanBasePackages = "io.restaurantos.shared"
)
@EntityScan(basePackages = {
    "io.restaurantos.shared.entity",
    "io.restaurantos.shared.event",
    "io.restaurantos.shared.idempotency",
    "io.restaurantos.shared.integration"
})
@EnableJpaRepositories(basePackages = {
    "io.restaurantos.shared.event",
    "io.restaurantos.shared.idempotency",
    "io.restaurantos.shared.integration"
})
public class SharedLibTestApplication {}
