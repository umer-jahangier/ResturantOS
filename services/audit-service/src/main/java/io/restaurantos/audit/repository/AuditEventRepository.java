package io.restaurantos.audit.repository;

import io.restaurantos.audit.entity.AuditEventEntity;
import io.restaurantos.audit.entity.AuditEventId;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Repository for the append-only audit_events table.
 * Only INSERT (via save/saveAndFlush) is used at runtime — no updates or deletes.
 */
@Repository
public interface AuditEventRepository extends JpaRepository<AuditEventEntity, AuditEventId> {

    List<AuditEventEntity> findByTenantIdAndOccurredAtBetween(
            UUID tenantId, Instant from, Instant to, Pageable pageable);

    List<AuditEventEntity> findByTenantIdAndActionAndOccurredAtBetween(
            UUID tenantId, String action, Instant from, Instant to, Pageable pageable);
}
