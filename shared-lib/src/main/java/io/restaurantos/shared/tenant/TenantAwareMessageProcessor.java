package io.restaurantos.shared.tenant;

import io.restaurantos.shared.event.EventEnvelope;
import jakarta.persistence.EntityManager;
import org.hibernate.Session;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;
import java.util.function.Consumer;

/**
 * The ONLY sanctioned way to process a tenant-scoped event in a @RabbitListener.
 * Sets TenantContext, enables the Hibernate tenant filter, and sets app.current_tenant_id
 * for PostgreSQL RLS on the SAME connection used by the consumer transaction.
 * Resolves CRIT-01 (RabbitMQ consumer half).
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
            Session session = entityManager.unwrap(Session.class);
            session.enableFilter("tenantFilter").setParameter("tenantId", tenantId);
            entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
                .setParameter("tid", tenantId.toString())
                .getSingleResult();
            handler.accept(envelope);
        } finally {
            tenantContext.clear();
        }
    }
}
