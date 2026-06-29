package io.restaurantos.pos.domain.model;

import io.restaurantos.pos.domain.enums.TillStatus;
import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Generated;
import org.hibernate.generator.EventType;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "till_sessions")
@Getter
@Setter
public class TillSession extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "cashier_id", nullable = false)
    private UUID cashierId;

    @Column(name = "opening_float_paisa", nullable = false)
    private long openingFloatPaisa;

    @Column(name = "expected_closing_paisa")
    private Long expectedClosingPaisa;

    @Column(name = "declared_closing_paisa")
    private Long declaredClosingPaisa;

    /**
     * Computed by the DB: declared_closing_paisa - expected_closing_paisa.
     * Read after flush/refresh; never set directly.
     */
    @Generated(event = EventType.INSERT)
    @Column(name = "variance_paisa", insertable = false, updatable = false)
    private Long variancePaisa;

    @Column(name = "opened_at")
    private Instant openedAt;

    @Column(name = "closed_at")
    private Instant closedAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 20)
    private TillStatus status = TillStatus.OPEN;
}
