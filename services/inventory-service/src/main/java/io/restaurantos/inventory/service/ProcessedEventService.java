package io.restaurantos.inventory.service;

import io.restaurantos.inventory.entity.ProcessedEventEntity;
import io.restaurantos.inventory.repository.ProcessedEventJpaRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Idempotent event processing guard. Checks whether the event has already been
 * processed (consumer + eventId pair). If yes — skips silently. If no — runs
 * the action and records the dedup row within the same transaction.
 */
@Service
public class ProcessedEventService {

    private final ProcessedEventJpaRepository repository;

    public ProcessedEventService(ProcessedEventJpaRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public boolean tryProcess(String consumerName, UUID eventId, Runnable action) {
        if (repository.existsByConsumerAndEventId(consumerName, eventId)) {
            return false;
        }
        action.run();
        repository.save(ProcessedEventEntity.builder()
                .consumer(consumerName)
                .eventId(eventId)
                .build());
        return true;
    }
}
