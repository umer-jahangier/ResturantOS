package io.restaurantos.crm;

import io.restaurantos.crm.dto.CrmDtos.CreatePromotionRequest;
import io.restaurantos.crm.dto.CrmDtos.EvaluatePromotionRequest;
import io.restaurantos.crm.service.PromotionEngine;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(classes = CrmServiceApplication.class)
@Testcontainers
class PromotionEngineIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16"))
                    .withDatabaseName("crm_db")
                    .withUsername("crm_user")
                    .withPassword("crm_pass");

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        r.add("spring.liquibase.contexts", () -> "");
        r.add("eureka.client.enabled", () -> "false");
        // This test starts no RabbitMQ container. Mocking RabbitTemplate does not stop the
        // listener registry from opening a real broker connection, so keep listeners down.
        r.add("spring.rabbitmq.listener.simple.auto-startup", () -> "false");
        r.add("TESTCONTAINERS_RYUK_DISABLED", () -> "true");
    }

    @Autowired private PromotionEngine promotionEngine;
    @Autowired private TenantContext tenantContext;
    @Autowired private EntityManager entityManager;

    private UUID tenantId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        setRls(tenantId);
        tenantContext.set(tenantId, null, null, null);
    }

    @Test
    void evaluate_appliesPercentDiscount_whenInWindow() {
        Instant now = Instant.now();
        promotionEngine.create(new CreatePromotionRequest(
                "Lunch 10%", "PERCENT", 10,
                now.minus(1, ChronoUnit.DAYS), now.plus(1, ChronoUnit.DAYS),
                new Integer[]{1, 2, 3, 4, 5, 6, 7},
                0, 23, null, null));

        var result = promotionEngine.evaluate(new EvaluatePromotionRequest(
                UUID.randomUUID(), null, 50_000, now, List.of()));

        assertThat(result.discountPaisa()).isEqualTo(5_000);
        assertThat(result.appliedPromotionIds()).hasSize(1);
    }

    @Test
    void evaluate_returnsZero_whenOutsideHourWindow() {
        Instant now = Instant.parse("2026-06-15T14:00:00Z");
        promotionEngine.create(new CreatePromotionRequest(
                "Morning only", "FIXED", 2_000,
                now.minus(30, ChronoUnit.DAYS), now.plus(30, ChronoUnit.DAYS),
                null, 6, 10, null, null));

        var result = promotionEngine.evaluate(new EvaluatePromotionRequest(
                UUID.randomUUID(), null, 50_000, now, List.of()));

        assertThat(result.discountPaisa()).isZero();
    }

    private void setRls(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, false)")
                .setParameter("tid", tenantId.toString())
                .getSingleResult();
    }
}
