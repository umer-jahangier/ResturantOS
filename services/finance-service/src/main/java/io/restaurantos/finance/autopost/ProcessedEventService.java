package io.restaurantos.finance.autopost;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class ProcessedEventService {

    private final ProcessedEventRepository processedEventRepository;

    public ProcessedEventService(ProcessedEventRepository processedEventRepository) {
        this.processedEventRepository = processedEventRepository;
    }

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
