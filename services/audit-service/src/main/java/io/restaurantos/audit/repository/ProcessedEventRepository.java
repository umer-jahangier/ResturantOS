package io.restaurantos.audit.repository;

import io.restaurantos.audit.entity.ProcessedEventEntity;
import io.restaurantos.audit.entity.ProcessedEventId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

/**
 * Repository for consumer dedup tracking. Only SELECT and INSERT are needed.
 */
@Repository
public interface ProcessedEventRepository extends JpaRepository<ProcessedEventEntity, ProcessedEventId> {

    boolean existsByConsumerAndEventId(String consumer, UUID eventId);
}
