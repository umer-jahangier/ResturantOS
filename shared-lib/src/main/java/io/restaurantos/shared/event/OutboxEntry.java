package io.restaurantos.shared.event;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "event_outbox")
@Getter
@Setter
public class OutboxEntry {
    @Id @GeneratedValue(strategy = GenerationType.UUID) private UUID id;
    @Column(nullable = false) private UUID eventId;
    @Column(nullable = false) private String exchange;
    @Column(nullable = false) private String routingKey;
    @Column(nullable = false) private String eventType;
    @Column(nullable = false) private UUID tenantId;
    private UUID branchId;
    @Column(nullable = false) private UUID correlationId;
    @Column(nullable = false) private String source;
    @Column(nullable = false, columnDefinition = "text") private String envelopeJson;
    @Column(nullable = false) private String status;   // PENDING | SENT
    @Column(nullable = false) private Instant createdAt;
    private Instant sentAt;
}
