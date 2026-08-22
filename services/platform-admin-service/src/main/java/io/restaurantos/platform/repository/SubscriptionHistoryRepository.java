package io.restaurantos.platform.repository;

import io.restaurantos.platform.entity.SubscriptionHistoryEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

/**
 * Reads of the append-only trail.
 *
 * <p>There is deliberately no delete/update helper and no {@code deleteByTenantId}: the table's
 * triggers would refuse them anyway, and a repository method whose only outcome is a database
 * exception is an invitation written in Java.
 */
@Repository
public interface SubscriptionHistoryRepository extends JpaRepository<SubscriptionHistoryEntity, UUID> {

    Page<SubscriptionHistoryEntity> findByTenantIdOrderByRecordedAtDesc(UUID tenantId, Pageable pageable);

    long countByTenantId(UUID tenantId);
}
