package io.restaurantos.shared.tenant;

import io.restaurantos.shared.event.EventEnvelope;
import jakarta.persistence.EntityManager;
import org.hibernate.Session;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;
import java.util.function.Consumer;

/**
 * The ONLY sanctioned way to process a tenant-scoped event in a @RabbitListener.
 * Sets TenantContext and enables the Hibernate tenant filter on the SAME connection
 * used by the consumer transaction. Resolves CRIT-01 (RabbitMQ consumer half).
 *
 * <p><b>RLS GUC ordering.</b> {@code process()} is {@code @Transactional}, so Spring has
 * already checked out and {@code BEGIN}-ed the transaction's connection by the time this
 * method body runs. A live {@code @RabbitListener} has no ambient {@link TenantContext} set
 * BEFORE that checkout — {@link TenantAwareDataSource} therefore sees an empty context at
 * checkout and never sets {@code app.current_tenant_id} on this transaction's connection,
 * so any handler INSERT into a FORCE-RLS table is rejected. The RLS GUC is instead applied
 * explicitly here, immediately after {@code tenantContext.set(...)} and before the handler
 * runs any DML, via {@link TenantGucHelper#apply}, which issues a transaction-local
 * {@code set_config(..., true)} on the connection already bound to this open transaction —
 * it therefore auto-reverts at commit/rollback and cannot leak across pooled connections.
 */
public class TenantAwareMessageProcessor {

    private final TenantContext tenantContext;
    private final EntityManager entityManager;

    public TenantAwareMessageProcessor(TenantContext tenantContext, EntityManager entityManager) {
        this.tenantContext = tenantContext;
        this.entityManager = entityManager;
    }

    @Transactional
    public <T> void process(EventEnvelope<T> envelope, Consumer<EventEnvelope<T>> handler) {
        UUID tenantId = envelope.tenantId();
        UUID branchId = envelope.branchId();
        try {
            tenantContext.set(tenantId, branchId, null, null);
            TenantGucHelper.apply(entityManager, tenantContext);
            Session session = entityManager.unwrap(Session.class);
            session.enableFilter("tenantFilter").setParameter("tenantId", tenantId);
            handler.accept(envelope);
        } finally {
            tenantContext.clear();
        }
    }
}
