package io.restaurantos.audit.entity;

import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.time.Instant;

/**
 * Composite primary key for the partitioned audit_events table.
 * The partition key (occurred_at) must be part of the PK in PostgreSQL range partitioning.
 */
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode
public class AuditEventId implements Serializable {
    private Long id;
    private Instant occurredAt;
}
