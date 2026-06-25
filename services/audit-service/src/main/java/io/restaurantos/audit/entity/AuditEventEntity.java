package io.restaurantos.audit.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

/**
 * Maps to the append-only, partitioned audit_events table.
 * Plain entity — NOT TenantAuditableEntity (no soft-delete/update semantics).
 * INSERT-only at runtime: the runtime datasource user (audit_writer) has no UPDATE/DELETE grants.
 * Defense-in-depth: Postgres trigger also raises exception on UPDATE/DELETE.
 */
@Entity
@Table(name = "audit_events")
@IdClass(AuditEventId.class)
@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AuditEventEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id", nullable = false)
    private Long id;

    @Id
    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "branch_id")
    private UUID branchId;

    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "action", nullable = false, length = 255)
    private String action;

    @Column(name = "resource_type", length = 255)
    private String resourceType;

    @Column(name = "resource_id", length = 255)
    private String resourceId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "before_state", columnDefinition = "jsonb")
    private String beforeState;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "after_state", columnDefinition = "jsonb")
    private String afterState;

    @Column(name = "ip_address", length = 45)
    private String ipAddress;

    @Column(name = "user_agent")
    private String userAgent;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private String metadata;
}
