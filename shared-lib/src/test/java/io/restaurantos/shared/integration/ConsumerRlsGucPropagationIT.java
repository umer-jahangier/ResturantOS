package io.restaurantos.shared.integration;

import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.tenant.TenantAwareMessageProcessor;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * Regression test for the consumer-path RLS GUC ordering bug: a live {@code @RabbitListener}
 * consumer never has an ambient {@link io.restaurantos.shared.tenant.TenantContext} set BEFORE
 * {@link TenantAwareMessageProcessor#process} opens its {@code @Transactional} boundary. Because
 * {@link io.restaurantos.shared.tenant.TenantAwareDataSource} only sets the RLS GUC at connection
 * CHECKOUT time (reading whatever {@code TenantContext} holds at that instant), an empty context
 * at checkout means the GUC is never set on the transaction's connection — so any INSERT into a
 * FORCE-RLS table inside the handler is rejected.
 *
 * <p>This test drives the REAL {@code tenantAwareMessageProcessor} bean exactly as a live
 * {@code @RabbitListener} does: {@code tenantContext.clear()} FIRST (recreating the true empty-at-checkout
 * condition), then {@code process(envelope, handler)} with a handler that inserts into the
 * FORCE-RLS {@code widgets} table via JPA. Unlike {@code SharedLibVerificationIT
 * .sc3_tenantAwareMessageProcessorSetsContextForConsumer} (which leaves {@code BaseIntegrationTest}'s
 * pre-set context in place and therefore never observes checkout with an empty context), this test
 * clears the context first — the crux of the reproduction.
 *
 * <p>{@code BaseIntegrationTest} connects as {@code shared_test_user} (NOSUPERUSER NOBYPASSRLS —
 * see init-test-db.sql), so FORCE RLS is genuinely enforced here (unlike inventory-service's
 * superuser Testcontainers role, which is why every existing inventory IT missed this bug).
 */
class ConsumerRlsGucPropagationIT extends BaseIntegrationTest {

    @Autowired private TenantAwareMessageProcessor tenantAwareMessageProcessor;
    @Autowired private WidgetRepository widgetRepository;
    @Autowired private TransactionTemplate transactionTemplate;
    @PersistenceContext private EntityManager entityManager;

    @Test
    void consumerInsertIntoForceRlsTableSucceedsWithEmptyAmbientContextAtCheckout() {
        // Fresh tenant/branch — do NOT reuse TestFixtures.testTenantId() so there is no ambiguity
        // with the base harness's pre-seeded rows/GUC.
        UUID tenantId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();

        EventEnvelope<String> envelope = new EventEnvelope<>(
            UUID.randomUUID(), "TEST_CONSUMER_RLS_EVENT",
            tenantId, branchId,
            Instant.now(), UUID.randomUUID(), 1, "test", "payload");

        // The crux: recreate the TRUE live-consumer condition where the ambient TenantContext is
        // empty at the @Transactional connection checkout — BaseIntegrationTest.@BeforeEach
        // pre-sets a context, which is what let the bug hide from every other test.
        tenantContext.clear();

        // Primary assertion — the RED->GREEN gate. Pre-fix: this throws because the widgets
        // FORCE-RLS INSERT is rejected (unset/empty app.current_tenant_id GUC on the connection
        // Spring checked out with an empty ambient context).
        assertThatCode(() -> tenantAwareMessageProcessor.process(envelope, env -> {
            Widget widget = new Widget();
            widget.setTenantId(env.tenantId());
            widget.setName("consumer-rls-guc-propagation");
            widgetRepository.saveAndFlush(widget);
        })).doesNotThrowAnyException();

        // Strengthening assertion — re-confirm persistence under tenant scope. A manual GUC set is
        // acceptable HERE because the readback is not the code path under test: the WRITE above went
        // through the real process() -> TenantAwareDataSource checkout with no manual SET, which is
        // the bug's locus.
        Long count = transactionTemplate.execute(tx -> {
            entityManager.createNativeQuery(
                "SELECT set_config('app.current_tenant_id', :tid, true)")
                .setParameter("tid", tenantId.toString()).getSingleResult();
            return ((Number) entityManager
                .createNativeQuery("SELECT count(*) FROM widgets WHERE tenant_id = :tid")
                .setParameter("tid", tenantId)
                .getSingleResult()).longValue();
        });
        assertThat(count).isEqualTo(1L);
    }
}
