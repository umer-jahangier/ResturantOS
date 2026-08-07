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

    // Hibernate 7 (Spring Boot 4) forbids IDENTITY generation on a composite id (@IdClass),
    // so use the table's existing sequence (BIGSERIAL-created audit_events_id_seq) with
    // allocationSize=1 to match its increment-by-1 semantics.
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "audit_events_id_gen")
    @SequenceGenerator(name = "audit_events_id_gen", sequenceName = "audit_events_id_seq", allocationSize = 1)
    @Column(name = "id", nullable = false)
    private Long id;

    @Id
    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "branch_id")
    private UUID branchId;

    /** The account the action was performed AS. Under impersonation this is the tenant user. */
    @Column(name = "user_id")
    private UUID userId;

    /**
     * The REAL platform administrator behind an impersonated session, or null for ordinary actions.
     *
     * <p>Separate from {@link #userId} rather than replacing it: an auditor needs to know both which
     * account the system saw and which human was driving it. Collapsing them either loses the
     * impersonator or misattributes the action to them — and misattribution is the D-34 defect that
     * recorded every user in {@code impersonation_logs} as their own impersonator.
     */
    @Column(name = "impersonated_by")
    private UUID impersonatedBy;

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
