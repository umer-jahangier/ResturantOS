package io.restaurantos.hr.repository;

import io.restaurantos.hr.entity.ProcessedEventEntity;
import io.restaurantos.hr.entity.ProcessedEventId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface ProcessedEventRepository extends JpaRepository<ProcessedEventEntity, ProcessedEventId> {

    boolean existsByConsumerAndEventId(String consumer, UUID eventId);
}
