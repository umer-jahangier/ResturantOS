package io.restaurantos.pos.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "processed_events")
@IdClass(ProcessedEventId.class)
@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProcessedEventEntity {

    @Id
    @Column(name = "consumer", nullable = false)
    private String consumer;

    @Id
    @Column(name = "event_id", nullable = false)
    private UUID eventId;

    @Column(name = "source_type")
    private String sourceType;

    @Column(name = "source_id")
    private UUID sourceId;

    @Column(name = "processed_at", nullable = false)
    @Builder.Default
    private Instant processedAt = Instant.now();
}
