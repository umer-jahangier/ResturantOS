package io.restaurantos.pos.service;

import io.restaurantos.pos.entity.ProcessedEventEntity;
import io.restaurantos.pos.repository.ProcessedEventJpaRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Idempotent event processing guard for POS event consumers.
 */
@Service
public class PosProcessedEventService {

    private final ProcessedEventJpaRepository repository;

    public PosProcessedEventService(ProcessedEventJpaRepository repository) {
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
