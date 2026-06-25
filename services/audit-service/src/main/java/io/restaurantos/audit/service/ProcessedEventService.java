package io.restaurantos.audit.service;

import io.restaurantos.audit.entity.ProcessedEventEntity;
import io.restaurantos.audit.repository.ProcessedEventRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Idempotent event processing wrapper.
 * Checks whether the event has already been processed (consumer, eventId pair).
 * If yes — skips silently. If no — runs the action then records the dedup row.
 * All within a single @Transactional boundary for atomicity.
 */
@Service
public class ProcessedEventService {

    private final ProcessedEventRepository processedEventRepository;

    public ProcessedEventService(ProcessedEventRepository processedEventRepository) {
        this.processedEventRepository = processedEventRepository;
    }

    /**
     * @param consumerName logical consumer name (e.g. "audit.all-events")
     * @param eventId      UUID from the EventEnvelope
     * @param action       side-effect to run if event hasn't been processed yet
     * @return true if processed now, false if already seen (skipped)
     */
    @Transactional
    public boolean tryProcess(String consumerName, UUID eventId, Runnable action) {
        if (processedEventRepository.existsByConsumerAndEventId(consumerName, eventId)) {
            return false;
        }
        action.run();
        processedEventRepository.save(ProcessedEventEntity.builder()
                .consumer(consumerName)
                .eventId(eventId)
                .build());
        return true;
    }
}
