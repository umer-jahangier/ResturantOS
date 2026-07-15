package io.restaurantos.reporting.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/**
 * Idempotency dedup row for reporting-service's ETL consumers. Copied verbatim (package renamed)
 * from kitchen-service's ProcessedEventEntity — see 12-03-PLAN.md. Deliberately has NO tenant_id
 * column: this is an internal control table (consumer + eventId is the whole identity), matching
 * the established NON-RLS precedent in kitchen-service/V2 and purchasing-service/V4
 * ("relay and idempotency run outside tenant request context").
 */
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
