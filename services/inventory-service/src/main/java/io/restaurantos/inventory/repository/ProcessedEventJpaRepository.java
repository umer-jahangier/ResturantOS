package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.entity.ProcessedEventEntity;
import io.restaurantos.inventory.entity.ProcessedEventId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface ProcessedEventJpaRepository extends JpaRepository<ProcessedEventEntity, ProcessedEventId> {

    boolean existsByConsumerAndEventId(String consumer, UUID eventId);
}
