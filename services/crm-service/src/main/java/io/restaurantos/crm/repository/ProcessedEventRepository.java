package io.restaurantos.crm.repository;

import io.restaurantos.crm.entity.ProcessedEventEntity;
import io.restaurantos.crm.entity.ProcessedEventId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface ProcessedEventRepository extends JpaRepository<ProcessedEventEntity, ProcessedEventId> {

    boolean existsByConsumerAndEventId(String consumer, UUID eventId);
}
