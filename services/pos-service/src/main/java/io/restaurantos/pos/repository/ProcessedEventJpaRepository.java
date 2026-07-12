package io.restaurantos.pos.repository;

import io.restaurantos.pos.entity.ProcessedEventEntity;
import io.restaurantos.pos.entity.ProcessedEventId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface ProcessedEventJpaRepository extends JpaRepository<ProcessedEventEntity, ProcessedEventId> {

    boolean existsByConsumerAndEventId(String consumer, UUID eventId);
}
